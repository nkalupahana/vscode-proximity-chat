const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onSetPath: (callback) => ipcRenderer.on('set_path', (_event, value) => callback(value)),
  requestPath: () => ipcRenderer.send('message', { "command": "request_path"}),
  debug: (message) => ipcRenderer.send('message', { "command": "debug", message }),
  info: (message) => ipcRenderer.send('message', { "command": "info", message }),
  error: (message) => ipcRenderer.send('error', { "command": "error", message }),
});