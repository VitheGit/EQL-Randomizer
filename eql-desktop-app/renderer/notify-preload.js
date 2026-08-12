const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqlToast', {
  onShowToast: function (callback) {
    ipcRenderer.on('show-toast', function (event, payload) { callback(payload); });
  }
});
