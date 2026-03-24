const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getPlaylist: () => ipcRenderer.invoke('get-playlist'),
  savePlaylist: (playlist) => ipcRenderer.invoke('save-playlist', playlist),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  getIsDev: () => ipcRenderer.invoke('get-is-dev'),
  selectVideos: () => ipcRenderer.invoke('select-videos'),
  onPlaylistUpdated: (callback) => {
    ipcRenderer.on('playlist-updated', (event, playlist) => callback(playlist));
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
