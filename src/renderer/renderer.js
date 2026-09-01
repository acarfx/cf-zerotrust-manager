'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const Swal = window.Swal || window.Sweetalert2;

let state = {
  config: {},
  zones: [],
  hosts: [],
  server: { running: false },
  tokens: [],
  whitelist: [],
  tunnels: [],
  cfZones: [],
  dnsRecords: [],
  dnsZoneId: '',
  accountName: ''
};
let lang = localStorage.getItem('czt_lang') || 'en';
let t = makeT(lang);
let obWhitelist = [];
let ignoreTunnelChange = false;

/* ---------- dil ---------- */
function setI18nText(el, text) {
  if (el.childNodes.length === 0) {
    el.textContent = text;
    return;
  }
  if (el.childNodes[0].nodeType === Node.TEXT_NODE) {
    el.childNodes[0].textContent = text;
  } else if (el.children.length === 0) {
    el.textContent = text;
  } else {
    el.insertBefore(document.createTextNode(text), el.firstChild);
  }
}

function applyLang() {
  t = makeT(lang);
  document.documentElement.lang = lang;
  $$('[data-i18n]').forEach((el) => {
    let vars = null;
    if (el.dataset.i18nVars) {
      try { vars = JSON.parse(el.dataset.i18nVars); } catch (e) { vars = null; }
    }
    setI18nText(el, t(el.dataset.i18n, vars));
  });
  $$('[data-i18n-ph]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  renderLangSwitch('lang-switch');
  renderLangSwitch('ob-lang-switch');
  updateOnboardingButtons();
  renderServer(state.server);
  if (state.hosts.length) renderHosts();
  if (state.config.accountId) fillAccountCard(null);
  if (state.config.hasToken !== undefined) {
    const tokenState = $('#cfg-token-state');
    if (tokenState) tokenState.textContent = state.config.hasToken ? t('set.tokenSaved', { m: state.config.tokenMask }) : t('set.tokenEmpty');
  }
  if (state.tokens.length) loadTokenHistory();
  renderWhitelist();
  renderObWhitelist();
  initFormSelects();
  fillTunnelSelect(state.tunnels);
  updateNavTunnelLabel();
  syncDnsTypeUi();
  if (state.dnsRecords.length || state.dnsZoneId) renderDnsRows();
  fillSecurityForm();
  if ($('#tab-audit') && $('#tab-audit').classList.contains('active')) loadAudit();
  if ($('#tab-keys') && $('#tab-keys').classList.contains('active')) loadKeys();
}

function renderLangSwitch(containerId = 'lang-switch') {
  const box = $('#' + containerId);
  if (!box) return;
  box.innerHTML = '';
  Object.keys(LOCALES).forEach((code) => {
    const btn = document.createElement('button');
    btn.className = `lang-btn ${code === lang ? 'active' : ''}`;
    btn.title = LOCALES[code].name;
    const img = document.createElement('img');
    img.src = `flags/${code}.svg`;
    img.alt = LOCALES[code].name;
    img.className = 'lang-flag';
    btn.appendChild(img);
    btn.onclick = () => {
      lang = code;
      localStorage.setItem('czt_lang', code);
      window.api.config.setLang(code);
      applyLang();
    };
    box.appendChild(btn);
  });
}

/* ---------- yardimcilar ---------- */
function dateLocale() {
  const map = { tr: 'tr-TR', ru: 'ru-RU', en: 'en-GB' };
  return map[lang] || 'en-GB';
}

function toast(title, body, type = 'ok', notify = false) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div class="toast-title"></div><div class="toast-body"></div>`;
  el.querySelector('.toast-title').textContent = title;
  el.querySelector('.toast-body').textContent = body || '';
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
  if (notify) window.api.app.notify(title, body || '');
}

async function call(promise, errTitle = t('toast.error')) {
  const res = await promise;
  if (!res || res.success === false) {
    toast(errTitle, (res && res.error) || t('toast.unknown'), 'err', true);
    return null;
  }
  return res.result;
}

function pill(text, cls) {
  return `<span class="pill ${cls}">${text}</span>`;
}

function parseService(service) {
  const match = String(service || '').match(/^(https?|tcp|ssh|rdp):\/\/([^:]+):(\d+)\/?$/i);
  if (!match) return { proto: 'http', host: '', port: '' };
  return { proto: match[1].toLowerCase(), host: match[2], port: match[3] };
}

function buildService(proto, host, port) {
  if (!host || !port) return '';
  return `${proto}://${host}:${port}`;
}

function buildPublicHostname(sub, zone) {
  const z = String(zone || '').trim().replace(/\.$/, '');
  let s = String(sub || '').trim().replace(/\.$/, '');
  if (s === '@') s = '';
  if (!z && !s) return '';
  if (!s) return z;
  if (!z) return s.includes('.') ? s : '';
  const zl = z.toLowerCase();
  const sl = s.toLowerCase();
  if (sl === zl || sl.endsWith('.' + zl)) return s;
  return `${s}.${z}`;
}

function zoneForHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return (state.zones || [])
    .filter((z) => {
      const n = String(z.name || '').toLowerCase();
      return host === n || host.endsWith('.' + n);
    })
    .sort((a, b) => b.name.length - a.name.length)[0] || null;
}

function updateServicePreview() {
  const preview = $('#in-service-preview');
  if (preview) {
    const svc = buildService($('#in-proto').value, $('#in-host').value.trim(), $('#in-port').value);
    preview.textContent = svc || '-';
  }
  const hostPrev = $('#in-hostname-preview');
  if (hostPrev) {
    const hostname = buildPublicHostname(
      $('#in-sub') ? $('#in-sub').value : '',
      $('#in-zone') ? $('#in-zone').value : ''
    );
    hostPrev.textContent = hostname || '-';
  }
}

async function confirmDelete(message, confirmText) {
  if (!Swal || typeof Swal.fire !== 'function') return window.confirm(message);
  const result = await Swal.fire({
    title: message,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d64545',
    cancelButtonColor: '#8b93a7',
    confirmButtonText: confirmText || t('swal.yesDelete'),
    cancelButtonText: t('swal.cancel'),
    reverseButtons: true,
    focusCancel: true,
    customClass: { popup: 'swal-czt' }
  });
  return result.isConfirmed;
}

function select2Lang() {
  return {
    noResults: () => t('select.noResults'),
    searching: () => t('select.searching')
  };
}

function tunnelIconSvg() {
  return '<svg class="tb-tn-ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1.5 12.5V8a6.5 6.5 0 1 1 13 0v4.5h-2V8a4.5 4.5 0 1 0-9 0v4.5h-2zm1.25 1h2.1v2h-2.1v-2zm8.4 0h2.1v2h-2.1v-2z"/></svg>';
}

function formatTunnelChoice(data) {
  if (!data.id) return data.text;
  const wrap = document.createElement('span');
  wrap.className = 'tb-tn-opt';
  wrap.innerHTML = tunnelIconSvg();
  const label = document.createElement('span');
  label.textContent = data.text;
  wrap.appendChild(label);
  return wrap;
}

function bindSelect2(el, opts) {
  const node = typeof el === 'string' ? $(el) : el;
  if (!node || typeof jQuery === 'undefined') return;
  const $el = jQuery(node);
  if ($el.hasClass('select2-hidden-accessible')) $el.select2('destroy');
  $el.select2(Object.assign({
    width: '100%',
    minimumResultsForSearch: 8,
    language: select2Lang()
  }, opts || {}));
}

function initFormSelects() {
  bindSelect2('#in-zone');
  bindSelect2('#in-proto', { minimumResultsForSearch: Infinity });
  bindSelect2('#dns-zone');
  bindSelect2('#dns-type', { minimumResultsForSearch: Infinity });
  const modal = jQuery('#edit-modal');
  bindSelect2('#edit-zone', { dropdownParent: modal });
  bindSelect2('#edit-proto', { minimumResultsForSearch: Infinity, dropdownParent: modal });
  const dnsModal = jQuery('#dns-edit-modal');
  bindSelect2('#dns-edit-type', { minimumResultsForSearch: Infinity, dropdownParent: dnsModal });
  bindSelect2('#audit-source', { minimumResultsForSearch: Infinity });
}

function setSelectValue(id, value) {
  const el = $('#' + id);
  if (!el) return;
  el.value = value;
  if (typeof jQuery !== 'undefined') jQuery(el).trigger('change');
}

function validIpOrCidr(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d|[12]\d|3[0-2]))?$/);
  if (!m) return false;
  return [m[1], m[2], m[3], m[4]].every((p) => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

/* ---------- pencere kontrolleri ---------- */
$('#btn-min').onclick = () => window.api.window.minimize();
$('#btn-max').onclick = () => window.api.window.maximize();
$('#btn-close').onclick = () => window.api.window.close();

/* ---------- sekmeler / ilerleme cubugu ---------- */
function showPageProgress() {
  const bar = $('#page-progress-bar') || $('#page-progress .page-progress-bar');
  if (!bar) return;
  bar.classList.remove('active');
  void bar.offsetWidth;
  bar.classList.add('active');
  setTimeout(() => bar.classList.remove('active'), 600);
}

const SK_WIDTHS = ['w70', 'w55', 'w85', 'w40', 'w70', 'w55', 'w85'];

function cardLoading(fromEl, on) {
  const card = fromEl && fromEl.closest ? fromEl.closest('.card') : null;
  if (card) card.classList.toggle('card-loading', Boolean(on));
}

function showTableSkeleton(tbody, cols, rows) {
  if (!tbody) return;
  cardLoading(tbody, true);
  const n = rows || 5;
  const c = cols || 5;
  tbody.innerHTML = Array.from({ length: n }, () => {
    const tds = Array.from({ length: c }, (_, i) => `<td><div class="sk ${SK_WIDTHS[i % SK_WIDTHS.length]}"></div></td>`).join('');
    return `<tr class="sk-row">${tds}</tr>`;
  }).join('');
}

function showListSkeleton(box, rows) {
  if (!box) return;
  cardLoading(box, true);
  const n = rows || 4;
  box.innerHTML = Array.from({ length: n }, () => '<div class="sk-list"><div class="sk"></div><div class="sk"></div></div>').join('');
}

function skText(el, width) {
  if (!el) return;
  el.innerHTML = `<span class="sk ${width || 'w70'}"></span>`;
}

$$('.nav-item').forEach((btn) => {
  btn.onclick = () => activateTab(btn.dataset.tab);
});

$$('.nav-group-toggle').forEach((btn) => {
  btn.onclick = (e) => {
    e.preventDefault();
    btn.closest('.nav-group').classList.toggle('open');
  };
});

function activateTab(tab) {
  if (!tab || !$(`#tab-${tab}`)) return;
  showPageProgress();
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab').forEach((el) => el.classList.toggle('active', el.id === `tab-${tab}`));
  try { sessionStorage.setItem('czt_last_tab', tab); } catch (e) {}
  if (tab === 'hostnames') loadHosts();
  if (tab === 'keys') loadKeys();
  if (tab === 'security') {
    fillSecurityForm();
    renderWhitelist();
  }
  if (tab === 'audit') loadAudit();
  if (tab === 'dashboard') loadStatus();
  if (tab === 'ingress') loadIngress();
  if (tab === 'zones') loadZonesPage();
  if (tab === 'dns') loadDnsPage();
  if (tab === 'tunnels') loadTunnelsPage();
  if (tab === 'server') renderServer(state.server);
}

/* ---------- ayarlar ---------- */
function isConfigured(cfg) {
  return Boolean(cfg && cfg.hasToken && cfg.accountId && cfg.tunnelId);
}

async function loadConfig() {
  // config:get {success, result} sarmaliyla doner; acilmadigi icin alanlar bos kaliyordu.
  const res = await window.api.config.get();
  const cfg = res && res.success ? res.result : (res || {});
  state.config = cfg;
  // ONEMLI: maskeli token asla input'a yazilmaz; aksi halde kaydedince
  // Cloudflare "1000: Invalid API Token" dondururdu.
  $('#cfg-token').value = '';
  $('#cfg-token-state').textContent = cfg.hasToken
    ? t('set.tokenSaved', { m: cfg.tokenMask })
    : t('set.tokenEmpty');
  $('#cfg-account').value = cfg.accountId || '';
  $('#cfg-tunnel').value = cfg.tunnelId || '';
  $('#cfg-service').value = cfg.defaultService || 'http://localhost:8080';
  $('#sv-host').value = cfg.serverHost || '127.0.0.1';
  $('#sv-port').value = cfg.serverPort || 7000;
  $('#sv-autostart').checked = Boolean(cfg.autoStartServer);
  state.whitelist = Array.isArray(cfg.ipWhitelist) ? cfg.ipWhitelist.slice() : [];
  const parsed = parseService(cfg.defaultService || 'http://localhost:8080');
  setSelectValue('in-proto', parsed.proto);
  $('#in-host').value = parsed.host;
  $('#in-port').value = parsed.port;
  fillAccountCard(null);
  updateNavTunnelLabel();
  updateServicePreview();
  renderWhitelist();
  fillSecurityForm();
  await loadTokenHistory();
}

function settingsPatch() {
  const patch = {
    accountId: $('#cfg-account').value.trim(),
    tunnelId: $('#cfg-tunnel').value.trim(),
    defaultService: $('#cfg-service').value.trim() || 'http://localhost:8080'
  };
  const token = $('#cfg-token').value.trim();
  if (token) patch.apiToken = token;
  return patch;
}

// Kaydedilmemis alanlarla da calisabilmek icin gecici override
function settingsOverrides() {
  const o = {};
  const token = $('#cfg-token').value.trim();
  if (token) o.apiToken = token;
  const account = $('#cfg-account').value.trim();
  if (account) o.accountId = account;
  const tunnel = $('#cfg-tunnel').value.trim();
  if (tunnel) o.tunnelId = tunnel;
  return o;
}

$('#btn-save-config').onclick = async () => {
  const res = await call(window.api.config.save(settingsPatch()), t('toast.configSaveFail'));
  if (res) {
    toast(t('toast.saved'), t('toast.savedBody'), 'ok');
    await loadConfig();
    await loadStatus();
  }
};

$('#btn-test').onclick = async () => {
  const s = await call(window.api.cf.status(settingsOverrides()), t('toast.connFail'));
  if (s) {
    toast(t('toast.connOk'), t('toast.connBody', { t: s.token ? s.token.status : '-', n: s.tunnel ? s.tunnel.name : '-' }), 'ok', true);
    renderStatus(s);
  }
};

/* ---------- secici listeler ---------- */
function renderPicker(box, items, onPick, emptyKey, currentValue) {
  box.innerHTML = '';
  if (!items.length) {
    box.innerHTML = `<div class="muted small">${t(emptyKey)}</div>`;
    return;
  }
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = `list-item${currentValue && currentValue === item.id ? ' current' : ''}`;
    const info = document.createElement('span');
    const name = document.createElement('b');
    name.textContent = item.name;
    const sub = document.createElement('span');
    sub.className = 'muted small';
    sub.textContent = item.id + (item.status ? ` · ${item.status}` : '');
    info.append(name, document.createElement('br'), sub);
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.textContent = t('set.select');
    btn.onclick = () => onPick(item);
    row.append(info, btn);
    box.appendChild(row);
  });
}

async function fillPicker(boxId, loader, overrides, onPick, emptyKey, failKey, currentValue) {
  const box = $('#' + boxId);
  box.innerHTML = `<div class="muted small">${t('test.running')}</div>`;
  const items = await call(loader(overrides), t(failKey));
  if (!items) {
    box.innerHTML = `<div class="muted small">${t(failKey)}</div>`;
    return null;
  }
  renderPicker(box, items, onPick, emptyKey, currentValue);
  return items;
}

$('#btn-load-accounts').onclick = () =>
  fillPicker('cfg-account-picker', window.api.cf.accounts, settingsOverrides(), (acc) => {
    $('#cfg-account').value = acc.id;
    toast(t('set.accountSelected'), acc.name, 'ok');
  }, 'set.noAccount', 'toast.accountsFail', $('#cfg-account').value.trim());

function isTunnelHealthy(tn) {
  return String((tn && tn.status) || '').toLowerCase() === 'healthy';
}

function partitionTunnels(list) {
  const all = Array.isArray(list) ? list : [];
  return {
    live: all.filter(isTunnelHealthy),
    down: all.filter((tn) => !isTunnelHealthy(tn))
  };
}

async function loadHealthyTunnels(overrides) {
  const res = await window.api.cf.tunnels(overrides);
  if (!res || res.success === false) return res;
  return { success: true, result: partitionTunnels(res.result).live };
}

$('#btn-load-tunnels').onclick = () =>
  fillPicker('cfg-tunnel-picker', loadHealthyTunnels, settingsOverrides(), (tn) => {
    $('#cfg-tunnel').value = tn.id;
    toast(t('set.tunnelSelected'), tn.name, 'ok');
  }, 'set.noTunnel', 'toast.tunnelsFail', $('#cfg-tunnel').value.trim());

/* ---------- token gecmisi ---------- */
async function loadTokenHistory() {
  const list = await window.api.tokens.list();
  state.tokens = (list && list.success && Array.isArray(list.result)) ? list.result : [];
  [['#token-history', true], ['#ob-token-history', false]].forEach(([sel, showDelete]) => {
    const box = $(sel);
    if (!box) return;
    box.innerHTML = '';
    if (!state.tokens.length) {
      box.innerHTML = `<div class="muted small">${t('set.noTokenHistory')}</div>`;
      return;
    }
    const title = document.createElement('div');
    title.className = 'muted small';
    title.textContent = t('set.tokenHistory');
    box.appendChild(title);
    state.tokens.forEach((entry) => {
      const row = document.createElement('div');
      row.className = `list-item token-item${state.config.tokenMask && state.config.tokenMask === entry.mask ? ' current' : ''}`;
      const main = document.createElement('span');
      main.className = 'token-main';
      const b = document.createElement('b');
      b.textContent = entry.label;
      const mask = document.createElement('span');
      mask.className = 'token-mask';
      mask.textContent = `${entry.mask} · ${new Date(entry.lastUsedAt).toLocaleDateString(dateLocale())}`;
      main.append(b, mask);
      const use = document.createElement('button');
      use.className = 'btn btn-sm';
      use.textContent = t('set.useToken');
      use.onclick = async () => {
        const res = await call(window.api.tokens.use(entry.id), t('toast.configSaveFail'));
        if (res) {
          toast(t('toast.saved'), entry.label, 'ok');
          await loadConfig();
          await loadStatus();
        }
      };
      row.append(main, use);
      if (showDelete) {
        const del = document.createElement('button');
        del.className = 'btn btn-sm btn-danger';
        del.textContent = t('key.delete');
        del.onclick = async () => {
          if (!(await confirmDelete(t('set.confirmTokenDelete')))) return;
          await call(window.api.tokens.remove(entry.id), t('toast.delFail'));
          await loadTokenHistory();
        };
        row.appendChild(del);
      }
      box.appendChild(row);
    });
  });
}

/* ---------- panel ---------- */
function updateNavTunnelLabel(name) {
  const el = $('#nav-tunnel-label');
  if (!el) return;
  el.textContent = name || (state.config.tunnelId ? state.config.tunnelId.slice(0, 8) + '…' : t('tb.noTunnel'));
}

function fillAccountCard(s) {
  const cfg = state.config || {};
  const setTxt = (id, val) => {
    const el = $('#' + id);
    if (el) el.textContent = val || '-';
  };
  if (s && s.accountName) state.accountName = s.accountName;
  setTxt('st-account-name', (s && s.accountName) || state.accountName);
  setTxt('st-account', (s && s.accountId) || cfg.accountId);
  setTxt('st-tunnelid', (s && s.tunnelId) || cfg.tunnelId);
  setTxt('st-service', (s && s.defaultService) || cfg.defaultService);
  const running = state.server && state.server.running;
  setTxt('st-api', running ? `http://${state.server.host}:${state.server.port}` : t('srv.stopped'));
  cardLoading($('#st-account'), false);
}

function renderStatus(s) {
  $('#st-token').textContent = s.token ? s.token.status : t('dash.undefined');
  $('#st-tunnel').textContent = s.tunnel ? s.tunnel.name : '-';
  $('#st-conn').textContent = s.tunnel ? t('dash.connActive', { n: s.tunnel.connections }) : '-';
  updateNavTunnelLabel(s.tunnel ? s.tunnel.name : '');
  fillAccountCard(s);
}

function fillTunnelSelect(tunnels) {
  const sel = $('#tb-tunnel-select');
  if (!sel) return;
  const current = (state.config && state.config.tunnelId) || '';
  ignoreTunnelChange = true;
  sel.innerHTML = '';
  const all = Array.isArray(tunnels) ? tunnels : [];
  const live = partitionTunnels(all).live;
  const currentTn = all.find((tn) => tn.id === current);
  const list = live.slice();
  if (currentTn && !list.some((tn) => tn.id === current)) list.unshift(currentTn);
  if (!list.length) {
    const opt = document.createElement('option');
    opt.value = current;
    opt.textContent = current ? t('tb.tunnel', { v: current.slice(0, 8) + '…' }) : t('tb.noTunnel');
    sel.appendChild(opt);
  } else {
    list.forEach((tn) => {
      const opt = document.createElement('option');
      opt.value = tn.id;
      opt.textContent = isTunnelHealthy(tn) ? tn.name : `${tn.name} (${tn.status || t('tunnels.closed')})`;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  }
  bindSelect2(sel, {
    width: '160px',
    minimumResultsForSearch: 0,
    dropdownCssClass: 'tb-tunnel-drop',
    dropdownParent: typeof jQuery !== 'undefined' ? jQuery(document.body) : undefined,
    templateResult: formatTunnelChoice,
    templateSelection: formatTunnelChoice
  });
  jQuery(sel).off('select2:open.tb').on('select2:open.tb', () => {
    setTimeout(() => {
      const field = document.querySelector('.tb-tunnel-drop .select2-search__field');
      if (field) {
        field.placeholder = t('select.search');
        field.focus();
      }
    }, 0);
  });
  ignoreTunnelChange = false;
}

function tabActive(name) {
  const el = $('#tab-' + name);
  return Boolean(el && el.classList.contains('active'));
}

async function switchTunnel(id, name) {
  if (!id || id === state.config.tunnelId) return;
  const tn = (state.tunnels || []).find((x) => x.id === id);
  if (tn && !isTunnelHealthy(tn)) {
    toast(t('toast.invalid'), t('toast.tunnelNotHealthy'), 'warn');
    fillTunnelSelect(state.tunnels);
    return;
  }
  if (tabActive('hostnames')) showTableSkeleton($('#host-rows'), 5, 6);
  if (tabActive('ingress')) {
    showTableSkeleton($('#ingress-rows'), 4, 5);
    skText($('#ingress-tunnel'), 'w55');
    skText($('#ingress-tunnelid'), 'w70');
    cardLoading($('#ingress-tunnel'), true);
  }
  const res = await call(window.api.config.save({ tunnelId: id }, { silent: true }), t('toast.configSaveFail'));
  if (!res) {
    if (tabActive('hostnames')) renderHosts();
    if (tabActive('ingress')) await loadIngress();
    return;
  }
  state.config.tunnelId = id;
  $('#cfg-tunnel').value = id;
  $('#st-tunnelid').textContent = id;
  state.hosts = [];
  toast(t('set.tunnelSelected'), name || id, 'ok');
  updateNavTunnelLabel(name || id);
  const jobs = [loadStatus(), loadHosts()];
  if (tabActive('ingress')) jobs.push(loadIngress());
  if (tabActive('tunnels')) jobs.push(loadTunnelsPage());
  await Promise.all(jobs);
}

function renderStatusFromConfig() {
  $('#st-token').textContent = state.config.hasToken ? 'active' : t('dash.undefined');
  fillAccountCard(null);
}

async function loadStatus() {
  if (!isConfigured(state.config)) {
    $('#tunnel-list').innerHTML = `<div class="muted small">${t('test.notConfigured')}</div>`;
    renderStatusFromConfig();
    fillTunnelSelect([]);
    const downBtn = $('#btn-dash-down-tunnels');
    if (downBtn) {
      downBtn.classList.add('hidden');
      downBtn.onclick = null;
    }
    return;
  }
  showListSkeleton($('#tunnel-list'), 4);
  ['st-token', 'st-tunnel', 'st-conn', 'st-hosts'].forEach((id) => skText($('#' + id), 'w55'));
  ['st-account-name', 'st-account', 'st-tunnelid', 'st-service', 'st-api'].forEach((id) => skText($('#' + id), 'w70'));
  const accCard = $('#st-account') && $('#st-account').closest('.card');
  if (accCard) accCard.classList.add('card-loading');
  const s = await call(window.api.cf.status(), t('toast.statusFail'));
  if (s) renderStatus(s);
  else fillAccountCard(null);
  const tunnels = await window.api.cf.tunnels();
  const box = $('#tunnel-list');
  if (tunnels && tunnels.success && tunnels.result.length) {
    state.tunnels = tunnels.result;
    fillTunnelSelect(state.tunnels);
    const { live, down } = partitionTunnels(state.tunnels);
    box.innerHTML = '';
    if (!live.length) {
      box.innerHTML = `<div class="muted small">${t('tunnels.noneLive')}</div>`;
    }
    live.forEach((tn) => {
      const row = document.createElement('div');
      row.className = `list-item${tn.id === state.config.tunnelId ? ' current' : ''}`;
      const info = document.createElement('span');
      const name = document.createElement('b');
      name.textContent = tn.name;
      const sub = document.createElement('span');
      sub.className = 'muted small';
      sub.textContent = tn.id;
      info.append(name, document.createElement('br'), sub);
      row.appendChild(info);
      if (tn.id !== state.config.tunnelId) {
        const use = document.createElement('button');
        use.className = 'btn btn-sm';
        use.textContent = t('dash.useTunnel');
        use.onclick = () => switchTunnel(tn.id, tn.name);
        row.appendChild(use);
      }
      row.insertAdjacentHTML('beforeend', pill(t('tunnels.healthy'), 'pill-on'));
      box.appendChild(row);
    });
    const downBtn = $('#btn-dash-down-tunnels');
    if (downBtn) {
      if (down.length) {
        downBtn.classList.remove('hidden');
        downBtn.textContent = t('dash.downTunnels', { n: down.length });
        downBtn.onclick = () => {
          activateTab('tunnels');
          setTimeout(() => {
            const card = $('#tunnel-down-card');
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 80);
        };
      } else {
        downBtn.classList.add('hidden');
        downBtn.onclick = null;
      }
    }
  } else {
    state.tunnels = [];
    fillTunnelSelect([]);
    box.innerHTML = `<div class="muted small">${t('toast.tunnelsEmpty')}</div>`;
    const downBtn = $('#btn-dash-down-tunnels');
    if (downBtn) {
      downBtn.classList.add('hidden');
      downBtn.onclick = null;
    }
  }
  const hosts = await window.api.cf.list();
  if (hosts && hosts.success) {
    $('#st-hosts').textContent = `${hosts.result.filter((h) => h.enabled).length} / ${hosts.result.length}`;
  }
  fillAccountCard(s);
  cardLoading($('#tunnel-list'), false);
  cardLoading($('#st-account'), false);
}
$('#btn-refresh-status').onclick = loadStatus;

/* ---------- subdomainler ---------- */
async function loadZones() {
  const zones = await window.api.cf.zones();
  if (zones && zones.success) state.zones = zones.result;
  ['in-zone', 'edit-zone'].forEach((id) => {
    const sel = $('#' + id);
    if (!sel) return;
    sel.innerHTML = '';
    if (zones && zones.success) {
      zones.result.forEach((z) => {
        const opt = document.createElement('option');
        opt.value = z.name;
        opt.textContent = z.name;
        sel.appendChild(opt);
      });
    }
    if (!sel.options.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Zone bulunamadi';
      sel.appendChild(opt);
    }
  });
  initFormSelects();
  updateServicePreview();
}

function renderHosts() {
  const filter = $('#in-filter').value.trim().toLowerCase();
  const rows = state.hosts.filter((h) => !filter || h.hostname.toLowerCase().includes(filter));
  const tbody = $('#host-rows');
  cardLoading(tbody, false);
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">${t('host.none')}</td></tr>`;
    return;
  }
  rows.forEach((h) => {
    const parsed = parseService(h.service);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${pill(h.enabled ? t('host.on') : t('host.off'), h.enabled ? 'pill-on' : 'pill-off')}</td>
      <td><b>${h.hostname}</b></td>
      <td><code class="proto-badge">${parsed.proto || '-'}</code></td>
      <td>${h.service || '-'}</td>`;
    const td = document.createElement('td');
    td.className = 'right';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm btn-ghost';
    editBtn.textContent = t('host.edit');
    editBtn.onclick = () => openEditHost(h);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-sm';
    toggleBtn.textContent = h.enabled ? t('host.disable') : t('host.enable');
    toggleBtn.onclick = async () => {
      toggleBtn.disabled = true;
      const fn = h.enabled ? window.api.cf.disable : window.api.cf.enable;
      const res = await call(fn(h.hostname), t('toast.opFail'));
      if (res) toast(h.enabled ? t('toast.disabled') : t('toast.enabled'), h.hostname, 'ok');
      await loadHosts();
    };

    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn-sm btn-ghost';
    openBtn.textContent = t('host.openExt');
    openBtn.onclick = () => window.api.app.openExternal(`https://${h.hostname}`);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-sm btn-danger';
    delBtn.textContent = t('host.delete');
    delBtn.onclick = async () => {
      if (!(await confirmDelete(t('host.confirmDelete', { h: h.hostname })))) return;
      delBtn.disabled = true;
      const res = await call(window.api.cf.remove(h.hostname), t('toast.delFail'));
      if (res) toast(t('toast.deleted'), h.hostname, 'warn');
      await loadHosts();
    };

    td.append(editBtn, toggleBtn, openBtn, delBtn);
    tr.appendChild(td);
    tbody.appendChild(tr);
  });
}

function openModal(modal) {
  modal.classList.remove('hidden', 'closing');
  requestAnimationFrame(() => modal.classList.add('is-open'));
}

function closeModal(modal) {
  modal.classList.remove('is-open');
  modal.classList.add('closing');
  setTimeout(() => modal.classList.add('hidden'), 220);
}

function openEditHost(h) {
  const parsed = parseService(h.service);
  const zone = zoneForHostname(h.hostname);
  const host = String(h.hostname || '');
  const sub = zone && host.toLowerCase() === zone.name.toLowerCase()
    ? ''
    : (zone ? host.slice(0, -(zone.name.length + 1)) : host);
  $('#edit-old').value = h.hostname;
  $('#edit-sub').value = sub;
  setSelectValue('edit-zone', zone ? zone.name : (state.zones[0] && state.zones[0].name) || '');
  setSelectValue('edit-proto', parsed.proto || 'http');
  $('#edit-host').value = parsed.host || '';
  $('#edit-port').value = parsed.port || '';
  $('#edit-path').value = h.path || '';
  $('#edit-notls').checked = h.originRequest && h.originRequest.noTLSVerify;
  openModal($('#edit-modal'));
}

function closeEditModal() {
  closeModal($('#edit-modal'));
}

$('#edit-cancel').onclick = closeEditModal;
$('#edit-save').onclick = async () => {
  const old = $('#edit-old').value;
  const zone = $('#edit-zone').value;
  if (!zone) return toast(t('toast.missing'), t('toast.zoneRequired'), 'warn');
  const hostname = buildPublicHostname($('#edit-sub').value, zone);
  if (!hostname || !hostname.includes('.')) return toast(t('toast.invalid'), t('toast.invalidHost'), 'warn');
  const svc = buildService($('#edit-proto').value, $('#edit-host').value.trim(), $('#edit-port').value);
  if (!svc) return toast(t('toast.invalid'), t('host.service'), 'warn');
  const path = $('#edit-path').value.trim() || null;
  const noTLSVerify = $('#edit-notls').checked;
  $('#edit-save').disabled = true;
  const res = await call(window.api.cf.update(old, { hostname, service: svc, path, noTLSVerify }), t('toast.updateFail'));
  $('#edit-save').disabled = false;
  if (res) {
    toast(t('toast.updated'), t('toast.updatedBody', { h: res.hostname, s: res.service }), 'ok');
    closeEditModal();
    await loadHosts();
  }
};

[$('#in-proto'), $('#in-host'), $('#in-port'), $('#in-sub')].forEach((el) => {
  if (el) {
    el.addEventListener('input', updateServicePreview);
    el.addEventListener('change', updateServicePreview);
  }
});

async function loadHosts() {
  showTableSkeleton($('#host-rows'), 5, 6);
  if (!state.zones.length) await loadZones();
  const items = await call(window.api.cf.list(), t('toast.statusFail'));
  state.hosts = items || [];
  renderHosts();
}
$('#btn-refresh-hosts').onclick = loadHosts;
$('#in-filter').oninput = renderHosts;

/* ---------- tunel yapilandirmasi / domain / dns / tuneller ---------- */
async function loadIngress() {
  const nameEl = $('#ingress-tunnel');
  const idEl = $('#ingress-tunnelid');
  const tbody = $('#ingress-rows');
  if (!tbody) return;
  skText(nameEl, 'w55');
  skText(idEl, 'w70');
  cardLoading(nameEl, true);
  showTableSkeleton(tbody, 4, 5);
  const cfg = await call(window.api.cf.tunnelConfig(), t('toast.statusFail'));
  cardLoading(tbody, false);
  cardLoading(nameEl, false);
  const tn = (state.tunnels || []).find((x) => x.id === (state.config && state.config.tunnelId));
  if (nameEl) nameEl.textContent = (tn && tn.name) || ($('#st-tunnel') && $('#st-tunnel').textContent) || '-';
  if (idEl) idEl.textContent = (state.config && state.config.tunnelId) || '-';
  if (!cfg) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">${t('ingress.none')}</td></tr>`;
    return;
  }
  const ingress = Array.isArray(cfg.ingress) ? cfg.ingress : [];
  tbody.innerHTML = '';
  if (!ingress.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">${t('ingress.none')}</td></tr>`;
    return;
  }
  ingress.forEach((rule) => {
    const parsed = parseService(rule.service);
    const tr = document.createElement('tr');
    const host = rule.hostname || t('ingress.fallback');
    tr.innerHTML = `<td><b></b></td><td></td><td></td><td></td>`;
    tr.children[0].querySelector('b').textContent = host;
    tr.children[1].textContent = rule.path || '/';
    tr.children[2].textContent = rule.service || '-';
    tr.children[3].innerHTML = `<code class="proto-badge">${parsed.proto || '-'}</code>`;
    tbody.appendChild(tr);
  });
}

function renderZonesPage() {
  const filter = ($('#in-zone-filter') && $('#in-zone-filter').value.trim().toLowerCase()) || '';
  const tbody = $('#zone-rows');
  if (!tbody) return;
  cardLoading(tbody, false);
  const rows = (state.cfZones || []).filter((z) => !filter || z.name.toLowerCase().includes(filter));
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">${t('zones.none')}</td></tr>`;
    return;
  }
  rows.forEach((z) => {
    const tr = document.createElement('tr');
    const ns = (z.nameServers || []).slice(0, 2).join(', ');
    tr.innerHTML = `<td><b></b></td><td></td><td></td><td class="muted small"></td>`;
    tr.children[0].querySelector('b').textContent = z.name;
    tr.children[1].innerHTML = pill(z.status || '-', z.status === 'active' ? 'pill-on' : 'pill-muted');
    tr.children[2].textContent = z.plan || '-';
    tr.children[3].textContent = ns || '-';
    const td = document.createElement('td');
    td.className = 'right';
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.textContent = t('zones.viewDns');
    btn.onclick = () => openDnsForZone(z.id);
    td.appendChild(btn);
    tr.appendChild(td);
    tbody.appendChild(tr);
  });
}

async function loadZonesPage() {
  showTableSkeleton($('#zone-rows'), 5, 6);
  const zones = await call(window.api.cf.zones(), t('toast.statusFail'));
  state.cfZones = zones || [];
  renderZonesPage();
  fillDnsZoneSelect();
}

function fillZoneSelect(selectId, currentId) {
  const sel = $(selectId);
  if (!sel) return;
  const current = currentId || sel.value;
  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = t('dns.selectZone');
  sel.appendChild(opt0);
  (state.cfZones || []).forEach((z) => {
    const opt = document.createElement('option');
    opt.value = z.id;
    opt.textContent = z.name;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
  bindSelect2(selectId);
}

function fillDnsZoneSelect() {
  fillZoneSelect('#dns-zone', state.dnsZoneId);
}

function dnsCanProxy(type) {
  return ['A', 'AAAA', 'CNAME'].includes(String(type || '').toUpperCase());
}

function dnsNeedsPriority(type) {
  return ['MX', 'SRV'].includes(String(type || '').toUpperCase());
}

function syncDnsTypeUi() {
  const type = ($('#dns-type') && $('#dns-type').value) || 'A';
  const wrap = $('#dns-priority-wrap');
  const proxied = $('#dns-proxied');
  if (wrap) wrap.classList.toggle('hidden', !dnsNeedsPriority(type));
  if (proxied) {
    proxied.disabled = !dnsCanProxy(type);
    if (!dnsCanProxy(type)) proxied.checked = false;
  }
  const editType = ($('#dns-edit-type') && $('#dns-edit-type').value) || type;
  const editWrap = $('#dns-edit-priority-wrap');
  const editProxied = $('#dns-edit-proxied');
  if (editWrap) editWrap.classList.toggle('hidden', !dnsNeedsPriority(editType));
  if (editProxied) {
    editProxied.disabled = !dnsCanProxy(editType);
    if (!dnsCanProxy(editType)) editProxied.checked = false;
  }
}

function dnsPayloadFrom(prefix) {
  const type = ($(`#${prefix}-type`) && $(`#${prefix}-type`).value) || 'A';
  return {
    type,
    name: ($(`#${prefix}-name`) && $(`#${prefix}-name`).value.trim()) || '',
    content: ($(`#${prefix}-content`) && $(`#${prefix}-content`).value.trim()) || '',
    ttl: ($(`#${prefix}-ttl`) && $(`#${prefix}-ttl`).value) || 1,
    priority: ($(`#${prefix}-priority`) && $(`#${prefix}-priority`).value) || '',
    proxied: Boolean($(`#${prefix}-proxied`) && $(`#${prefix}-proxied`).checked),
    comment: ($(`#${prefix}-comment`) && $(`#${prefix}-comment`).value.trim()) || ''
  };
}

function renderDnsRows() {
  const filter = ($('#in-dns-filter') && $('#in-dns-filter').value.trim().toLowerCase()) || '';
  const tbody = $('#dns-rows');
  if (!tbody) return;
  cardLoading(tbody, false);
  const rows = (state.dnsRecords || []).filter((r) => {
    if (!filter) return true;
    return [r.type, r.name, r.content, r.comment].join(' ').toLowerCase().includes(filter);
  });
  tbody.innerHTML = '';
  if (!state.dnsZoneId) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">${t('dns.selectZone')}</td></tr>`;
    return;
  }
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">${t('dns.none')}</td></tr>`;
    return;
  }
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    const ttl = r.ttl === 1 ? t('dns.auto') : String(r.ttl || '-');
    const typeCls = `dns-type dns-type-${String(r.type || '').toLowerCase()}`;
    tr.innerHTML = `<td><code class="${typeCls}"></code></td><td></td><td></td><td></td><td></td><td class="muted small"></td>`;
    tr.children[0].querySelector('code').textContent = r.type || '-';
    tr.children[1].textContent = r.name || '-';
    tr.children[2].textContent = r.content || '-';
    tr.children[3].innerHTML = pill(r.proxied ? t('dns.proxied') : t('dns.dnsOnly'), r.proxied ? 'pill-on' : 'pill-muted');
    tr.children[4].textContent = ttl;
    tr.children[5].textContent = r.comment || '';
    const td = document.createElement('td');
    td.className = 'right';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm btn-ghost';
    editBtn.textContent = t('host.edit');
    editBtn.onclick = () => openEditDns(r);
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-sm btn-danger';
    delBtn.textContent = t('host.delete');
    delBtn.onclick = async () => {
      if (!(await confirmDelete(t('dns.confirmDelete', { n: r.name })))) return;
      delBtn.disabled = true;
      const res = await call(window.api.cf.dnsDelete(state.dnsZoneId, r.id), t('toast.delFail'));
      if (res) toast(t('toast.deleted'), r.name, 'warn');
      await loadDnsRecords();
    };
    td.append(editBtn, delBtn);
    tr.appendChild(td);
    tbody.appendChild(tr);
  });
}

async function loadDnsRecords() {
  const zoneId = ($('#dns-zone') && $('#dns-zone').value) || state.dnsZoneId;
  state.dnsZoneId = zoneId;
  const tbody = $('#dns-rows');
  if (!zoneId) {
    state.dnsRecords = [];
    renderDnsRows();
    return;
  }
  if (tbody) showTableSkeleton(tbody, 7, 6);
  const items = await call(window.api.cf.dnsRecords(zoneId), t('toast.statusFail'));
  state.dnsRecords = items || [];
  renderDnsRows();
}

async function ensureZones() {
  if (state.cfZones && state.cfZones.length) return state.cfZones;
  const zones = await call(window.api.cf.zones(), t('toast.statusFail'));
  state.cfZones = zones || [];
  return state.cfZones;
}

async function loadDnsPage() {
  await ensureZones();
  fillDnsZoneSelect();
  syncDnsTypeUi();
  if (state.dnsZoneId) await loadDnsRecords();
  else renderDnsRows();
}

function openDnsForZone(zoneId) {
  state.dnsZoneId = zoneId;
  activateTab('dns');
}

function openEditDns(r) {
  const modal = $('#dns-edit-modal');
  if (!modal) return;
  $('#dns-edit-id').value = r.id;
  setSelectValue('dns-edit-type', r.type || 'A');
  $('#dns-edit-name').value = r.name || '';
  $('#dns-edit-content').value = r.content || '';
  $('#dns-edit-ttl').value = r.ttl || 1;
  $('#dns-edit-priority').value = r.priority == null ? '' : r.priority;
  $('#dns-edit-comment').value = r.comment || '';
  $('#dns-edit-proxied').checked = Boolean(r.proxied);
  syncDnsTypeUi();
  openModal(modal);
}

async function createDnsRecord() {
  const zoneId = ($('#dns-zone') && $('#dns-zone').value) || state.dnsZoneId;
  const payload = dnsPayloadFrom('dns');
  if (!zoneId) return toast(t('toast.missing'), t('dns.selectZone'), 'warn');
  if (!payload.name || !payload.content) return toast(t('toast.missing'), t('dns.required'), 'warn');
  $('#btn-dns-create').disabled = true;
  const res = await call(window.api.cf.dnsCreate(zoneId, payload), t('toast.createFail'));
  $('#btn-dns-create').disabled = false;
  if (res) {
    toast(t('dns.created'), res.name || payload.name, 'ok');
    $('#dns-name').value = '';
    $('#dns-content').value = '';
    $('#dns-comment').value = '';
    await loadDnsRecords();
  }
}

async function saveEditDns() {
  const zoneId = state.dnsZoneId;
  const recordId = $('#dns-edit-id').value;
  const payload = dnsPayloadFrom('dns-edit');
  if (!zoneId || !recordId) return;
  if (!payload.name || !payload.content) return toast(t('toast.missing'), t('dns.required'), 'warn');
  $('#dns-edit-save').disabled = true;
  const res = await call(window.api.cf.dnsUpdate(zoneId, recordId, payload), t('toast.updateFail'));
  $('#dns-edit-save').disabled = false;
  if (res) {
    toast(t('dns.updated'), res.name || payload.name, 'ok');
    closeModal($('#dns-edit-modal'));
    await loadDnsRecords();
  }
}

function appendTunnelRow(tbody, tn, selectable) {
  const tr = document.createElement('tr');
  const created = tn.createdAt ? new Date(tn.createdAt).toLocaleString(dateLocale()) : '-';
  const healthy = isTunnelHealthy(tn);
  tr.className = tn.id === state.config.tunnelId ? 'current-row' : '';
  tr.innerHTML = `<td><b></b></td><td></td><td></td><td class="muted small"></td><td><code></code></td>`;
  tr.children[0].querySelector('b').textContent = tn.name;
  tr.children[1].innerHTML = pill(
    healthy ? t('tunnels.healthy') : (tn.status || t('tunnels.closed')),
    healthy ? 'pill-on' : 'pill-muted'
  );
  tr.children[2].textContent = String(tn.connections == null ? '-' : tn.connections);
  tr.children[3].textContent = created;
  tr.children[4].querySelector('code').textContent = tn.id;
  const td = document.createElement('td');
  td.className = 'right';
  const det = document.createElement('button');
  det.className = 'btn btn-sm btn-ghost';
  det.textContent = t('tunnels.details');
  det.onclick = () => openTunnelDetails(tn);
  td.appendChild(det);
  if (selectable) {
    if (tn.id === state.config.tunnelId) {
      const mark = document.createElement('span');
      mark.className = 'pill pill-on';
      mark.textContent = t('set.select');
      td.appendChild(mark);
    } else {
      const use = document.createElement('button');
      use.className = 'btn btn-sm';
      use.textContent = t('dash.useTunnel');
      use.onclick = () => switchTunnel(tn.id, tn.name);
      td.appendChild(use);
    }
  }
  tr.appendChild(td);
  tbody.appendChild(tr);
}

async function fetchTunnels() {
  const tunnels = await call(window.api.cf.tunnels(), t('toast.tunnelsFail'));
  if (tunnels) state.tunnels = tunnels;
  return tunnels;
}

async function loadTunnelsPage() {
  const liveBody = $('#tunnel-rows');
  const downBody = $('#tunnel-down-rows');
  if (!liveBody) return;
  showTableSkeleton(liveBody, 6, 5);
  if (downBody) showTableSkeleton(downBody, 6, 4);
  const tunnels = await fetchTunnels();
  cardLoading(liveBody, false);
  if (downBody) cardLoading(downBody, false);
  fillTunnelSelect(state.tunnels || []);
  const { live, down } = partitionTunnels(tunnels || []);
  liveBody.innerHTML = '';
  if (!live.length) {
    liveBody.innerHTML = `<tr><td colspan="6" class="muted">${t('tunnels.noneLive')}</td></tr>`;
  } else {
    live.forEach((tn) => appendTunnelRow(liveBody, tn, true));
  }
  if (downBody) {
    downBody.innerHTML = '';
    if (!down.length) {
      downBody.innerHTML = `<tr><td colspan="6" class="muted">${t('tunnels.noneDown')}</td></tr>`;
    } else {
      down.forEach((tn) => appendTunnelRow(downBody, tn, false));
    }
  }
}

let tunnelDetailId = '';

function kvRow(label, value) {
  const row = document.createElement('div');
  row.className = 'kv';
  const k = document.createElement('span');
  k.textContent = label;
  const v = document.createElement('b');
  v.textContent = value == null || value === '' ? '-' : String(value);
  row.append(k, v);
  return row;
}

async function openTunnelDetails(tn) {
  const modal = $('#tunnel-detail-modal');
  const body = $('#tunnel-detail-body');
  if (!modal || !body || !tn) return;
  tunnelDetailId = tn.id;
  body.innerHTML = Array.from({ length: 6 }, () => '<div class="sk-list"><div class="sk w55"></div><div class="sk w85"></div></div>').join('');
  openModal(modal);
  const detail = (await call(window.api.cf.tunnelGet(tn.id), t('toast.tunnelsFail'))) || tn;
  let cfg = null;
  try {
    const cfgRes = await window.api.cf.tunnelConfigFor(tn.id);
    if (cfgRes && cfgRes.success) cfg = cfgRes.result;
  } catch (e) { /* kapali tünelde config olmayabilir */ }

  body.innerHTML = '';
  body.appendChild(kvRow(t('tunnels.name'), detail.name || tn.name));
  body.appendChild(kvRow(
    t('tunnels.status'),
    isTunnelHealthy(detail) ? t('tunnels.healthy') : (detail.status || t('tunnels.closed'))
  ));
  body.appendChild(kvRow('ID', detail.id || tn.id));
  body.appendChild(kvRow(
    t('tunnels.created'),
    detail.createdAt ? new Date(detail.createdAt).toLocaleString(dateLocale()) : '-'
  ));
  body.appendChild(kvRow(t('tunnels.conn'), detail.connections == null ? '-' : detail.connections));
  if (detail.tunType) body.appendChild(kvRow(t('tunnels.type'), detail.tunType));
  if (detail.remoteConfig != null) {
    body.appendChild(kvRow(t('tunnels.remoteConfig'), detail.remoteConfig ? t('host.on') : t('host.off')));
  }

  const hosts = ((cfg && cfg.ingress) || []).map((r) => r.hostname).filter(Boolean);
  body.appendChild(kvRow(t('tunnels.hostnames'), hosts.length ? hosts.join(', ') : t('tunnels.noHosts')));

  const conns = detail.connectionList || [];
  const h = document.createElement('h3');
  h.className = 'mt-12';
  h.textContent = t('tunnels.conn');
  body.appendChild(h);
  if (!conns.length) {
    const empty = document.createElement('div');
    empty.className = 'muted small';
    empty.textContent = t('tunnels.noConn');
    body.appendChild(empty);
  } else {
    const table = document.createElement('table');
    table.className = 'table';
    table.innerHTML = `<thead><tr><th>${t('tunnels.colo')}</th><th>${t('tunnels.originIp')}</th><th>${t('tunnels.opened')}</th></tr></thead>`;
    const tb = document.createElement('tbody');
    conns.forEach((c) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td></td><td></td><td class="muted small"></td>`;
      tr.children[0].textContent = c.colo || '-';
      tr.children[1].textContent = c.originIp || '-';
      tr.children[2].textContent = c.openedAt ? new Date(c.openedAt).toLocaleString(dateLocale()) : '-';
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    body.appendChild(table);
  }
}

$('#btn-refresh-ingress').onclick = loadIngress;
$('#btn-refresh-zones').onclick = loadZonesPage;
$('#btn-refresh-dns').onclick = loadDnsRecords;
$('#btn-refresh-tunnels').onclick = loadTunnelsPage;
if ($('#in-zone-filter')) $('#in-zone-filter').oninput = renderZonesPage;
if ($('#in-dns-filter')) $('#in-dns-filter').oninput = renderDnsRows;
if ($('#btn-dns-create')) $('#btn-dns-create').onclick = createDnsRecord;
if ($('#dns-edit-cancel')) $('#dns-edit-cancel').onclick = () => closeModal($('#dns-edit-modal'));
if ($('#dns-edit-save')) $('#dns-edit-save').onclick = saveEditDns;
if ($('#dns-edit-modal')) {
  const dnsBackdrop = $('#dns-edit-modal .modal-backdrop');
  if (dnsBackdrop) dnsBackdrop.onclick = () => closeModal($('#dns-edit-modal'));
}
if ($('#tunnel-detail-close')) $('#tunnel-detail-close').onclick = () => closeModal($('#tunnel-detail-modal'));
if ($('#tunnel-detail-modal')) {
  const tdBackdrop = $('#tunnel-detail-modal .modal-backdrop');
  if (tdBackdrop) tdBackdrop.onclick = () => closeModal($('#tunnel-detail-modal'));
}
if ($('#tunnel-detail-copy')) {
  $('#tunnel-detail-copy').onclick = () => {
    if (!tunnelDetailId) return;
    window.api.app.copy(tunnelDetailId);
    toast(t('toast.copied'), tunnelDetailId, 'ok');
  };
}
if (typeof jQuery !== 'undefined') {
  jQuery(document).on('change', '#dns-zone', () => loadDnsRecords());
  jQuery(document).on('change', '#dns-type', () => syncDnsTypeUi());
  jQuery(document).on('change', '#dns-edit-type', () => syncDnsTypeUi());
  jQuery(document).on('change', '#in-zone', () => updateServicePreview());
}

$('#btn-create').onclick = async () => {
  const zone = $('#in-zone').value;
  if (!zone) return toast(t('toast.missing'), t('toast.zoneRequired'), 'warn');
  const hostname = buildPublicHostname($('#in-sub').value, zone);
  if (!hostname || !hostname.includes('.')) return toast(t('toast.invalid'), t('toast.invalidHost'), 'warn');
  const svc = buildService($('#in-proto').value, $('#in-host').value.trim(), $('#in-port').value);
  if (!svc) return toast(t('toast.invalid'), t('host.service'), 'warn');
  const path = $('#in-path').value.trim() || null;
  const noTLSVerify = $('#in-notls').checked;
  $('#btn-create').disabled = true;
  const res = await call(window.api.cf.create({ hostname, service: svc, path, noTLSVerify }), t('toast.createFail'));
  $('#btn-create').disabled = false;
  if (res) {
    toast(t('toast.created'), t('toast.createdBody', { h: res.hostname, s: res.service, d: res.dns }), 'ok');
    $('#in-sub').value = '';
    $('#in-path').value = '';
    $('#in-notls').checked = false;
    updateServicePreview();
    await loadHosts();
  }
};

/* ---------- api sunucusu ---------- */
const ENDPOINTS = [
  ['GET', '/api-docs', 'Interactive Swagger UI (no key)'],
  ['GET', '/api/docs.json', 'OpenAPI 3.0 specification (no key)'],
  ['GET', '/health', 'Health check (no key)'],
  ['GET', '/api/status', 'Token + tunnel status'],
  ['GET', '/api/accounts', 'Cloudflare accounts'],
  ['GET', '/api/tunnels', 'Tunnel list'],
  ['GET', '/api/zones', 'Zone list'],
  ['GET', '/api/hostnames', 'Subdomain list'],
  ['POST', '/api/hostnames', '{ hostname, service, path?, noTLSVerify? }'],
  ['PUT', '/api/hostnames/:host', 'Update subdomain'],
  ['POST', '/api/hostnames/:host/disable', 'Disable subdomain'],
  ['POST', '/api/hostnames/:host/toggle', 'Toggle state'],
  ['DELETE', '/api/hostnames/:host', 'Delete permanently'],
  ['GET', '/api/config', 'Settings (masked)'],
  ['PUT', '/api/config', 'Update settings'],
  ['GET', '/api/keys', 'API key list'],
  ['POST', '/api/keys', 'Create key'],
  ['DELETE', '/api/keys/:id', 'Delete key']
];

$('#endpoints').innerHTML = ENDPOINTS.map(
  ([m, p, d]) => `<div class="endpoint"><span class="method m-${m.toLowerCase()}">${m}</span><code>${p}</code><span class="muted small">${d}</span></div>`
).join('');

function renderServer(info) {
  state.server = info || { running: false };
  const running = state.server.running;
  $('#sv-state').textContent = running ? t('srv.running') : t('srv.stopped');
  $('#sv-state-icon').src = running ? 'icons/healthy.svg' : 'icons/down.svg';
  $('#sv-state-icon').className = running ? 'status-healthy' : 'status-down';
  $('#sv-addr').textContent = running ? `http://${state.server.host}:${state.server.port}` : '-';
  $('#st-api').textContent = running ? `http://${state.server.host}:${state.server.port}` : t('srv.stopped');
  const beat = $('#nav-api-beat');
  if (beat) {
    beat.classList.remove('hidden');
    beat.classList.toggle('hb-off', !running);
  }
  $('#btn-server-start').disabled = running;
  $('#btn-server-stop').disabled = !running;
  $('#btn-api-docs').disabled = !running;
}

function serverOpts() {
  return {
    port: Number($('#sv-port').value) || state.config.serverPort || 7000,
    host: $('#sv-host').value.trim() || state.config.serverHost || '127.0.0.1'
  };
}

$('#btn-server-apply').onclick = async () => {
  const opts = serverOpts();
  const res = await call(
    window.api.config.save({ serverPort: opts.port, serverHost: opts.host, autoStartServer: $('#sv-autostart').checked }, { silent: true }),
    t('toast.configSaveFail')
  );
  if (!res) return;
  await loadConfig();
  if (state.server.running) {
    await call(window.api.server.stop(), t('toast.srvStopFail'));
    const info = await call(window.api.server.start(opts), t('toast.srvStartFail'));
    if (info) renderServer(info);
  }
  toast(t('toast.saved'), `${opts.host}:${opts.port}`, 'ok');
};

$('#btn-server-start').onclick = async () => {
  const info = await call(window.api.server.start(serverOpts()), t('toast.srvStartFail'));
  if (info) {
    renderServer(info);
    toast(t('toast.srvStarted'), `http://${info.host}:${info.port}`, 'ok');
  }
};
$('#btn-api-docs').onclick = () => {
  if (!state.server.running) return;
  window.api.app.openExternal(`http://${state.server.host}:${state.server.port}/api-docs`);
};
$('#btn-server-stop').onclick = async () => {
  const info = await call(window.api.server.stop(), t('toast.srvStopFail'));
  if (info) {
    renderServer(info);
    toast(t('toast.srvStopped'), '', 'warn');
  }
};
$('#btn-clear-log').onclick = () => ($('#server-log').innerHTML = '');

window.api.server.onLog(({ level, message, time }) => {
  const pre = $('#server-log');
  const line = document.createElement('div');
  line.innerHTML = `<span class="l-time">[${new Date(time).toLocaleTimeString(dateLocale())}]</span> <span class="l-${level}">${level.toUpperCase()}</span> `;
  line.appendChild(document.createTextNode(message));
  pre.appendChild(line);
  pre.scrollTop = pre.scrollHeight;
});

/* ---------- api anahtarlari ---------- */
function fmtWhen(iso) {
  if (!iso) return t('key.never');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t('key.never');
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 45) return t('key.justNow');
  if (sec < 3600) return t('key.minsAgo', { n: Math.max(1, Math.round(sec / 60)) });
  if (sec < 86400) return t('key.hoursAgo', { n: Math.max(1, Math.round(sec / 3600)) });
  if (sec < 86400 * 7) return t('key.daysAgo', { n: Math.max(1, Math.round(sec / 86400)) });
  return d.toLocaleString(dateLocale());
}

async function loadKeys() {
  const tbody = $('#key-rows');
  showTableSkeleton(tbody, 6, 4);
  const keys = await call(window.api.keys.list(), t('toast.keysFail'));
  cardLoading(tbody, false);
  tbody.innerHTML = '';
  if (!keys || !keys.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">${t('key.none')}</td></tr>`;
    return;
  }
  keys.forEach((k) => {
    const tr = document.createElement('tr');
    const used = document.createElement('td');
    used.className = 'key-used';
    const when = document.createElement('b');
    when.textContent = fmtWhen(k.lastUsedAt);
    if (k.lastUsedAt) when.title = new Date(k.lastUsedAt).toLocaleString(dateLocale());
    used.appendChild(when);
    const meta = document.createElement('div');
    meta.className = 'muted small';
    const bits = [];
    if (k.lastIp) bits.push(k.lastIp);
    if (k.lastDevice) bits.push(k.lastDevice);
    bits.push(t('key.uses', { n: k.useCount || 0 }));
    meta.textContent = bits.join(' · ');
    if (k.lastUserAgent) meta.title = k.lastUserAgent;
    used.appendChild(meta);
    tr.innerHTML = `
      <td>${pill(k.revoked ? t('key.revoked') : t('key.active'), k.revoked ? 'pill-err' : 'pill-on')}</td>
      <td></td>
      <td><code>${k.prefix}...</code></td>
      <td>${new Date(k.createdAt).toLocaleString(dateLocale())}</td>`;
    tr.children[1].textContent = k.label;
    tr.appendChild(used);
    const td = document.createElement('td');
    td.className = 'right';
    if (!k.revoked) {
      const rev = document.createElement('button');
      rev.className = 'btn btn-sm';
      rev.textContent = t('key.revoke');
      rev.onclick = async () => {
        if (!(await confirmDelete(t('key.confirmRevoke', { l: k.label }), t('swal.yesRevoke')))) return;
        await call(window.api.keys.revoke(k.id), t('toast.revokeFail'));
        toast(t('toast.revoked'), k.label, 'warn');
        loadKeys();
      };
      td.appendChild(rev);
    }
    const del = document.createElement('button');
    del.className = 'btn btn-sm btn-danger';
    del.textContent = t('key.delete');
    del.onclick = async () => {
      if (!(await confirmDelete(t('key.confirmDelete', { l: k.label })))) return;
      await call(window.api.keys.remove(k.id), t('toast.keyDelFail'));
      toast(t('toast.keyDeleted'), k.label, 'warn');
      loadKeys();
    };
    td.appendChild(del);
    tr.appendChild(td);
    tbody.appendChild(tr);
  });
}

$('#btn-key-create').onclick = async () => {
  const label = $('#in-key-label').value.trim() || t('defaultKeyLabel');
  const res = await call(window.api.keys.create(label), t('toast.keyCreateFail'));
  if (res) {
    $('#key-secret').textContent = res.secret;
    $('#key-reveal').classList.remove('hidden');
    $('#in-key-label').value = '';
    toast(t('toast.keyCreated'), t('toast.keyOnce'), 'ok');
    loadKeys();
  }
};
$('#btn-key-copy').onclick = () => {
  window.api.app.copy($('#key-secret').textContent);
  toast(t('toast.copied'), t('toast.copiedBody'), 'ok');
};

/* ---------- ip whitelist ---------- */
function renderWhitelistRows(tbodyId, list, onDelete) {
  const tbody = $('#' + tbodyId);
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="2" class="muted">${t('wl.none')}</td></tr>`;
    return;
  }
  list.forEach((ip) => {
    const tr = document.createElement('tr');
    const tdIp = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = ip;
    tdIp.appendChild(code);
    const td = document.createElement('td');
    td.className = 'right';
    const del = document.createElement('button');
    del.className = 'btn btn-sm btn-danger';
    del.textContent = t('key.delete');
    del.onclick = () => onDelete(ip);
    td.appendChild(del);
    tr.append(tdIp, td);
    tbody.appendChild(tr);
  });
}

function renderWhitelist() {
  renderWhitelistRows('whitelist-rows', state.whitelist || [], deleteWhitelistIp);
}

function renderObWhitelist() {
  renderWhitelistRows('ob-whitelist-rows', obWhitelist, async (ip) => {
    if (!(await confirmDelete(t('wl.confirmDelete', { ip })))) return;
    obWhitelist = obWhitelist.filter((x) => x !== ip);
    renderObWhitelist();
  });
}

async function persistWhitelist(next) {
  const res = await call(window.api.config.save({ ipWhitelist: next }, { silent: true }), t('toast.configSaveFail'));
  if (!res) return false;
  state.whitelist = next.slice();
  state.config.ipWhitelist = next.slice();
  renderWhitelist();
  return true;
}

async function addWhitelistFromInput(inputId, current, persist) {
  const input = $(inputId);
  const ip = (input.value || '').trim();
  if (!validIpOrCidr(ip)) {
    toast(t('toast.invalid'), t('wl.invalid'), 'warn');
    return current;
  }
  if (current.includes(ip)) {
    toast(t('toast.invalid'), t('wl.exists'), 'warn');
    return current;
  }
  const next = current.concat(ip);
  if (persist) {
    if (await persistWhitelist(next)) {
      input.value = '';
      toast(t('wl.added'), ip, 'ok');
    }
    return state.whitelist.slice();
  }
  input.value = '';
  toast(t('wl.added'), ip, 'ok');
  return next;
}

async function deleteWhitelistIp(ip) {
  if (!(await confirmDelete(t('wl.confirmDelete', { ip })))) return;
  const next = (state.whitelist || []).filter((x) => x !== ip);
  if (await persistWhitelist(next)) toast(t('wl.deleted'), ip, 'warn');
}

$('#btn-whitelist-add').onclick = async () => {
  await addWhitelistFromInput('#in-whitelist-ip', state.whitelist || [], true);
};
$('#in-whitelist-ip').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#btn-whitelist-add').click();
  }
});

function fillSecurityForm() {
  const cfg = state.config || {};
  if ($('#sec-rate-on')) $('#sec-rate-on').checked = Boolean(cfg.rateLimitEnabled);
  if ($('#sec-rate')) $('#sec-rate').value = cfg.rateLimitPerMin || 60;
  if ($('#sec-daily-on')) $('#sec-daily-on').checked = Boolean(cfg.dailyLimitEnabled);
  if ($('#sec-daily')) $('#sec-daily').value = cfg.dailyLimit || 10000;
  if ($('#sec-lock-on')) $('#sec-lock-on').checked = Boolean(cfg.lockoutEnabled);
  if ($('#sec-lock-fails')) $('#sec-lock-fails').value = cfg.lockoutFails || 10;
  if ($('#sec-lock-min')) $('#sec-lock-min').value = cfg.lockoutMinutes || 15;
}

if ($('#btn-sec-save')) {
  $('#btn-sec-save').onclick = async () => {
    const patch = {
      rateLimitEnabled: $('#sec-rate-on').checked,
      rateLimitPerMin: Number($('#sec-rate').value) || 60,
      dailyLimitEnabled: $('#sec-daily-on').checked,
      dailyLimit: Number($('#sec-daily').value) || 10000,
      lockoutEnabled: $('#sec-lock-on').checked,
      lockoutFails: Number($('#sec-lock-fails').value) || 10,
      lockoutMinutes: Number($('#sec-lock-min').value) || 15
    };
    const res = await call(window.api.config.save(patch, { silent: true }), t('toast.configSaveFail'));
    if (!res) return;
    state.config = Object.assign({}, state.config, patch);
    toast(t('sec.saved'), '', 'ok');
  };
}

async function loadAudit() {
  showTableSkeleton($('#audit-rows'), 8, 6);
  const source = ($('#audit-source') && $('#audit-source').value) || 'all';
  const q = ($('#audit-filter') && $('#audit-filter').value.trim()) || '';
  const rows = await call(window.api.audit.list({ source, q, limit: 400 }), t('audit.loadFail'));
  renderAuditRows(Array.isArray(rows) ? rows : []);
}

function renderAuditRows(rows) {
  const tbody = $('#audit-rows');
  if (!tbody) return;
  cardLoading(tbody, false);
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="muted">${t('audit.none')}</td></tr>`;
    return;
  }
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const outcome = row.outcome === 'ok' ? 'pill-on' : row.outcome === 'denied' ? 'pill-err' : 'pill-muted';
    const statusLabel = row.status || (row.outcome === 'ok' ? t('audit.ok') : row.outcome === 'denied' ? t('audit.denied') : t('audit.error'));
    const time = row.time ? new Date(row.time).toLocaleString(dateLocale()) : '-';
    const src = row.source === 'api' ? t('audit.api') : t('audit.app');
    const cells = [time, src, row.actor || '-', row.action || '-', row.ip || '-', row.device || '-', '', row.detail || ''];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      if (i === 6) {
        td.innerHTML = pill(String(statusLabel), outcome);
      } else {
        td.textContent = text;
        if (i === 7 && row.userAgent) td.title = row.userAgent;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

if ($('#btn-audit-refresh')) $('#btn-audit-refresh').onclick = () => loadAudit();
if ($('#btn-audit-clear')) {
  $('#btn-audit-clear').onclick = async () => {
    if (!(await confirmDelete(t('audit.confirmClear'), t('swal.yesDelete')))) return;
    const okClear = await call(window.api.audit.clear(), t('toast.error'));
    if (okClear !== false && okClear !== null) {
      toast(t('audit.cleared'), '', 'warn');
      loadAudit();
    }
  };
}
if ($('#audit-filter')) {
  $('#audit-filter').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      loadAudit();
    }
  });
}
if (typeof jQuery !== 'undefined') {
  jQuery(document).on('change', '#audit-source', () => loadAudit());
}
if (window.api.audit && window.api.audit.onEntry) {
  window.api.audit.onEntry(() => {
    if ($('#tab-audit') && $('#tab-audit').classList.contains('active')) loadAudit();
  });
}

if (typeof jQuery !== 'undefined') {
  jQuery(document).on('change', '#tb-tunnel-select', async function () {
    if (ignoreTunnelChange) return;
    const id = this.value;
    const tn = (state.tunnels || []).find((x) => x.id === id);
    await switchTunnel(id, tn ? tn.name : id);
  });
}

/* ---------- baglanti testi (onboarding) ---------- */
function testRow(stepKey, status, detail) {
  const cls = status === 'pass' ? 'pill-on' : status === 'fail' ? 'pill-err' : 'pill-muted';
  const label = status === 'pass' ? t('test.pass') : status === 'fail' ? t('test.fail') : t('test.skip');
  return `<div class="test-row"><span class="test-step">${t(stepKey)}</span><span class="test-detail">${detail || ''}</span>${pill(label, cls)}</div>`;
}

/* ---------- onboarding ---------- */
let obStep = 1;
const OB_STEPS = 5;
const OB_TITLES = ['ob.chip1', 'ob.chip2', 'ob.chip3', 'ob.chip4', 'ob.chip5'];

async function openOnboarding() {
  const cfg = state.config || {};
  $('#ob-token').value = '';
  $('#ob-account').value = cfg.accountId || '';
  $('#ob-tunnel').value = cfg.tunnelId || '';
  $('#ob-service').value = cfg.defaultService || 'http://localhost:8080';
  $('#ob-host').value = cfg.serverHost || '127.0.0.1';
  $('#ob-port').value = cfg.serverPort || 7000;
  obWhitelist = Array.isArray(cfg.ipWhitelist) ? cfg.ipWhitelist.slice() : [];
  renderObWhitelist();
  $('#ob-token-state').textContent = cfg.hasToken ? t('set.tokenSaved', { m: cfg.tokenMask }) : '';
  $('#ob-token-state').className = 'ob-status muted small';
  $('#ob-account-picker').innerHTML = '';
  $('#ob-tunnel-picker').innerHTML = '';
  $('#ob-check').innerHTML = '';
  openModal($('#onboarding'));
  showObStep(1);
  await loadTokenHistory();
}
function closeOnboarding() {
  closeModal($('#onboarding'));
}
function renderObStepBar() {
  const bar = $('#ob-stepbar');
  if (!bar) return;
  bar.innerHTML = '';
  OB_TITLES.forEach((key, i) => {
    const n = i + 1;
    const chip = document.createElement('div');
    chip.className = `ob-chip${n === obStep ? ' active' : ''}${n < obStep ? ' done' : ''}`;
    const num = document.createElement('i');
    num.textContent = n < obStep ? '✓' : String(n);
    const label = document.createElement('span');
    label.textContent = t(key);
    chip.append(num, label);
    chip.onclick = () => showObStep(n);
    bar.appendChild(chip);
  });
}
function showObStep(n) {
  obStep = Math.min(OB_STEPS, Math.max(1, n));
  $$('.ob-step').forEach((el) => el.classList.toggle('active', Number(el.dataset.step) === obStep));
  $$('.ob-dot').forEach((el) => el.classList.toggle('active', Number(el.dataset.step) <= obStep));
  renderObStepBar();
  updateOnboardingButtons();
  if (obStep === 5) renderObSummary();
}
function updateOnboardingButtons() {
  const next = $('#ob-next');
  const prev = $('#ob-prev');
  if (!next) return;
  prev.disabled = obStep === 1;
  next.textContent = obStep === OB_STEPS ? t('ob.finish') : t('ob.next');
  renderObStepBar();
}

function obOverrides() {
  const o = {};
  const token = $('#ob-token').value.trim();
  if (token) o.apiToken = token;
  const account = $('#ob-account').value.trim();
  if (account) o.accountId = account;
  const tunnel = $('#ob-tunnel').value.trim();
  if (tunnel) o.tunnelId = tunnel;
  return o;
}

function renderObSummary() {
  const rows = [
    ['set.token', $('#ob-token').value.trim() ? t('ob.newToken') : (state.config.tokenMask || t('set.tokenEmpty'))],
    ['set.account', $('#ob-account').value.trim() || '-'],
    ['set.tunnel', $('#ob-tunnel').value.trim() || '-'],
    ['set.service', $('#ob-service').value.trim() || 'http://localhost:8080'],
    ['set.host', $('#ob-host').value.trim() || '127.0.0.1'],
    ['set.port', $('#ob-port').value || 7000]
  ];
  const box = $('#ob-summary');
  box.innerHTML = '';
  rows.forEach(([key, value]) => {
    const kv = document.createElement('div');
    kv.className = 'kv';
    const k = document.createElement('span');
    k.textContent = t(key);
    const v = document.createElement('b');
    v.textContent = String(value);
    kv.append(k, v);
    box.appendChild(kv);
  });
}

const obLoadTunnels = () =>
  fillPicker('ob-tunnel-picker', loadHealthyTunnels, obOverrides(), (tn) => {
    $('#ob-tunnel').value = tn.id;
    toast(t('set.tunnelSelected'), tn.name, 'ok');
  }, 'set.noTunnel', 'toast.tunnelsFail', $('#ob-tunnel').value.trim());

const obLoadAccounts = () =>
  fillPicker('ob-account-picker', window.api.cf.accounts, obOverrides(), (acc) => {
    $('#ob-account').value = acc.id;
    toast(t('set.accountSelected'), acc.name, 'ok');
  }, 'set.noAccount', 'toast.accountsFail', $('#ob-account').value.trim());

// Token adiminda ileri: token'i kaydetmeden dogrula, hesaplari otomatik getir
async function obVerifyToken() {
  const token = $('#ob-token').value.trim();
  if (!token && !state.config.hasToken) {
    toast(t('toast.missing'), t('set.token'), 'warn');
    return false;
  }
  const state$ = $('#ob-token-state');
  state$.className = 'ob-status muted small';
  state$.textContent = t('test.running');
  const res = await window.api.cf.probe(obOverrides());
  if (!res || res.success === false) {
    state$.className = 'ob-status err small';
    state$.textContent = (res && res.error) || t('ob.testFail');
    return false;
  }
  state$.className = 'ob-status ok small';
  state$.textContent = t('ob.tokenOk', { s: res.result.token ? res.result.token.status : 'active' });
  const accounts = res.result.accounts || [];
  if (accounts.length) {
    renderPicker($('#ob-account-picker'), accounts, (acc) => {
      $('#ob-account').value = acc.id;
      toast(t('set.accountSelected'), acc.name, 'ok');
    }, 'set.noAccount', $('#ob-account').value.trim());
    if (!$('#ob-account').value.trim() && accounts.length === 1) $('#ob-account').value = accounts[0].id;
  }
  return true;
}

async function obSave() {
  const accountId = $('#ob-account').value.trim();
  const tunnelId = $('#ob-tunnel').value.trim();
  const token = $('#ob-token').value.trim();
  if ((!token && !state.config.hasToken) || !accountId || !tunnelId) {
    toast(t('toast.missing'), t('test.notConfigured'), 'warn');
    return;
  }
  const patch = {
    accountId,
    tunnelId,
    defaultService: $('#ob-service').value.trim() || 'http://localhost:8080',
    serverHost: $('#ob-host').value.trim() || '127.0.0.1',
    serverPort: Number($('#ob-port').value) || 7000,
    ipWhitelist: obWhitelist.slice(),
    onboarded: true
  };
  if (token) patch.apiToken = token;
  const res = await call(window.api.config.save(patch), t('toast.configSaveFail'));
  if (res) {
    toast(t('toast.saved'), t('toast.savedBody'), 'ok');
    closeOnboarding();
    await loadConfig();
    await loadStatus();
  }
}

async function obTest() {
  const box = $('#ob-check');
  if (obStep === 1) {
    await obVerifyToken();
    return;
  }
  box.innerHTML = `<div class="muted small">${t('test.running')}</div>`;
  const res = await window.api.cf.probe(obOverrides());
  if (!res || res.success === false) {
    box.innerHTML = testRow('test.step.token', 'fail', (res && res.error) || '');
    toast(t('ob.testFail'), (res && res.error) || '', 'err');
    return;
  }
  const r = res.result;
  const rows = [
    testRow('test.step.token', r.token ? 'pass' : 'fail', r.token ? r.token.status : ''),
    testRow('test.step.account', $('#ob-account').value.trim() ? 'pass' : 'fail', $('#ob-account').value.trim()),
    testRow('test.step.tunnel', r.tunnel ? 'pass' : 'fail', r.tunnel ? `${r.tunnel.name} · ${r.tunnel.status}` : (r.errors[0] ? r.errors[0].message : ''))
  ];
  box.innerHTML = rows.join('');
  if (r.tunnel) toast(t('ob.testOk'), r.tunnel.name, 'ok');
  else toast(t('ob.testFail'), r.errors.length ? r.errors[r.errors.length - 1].message : '', 'err');
}

async function obSkip() {
  await window.api.config.save({ onboarded: true }, { silent: true });
  state.config.onboarded = true;
  closeOnboarding();
}

$('#ob-next').onclick = async () => {
  const btn = $('#ob-next');
  btn.disabled = true;
  try {
    if (obStep === 1) {
      if (await obVerifyToken()) showObStep(2);
    } else if (obStep === OB_STEPS) {
      await obSave();
    } else {
      showObStep(obStep + 1);
    }
  } finally {
    btn.disabled = false;
  }
};
$('#ob-prev').onclick = () => showObStep(obStep - 1);
$('#ob-skip').onclick = obSkip;
$('#ob-load-tunnels').onclick = obLoadTunnels;
$('#ob-load-accounts').onclick = obLoadAccounts;
$('#ob-test').onclick = obTest;
$('#btn-open-onboarding').onclick = openOnboarding;
$('#ob-whitelist-add').onclick = async () => {
  obWhitelist = await addWhitelistFromInput('#ob-whitelist-ip', obWhitelist, false);
  renderObWhitelist();
};
const obWlInput = $('#ob-whitelist-ip');
if (obWlInput) {
  obWlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#ob-whitelist-add').click();
    }
  });
}

/* ---------- hakkinda ---------- */
function showIntTab(id) {
  if (!id) return;
  $$('#tab-integrate .int-tab').forEach((b) => b.classList.toggle('active', b.dataset.intTab === id));
  $$('#tab-integrate .int-panel').forEach((p) => p.classList.toggle('active', p.dataset.intPanel === id));
}

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest && e.target.closest('#tab-integrate [data-int-tab]');
  if (tabBtn && tabBtn.dataset.intTab) {
    e.preventDefault();
    showIntTab(tabBtn.dataset.intTab);
    return;
  }
  const copyBtn = e.target.closest && e.target.closest('.btn-copy-code');
  if (copyBtn) {
    const wrap = copyBtn.closest('.code-wrap');
    const code = wrap && wrap.querySelector('code');
    if (code) {
      window.api.app.copy(code.textContent);
      toast(t('int.copied'), '', 'ok');
    }
  }
});

async function loadVersions() {
  try {
    const v = await window.api.app.versions();
    if (v) {
      $('#ver-app').textContent = v.app || '-';
      $('#ver-electron').textContent = v.electron || '-';
      $('#ver-node').textContent = v.node || '-';
      $('#ver-chrome').textContent = v.chrome || '-';
    }
  } catch (e) {}
}

if ($('#about-github')) {
  $('#about-github').onclick = (e) => {
    e.preventDefault();
    window.api.app.openExternal('https://github.com/acarfx');
  };
}
if ($('#sidebar-github')) {
  $('#sidebar-github').onclick = () => window.api.app.openExternal('https://github.com/acarfx');
}

/* ---------- baslangic ---------- */
(async function init() {
  const first = await window.api.config.get();
  const cfg = first && first.success ? first.result : {};
  if (cfg.language && !localStorage.getItem('czt_lang')) lang = cfg.language;
  applyLang();
  loadVersions();
  initFormSelects();
  fillTunnelSelect([]);
  await loadConfig();
  renderServer(await call(window.api.server.status()) || { running: false });
  fillAccountCard(null);
  if (!isConfigured(state.config) && !state.config.onboarded) {
    await openOnboarding();
    return;
  }
  await loadStatus();
  if (state.config.autoStartServer && !state.server.running) {
    const info = await window.api.server.start({});
    if (info && info.success) renderServer(info.result);
  }
  let lastTab = 'dashboard';
  try { lastTab = sessionStorage.getItem('czt_last_tab') || 'dashboard'; } catch (e) {}
  if (lastTab && lastTab !== 'dashboard' && $(`#tab-${lastTab}`)) activateTab(lastTab);
})();
