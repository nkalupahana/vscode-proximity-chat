const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  requestPath: () => ipcRenderer.send('request_path'),
  onSetPath: (callback) => ipcRenderer.on('set_path', (_event, value) => callback(value))
});