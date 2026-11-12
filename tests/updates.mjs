// Self-update (Settings → Updates) against a local fake release server — free, no GitHub.
//   node tests/updates.mjs            (from source; npm run test:updates builds first)
// 1. from source: no updater, "git pull" hint
// 2. notify mode (.deb / Mac): up to date → new version with notes + "Open download page" → server
//    error → readable message; "Last checked"; auto-check toggle persists
// 3. background check: toast "MathStudio x is available" + dot on the Settings tab
// 4. install mode (AppImage, faked with $APPIMAGE): corrupted download refused (sha512), then a real
//    download with progress → "Restart to update" → the file is replaced and the new one launched
import { _electron as electron } from 'playwright';
import crypto from 'crypto'; import fs from 'fs'; import http from 'http'; import os from 'os'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.MS_OUT || path.join(ROOT, 'tests', 'out'); fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-updates-'));
const CACHE = `mathstudio-updater-test-${process.pid}`;
const CACHE_DIR = path.join(process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches') : (process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')), CACHE);
const CURRENT = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const fails = []; const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };

// ---- the "new AppImage": a shell script (so launching it is observable) padded to 3 MB
const MARK = path.join(TMP, 'launched.txt');
const NEW_APP = Buffer.concat([
  Buffer.from(`#!/bin/sh\necho "launched $APPIMAGE_SILENT_INSTALL" > '${MARK}'\nexit 0\n`),
  Buffer.from('#' + 'x'.repeat(3 * 1024 * 1024) + '\n'),
]);
const sha512 = (b) => crypto.createHash('sha512').update(b).digest('base64');

// ---- fake release server; `release` decides what latest-*.yml says
let release = null; // { version, sha?, notes?, status? }
const server = http.createServer(async (req, res) => {
  const u = req.url.split('?')[0];
  if (/\/latest(-linux|-mac)?\.yml$/.test(u)) {
    if (!release || release.status) { res.writeHead(release?.status || 404); return res.end('nope'); }
    const sha = release.sha || sha512(NEW_APP);
    res.writeHead(200, { 'content-type': 'text/yaml' });
    return res.end([
      `version: ${release.version}`,
      'files:',
      '  - url: MathStudio-x86_64.AppImage',
      `    sha512: ${sha}`,
      `    size: ${NEW_APP.length}`,
      'path: MathStudio-x86_64.AppImage',
      `sha512: ${sha}`,
      "releaseDate: '2026-11-12T12:00:00.000Z'",
      `releaseNotes: '${(release.notes || '').replace(/'/g, "''")}'`,
      '',
    ].join('\n'));
  }
  if (u.endsWith('/MathStudio-x86_64.AppImage')) {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': NEW_APP.length });
    // slow enough (~4 s) for progress events: electron-updater sends at most one per second
    for (let i = 0; i < NEW_APP.length; i += 128 * 1024) {
      res.write(NEW_APP.subarray(i, i + 128 * 1024));
      await new Promise((r) => setTimeout(r, 170));
    }
    return res.end();
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/releases`;

const SETTINGS = path.join(TMP, 'settings.json');
const launch = async (extra = {}) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE' && !k.startsWith('OPENROUTER') && !k.startsWith('MATHSTUDIO_UPDATE') && k !== 'APPIMAGE'));
  Object.assign(env, { MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_HIDDEN: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'),
    MATHSTUDIO_PROJECTS_DIR: path.join(TMP, 'P'), MATHSTUDIO_RECENTS: path.join(TMP, 'r.json'), MATHSTUDIO_SETTINGS: SETTINGS,
    MATHSTUDIO_STARTUP_PROJECTS: '0', MATHSTUDIO_UPDATE_CACHE: CACHE }, extra);
  const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('   pageerror:', e.message));
  await win.setViewportSize({ width: 2000, height: 1200 });
  await win.waitForSelector('.topbar', { timeout: 120000 });
  return { app, win };
};
const openSettings = async (win) => {
  await win.click('[data-testid=right-tab-settings]');
  await win.waitForSelector('[data-testid=settings-updates]');
  await win.locator('[data-testid=settings-updates]').scrollIntoViewIfNeeded();
};
const stateOf = (win) => win.getAttribute('[data-testid=update-status]', 'data-state');
const waitState = (win, s, timeout = 20000) => win.waitForFunction((s) => document.querySelector('[data-testid=update-status]')?.getAttribute('data-state') === s, s, { timeout });
const shot = (win, name) => win.locator('[data-testid=settings-updates]').screenshot({ path: path.join(OUT, `updates_${name}.png`) });

try {
  // ---------------------------------------------------------------- 1. from source
  console.log('1. running from source');
  {
    const { app, win } = await launch();
    await openSettings(win);
    check((await win.textContent('[data-testid=update-current]')).includes(CURRENT), `shows the current version ${CURRENT}`);
    check(await win.isVisible('[data-testid=update-source]'), 'from source: "git pull" hint, no check button');
    check(!(await win.isVisible('[data-testid=update-check]')), 'no "Check for updates" button');
    await app.close();
  }

  // ---------------------------------------------------------------- 2. notify mode
  console.log('2. notify mode (.deb / Mac)');
  fs.writeFileSync(SETTINGS, JSON.stringify({ autoCheckUpdates: false }));
  {
    const { app, win } = await launch({ MATHSTUDIO_UPDATE_URL: URL_ });
    await openSettings(win);
    release = { version: CURRENT };
    await win.click('[data-testid=update-check]');
    await waitState(win, 'latest');
    check(/up to date/i.test(await win.textContent('[data-testid=update-status]')), 'same version on the server → "You’re up to date"');
    check(await win.isVisible('[data-testid=update-last]'), '"Last checked …" shown');
    check(!!JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).lastUpdateCheck, 'last check time saved');

    release = { version: '9.1.0', notes: '<h2>What’s new</h2><ul><li>Faster <b>previews</b></li><li>Fix &amp; polish</li></ul>' };
    await win.click('[data-testid=update-check]');
    await waitState(win, 'available');
    const notes = await win.textContent('[data-testid=update-notes]');
    check(/9\.1\.0 is available/.test(await win.textContent('[data-testid=update-status]')), 'newer version → "MathStudio 9.1.0 is available"');
    check(notes.includes('• Faster previews') && notes.includes('Fix & polish') && !notes.includes('<'), `release notes as plain text (${JSON.stringify(notes.slice(0, 60))})`);
    check(await win.isVisible('[data-testid=update-open-page]'), 'notify mode → "Open download page"');
    check(!(await win.isVisible('[data-testid=update-download]')), 'notify mode → no "Download update"');
    check(!(await win.isVisible('[data-testid=update-dot]')), 'no dot on the tab while Settings is open');
    await shot(win, 'notify_available');
    const r = await win.evaluate(() => window.studio.updates.download());
    check(!!r.error, 'download refused in notify mode');

    release = { status: 500 };
    await win.click('[data-testid=update-check]');
    await waitState(win, 'error');
    const err = await win.textContent('[data-testid=update-status]');
    check(err.length > 5 && err.length < 400, `server error → readable message (${JSON.stringify(err.trim().slice(0, 90))})`);

    await win.click('[data-testid=update-auto]');
    await win.waitForTimeout(200);
    check(JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).autoCheckUpdates === true, 'auto-check toggle saved to settings.json');
    await app.close();
  }

  // ---------------------------------------------------------------- 3. background check
  console.log('3. background check at launch');
  {
    release = { version: '9.2.0', notes: 'Background' };
    const { app, win } = await launch({ MATHSTUDIO_UPDATE_URL: URL_, MATHSTUDIO_UPDATE_DELAY_MS: '1500' });
    await win.waitForFunction(() => /MathStudio 9\.2\.0 is available/.test(document.body.innerText), null, { timeout: 30000 });
    check(true, 'toast "MathStudio 9.2.0 is available"');
    check(await win.isVisible('[data-testid=update-dot]'), 'dot on the Settings tab');
    await win.click('.toast >> text=View');
    await win.waitForSelector('[data-testid=settings-updates]');
    check(await S(win, () => window.__ms.store.getState().rightTab === 'settings'), 'toast "View" opens Settings');
    check(!(await win.isVisible('[data-testid=update-dot]')), 'dot hidden while Settings is open');
    check((await stateOf(win)) === 'available', 'panel already shows the update');
    await app.close();
  }

  // ---------------------------------------------------------------- 4. install mode (AppImage)
  console.log('4. install mode (AppImage)');
  fs.writeFileSync(SETTINGS, JSON.stringify({ autoCheckUpdates: false }));
  const OLD = path.join(TMP, 'Apps', 'MathStudio-x86_64.AppImage');
  fs.mkdirSync(path.dirname(OLD), { recursive: true });
  fs.writeFileSync(OLD, '#!/bin/sh\necho old\n', { mode: 0o755 });
  {
    const { app, win } = await launch({ MATHSTUDIO_UPDATE_URL: URL_, MATHSTUDIO_UPDATE_MODE: 'install', APPIMAGE: OLD, MATHSTUDIO_UPDATE_NO_DIFF: '1' });
    await openSettings(win);

    release = { version: '9.3.0', notes: 'Corrupt', sha: sha512(Buffer.from('something else')) };
    await win.click('[data-testid=update-check]');
    await waitState(win, 'available');
    check(await win.isVisible('[data-testid=update-download]'), 'install mode → "Download update"');
    await win.click('[data-testid=update-download]');
    await waitState(win, 'error', 60000);
    check(/checksum|corrupt/i.test(await win.textContent('[data-testid=update-status]')), 'corrupted download refused (sha512 mismatch)');
    check(fs.readFileSync(OLD, 'utf8').includes('echo old'), 'installed file untouched');

    release = { version: '9.3.0', notes: 'Good one' };
    await win.click('[data-testid=update-check]');
    await waitState(win, 'available');
    await win.click('[data-testid=update-download]');
    await win.waitForSelector('[data-testid=update-progress]', { timeout: 20000 });
    check(true, 'progress bar while downloading');
    const moved = await win.waitForFunction(() => /Downloading… [1-9]\d*%/.test(document.querySelector('[data-testid=update-status]')?.textContent || ''), null, { timeout: 20000 }).then(() => true, () => false);
    check(moved, 'percentage goes up during the download');
    await shot(win, 'downloading');
    await waitState(win, 'ready', 60000);
    check(/9\.3\.0 is ready/.test(await win.textContent('[data-testid=update-status]')), '"MathStudio 9.3.0 is ready to install"');
    check(await win.isVisible('[data-testid=update-install]'), '"Restart to update" button');
    await shot(win, 'ready');

    const closed = new Promise((r) => app.on('close', r));
    await win.click('[data-testid=update-install]');
    const gone = await Promise.race([closed.then(() => true), new Promise((r) => setTimeout(() => r(false), 20000))]);
    check(gone, 'app quits after "Restart to update"');
    check(sha512(fs.readFileSync(OLD)) === sha512(NEW_APP), 'AppImage replaced in place by the downloaded one');
    await new Promise((r) => setTimeout(r, 1500));
    check(fs.existsSync(MARK) && /launched true/.test(fs.readFileSync(MARK, 'utf8')), 'new AppImage launched (APPIMAGE_SILENT_INSTALL=true)');
    if (!gone) await app.close().catch(() => {});
  }
} finally {
  server.close();
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
}

function S(win, f) { return win.evaluate(f); }
console.log(fails.length ? `\nUPDATES: ${fails.length} FAILED\n - ${fails.join('\n - ')}` : '\nUPDATES: ALL PASS');
process.exit(fails.length ? 1 : 0);
