const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nativePlayer', {
  command: (action, value) => ipcRenderer.invoke('native-player:command', { action, value }),
  close: () => ipcRenderer.invoke('native-player:close'),
  fullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  state: () => ipcRenderer.invoke('native-player:state'),
  onState: (callback) => ipcRenderer.on('native-player:state', (_event, state) => callback(state)),
  onNotice: (callback) => ipcRenderer.on('native-player:notice', (_event, message) => callback(message)),
});
