const path = require('path');
const fs = require('fs');

const AVAILABLE_KEYS = [
  '1','2','3','4','5','6','7','8','9','0',
  'a','b','c','d','e','f','g','h','i','j','k','l','m',
  'n','o','p','q','r','s','t','u','v','w','x','y','z',
];

function nextAvailableKey(playlist) {
  const used = new Set(playlist.filter(i => i.key).map(i => i.key.toLowerCase()));
  return AVAILABLE_KEYS.find(k => !used.has(k)) || '';
}

function createWebServer({ port, uploadDir, iconDir, loadPlaylist, savePlaylist, loadSettings, saveSettings, applyAutostart, getMainWindow }) {
  const express = require('express');
  const multer = require('multer');

  const makeStorage = (dir) => multer.diskStorage({
    destination: dir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext);
      let filename = file.originalname;
      let counter = 1;
      while (fs.existsSync(path.join(dir, filename))) {
        filename = `${base}_${counter}${ext}`;
        counter++;
      }
      cb(null, filename);
    },
  });

  const upload = multer({ storage: makeStorage(uploadDir) });
  const iconUpload = multer({ storage: makeStorage(iconDir) });
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

  // Serve icon files by basename
  app.get('/icons/:name', (req, res) => {
    const safe = path.basename(req.params.name);
    const full = path.join(iconDir, safe);
    if (!fs.existsSync(full)) return res.status(404).end();
    res.sendFile(full);
  });

  app.get('/', (req, res) => res.redirect('/remote'));

  app.get('/api/playlist', (req, res) => {
    const list = loadPlaylist().map((item, i) => ({
      ...item,
      name: path.basename(item.path),
      iconUrl: item.icon ? `/icons/${path.basename(item.icon)}` : '',
      index: i,
    }));
    res.json(list);
  });

  app.post('/api/playlist', (req, res) => {
    const playlist = req.body;
    savePlaylist(playlist);
    const mw = getMainWindow();
    if (mw) mw.webContents.send('playlist-updated', playlist);
    res.json({ ok: true });
  });

  app.get('/api/settings', (req, res) => {
    res.json(loadSettings());
  });

  app.post('/api/settings', (req, res) => {
    const current = loadSettings();
    const updated = { ...current, ...req.body };
    if (req.body.webserver) updated.webserver = { ...current.webserver, ...req.body.webserver };
    if (req.body.menu) updated.menu = { ...current.menu, ...req.body.menu };
    if (req.body.secretButton) updated.secretButton = { ...current.secretButton, ...req.body.secretButton };
    if (req.body.playback) updated.playback = { ...current.playback, ...req.body.playback };
    if (req.body.updates) updated.updates = { ...current.updates, ...req.body.updates };
    saveSettings(updated);
    applyAutostart(updated.autostart);
    const mw = getMainWindow();
    if (mw) mw.webContents.send('settings-updated', updated);
    res.json({ ok: true });
  });

  app.post('/api/upload', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const playlist = loadPlaylist();
    playlist.push({ path: req.file.path, key: nextAvailableKey(playlist), icon: '', loop: false });
    savePlaylist(playlist);
    const mw = getMainWindow();
    if (mw) mw.webContents.send('playlist-updated', playlist);
    res.json({ ok: true, index: playlist.length - 1 });
  });

  app.post('/api/upload-icon/:index', iconUpload.single('icon'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const index = parseInt(req.params.index);
    const playlist = loadPlaylist();
    if (index < 0 || index >= playlist.length) return res.status(404).json({ error: 'Invalid index' });
    playlist[index].icon = req.file.path;
    savePlaylist(playlist);
    const mw = getMainWindow();
    if (mw) mw.webContents.send('playlist-updated', playlist);
    res.json({ ok: true, iconUrl: `/icons/${path.basename(req.file.path)}` });
  });

  app.delete('/api/icon/:index', (req, res) => {
    const index = parseInt(req.params.index);
    const playlist = loadPlaylist();
    if (index < 0 || index >= playlist.length) return res.status(404).json({ error: 'Invalid index' });
    playlist[index].icon = '';
    savePlaylist(playlist);
    const mw = getMainWindow();
    if (mw) mw.webContents.send('playlist-updated', playlist);
    res.json({ ok: true });
  });

  app.post('/api/upload-menu-icon/:kind', iconUpload.single('icon'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const field = req.params.kind === 'helper' ? 'helperIcon' : 'homeIcon';
    const settings = loadSettings();
    settings.menu = { ...(settings.menu || {}), [field]: req.file.path };
    saveSettings(settings);
    const mw = getMainWindow();
    if (mw) mw.webContents.send('settings-updated', settings);
    res.json({ ok: true, iconUrl: `/icons/${path.basename(req.file.path)}`, path: req.file.path });
  });

  app.delete('/api/menu-icon/:kind', (req, res) => {
    const field = req.params.kind === 'helper' ? 'helperIcon' : 'homeIcon';
    const settings = loadSettings();
    settings.menu = { ...(settings.menu || {}), [field]: '' };
    saveSettings(settings);
    const mw = getMainWindow();
    if (mw) mw.webContents.send('settings-updated', settings);
    res.json({ ok: true });
  });

  app.post('/api/play/:index', (req, res) => {
    const index = parseInt(req.params.index);
    const mw = getMainWindow();
    if (mw) mw.webContents.send('play-video-index', index);
    res.json({ ok: true });
  });

  const server = app.listen(port, () => {
    console.log(`Web server running on http://localhost:${port}`);
  });

  return server;
}

module.exports = { createWebServer };
