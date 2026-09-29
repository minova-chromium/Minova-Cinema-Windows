const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('minova', {
  config: () => ipcRenderer.invoke('config:get'),
  connect: (server, token) => ipcRenderer.invoke('config:connect', { server, token }),
  plexSignIn: {
    start: () => ipcRenderer.invoke('plex-auth:start'),
    awaitAuthorization: () => ipcRenderer.invoke('plex-auth:await'),
    selectServer: (serverId) => ipcRenderer.invoke('plex-auth:select-server', serverId),
    cancel: () => ipcRenderer.invoke('plex-auth:cancel'),
  },
  savePreferences: (preferences) => ipcRenderer.invoke('config:save-preferences', preferences),
  disconnect: () => ipcRenderer.invoke('config:disconnect'),
  loadCatalog: () => ipcRenderer.invoke('catalog:load'),
  details: (key) => ipcRenderer.invoke('media:details', key),
  children: (key) => ipcRenderer.invoke('media:children', key),
  collection: (key) => ipcRenderer.invoke('media:collection', key),
  setWatched: (key, watched) => ipcRenderer.invoke('media:set-watched', { key, watched }),
  setWatchlisted: (providerRatingKey, watchlisted) => ipcRenderer.invoke('media:set-watchlisted', { providerRatingKey, watchlisted }),
  timeline: (item, state, timeMs) => ipcRenderer.invoke('media:timeline', { item, state, timeMs }),
  playback: (key, quality) => ipcRenderer.invoke('playback:resolve', { key, quality }),
  nativePlayer: {
    start: (key, quality) => ipcRenderer.invoke('native-player:start', { key, quality }),
    stop: () => ipcRenderer.invoke('native-player:close'),
    onClosed: (callback) => ipcRenderer.on('native-player:closed', () => callback()),
    onHandoffCompleted: (callback) => ipcRenderer.on('native-player:handoff-complete', (_event, payload) => callback(payload)),
  },
  updates: {
    getState: () => ipcRenderer.invoke('update:get-state'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('update:state', listener);
      return () => ipcRenderer.removeListener('update:state', listener);
    },
  },
  fullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:maximize-toggle'),
    close: () => ipcRenderer.invoke('window:close'),
    state: () => ipcRenderer.invoke('window:state'),
    onState: (callback) => ipcRenderer.on('window:state', (_event, state) => callback(state)),
  },
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
});
