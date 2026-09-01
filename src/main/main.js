'use strict';

const { app, BrowserWindow, ipcMain, Notification, shell, clipboard, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const store = require('../core/store');
const service = require('../core/service');
const { createServer } = require('../core/server');
const audit = require('../core/audit');

const APP_USER_MODEL_ID = 'com.acar.cfzerotrust';
const PRODUCT_NAME = 'CF Zero Trust Manager';

app.setAppUserModelId(APP_USER_MODEL_ID);
app.setName(PRODUCT_NAME);

let mainWindow = null;
let apiServer = null;
let tray = null;
let apiServerInfo = { running: false, port: null, host: null };

function assetPath(name) {
  return path.join(app.getAppPath(), 'build', name);
}

function updateTray(running) {
  if (!tray) return;
  const icon = nativeImage.createFromPath(assetPath(running ? 'tray-healthy.png' : 'tray-down.png'));
  tray.setImage(icon);
  tray.setToolTip(`${PRODUCT_NAME} — API ${running ? 'healthy' : 'down'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Uygulamayı Aç', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else createWindow(); } },
    { label: `API durumu: ${running ? 'Healthy' : 'Down'}`, enabled: false },
    { type: 'separator' },
    { label: 'Çıkış', click: () => app.quit() }
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(assetPath('tray-idle.png')));
  tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  updateTray(apiServerInfo.running);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 620,
    frame: false,
    show: false,
    icon: assetPath('icon.png'),
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = String(input.key || '').toLowerCase();
    if (input.key === 'F12' || ((input.control || input.meta) && input.shift && (key === 'i' || key === 'j' || key === 'c'))) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow.webContents.closeDevTools();
  });

  mainWindow.on('maximize', () => sendToRenderer('window:state', { maximized: true }));
  mainWindow.on('unmaximize', () => sendToRenderer('window:state', { maximized: false }));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: assetPath('icon.png'), silent: false });
  n.show();
}

// --- Bildirim cevirileri (dil: config.language) ---
const NOTIF = {
  tr: {
    saved: 'Ayarlar kaydedildi', savedBody: 'Cloudflare baglanti bilgileri guncellendi.',
    created: 'Subdomain acildi', updated: 'Subdomain guncellendi', active: 'Subdomain aktif', activeBody: '{h} yayina alindi.',
    disabled: 'Subdomain kapatildi', disabledBody: '{h} yayindan kaldirildi.',
    deleted: 'Subdomain silindi', deletedBody: '{h} tamamen kaldirildi.',
    keyCreated: 'API anahtari olusturuldu', keyCreatedBody: '{l} anahtari panoya kopyalanabilir.',
    srvUp: 'API sunucusu calisiyor', srvDown: 'API sunucusu durdu', srvDownBody: 'REST API artik erisilebilir degil.'
  },
  en: {
    saved: 'Settings saved', savedBody: 'Cloudflare connection info updated.',
    created: 'Subdomain opened', updated: 'Subdomain updated', active: 'Subdomain active', activeBody: '{h} is now live.',
    disabled: 'Subdomain disabled', disabledBody: '{h} removed from live.',
    deleted: 'Subdomain deleted', deletedBody: '{h} fully removed.',
    keyCreated: 'API key created', keyCreatedBody: '{l} key can be copied to clipboard.',
    srvUp: 'API server running', srvDown: 'API server stopped', srvDownBody: 'REST API is no longer reachable.'
  },
  ru: {
    saved: 'Настройки сохранены', savedBody: 'Данные подключения Cloudflare обновлены.',
    created: 'Субдомен открыт', updated: 'Субдомен обновлён', active: 'Субдомен активен', activeBody: '{h} опубликован.',
    disabled: 'Субдомен отключён', disabledBody: '{h} снят с публикации.',
    deleted: 'Субдомен удалён', deletedBody: '{h} полностью удалён.',
    keyCreated: 'API-ключ создан', keyCreatedBody: 'Ключ {l} можно скопировать в буфер обмена.',
    srvUp: 'API-сервер работает', srvDown: 'API-сервер остановлен', srvDownBody: 'REST API больше недоступен.'
  }
};

function ntr(key, vars) {
  const lang = store.getConfig().language || 'en';
  const dict = NOTIF[lang] || NOTIF.en;
  let str = dict[key] !== undefined ? dict[key] : NOTIF.en[key];
  if (vars) str = str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return str;
}

function ok(result) {
  return { success: true, result };
}

function fail(err) {
  return { success: false, error: err.message || String(err), details: err.errors || [] };
}

function appAuditCtx() {
  let ua = '';
  try {
    if (mainWindow && !mainWindow.isDestroyed()) ua = mainWindow.webContents.getUserAgent();
  } catch (e) { /* ignore */ }
  let user = 'app';
  try { user = os.userInfo().username; } catch (e) { /* ignore */ }
  return {
    source: 'app',
    actor: user,
    ip: '127.0.0.1',
    userAgent: ua,
    device: `${os.hostname()} · ${os.type()} ${os.release()} (${os.arch()})`
  };
}

function writeAppAudit(meta, outcome, extra) {
  try {
    const rec = audit.write(Object.assign({}, appAuditCtx(), meta, { outcome }, extra || {}));
    sendToRenderer('audit:entry', rec);
    return rec;
  } catch (e) {
    return null;
  }
}

const AUDIT_CH = {
  'config:save': (patch) => ({ action: 'config.save', detail: Object.keys(patch || {}).filter((k) => k !== 'apiToken').join(', ') }),
  'cf:create': (payload) => ({ action: 'hostname.create', detail: (payload && payload.hostname) || '' }),
  'cf:update': (oldH, payload) => ({ action: 'hostname.update', detail: `${oldH} -> ${(payload && payload.hostname) || oldH}` }),
  'cf:enable': (h) => ({ action: 'hostname.enable', detail: String(h || '') }),
  'cf:disable': (h) => ({ action: 'hostname.disable', detail: String(h || '') }),
  'cf:delete': (h) => ({ action: 'hostname.delete', detail: String(h || '') }),
  'cf:dnsCreate': (zoneId, input) => ({ action: 'dns.create', detail: `${(input && input.type) || ''} ${(input && input.name) || ''}`.trim() }),
  'cf:dnsUpdate': (_z, recordId) => ({ action: 'dns.update', detail: String(recordId || '') }),
  'cf:dnsDelete': (_z, recordId) => ({ action: 'dns.delete', detail: String(recordId || '') }),
  'keys:create': (label) => ({ action: 'key.create', detail: String(label || '') }),
  'keys:revoke': (id) => ({ action: 'key.revoke', detail: String(id || '') }),
  'keys:delete': (id) => ({ action: 'key.delete', detail: String(id || '') }),
  'tokens:use': (id) => ({ action: 'token.use', detail: String(id || '') }),
  'tokens:delete': (id) => ({ action: 'token.delete', detail: String(id || '') }),
  'server:start': () => ({ action: 'server.start' }),
  'server:stop': () => ({ action: 'server.stop' })
};

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const result = await fn(...args);
      if (AUDIT_CH[channel]) {
        writeAppAudit(AUDIT_CH[channel](...args), 'ok');
      }
      return ok(result);
    } catch (err) {
      if (AUDIT_CH[channel]) {
        const meta = AUDIT_CH[channel](...args);
        writeAppAudit(meta, 'error', { detail: [meta.detail, err.message].filter(Boolean).join(' — ') });
      }
      return fail(err);
    }
  });
}

// --- Pencere kontrolleri ---
ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow && mainWindow.close());
ipcMain.handle('window:isMaximized', () => (mainWindow ? mainWindow.isMaximized() : false));

// --- Bildirim / yardimcilar ---
ipcMain.on('app:notify', (_e, { title, body }) => notify(title, body));
ipcMain.on('app:copy', (_e, text) => clipboard.writeText(String(text || '')));
ipcMain.on('app:openExternal', (_e, url) => shell.openExternal(url));
ipcMain.handle('app:versions', () => ({
  app: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome
}));

// --- Ayarlar ---
handle('config:get', async () => store.maskedConfig());
handle('config:raw', async () => store.getConfig());
handle('config:save', async (patch, options = {}) => {
  // store.saveConfig maskeli/bos token'i otomatik ayikliyor
  store.saveConfig(patch);
  if (options.silent !== true) notify(ntr('saved'), ntr('savedBody'));
  return store.maskedConfig();
});
ipcMain.handle('config:setLang', (_e, lang) => {
  store.saveConfig({ language: ['tr', 'en', 'ru'].includes(lang) ? lang : 'en' });
  return true;
});

// --- Kayitli Cloudflare token gecmisi ---
handle('tokens:list', async () => store.publicTokenHistory());
handle('tokens:use', async (id) => {
  const cfg = store.useToken(id);
  if (!cfg) throw new Error('Token bulunamadi');
  return cfg;
});
handle('tokens:delete', async (id) => store.deleteToken(id));

// --- Cloudflare islemleri ---
handle('cf:status', async (overrides) => service.status(overrides));
handle('cf:probe', async (overrides) => service.probe(overrides));
handle('cf:accounts', async (overrides) => service.accounts(overrides));
handle('cf:tunnels', async (overrides) => service.tunnels(overrides));
handle('cf:tunnelGet', async (id) => service.tunnelGet(id));
handle('cf:tunnelConfigFor', async (id) => service.tunnelConfigFor(id));
handle('cf:zones', async (overrides) => service.zones(overrides));
handle('cf:dns', async (zoneId) => service.dnsRecords(zoneId));
handle('cf:dnsCreate', async (zoneId, input) => service.dnsCreate(zoneId, input));
handle('cf:dnsUpdate', async (zoneId, recordId, input) => service.dnsUpdate(zoneId, recordId, input));
handle('cf:dnsDelete', async (zoneId, recordId) => service.dnsDelete(zoneId, recordId));
handle('cf:workers', async () => service.workers());
handle('cf:workerGet', async (name) => service.workerGet(name));
handle('cf:workerPut', async (name, code) => service.workerPut(name, code));
handle('cf:workerDelete', async (name) => service.workerDelete(name));
handle('cf:workerRoutes', async (zoneId) => service.workerRoutes(zoneId));
handle('cf:workerRouteCreate', async (zoneId, input) => service.workerRouteCreate(zoneId, input));
handle('cf:workerRouteDelete', async (zoneId, routeId) => service.workerRouteDelete(zoneId, routeId));
handle('cf:workerTemplate', async () => service.workerTemplate());
handle('cf:pages', async () => service.pages());
handle('cf:pageCreate', async (input) => service.pageCreate(input));
handle('cf:pageDelete', async (name) => service.pageDelete(name));
handle('cf:pageDomains', async (name) => service.pageDomains(name));
handle('cf:pageDomainAdd', async (name, domain) => service.pageDomainAdd(name, domain));
handle('cf:pageDomainDelete', async (name, domain) => service.pageDomainDelete(name, domain));
handle('cf:pageDeployments', async (name) => service.pageDeployments(name));
handle('cf:tunnelConfig', async () => service.tunnelConfig());
handle('cf:list', async () => service.list());
handle('cf:create', async (payload) => {
  const res = await service.create(payload);
  notify(ntr('created'), `${res.hostname} -> ${res.service}`);
  return res;
});
handle('cf:update', async (oldHostname, payload) => {
  const res = await service.update(oldHostname, payload);
  notify(ntr('updated'), `${oldHostname} -> ${res.hostname}`);
  return res;
});
handle('cf:enable', async (hostname) => {
  const res = await service.enable(hostname);
  notify(ntr('active'), ntr('activeBody', { h: hostname }));
  return res;
});
handle('cf:disable', async (hostname) => {
  const res = await service.disable(hostname);
  notify(ntr('disabled'), ntr('disabledBody', { h: hostname }));
  return res;
});
handle('cf:delete', async (hostname) => {
  const res = await service.destroy(hostname);
  notify(ntr('deleted'), ntr('deletedBody', { h: hostname }));
  return res;
});

// --- API anahtarlari ---
handle('keys:list', async () => store.getKeys().map(({ hash, ...rest }) => rest));
handle('keys:create', async (label) => {
  const { entry, secret } = store.createKey(label);
  notify(ntr('keyCreated'), ntr('keyCreatedBody', { l: entry.label }));
  const { hash, ...rest } = entry;
  return { key: rest, secret };
});
handle('keys:revoke', async (id) => store.revokeKey(id));
handle('keys:delete', async (id) => store.deleteKey(id));

handle('audit:list', async (opts) => audit.query(opts || {}));
handle('audit:clear', async () => {
  audit.clear();
  return true;
});

// --- Gomulu API sunucusu ---
handle('server:status', async () => apiServerInfo);
handle('server:start', async (opts = {}) => {
  if (apiServerInfo.running) return apiServerInfo;
  const cfg = store.getConfig();
  const port = Number(opts.port || cfg.serverPort || 7000);
  const host = opts.host || cfg.serverHost || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Gecersiz port: ${opts.port}`);
  apiServer = createServer({
    log: (level, message) => sendToRenderer('server:log', { level, message, time: new Date().toISOString() }),
    onAudit: (rec) => sendToRenderer('audit:entry', rec)
  });

  try {
    await new Promise((resolve, reject) => {
      const onError = (err) => {
        reject(err.code === 'EADDRINUSE' ? new Error(`Port ${port} kullanimda`) : err);
      };
      apiServer.once('error', onError);
      apiServer.listen(port, host, () => {
        apiServer.removeListener('error', onError);
        resolve();
      });
    });
  } catch (err) {
    try { apiServer.close(); } catch (e) { /* zaten kapali */ }
    apiServer = null;
    apiServerInfo = { running: false, port: null, host: null };
    throw err;
  }

  apiServerInfo = { running: true, port, host };
  updateTray(true);
  sendToRenderer('server:log', { level: 'info', message: `API sunucusu http://${host}:${port} baslatildi`, time: new Date().toISOString() });
  notify(ntr('srvUp'), `http://${host}:${port}`);
  return apiServerInfo;
});
handle('server:stop', async () => {
  if (!apiServer) {
    apiServerInfo = { running: false, port: null, host: null };
    return apiServerInfo;
  }
  await new Promise((resolve) => apiServer.close(resolve));
  apiServer = null;
  apiServerInfo = { running: false, port: null, host: null };
  updateTray(false);
  sendToRenderer('server:log', { level: 'warn', message: 'API sunucusu durduruldu', time: new Date().toISOString() });
  notify(ntr('srvDown'), ntr('srvDownBody'));
  return apiServerInfo;
});

app.whenReady().then(() => {
  createTray();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('devtools-opened', () => {
    contents.closeDevTools();
  });
});

app.on('window-all-closed', () => {
  if (apiServer) apiServer.close();
  if (process.platform !== 'darwin') app.quit();
});
