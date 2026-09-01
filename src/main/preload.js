'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => invoke('window:isMaximized'),
    onState: (cb) => ipcRenderer.on('window:state', (_e, data) => cb(data))
  },
  app: {
    notify: (title, body) => ipcRenderer.send('app:notify', { title, body }),
    copy: (text) => ipcRenderer.send('app:copy', text),
    openExternal: (url) => ipcRenderer.send('app:openExternal', url),
    versions: () => invoke('app:versions')
  },
  config: {
    get: () => invoke('config:get'),
    save: (patch, options) => invoke('config:save', patch, options),
    setLang: (lang) => invoke('config:setLang', lang)
  },
  tokens: {
    list: () => invoke('tokens:list'),
    use: (id) => invoke('tokens:use', id),
    remove: (id) => invoke('tokens:delete', id)
  },
  cf: {
    status: (overrides) => invoke('cf:status', overrides),
    probe: (overrides) => invoke('cf:probe', overrides),
    accounts: (overrides) => invoke('cf:accounts', overrides),
    tunnels: (overrides) => invoke('cf:tunnels', overrides),
    tunnelGet: (id) => invoke('cf:tunnelGet', id),
    tunnelConfigFor: (id) => invoke('cf:tunnelConfigFor', id),
    zones: (overrides) => invoke('cf:zones', overrides),
    dnsRecords: (zoneId) => invoke('cf:dns', zoneId),
    dnsCreate: (zoneId, input) => invoke('cf:dnsCreate', zoneId, input),
    dnsUpdate: (zoneId, recordId, input) => invoke('cf:dnsUpdate', zoneId, recordId, input),
    dnsDelete: (zoneId, recordId) => invoke('cf:dnsDelete', zoneId, recordId),
    workers: () => invoke('cf:workers'),
    workerGet: (name) => invoke('cf:workerGet', name),
    workerPut: (name, code) => invoke('cf:workerPut', name, code),
    workerDelete: (name) => invoke('cf:workerDelete', name),
    workerRoutes: (zoneId) => invoke('cf:workerRoutes', zoneId),
    workerRouteCreate: (zoneId, input) => invoke('cf:workerRouteCreate', zoneId, input),
    workerRouteDelete: (zoneId, routeId) => invoke('cf:workerRouteDelete', zoneId, routeId),
    workerTemplate: () => invoke('cf:workerTemplate'),
    pages: () => invoke('cf:pages'),
    pageCreate: (input) => invoke('cf:pageCreate', input),
    pageDelete: (name) => invoke('cf:pageDelete', name),
    pageDomains: (name) => invoke('cf:pageDomains', name),
    pageDomainAdd: (name, domain) => invoke('cf:pageDomainAdd', name, domain),
    pageDomainDelete: (name, domain) => invoke('cf:pageDomainDelete', name, domain),
    pageDeployments: (name) => invoke('cf:pageDeployments', name),
    tunnelConfig: () => invoke('cf:tunnelConfig'),
    list: () => invoke('cf:list'),
    create: (payload) => invoke('cf:create', payload),
    update: (oldHostname, payload) => invoke('cf:update', oldHostname, payload),
    enable: (hostname) => invoke('cf:enable', hostname),
    disable: (hostname) => invoke('cf:disable', hostname),
    remove: (hostname) => invoke('cf:delete', hostname)
  },
  keys: {
    list: () => invoke('keys:list'),
    create: (label) => invoke('keys:create', label),
    revoke: (id) => invoke('keys:revoke', id),
    remove: (id) => invoke('keys:delete', id)
  },
  audit: {
    list: (opts) => invoke('audit:list', opts),
    clear: () => invoke('audit:clear'),
    onEntry: (cb) => ipcRenderer.on('audit:entry', (_e, data) => cb(data))
  },
  server: {
    status: () => invoke('server:status'),
    start: (opts) => invoke('server:start', opts),
    stop: () => invoke('server:stop'),
    onLog: (cb) => ipcRenderer.on('server:log', (_e, data) => cb(data))
  }
});
