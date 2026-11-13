// Smoke test for a packaged build — Linux (run inside packaging/linux/test.sh's container, under Xvfb):
//   MS_APP=/opt/MathStudio/mathstudio node tests/linux_smoke.mjs
// or macOS (launched with Finder's minimal PATH; afterwards the bundle's signature must still verify):
//   MS_APP=release/mac-arm64/MathStudio.app/Contents/MacOS/MathStudio node tests/linux_smoke.mjs
// Engine boots from the bundled Python, library thumbnails render, GL renderer detected, Auto picks
// Low on software GL, semantic search works offline from the bundled model, preview renders a
// clip, an mp4 export goes through the bundled ffmpeg, LaTeX-less systems get a readable error.
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
const APP = process.env.MS_APP;
if (!APP) { console.error('set MS_APP to the packaged binary'); process.exit(2); }
const TAG = process.env.MS_TAG || 'app';
const OUT = process.env.MS_OUT || '/tmp/ms-out'; fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-linux-'));
const fails = []; const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };
const t0 = Date.now(); const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE' && k !== 'DEBUG' && !k.startsWith('OPENROUTER')));
Object.assign(env, { MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'), MATHSTUDIO_PROJECTS_DIR: path.join(TMP, 'P'),
  MATHSTUDIO_RECENTS: path.join(TMP, 'r.json'), MATHSTUDIO_SETTINGS: path.join(TMP, 'settings.json'), MATHSTUDIO_STARTUP_PROJECTS: '0',
  HF_HUB_OFFLINE: '1', MATHSTUDIO_OFFLINE: '1', MATHSTUDIO_JOB_TIMEOUT: '120' });
const MAC = process.platform === 'darwin';
if (MAC) env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'; // what an app opened from Finder / the Dock gets
const app = await electron.launch({ executablePath: APP, args: process.env.MS_NO_SANDBOX ? ['--no-sandbox'] : [], env, timeout: 180000 });
app.process().stderr?.on('data', (d) => { const s = d.toString(); if (/error|Traceback/i.test(s) && !/GPU|gpu_|dbus|Fontconfig|viz|ALSA|libva/i.test(s)) process.stdout.write(`   [stderr] ${s.slice(0, 400)}`); });
const win = await app.firstWindow();
win.on('pageerror', (e) => console.log('   pageerror:', e.message));
await win.setViewportSize({ width: 1600, height: 950 });
await win.waitForSelector('.topbar', { timeout: 180000 });
await win.waitForFunction(() => window.__ms.store.getState().engineStatus === 'ready', null, { timeout: 300000 });
check(true, `engine ready from the bundled Python (${el()})`);
const port = await win.evaluate(() => window.__ms.store.getState().port);
const get = (p) => win.evaluate(async ([port, p]) => (await fetch(`http://127.0.0.1:${port}${p}`)).json(), [port, p]);
const post = (p, body) => win.evaluate(async ([port, p, body]) => (await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', body: JSON.stringify(body) })).json(), [port, p, body]);

// GL renderer + Auto quality
await win.waitForFunction(() => !!window.__ms.store.getState().gl, null, { timeout: 60000 });
const gl = await win.evaluate(() => window.__ms.store.getState().gl);
check(!!gl.renderer, `GL renderer: ${gl.renderer} (${gl.version}), software=${gl.software}`);
if (gl.software) check((await win.evaluate(() => window.__ms.store.getState().renderQuality)) === 'auto', 'quality defaults to Auto (→ Low on software GL)');

// library thumbnails
await win.waitForFunction(() => [...document.querySelectorAll('.lib-card img')].filter((i) => i.complete && i.naturalWidth > 0).length >= 6, null, { timeout: 600000 });
check(true, `library thumbnails render (${el()})`);
await win.screenshot({ path: path.join(OUT, `${TAG}_library.png`) });

// semantic search from the bundled model, offline
let sr = null;
for (let i = 0; i < 120; i++) {
  sr = await get('/search?q=' + encodeURIComponent('wave that goes up and down'));
  if (sr.semantic || sr.status === 'unavailable') break;
  await win.waitForTimeout(2000);
}
check(sr.semantic === true, `semantic search ready offline (status ${sr.status}, top: ${sr.results.slice(0, 3).map((r) => r.id).join(', ')})`);

// preview renders a clip
const cid = await win.evaluate(() => window.__ms.actions.addItem('circle', { time: 0 }));
await win.evaluate(() => window.__ms.store.getState().setTime(1.5));
await win.waitForFunction((id) => !!window.__ms.store.getState().meta?.clips?.[id], cid, { timeout: 120000 });
await win.waitForTimeout(1500);
const meta = await win.evaluate(() => window.__ms.store.getState().meta);
check(meta.w <= (gl.software ? 960 : 1920), `preview frame ${meta.w}×${meta.h} in ${meta.ms} ms`);
const px = await win.evaluate(() => {
  const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let lit = 0; for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 200) lit++; return lit;
});
check(px > 50, `circle visible in the preview canvas (${px} bright samples)`);
await win.screenshot({ path: path.join(OUT, `${TAG}_preview.png`) });

// export an mp4 through the bundled ffmpeg (short + small so emulated CI stays quick)
const project = await win.evaluate(() => { const p = structuredClone(window.__ms.store.getState().project); p.settings.duration = 2; return p; });
const outFile = path.join(TMP, 'export.mp4');
const job = await post('/export', { project, out: outFile, format: 'mp4', resolution: [640, 360], fps: 15 });
check(!!job.job, `export started (${job.error || job.job})`);
let st = {};
for (let i = 0; i < 300 && job.job; i++) {
  st = await get(`/export/${job.job}`);
  if (st.status !== 'running') break;
  await win.waitForTimeout(1000);
}
const size = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
check(st.status === 'done' && size > 2000, `mp4 export done (${st.status}, ${size} bytes, ${el()})${st.status !== 'done' ? '\n' + String(st.log || '').slice(-1200) : ''}`);

// LaTeX item without a TeX install: error must say what to install
const hasLatex = ['/usr/bin/latex', '/Library/TeX/texbin/latex'].some((f) => fs.existsSync(f));
const tid = await win.evaluate(() => window.__ms.actions.addItem('tex', { time: 0 }));
await win.waitForFunction((id) => { const m = window.__ms.store.getState().meta; return m && (m.errors?.[id] || m.clips?.[id]); }, tid, { timeout: 120000 }).catch(() => {});
await win.waitForTimeout(1000);
const terr = await win.evaluate((id) => window.__ms.store.getState().meta?.errors?.[id] || '', tid);
if (hasLatex) check(!terr, 'Equation renders with the system LaTeX');
else check(/LaTeX/i.test(terr) && /apt|install/i.test(terr), `Equation without LaTeX explains the fix: "${terr.slice(0, 160)}"`);

// settings tab
await win.click('[data-testid=right-tab-settings]');
await win.waitForSelector('[data-testid=settings-panel]');
await win.waitForTimeout(500);
await win.screenshot({ path: path.join(OUT, `${TAG}_settings.png`) });

await app.close();
const ro = !fs.readdirSync(path.dirname(APP)).some((f) => f === 'videos');
check(ro, 'nothing written next to the app binary');
if (MAC) {
  const bundle = APP.replace(/\/Contents\/MacOS\/[^/]+$/, '');
  const v = (await import('child_process')).spawnSync('codesign', ['--verify', '--deep', '--strict', bundle], { encoding: 'utf8' });
  check(v.status === 0, `app signature still valid after running (nothing written into the bundle)${v.status ? ': ' + v.stderr.slice(0, 300) : ''}`);
}
console.log(fails.length ? `FAILED ${fails.length}` : `ALL PASS (${el()})`); process.exit(fails.length ? 1 : 0);
