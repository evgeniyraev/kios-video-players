const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = !app.isPackaged;

let mainWindow;
let settingsWindow;

const playlistPath = path.join(app.getPath('userData'), 'playlist.json');

function loadPlaylist() {
  try {
    if (fs.existsSync(playlistPath)) {
      return JSON.parse(fs.readFileSync(playlistPath, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load playlist:', e);
  }
  return [];
}

function savePlaylist(playlist) {
  fs.writeFileSync(playlistPath, JSON.stringify(playlist, null, 2));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: !isDev,
    frame: isDev,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (settingsWindow) {
      settingsWindow.close();
    }
    app.quit();
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 500,
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

app.whenReady().then(() => {
  createMainWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

// IPC handlers
ipcMain.handle('get-playlist', () => {
  return loadPlaylist();
});

ipcMain.handle('save-playlist', (event, playlist) => {
  savePlaylist(playlist);
  if (mainWindow) {
    mainWindow.webContents.send('playlist-updated', playlist);
  }
  return true;
});

ipcMain.handle('open-settings', () => {
  createSettingsWindow();
});

ipcMain.handle('get-is-dev', () => {
  return isDev;
});

ipcMain.handle('select-videos', async () => {
  const result = await dialog.showOpenDialog(settingsWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv'] },
    ],
  });
  if (!result.canceled) {
    return result.filePaths;
  }
  return [];
});
