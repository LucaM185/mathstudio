// Autosave survives a restart, and the engine is restarted if it crashes.
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-ud-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
const PDIR = path.join(UD, 'Projects');
Object.assign(env, { MATHSTUDIO_DATA: process.env.MS_DATA || '', MATHSTUDIO_STARTUP_PROJECTS: '0', MATHSTUDIO_PROJECTS_DIR: PDIR, MATHSTUDIO_RECENTS: path.join(UD, 'recents.json') });
let fails = 0;
const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails++; };
const launch = () => electron.launch({ args: [ROOT, `--user-data-dir=${UD}`], env, cwd: ROOT });

let app = await launch();
let win = await app.firstWindow();
await win.waitForSelector('.lib-card', { timeout: 90000 });
await win.click('[data-testid="load-example"]');
await win.waitForTimeout(1500);
const n = await win.evaluate(() => window.__ms.store.getState().project.clips.length);
// kill the engine: the app must recover
const pid = await app.evaluate(async () => { return null; });
const { execSync } = await import('child_process');
execSync(`pkill -f "engine/server.py --port 0 --data ${env.MATHSTUDIO_DATA || ''}" || true`);
await win.waitForTimeout(500);
let recovered = false;
for (let i = 0; i < 60 && !recovered; i++) {
  await win.evaluate(() => window.__ms.store.getState().setTime(Math.random() * 5));
  await win.waitForTimeout(250);
  recovered = await win.evaluate(() => { const s = window.__ms.store.getState(); return s.engineStatus === 'ready' && s.metaProject === s.project && Math.abs(s.meta.t - s.time) < 1e-9; });
}
check(recovered, 'preview recovers after the engine process is killed');
await app.close();

app = await launch();
win = await app.firstWindow();
await win.waitForSelector('.lib-card', { timeout: 90000 });
await win.waitForTimeout(800);
const st = await win.evaluate(() => { const s = window.__ms.store.getState(); return { n: s.project.clips.length, name: s.project.settings.name }; });
check(st.n === n && st.name === 'Pythagoras', `project restored after restart (${st.n} clips, "${st.name}")`);
check(fs.existsSync(path.join(PDIR, 'Pythagoras.mstudio')), 'project was saved into the projects folder');
check(await win.evaluate(() => window.__ms.store.getState().filePath?.endsWith('Pythagoras.mstudio')), 'restored session points at that file');
await app.close();
process.exit(fails ? 1 : 0);
