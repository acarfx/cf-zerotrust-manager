'use strict';

const crypto = require('crypto');
const { AUDIT_FILE } = require('./paths');
const { readJson, writeJson } = require('./jsonfile');

const MAX_ENTRIES = 2000;

function list() {
  const rows = readJson(AUDIT_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

function write(entry) {
  const rows = list();
  const rec = {
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    source: entry.source || 'app',
    action: String(entry.action || '').slice(0, 180),
    actor: String(entry.actor || '').slice(0, 120),
    keyId: entry.keyId || '',
    ip: String(entry.ip || '').slice(0, 64),
    userAgent: String(entry.userAgent || '').slice(0, 400),
    device: String(entry.device || '').slice(0, 160),
    method: entry.method || '',
    path: String(entry.path || '').slice(0, 200),
    status: entry.status == null ? '' : entry.status,
    outcome: entry.outcome || 'ok',
    detail: String(entry.detail || '').slice(0, 500)
  };
  rows.unshift(rec);
  writeJson(AUDIT_FILE, rows.slice(0, MAX_ENTRIES));
  return rec;
}

function query(opts = {}) {
  const source = opts.source && opts.source !== 'all' ? opts.source : '';
  const q = String(opts.q || '').trim().toLowerCase();
  const limit = Math.min(Number(opts.limit) || 400, 800);
  return list().filter((row) => {
    if (source && row.source !== source) return false;
    if (!q) return true;
    const blob = [row.action, row.actor, row.ip, row.device, row.userAgent, row.detail, row.path, row.method]
      .join(' ')
      .toLowerCase();
    return blob.includes(q);
  }).slice(0, limit);
}

function clear() {
  writeJson(AUDIT_FILE, []);
  return true;
}

module.exports = { write, list, query, clear };
