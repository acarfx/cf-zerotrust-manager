'use strict';

const store = require('./store');
const cf = require('./cloudflare');

function cfg(overrides) {
  const patch = Object.assign({}, overrides || {});
  // Onboarding/ayarlar ekrani henuz kaydedilmemis bilgilerle test edebilsin diye
  // gecici override destegi: bos alanlar kayitli config'ten tamamlanir.
  if (patch.tokenId) {
    const token = store.resolveToken(patch.tokenId);
    if (token) patch.apiToken = token;
    delete patch.tokenId;
  }
  if (patch.apiToken !== undefined && (!patch.apiToken || store.isMaskedToken(patch.apiToken))) delete patch.apiToken;
  Object.keys(patch).forEach((k) => {
    if (patch[k] === undefined || patch[k] === null || patch[k] === '') delete patch[k];
  });
  return Object.assign(store.getConfig(), patch);
}

// Kaydetmeden dogrulama: token -> hesap -> tunel zinciri
async function probe(overrides) {
  const config = cfg(overrides);
  const out = { token: null, accounts: [], tunnel: null, errors: [] };
  const verified = await cf.verifyToken(config);
  out.token = { status: verified.status, id: verified.id };
  try {
    out.accounts = await cf.listAccounts(config);
  } catch (err) {
    out.errors.push({ step: 'accounts', message: err.message });
  }
  if (config.accountId && config.tunnelId) {
    try {
      out.tunnel = await cf.getTunnel(config);
    } catch (err) {
      out.errors.push({ step: 'tunnel', message: err.message });
    }
  }
  return out;
}

async function status(overrides) {
  const config = cfg(overrides);
  const out = {
    configured: Boolean(config.apiToken && config.accountId && config.tunnelId),
    accountId: config.accountId || null,
    tunnelId: config.tunnelId || null,
    accountName: null,
    defaultService: config.defaultService || null,
    token: null,
    tunnel: null
  };
  if (!config.apiToken) return out;
  const verified = await cf.verifyToken(config);
  out.token = { status: verified.status, id: verified.id };
  try {
    const accounts = await cf.listAccounts(config);
    const acc = (accounts || []).find((a) => a.id === config.accountId) || (accounts && accounts[0]) || null;
    if (acc) {
      out.accountName = acc.name || null;
      if (!out.accountId && acc.id) out.accountId = acc.id;
    }
  } catch (err) {
    out.accountName = null;
  }
  if (config.accountId && config.tunnelId) {
    try {
      out.tunnel = await cf.getTunnel(config);
    } catch (err) {
      out.tunnel = null;
    }
  }
  return out;
}

async function list(overrides) {
  const config = cfg(overrides);
  const tunnelId = config.tunnelId || '';
  const live = await cf.listHostnames(config);
  const liveMap = new Map(live.map((h) => [h.hostname.toLowerCase(), h]));
  const registry = store.getRegistry();

  const items = live.map((h) => {
    const key = h.hostname.toLowerCase();
    const reg = registry.find((r) => r.hostname.toLowerCase() === key && (!r.tunnelId || r.tunnelId === tunnelId));
    return {
      hostname: h.hostname,
      service: h.service,
      path: h.path,
      originRequest: h.originRequest || null,
      enabled: true,
      tunnelId,
      createdAt: reg ? reg.createdAt : null,
      updatedAt: reg ? reg.updatedAt : null
    };
  });

  registry.forEach((r) => {
    if (!tunnelId || r.tunnelId !== tunnelId) return;
    if (liveMap.has(r.hostname.toLowerCase())) return;
    items.push({
      hostname: r.hostname,
      service: r.service,
      path: r.path || null,
      originRequest: r.originRequest || null,
      enabled: false,
      tunnelId,
      createdAt: r.createdAt || null,
      updatedAt: r.updatedAt || null
    });
  });

  live.forEach((h) => {
    const prev = registry.find((r) => r.hostname.toLowerCase() === h.hostname.toLowerCase() && (!r.tunnelId || r.tunnelId === tunnelId));
    store.upsertRegistry({
      hostname: h.hostname,
      service: h.service,
      path: h.path || null,
      enabled: true,
      tunnelId,
      createdAt: (prev && prev.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  });

  return items.sort((a, b) => a.hostname.localeCompare(b.hostname));
}

async function create(payload, overrides) {
  const config = cfg(overrides);
  const result = await cf.addHostname(config, payload);
  store.upsertRegistry({
    hostname: result.hostname,
    service: result.service,
    path: result.path,
    originRequest: payload.noTLSVerify ? { noTLSVerify: true } : null,
    enabled: true,
    tunnelId: config.tunnelId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  return result;
}

async function update(oldHostname, payload, overrides) {
  const config = cfg(overrides);
  const result = await cf.updateHostname(config, oldHostname, payload);
  const oldKey = String(oldHostname).toLowerCase();
  const newKey = String(result.hostname).toLowerCase();
  const oldReg = store.getRegistry().find((r) => r.hostname.toLowerCase() === oldKey && (!r.tunnelId || r.tunnelId === config.tunnelId));
  store.upsertRegistry({
    hostname: result.hostname,
    service: result.service,
    path: result.path,
    originRequest: payload.noTLSVerify ? { noTLSVerify: true } : null,
    enabled: true,
    tunnelId: config.tunnelId,
    createdAt: (oldReg && oldReg.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  if (oldKey !== newKey) {
    store.removeRegistry(oldHostname, config.tunnelId);
  }
  return result;
}

async function enable(hostname, overrides) {
  const config = cfg(overrides);
  const reg = store.getRegistry().find((r) => r.hostname.toLowerCase() === String(hostname).toLowerCase() && (!r.tunnelId || r.tunnelId === config.tunnelId));
  const service = (reg && reg.service) || config.defaultService;
  const path = reg ? reg.path : null;
  const result = await cf.addHostname(config, { hostname, service, path });
  store.upsertRegistry({
    hostname: result.hostname,
    service: result.service,
    path: result.path,
    enabled: true,
    tunnelId: config.tunnelId,
    updatedAt: new Date().toISOString(),
    createdAt: (reg && reg.createdAt) || new Date().toISOString()
  });
  return Object.assign(result, { enabled: true });
}

async function disable(hostname, overrides) {
  const config = cfg(overrides);
  const result = await cf.removeHostname(config, hostname, { keepDns: false });
  const reg = store.getRegistry().find((r) => r.hostname.toLowerCase() === String(hostname).toLowerCase() && (!r.tunnelId || r.tunnelId === config.tunnelId));
  store.upsertRegistry({
    hostname,
    service: (reg && reg.service) || config.defaultService,
    path: reg ? reg.path : null,
    enabled: false,
    tunnelId: config.tunnelId,
    createdAt: (reg && reg.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  return Object.assign(result, { enabled: false });
}

async function destroy(hostname, overrides) {
  const config = cfg(overrides);
  const result = await cf.removeHostname(config, hostname, { keepDns: false });
  store.removeRegistry(hostname, config.tunnelId);
  return Object.assign(result, { deleted: true });
}

async function toggle(hostname, overrides) {
  const items = await list(overrides);
  const item = items.find((i) => i.hostname.toLowerCase() === String(hostname).toLowerCase());
  if (item && item.enabled) return disable(hostname, overrides);
  return enable(hostname, overrides);
}

module.exports = {
  status,
  probe,
  accounts: (overrides) => cf.listAccounts(cfg(overrides)),
  list,
  create,
  update,
  enable,
  disable,
  destroy,
  toggle,
  tunnels: (overrides) => cf.listTunnels(cfg(overrides)),
  tunnelGet: (id, overrides) => cf.getTunnelById(cfg(overrides), id),
  tunnelConfigFor: (id, overrides) => cf.getTunnelConfig(cfg(overrides), id),
  zones: (overrides) => cf.listZones(cfg(overrides)),
  dnsRecords: (zoneId, overrides) => cf.listDnsRecords(cfg(overrides), zoneId),
  dnsCreate: (zoneId, input, overrides) => cf.createDnsRecord(cfg(overrides), zoneId, input),
  dnsUpdate: (zoneId, recordId, input, overrides) => cf.updateDnsRecord(cfg(overrides), zoneId, recordId, input),
  dnsDelete: (zoneId, recordId, overrides) => cf.destroyDnsRecord(cfg(overrides), zoneId, recordId),
  workers: (overrides) => cf.listWorkers(cfg(overrides)),
  workerGet: (name, overrides) => cf.getWorker(cfg(overrides), name),
  workerPut: (name, code, overrides) => cf.putWorker(cfg(overrides), name, code),
  workerDelete: (name, overrides) => cf.deleteWorker(cfg(overrides), name),
  workerRoutes: (zoneId, overrides) => cf.listWorkerRoutes(cfg(overrides), zoneId),
  workerRouteCreate: (zoneId, input, overrides) => cf.createWorkerRoute(cfg(overrides), zoneId, input),
  workerRouteDelete: (zoneId, routeId, overrides) => cf.deleteWorkerRoute(cfg(overrides), zoneId, routeId),
  workerTemplate: () => cf.DEFAULT_WORKER,
  pages: (overrides) => cf.listPages(cfg(overrides)),
  pageCreate: (input, overrides) => cf.createPage(cfg(overrides), input),
  pageDelete: (name, overrides) => cf.deletePage(cfg(overrides), name),
  pageDomains: (name, overrides) => cf.listPageDomains(cfg(overrides), name),
  pageDomainAdd: (name, domain, overrides) => cf.addPageDomain(cfg(overrides), name, domain),
  pageDomainDelete: (name, domain, overrides) => cf.deletePageDomain(cfg(overrides), name, domain),
  pageDeployments: (name, overrides) => cf.listPageDeployments(cfg(overrides), name),
  tunnelConfig: (overrides) => cf.getTunnelConfig(cfg(overrides))
};
