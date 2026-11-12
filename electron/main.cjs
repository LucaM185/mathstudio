// MathStudio – Electron main process
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// When an AppImage update is installed on quit, electron-updater runs the NEW AppImage once with
// this set so it can finish installing; there is nothing to install, so leave at once instead of
// opening a second window while the old one is quitting.
if (process.env.APPIMAGE_EXIT_AFTER_INSTALL === 'true') process.exit(0);

const ROOT = path.join(__dirname, '..');
// A packaged build (Linux AppImage / .deb) carries the engine, a standalone Python with ManimGL,
// ffmpeg and the search model next to app.asar in resources/; from source they live in engine/.
const BUNDLED = app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'python'));
const RES = BUNDLED ? process.resourcesPath : null;
const ENGINE_DIR = BUNDLED ? path.join(RES, 'engine') : path.join(ROOT, 'engine');
const PYTHON = process.env.MATHSTUDIO_PYTHON || (BUNDLED ? path.join(RES, 'python', 'bin', 'python3') : path.join(ENGINE_DIR, '.venv', 'bin', 'python'));
// AppImages can't ship the setuid chrome-sandbox, and Ubuntu 24.04+ blocks the user-namespace
// sandbox for unconfined apps, so Electron would abort at launch. The app only loads its own files.
if (process.platform === 'linux' && process.env.APPIMAGE) app.commandLine.appendSwitch('no-sandbox');
const DATA_DIR = process.env.MATHSTUDIO_DATA || path.join(app.getPath('userData'), 'engine-data');
const AUTOSAVE = path.join(app.getPath('userData'), 'autosave.mstudio');

let win = null;
let engine = null;
let enginePort = null;
let engineReady = null;
let quitting = false;
let restarts = 0;

nativeTheme.themeSource = 'dark';

// ------------------------------------------------------------------ account / plan
// Free or Pro. Until accounts exist this comes from MATHSTUDIO_PLAN or userData/account.json
// ({"plan": "pro"}). The engine gets it too and enforces it: on Free every mobject made from a
// project is public.
const ACCOUNT_FILE = path.join(app.getPath('userData'), 'account.json');
function account() {
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf8')) || {}; } catch (e) { /* none */ }
  const plan = String(process.env.MATHSTUDIO_PLAN || stored.plan || 'free').toLowerCase() === 'pro' ? 'pro' : 'free';
  let name = stored.name;
  if (!name) try { name = require('os').userInfo().username; } catch (e) { name = 'me'; }
  return { plan, name };
}

function startEngine() {
  engineReady = new Promise((resolve, reject) => {
    if (!fs.existsSync(PYTHON)) {
      reject(new Error(`Python environment not found at ${PYTHON}. ${BUNDLED ? 'The installation looks incomplete — reinstall MathStudio.' : 'Run ./setup.sh first.'}`));
      return;
    }
    const env = { ...process.env, PYTHONWARNINGS: 'ignore', MATHSTUDIO_PLAN: account().plan, MATHSTUDIO_AUTHOR: account().name };
    let cwd = ENGINE_DIR;
    if (BUNDLED) {
      // the install dir is read-only: manimgl writes videos/ etc. relative to the cwd
      fs.mkdirSync(DATA_DIR, { recursive: true });
      cwd = DATA_DIR;
      env.PATH = `${path.join(RES, 'python', 'bin')}${path.delimiter}${env.PATH || ''}`; // bundled ffmpeg
      env.PYTHONNOUSERSITE = '1';
      delete env.PYTHONHOME;
      delete env.PYTHONPATH;
      const model = path.join(RES, 'models', 'bge-small-en-v1.5');
      if (!env.MATHSTUDIO_EMBED_MODEL && fs.existsSync(model)) env.MATHSTUDIO_EMBED_MODEL = model;
    }
    const proc = spawn(PYTHON, ['-u', path.join(ENGINE_DIR, 'server.py'), '--port', '0', '--data', DATA_DIR], { cwd, env });
    engine = proc;
    let buf = '';
    let resolved = false;
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/READY (\d+)/);
      if (m && !resolved) {
        resolved = true;
        enginePort = Number(m[1]);
        resolve(enginePort);
        if (win) win.webContents.send('engine:port', enginePort);
      }
    });
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      if (process.env.MATHSTUDIO_VERBOSE) process.stderr.write(s);
    });
    proc.on('exit', (code) => {
      engine = null;
      if (!resolved) reject(new Error(`Engine exited before it was ready (code ${code}).`));
      if (!quitting && restarts < 5) {
        restarts += 1;
        console.error(`[main] engine exited (${code}), restarting…`);
        if (win) win.webContents.send('engine:status', 'restarting');
        setTimeout(startEngine, 500);
      }
    });
  });
  return engineReady;
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open') },
        { label: 'Projects…', accelerator: 'CmdOrCtrl+P', click: () => send('menu', 'projects') },
        { label: 'Open Example Project', click: () => send('menu', 'example') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('menu', 'save') },
        { label: 'Save As…', accelerator: 'Shift+CmdOrCtrl+S', click: () => send('menu', 'saveAs') },
        { type: 'separator' },
        { label: 'Import Media…', accelerator: 'CmdOrCtrl+I', click: () => send('menu', 'import') },
        { label: 'Export Video…', accelerator: 'CmdOrCtrl+E', click: () => send('menu', 'export') },
        { label: 'Export ManimGL Code…', click: () => send('menu', 'exportCode') },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('menu', 'undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send('menu', 'redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Code Panel', accelerator: 'CmdOrCtrl+Shift+C', click: () => send('menu', 'toggleCode') },
        { label: 'AI Agent', accelerator: 'CmdOrCtrl+L', click: () => send('menu', 'agent') },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('menu', 'settings') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1680,
    height: 1020,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#15161a',
    title: 'MathStudio',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'linux' ? { icon: path.join(ROOT, 'packaging', 'icon.png') } : {}),
    trafficLightPosition: { x: 14, y: 22 }, // centred on the project tabs (Chrome-style)
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (process.env.VITE_DEV_URL) win.loadURL(process.env.VITE_DEV_URL);
  else win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  win.once('ready-to-show', () => {
    if (!process.env.MATHSTUDIO_HIDDEN) win.show();
  });
  win.on('close', (e) => {
    // Let the renderer write the project to disk before the window goes away.
    const w = win;
    if (!w || w.__msFlushed || w.webContents.isCrashed()) return;
    e.preventDefault();
    flushRenderer(w).then(() => { if (!w.isDestroyed()) w.close(); });
  });
  win.on('closed', () => { win = null; });
}

/** Ask the renderer to write the open project to disk (at most 2.5 s); afterwards the window closes without asking again. */
function flushRenderer(w) {
  if (w.__msFlushing) return w.__msFlushing;
  w.__msFlushing = new Promise((resolve) => {
    const done = () => {
      ipcMain.removeListener('app:flushed', onFlushed);
      w.__msFlushed = true;
      resolve();
    };
    const onFlushed = (ev) => { if (ev.sender === w.webContents) done(); };
    ipcMain.on('app:flushed', onFlushed);
    setTimeout(done, 2500);
    if (!w.isDestroyed()) w.webContents.send('app:closing');
    else done();
  });
  return w.__msFlushing;
}

// ------------------------------------------------------------------ IPC
ipcMain.handle('engine:port', async () => {
  try {
    return await engineReady;
  } catch (e) {
    return { error: String(e.message || e) };
  }
});

ipcMain.handle('project:open', async () => {
  if (process.env.MATHSTUDIO_TEST_OPEN_PATH) {
    const p = process.env.MATHSTUDIO_TEST_OPEN_PATH;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    touchRecent(p);
    return { path: p, data };
  }
  const r = await dialog.showOpenDialog(win, {
    title: 'Open project',
    filters: [{ name: 'MathStudio Project', extensions: ['mstudio', 'json'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  touchRecent(p);
  return { path: p, data };
});

ipcMain.handle('project:read', async (_e, p) => {
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  touchRecent(p);
  return { path: p, data };
});

ipcMain.handle('project:save', async (_e, { path: p, data, saveAs }) => {
  let target = p || process.env.MATHSTUDIO_TEST_SAVE_PATH;
  if (!target && !saveAs && fileAutosave()) target = uniqueProjectPath(projectsDir(true), safeFileName(data && data.settings && data.settings.name));
  if (!target || saveAs) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Save project',
      defaultPath: path.join(projectsDir(true), safeFileName(data && data.settings && data.settings.name) + '.mstudio'),
      filters: [{ name: 'MathStudio Project', extensions: ['mstudio'] }],
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  // Save As to another file is a copy: it starts with its own history (branched from this one)
  let out = withHid(data, p || null);
  if (p && target !== p && out && out.historyId) out = { ...out, historyId: forkHistory(out.historyId) };
  else if (!p) out = withHid(data, target);
  writeAtomic(target, JSON.stringify(out, null, 2));
  app.addRecentDocument(target);
  touchRecent(target);
  return target;
});

// ------------------------------------------------------------------ projects browser
// Recent projects (most recent first) live in userData; every .mstudio in the projects folder
// (~/Documents/MathStudio) is listed too. Thumbnails are cached per path, keyed by file mtime.
const RECENTS = process.env.MATHSTUDIO_RECENTS || path.join(app.getPath('userData'), 'recent-projects.json');
const THUMBS = path.join(path.dirname(RECENTS), 'project-thumbs');
const MAX_RECENTS = 60;
// Liked projects (paths), shown with a heart and listed first; follows renames, dropped on trash.
const FAVORITES = path.join(path.dirname(RECENTS), 'favorite-projects.json');

function readFavorites() {
  try {
    const j = JSON.parse(fs.readFileSync(FAVORITES, 'utf8'));
    return Array.isArray(j) ? j.filter((p) => typeof p === 'string') : [];
  } catch (e) {
    return [];
  }
}

function writeFavorites(list) {
  try {
    fs.mkdirSync(path.dirname(FAVORITES), { recursive: true });
    fs.writeFileSync(FAVORITES, JSON.stringify([...new Set(list)], null, 2));
  } catch (e) { /* ignore */ }
}

/** A liked file moved (rename / autosave following the project name): keep the like. */
function moveFavorite(from, to) {
  const f = readFavorites();
  if (f.includes(from)) writeFavorites(f.map((p) => (p === from ? to : p)));
}

function projectsDir(create = false) {
  const d = process.env.MATHSTUDIO_PROJECTS_DIR || path.join(app.getPath('documents'), 'MathStudio');
  if (create) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* read-only */ } }
  return d;
}

function safeFileName(name) {
  const n = String(name || 'Untitled').replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
  return n || 'Untitled';
}

/** Projects are saved automatically into the projects folder. Tests that disable autosave
 *  (and don't point MATHSTUDIO_PROJECTS_DIR somewhere temporary) never touch ~/Documents. */
function fileAutosave() {
  return !process.env.MATHSTUDIO_NO_AUTOSAVE || !!process.env.MATHSTUDIO_PROJECTS_DIR;
}

/** "<stem>.mstudio" in dir, or "<stem> 2.mstudio", … — `self` (the file being renamed) counts as free. */
function uniqueProjectPath(dir, stem, self) {
  for (let n = 1; ; n++) {
    const p = path.join(dir, `${stem}${n > 1 ? ' ' + n : ''}.mstudio`);
    if (p === self || !fs.existsSync(p)) return p;
  }
}

function writeAtomic(target, text) {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, target);
}

/**
 * Autosave the open project. A project without a file gets one in the projects folder, named
 * after the project; a project in that folder follows its name (renaming the file). Files
 * opened from elsewhere are saved in place.
 */
ipcMain.handle('project:autosave', async (_e, { path: p, data }) => {
  if (!fileAutosave()) return { disabled: true };
  try {
    const dir = projectsDir(true);
    const stem = safeFileName(data && data.settings && data.settings.name);
    let target = p;
    if (!p) target = uniqueProjectPath(dir, stem);
    else if (path.dirname(p) === dir && path.basename(p, '.mstudio') !== stem) target = uniqueProjectPath(dir, stem, p);
    writeAtomic(target, JSON.stringify(withHid(data, p || null), null, 2));
    if (p && target !== p) {
      try { fs.unlinkSync(p); } catch (e) { /* already gone */ }
      const opened = (readRecents().find((r) => r.path === p) || {}).opened || Date.now();
      writeRecents([{ path: target, opened }, ...readRecents().filter((r) => r.path !== p && r.path !== target)].sort((a, b) => b.opened - a.opened));
      try { fs.renameSync(thumbFile(p), thumbFile(target)); } catch (e) { /* no thumb */ }
      moveFavorite(p, target);
    } else if (!p) {
      touchRecent(target);
    }
    return { path: target };
  } catch (e) {
    return { error: String(e.message || e) };
  }
});

ipcMain.handle('project:autosaveEnabled', () => fileAutosave());

function readRecents() {
  try {
    const j = JSON.parse(fs.readFileSync(RECENTS, 'utf8'));
    return Array.isArray(j) ? j.filter((r) => r && typeof r.path === 'string') : [];
  } catch (e) {
    return [];
  }
}

function writeRecents(list) {
  try {
    fs.mkdirSync(path.dirname(RECENTS), { recursive: true });
    fs.writeFileSync(RECENTS, JSON.stringify(list.slice(0, MAX_RECENTS), null, 2));
  } catch (e) { /* ignore */ }
}

function touchRecent(p) {
  const abs = path.resolve(p);
  writeRecents([{ path: abs, opened: Date.now() }, ...readRecents().filter((r) => r.path !== abs)]);
}

function thumbFile(p) {
  return path.join(THUMBS, require('crypto').createHash('sha1').update(path.resolve(p)).digest('hex') + '.json');
}

function projectInfo(p, opened) {
  const info = { path: p, name: path.basename(p).replace(/\.(mstudio|json)$/i, ''), opened: opened || 0, exists: false, inFolder: false };
  try {
    const st = fs.statSync(p);
    info.exists = true;
    info.mtime = st.mtimeMs;
    info.size = st.size;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const set = data.settings || {};
    info.title = set.name || info.name;
    info.duration = set.duration || 0;
    info.clips = Array.isArray(data.clips) ? data.clips.length : 0;
    info.background = set.background || '#1e1e1e';
    if (HID_RE.test(String(data.historyId))) info.versions = readLog(data.historyId).length;
    try {
      const t = JSON.parse(fs.readFileSync(thumbFile(p), 'utf8'));
      info.thumb = t.png;
      if (t.mtime !== st.mtimeMs) info.thumbStale = true;
    } catch (e) { /* no thumb yet */ }
  } catch (e) {
    if (info.exists) info.error = 'Unreadable project file';
  }
  return info;
}

ipcMain.handle('projects:list', async () => {
  const dir = projectsDir();
  const seen = new Map();
  for (const r of readRecents()) if (!seen.has(r.path)) seen.set(r.path, r.opened);
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/\.mstudio$/i.test(f) || f.startsWith('.')) continue;
      const p = path.join(dir, f);
      if (!seen.has(p)) seen.set(p, 0);
    }
  } catch (e) { /* no folder yet */ }
  const favs = new Set(readFavorites());
  const out = [...seen.entries()].map(([p, opened]) => {
    const info = projectInfo(p, opened);
    info.inFolder = path.dirname(p) === dir;
    if (favs.has(p)) info.favorite = true;
    return info;
  });
  return { dir, projects: out };
});

ipcMain.handle('projects:saveThumb', async (_e, { path: p, png }) => {
  try {
    const st = fs.statSync(p);
    fs.mkdirSync(THUMBS, { recursive: true });
    fs.writeFileSync(thumbFile(p), JSON.stringify({ mtime: st.mtimeMs, png }));
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('projects:favorite', async (_e, { path: p, on }) => {
  const f = readFavorites().filter((x) => x !== p);
  writeFavorites(on ? [p, ...f] : f);
  return !!on;
});

ipcMain.handle('projects:forget', async (_e, p) => {
  writeRecents(readRecents().filter((r) => r.path !== p));
  return true;
});

// ---- MathStudio Trash: deleting a project never destroys it. The file moves into
// <state>/project-trash/<id>/ with a meta.json (where it came from, when, liked, thumbnail) and can
// be restored for TRASH_DAYS days. After that — or on "Delete now" / "Empty Trash" — it goes to
// the macOS Trash (still recoverable from Finder), never straight to unlink.
const TRASH = path.join(path.dirname(RECENTS), 'project-trash');
const TRASH_DAYS = Number(process.env.MATHSTUDIO_TRASH_DAYS) || 30;
const DAY = 86400e3;

/** rename, or copy + verify + unlink across volumes */
function moveFile(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.copyFileSync(from, to);
    if (fs.statSync(to).size !== fs.statSync(from).size) { fs.unlinkSync(to); throw new Error('copy to the trash was incomplete'); }
    fs.unlinkSync(from);
  }
}

function trashItems() {
  let ids = [];
  try { ids = fs.readdirSync(TRASH).filter((d) => !d.startsWith('.')); } catch (e) { return []; }
  const out = [];
  for (const id of ids) {
    const dir = path.join(TRASH, id);
    let files = [];
    try { files = fs.readdirSync(dir); } catch (e) { continue; }
    const file = files.find((f) => /\.(mstudio|json)$/i.test(f) && f !== 'meta.json' && f !== 'thumb.json');
    if (!file) {
      // nothing left to restore (meta only) — tidy up the empty slot
      if (!files.some((f) => f !== 'meta.json')) try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }
      continue;
    }
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch (e) { /* rebuilt below */ }
    const deletedAt = meta.deletedAt || (() => { try { return fs.statSync(dir).mtimeMs; } catch (e) { return Date.now(); } })();
    out.push({ id, dir, file: path.join(dir, file), original: meta.path || path.join(projectsDir(), file), deletedAt, favorite: !!meta.favorite, opened: meta.opened || 0 });
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Send one trashed project on to the macOS Trash. Keeps it here if that fails. */
async function purgeTrashItem(it) {
  if (process.env.MATHSTUDIO_TEST_TRASH_UNLINK) fs.unlinkSync(it.file);
  else await shell.trashItem(it.file);
  fs.rmSync(it.dir, { recursive: true, force: true });
}

async function purgeExpired() {
  for (const it of trashItems()) {
    if (Date.now() - it.deletedAt < TRASH_DAYS * DAY) continue;
    try { await purgeTrashItem(it); } catch (e) { console.error('[trash] could not move expired project to the system Trash:', e.message); }
  }
}

ipcMain.handle('projects:trash', async (_e, p) => {
  try {
    if (!fs.existsSync(p)) return { error: 'That project file no longer exists' };
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const dir = path.join(TRASH, id);
    fs.mkdirSync(dir, { recursive: true });
    const meta = { path: p, deletedAt: Date.now(), favorite: readFavorites().includes(p), opened: (readRecents().find((r) => r.path === p) || {}).opened || 0 };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    try {
      moveFile(p, path.join(dir, path.basename(p)));
    } catch (e) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e2) { /* */ }
      throw e;
    }
    try { moveFile(thumbFile(p), path.join(dir, 'thumb.json')); } catch (e) { /* no thumb */ }
    writeRecents(readRecents().filter((r) => r.path !== p));
    writeFavorites(readFavorites().filter((x) => x !== p));
    return { ok: true, id };
  } catch (e) {
    return { error: String(e.message || e) };
  }
});

ipcMain.handle('projects:trashList', async () => {
  await purgeExpired();
  return {
    days: TRASH_DAYS,
    items: trashItems().map((it) => {
      const info = projectInfo(it.file, it.opened);
      try { info.thumb = JSON.parse(fs.readFileSync(path.join(it.dir, 'thumb.json'), 'utf8')).png; } catch (e) { delete info.thumb; }
      delete info.thumbStale;
      info.name = path.basename(it.original).replace(/\.(mstudio|json)$/i, '');
      return { ...info, id: it.id, original: it.original, deletedAt: it.deletedAt, expires: it.deletedAt + TRASH_DAYS * DAY, favorite: it.favorite, inFolder: path.dirname(it.original) === projectsDir() };
    }),
  };
});

/** Put a trashed project back where it was (or "<name> 2" if that name is taken now). */
ipcMain.handle('projects:restore', async (_e, id) => {
  try {
    const it = trashItems().find((x) => x.id === id);
    if (!it) return { error: 'That project is no longer in the Trash' };
    const home = fs.existsSync(path.dirname(it.original)) ? path.dirname(it.original) : projectsDir(true);
    const stem = path.basename(it.original).replace(/\.(mstudio|json)$/i, '');
    const target = home === path.dirname(it.original) && !fs.existsSync(it.original) ? it.original : uniqueProjectPath(home, stem);
    moveFile(it.file, target);
    try {
      const t = JSON.parse(fs.readFileSync(path.join(it.dir, 'thumb.json'), 'utf8'));
      fs.mkdirSync(THUMBS, { recursive: true });
      fs.writeFileSync(thumbFile(target), JSON.stringify({ mtime: fs.statSync(target).mtimeMs, png: t.png }));
    } catch (e) { /* no thumb */ }
    fs.rmSync(it.dir, { recursive: true, force: true });
    touchRecent(target);
    if (it.favorite) writeFavorites([target, ...readFavorites()]);
    return { path: target };
  } catch (e) {
    return { error: String(e.message || e) };
  }
});

/** "Delete now" (one id) or "Empty Trash" (no id): on to the macOS Trash. */
ipcMain.handle('projects:purge', async (_e, id) => {
  const items = trashItems().filter((x) => !id || x.id === id);
  const errors = [];
  for (const it of items) {
    try { await purgeTrashItem(it); } catch (e) { errors.push(`${path.basename(it.file)}: ${e.message || e}`); }
  }
  return errors.length ? { error: errors.join('\n') } : { ok: true, count: items.length };
});

/** Copy a project next to itself as "<name> copy[ n].mstudio" and rename it inside. */
ipcMain.handle('projects:duplicate', async (_e, p) => {
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const dir = path.dirname(p);
    const stem = path.basename(p).replace(/\.(mstudio|json)$/i, '');
    let n = 1;
    let target;
    do target = path.join(dir, `${stem} copy${n > 1 ? ' ' + n : ''}.mstudio`); while (fs.existsSync(target) && ++n);
    data.settings = { ...(data.settings || {}), name: path.basename(target, '.mstudio') };
    if (data.historyId) data.historyId = forkHistory(HID_RE.test(String(data.historyId)) ? data.historyId : null);
    fs.writeFileSync(target, JSON.stringify(data, null, 2));
    touchRecent(target);
    return { path: target };
  } catch (e) {
    return { error: String(e.message || e) };
  }
});

/** Rename the file on disk (and the project name stored inside it). */
ipcMain.handle('projects:rename', async (_e, { path: p, name }) => {
  try {
    const target = path.join(path.dirname(p), safeFileName(name) + '.mstudio');
    if (target !== p && fs.existsSync(target)) return { error: `A project called "${path.basename(target)}" already exists there.` };
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    data.settings = { ...(data.settings || {}), name: String(name).trim() || 'Untitled' };
    fs.writeFileSync(target, JSON.stringify(data, null, 2));
    if (target !== p) fs.unlinkSync(p);
    const opened = (readRecents().find((r) => r.path === p) || {}).opened || Date.now();
    writeRecents([{ path: target, opened }, ...readRecents().filter((r) => r.path !== p && r.path !== target)].sort((a, b) => b.opened - a.opened));
    moveFavorite(p, target);
    try {
      // same picture, new file: carry the thumbnail over to the new path / mtime
      const t = JSON.parse(fs.readFileSync(thumbFile(p), 'utf8'));
      if (target !== p) fs.unlinkSync(thumbFile(p));
      fs.writeFileSync(thumbFile(target), JSON.stringify({ mtime: fs.statSync(target).mtimeMs, png: t.png }));
    } catch (e) { /* none */ }
    return { path: target };
  } catch (e) {
    return { error: String(e.message || e) };
  }
});

/** Read a project without marking it as recently opened (thumbnails). */
ipcMain.handle('projects:peek', async (_e, p) => {
  try { return { data: JSON.parse(fs.readFileSync(p, 'utf8')) }; } catch (e) { return { error: String(e.message || e) }; }
});

ipcMain.handle('projects:dir', async () => projectsDir(true));

// ------------------------------------------------------------------ version history (⌘S)
// Autosave keeps the file current; ⌘S additionally records a *version* — a git-like commit of the
// whole project plus a small looping GIF of it. Each project file carries a stable `historyId`
// (managed only here: the renderer never sees it, autosave keeps it, Duplicate / Save As fork it)
// so the history follows renames, moves and trash/restore. Layout:
//   <state>/project-history/<hid>/log.json   {commits:[{id,parent,time,message,label?,hash,…}]} oldest first
//   <state>/project-history/<hid>/<cid>.json.gz / .gif / .png
const zlib = require('zlib');
const HISTORY = process.env.MATHSTUDIO_HISTORY || path.join(path.dirname(RECENTS), 'project-history');
const HID_RE = /^h[0-9a-z]{6,40}$/;
const CID_RE = /^[0-9a-f]{12}$/;

const newHid = () => 'h' + Date.now().toString(36) + require('crypto').randomBytes(5).toString('hex');
const histDir = (hid) => {
  if (!HID_RE.test(String(hid))) throw new Error('bad history id');
  return path.join(HISTORY, hid);
};

function readHid(file) {
  try {
    const h = JSON.parse(fs.readFileSync(file, 'utf8')).historyId;
    return HID_RE.test(String(h)) ? h : null;
  } catch (e) {
    return null;
  }
}

function readLog(hid) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(histDir(hid), 'log.json'), 'utf8'));
    return Array.isArray(j.commits) ? j.commits : [];
  } catch (e) {
    return [];
  }
}

function writeLog(hid, commits) {
  const d = histDir(hid);
  fs.mkdirSync(d, { recursive: true });
  writeAtomic(path.join(d, 'log.json'), JSON.stringify({ commits }, null, 1));
}

/** the project as committed: everything but the history id itself */
function contentOf(data) {
  const { historyId, ...rest } = data || {};
  return JSON.stringify(rest);
}
const sha1 = (s) => require('crypto').createHash('sha1').update(s).digest('hex');

function readVersion(hid, cid) {
  if (!CID_RE.test(String(cid))) throw new Error('bad version id');
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(histDir(hid), cid + '.json.gz'))).toString('utf8'));
}

/** A copy of a project (Duplicate, Save As, "Open as copy") gets its own history, starting with
 *  the original's versions — like a git branch. `upTo` stops at that version. */
function forkHistory(hid, upTo) {
  const fresh = newHid();
  if (!hid) return fresh;
  try {
    let commits = readLog(hid);
    if (upTo) {
      const i = commits.findIndex((c) => c.id === upTo);
      if (i >= 0) commits = commits.slice(0, i + 1);
    }
    if (!commits.length) return fresh;
    const from = histDir(hid);
    const to = histDir(fresh);
    fs.mkdirSync(to, { recursive: true });
    for (const c of commits) {
      for (const ext of ['.json.gz', '.gif', '.png']) {
        try { fs.copyFileSync(path.join(from, c.id + ext), path.join(to, c.id + ext)); } catch (e) { /* no preview yet */ }
      }
    }
    writeLog(fresh, commits);
  } catch (e) { /* the copy simply starts without history */ }
  return fresh;
}

/** Autosave / Save write what the renderer has, which never includes the history id: keep it. */
function withHid(data, file) {
  if (!data || typeof data !== 'object' || data.historyId) return data;
  const hid = file && readHid(file);
  return hid ? { ...data, historyId: hid } : data;
}

const clipLabel = (c) => String(c.name || c.item || 'clip');
function listNames(names) {
  const u = [...new Set(names)];
  return u.length <= 3 ? u.join(', ') : `${u.slice(0, 3).join(', ')} +${u.length - 3} more`;
}

/** "Added Circle, Title · Edited Graph · Removed Arrow" — what a version changed since its parent. */
function summarize(prev, next) {
  const clips = Array.isArray(next.clips) ? next.clips : [];
  if (!prev) return { message: `First version · ${clips.length} clip${clips.length === 1 ? '' : 's'}`, stats: { added: clips.length, edited: 0, removed: 0 } };
  const before = new Map((prev.clips || []).map((c) => [c.id, c]));
  const after = new Map(clips.map((c) => [c.id, c]));
  const added = clips.filter((c) => !before.has(c.id));
  const removed = (prev.clips || []).filter((c) => !after.has(c.id));
  const edited = clips.filter((c) => before.has(c.id) && JSON.stringify(before.get(c.id)) !== JSON.stringify(c));
  const parts = [];
  if (added.length) parts.push(`Added ${listNames(added.map(clipLabel))}`);
  if (edited.length) parts.push(`Edited ${listNames(edited.map(clipLabel))}`);
  if (removed.length) parts.push(`Removed ${listNames(removed.map(clipLabel))}`);
  const ps = prev.settings || {};
  const ns = next.settings || {};
  if (ps.name !== ns.name) parts.push(`Renamed to “${ns.name}”`);
  if (ps.duration !== ns.duration && !added.length && !removed.length) parts.push(`Length ${+(+ps.duration || 0).toFixed(2)}s → ${+(+ns.duration || 0).toFixed(2)}s`);
  const { name: _a, duration: _b, ...pRest } = ps;
  const { name: _c, duration: _d, ...nRest } = ns;
  if (JSON.stringify(pRest) !== JSON.stringify(nRest)) parts.push('Scene settings');
  if (JSON.stringify(prev.globals || []) !== JSON.stringify(next.globals || [])) parts.push('Globals');
  if (JSON.stringify(prev.tracks || []) !== JSON.stringify(next.tracks || [])) parts.push('Tracks');
  if (JSON.stringify(prev.imports || []) !== JSON.stringify(next.imports || []) || JSON.stringify(prev.assets || []) !== JSON.stringify(next.assets || [])) parts.push('Imports');
  return { message: parts.join(' · ') || 'Small changes', stats: { added: added.length, edited: edited.length, removed: removed.length } };
}

/**
 * Record a version of the project file at `p` (call after the file was written). Returns the new
 * commit, or `unchanged` with the version it matches when nothing changed since the last one.
 */
ipcMain.handle('history:commit', (_e, { path: p, message, note }) => queued(async () => {
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    let hid = HID_RE.test(String(data.historyId)) ? data.historyId : null;
    if (!hid) {
      hid = newHid();
      const st = fs.statSync(p);
      writeAtomic(p, JSON.stringify({ ...data, historyId: hid }, null, 2));
      // the picture didn't change: keep the project thumbnail fresh for the new mtime
      try {
        const t = JSON.parse(fs.readFileSync(thumbFile(p), 'utf8'));
        if (t.mtime === st.mtimeMs) fs.writeFileSync(thumbFile(p), JSON.stringify({ ...t, mtime: fs.statSync(p).mtimeMs }));
      } catch (e) { /* no thumb */ }
    }
    const content = contentOf(data);
    const hash = sha1(content);
    const commits = readLog(hid);
    const head = commits[commits.length - 1];
    if (head && head.hash === hash && !message) return { hid, unchanged: true, version: commits.length, commit: head };
    let parent = null;
    try { if (head) parent = readVersion(hid, head.id); } catch (e) { /* parent unreadable: summarize from scratch */ }
    const sum = summarize(parent, JSON.parse(content));
    const id = sha1(hash + Date.now() + Math.random()).slice(0, 12);
    const set = data.settings || {};
    const commit = {
      id, parent: head ? head.id : null, time: Date.now(), hash,
      message: String(message || sum.message) + (note ? ` · ${note}` : ''),
      stats: sum.stats,
      name: set.name || path.basename(p, '.mstudio'),
      clips: Array.isArray(data.clips) ? data.clips.length : 0,
      duration: set.duration || 0,
      background: set.background || '#1e1e1e',
    };
    fs.mkdirSync(histDir(hid), { recursive: true });
    fs.writeFileSync(path.join(histDir(hid), id + '.json.gz'), zlib.gzipSync(content));
    writeLog(hid, [...commits, commit]);
    return { hid, commit, version: commits.length + 1 };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}));

/** Versions of the project at `p`, newest first, with their poster frames. */
ipcMain.handle('history:list', async (_e, p) => {
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const hid = HID_RE.test(String(data.historyId)) ? data.historyId : null;
    if (!hid) return { hid: null, commits: [] };
    const curHash = sha1(contentOf(data));
    const dir = histDir(hid);
    const commits = readLog(hid).map((c, i) => {
      const out = { ...c, version: i + 1, hasGif: fs.existsSync(path.join(dir, c.id + '.gif')) };
      try { out.poster = 'data:image/png;base64,' + fs.readFileSync(path.join(dir, c.id + '.png')).toString('base64'); } catch (e) { /* not rendered yet */ }
      return out;
    });
    let cur = -1;
    for (let i = commits.length - 1; i >= 0; i--) if (commits[i].hash === curHash) { cur = i; break; }
    if (cur >= 0) commits[cur].current = true;
    return { hid, commits: commits.reverse(), changedSinceLast: !!commits.length && commits[0].hash !== curHash };
  } catch (e) {
    return { error: String(e.message || e), commits: [] };
  }
});

ipcMain.handle('history:gif', async (_e, { hid, id }) => {
  try {
    if (!CID_RE.test(String(id))) return null;
    return 'data:image/gif;base64,' + fs.readFileSync(path.join(histDir(hid), id + '.gif')).toString('base64');
  } catch (e) {
    return null;
  }
});

/** The renderer drew a version's preview (engine /project-gif): store it next to the version. */
ipcMain.handle('history:attach', async (_e, { hid, id, gif, png }) => {
  try {
    if (!CID_RE.test(String(id))) throw new Error('bad version id');
    const dir = histDir(hid);
    if (!fs.existsSync(path.join(dir, id + '.json.gz'))) return false;
    const b64 = (u) => Buffer.from(String(u).replace(/^data:[^,]*,/, ''), 'base64');
    if (png) fs.writeFileSync(path.join(dir, id + '.png'), b64(png));
    if (gif) fs.writeFileSync(path.join(dir, id + '.gif'), b64(gif));
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('history:read', async (_e, { hid, id }) => {
  try { return { data: readVersion(hid, id) }; } catch (e) { return { error: String(e.message || e) }; }
});

/** Give a version your own name (git: amend the message); empty = back to the automatic one. */
ipcMain.handle('history:label', (_e, { hid, id, label }) => queued(async () => {
  try {
    const commits = readLog(hid);
    const c = commits.find((x) => x.id === id);
    if (!c) return { error: 'That version no longer exists' };
    const l = String(label || '').trim().slice(0, 120);
    if (l) c.label = l;
    else delete c.label;
    writeLog(hid, commits);
    return { ok: true };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}));

/** "Open as copy": a new project file holding that version, with the history up to it. */
ipcMain.handle('history:checkout', (_e, { hid, id, path: p }) => queued(async () => {
  try {
    const data = readVersion(hid, id);
    const version = readLog(hid).findIndex((c) => c.id === id) + 1;
    const base = safeFileName(`${(data.settings && data.settings.name) || path.basename(p || 'Untitled', '.mstudio')} v${version}`);
    const dir = p && fs.existsSync(path.dirname(p)) ? path.dirname(p) : projectsDir(true);
    const target = uniqueProjectPath(dir, base);
    data.settings = { ...(data.settings || {}), name: path.basename(target, '.mstudio') };
    data.historyId = forkHistory(hid, id);
    writeAtomic(target, JSON.stringify(data, null, 2));
    touchRecent(target);
    return { path: target };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}));


ipcMain.handle('account:get', async () => account());

ipcMain.handle('autosave:write', async (_e, data) => {
  try {
    fs.writeFileSync(AUTOSAVE, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
});

// Show the Projects browser when the app opens. Tests (which all disable
// autosave) skip it so the popup doesn't cover the UI they drive.
ipcMain.handle('app:startupProjects', () => {
  if (process.env.MATHSTUDIO_STARTUP_PROJECTS) return process.env.MATHSTUDIO_STARTUP_PROJECTS !== '0';
  return !process.env.MATHSTUDIO_NO_AUTOSAVE;
});

ipcMain.handle('autosave:read', async () => {
  try {
    if (process.env.MATHSTUDIO_NO_AUTOSAVE) return null;
    return JSON.parse(fs.readFileSync(AUTOSAVE, 'utf8'));
  } catch (e) {
    return null;
  }
});

ipcMain.handle('media:choose', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import media',
    filters: [{ name: 'Images & SVG', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled) return [];
  return r.filePaths;
});

ipcMain.handle('export:choosePath', async (_e, { name, format }) => {
  const ext = format || 'mp4';
  if (process.env.MATHSTUDIO_TEST_EXPORT_DIR) return path.join(process.env.MATHSTUDIO_TEST_EXPORT_DIR, `${name}.${ext}`);
  const r = await dialog.showSaveDialog(win, {
    title: 'Export video',
    defaultPath: path.join(app.getPath('videos'), `${name || 'MathStudio'}.${ext}`),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (r.canceled || !r.filePath) return null;
  return r.filePath;
});

ipcMain.handle('export:chooseDir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a folder for the ManimGL project',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

ipcMain.handle('shell:reveal', async (_e, p) => { shell.showItemInFolder(p); });
ipcMain.handle('shell:open', async (_e, p) => { await shell.openPath(p); });
// links from the UI (Settings → "Get a key"); only https pages on an allowlist
ipcMain.handle('open-external', async (_e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol === 'https:' && ['openrouter.ai', 'github.com'].includes(u.hostname)) await shell.openExternal(u.href);
  } catch (e) { /* ignore bad urls */ }
});
ipcMain.handle('window:setTitle', async (_e, t) => { if (win) win.setTitle(t); });

ipcMain.handle('confirm', async (_e, { message, detail, buttons }) => {
  if (process.env.MATHSTUDIO_TEST_CONFIRM) {
    (global.__msConfirms = global.__msConfirms || []).push(message);
    return Number(process.env.MATHSTUDIO_TEST_CONFIRM);
  }
  const r = await dialog.showMessageBox(win, {
    type: 'question', message, detail, buttons: buttons || ['OK', 'Cancel'], defaultId: 0, cancelId: (buttons || []).length - 1,
  });
  return r.response;
});

// ------------------------------------------------------------------ agent checkpoints (git)
// A private git repo holding one file, project.mstudio. A commit is made before every message
// sent to the agent, so any earlier state can be restored with `git show <hash>:project.mstudio`.
const { execFile } = require('child_process');
const CHECKPOINTS = process.env.MATHSTUDIO_CHECKPOINTS || path.join(app.getPath('userData'), 'checkpoints');
const CP_FILE = 'project.mstudio';
let gitQueue = Promise.resolve();

function git(args) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'user.name=MathStudio', '-c', 'user.email=agent@mathstudio.local', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
      { cwd: CHECKPOINTS, maxBuffer: 512 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve(stdout)),
    );
  });
}

/** git calls are serialized: two commits must never race on the index. */
function queued(fn) {
  const p = gitQueue.then(fn, fn);
  gitQueue = p.catch(() => {});
  return p;
}

async function ensureRepo() {
  if (fs.existsSync(path.join(CHECKPOINTS, '.git'))) return;
  fs.mkdirSync(CHECKPOINTS, { recursive: true });
  await git(['init', '-q']);
}

ipcMain.handle('checkpoint:create', (_e, { data, message }) => queued(async () => {
  try {
    await ensureRepo();
    fs.writeFileSync(path.join(CHECKPOINTS, CP_FILE), JSON.stringify(data, null, 2));
    await git(['add', CP_FILE]);
    await git(['commit', '-q', '--allow-empty', '-m', String(message || 'Checkpoint')]);
    return { hash: (await git(['rev-parse', 'HEAD'])).trim() };
  } catch (e) {
    console.error('[checkpoint]', e.message);
    return { error: String(e.message || e) };
  }
}));

ipcMain.handle('checkpoint:read', (_e, hash) => queued(async () => {
  try {
    if (!/^[0-9a-f]{7,64}$/.test(String(hash))) throw new Error('bad checkpoint id');
    return { data: JSON.parse(await git(['show', `${hash}:${CP_FILE}`])) };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}));

ipcMain.handle('checkpoint:dir', async () => CHECKPOINTS);

// ------------------------------------------------------------------ AI agent (OpenRouter)
// The key never reaches the renderer: requests are proxied from here.
const AI_MODEL = process.env.MATHSTUDIO_AI_MODEL || 'anthropic/claude-haiku-5.5';
const AI_URL = 'https://openrouter.ai/api/v1/chat/completions';
const aiRequests = new Map(); // reqId -> AbortController

function readEnvFile() {
  const out = {};
  for (const p of [path.join(ROOT, '.env'), path.join(app.getPath('userData'), '.env')]) {
    try {
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!m || m[1] in out) continue;
        out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
      }
    } catch (e) { /* missing file */ }
  }
  return out;
}

// App settings (Settings tab): render quality + the OpenRouter key typed in the app. Stored as
// plain JSON with owner-only permissions in userData, like a .env file would be.
const SETTINGS_FILE = process.env.MATHSTUDIO_SETTINGS || path.join(app.getPath('userData'), 'settings.json');
const QUALITIES = ['auto', 'high', 'balanced', 'low'];

function readSettings() {
  try {
    const j = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch (e) {
    return {};
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === null) delete next[k];
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  const tmp = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SETTINGS_FILE);
  try { fs.chmodSync(SETTINGS_FILE, 0o600); } catch (e) { /* best effort */ }
  return next;
}

/** The key in use and where it came from. A key typed in Settings wins over the environment and .env files. */
function aiKeyInfo() {
  const typed = String(readSettings().openrouterKey || '').trim();
  if (typed) return { key: typed, source: 'settings' };
  const envKey = process.env.OPENROUTER_KEY || process.env.OPENROUTER_API_KEY;
  if (envKey) return { key: envKey, source: 'environment' };
  const env = readEnvFile(); // re-read so editing .env needs no restart
  const fileKey = env.OPENROUTER_KEY || env.OPENROUTER_API_KEY;
  if (fileKey) return { key: fileKey, source: 'env-file' };
  return { key: '', source: null };
}

function aiKey() {
  return aiKeyInfo().key;
}

function maskKey(k) {
  if (!k) return '';
  return k.length <= 12 ? '•'.repeat(k.length) : `${k.slice(0, 6)}…${k.slice(-4)}`;
}

function publicSettings() {
  const s = readSettings();
  const info = aiKeyInfo();
  return {
    quality: QUALITIES.includes(s.quality) ? s.quality : 'auto',
    key: { set: !!info.key, source: info.source, masked: maskKey(info.key) },
    model: AI_MODEL,
    file: SETTINGS_FILE,
  };
}

ipcMain.handle('settings:get', async () => publicSettings());

ipcMain.handle('settings:set', async (_e, patch) => {
  const p = {};
  if (patch && 'quality' in patch) {
    if (!QUALITIES.includes(patch.quality)) return { error: `unknown quality ${patch.quality}` };
    p.quality = patch.quality;
  }
  if (patch && 'openrouterKey' in patch) {
    const k = patch.openrouterKey == null ? '' : String(patch.openrouterKey).trim();
    if (k && !/^[\x21-\x7e]{8,300}$/.test(k)) return { error: 'That does not look like an API key (no spaces, at least 8 characters).' };
    p.openrouterKey = k || null;
  }
  try {
    writeSettings(p);
  } catch (e) {
    return { error: `Could not save settings: ${e.message}` };
  }
  return publicSettings();
});

/** Check a key against OpenRouter (GET /key: free, no tokens). No argument = the key in use. */
ipcMain.handle('settings:testKey', async (_e, candidate) => {
  const key = String(candidate || '').trim() || aiKey();
  if (!key) return { ok: false, error: 'No key to test.' };
  if (process.env.MATHSTUDIO_TEST_KEYCHECK) return { ok: key === process.env.MATHSTUDIO_TEST_KEYCHECK, label: 'test', error: key === process.env.MATHSTUDIO_TEST_KEYCHECK ? undefined : 'OpenRouter rejected this key (401).' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` }, signal: ctl.signal });
    if (r.status === 401 || r.status === 403) return { ok: false, error: `OpenRouter rejected this key (${r.status}).` };
    if (!r.ok) return { ok: false, error: `OpenRouter answered ${r.status}.` };
    const j = await r.json().catch(() => ({}));
    const d = j.data || {};
    return { ok: true, label: d.label || '', usage: d.usage, limit: d.limit, freeTier: d.is_free_tier };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'No answer from OpenRouter (timeout) — check your connection.' : `Could not reach OpenRouter: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle('ai:status', async () => ({ configured: !!aiKey(), model: AI_MODEL }));

ipcMain.handle('ai:abort', async (_e, reqId) => {
  const c = aiRequests.get(reqId);
  if (c) c.abort();
  return true;
});

/**
 * One streamed chat-completions call. Text / tool-call deltas are forwarded as `ai:event`
 * messages; the promise resolves with the assembled assistant message.
 */
ipcMain.handle('ai:chat', async (e, { reqId, body }) => {
  const key = aiKey();
  if (!key) return { error: 'No OpenRouter key. Add one in Settings (⌘,).', code: 'nokey' };
  const sender = e.sender;
  const emit = (ev) => { if (!sender.isDestroyed()) sender.send('ai:event', { reqId, ...ev }); };
  const ctrl = new AbortController();
  aiRequests.set(reqId, ctrl);
  const msg = { role: 'assistant', content: '', tool_calls: [], reasoning_details: [] };
  let finish = null;
  let usage = null;
  try {
    let res = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(AI_URL, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-Title': 'MathStudio',
        },
        body: JSON.stringify({ model: AI_MODEL, stream: true, usage: { include: true }, ...body }),
      });
      if (res.ok || ![429, 500, 502, 503, 504].includes(res.status)) break;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
    if (!res.ok) {
      const text = await res.text();
      let detail = text;
      try { detail = JSON.parse(text).error?.message || text; } catch (_) { /* not json */ }
      return { error: `OpenRouter ${res.status}: ${String(detail).slice(0, 400)}`, code: res.status === 401 ? 'nokey' : 'http' };
    }
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let j;
        try { j = JSON.parse(data); } catch (_) { continue; }
        if (j.error) return { error: `OpenRouter: ${j.error.message || JSON.stringify(j.error)}`, code: 'stream', partial: msg };
        if (j.usage) usage = j.usage;
        const ch = j.choices && j.choices[0];
        if (!ch) continue;
        if (ch.finish_reason) finish = ch.finish_reason;
        const d = ch.delta || {};
        if (d.content) {
          msg.content += d.content;
          emit({ type: 'text', text: d.content });
        }
        if (d.reasoning) emit({ type: 'reasoning', text: d.reasoning });
        if (Array.isArray(d.reasoning_details)) msg.reasoning_details.push(...d.reasoning_details);
        for (const tc of d.tool_calls || []) {
          const i = tc.index ?? msg.tool_calls.length;
          const t = (msg.tool_calls[i] ||= { id: '', type: 'function', function: { name: '', arguments: '' } });
          if (tc.id) t.id = tc.id;
          if (tc.function?.name) t.function.name += tc.function.name;
          if (tc.function?.arguments) t.function.arguments += tc.function.arguments;
          emit({ type: 'tool', index: i, name: t.function.name, chars: t.function.arguments.length });
        }
      }
    }
  } catch (err) {
    if (ctrl.signal.aborted) return { aborted: true, partial: msg };
    return { error: `Network error: ${err.message || err}`, code: 'network', partial: msg };
  } finally {
    aiRequests.delete(reqId);
  }
  msg.tool_calls = msg.tool_calls.filter(Boolean);
  if (!msg.tool_calls.length) delete msg.tool_calls;
  if (!msg.reasoning_details.length) delete msg.reasoning_details;
  return { message: msg, finish, usage };
});

// ------------------------------------------------------------------ updates
// New versions are GitHub Releases of the repo named in package.json "repository", published by
// .github/workflows/release.yml. An AppImage downloads the new AppImage (only the changed blocks
// when it can) and replaces itself; any other install (.deb, Mac for now) is only told that a new
// version exists, with a link to the download page; running from source there is nothing to do.
// MATHSTUDIO_UPDATE_URL points the updater at a plain folder of release files instead (tests);
// MATHSTUDIO_UPDATE_MODE forces install|notify|source, MATHSTUDIO_UPDATE_CACHE names the download
// cache folder, MATHSTUDIO_UPDATE_DELAY_MS sets the first background check (default 10 s).
const PKG = require('../package.json');
const REPO = (() => {
  const m = String((PKG.repository && PKG.repository.url) || PKG.repository || '').match(/github(?:\.com[:/]|:)([^/\s]+)\/([^/.#\s]+)/);
  return m ? { owner: m[1], repo: m[2] } : null;
})();
const RELEASES_PAGE = REPO ? `https://github.com/${REPO.owner}/${REPO.repo}/releases/latest` : null;
const UPDATE_URL = process.env.MATHSTUDIO_UPDATE_URL || '';
const UPDATE_FIRST_CHECK_MS = Number(process.env.MATHSTUDIO_UPDATE_DELAY_MS) || 10000;
const UPDATE_EVERY_MS = 6 * 3600 * 1000;

function updateMode() {
  const forced = process.env.MATHSTUDIO_UPDATE_MODE;
  if (['install', 'notify', 'source'].includes(forced)) return forced;
  if (!app.isPackaged && !UPDATE_URL) return 'source';
  if (!UPDATE_URL && !REPO) return 'source';
  if (process.platform === 'linux' && process.env.APPIMAGE) return 'install';
  return 'notify';
}

let updater = null;
// state: idle | checking | latest | available | downloading | ready | error
let update = { state: 'idle' };

function publicUpdate() {
  const s = readSettings();
  return {
    ...update,
    mode: updateMode(),
    current: app.getVersion(),
    page: RELEASES_PAGE,
    autoCheck: s.autoCheckUpdates !== false,
    lastCheck: s.lastUpdateCheck || null,
  };
}

function setUpdate(next) {
  update = next;
  send('update:state', publicUpdate());
}

/** GitHub serves release notes as HTML; the panel shows plain text. */
function notesText(notes) {
  if (!notes) return '';
  const raw = Array.isArray(notes) ? notes.map((n) => `${n.version}\n${n.note || ''}`).join('\n\n') : String(notes);
  return raw
    .replace(/<\s*(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000);
}

function getUpdater() {
  if (updater) return updater;
  const { AppImageUpdater } = require('electron-updater');
  const u = new AppImageUpdater();
  // Our own config file only names the download cache; the feed comes from setFeedURL below, so
  // nothing depends on the app-update.yml electron-builder may or may not have written.
  const cfg = path.join(app.getPath('userData'), 'updater.yml');
  const cacheName = (process.env.MATHSTUDIO_UPDATE_CACHE || 'mathstudio-updater').replace(/[^\w.-]/g, '');
  try { fs.writeFileSync(cfg, `updaterCacheDirName: ${cacheName}\n`); } catch (e) { /* read-only? cache falls back to app name */ }
  u.updateConfigPath = cfg;
  u.forceDevUpdateConfig = true; // we decide when the updater may run (updateMode), not electron-updater
  u.autoDownload = false;
  u.autoInstallOnAppQuit = updateMode() === 'install';
  u.allowPrerelease = false;
  u.disableDifferentialDownload = !!process.env.MATHSTUDIO_UPDATE_NO_DIFF;
  u.logger = { info: (m) => console.log('[update]', m), warn: (m) => console.warn('[update]', m), error: (m) => console.error('[update]', m), debug: () => {} };
  // single-range requests for the differential download, like GitHub (which serves no multipart ranges)
  if (UPDATE_URL) u.setFeedURL({ provider: 'generic', url: UPDATE_URL, useMultipleRangeRequest: false });
  else u.setFeedURL({ provider: 'github', owner: REPO.owner, repo: REPO.repo });
  u.on('download-progress', (p) => {
    if (update.state !== 'downloading') return;
    setUpdate({ ...update, percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond });
  });
  updater = u;
  return u;
}

async function checkForUpdate({ silent } = {}) {
  const mode = updateMode();
  if (mode === 'source') return publicUpdate();
  if (['checking', 'downloading'].includes(update.state)) return publicUpdate();
  if (update.state === 'ready') return publicUpdate(); // already downloaded: just restart
  const before = update;
  setUpdate({ state: 'checking', silent: !!silent });
  try {
    const r = await getUpdater().checkForUpdates();
    try { writeSettings({ lastUpdateCheck: new Date().toISOString() }); } catch (e) { /* not fatal */ }
    if (r && r.isUpdateAvailable) {
      const info = r.updateInfo;
      setUpdate({ state: 'available', version: info.version, notes: notesText(info.releaseNotes), date: info.releaseDate || null, silent: !!silent });
    } else {
      setUpdate({ state: 'latest', version: r && r.updateInfo ? r.updateInfo.version : app.getVersion() });
    }
  } catch (e) {
    // A silent background check that fails (offline…) leaves the panel as it was.
    if (silent) setUpdate(before.state === 'checking' ? { state: 'idle' } : before);
    else setUpdate({ state: 'error', error: friendlyUpdateError(e) });
  }
  return publicUpdate();
}

function friendlyUpdateError(e) {
  const msg = String((e && e.message) || e);
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|net::ERR_/i.test(msg)) return 'Could not reach the update server. Check your internet connection.';
  if (/sha512 checksum mismatch/i.test(msg)) return 'The download was corrupted (checksum mismatch). Try again.';
  if (/HttpError: 404|Cannot find latest|No published versions|Unable to find latest version/i.test(msg)) return 'No published release found yet.';
  const http = msg.match(/(?:HttpError: |^)([45]\d\d)\b/);
  if (http) return `The update server answered with an error (HTTP ${http[1]}). Try again later.`;
  if (/EACCES|EPERM|read-only/i.test(msg)) return `MathStudio cannot replace its own file (${msg.split('\n')[0]}). Move the AppImage to a folder you can write to, or download the new version by hand.`;
  return msg.split('\n')[0].slice(0, 300);
}

ipcMain.handle('update:get', async () => publicUpdate());
ipcMain.handle('update:check', async () => checkForUpdate({ silent: false }));

ipcMain.handle('update:download', async () => {
  if (updateMode() !== 'install') return { error: 'This installation cannot update itself — download the new version from the releases page.' };
  if (update.state !== 'available') return publicUpdate();
  const version = update.version;
  setUpdate({ state: 'downloading', version, notes: update.notes, percent: 0 });
  try {
    await getUpdater().downloadUpdate();
    setUpdate({ state: 'ready', version, notes: update.notes });
  } catch (e) {
    setUpdate({ state: 'error', error: friendlyUpdateError(e), version });
  }
  return publicUpdate();
});

ipcMain.handle('update:install', async () => {
  if (update.state !== 'ready') return { error: 'No update downloaded yet.' };
  // Save the open project first: the new version starts before this window is gone.
  if (win && !win.isDestroyed()) await flushRenderer(win);
  quitting = true;
  if (engine) engine.kill();
  setImmediate(() => getUpdater().quitAndInstall(true, true));
  return { ok: true };
});

ipcMain.handle('update:setAuto', async (_e, on) => {
  writeSettings({ autoCheckUpdates: !!on });
  return publicUpdate();
});

ipcMain.handle('update:openPage', async () => {
  if (RELEASES_PAGE) await shell.openExternal(RELEASES_PAGE);
});

function scheduleUpdateChecks() {
  if (updateMode() === 'source') return;
  const tick = () => {
    if (readSettings().autoCheckUpdates === false) return;
    checkForUpdate({ silent: true }).catch(() => {});
  };
  setTimeout(tick, UPDATE_FIRST_CHECK_MS);
  setInterval(tick, UPDATE_EVERY_MS).unref();
}

// ------------------------------------------------------------------ lifecycle
app.whenReady().then(() => {
  buildMenu();
  startEngine().catch((e) => console.error('[main]', e.message));
  createWindow();
  setTimeout(() => purgeExpired().catch(() => {}), 15000);
  scheduleUpdateChecks();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
  if (engine) engine.kill();
});

app.on('window-all-closed', () => {
  quitting = true;
  if (engine) engine.kill();
  app.quit();
});
