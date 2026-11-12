// Right-click → "Add transform here": the element morphs (TransformInto) into an editable copy of
// itself at that moment; moving / restyling the copy sets what it becomes. Also the empty-lane menu
// and the T shortcut.
//   npm run build && node tests/transform_here.mjs
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out', 'transform');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-tx-'));
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
  return { project: s.project, selection: s.selection, time: s.time, meta: s.meta, zoom: s.zoom, fresh: s.metaProject === s.project, toasts: s.toasts.map((t) => t.text) };
});
const waitFrame = async (pred = () => true, timeout = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const st = await state();
    if (st.meta && st.fresh && Math.abs(st.meta.t - st.time) < 1e-6 && pred(st)) return st;
    await win.waitForTimeout(60);
  }
  return state();
};
const setTime = (t) => S((t) => window.__ms.store.getState().setTime(t), t);
const FW = 14.222222222222221, FH = 8;
const stageBox = () => win.locator('.stage').boundingBox();
const worldToScreen = (b, x, y) => ({ x: b.x + ((x + FW / 2) / FW) * b.width, y: b.y + ((FH / 2 - y) / FH) * b.height });
const pixelAt = (x, y) => S(([x, y]) => {
  const c = document.querySelector('.stage-canvas');
  const r = c.getBoundingClientRect();
  return Array.from(c.getContext('2d').getImageData(Math.round(((x - r.left) / r.width) * c.width), Math.round(((y - r.top) / r.height) * c.height), 1, 1).data);
}, [x, y]);
const shot = (name) => win.screenshot({ path: path.join(OUT, name) });
/** screen point on the timeline at scene time t, in the lane of `clipId` (or lane index) */
const timelinePoint = (t, lane) => S(([t, lane]) => {
  const st = window.__ms.store.getState();
  const el = typeof lane === 'string' ? document.querySelector(`.clip[data-clip="${lane}"]`) : document.querySelectorAll('.tl-lanes .lane')[lane];
  const lanes = document.querySelector('.tl-lanes').getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: lanes.left + t * st.zoom, y: r.top + r.height / 2 };
}, [t, lane]);
const menuItems = () => S(() => [...document.querySelectorAll('.ctx-menu .ctx-item, .ctx-menu [role=menuitem], .ctx-menu button')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled || b.classList.contains('disabled') || b.getAttribute('aria-disabled') === 'true' })));
const clickMenu = async (re) => {
  const items = win.locator('.ctx-menu .ctx-item').filter({ hasText: re });
  await items.first().click();
};
const code = () => S(async () => {
  const st = window.__ms.store.getState();
  const r = await fetch(`http://127.0.0.1:${st.port}/code`, { method: 'POST', body: JSON.stringify({ project: st.project }) });
  return (await r.json()).code;
});

// ------------------------------------------------------------------ setup: one circle 0 → 4s
console.log('\n▶ Right-click a clip → Add transform here');
await S(() => window.__ms.store.getState().loadProject({ version: 1, settings: { name: 'Transform test', duration: 8 }, tracks: [], clips: [], assets: [] }, null));
const A = await S(() => window.__ms.actions.addItem('circle', { time: 0, x: -3, y: 0 }));
await S((id) => window.__ms.store.getState().commit((p) => { const c = p.clips.find((c) => c.id === id); c.enter = { ...c.enter, type: 'none' }; }), A);
await S(() => window.__ms.store.setState({ zoom: 120 }));
await win.waitForTimeout(200);
let p0 = (await state()).project;
check(p0.clips.length === 1 && p0.clips[0].duration === 4, 'one circle clip, 0 → 4s');

const pastBefore = await S(() => window.__ms.store.getState().past.length);
let pt = await timelinePoint(2, A);
await win.mouse.click(pt.x, pt.y, { button: 'right' });
await win.waitForSelector('.ctx-menu', { timeout: 3000 });
const labels = await S(() => document.querySelector('.ctx-menu').innerText);
check(/Add transform here \(2\.00s\)/.test(labels), `clip menu offers "Add transform here (2.00s)" (${labels.split('\n')[0]})`);
await shot('1-menu.png');
await clickMenu(/Add transform here/);
await win.waitForTimeout(200);

let st = await state();
let a = st.project.clips.find((c) => c.id === A);
let b = st.project.clips.find((c) => c.id !== A);
check(st.project.clips.length === 2, 'clip was split into the before and after states');
check(await S(() => window.__ms.store.getState().past.length) === pastBefore + 1, 'adding the transform is one undo step');
check(a && near(a.duration, 3) && a.exit.type === 'TransformInto' && a.exit.target === b?.id && near(a.exit.duration, 1), `first part morphs into the second over 2 → 3s (${JSON.stringify(a?.exit)}, dur ${a?.duration})`);
check(b && near(b.start, 3) && near(b.duration, 1) && b.track === a.track && b.enter.type === 'none', `second part continues on the same track 3 → 4s (${b?.start}, ${b?.duration})`);
check(st.selection.length === 1 && st.selection[0] === b?.id, 'the new state is selected');
check(near(st.time, 3, 1e-3), `playhead parked right after the transform (${st.time})`);
check(st.toasts.some((t) => /Transform added at 2\.00s/.test(t)), 'toast explains what to do next');
check(await win.locator('.tclip').count() === 1, 'timeline shows the transform as its own clip');
const inspName = await S(() => [...document.querySelectorAll('.inspector')].map((e) => e.innerText + ' ' + [...e.querySelectorAll('input')].map((i) => i.value).join(' ')).join('\n'));
check(inspName.includes(b.name), `inspector shows “${b.name}”`);

// ------------------------------------------------------------------ move it in the preview
console.log('\n▶ Move the new state in the preview + restyle it');
st = await waitFrame((s) => s.meta.clips[b.id]);
let box = await stageBox();
const from = worldToScreen(box, -3, 0);
await win.mouse.move(from.x, from.y);
await win.mouse.down();
for (let i = 1; i <= 12; i++) await win.mouse.move(from.x + i * 40, from.y - i * 8, { steps: 1 });
await win.mouse.up();
st = await waitFrame();
a = st.project.clips.find((c) => c.id === A);
b = st.project.clips.find((c) => c.id === b.id);
const unit = box.width / FW;
check(near(b.transform.x, -3 + 480 / unit, 0.25) && near(b.transform.y, 96 / unit, 0.25), `dragging moves the after-state (${b.transform.x.toFixed(2)}, ${b.transform.y.toFixed(2)})`);
check(a.transform.x === -3 && a.transform.y === 0, 'the before-state stays put');
check(!b.keys.length, 'no keyframes were needed');

// restyle through the inspector colour field (fill) → change via store hook used by the field
await S((id) => window.__ms.store.getState().commit((p) => { const c = p.clips.find((c) => c.id === id); c.params = { ...c.params, fill: '#FC6255', stroke: '#FC6255', radius: 1.6 }; }), b.id);
st = await waitFrame((s) => s.meta.clips[b.id]);
const bx = b.transform.x, by = b.transform.y;
const after = worldToScreen(box, bx, by);
let px = await pixelAt(after.x, after.y);
check(px[0] > 80 && px[0] > px[2] + 30, `after the transform: red, at the new place (pixel ${px})`);
px = await pixelAt(from.x, from.y);
check(px[2] < 60, `old place is empty after the transform (pixel ${px})`);
await shot('2-after.png');

await setTime(1.5);
st = await waitFrame((s) => s.meta.clips[A]);
px = await pixelAt(from.x, from.y);
check(px[2] > 60 && px[2] > px[0], `before the transform: blue, at the old place (pixel ${px})`);

await setTime(2.5);
st = await waitFrame((s) => s.meta.clips[A]);
const mid = st.meta.clips[A];
check(!!mid && mid.phase === 'exit', `mid-transform the clip is in its morph (${mid?.phase})`);
const bb = mid?.bbox;
const cx = bb ? (bb[0] + bb[2]) / 2 : NaN;
check(cx > -3 + 0.5 && cx < bx - 0.5, `mid-transform it is on its way (centre x ${cx.toFixed?.(2)}, from -3 to ${bx.toFixed(2)})`);
const midPt = worldToScreen(box, (-3 + bx) / 2, by / 2);
px = await pixelAt(midPt.x, midPt.y);
check(px[0] > 40 || px[1] > 40 || px[2] > 40, `mid-transform frame is drawn (pixel ${px})`);
await shot('3-mid.png');

// ------------------------------------------------------------------ code
console.log('\n▶ Generated code');
let src = await code();
const fn = (await S((id) => window.__ms.store.getState().project.clips.find((c) => c.id === id).id, b.id));
check(src.includes(`exit=("TransformInto", 1.0, "smooth", "${fn}")`) || src.includes(`exit=('TransformInto', 1.0, 'smooth', '${fn}')`), 'scene.py has the TransformInto exit');
check(/# transform: Circle -> Circle 2 {2}\(2\.0s to 3\.0s\)/.test(src), 'scene.py comments the transform and its time');
check(/fill_color="#FC6255"|#FC6255/.test(src), 'the after-state carries its own colour');

// ------------------------------------------------------------------ undo
console.log('\n▶ Undo');
const undoSteps = async (n) => { for (let i = 0; i < n; i++) await S(() => window.__ms.store.getState().undo()); };
while (await S(() => window.__ms.store.getState().past.length) > pastBefore) await undoSteps(1);
st = await state();
check(st.project.clips.length === 1 && near(st.project.clips[0].duration, 4) && st.project.clips[0].exit.type === p0.clips[0].exit.type, `undo restores the single clip (${st.project.clips.length} clips)`);

// ------------------------------------------------------------------ empty lane after the clip
console.log('\n▶ Right-click empty track space after a clip');
pt = await timelinePoint(6, 0);
await win.mouse.click(pt.x, pt.y, { button: 'right' });
await win.waitForSelector('.ctx-menu', { timeout: 3000 });
const laneLabels = await S(() => document.querySelector('.ctx-menu').innerText);
check(/Transform “Circle” here \(6\.00s\)/.test(laneLabels), `lane menu offers to transform the previous element (${laneLabels.split('\n')[0]})`);
await clickMenu(/Transform “Circle” here/);
await win.waitForTimeout(200);
st = await state();
a = st.project.clips.find((c) => c.id === A);
b = st.project.clips.find((c) => c.id !== A);
check(st.project.clips.length === 2 && near(a.duration, 7) && a.exit.target === b?.id, `the circle holds until 6s, morphs 6 → 7s (dur ${a?.duration})`);
check(b && near(b.start, 7) && near(b.duration, 1), `the new state lasts 7 → 8s (${b?.start}, ${b?.duration})`);
await undoSteps(1);

// empty lane with nothing before it
pt = await timelinePoint(2, 1);
await win.mouse.click(pt.x, pt.y, { button: 'right' });
await win.waitForSelector('.ctx-menu', { timeout: 3000 });
const empty = await S(() => document.querySelector('.ctx-menu').innerText);
check(/no element on this track/.test(empty), 'empty track explains there is nothing to transform');
await win.waitForTimeout(150);
await win.keyboard.press('Escape');
await win.waitForTimeout(100);
check(!(await win.$('.ctx-menu')), 'Escape closes the menu');

// ------------------------------------------------------------------ inside the enter animation / T key
console.log('\n▶ T shortcut + clamping');
await S((id) => window.__ms.store.getState().commit((p) => { const c = p.clips.find((c) => c.id === id); c.enter = { type: 'ShowCreation', duration: 1, rate: 'smooth' }; }), A);
await S((id) => window.__ms.store.setState({ selection: [id] }), A);
await setTime(0.4);
await win.click('.timeline .tl-ruler', { position: { x: 5, y: 5 } }).catch(() => {});
await S(() => window.__ms.store.getState().setTime(0.4));
await S((id) => window.__ms.store.setState({ selection: [id] }), A);
await S(() => document.activeElement && document.activeElement.blur());
await win.keyboard.press('t');
await win.waitForTimeout(200);
st = await state();
a = st.project.clips.find((c) => c.id === A);
b = st.project.clips.find((c) => c.id !== A);
check(st.project.clips.length === 2 && a.exit.type === 'TransformInto', 'T adds a transform at the playhead');
check(a && near(a.duration - a.exit.duration, 1.05, 0.01), `a transform inside the enter animation starts once it has finished (${a && (a.duration - a.exit.duration).toFixed(2)}s)`);
await undoSteps(1);

// chained: a second transform on the after-state keeps the chain intact
await S((id) => window.__ms.actions.addTransformAt(id, 1.5), A);
st = await state();
const b1 = st.project.clips.find((c) => c.id !== A);
await S((id) => window.__ms.actions.addTransformAt(id, 3.0), b1.id);
st = await state();
const chain = st.project.clips.slice().sort((x, y) => x.start - y.start);
check(chain.length === 3 && chain[0].exit.target === chain[1].id && chain[1].exit.target === chain[2].id, `two transforms chain A → B → C (${chain.map((c) => `${c.name}@${c.start}`).join(', ')})`);
check(chain.every((c, i) => i === 0 || near(c.start, chain[i - 1].start + chain[i - 1].duration, 1e-3)), 'each state starts exactly when the previous morph ends');
st = await waitFrame();
check(!Object.keys(st.meta.errors || {}).length, `no render errors (${JSON.stringify(st.meta.errors)})`);
await setTime(2.0);
st = await waitFrame((s) => s.meta.clips[A]);
check(st.meta.clips[A]?.phase === 'exit', 'first morph plays');
await shot('4-chain.png');
const tl = await win.$('.timeline');
await tl.screenshot({ path: path.join(OUT, '5-timeline.png') });

check(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
await app.close();
console.log(fails.length ? `\n✗ ${fails.length} failed` : '\n✓ all passed');
process.exit(fails.length ? 1 : 0);
