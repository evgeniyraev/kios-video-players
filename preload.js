const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getPlaylist: () => ipcRenderer.invoke('get-playlist'),
  savePlaylist: (playlist) => ipcRenderer.invoke('save-playlist', playlist),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  getIsDev: () => ipcRenderer.invoke('get-is-dev'),
  selectVideos: () => ipcRenderer.invoke('select-videos'),
  selectIcon: () => ipcRenderer.invoke('select-icon'),
  exportConfig: () => ipcRenderer.invoke('export-config'),
  importConfig: () => ipcRenderer.invoke('import-config'),
  getNetworkIPs: () => ipcRenderer.invoke('get-network-ips'),
  generateQR: (text) => ipcRenderer.invoke('generate-qr', text),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onPlaylistUpdated: (callback) => {
    ipcRenderer.on('playlist-updated', (event, playlist) => callback(playlist));
  },
  onPlayVideoIndex: (callback) => {
    ipcRenderer.on('play-video-index', (event, index) => callback(index));
  },
  onSettingsUpdated: (callback) => {
    ipcRenderer.on('settings-updated', (event, settings) => callback(settings));
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // App version / updater
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getUpdateState: () => ipcRenderer.invoke('get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateState: (callback) => {
    ipcRenderer.on('update-state', (event, state) => callback(state));
  },
});
