const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const isDev = !app.isPackaged;

let mainWindow;
let settingsWindow;
let webServerInstance = null;

const userDataPath = app.getPath('userData');
const playlistPath = path.join(userDataPath, 'playlist.json');
const settingsPath = path.join(userDataPath, 'settings.json');
const uploadDir = path.join(userDataPath, 'uploads');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

function normalizeItem(item) {
  if (typeof item === 'string') return { path: item, key: '' };
  if (!item || typeof item !== 'object') return null;
  return { path: item.path || '', key: item.key || '' };
}

function loadPlaylist() {
  try {
    if (fs.existsSync(playlistPath)) {
      const data = JSON.parse(fs.readFileSync(playlistPath, 'utf-8'));
      return (Array.isArray(data) ? data : [])
        .map(normalizeItem)
        .filter(i => i && i.path);
    }
  } catch (e) {
    console.error('Failed to load playlist:', e);
  }
  return [];
}

function savePlaylist(playlist) {
  fs.writeFileSync(playlistPath, JSON.stringify(playlist, null, 2));
}

const defaultSettings = {
  autoplay: false,
  autostart: false,
  webserver: { enabled: false, port: 3000 },
};

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return {
        ...defaultSettings,
        ...saved,
        webserver: { ...defaultSettings.webserver, ...(saved.webserver || {}) },
      };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return { ...defaultSettings };
}

function saveSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function applyAutostart(enabled) {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
}

function startWebServer(port) {
  if (webServerInstance) return;
  try {
    const { createWebServer } = require('./server/webserver');
    webServerInstance = createWebServer({
      port,
      uploadDir,
      loadPlaylist,
      savePlaylist,
      loadSettings,
      saveSettings,
      applyAutostart,
      getMainWindow: () => mainWindow,
    });
  } catch (e) {
    console.error('Failed to start web server:', e);
  }
}

function stopWebServer() {
  if (webServerInstance) {
    webServerInstance.close();
    webServerInstance = null;
  }
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
    if (settingsWindow) settingsWindow.close();
    app.quit();
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 720,
    height: 620,
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

  const playlist = loadPlaylist();
  if (!playlist || playlist.length === 0) {
    createSettingsWindow();
  }

  const settings = loadSettings();
  if (settings.webserver && settings.webserver.enabled) {
    startWebServer(settings.webserver.port || 3000);
  }
});

app.on('window-all-closed', () => {
  stopWebServer();
  app.quit();
});

// IPC handlers
ipcMain.handle('get-playlist', () => loadPlaylist());

ipcMain.handle('save-playlist', (event, playlist) => {
  savePlaylist(playlist);
  if (mainWindow) mainWindow.webContents.send('playlist-updated', playlist);
  return true;
});

ipcMain.handle('get-settings', () => loadSettings());

ipcMain.handle('save-settings', (event, settings) => {
  saveSettings(settings);
  applyAutostart(settings.autostart);

  const ws = settings.webserver || {};
  if (ws.enabled && !webServerInstance) {
    startWebServer(ws.port || 3000);
  } else if (!ws.enabled && webServerInstance) {
    stopWebServer();
  }

  return true;
});

ipcMain.handle('open-settings', () => createSettingsWindow());

ipcMain.handle('get-is-dev', () => isDev);

ipcMain.handle('get-network-ips', () => {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name in ifaces) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
});

ipcMain.handle('generate-qr', async (event, text) => {
  try {
    const QRCode = require('qrcode');
    return await QRCode.toDataURL(text, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch (e) {
    console.error('QR generation failed:', e);
    return null;
  }
});

ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('select-videos', async () => {
  const result = await dialog.showOpenDialog(settingsWindow || mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv'] },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});
