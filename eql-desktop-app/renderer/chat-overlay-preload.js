const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqlOverlay', {
  sendChat: function (text) {
    return ipcRenderer.invoke('send-chat', text);
  },
  close: function () {
    return ipcRenderer.invoke('close-chat-overlay');
  },
  onHistory: function (cb) {
    ipcRenderer.on('chat-history', function (e, payload) { cb(payload); });
  },
  onChatMessage: function (cb) {
    ipcRenderer.on('chat-message', function (e, payload) { cb(payload); });
  },
  onChatSystem: function (cb) {
    ipcRenderer.on('chat-system', function (e, payload) { cb(payload); });
  },
  onChatPresence: function (cb) {
    ipcRenderer.on('chat-presence', function (e, users) { cb(users); });
  }
});
