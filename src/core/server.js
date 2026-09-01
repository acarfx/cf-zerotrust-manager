'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const swaggerPath = require('swagger-ui-dist').getAbsoluteFSPath();
const OPENAPI_FILE = path.join(__dirname, '..', 'api', 'openapi.json');
const store = require('./store');
const service = require('./service');
const audit = require('./audit');

function json(res, status, payload, extraHeaders) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-API-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  }, extraHeaders || {}));
  res.end(body);
}

function fileResponse(res, file, contentType) {
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'public, max-age=3600'
  });
  res.end(body);
}

function loadOpenapi() {
  return JSON.parse(fs.readFileSync(OPENAPI_FILE, 'utf8'));
}

function apiSpec(req) {
  const host = (req && req.headers && req.headers.host) || '127.0.0.1';
  const spec = loadOpenapi();
  spec.servers = [{ url: `http://${host}`, description: 'Çalışan yerel API sunucusu' }];
  return spec;
}

function docsHtml(req) {
  const specJson = JSON.stringify(apiSpec(req)).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">
  <title>CF Zero Trust Manager API</title>
  <link rel="stylesheet" href="/api-docs/swagger-ui.css">
  <link rel="stylesheet" href="/api-docs/index.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/api-docs/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      spec: ${specJson},
      dom_id: '#swagger-ui',
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
      persistAuthorization: true,
      presets: [SwaggerUIBundle.presets.apis],
      layout: 'BaseLayout',
      defaultModelsExpandDepth: -1,
      docExpansion: 'full',
      tagsSorter: 'alpha',
      operationsSorter: 'alpha'
    });
  </script>
</body>
</html>`;
}

function serveDocs(pathname, req, res) {
  if (pathname === '/api/docs.json') {
    return json(res, 200, apiSpec(req), { 'Cache-Control': 'no-store, no-cache, must-revalidate' });
  }
  if (pathname === '/api-docs') {
    const body = docsHtml(req);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    return res.end(body);
  }
  const assets = {
    '/api-docs/swagger-ui.css': ['swagger-ui.css', 'text/css; charset=utf-8'],
    '/api-docs/index.css': ['index.css', 'text/css; charset=utf-8'],
    '/api-docs/swagger-ui-bundle.js': ['swagger-ui-bundle.js', 'application/javascript; charset=utf-8']
  };
  if (!assets[pathname]) return false;
  fileResponse(res, path.join(swaggerPath, assets[pathname][0]), assets[pathname][1]);
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Istek govdesi cok buyuk'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('Gecersiz JSON govdesi'));
      }
    });
    req.on('error', reject);
  });
}

function extractKey(req) {
  const auth = req.headers['authorization'];
  if (auth && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  if (req.headers['x-api-key']) return String(req.headers['x-api-key']).trim();
  return null;
}

// ---- IP whitelist ----
function ipToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function parseRule(rule) {
  const s = String(rule).trim();
  if (!s) return null;
  if (s.includes('/')) {
    const [ip, bitsStr] = s.split('/');
    const base = ipToInt(ip);
    const bits = Number(bitsStr);
    if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return { base: base & mask, mask };
  }
  const exact = ipToInt(s);
  return exact === null ? null : { base: exact, mask: 0xffffffff };
}

function ipAllowed(ip, rules) {
  if (!rules || !rules.length) return true;
  const addr = ipToInt(ip);
  if (addr === null) return false;
  return rules.some((rule) => {
    const r = parseRule(rule);
    return r && (addr & r.mask) === r.base;
  });
}

const ROUTES = [
  { method: 'GET', pattern: /^\/health$/, auth: false, handler: async () => ({ ok: true, status: 'healthy', service: 'cf-zerotrust-manager', time: new Date().toISOString() }) },
  { method: 'GET', pattern: /^\/api\/status$/, handler: async () => service.status() },
  { method: 'GET', pattern: /^\/api\/accounts$/, handler: async () => service.accounts() },
  { method: 'GET', pattern: /^\/api\/tunnels$/, handler: async () => service.tunnels() },
  { method: 'GET', pattern: /^\/api\/zones$/, handler: async () => service.zones() },
  { method: 'GET', pattern: /^\/api\/tunnel\/config$/, handler: async () => service.tunnelConfig() },
  { method: 'GET', pattern: /^\/api\/hostnames$/, handler: async () => ({ items: await service.list() }) },
  {
    method: 'POST',
    pattern: /^\/api\/hostnames$/,
    handler: async (ctx) => service.create({
      hostname: ctx.body.hostname,
      service: ctx.body.service,
      path: ctx.body.path,
      noTLSVerify: ctx.body.noTLSVerify
    })
  },
  {
    method: 'PUT',
    pattern: /^\/api\/hostnames\/([^/]+)$/,
    handler: async (ctx) => service.update(decodeURIComponent(ctx.params[0]), {
      hostname: ctx.body.hostname,
      service: ctx.body.service,
      path: ctx.body.path,
      noTLSVerify: ctx.body.noTLSVerify
    })
  },
  { method: 'POST', pattern: /^\/api\/hostnames\/([^/]+)\/enable$/, handler: async (ctx) => service.enable(decodeURIComponent(ctx.params[0])) },
  { method: 'POST', pattern: /^\/api\/hostnames\/([^/]+)\/disable$/, handler: async (ctx) => service.disable(decodeURIComponent(ctx.params[0])) },
  { method: 'POST', pattern: /^\/api\/hostnames\/([^/]+)\/toggle$/, handler: async (ctx) => service.toggle(decodeURIComponent(ctx.params[0])) },
  { method: 'DELETE', pattern: /^\/api\/hostnames\/([^/]+)$/, handler: async (ctx) => service.destroy(decodeURIComponent(ctx.params[0])) },
  { method: 'GET', pattern: /^\/api\/config$/, handler: async () => store.maskedConfig() },
  {
    method: 'PUT',
    pattern: /^\/api\/config$/,
    handler: async (ctx) => {
      const allowed = ['apiToken', 'accountId', 'tunnelId', 'zoneName', 'defaultService', 'serverPort', 'serverHost', 'ipWhitelist', 'language', 'rateLimitEnabled', 'rateLimitPerMin', 'dailyLimitEnabled', 'dailyLimit', 'lockoutEnabled', 'lockoutFails', 'lockoutMinutes'];
      const patch = {};
      allowed.forEach((k) => {
        if (ctx.body[k] !== undefined) patch[k] = ctx.body[k];
      });
      store.saveConfig(patch);
      return store.maskedConfig();
    }
  },
  { method: 'GET', pattern: /^\/api\/keys$/, handler: async () => ({ items: store.getKeys().map(({ hash, ...rest }) => rest) }) },
  {
    method: 'POST',
    pattern: /^\/api\/keys$/,
    handler: async (ctx) => {
      const { entry, secret } = store.createKey(ctx.body.label);
      const { hash, ...rest } = entry;
      return { key: rest, secret };
    }
  },
  { method: 'DELETE', pattern: /^\/api\/keys\/([^/]+)$/, handler: async (ctx) => ({ deleted: store.deleteKey(ctx.params[0]) }) }
];

function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  let ip = remote.startsWith('::ffff:') ? remote.slice(7) : remote;
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

function safeDetail(pathname, body) {
  if (!body || typeof body !== 'object') return pathname;
  const pick = ['hostname', 'service', 'path', 'label', 'accountId', 'tunnelId', 'zoneName'];
  const bits = pick.filter((k) => body[k] !== undefined).map((k) => `${k}=${body[k]}`);
  return bits.length ? bits.join(', ') : pathname;
}

const rateBuckets = new Map();
const authFails = new Map();

function minuteKey(ip, keyId) {
  return `${keyId || 'anon'}|${ip}`;
}

function checkRateLimit(cfg, ip, keyId) {
  if (!cfg.rateLimitEnabled) return;
  const cap = Number(cfg.rateLimitPerMin) || 60;
  const now = Date.now();
  const id = minuteKey(ip, keyId);
  let b = rateBuckets.get(id);
  if (!b || now - b.start > 60000) b = { start: now, count: 0 };
  b.count += 1;
  rateBuckets.set(id, b);
  if (b.count > cap) {
    const err = new Error('Rate limit asildi');
    err.status = 429;
    throw err;
  }
}

function lockedUntil(ip) {
  const row = authFails.get(ip);
  return row && row.until && Date.now() < row.until ? row.until : 0;
}

function noteAuthFail(ip, cfg) {
  if (!cfg.lockoutEnabled) return;
  const max = Number(cfg.lockoutFails) || 10;
  const mins = Number(cfg.lockoutMinutes) || 15;
  const row = authFails.get(ip) || { n: 0, until: 0 };
  row.n += 1;
  if (row.n >= max) {
    row.until = Date.now() + mins * 60 * 1000;
    row.n = 0;
  }
  authFails.set(ip, row);
}

function clearAuthFail(ip) {
  authFails.delete(ip);
}

function logAudit(payload) {
  try {
    return audit.write(payload);
  } catch (err) {
    return null;
  }
}

function createServer(options = {}) {
  const log = options.log || (() => {});
  const onAudit = options.onAudit || (() => {});

  return http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const ip = clientIp(req);
    const userAgent = String(req.headers['user-agent'] || '');
    const device = store.parseDevice(userAgent);

    if (req.method === 'OPTIONS') {
      return json(res, 204, {});
    }

    if (req.method === 'GET' && serveDocs(pathname, req, res) !== false) return;

    const route = ROUTES.find((r) => r.method === req.method && r.pattern.test(pathname));
    if (!route) {
      log('warn', `${req.method} ${pathname} -> 404`);
      const rec = logAudit({
        source: 'api', action: `${req.method} ${pathname}`, actor: '-', ip, userAgent, device,
        method: req.method, path: pathname, status: 404, outcome: 'error', detail: 'endpoint yok'
      });
      if (rec) onAudit(rec);
      return json(res, 404, { success: false, error: 'Endpoint bulunamadi' });
    }

    let key = null;
    if (route.auth !== false) {
      const cfg = store.getConfig();
      if (!ipAllowed(ip, cfg.ipWhitelist)) {
        log('warn', `${req.method} ${pathname} -> 403 (IP whitelist disi: ${ip})`);
        const rec = logAudit({
          source: 'api', action: `${req.method} ${pathname}`, actor: '-', ip, userAgent, device,
          method: req.method, path: pathname, status: 403, outcome: 'denied', detail: 'IP whitelist disi'
        });
        if (rec) onAudit(rec);
        return json(res, 403, { success: false, error: 'IP whitelist disi erisim engellendi' });
      }

      const until = lockedUntil(ip);
      if (until) {
        const rec = logAudit({
          source: 'api', action: `${req.method} ${pathname}`, actor: '-', ip, userAgent, device,
          method: req.method, path: pathname, status: 429, outcome: 'denied', detail: 'auth lockout'
        });
        if (rec) onAudit(rec);
        return json(res, 429, { success: false, error: 'Cok fazla basarisiz deneme, gecici kilit' });
      }

      const secret = extractKey(req);
      key = store.peekKey(secret);
      if (!key) {
        noteAuthFail(ip, cfg);
        log('warn', `${req.method} ${pathname} -> 401 (gecersiz API anahtari)`);
        const rec = logAudit({
          source: 'api', action: `${req.method} ${pathname}`, actor: '-', ip, userAgent, device,
          method: req.method, path: pathname, status: 401, outcome: 'denied', detail: 'gecersiz API anahtari'
        });
        if (rec) onAudit(rec);
        return json(res, 401, { success: false, error: 'Gecersiz veya eksik API anahtari' });
      }

      try {
        checkRateLimit(cfg, ip, key.id);
        if (cfg.dailyLimitEnabled && store.todayCount(key) >= (Number(cfg.dailyLimit) || 10000)) {
          const err = new Error('Gunluk istek limiti asildi');
          err.status = 429;
          throw err;
        }
      } catch (limErr) {
        const status = limErr.status || 429;
        const rec = logAudit({
          source: 'api', action: `${req.method} ${pathname}`,
          actor: `${key.label} (${key.prefix}…)`, keyId: key.id, ip, userAgent, device,
          method: req.method, path: pathname, status, outcome: 'denied', detail: limErr.message
        });
        if (rec) onAudit(rec);
        return json(res, status, { success: false, error: limErr.message });
      }

      clearAuthFail(ip);
      key = store.markKeyUsed(key.id, { ip, userAgent });
      req.apiKey = key;
    }

    try {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const params = route.pattern.exec(pathname).slice(1);
      const result = await route.handler({ req, res, body, params, query: url.searchParams });
      log('info', `${req.method} ${pathname} -> 200 (${Date.now() - started}ms)`);
      if (route.auth !== false) {
        const rec = logAudit({
          source: 'api',
          action: `${req.method} ${pathname}`,
          actor: key ? `${key.label} (${key.prefix}…)` : '-',
          keyId: key ? key.id : '',
          ip, userAgent, device,
          method: req.method, path: pathname, status: 200, outcome: 'ok',
          detail: safeDetail(pathname, body)
        });
        if (rec) onAudit(rec);
      }
      return json(res, 200, { success: true, result });
    } catch (err) {
      const status = err.status || 500;
      log('error', `${req.method} ${pathname} -> ${status} ${err.message}`);
      if (route.auth !== false) {
        const rec = logAudit({
          source: 'api',
          action: `${req.method} ${pathname}`,
          actor: key ? `${key.label} (${key.prefix}…)` : '-',
          keyId: key ? key.id : '',
          ip, userAgent, device,
          method: req.method, path: pathname, status, outcome: 'error',
          detail: err.message
        });
        if (rec) onAudit(rec);
      }
      return json(res, status, { success: false, error: err.message, details: err.errors || [] });
    }
  });
}

module.exports = { createServer, ROUTES };
