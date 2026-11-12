const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  enginePort: () => ipcRenderer.invoke('engine:port'),
  onEnginePort: (cb) => ipcRenderer.on('engine:port', (_e, p) => cb(p)),
  onEngineStatus: (cb) => ipcRenderer.on('engine:status', (_e, s) => cb(s)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd)),
  onClosing: (cb) => ipcRenderer.on('app:closing', async () => {
    try { await cb(); } finally { ipcRenderer.send('app:flushed'); }
  }),
  openProject: () => ipcRenderer.invoke('project:open'),
  readProject: (p) => ipcRenderer.invoke('project:read', p),
  saveProject: (path, data, saveAs) => ipcRenderer.invoke('project:save', { path, data, saveAs }),
  autosaveProject: (path, data) => ipcRenderer.invoke('project:autosave', { path, data }),
  autosaveEnabled: () => ipcRenderer.invoke('project:autosaveEnabled'),
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    saveThumb: (path, png) => ipcRenderer.invoke('projects:saveThumb', { path, png }),
    forget: (p) => ipcRenderer.invoke('projects:forget', p),
    favorite: (path, on) => ipcRenderer.invoke('projects:favorite', { path, on }),
    trash: (p) => ipcRenderer.invoke('projects:trash', p),
    trashList: () => ipcRenderer.invoke('projects:trashList'),
    restore: (id) => ipcRenderer.invoke('projects:restore', id),
    purge: (id) => ipcRenderer.invoke('projects:purge', id),
    duplicate: (p) => ipcRenderer.invoke('projects:duplicate', p),
    rename: (path, name) => ipcRenderer.invoke('projects:rename', { path, name }),
    dir: () => ipcRenderer.invoke('projects:dir'),
    peek: (p) => ipcRenderer.invoke('projects:peek', p),
  },
  history: {
    commit: (path, opts) => ipcRenderer.invoke('history:commit', { path, ...(opts || {}) }),
    list: (path) => ipcRenderer.invoke('history:list', path),
    gif: (hid, id) => ipcRenderer.invoke('history:gif', { hid, id }),
    attach: (hid, id, gif, png) => ipcRenderer.invoke('history:attach', { hid, id, gif, png }),
    read: (hid, id) => ipcRenderer.invoke('history:read', { hid, id }),
    label: (hid, id, label) => ipcRenderer.invoke('history:label', { hid, id, label }),
    checkout: (hid, id, path) => ipcRenderer.invoke('history:checkout', { hid, id, path }),
  },
  account: () => ipcRenderer.invoke('account:get'),
  autosaveWrite: (data) => ipcRenderer.invoke('autosave:write', data),
  autosaveRead: () => ipcRenderer.invoke('autosave:read'),
  startupProjects: () => ipcRenderer.invoke('app:startupProjects'),
  chooseMedia: () => ipcRenderer.invoke('media:choose'),
  chooseExportPath: (name, format) => ipcRenderer.invoke('export:choosePath', { name, format }),
  chooseDir: () => ipcRenderer.invoke('export:chooseDir'),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  setTitle: (t) => ipcRenderer.invoke('window:setTitle', t),
  confirm: (message, detail, buttons) => ipcRenderer.invoke('confirm', { message, detail, buttons }),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (e) {
      return file && file.path;
    }
  },
  checkpoint: {
    create: (data, message) => ipcRenderer.invoke('checkpoint:create', { data, message }),
    read: (hash) => ipcRenderer.invoke('checkpoint:read', hash),
    dir: () => ipcRenderer.invoke('checkpoint:dir'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    testKey: (key) => ipcRenderer.invoke('settings:testKey', key),
  },
  updates: {
    get: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    setAuto: (on) => ipcRenderer.invoke('update:setAuto', on),
    openPage: () => ipcRenderer.invoke('update:openPage'),
    onState: (cb) => {
      const h = (_e, s) => cb(s);
      ipcRenderer.on('update:state', h);
      return () => ipcRenderer.removeListener('update:state', h);
    },
  },
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    chat: (reqId, body) => ipcRenderer.invoke('ai:chat', { reqId, body }),
    abort: (reqId) => ipcRenderer.invoke('ai:abort', reqId),
    onEvent: (cb) => {
      const h = (_e, ev) => cb(ev);
      ipcRenderer.on('ai:event', h);
      return () => ipcRenderer.removeListener('ai:event', h);
    },
  },
  platform: process.platform,
});
