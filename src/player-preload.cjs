const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nativePlayer', {
  command: (action, value) => ipcRenderer.invoke('native-player:command', { action, value }),
  handoff: () => ipcRenderer.invoke('native-player:handoff'),
  close: () => ipcRenderer.invoke('native-player:close'),
  fullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  miniPlayer: (enabled) => ipcRenderer.invoke('window:mini-player', enabled),
  pinMiniPlayer: (enabled) => ipcRenderer.invoke('window:mini-player-pin', enabled),
  miniPlayerState: () => ipcRenderer.invoke('window:mini-player-state'),
  resizeMiniPlayer: (size) => ipcRenderer.invoke('window:mini-player-resize', size),
  moveMiniPlayer: (position) => ipcRenderer.invoke('window:mini-player-move', position),
  state: () => ipcRenderer.invoke('native-player:state'),
  onState: (callback) => ipcRenderer.on('native-player:state', (_event, state) => callback(state)),
  onNotice: (callback) => ipcRenderer.on('native-player:notice', (_event, message) => callback(message)),
  onWindowMode: (callback) => ipcRenderer.on('native-player:window-mode', (_event, mode) => callback(mode)),
});
