// Camera waypoints: the "Camera" row of the timeline must be visible, double-clicking it adds a
// camera keyframe (waypoint), keys show as diamonds joined by a bar, can be dragged in time, the
// camera inspector edits the key at the playhead and the engine renders the interpolated camera.
//   npm run test:camera
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out', 'camera');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-cam-'));
const fails = [];
const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_HIDDEN: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'), MATHSTUDIO_STARTUP_PROJECTS: '0' });
const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
win.on('console', (m) => m.type() === 'error' && !/status of 422/.test(m.text()) && errors.push(m.text()));
await win.setViewportSize({ width: 1600, height: 950 });
await win.waitForSelector('.lib-card', { timeout: 90000 });

const S = (fn, arg) => win.evaluate(fn, arg);
const state = () => S(() => {
  const s = window.__ms.store.getState();
  return { camera: s.project.settings.camera || [], selection: s.selection, time: s.time, meta: s.meta, zoom: s.zoom, fresh: s.metaProject === s.project };
});
const waitFrame = async (pred = () => true, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const st = await state();
    if (st.meta && st.fresh && Math.abs(st.meta.t - st.time) < 1e-6 && pred(st)) return st;
    await win.waitForTimeout(60);
  }
  return state();
};
const setTime = (t) => S((t) => window.__ms.store.getState().setTime(t), t);
const shot = (name) => win.screenshot({ path: path.join(OUT, name) });

// something in the scene so the camera has a point
await S(() => window.__ms.actions.addItem('square', { time: 0, params: { side: 2 } }));
await win.waitForTimeout(300);

console.log('· camera row is visible');
const head = win.getByTestId('camera-track-head');
const lane = win.getByTestId('camera-track');
const hb = await head.boundingBox();
const lb = await lane.boundingBox();
check(hb && hb.height >= 30 && hb.width >= 80, `camera head visible (${JSON.stringify(hb)})`);
check(lb && lb.height >= 30 && lb.width >= 200, `camera lane visible (${JSON.stringify(lb)})`);
check(await head.locator('text=Camera').isVisible(), 'label "Camera" visible');
const hint = win.locator('.cam-hint');
check(await hint.isVisible(), 'empty-lane hint visible');
const laneBg = await lane.evaluate((el) => getComputedStyle(el).backgroundColor);
check(laneBg && laneBg !== 'rgba(0, 0, 0, 0)', `lane has a background (${laneBg})`);
await shot('1_empty.png');

console.log('· double-click adds waypoints');
const zoom = (await state()).zoom;
const xAt = (t) => lb.x + t * zoom;
// the first key away from 0 anchors the default view at t=0 too, so the move animates
await win.mouse.dblclick(xAt(2), lb.y + lb.height / 2);
await win.waitForTimeout(200);
let st = await state();
check(st.camera.length === 2, `2 camera keys (${st.camera.length})`);
check(st.selection.includes('__camera__'), 'camera selected');
check(await win.getByTestId('camera-inspector').isVisible(), 'camera inspector shown');
const keys = win.locator('.cam-key');
check((await keys.count()) === 2, 'two diamonds');
const kb = await keys.nth(1).boundingBox();
check(kb && kb.width >= 8 && kb.height >= 8, `diamond has a size (${JSON.stringify(kb)})`);
check(kb && near(kb.x + kb.width / 2, xAt(2), 3), 'diamond sits at its time');
const span = win.locator('.cam-span');
const sb = await span.first().boundingBox();
check(sb && sb.width > zoom * 1.5, `bar joins the two keys (${JSON.stringify(sb)})`);
check(!(await hint.isVisible().catch(() => false)), 'hint gone once keyed');

console.log('· inspector edits the key at the playhead');
await setTime(2);
await win.waitForTimeout(100);
const zf = win.getByTestId('cam-zoom');
await zf.fill('2');
await zf.press('Enter');
await win.waitForTimeout(150);
st = await state();
const k2 = [...st.camera].sort((a, b) => a.t - b.t)[1];
check(k2 && near(k2.zoom, 2), `key at 2s zoom = 2 (${k2?.zoom})`);
check((await win.locator('.kf-row').count()) === 2, 'keyframe list shows 2 rows');
await shot('2_keys.png');

console.log('· engine interpolates between waypoints');
await setTime(1);
st = await waitFrame((s) => s.meta.camera);
check(st.meta.camera && st.meta.camera.zoom > 1.01 && st.meta.camera.zoom < 1.99, `zoom at 1s between keys (${st.meta.camera?.zoom})`);
await setTime(2);
st = await waitFrame((s) => s.meta.camera && near(s.meta.camera.zoom, 2));
check(st.meta.camera && near(st.meta.camera.zoom, 2), `zoom at 2s = 2 (${st.meta.camera?.zoom})`);

console.log('· drag a waypoint in time');
const kb2 = await keys.nth(1).boundingBox();
await win.mouse.move(kb2.x + kb2.width / 2, kb2.y + kb2.height / 2);
await win.mouse.down();
await win.mouse.move(kb2.x + kb2.width / 2 + zoom, kb2.y + kb2.height / 2, { steps: 6 });
await win.mouse.up();
await win.waitForTimeout(150);
st = await state();
const moved = [...st.camera].sort((a, b) => a.t - b.t)[1];
check(moved && near(moved.t, 3, 0.1), `key dragged to ~3s (${moved?.t})`);

console.log('· K adds a key, double-click on a diamond removes it');
await setTime(4);
await win.locator('.stage').click({ position: { x: 5, y: 5 } }).catch(() => {});
await S(() => window.__ms.store.setState({ selection: ['__camera__'] }));
await win.keyboard.press('k');
await win.waitForTimeout(150);
st = await state();
check(st.camera.length === 3, `K adds a camera key (${st.camera.length})`);
await keys.nth(2).dblclick();
await win.waitForTimeout(150);
st = await state();
check(st.camera.length === 2, `double-click removes it (${st.camera.length})`);
await shot('3_final.png');

check(!errors.length, `no page errors ${errors.slice(0, 3).join(' | ')}`);
await app.close();
fs.rmSync(TMP, { recursive: true, force: true });
if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
console.log('\nall camera track checks passed');
