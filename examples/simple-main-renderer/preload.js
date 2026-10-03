const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  ping: () => ipcRenderer.invoke('ping'),
  sendSyncTest: () => ipcRenderer.sendSync('sync-channel', 'hello'),
});
