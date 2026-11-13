// A real AppImage updating itself to a newer real AppImage (run by packaging/linux/test-update.sh
// inside the Linux test container, under Xvfb):
//   MS_APP=/t/MathStudio-x86_64.AppImage MS_NEXT=/srv node tests/linux_update.mjs
// MS_NEXT holds the newer MathStudio-x86_64.AppImage + its latest-linux.yml (Dockerfile artifacts-next).
// Serves them like GitHub would (single-range requests), checks the installed app sees the update,
// downloads it differentially, restarts into it, and that the relaunched app is the new version.
import { _electron as electron } from 'playwright';
import { execSync } from 'child_process';
import crypto from 'crypto'; import fs from 'fs'; import http from 'http'; import os from 'os'; import path from 'path';
const SRC = process.env.MS_APP; const NEXT = process.env.MS_NEXT;
if (!SRC || !NEXT) { console.error('set MS_APP (installed AppImage) and MS_NEXT (folder with the newer one)'); process.exit(2); }
const OUT = process.env.MS_OUT || '/tmp/ms-out'; fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-upd-'));
const fails = []; const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };
const t0 = Date.now(); const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const sha = (p) => crypto.createHash('sha512').update(fs.readFileSync(p)).digest('base64');
const NEXT_VERSION = /version:\s*(\S+)/.exec(fs.readFileSync(path.join(NEXT, 'latest-linux.yml'), 'utf8'))[1].replace(/['"]/g, '');

// ---- static server with single Range support (what GitHub's CDN does)
let served = 0;
const server = http.createServer((req, res) => {
  const f = path.join(NEXT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, ''));
  if (!f.startsWith(NEXT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const size = fs.statSync(f).size;
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const a = +m[1]; const b = m[2] ? Math.min(+m[2], size - 1) : size - 1;
    res.writeHead(206, { 'content-range': `bytes ${a}-${b}/${size}`, 'content-length': b - a + 1, 'accept-ranges': 'bytes' });
    served += b - a + 1;
    return fs.createReadStream(f, { start: a, end: b }).pipe(res);
  }
  res.writeHead(200, { 'content-length': size, 'accept-ranges': 'bytes' });
  if (req.method !== 'HEAD') served += size;
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}`;

// the "installed" AppImage lives in a folder the user can write to
const APP = path.join(os.homedir(), 'Applications', 'MathStudio-x86_64.AppImage');
fs.mkdirSync(path.dirname(APP), { recursive: true });
fs.copyFileSync(SRC, APP); fs.chmodSync(APP, 0o755);
const before = sha(APP);
const SETTINGS = path.join(TMP, 'settings.json');
fs.writeFileSync(SETTINGS, JSON.stringify({ autoCheckUpdates: false }));

const logs = [];
const launch = async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE' && k !== 'DEBUG' && !k.startsWith('OPENROUTER')));
  Object.assign(env, { APPIMAGE_EXTRACT_AND_RUN: '1', MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'),
    MATHSTUDIO_PROJECTS_DIR: path.join(TMP, 'P'), MATHSTUDIO_RECENTS: path.join(TMP, 'r.json'), MATHSTUDIO_SETTINGS: SETTINGS,
    MATHSTUDIO_STARTUP_PROJECTS: '0', MATHSTUDIO_UPDATE_URL: URL_, HF_HUB_OFFLINE: '1', MATHSTUDIO_OFFLINE: '1' });
  const app = await electron.launch({ executablePath: APP, env, timeout: 240000 });
  const grab = (d) => { for (const l of d.toString().split('\n')) if (/\[update\]/.test(l)) { logs.push(l); console.log('     ' + l.trim().slice(0, 220)); } };
  app.process().stdout?.on('data', grab); app.process().stderr?.on('data', grab);
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('   pageerror:', e.message));
  await win.setViewportSize({ width: 1600, height: 950 });
  await win.waitForSelector('.topbar', { timeout: 240000 });
  await win.click('[data-testid=right-tab-settings]');
  await win.waitForSelector('[data-testid=settings-updates]');
  await win.locator('[data-testid=settings-updates]').scrollIntoViewIfNeeded();
  return { app, win };
};
const waitState = (win, s, timeout) => win.waitForFunction((s) => document.querySelector('[data-testid=update-status]')?.getAttribute('data-state') === s, s, { timeout });

try {
  const { app, win } = await launch();
  const v0 = await app.evaluate(({ app }) => app.getVersion());
  const st = await win.evaluate(() => window.studio.updates.get());
  check(st.mode === 'install', `installed AppImage ${v0} can update itself (mode=${st.mode})`);
  await win.click('[data-testid=update-check]');
  await waitState(win, 'available', 60000);
  check((await win.textContent('[data-testid=update-status]')).includes(`${NEXT_VERSION} is available`), `sees ${NEXT_VERSION} on the server (${el()})`);
  served = 0;
  await win.click('[data-testid=update-download]');
  await waitState(win, 'ready', 900000);
  const size = fs.statSync(path.join(NEXT, 'MathStudio-x86_64.AppImage')).size;
  check(true, `downloaded (${el()}): ${(served / 1e6).toFixed(1)} MB transferred for a ${(size / 1e6).toFixed(0)} MB AppImage (${((100 * served) / size).toFixed(0)}%)`);
  await win.locator('[data-testid=settings-updates]').screenshot({ path: path.join(OUT, 'linux_update_ready.png') });

  const closed = new Promise((r) => app.on('close', r));
  await win.click('[data-testid=update-install]');
  check(await Promise.race([closed.then(() => true), new Promise((r) => setTimeout(() => r(false), 60000))]), 'old version quits on "Restart to update"');
  check(sha(APP) === sha(path.join(NEXT, 'MathStudio-x86_64.AppImage')), 'AppImage replaced in place with the new one');
  check(sha(APP) !== before, 'file content changed');
  // the updater starts the new version by itself
  let relaunched = false;
  for (let i = 0; i < 60 && !relaunched; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const ps = execSync('ps -eo args', { encoding: 'utf8' });
    relaunched = ps.split('\n').some((l) => /appimage_extracted|Applications\/MathStudio/.test(l) && !/ps -eo/.test(l));
  }
  check(relaunched, 'new version started automatically');
  // stop the relaunched copy before the next launch; "[a]..." so pkill doesn't also match (and
  // kill) the shell running this very command line
  try { execSync('pkill -f "[a]ppimage_extracted"; pkill -f "[A]pplications/MathStudio"; true'); } catch { /* nothing left */ }
  await new Promise((r) => setTimeout(r, 3000));
} catch (e) {
  check(false, `crashed: ${e.message}`);
}

try {
  const { app, win } = await launch();
  const v1 = await app.evaluate(({ app }) => app.getVersion());
  check(v1 === NEXT_VERSION, `relaunched app is version ${v1}`);
  check((await win.textContent('[data-testid=update-current]')).includes(NEXT_VERSION), 'Settings shows the new version');
  await win.click('[data-testid=update-check]');
  await waitState(win, 'latest', 60000);
  check(true, '"You’re up to date" after the update');
  await win.locator('[data-testid=settings-updates]').screenshot({ path: path.join(OUT, 'linux_update_after.png') });
  await app.close();
} catch (e) {
  check(false, `relaunch crashed: ${e.message}`);
}
server.close();
const diff = logs.find((l) => /Full: .*To download/i.test(l));
if (diff) console.log('   differential:', diff.trim());
console.log(fails.length ? `\nLINUX UPDATE: ${fails.length} FAILED\n - ${fails.join('\n - ')}` : '\nLINUX UPDATE: ALL PASS');
process.exit(fails.length ? 1 : 0);
