const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  requestPath: () => ipcRenderer.send('request_path'),
  onSetPath: (callback) => ipcRenderer.on('set_path', (_event, value) => callback(value)),
  debug: (message) => ipcRenderer.send('debug', message),
  info: (message) => ipcRenderer.send('info', message),
  error: (message) => ipcRenderer.send('error', message),
});