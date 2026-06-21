const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
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
const iconDir = path.join(userDataPath, 'icons');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(iconDir)) fs.mkdirSync(iconDir, { recursive: true });

function normalizeItem(item) {
  if (typeof item === 'string') return { path: item, key: '', icon: '', loop: false };
  if (!item || typeof item !== 'object') return null;
  return { path: item.path || '', key: item.key || '', icon: item.icon || '', loop: !!item.loop };
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
  menu: {
    enabled: false,
    edge: 'left',
    offset: 100,
    homeStyle: 'house',
    homeIcon: '',
    homeIndex: 0,
    showHelper: true,
    helperIcon: '',
  },
  secretButton: { corner: 'top-left' },
  playback: { playCount: 1 },
  // autoInstallScope: 'none' (manual only) | 'patch' | 'minor' | 'major'
  updates: { autoCheck: true, autoInstallScope: 'none' },
};

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return {
        ...defaultSettings,
        ...saved,
        webserver: { ...defaultSettings.webserver, ...(saved.webserver || {}) },
        menu: { ...defaultSettings.menu, ...(saved.menu || {}) },
        secretButton: { ...defaultSettings.secretButton, ...(saved.secretButton || {}) },
        playback: { ...defaultSettings.playback, ...(saved.playback || {}) },
        updates: { ...defaultSettings.updates, ...(saved.updates || {}) },
      };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return {
    ...defaultSettings,
    menu: { ...defaultSettings.menu },
    webserver: { ...defaultSettings.webserver },
    secretButton: { ...defaultSettings.secretButton },
    playback: { ...defaultSettings.playback },
    updates: { ...defaultSettings.updates },
  };
}

function saveSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function applyAutostart(enabled) {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
}

// ─── Auto-updater (GitHub Releases via electron-updater) ────────────────────
// electron-updater only works in a packaged build; in dev mode we still
// expose the IPC surface so the settings UI can render its "dev mode"
// fallback, but checks/downloads are no-ops.
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
} catch (e) {
  console.warn('electron-updater unavailable:', e.message);
}

// Latest known state, mirrored to the settings window over IPC.
const updateState = {
  status: 'idle',     // 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version: null,      // string version when available/downloaded
  releaseNotes: null,
  progress: null,     // { percent, bytesPerSecond, transferred, total }
  error: null,
};

function broadcastUpdateState() {
  const payload = { ...updateState, currentVersion: app.getVersion(), isPackaged: app.isPackaged };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-state', payload);
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('update-state', payload);
}

// Compare two semver strings; returns true if `next` is allowed under `scope`
// relative to `current`. 'none' rejects everything.
function isWithinScope(currentStr, nextStr, scope) {
  if (!scope || scope === 'none') return false;
  const parse = (v) => String(v).split('.').map(n => parseInt(n, 10) || 0);
  const [cMaj, cMin] = parse(currentStr);
  const [nMaj, nMin] = parse(nextStr);
  if (scope === 'major') return true;
  if (scope === 'minor') return nMaj === cMaj;
  if (scope === 'patch') return nMaj === cMaj && nMin === cMin;
  return false;
}

if (autoUpdater) {
  autoUpdater.on('checking-for-update', () => {
    updateState.status = 'checking';
    updateState.error = null;
    broadcastUpdateState();
  });
  autoUpdater.on('update-available', (info) => {
    updateState.status = 'available';
    updateState.version = info.version;
    updateState.releaseNotes = typeof info.releaseNotes === 'string' ? info.releaseNotes : '';
    updateState.error = null;
    broadcastUpdateState();
    // Auto-install scope decides whether to start the download right away.
    try {
      const scope = (loadSettings().updates || {}).autoInstallScope || 'none';
      if (isWithinScope(app.getVersion(), info.version, scope)) {
        autoUpdater.downloadUpdate().catch(err => console.error('Auto-download failed:', err));
      }
    } catch (err) {
      console.error('Auto-install check failed:', err);
    }
  });
  autoUpdater.on('update-not-available', () => {
    updateState.status = 'not-available';
    broadcastUpdateState();
  });
  autoUpdater.on('download-progress', (progress) => {
    updateState.status = 'downloading';
    updateState.progress = {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    };
    broadcastUpdateState();
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateState.status = 'downloaded';
    updateState.version = info.version;
    updateState.progress = { percent: 100, bytesPerSecond: 0, transferred: 0, total: 0 };
    broadcastUpdateState();
  });
  autoUpdater.on('error', (err) => {
    updateState.status = 'error';
    updateState.error = String((err && err.message) || err);
    broadcastUpdateState();
  });
}

function checkForUpdates() {
  if (!autoUpdater || !app.isPackaged) {
    updateState.status = 'not-available';
    updateState.error = app.isPackaged ? 'Updater unavailable.' : 'Updates only work in installed builds.';
    broadcastUpdateState();
    return Promise.resolve(false);
  }
  return autoUpdater.checkForUpdates().catch(err => {
    console.error('Update check failed:', err);
    updateState.status = 'error';
    updateState.error = String(err.message || err);
    broadcastUpdateState();
    return false;
  });
}

function startWebServer(port) {
  if (webServerInstance) return;
  try {
    const { createWebServer } = require('./server/webserver');
    webServerInstance = createWebServer({
      port,
      uploadDir,
      iconDir,
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

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const settingsItem = {
    label: 'Settings…',
    accelerator: isMac ? 'Cmd+,' : 'Ctrl+,',
    click: () => createSettingsWindow(),
  };

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        settingsItem,
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        ...(isMac ? [] : [settingsItem, { type: 'separator' }]),
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];

  return Menu.buildFromTemplate(template);
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
  Menu.setApplicationMenu(buildAppMenu());
  createMainWindow();

  const playlist = loadPlaylist();
  if (!playlist || playlist.length === 0) {
    createSettingsWindow();
  }

  const settings = loadSettings();
  if (settings.webserver && settings.webserver.enabled) {
    startWebServer(settings.webserver.port || 3000);
  }

  // Kick off an update check on startup if enabled (only in packaged builds).
  if (app.isPackaged && settings.updates && settings.updates.autoCheck !== false) {
    setTimeout(() => checkForUpdates(), 2000);
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

  if (mainWindow) mainWindow.webContents.send('settings-updated', settings);
  return true;
});

ipcMain.handle('open-settings', () => createSettingsWindow());

ipcMain.handle('get-is-dev', () => isDev);

ipcMain.handle('get-app-version', () => app.getVersion());

// ─── Update IPC ────────────────────────────────────────────────────────────
ipcMain.handle('get-update-state', () => ({
  ...updateState,
  currentVersion: app.getVersion(),
  isPackaged: app.isPackaged,
}));

ipcMain.handle('check-for-updates', () => checkForUpdates());

ipcMain.handle('download-update', () => {
  if (!autoUpdater || !app.isPackaged) return false;
  return autoUpdater.downloadUpdate().catch(err => {
    console.error('Download failed:', err);
    updateState.status = 'error';
    updateState.error = String(err.message || err);
    broadcastUpdateState();
    return false;
  });
});

ipcMain.handle('install-update', () => {
  if (!autoUpdater || !app.isPackaged) return false;
  // quitAndInstall(isSilent, isForceRunAfter)
  autoUpdater.quitAndInstall(false, true);
  return true;
});

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

ipcMain.handle('export-config', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(settingsWindow || mainWindow, {
    title: 'Export SimplePlayer config',
    defaultPath: `simpleplayer-config-${today}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return false;
  const data = {
    exportedAt: new Date().toISOString(),
    version: app.getVersion(),
    settings: loadSettings(),
    playlist: loadPlaylist(),
  };
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('Export failed:', e);
    dialog.showErrorBox('Export failed', String(e.message || e));
    return false;
  }
});

ipcMain.handle('import-config', async () => {
  const result = await dialog.showOpenDialog(settingsWindow || mainWindow, {
    title: 'Import SimplePlayer config',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths.length) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
    if (raw.settings && typeof raw.settings === 'object') {
      const merged = {
        ...defaultSettings,
        ...raw.settings,
        webserver: { ...defaultSettings.webserver, ...(raw.settings.webserver || {}) },
        menu: { ...defaultSettings.menu, ...(raw.settings.menu || {}) },
        secretButton: { ...defaultSettings.secretButton, ...(raw.settings.secretButton || {}) },
        playback: { ...defaultSettings.playback, ...(raw.settings.playback || {}) },
        updates: { ...defaultSettings.updates, ...(raw.settings.updates || {}) },
      };
      saveSettings(merged);
    }
    if (Array.isArray(raw.playlist)) {
      const cleaned = raw.playlist.map(normalizeItem).filter(i => i && i.path);
      savePlaylist(cleaned);
    }

    // Apply runtime side-effects
    const s = loadSettings();
    applyAutostart(s.autostart);
    if (s.webserver && s.webserver.enabled && !webServerInstance) startWebServer(s.webserver.port || 3000);
    if ((!s.webserver || !s.webserver.enabled) && webServerInstance) stopWebServer();

    // Notify open windows
    const list = loadPlaylist();
    if (mainWindow) {
      mainWindow.webContents.send('settings-updated', s);
      mainWindow.webContents.send('playlist-updated', list);
    }
    return true;
  } catch (e) {
    console.error('Import failed:', e);
    dialog.showErrorBox('Import failed', 'Could not parse the configuration file.');
    return false;
  }
});

ipcMain.handle('select-icon', async () => {
  const result = await dialog.showOpenDialog(settingsWindow || mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return '';

  const src = result.filePaths[0];
  const ext = path.extname(src);
  const base = path.basename(src, ext);
  let dest = path.join(iconDir, `${base}${ext}`);
  let counter = 1;
  while (fs.existsSync(dest)) {
    dest = path.join(iconDir, `${base}_${counter}${ext}`);
    counter++;
  }
  fs.copyFileSync(src, dest);
  return dest;
});
