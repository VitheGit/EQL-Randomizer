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
  sendChat: function (text) {
    return ipcRenderer.invoke('send-chat', text);
  },
  onChatMessage: function (cb) {
    ipcRenderer.on('chat-message', function (e, payload) { cb(payload); });
  },
  toggleChatOverlay: function () {
    return ipcRenderer.invoke('toggle-chat-overlay');
  },
  setChatOverlayOpacity: function (value) {
    return ipcRenderer.invoke('set-chat-overlay-opacity', value);
  },
  getChatOverlayState: function () {
    return ipcRenderer.invoke('get-chat-overlay-state');
  },
  onChatOverlayState: function (cb) {
    ipcRenderer.on('chat-overlay-state', function (e, open) { cb(open); });
  },
  onChatPresence: function (cb) {
    ipcRenderer.on('chat-presence', function (e, users) { cb(users); });
  },
  onChatSystem: function (cb) {
    ipcRenderer.on('chat-system', function (e, payload) { cb(payload); });
  },
  showNotification: function (title, body, kind) {
    return ipcRenderer.invoke('show-notification', { title: title, body: body, kind: kind });
  },
  getWatchStatus: function () {
    return ipcRenderer.invoke('get-watch-status');
  },
  notifyCharacterRolled: function (payload) {
    return ipcRenderer.invoke('character-rolled', payload);
  },
  notifyCharacterLockedSync: function (payload) {
    return ipcRenderer.invoke('character-locked-sync', payload);
  },
  notifyCharacterUnlocked: function () {
    return ipcRenderer.invoke('character-unlocked');
  },
  notifyGroupChanged: function () {
    return ipcRenderer.invoke('group-changed');
  },
  openExternalLink: function (url) {
    return ipcRenderer.invoke('open-external-link', url);
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
  },
  getAppVersion: function () {
    return ipcRenderer.invoke('get-app-version');
  },
  getUpdateStatus: function () {
    return ipcRenderer.invoke('get-update-status');
  },
  checkForUpdates: function () {
    return ipcRenderer.invoke('check-for-updates');
  },
  downloadUpdate: function () {
    return ipcRenderer.invoke('download-update');
  },
  installUpdate: function () {
    return ipcRenderer.invoke('install-update');
  },
  onUpdateStatus: function (callback) {
    ipcRenderer.on('update-status', function (event, payload) { callback(payload); });
  }
});
