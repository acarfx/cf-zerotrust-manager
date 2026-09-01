'use strict';

const API_BASE = 'https://api.cloudflare.com/client/v4';

class CloudflareError extends Error {
  constructor(message, status, errors) {
    super(message);
    this.name = 'CloudflareError';
    this.status = status || 500;
    this.errors = errors || [];
  }
}

async function cfRequest(config, method, path, body, options = {}) {
  if (!config.apiToken) throw new CloudflareError('Cloudflare API Token tanimli degil', 400);
  const headers = { Authorization: `Bearer ${config.apiToken}` };
  let payload = undefined;
  if (options.formData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = options.contentType || 'application/json';
    payload = options.raw ? body : JSON.stringify(body);
  }
  if (options.accept) headers.Accept = options.accept;

  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload });

  if (options.text) {
    const text = await res.text();
    if (!res.ok) {
      let msg = `Cloudflare hatasi (HTTP ${res.status})`;
      try {
        const json = JSON.parse(text);
        const errors = json && json.errors ? json.errors : [];
        if (errors.length) msg = errors.map((e) => `${e.code}: ${e.message}`).join(' | ');
      } catch (e) { /* metin hata */ }
      throw new CloudflareError(msg, res.status);
    }
    return text;
  }

  let json = null;
  try {
    json = await res.json();
  } catch (err) {
    throw new CloudflareError(`Cloudflare yaniti okunamadi (HTTP ${res.status})`, res.status);
  }

  if (!res.ok || json.success === false) {
    const errors = json && json.errors ? json.errors : [];
    const msg = errors.length ? errors.map((e) => `${e.code}: ${e.message}`).join(' | ') : `Cloudflare hatasi (HTTP ${res.status})`;
    const err = new CloudflareError(msg, res.status, errors);
    err.code = errors.length ? errors[0].code : null;
    throw err;
  }
  return json.result;
}

function requireAccount(config) {
  if (!config.accountId) throw new CloudflareError('Account ID tanimli degil', 400);
}

function requireTunnel(config) {
  requireAccount(config);
  if (!config.tunnelId) throw new CloudflareError('Tunnel ID tanimli degil', 400);
}

// Hesap sahipli token'lar (cfat... onekli) /user/tokens/verify uzerinde
// "1000: Invalid API Token" dondurur; onlar icin hesap bazli endpoint gerekir.
async function verifyToken(config) {
  const accountId = config.accountId;
  if (accountId) {
    try {
      return await cfRequest(config, 'GET', `/accounts/${accountId}/tokens/verify`);
    } catch (err) {
      if (err.code !== 1000 && err.status !== 404) throw err;
    }
  }
  try {
    return await cfRequest(config, 'GET', '/user/tokens/verify');
  } catch (err) {
    if (err.code !== 1000) throw err;
    // Account ID bilinmiyorsa erisilebilen hesaplar uzerinden dogrulamayi dene
    const accounts = await listAccounts(config).catch(() => []);
    for (const acc of accounts) {
      try {
        return await cfRequest(config, 'GET', `/accounts/${acc.id}/tokens/verify`);
      } catch (inner) {
        if (inner.code !== 1000 && inner.status !== 404) throw inner;
      }
    }
    throw err;
  }
}

async function listAccounts(config) {
  const result = await cfRequest(config, 'GET', '/accounts?per_page=50');
  return (result || []).map((a) => ({ id: a.id, name: a.name, type: a.type || null }));
}

function mapTunnel(t) {
  const conns = t.connections || [];
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    createdAt: t.created_at,
    connections: conns.length,
    connectionList: conns.map((c) => ({
      id: c.id || null,
      colo: c.colo_name || c.colo || null,
      originIp: c.origin_ip || null,
      openedAt: c.opened_at || null,
      pending: Boolean(c.is_pending_reconnect),
      version: c.client_version || null
    })),
    tunType: t.tun_type || null,
    remoteConfig: t.remote_config == null ? null : Boolean(t.remote_config)
  };
}

async function listTunnels(config) {
  requireAccount(config);
  const result = await cfRequest(config, 'GET', `/accounts/${config.accountId}/cfd_tunnel?is_deleted=false&per_page=50`);
  return (result || []).map(mapTunnel);
}

async function getTunnel(config) {
  requireTunnel(config);
  return getTunnelById(config, config.tunnelId);
}

async function getTunnelById(config, tunnelId) {
  requireAccount(config);
  if (!tunnelId) throw new CloudflareError('Tunnel ID tanimli degil', 400);
  const t = await cfRequest(config, 'GET', `/accounts/${config.accountId}/cfd_tunnel/${encodeURIComponent(tunnelId)}`);
  return mapTunnel(t);
}

async function listZones(config) {
  const items = [];
  let page = 1;
  for (;;) {
    const batch = await cfRequest(config, 'GET', `/zones?per_page=50&page=${page}`);
    const rows = batch || [];
    items.push(...rows);
    if (rows.length < 50) break;
    page += 1;
    if (page > 40) break;
  }
  return items.map((z) => ({
    id: z.id,
    name: z.name,
    status: z.status,
    paused: Boolean(z.paused),
    type: z.type || null,
    nameServers: z.name_servers || [],
    plan: (z.plan && z.plan.name) || null,
    createdAt: z.created_on || null
  }));
}

async function listDnsRecords(config, zoneId) {
  if (!zoneId) throw new CloudflareError('Zone ID tanimli degil', 400);
  const items = [];
  let page = 1;
  for (;;) {
    const batch = await cfRequest(
      config,
      'GET',
      `/zones/${encodeURIComponent(zoneId)}/dns_records?per_page=100&page=${page}`
    );
    const rows = batch || [];
    items.push(...rows);
    if (rows.length < 100) break;
    page += 1;
    if (page > 40) break;
  }
  return items.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    content: r.content,
    proxied: Boolean(r.proxied),
    ttl: r.ttl,
    priority: r.priority == null ? null : r.priority,
    comment: r.comment || '',
    createdAt: r.created_on || null,
    modifiedAt: r.modified_on || null
  }));
}

function mapDnsRecord(r) {
  if (!r) return null;
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    content: r.content,
    proxied: Boolean(r.proxied),
    ttl: r.ttl,
    priority: r.priority == null ? null : r.priority,
    comment: r.comment || '',
    createdAt: r.created_on || null,
    modifiedAt: r.modified_on || null
  };
}

function dnsPayload(input) {
  const type = String(input.type || 'A').toUpperCase();
  const payload = {
    type,
    name: String(input.name || '').trim(),
    content: String(input.content || '').trim(),
    ttl: Number(input.ttl) > 0 ? Number(input.ttl) : 1,
    proxied: type === 'A' || type === 'AAAA' || type === 'CNAME' ? Boolean(input.proxied) : false
  };
  if (input.comment) payload.comment = String(input.comment).trim();
  if (type === 'MX' || type === 'SRV') {
    const prio = Number(input.priority);
    payload.priority = Number.isFinite(prio) && prio >= 0 ? prio : 10;
  }
  if (!payload.name || !payload.content) throw new CloudflareError('DNS adi ve icerik zorunlu', 400);
  return payload;
}

async function createDnsRecord(config, zoneId, input) {
  if (!zoneId) throw new CloudflareError('Zone ID tanimli degil', 400);
  const created = await cfRequest(config, 'POST', `/zones/${encodeURIComponent(zoneId)}/dns_records`, dnsPayload(input));
  return mapDnsRecord(created);
}

async function updateDnsRecord(config, zoneId, recordId, input) {
  if (!zoneId || !recordId) throw new CloudflareError('Zone veya kayit ID tanimli degil', 400);
  const updated = await cfRequest(
    config,
    'PUT',
    `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
    dnsPayload(input)
  );
  return mapDnsRecord(updated);
}

async function destroyDnsRecord(config, zoneId, recordId) {
  if (!zoneId || !recordId) throw new CloudflareError('Zone veya kayit ID tanimli degil', 400);
  await cfRequest(config, 'DELETE', `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`);
  return { deleted: true, id: recordId };
}

const DEFAULT_WORKER = `export default {
  async fetch(request, env, ctx) {
    return new Response('Hello from CF Zero Trust Manager', {
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }
};
`;

async function listWorkers(config) {
  requireAccount(config);
  const result = await cfRequest(config, 'GET', `/accounts/${config.accountId}/workers/scripts`);
  const rows = Array.isArray(result) ? result : [];
  return rows.map((s) => ({
    id: s.id,
    createdAt: s.created_on || null,
    modifiedAt: s.modified_on || null,
    etag: s.etag || null,
    size: (s.script && s.script.size) || s.size || null
  }));
}

async function getWorker(config, name) {
  requireAccount(config);
  if (!name) throw new CloudflareError('Worker adi zorunlu', 400);
  const path = `/accounts/${config.accountId}/workers/scripts/${encodeURIComponent(name)}`;
  let code;
  try {
    code = await cfRequest(config, 'GET', path, undefined, { text: true, accept: 'application/javascript' });
  } catch (err) {
    code = await cfRequest(config, 'GET', path, undefined, { text: true });
  }
  return { id: name, code };
}

async function putWorker(config, name, code) {
  requireAccount(config);
  const scriptName = String(name || '').trim();
  if (!scriptName) throw new CloudflareError('Worker adi zorunlu', 400);
  if (!/^[a-zA-Z0-9-_]+$/.test(scriptName)) throw new CloudflareError('Worker adi yalnizca harf, rakam, - ve _ icerebilir', 400);
  const body = String(code || '').trim() || DEFAULT_WORKER;
  const isModule = /^\s*(export\s+default|import\s)/m.test(body);
  const path = `/accounts/${config.accountId}/workers/scripts/${encodeURIComponent(scriptName)}`;

  if (isModule && typeof FormData !== 'undefined') {
    const form = new FormData();
    const metadata = JSON.stringify({
      main_module: 'worker.js',
      compatibility_date: '2024-11-11'
    });
    if (typeof Blob !== 'undefined') {
      form.append('metadata', new Blob([metadata], { type: 'application/json' }));
      form.append('worker.js', new Blob([body], { type: 'application/javascript+module' }), 'worker.js');
    } else {
      form.append('metadata', metadata);
      form.append('worker.js', body, 'worker.js');
    }
    await cfRequest(config, 'PUT', path, form, { formData: true });
  } else {
    await cfRequest(config, 'PUT', path, body, { raw: true, contentType: 'application/javascript' });
  }
  return { id: scriptName };
}

async function deleteWorker(config, name) {
  requireAccount(config);
  if (!name) throw new CloudflareError('Worker adi zorunlu', 400);
  await cfRequest(config, 'DELETE', `/accounts/${config.accountId}/workers/scripts/${encodeURIComponent(name)}`);
  return { deleted: true, id: name };
}

async function listWorkerRoutes(config, zoneId) {
  if (!zoneId) throw new CloudflareError('Zone ID tanimli degil', 400);
  const result = await cfRequest(config, 'GET', `/zones/${encodeURIComponent(zoneId)}/workers/routes`);
  return (result || []).map((r) => ({
    id: r.id,
    pattern: r.pattern,
    script: r.script || null,
    enabled: r.enabled !== false
  }));
}

async function createWorkerRoute(config, zoneId, { pattern, script }) {
  if (!zoneId) throw new CloudflareError('Zone ID tanimli degil', 400);
  if (!pattern) throw new CloudflareError('Route pattern zorunlu', 400);
  const created = await cfRequest(config, 'POST', `/zones/${encodeURIComponent(zoneId)}/workers/routes`, {
    pattern: String(pattern).trim(),
    script: script ? String(script).trim() : undefined
  });
  return { id: created.id, pattern: created.pattern, script: created.script || script };
}

async function deleteWorkerRoute(config, zoneId, routeId) {
  if (!zoneId || !routeId) throw new CloudflareError('Zone veya route ID tanimli degil', 400);
  await cfRequest(config, 'DELETE', `/zones/${encodeURIComponent(zoneId)}/workers/routes/${encodeURIComponent(routeId)}`);
  return { deleted: true, id: routeId };
}

async function listPages(config) {
  requireAccount(config);
  const items = [];
  let page = 1;
  for (;;) {
    const batch = await cfRequest(config, 'GET', `/accounts/${config.accountId}/pages/projects?per_page=20&page=${page}`);
    const rows = Array.isArray(batch) ? batch : [];
    items.push(...rows);
    if (rows.length < 20) break;
    page += 1;
    if (page > 40) break;
  }
  return items.map((p) => ({
    name: p.name,
    id: p.id || p.name,
    subdomain: p.subdomain || null,
    createdAt: p.created_on || null,
    productionBranch: (p.source && p.source.config && p.source.config.production_branch) || p.production_branch || 'main',
    domains: (p.domains || []).map((d) => (typeof d === 'string' ? d : d.domain || d.name)).filter(Boolean)
  }));
}

async function createPage(config, { name, productionBranch }) {
  requireAccount(config);
  const project = String(name || '').trim().toLowerCase();
  if (!project) throw new CloudflareError('Pages proje adi zorunlu', 400);
  if (!/^[a-z0-9]([a-z0-9-]{0,56}[a-z0-9])?$/.test(project)) {
    throw new CloudflareError('Proje adi kucuk harf, rakam ve - icermelidir', 400);
  }
  const created = await cfRequest(config, 'POST', `/accounts/${config.accountId}/pages/projects`, {
    name: project,
    production_branch: (productionBranch || 'main').trim() || 'main'
  });
  return {
    name: created.name,
    subdomain: created.subdomain || null,
    createdAt: created.created_on || null
  };
}

async function deletePage(config, name) {
  requireAccount(config);
  if (!name) throw new CloudflareError('Pages proje adi zorunlu', 400);
  await cfRequest(config, 'DELETE', `/accounts/${config.accountId}/pages/projects/${encodeURIComponent(name)}`);
  return { deleted: true, name };
}

async function listPageDomains(config, name) {
  requireAccount(config);
  const result = await cfRequest(config, 'GET', `/accounts/${config.accountId}/pages/projects/${encodeURIComponent(name)}/domains`);
  return (result || []).map((d) => ({
    name: d.name || d.domain,
    status: d.status || null,
    verificationData: d.verification_data || null
  }));
}

async function addPageDomain(config, name, domain) {
  requireAccount(config);
  const host = String(domain || '').trim().toLowerCase();
  if (!host) throw new CloudflareError('Domain zorunlu', 400);
  const created = await cfRequest(
    config,
    'POST',
    `/accounts/${config.accountId}/pages/projects/${encodeURIComponent(name)}/domains`,
    { name: host }
  );
  return { name: created.name || host, status: created.status || null };
}

async function deletePageDomain(config, name, domain) {
  requireAccount(config);
  await cfRequest(
    config,
    'DELETE',
    `/accounts/${config.accountId}/pages/projects/${encodeURIComponent(name)}/domains/${encodeURIComponent(domain)}`
  );
  return { deleted: true, name, domain };
}

async function listPageDeployments(config, name) {
  requireAccount(config);
  const result = await cfRequest(
    config,
    'GET',
    `/accounts/${config.accountId}/pages/projects/${encodeURIComponent(name)}/deployments`
  );
  return (result || []).slice(0, 20).map((d) => ({
    id: d.id,
    url: d.url || null,
    environment: d.environment || null,
    createdAt: d.created_on || null,
    latestStage: (d.latest_stage && d.latest_stage.name) || d.stage || null,
    status: (d.latest_stage && d.latest_stage.status) || d.status || null
  }));
}

async function resolveZone(config, hostname) {
  const zones = await listZones(config);
  const host = String(hostname).toLowerCase();
  const match = zones
    .filter((z) => host === z.name || host.endsWith(`.${z.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (!match) throw new CloudflareError(`${hostname} icin Cloudflare zone bulunamadi`, 404);
  return match;
}

async function getTunnelConfig(config, tunnelId) {
  requireAccount(config);
  const id = tunnelId || config.tunnelId;
  if (!id) throw new CloudflareError('Tunnel ID tanimli degil', 400);
  const result = await cfRequest(
    config,
    'GET',
    `/accounts/${config.accountId}/cfd_tunnel/${encodeURIComponent(id)}/configurations`
  );
  const cfg = (result && result.config) || {};
  if (!Array.isArray(cfg.ingress)) cfg.ingress = [];
  return cfg;
}

async function putTunnelConfig(config, tunnelConfig) {
  requireTunnel(config);
  return cfRequest(
    config,
    'PUT',
    `/accounts/${config.accountId}/cfd_tunnel/${config.tunnelId}/configurations`,
    { config: tunnelConfig }
  );
}

function normalizeIngress(ingress) {
  const rules = ingress.filter((r) => r && r.hostname);
  const fallback = ingress.find((r) => r && !r.hostname) || { service: 'http_status:404' };
  return { rules, fallback };
}

async function listHostnames(config) {
  const tunnelConfig = await getTunnelConfig(config);
  const { rules } = normalizeIngress(tunnelConfig.ingress);
  return rules.map((r) => ({
    hostname: r.hostname,
    service: r.service,
    path: r.path || null,
    originRequest: r.originRequest || null,
    enabled: true
  }));
}

async function findAddressRecords(config, zoneId, hostname) {
  const records = await cfRequest(
    config,
    'GET',
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostname)}`
  );
  const rows = records || [];
  return {
    cname: rows.find((r) => r.type === 'CNAME') || null,
    addresses: rows.filter((r) => r.type === 'A' || r.type === 'AAAA' || r.type === 'CNAME')
  };
}

async function findDnsRecord(config, zoneId, hostname) {
  const { cname, addresses } = await findAddressRecords(config, zoneId, hostname);
  return cname || addresses[0] || null;
}

async function ensureDnsRecord(config, hostname) {
  requireTunnel(config);
  const zone = await resolveZone(config, hostname);
  const target = `${config.tunnelId}.cfargotunnel.com`;
  const { cname, addresses } = await findAddressRecords(config, zone.id, hostname);
  const payload = {
    type: 'CNAME',
    name: hostname,
    content: target,
    proxied: true,
    comment: 'cf-zerotrust-manager'
  };

  let record = cname;
  let action = 'unchanged';
  if (cname && String(cname.content || '').replace(/\.$/, '') === target && cname.proxied) {
    action = 'unchanged';
  } else if (cname) {
    record = await cfRequest(config, 'PUT', `/zones/${zone.id}/dns_records/${cname.id}`, payload);
    action = 'updated';
  } else if (addresses[0]) {
    record = await cfRequest(config, 'PUT', `/zones/${zone.id}/dns_records/${addresses[0].id}`, payload);
    action = 'updated';
  } else {
    record = await cfRequest(config, 'POST', `/zones/${zone.id}/dns_records`, payload);
    action = 'created';
  }

  const keepId = record && record.id;
  for (const extra of addresses) {
    if (extra.id === keepId) continue;
    await cfRequest(config, 'DELETE', `/zones/${zone.id}/dns_records/${extra.id}`).catch(() => null);
  }
  return { zone, record, action };
}

async function deleteDnsRecord(config, hostname) {
  const zone = await resolveZone(config, hostname);
  const { addresses } = await findAddressRecords(config, zone.id, hostname);
  const tunnelTarget = `${config.tunnelId}.cfargotunnel.com`;
  const ours = addresses.filter((r) => r.type === 'CNAME' && String(r.content || '').replace(/\.$/, '') === tunnelTarget);
  if (!ours.length) return { deleted: false };
  for (const rec of ours) {
    await cfRequest(config, 'DELETE', `/zones/${zone.id}/dns_records/${rec.id}`);
  }
  return { deleted: true };
}

async function addHostname(config, { hostname, service, path, noTLSVerify }) {
  if (!hostname) throw new CloudflareError('hostname zorunlu', 400);
  const targetService = service || config.defaultService || 'http://localhost:8080';
  const tunnelConfig = await getTunnelConfig(config);
  const { rules, fallback } = normalizeIngress(tunnelConfig.ingress);

  const rule = buildRule(hostname, targetService, path, noTLSVerify);

  const idx = rules.findIndex((r) => r.hostname.toLowerCase() === hostname.toLowerCase() && (r.path || null) === (path || null));
  if (idx >= 0) rules[idx] = rule;
  else rules.push(rule);

  tunnelConfig.ingress = [...rules, fallback];
  await putTunnelConfig(config, tunnelConfig);
  const dns = await ensureDnsRecord(config, hostname);
  return { hostname, service: targetService, path: path || null, dns: dns.action, zone: dns.zone.name };
}

function buildRule(hostname, service, path, noTLSVerify) {
  const rule = { hostname, service };
  if (path) rule.path = path;
  if (noTLSVerify) rule.originRequest = { noTLSVerify: true };
  return rule;
}

async function updateHostname(config, oldHostname, { hostname, service, path, noTLSVerify }) {
  if (!oldHostname) throw new CloudflareError('eski hostname zorunlu', 400);
  if (!hostname) throw new CloudflareError('hostname zorunlu', 400);
  const targetService = service || config.defaultService || 'http://localhost:8080';
  const tunnelConfig = await getTunnelConfig(config);
  let { rules, fallback } = normalizeIngress(tunnelConfig.ingress);
  const oldKey = String(oldHostname).toLowerCase();
  const newKey = String(hostname).toLowerCase();

  if (oldKey !== newKey) {
    rules = rules.filter((r) => r.hostname.toLowerCase() !== oldKey);
    await deleteDnsRecord(config, oldHostname);
  }

  const rule = buildRule(hostname, targetService, path, noTLSVerify);
  const idx = rules.findIndex((r) => r.hostname.toLowerCase() === newKey && (r.path || null) === (path || null));
  if (idx >= 0) rules[idx] = rule;
  else rules.push(rule);

  tunnelConfig.ingress = [...rules, fallback];
  await putTunnelConfig(config, tunnelConfig);
  const dns = await ensureDnsRecord(config, hostname);
  return { hostname, service: targetService, path: path || null, dns: dns.action, zone: dns.zone.name };
}

async function removeHostname(config, hostname, { keepDns = false } = {}) {
  if (!hostname) throw new CloudflareError('hostname zorunlu', 400);
  const tunnelConfig = await getTunnelConfig(config);
  const { rules, fallback } = normalizeIngress(tunnelConfig.ingress);
  const remaining = rules.filter((r) => r.hostname.toLowerCase() !== String(hostname).toLowerCase());
  const removedRules = rules.length - remaining.length;

  tunnelConfig.ingress = [...remaining, fallback];
  await putTunnelConfig(config, tunnelConfig);

  let dns = { deleted: false };
  if (!keepDns) {
    dns = await deleteDnsRecord(config, hostname);
  }
  return { hostname, removedRules, dnsDeleted: dns.deleted };
}

module.exports = {
  CloudflareError,
  cfRequest,
  verifyToken,
  listAccounts,
  listTunnels,
  getTunnel,
  getTunnelById,
  listZones,
  listDnsRecords,
  createDnsRecord,
  updateDnsRecord,
  destroyDnsRecord,
  listWorkers,
  getWorker,
  putWorker,
  deleteWorker,
  listWorkerRoutes,
  createWorkerRoute,
  deleteWorkerRoute,
  listPages,
  createPage,
  deletePage,
  listPageDomains,
  addPageDomain,
  deletePageDomain,
  listPageDeployments,
  DEFAULT_WORKER,
  resolveZone,
  getTunnelConfig,
  putTunnelConfig,
  listHostnames,
  addHostname,
  updateHostname,
  removeHostname,
  ensureDnsRecord,
  deleteDnsRecord
};
