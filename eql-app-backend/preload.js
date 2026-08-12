const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqlApp', {
  selectLogFile: function () {
    return ipcRenderer.invoke('select-log-file');
  },
  loadSettings: function () {
    return ipcRenderer.invoke('load-settings');
  },
  saveSettings: function (settings) {
    return ipcRenderer.invoke('save-settings', settings);
  },
  showNotification: function (title, body) {
    return ipcRenderer.invoke('show-notification', { title: title, body: body });
  },
  getWatchStatus: function () {
    return ipcRenderer.invoke('get-watch-status');
  },
  notifyCharacterRolled: function () {
    return ipcRenderer.invoke('character-rolled');
  },
  notifyCharacterLockedSync: function () {
    return ipcRenderer.invoke('character-locked-sync');
  },
  notifyCharacterUnlocked: function () {
    return ipcRenderer.invoke('character-unlocked');
  },
  onLevelUpdate: function (callback) {
    ipcRenderer.on('level-update', function (event, level) { callback(level); });
  },
  onCharacterResolved: function (callback) {
    ipcRenderer.on('character-resolved', function (event, payload) { callback(payload); });
  },
  onWatchStatus: function (callback) {
    ipcRenderer.on('watch-status', function (event, payload) { callback(payload); });
  },
  onLogUpdated: function (callback) {
    ipcRenderer.on('log-updated', function (event, log) { callback(log); });
  }
});
