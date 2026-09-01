'use strict';

const crypto = require('crypto');
const { CONFIG_FILE, KEYS_FILE, REGISTRY_FILE, TOKENS_FILE } = require('./paths');
const { readJson, writeJson } = require('./jsonfile');

const DEFAULT_CONFIG = {
  apiToken: '',
  accountId: '',
  tunnelId: '',
  zoneName: '',
  defaultService: 'http://localhost:8080',
  serverPort: 7000,
  serverHost: '127.0.0.1',
  autoStartServer: false,
  ipWhitelist: [],
  language: 'en',
  onboarded: false,
  rateLimitEnabled: false,
  rateLimitPerMin: 60,
  dailyLimitEnabled: false,
  dailyLimit: 10000,
  lockoutEnabled: false,
  lockoutFails: 10,
  lockoutMinutes: 15
};

function getConfig() {
  return Object.assign({}, DEFAULT_CONFIG, readJson(CONFIG_FILE, {}));
}

function maskToken(token) {
  if (!token) return '';
  if (token.length <= 8) return '*'.repeat(token.length);
  return `${token.slice(0, 4)}${'*'.repeat(12)}${token.slice(-4)}`;
}

// Maskelenmis token'in tekrar kaydedilmesi "1000: Invalid API Token" hatasina yol aciyordu.
function isMaskedToken(token) {
  return typeof token === 'string' && token.includes('*');
}

function sanitizePatch(patch) {
  const clean = Object.assign({}, patch || {});
  if (clean.apiToken !== undefined) {
    const token = String(clean.apiToken).trim();
    if (!token || isMaskedToken(token)) delete clean.apiToken;
    else clean.apiToken = token;
  }
  ['accountId', 'tunnelId', 'zoneName', 'defaultService', 'serverHost'].forEach((k) => {
    if (clean[k] !== undefined) clean[k] = String(clean[k]).trim();
  });
  if (clean.serverPort !== undefined) {
    const port = Number(clean.serverPort);
    clean.serverPort = Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_CONFIG.serverPort;
  }
  if (clean.ipWhitelist !== undefined && !Array.isArray(clean.ipWhitelist)) {
    clean.ipWhitelist = String(clean.ipWhitelist).split(',').map((s) => s.trim()).filter(Boolean);
  }
  ['rateLimitEnabled', 'dailyLimitEnabled', 'lockoutEnabled'].forEach((k) => {
    if (clean[k] !== undefined) clean[k] = Boolean(clean[k]);
  });
  if (clean.rateLimitPerMin !== undefined) {
    const n = Number(clean.rateLimitPerMin);
    clean.rateLimitPerMin = Number.isInteger(n) && n > 0 && n <= 100000 ? n : DEFAULT_CONFIG.rateLimitPerMin;
  }
  if (clean.dailyLimit !== undefined) {
    const n = Number(clean.dailyLimit);
    clean.dailyLimit = Number.isInteger(n) && n > 0 && n <= 10000000 ? n : DEFAULT_CONFIG.dailyLimit;
  }
  if (clean.lockoutFails !== undefined) {
    const n = Number(clean.lockoutFails);
    clean.lockoutFails = Number.isInteger(n) && n > 0 && n <= 1000 ? n : DEFAULT_CONFIG.lockoutFails;
  }
  if (clean.lockoutMinutes !== undefined) {
    const n = Number(clean.lockoutMinutes);
    clean.lockoutMinutes = Number.isInteger(n) && n > 0 && n <= 1440 ? n : DEFAULT_CONFIG.lockoutMinutes;
  }
  if (clean.language !== undefined && !['tr', 'en', 'ru'].includes(clean.language)) delete clean.language;
  return clean;
}

function saveConfig(patch) {
  const clean = sanitizePatch(patch);
  const label = clean.tokenLabel;
  delete clean.tokenLabel;
  const next = Object.assign(getConfig(), clean);
  writeJson(CONFIG_FILE, next);
  if (clean.apiToken) rememberToken(clean.apiToken, label);
  return next;
}

function maskedConfig() {
  const cfg = getConfig();
  return Object.assign({}, cfg, {
    apiToken: '',
    tokenMask: maskToken(cfg.apiToken),
    hasToken: Boolean(cfg.apiToken)
  });
}

/* ---- daha once kullanilan Cloudflare token'lari (yalniz yerel diskte) ---- */
function getTokenHistory() {
  const list = readJson(TOKENS_FILE, []);
  return Array.isArray(list) ? list : [];
}

function publicTokenHistory() {
  return getTokenHistory().map(({ token, ...rest }) => rest);
}

function rememberToken(token, label) {
  if (!token || isMaskedToken(token)) return null;
  const list = getTokenHistory();
  const fingerprint = hashKey(token);
  const now = new Date().toISOString();
  let entry = list.find((e) => e.fingerprint === fingerprint);
  if (entry) {
    entry.lastUsedAt = now;
    if (label) entry.label = label;
  } else {
    entry = {
      id: crypto.randomUUID(),
      label: label || `Token ${maskToken(token)}`,
      mask: maskToken(token),
      fingerprint,
      token,
      createdAt: now,
      lastUsedAt: now
    };
    list.push(entry);
  }
  list.sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)));
  writeJson(TOKENS_FILE, list.slice(0, 10));
  const { token: _omit, ...rest } = entry;
  return rest;
}

function useToken(id) {
  const entry = getTokenHistory().find((e) => e.id === id);
  if (!entry) return null;
  saveConfig({ apiToken: entry.token });
  return maskedConfig();
}

function deleteToken(id) {
  const list = getTokenHistory();
  const next = list.filter((e) => e.id !== id);
  writeJson(TOKENS_FILE, next);
  return next.length !== list.length;
}

function resolveToken(id) {
  const entry = getTokenHistory().find((e) => e.id === id);
  return entry ? entry.token : null;
}

function getKeys() {
  const keys = readJson(KEYS_FILE, []);
  return Array.isArray(keys) ? keys : [];
}

function hashKey(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function createKey(label) {
  const secret = `czt_${crypto.randomBytes(24).toString('hex')}`;
  const keys = getKeys();
  const entry = {
    id: crypto.randomUUID(),
    label: label || 'API Key',
    prefix: secret.slice(0, 12),
    hash: hashKey(secret),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    lastIp: '',
    lastUserAgent: '',
    lastDevice: '',
    useCount: 0,
    usageDay: '',
    dayCount: 0,
    revoked: false
  };
  keys.push(entry);
  writeJson(KEYS_FILE, keys);
  return { entry, secret };
}

function revokeKey(id) {
  const keys = getKeys();
  const key = keys.find((k) => k.id === id);
  if (!key) return false;
  key.revoked = true;
  writeJson(KEYS_FILE, keys);
  return true;
}

function deleteKey(id) {
  const keys = getKeys();
  const next = keys.filter((k) => k.id !== id);
  writeJson(KEYS_FILE, next);
  return next.length !== keys.length;
}

function safeEqual(a, b) {
  try {
    const bufA = Buffer.from(String(a), 'hex');
    const bufB = Buffer.from(String(b), 'hex');
    if (bufA.length !== bufB.length || bufA.length === 0) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (err) {
    return false;
  }
}

function parseDevice(ua) {
  const s = String(ua || '');
  if (!s) return '-';
  if (/Windows NT 10/i.test(s)) return 'Windows 10/11';
  if (/Windows/i.test(s)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(s)) return 'macOS';
  if (/Android/i.test(s)) return 'Android';
  if (/iPhone|iPad/i.test(s)) return 'iOS';
  if (/Linux/i.test(s)) return 'Linux';
  return s.slice(0, 48);
}

function peekKey(secret) {
  if (!secret) return null;
  const hash = hashKey(secret);
  return getKeys().find((k) => !k.revoked && safeEqual(k.hash, hash)) || null;
}

function markKeyUsed(id, meta = {}) {
  const keys = getKeys();
  const key = keys.find((k) => k.id === id);
  if (!key) return null;
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  if (key.usageDay !== day) {
    key.usageDay = day;
    key.dayCount = 0;
  }
  key.dayCount = (key.dayCount || 0) + 1;
  key.useCount = (key.useCount || 0) + 1;
  key.lastUsedAt = now;
  if (meta.ip) key.lastIp = String(meta.ip).slice(0, 64);
  if (meta.userAgent) {
    key.lastUserAgent = String(meta.userAgent).slice(0, 300);
    key.lastDevice = parseDevice(meta.userAgent);
  }
  writeJson(KEYS_FILE, keys);
  return key;
}

function verifyKey(secret, meta) {
  const key = peekKey(secret);
  if (!key) return null;
  return markKeyUsed(key.id, meta || {});
}

function todayCount(key) {
  if (!key) return 0;
  const day = new Date().toISOString().slice(0, 10);
  return key.usageDay === day ? (key.dayCount || 0) : 0;
}

function getRegistry() {
  const reg = readJson(REGISTRY_FILE, []);
  return Array.isArray(reg) ? reg : [];
}

function saveRegistry(list) {
  return writeJson(REGISTRY_FILE, list);
}

function upsertRegistry(item) {
  const list = getRegistry();
  const hostKey = String(item.hostname || '').toLowerCase();
  const tunnelId = item.tunnelId || '';
  const idx = list.findIndex((r) => {
    if (r.hostname.toLowerCase() !== hostKey) return false;
    if (tunnelId) return (r.tunnelId || '') === tunnelId;
    return !r.tunnelId;
  });
  if (idx >= 0) list[idx] = Object.assign(list[idx], item);
  else list.push(item);
  saveRegistry(list);
  return item;
}

function removeRegistry(hostname, tunnelId) {
  const hostKey = String(hostname).toLowerCase();
  const list = getRegistry().filter((r) => {
    if (r.hostname.toLowerCase() !== hostKey) return true;
    if (tunnelId && r.tunnelId && r.tunnelId !== tunnelId) return true;
    return false;
  });
  saveRegistry(list);
  return list;
}

module.exports = {
  getConfig,
  saveConfig,
  maskedConfig,
  maskToken,
  isMaskedToken,
  publicTokenHistory,
  rememberToken,
  useToken,
  deleteToken,
  resolveToken,
  getKeys,
  createKey,
  revokeKey,
  deleteKey,
  peekKey,
  markKeyUsed,
  verifyKey,
  todayCount,
  parseDevice,
  getRegistry,
  saveRegistry,
  upsertRegistry,
  removeRegistry
};
