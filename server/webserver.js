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

function createWebServer({ port, uploadDir, loadPlaylist, savePlaylist, loadSettings, saveSettings, applyAutostart, getMainWindow }) {
  const express = require('express');
  const multer = require('multer');

  const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext);
      let filename = file.originalname;
      let counter = 1;
      while (fs.existsSync(path.join(uploadDir, filename))) {
        filename = `${base}_${counter}${ext}`;
        counter++;
      }
      cb(null, filename);
    },
  });

  const upload = multer({ storage });
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

  app.get('/', (req, res) => res.redirect('/remote'));

  app.get('/api/playlist', (req, res) => {
    const list = loadPlaylist().map((item, i) => ({
      ...item,
      name: path.basename(item.path),
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
    const updated = { ...loadSettings(), ...req.body };
    if (req.body.webserver) updated.webserver = { ...loadSettings().webserver, ...req.body.webserver };
    saveSettings(updated);
    applyAutostart(updated.autostart);
    res.json({ ok: true });
  });

  app.post('/api/upload', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const playlist = loadPlaylist();
    playlist.push({ path: req.file.path, key: nextAvailableKey(playlist) });
    savePlaylist(playlist);
    const mw = getMainWindow();
    if (mw) mw.webContents.send('playlist-updated', playlist);
    res.json({ ok: true, index: playlist.length - 1 });
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
