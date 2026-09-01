'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), '.config'),
  'cf-zerotrust-manager'
);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  return DATA_DIR;
}

module.exports = {
  DATA_DIR,
  ensureDataDir,
  CONFIG_FILE: path.join(DATA_DIR, 'config.json'),
  KEYS_FILE: path.join(DATA_DIR, 'apikeys.json'),
  TOKENS_FILE: path.join(DATA_DIR, 'tokens.json'),
  REGISTRY_FILE: path.join(DATA_DIR, 'registry.json'),
  LOG_FILE: path.join(DATA_DIR, 'server.log'),
  AUDIT_FILE: path.join(DATA_DIR, 'audit.json')
};
