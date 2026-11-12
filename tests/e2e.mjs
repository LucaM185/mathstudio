// End-to-end UI test: drives the real Electron app with the mouse and keyboard.
//   npm run test:e2e            (screenshots go to tests/out/)
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.E2E_OUT || path.join(ROOT, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-e2e-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, {
  MATHSTUDIO_NO_AUTOSAVE: '1',
  MATHSTUDIO_DATA: process.env.MS_DATA || path.join(TMP, 'data'),
  MATHSTUDIO_TEST_SAVE_PATH: path.join(TMP, 'project.mstudio'),
  MATHSTUDIO_TEST_EXPORT_DIR: TMP,
  MATHSTUDIO_TEST_CONFIRM: '0',
});

const fails = [];
let step = 0;
const check = (cond, msg) => {
  if (!cond) {
    fails.push(msg);
    console.log('   ✗', msg);
  } else console.log('   ✓', msg);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await win.waitForSelector('.lib-card', { timeout: 90000 });

const S = (fn, arg) => win.evaluate(fn, arg);
const state = () => S(() => {
  const s = window.__ms.store.getState();
  return { project: s.project, selection: s.selection, time: s.time, meta: s.meta, zoom: s.zoom, playing: s.playing, past: s.past.length, fresh: s.metaProject === s.project, editorView: s.editorView };
});
const shot = async (name) => win.screenshot({ path: path.join(OUT, `${String(++step).padStart(2, '0')}-${name}.png`) });
const waitFrame = async (pred = () => true, timeout = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const st = await state();
    if (st.meta && st.fresh && Math.abs(st.meta.t - st.time) < 1e-6 && pred(st)) return st;
    await win.waitForTimeout(60);
  }
  return state();
};
const stageBox = async () => win.locator('.stage').boundingBox();
const FW = 14.222222222222221;
const FH = 8;
const worldToScreen = (b, x, y) => ({ x: b.x + ((x + FW / 2) / FW) * b.width, y: b.y + ((FH / 2 - y) / FH) * b.height });
const pixelAt = (x, y) =>
  win.evaluate(([x, y]) => {
    const c = document.querySelector('.stage-canvas');
    const r = c.getBoundingClientRect();
    const px = Math.round(((x - r.left) / r.width) * c.width);
    const py = Math.round(((y - r.top) / r.height) * c.height);
    return Array.from(c.getContext('2d').getImageData(px, py, 1, 1).data);
  }, [x, y]);
const setTime = (t) => win.evaluate((t) => window.__ms.store.getState().setTime(t), t);

await win.waitForTimeout(800);
await shot('empty');
console.log('0. library previews');
await win.locator('.lib-card[data-item="star"]').scrollIntoViewIfNeeded();
const sb = await win.locator('.lib-card[data-item="star"] .lib-thumb').boundingBox();
await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
await win.mouse.move(sb.x + sb.width / 2 + 2, sb.y + sb.height / 2 + 1);
await win.waitForTimeout(1500);
const gif = await win.evaluate(() => { const i = document.querySelector('.lib-card[data-item="star"] img'); return { src: i.src, w: i.naturalWidth, done: i.complete }; });
check(gif.src.includes('.gif') && gif.w > 0, `hovering a card plays its animated GIF (${gif.w}px)`);
await win.mouse.move(5, 500);
// thumbnails load lazily: every card visible in the library must have its still within a few seconds
const visibleThumbs = () => win.evaluate(() => {
  const view = document.querySelector('.lib-scroll').getBoundingClientRect();
  const cards = [...document.querySelectorAll('.lib-scroll .lib-card[data-item]')].filter((c) => {
    const r = c.getBoundingClientRect();
    return r.bottom > view.top && r.top < view.bottom;
  });
  const ok = cards.filter((c) => { const i = c.querySelector('img'); return i && i.complete && i.naturalWidth > 0; });
  return { visible: cards.length, loaded: ok.length };
});
let thumbs = await visibleThumbs();
for (let i = 0; i < 60 && thumbs.loaded < thumbs.visible; i++) {
  await win.waitForTimeout(100);
  thumbs = await visibleThumbs();
}
check(thumbs.visible >= 6 && thumbs.loaded === thumbs.visible, `visible thumbnails loaded (${thumbs.loaded}/${thumbs.visible})`);

// ---------------------------------------------------------------- 1. drag a circle onto the preview
console.log('1. drag Circle from the library onto the preview');
let b = await stageBox();
const target = worldToScreen(b, -3, 1);
await win.dragAndDrop('.lib-card[data-item="circle"]', '.stage', { targetPosition: { x: target.x - b.x, y: target.y - b.y } });
let st = await state();
check(st.project.clips.length === 1, 'one clip created');
const circle = st.project.clips[0];
check(circle && near(circle.transform.x, -3, 0.15) && near(circle.transform.y, 1, 0.15), `circle placed at drop point (${circle?.transform.x}, ${circle?.transform.y})`);
check(st.selection[0] === circle?.id, 'new clip is selected');
check(await win.locator(`.clip[data-clip="${circle.id}"]`).count() === 1, 'clip appears on the timeline');
await setTime(2);
st = await waitFrame((s) => s.meta.clips[circle.id]);
let px = await pixelAt(target.x, target.y);
check(px[2] > 60 && px[2] > px[0], `circle is rendered in the preview at its position (pixel ${px})`);
await shot('circle-dropped');

// ---------------------------------------------------------------- 2. drag it inside the preview
console.log('2. move the circle by dragging it in the preview');
b = await stageBox();
let from = worldToScreen(b, -3, 1);
await win.mouse.move(from.x, from.y);
await win.mouse.down();
for (let i = 1; i <= 10; i++) await win.mouse.move(from.x + i * 25, from.y + i * 8, { steps: 1 });
await win.mouse.up();
st = await waitFrame();
let c = st.project.clips.find((x) => x.id === circle.id);
const unit = b.width / FW;
check(near(c.transform.x, -3 + 250 / unit, 0.2) && near(c.transform.y, 1 - 80 / unit, 0.2), `circle moved to (${c.transform.x.toFixed(2)}, ${c.transform.y.toFixed(2)})`);
const moved = worldToScreen(b, c.transform.x, c.transform.y);
px = await pixelAt(moved.x, moved.y);
check(px[2] > 60, `re-rendered at the new position (pixel ${px})`);
px = await pixelAt(from.x, from.y);
check(px[2] < 60, `old position is now empty (pixel ${px})`);
await win.evaluate(() => window.__ms.store.getState().undo());
st = await state();
c = st.project.clips.find((x) => x.id === circle.id);
check(near(c.transform.x, -3, 0.15), 'undo restores the position in a single step');
await win.evaluate(() => window.__ms.store.getState().redo());

// ---------------------------------------------------------------- 3. scale + rotate handles
console.log('3. scale and rotate with the handles');
st = await waitFrame();
b = await stageBox();
c = st.project.clips.find((x) => x.id === circle.id);
const handle = win.locator('.handle[data-handle="scale"]').nth(2);
const hb = await handle.boundingBox();
const center = worldToScreen(b, c.transform.x, c.transform.y);
await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await win.mouse.down();
const dx = hb.x + hb.width / 2 - center.x;
const dy = hb.y + hb.height / 2 - center.y;
await win.mouse.move(center.x + dx * 1.5, center.y + dy * 1.5, { steps: 5 });
await win.mouse.up();
st = await state();
c = st.project.clips.find((x) => x.id === circle.id);
check(near(c.transform.scale, 1.5, 0.08), `scaled to ${c.transform.scale}`);
const rot = win.locator('.handle.rot');
const rb = await rot.boundingBox();
await win.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
await win.mouse.down();
// move to the left of the center: 90° counter-clockwise
await win.mouse.move(center.x - 120, center.y, { steps: 6 });
await win.mouse.up();
st = await state();
c = st.project.clips.find((x) => x.id === circle.id);
check(near(c.transform.rotation, 90, 6), `rotated to ${c.transform.rotation}°`);
await shot('scaled-rotated');

// ---------------------------------------------------------------- 4. drop an equation on the timeline
console.log('4. drop an Equation onto track 2 of the timeline at ~1s');
const lane = win.locator('.tl-lanes');
const lb = await lane.boundingBox();
st = await state();
const zoom = st.zoom;
await win.dragAndDrop('.lib-card[data-item="tex"]', '.tl-lanes', { targetPosition: { x: 1.0 * zoom + 2, y: 50 * 1 + 25 } });
st = await state();
const tex = st.project.clips.find((x) => x.item === 'tex');
check(!!tex, 'equation clip created');
check(tex && near(tex.start, 1, 0.1), `starts at ~1s (${tex?.start})`);
check(tex && tex.track === st.project.tracks[1].id, 'on the second track');
await setTime(3);
st = await waitFrame((s) => s.meta.clips[tex.id], 15000);
check(!!st.meta.clips[tex.id] && !st.meta.errors[tex.id], 'equation renders without errors');
await win.waitForFunction((id) => { const i = document.querySelector(`.clip[data-clip="${id}"] .clip-img`); return i && i.complete && i.naturalWidth > 20; }, tex.id, { timeout: 30000 }).catch(() => {});
const texImg = await win.evaluate((id) => { const i = document.querySelector(`.clip[data-clip="${id}"] .clip-img`); return i ? { w: i.naturalWidth, h: i.naturalHeight } : null; }, tex.id);
check(texImg && texImg.w > texImg.h * 2, `equation clip shows a rendered preview of the equation (${JSON.stringify(texImg)})`);
await shot('tex-on-timeline');

// ---------------------------------------------------------------- 5. timeline: move, trim, enter handle
console.log('5. edit clips on the timeline');
let clipEl = win.locator(`.clip[data-clip="${tex.id}"]`);
let cb = await clipEl.boundingBox();
await win.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
await win.mouse.down();
await win.mouse.move(cb.x + cb.width / 2 + zoom * 1.0, cb.y + cb.height / 2, { steps: 8 });
await win.mouse.up();
st = await state();
let t2 = st.project.clips.find((x) => x.id === tex.id);
check(near(t2.start, 2, 0.12), `moved in time to ${t2.start}`);
cb = await clipEl.boundingBox();
await win.mouse.move(cb.x + cb.width - 2, cb.y + cb.height / 2);
await win.mouse.down();
await win.mouse.move(cb.x + cb.width - 2 + zoom * 1.5, cb.y + cb.height / 2, { steps: 6 });
await win.mouse.up();
st = await state();
t2 = st.project.clips.find((x) => x.id === tex.id);
check(near(t2.duration, 5.5, 0.12), `trimmed right edge → duration ${t2.duration}`);
const eh = win.locator(`.clip[data-clip="${tex.id}"] .anim-handle.right`);
const ehb = await eh.boundingBox();
const enter0 = t2.enter.duration;
await win.mouse.move(ehb.x + ehb.width / 2, ehb.y + 10);
await win.mouse.down();
await win.mouse.move(ehb.x + ehb.width / 2 + zoom * 0.5, ehb.y + 10, { steps: 5 });
await win.mouse.up();
st = await state();
t2 = st.project.clips.find((x) => x.id === tex.id);
check(near(t2.enter.duration, enter0 + 0.5, 0.08), `enter animation lengthened ${enter0} → ${t2.enter.duration}`);
// move to track 1 vertically
cb = await clipEl.boundingBox();
await win.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
await win.mouse.down();
await win.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2 - 50, { steps: 6 });
await win.mouse.up();
st = await state();
t2 = st.project.clips.find((x) => x.id === tex.id);
const c1 = st.project.clips.find((x) => x.id === circle.id);
check(t2.track !== c1.track || !(t2.start < c1.start + c1.duration && c1.start < t2.start + t2.duration), 'overlap on the same track is resolved');
await shot('timeline-edits');

// ---------------------------------------------------------------- 6. z-order through track order
console.log('6. z-order follows track order');
await S(() => {
  const st = window.__ms.store.getState();
  st.loadProject({ version: 1, settings: { name: 'z', duration: 6, fps: 30, background: '#1e1e1e', resolution: [1920, 1080] }, tracks: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }], clips: [], assets: [] }, null);
});
await S(() => {
  const a = window.__ms.actions;
  a.addItem('square', { time: 0, track: 'A', params: { side: 3, stroke: '#FF0000', fill: '#FF0000', fill_opacity: 1, stroke_width: 4 } });
  a.addItem('square', { time: 0, track: 'B', x: 1, params: { side: 3, stroke: '#00FF00', fill: '#00FF00', fill_opacity: 1, stroke_width: 4 } });
});
await setTime(2);
await waitFrame();
b = await stageBox();
let mid = worldToScreen(b, 0.5, 0);
px = await pixelAt(mid.x, mid.y);
check(px[0] > 200 && px[1] < 90, `top track (red) is drawn in front (${px})`);
// drag track B's grip above track A
const grips = win.locator('.grip');
const g1 = await grips.nth(1).boundingBox();
await win.mouse.move(g1.x + 4, g1.y + 6);
await win.mouse.down();
await win.mouse.move(g1.x + 4, g1.y + 6 - 50, { steps: 6 });
await win.mouse.up();
st = await waitFrame();
check(st.project.tracks[0].id === 'B', 'track reordered by dragging its grip');
px = await pixelAt(mid.x, mid.y);
check(px[1] > 200 && px[0] < 90, `after reordering, green is in front (${px})`);
await shot('zorder');

// ---------------------------------------------------------------- 7. keyframes
console.log('7. keyframe animation by dragging at two different times');
await S(() => window.__ms.store.getState().loadProject({ version: 1, settings: { name: 'k', duration: 6, fps: 30, background: '#1e1e1e', resolution: [1920, 1080] }, tracks: [{ id: 'A', name: 'A' }], clips: [], assets: [] }, null));
const dotId = await S(() => window.__ms.actions.addItem('star', { time: 0, track: 'A', x: -4, y: 0 }));
await S((id) => {
  const s = window.__ms.store.getState();
  s.commit((p) => { const c = p.clips.find((c) => c.id === id); c.duration = 5; c.enter.type = 'none'; c.exit.type = 'none'; });
}, dotId);
await setTime(0.5);
await waitFrame();
await win.locator('.overlay').click({ position: { x: 1, y: 1 } }); // focus stage, deselect
await S((id) => window.__ms.store.setState({ selection: [id] }), dotId);
await win.keyboard.press('k');
st = await state();
check(st.project.clips[0].keys.length === 1, 'K adds a keyframe');
await setTime(3.5);
st = await waitFrame();
b = await stageBox();
from = worldToScreen(b, -4, 0);
const to = worldToScreen(b, 4, 2);
await win.mouse.move(from.x, from.y);
await win.mouse.down();
await win.mouse.move(to.x, to.y, { steps: 10 });
await win.mouse.up();
st = await state();
const keys = st.project.clips[0].keys;
check(keys.length === 2, `dragging at another time creates a second keyframe (${keys.length})`);
check(keys[1] && near(keys[1].x, 4, 0.15) && near(keys[1].y, 2, 0.15), 'second keyframe has the dragged position');
await setTime(2.0);
st = await waitFrame();
const info = st.meta.clips[dotId];
check(info && info.x > -3.9 && info.x < 3.9, `position is interpolated in between (x=${info?.x.toFixed(2)})`);
check(await win.locator('.kf').count() === 2, 'keyframe diamonds shown on the clip');
await shot('keyframes');

// ---------------------------------------------------------------- 8. inspector params + code
console.log('8. inspector parameters and code editing');
await S((id) => window.__ms.store.setState({ selection: [id], rightTab: 'inspector' }), dotId);
await win.locator('.ins-section h5', { hasText: 'Parameters' }).click();
await win.waitForSelector('[data-testid="param-points"]');
await win.fill('[data-testid="param-points"]', '8');
await win.press('[data-testid="param-points"]', 'Enter');
st = await state();
check(st.project.clips[0].params.points === 8, 'changing a number field updates the clip');
const src8 = await win.waitForFunction((id) => { const i = document.querySelector(`.clip[data-clip="${id}"] .clip-img`); return i && !i.classList.contains('stale') && i.src; }, dotId, { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => null);
check(!!src8, 'timeline preview re-renders after a parameter change');
await S((id) => window.__ms.store.setState({ codeOpen: true, codeClip: id }), dotId);
await win.waitForSelector('[data-testid="clip-code"] .cm-content');
await win.waitForTimeout(400);
const codeText = await win.locator('[data-testid="clip-code"] .cm-content').innerText();
check(codeText.includes('n = 8') && codeText.includes('Polygon'), 'code tab shows the generated ManimGL code for the clip');
await win.click('[data-testid="clip-code"] .cm-content');
await win.keyboard.press('Meta+a');
await win.keyboard.type('return Circle(radius=1, fill_color=RED, fill_opacity=1) +');
await win.waitForTimeout(1200);
st = await waitFrame(() => true);
check(!!st.meta.errors[dotId], `broken code reports an error (${st.meta.errors[dotId]})`);
check(await win.locator('.code-error').count() === 1, 'error is displayed under the editor');
await win.keyboard.press('Backspace');
await win.keyboard.press('Backspace');
await win.waitForTimeout(1200);
st = await waitFrame((s) => !s.meta.errors[dotId]);
check(!st.meta.errors[dotId], 'fixing the code clears the error');
check(st.project.clips[0].code?.includes('fill_color=RED'), 'custom code stored on the clip');
await shot('code-edit');

// ---------------------------------------------------------------- 9. animation sections
console.log('9. enter/exit/effects in the inspector');
{
  // timing, animation types and effect placement live on the timeline clip — the tab doesn't repeat them
  const heads = await win.locator('.ins-section h5').allInnerTexts();
  check(!heads.some((h) => /timing/i.test(h)), `animation tab has no Timing section (${heads.join(' | ').replace(/\s+/g, ' ')})`);
  check(await win.locator('text=Add at playhead').count() === 0, 'no duplicate "Add at playhead" button');
}
// with an animation set the tab shows only its easing; with none, it offers the picker (the clip has no zone to click)
await S(() => window.__ms.store.getState().commit((p) => { p.clips[0].enter = { ...p.clips[0].enter, type: 'FadeIn' }; p.clips[0].exit = { ...p.clips[0].exit, type: 'FadeOut' }; }));
await win.waitForTimeout(100);
await win.locator('.ins-section h5', { hasText: 'Enter animation' }).click();
await win.locator('.ins-section h5', { hasText: 'Exit animation' }).click();
check(await win.locator('[data-testid="enter-picker"]').count() === 0 && await win.locator('[data-testid="exit-picker"]').count() === 0, 'no enter / exit pickers when the clip already has them');
check(await win.locator('.ins-section .field:has-text("Easing")').count() === 2, 'enter and exit easing are still editable');
await S(() => window.__ms.store.getState().commit((p) => { p.clips[0].enter = { ...p.clips[0].enter, type: 'none' }; p.clips[0].exit = { ...p.clips[0].exit, type: 'none' }; }));
await win.waitForTimeout(100);
check(await win.locator(`.clip[data-clip="${(await state()).project.clips[0].id}"] [data-zone]`).count() === 0, 'a clip without enter / exit has no zones on the timeline');
await win.click('[data-testid="enter-picker"]');
await win.waitForSelector('[data-testid="enter-picker-pop"]');
const timeBefore = (await state()).time;
await win.hover('[data-testid="enter-picker-pop"] .anim-tile[data-anim="Write"]');
await win.waitForSelector('[data-testid="anim-live"]', { timeout: 3000 }).catch(() => {});
const badge = await win.locator('[data-testid="anim-live"]').innerText().catch(() => '');
check(badge.includes('Write'), `hovering a tile previews it live in the main viewer (${badge.trim()})`);
check(await win.locator('.anim-preview img').count() === 0, 'no small GIF box when previewing on the real object');
const ap = await S(() => { const a = window.__ms.store.getState().animPreview; return a && { t0: a.t0, t1: a.t1, enter: a.project.clips[0].enter.type, real: window.__ms.store.getState().project.clips[0].enter.type }; });
check(ap && ap.enter === 'Write' && ap.real !== 'Write', `preview applies Write to a scratch copy only (real: ${ap?.real})`);
{
  // sample the canvas a few times: frames must change as the preview loops
  const sig = () => win.evaluate(() => { const c = document.querySelector('.stage-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4 * 97) h = (h * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) >>> 0; return h; });
  const seen = new Set();
  for (let i = 0; i < 12; i++) { seen.add(await sig()); await win.waitForTimeout(120); }
  check(seen.size >= 3, `main viewer animates while previewing (${seen.size} distinct frames)`);
}
await win.hover('[data-testid="enter-picker-pop"] .anim-tile[data-anim="FadeIn"]');
await win.waitForTimeout(200);
check((await win.locator('[data-testid="anim-live"]').innerText()).includes('Fade In'), 'moving to another tile switches the live preview');
await shot('anim-picker');
await win.click('[data-testid="enter-picker-pop"] .anim-tile[data-anim="SpinIn"]');
await win.waitForTimeout(100);
check(await win.locator('[data-testid="anim-live"]').count() === 0 && (await S(() => window.__ms.store.getState().animPreview)) === null, 'picking closes the live preview');
st = await waitFrame();
check(near(st.time, timeBefore, 1e-6) && st.fresh, 'viewer returns to the playhead frame after the preview');
check(await win.locator('[data-testid="enter-picker"]').count() === 0, 'enter picker gives way to easing once an animation is set');
await win.click('[data-testid="exit-picker"]');
await win.click('[data-testid="exit-picker-pop"] .anim-tile[data-anim="Uncreate"]');
{
  // effects are added from the clip's context menu on the timeline
  const cid = (await state()).project.clips[0].id;
  const cb = await win.locator(`.clip[data-clip="${cid}"]`).boundingBox();
  await win.mouse.click(cb.x + cb.width / 2, cb.y + 10, { button: 'right' });
  await win.hover('.ctx-item:has-text("Add effect at playhead")');
  await win.click('.ctx-menu.sub .ctx-item:has(.ctx-label:text-is("Indicate"))');
}
await win.waitForTimeout(100);
await win.locator('.ins-section h5', { hasText: 'Effects' }).click();
check(await win.locator('.effect-row').count() === 1 && (await win.locator('.effect-row .anim-lbl').innerText()).includes('Indicate'), 'effect shows in the inspector with its name, length and remove button');
st = await state();
check(st.project.clips[0].enter.type === 'SpinIn' && st.project.clips[0].exit.type === 'Uncreate', 'enter/exit types changed');
check(st.project.clips[0].effects.length === 1, 'effect added');
for (const t of [0.3, 0.7, 2.5, 4.6, 4.9]) {
  await setTime(t);
  st = await waitFrame();
  check(!Object.keys(st.meta.errors).length, `renders at t=${t} without errors`);
}
await shot('animation-tab');

// ---------------------------------------------------------------- 9b. click a clip's enter / exit part on the timeline
console.log('9b. clicking the enter / exit part of a clip opens its chooser');
{
  const cid = st.project.clips[0].id;
  const zoneBox = (z) => win.locator(`.clip[data-clip="${cid}"] [data-zone="${z}"]`).boundingBox();
  const popVisible = () => win.evaluate(() => { const p = document.querySelector('[data-testid="tl-anim-pop"]'); return p ? p.querySelector('.anim-pop-title')?.textContent || '' : null; });
  const start0 = st.project.clips[0].start;
  let zb = await zoneBox('enter');
  await win.mouse.click(zb.x + zb.width / 2, zb.y + zb.height / 2);
  await win.waitForSelector('[data-testid="tl-anim-pop"]', { timeout: 3000 }).catch(() => {});
  let title = await popVisible();
  check(title && title.startsWith('Enter animation'), `clicking the enter part opens the enter chooser (${title})`);
  check(await win.locator('[data-testid="tl-anim-pop"] .anim-tile.on[data-anim="SpinIn"]').count() === 1, 'chooser highlights the current enter animation');
  const pb = await win.locator('[data-testid="tl-anim-pop"]').boundingBox();
  const vp = await win.evaluate(() => [window.innerWidth, window.innerHeight]);
  check(pb.y >= 0 && pb.y + pb.height <= vp[1] && pb.x >= 0 && pb.x + pb.width <= vp[0], 'chooser fits on screen');
  check(pb.y + pb.height <= zb.y + 1 || pb.y >= zb.y + zb.height - 1, 'chooser does not cover the clicked part');
  await win.hover('[data-testid="tl-anim-pop"] .anim-tile[data-anim="SpinIn"]');
  await win.waitForTimeout(300);
  check((await win.locator('[data-testid="anim-live"]').innerText().catch(() => '')).includes('Spin In'), 'timeline chooser previews in the main viewer too');
  await shot('timeline-enter-chooser');
  await win.click('[data-testid="tl-anim-pop"] .anim-tile[data-anim="GrowFromCenter"]');
  st = await state();
  check(st.project.clips[0].enter.type === 'GrowFromCenter', `picked GrowFromCenter from the timeline (${st.project.clips[0].enter.type})`);
  check(await popVisible() === null, 'chooser closes after picking');
  check(near(st.project.clips[0].start, start0, 1e-6), 'clicking did not move the clip');

  zb = await zoneBox('exit');
  await win.mouse.click(zb.x + zb.width / 2, zb.y + zb.height / 2);
  await win.waitForSelector('[data-testid="tl-anim-pop"]', { timeout: 3000 }).catch(() => {});
  title = await popVisible();
  check(title && title.startsWith('Exit animation'), `clicking the exit part opens the exit chooser (${title})`);
  // clicking the same part again toggles it closed
  await win.mouse.click(zb.x + zb.width / 2, zb.y + zb.height / 2);
  check(await popVisible() === null, 'clicking the exit part again closes it');
  await win.mouse.click(zb.x + zb.width / 2, zb.y + zb.height / 2);
  check((await popVisible())?.startsWith('Exit'), 'and reopens it');
  await win.keyboard.press('Escape');
  check(await popVisible() === null, 'Escape closes the chooser');
  st = await state();
  check(st.selection.includes(cid), 'Escape on the chooser keeps the clip selected');
  await win.mouse.click(zb.x + zb.width / 2, zb.y + zb.height / 2);
  await win.click('[data-testid="tl-anim-pop"] .anim-tile[data-anim="FadeOut"]');
  st = await state();
  check(st.project.clips[0].exit.type === 'FadeOut', `picked FadeOut from the timeline (${st.project.clips[0].exit.type})`);

  // clicking the body of the clip does not open it; clicking elsewhere closes it
  const cbx = await win.locator(`.clip[data-clip="${cid}"]`).boundingBox();
  await win.mouse.click(cbx.x + cbx.width / 2, cbx.y + 10);
  check(await popVisible() === null, 'clicking the middle of the clip does not open a chooser');
  zb = await zoneBox('enter');
  await win.mouse.click(zb.x + zb.width / 2, zb.y + zb.height / 2);
  check((await popVisible())?.startsWith('Enter'), 'enter chooser open again');
  await win.mouse.click(cbx.x + cbx.width / 2, cbx.y + 10);
  check(await popVisible() === null, 'clicking the clip body closes it');
  await win.mouse.click(zb.x + zb.width / 2, zb.y + zb.height / 2);
  const rb = await win.locator('.tl-ruler').boundingBox();
  await win.mouse.click(rb.x + rb.width * 0.6, rb.y + rb.height / 2);
  check(await popVisible() === null, 'clicking the ruler closes it');

  // dragging from the enter part still moves the clip (no chooser)
  zb = await zoneBox('enter');
  const z0 = st.project.clips[0].start;
  await win.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2);
  await win.mouse.down();
  await win.mouse.move(zb.x + zb.width / 2 + zoom * 0.5, zb.y + zb.height / 2, { steps: 6 });
  await win.mouse.up();
  st = await state();
  check(st.project.clips[0].start > z0 + 0.3, `dragging the enter part moves the clip (${z0} → ${st.project.clips[0].start})`);
  check(await popVisible() === null, 'no chooser after a drag');
  await win.keyboard.press('Meta+z');

  // effects: click opens that effect in the inspector (not the timeline chooser)
  const eb = await win.locator(`.clip[data-clip="${cid}"] .clip-effect`).first().boundingBox();
  const at0 = st.project.clips[0].effects[0].at;
  const effId = st.project.clips[0].effects[0].id;
  await win.mouse.click(eb.x + eb.width / 2, eb.y + eb.height / 2);
  title = await popVisible();
  check(title === null, `clicking an effect does not open the timeline chooser (${title})`);
  const shown = await S(() => { const s = window.__ms.store.getState(); return { tab: s.rightTab, section: s.inspectorFocus && s.inspectorFocus.section, eff: s.inspectorFocus && s.inspectorFocus.effectId }; });
  check(shown.tab === 'inspector' && shown.section === 'effects' && shown.eff === effId, `clicking an effect opens it in the inspector (${JSON.stringify(shown)})`);
  await win.waitForSelector(`.effect-row.on[data-effect="${effId}"]`);
  check(await win.locator(`.effect-row.on[data-effect="${effId}"]`).count() === 1, 'the clicked effect is highlighted in the inspector');
  await win.click(`[data-testid="effect-type-${effId}"]`);
  await win.waitForSelector(`[data-testid="effect-type-${effId}-pop"]`);
  const other = await win.evaluate((id) => [...document.querySelectorAll(`[data-testid="effect-type-${id}-pop"] .anim-tile:not(.on)`)].map((b) => b.dataset.anim)[0], effId);
  await win.click(`[data-testid="effect-type-${effId}-pop"] .anim-tile[data-anim="${other}"]`);
  st = await state();
  check(st.project.clips[0].effects[0].type === other && st.project.clips[0].effects[0].at === at0, `effect changed to ${other} without moving`);
  for (const t of [0.3, 4.8]) {
    await setTime(t);
    st = await waitFrame();
    check(!Object.keys(st.meta.errors).length, `renders at t=${t} without errors`);
  }
  await shot('timeline-anims');
}

// ---------------------------------------------------------------- 10. playback
console.log('10. playback');
await setTime(0);
await win.locator('.stage').hover();
await win.keyboard.press(' ');
await win.waitForTimeout(1500);
st = await state();
check(st.playing && st.time > 0.8, `time advances while playing (${st.time.toFixed(2)})`);
const frames0 = await S(() => window.__ms.store.getState().meta.t);
await win.waitForTimeout(300);
const frames1 = await S(() => window.__ms.store.getState().meta.t);
check(frames1 !== frames0, 'preview frames update during playback');
await win.keyboard.press(' ');
st = await state();
check(!st.playing, 'space pauses');

// ---------------------------------------------------------------- 11. image import
console.log('11. image import');
const png = path.join(TMP, 'pic.png');
const { execFileSync } = await import('child_process');
execFileSync(path.join(ROOT, 'engine/.venv/bin/python'), ['-c', `from PIL import Image, ImageDraw
im = Image.new('RGBA', (300, 200), (40, 120, 220, 255)); d = ImageDraw.Draw(im); d.ellipse((60, 30, 240, 170), fill=(250, 200, 40, 255)); im.save(${JSON.stringify(png)})`]);
const bad = path.join(TMP, 'broken.png');
fs.writeFileSync(bad, Buffer.from('not really a png'));
const before = (await state()).project.clips.length;
await S((p) => window.__ms.actions.importFiles([p]), bad);
check((await state()).project.clips.length === before, 'a corrupt image is rejected');
check(await win.locator('.toast.error').count() > 0, 'with an error message');
errors.length = 0;
await S((p) => window.__ms.actions.importFiles([p], { x: 3, y: -2, time: 0 }), png);
st = await state();
const img = st.project.clips.find((c) => c.item === 'image');
check(!!img && st.project.assets.length === 1, 'image imported as a clip and a library asset');
await setTime(2);
st = await waitFrame();
check(img && st.meta.clips[img.id] && !st.meta.errors[img.id], 'image renders');
check(await win.locator('.library .lib-card .lib-badge', { hasText: 'IMG' }).count() === 0, 'library no longer lists media (it lives on the timeline)');
await shot('image');

// ---------------------------------------------------------------- 12. split, duplicate, delete, undo
console.log('12. split / duplicate / delete / undo');
await S((id) => window.__ms.store.setState({ selection: [id] }), img.id);
await setTime(1.5);
await win.locator('.stage').hover();
await win.keyboard.press('Meta+b');
st = await state();
check(st.project.clips.filter((c) => c.item === 'image').length === 2, '⌘B blades the selected clip at the playhead');
await win.keyboard.press('Meta+d');
st = await state();
check(st.project.clips.filter((c) => c.item === 'image').length === 3, '⌘D duplicates');
const n = st.project.clips.length;
await win.keyboard.press('Backspace');
st = await state();
check(st.project.clips.length === n - 1, 'Backspace deletes');
await win.evaluate(() => window.__ms.store.getState().undo());
st = await state();
check(st.project.clips.length === n, 'undo brings it back');

// ---------------------------------------------------------------- 12a. FCP tools: A = select, B = blade
console.log('12a. blade (B) / select (A) tools');
const tool = () => S(() => window.__ms.store.getState().tool);
await win.locator('.stage').hover();
await win.keyboard.press('b');
check(await tool() === 'blade', 'B switches to the blade tool');
await setTime(0);
st = await state();
const lockedTracks = new Set(st.project.tracks.filter((t) => t.locked).map((t) => t.id));
const victim = [...st.project.clips].filter((c) => !lockedTracks.has(c.track)).sort((a, b) => b.duration - a.duration)[0];
const selBefore = st.selection.join(',');
const vb = await win.locator(`.clip[data-clip="${victim.id}"]`).boundingBox();
const zoomNow = st.zoom;
const fx = 0.37;
await win.mouse.move(vb.x + vb.width * fx, vb.y + vb.height / 2, { steps: 4 });
await win.waitForTimeout(100);
check(await win.locator('[data-testid="blade-line"]').count() === 1, 'hovering a clip shows the blade line');
await shot('blade-hover');
const n2 = (await state()).project.clips.length;
await win.mouse.click(vb.x + vb.width * fx, vb.y + vb.height / 2);
st = await state();
const left = st.project.clips.find((c) => c.id === victim.id);
const expectT = victim.start + (vb.width * fx) / zoomNow;
check(st.project.clips.length === n2 + 1, 'clicking with the blade cuts the clip in two');
check(left && near(left.start + left.duration, expectT, 10 / zoomNow), `cut lands under the pointer (${(left?.start + left?.duration).toFixed(2)} vs ${expectT.toFixed(2)})`);
check(st.project.clips.some((c) => c.id !== victim.id && c.track === victim.track && near(c.start, left.start + left.duration, 1e-3) && near(c.start + c.duration, victim.start + victim.duration, 1e-3)), 'right half continues to the original end');
check(st.selection.join(',') === selBefore, 'blading does not change the selection');
// shift-click: blade all clips at that point
// pick the middle of where the bladed clip overlaps another one, away from any snapping edge
const other = st.project.clips.find((c) => c.id !== left.id && c.track !== left.track && !lockedTracks.has(c.track) && c.start < left.start + left.duration - 0.4 && c.start + c.duration > left.start + 0.4);
const tAll = other ? (Math.max(left.start, other.start) + Math.min(left.start + left.duration, other.start + other.duration)) / 2 : left.start + left.duration / 2;
const under = st.project.clips.filter((c) => !lockedTracks.has(c.track) && c.start + 0.05 < tAll && tAll < c.start + c.duration - 0.05).length;
check(under >= 2, `test setup: ${under} clips overlap at ${tAll.toFixed(2)}s`);
const bladeBox = await win.locator(`.clip[data-clip="${victim.id}"]`).boundingBox();
const bx = bladeBox.x + (tAll - left.start) * zoomNow;
await win.keyboard.down('Shift');
await win.mouse.move(bx, bladeBox.y + bladeBox.height / 2, { steps: 3 });
await win.waitForTimeout(80);
check(await win.locator('[data-testid="blade-line"]').count() === under, `⇧ shows a blade line on all ${under} clips`);
await shot('blade-all-hover');
await win.mouse.click(bx, bladeBox.y + bladeBox.height / 2);
await win.keyboard.up('Shift');
const n3 = (await state()).project.clips.length;
check(n3 === n2 + 1 + under, `⇧-click blades all ${under} clip(s) at that point`);
// press-and-hold A: temporary select tool, back to blade on release
await win.keyboard.down('a');
await win.waitForTimeout(500);
check(await tool() === 'select', 'holding A switches to select…');
await win.keyboard.up('a');
check(await tool() === 'blade', '…and releasing returns to the blade');
await win.keyboard.press('a');
check(await tool() === 'select', 'A (tap) switches back to the select tool');
await win.mouse.click(bladeBox.x + 20, bladeBox.y + bladeBox.height / 2);
check((await state()).project.clips.length === n3, 'select tool clicks do not cut');
// ⇧⌘B blades every clip under the playhead regardless of selection
await setTime(tAll + 0.3);
st = await state();
const underPh = st.project.clips.filter((c) => !lockedTracks.has(c.track) && c.start + 0.05 < st.time && st.time < c.start + c.duration - 0.05).length;
await S((id) => window.__ms.store.setState({ selection: [id] }), victim.id);
await win.locator('.stage').hover();
await win.keyboard.press('Meta+Shift+b');
check((await state()).project.clips.length === n3 + underPh, `⇧⌘B blades all ${underPh} clip(s) under the playhead`);
for (let i = 0; i < 3; i++) await S(() => window.__ms.store.getState().undo());
check((await state()).project.clips.length === n, 'blade edits undo one step each');

// ---------------------------------------------------------------- 12b. camera
console.log('12b. camera view: pan / zoom look around without moving the camera');
await win.click('[data-testid="cam-through"]');
await win.waitForSelector('[data-testid="camera-inspector"]');
await setTime(1.0);
await waitFrame();
b = await stageBox();
let cpt = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
const cam12b = JSON.stringify((await state()).project.settings.camera || []);
await win.mouse.move(cpt.x, cpt.y);
await win.mouse.down();
await win.mouse.move(cpt.x - b.width / 4, cpt.y, { steps: 6 });
await win.mouse.up();
st = await waitFrame((s) => s.editorView && s.meta.view);
check(JSON.stringify(st.project.settings.camera || []) === cam12b, 'panning in camera view leaves the camera alone');
check(st.editorView && near(st.editorView.x, FW / 4, 0.2) && near(st.meta.camera.x, 0, 1e-6), `…and pans the editor view instead (${st.editorView?.x.toFixed(2)})`);
await win.mouse.move(cpt.x, cpt.y);
await win.mouse.wheel(0, -300);
await win.waitForTimeout(200);
st = await waitFrame((s) => s.editorView && s.editorView.zoom > 1.5);
check(st.editorView.zoom > 1.5 && JSON.stringify(st.project.settings.camera || []) === cam12b, `scroll zooms the editor view, not the camera (${st.editorView.zoom.toFixed(2)})`);
check(st.meta.camera && near(st.meta.camera.zoom, 1, 1e-6) && near(st.meta.view.zoom, st.editorView.zoom, 1e-3), 'engine renders the editor view; camera unchanged');
await shot('camera');
await win.click('[data-testid="cam-through"]');
st = await waitFrame((s) => !s.editorView);
check(!st.editorView && (!st.meta.view || near(st.meta.view.zoom, st.meta.camera.zoom, 1e-6)), 'Camera view button looks through the camera again');
await S(() => window.__ms.store.getState().commit((p) => { p.settings.camera = []; }));

// ---------------------------------------------------------------- 12b2. camera crop in the full-scene view
console.log('12b2. camera crop box in the full-scene view');
await win.click('[data-testid="cam-full"]');
await setTime(1.0);
st = await waitFrame((s) => s.meta.view && s.meta.view.zoom < 0.95);
check(st.meta.view && st.meta.view.zoom < 0.95 && near(st.meta.camera.zoom, 1, 1e-6), `full scene view renders zoomed out (view ×${st.meta.view?.zoom.toFixed(3)}, camera ×${st.meta.camera?.zoom})`);
check(await win.locator('[data-testid="crop-box"]').count() === 1, 'crop box is drawn');
const view0 = st.meta.view;
const w2s = (b, v, x, y) => ({ x: b.x + (((x - v.x) * v.zoom + FW / 2) / FW) * b.width, y: b.y + ((FH / 2 - (y - v.y) * v.zoom) / FH) * b.height });
b = await stageBox();
// drag the top-right corner to the centre: anchored at the bottom-left corner -> half-size crop
let chb = await win.locator('[data-corner="11"]').boundingBox();
await win.mouse.move(chb.x + chb.width / 2, chb.y + chb.height / 2);
await win.mouse.down();
let cto = w2s(b, view0, 0, 0);
await win.mouse.move(cto.x, cto.y, { steps: 8 });
await win.mouse.up();
st = await waitFrame();
let ck = (st.project.settings.camera || []).find((k) => Math.abs(k.t - 1) < 0.02);
check(ck && near(ck.zoom, 2, 0.05) && near(ck.x, -FW / 4, 0.08) && near(ck.y, -FH / 4, 0.08), `corner drag sets a 2× crop anchored bottom-left (${ck && `${ck.x.toFixed(2)},${ck.y.toFixed(2)} ×${ck.zoom.toFixed(2)}`})`);
check(near(st.meta.view.zoom, view0.zoom, 1e-6) && near(st.meta.camera.zoom, ck?.zoom ?? 0, 1e-3), `preview stays on the full scene while the camera zooms in (view ${JSON.stringify(st.meta.view)} vs ${JSON.stringify(view0)}, cam ${JSON.stringify(st.meta.camera)})`);
await shot('camera-crop-resize');
// move the crop by dragging inside it
let cfrom = w2s(b, view0, ck.x, ck.y);
cto = w2s(b, view0, 1, 1);
await win.mouse.move(cfrom.x, cfrom.y);
await win.mouse.down();
await win.mouse.move(cto.x, cto.y, { steps: 8 });
await win.mouse.up();
st = await state();
ck = (st.project.settings.camera || []).find((k) => Math.abs(k.t - 1) < 0.02);
check(ck && near(ck.x, 1, 0.08) && near(ck.y, 1, 0.08) && near(ck.zoom, 2, 0.05), `dragging inside moves the crop (${ck?.x.toFixed(2)}, ${ck?.y.toFixed(2)})`);
// draw a new crop outside the current one
const pastBefore = st.past;
cfrom = w2s(b, view0, -6, 3.6);
cto = w2s(b, view0, -2, 1.6);
await win.mouse.move(cfrom.x, cfrom.y);
await win.mouse.down();
await win.mouse.move(cto.x, cto.y, { steps: 8 });
await win.mouse.up();
st = await waitFrame();
ck = (st.project.settings.camera || []).find((k) => Math.abs(k.t - 1) < 0.02);
check(ck && near(ck.zoom, FW / 4, 0.1) && near(ck.x, -4, 0.08) && near(ck.y, 2.475, 0.08), `drawing outside makes a new 16:9 crop (${ck && `${ck.x.toFixed(2)},${ck.y.toFixed(2)} ×${ck.zoom.toFixed(2)}`})`);
check(st.past === pastBefore + 1, 'a crop gesture is one undo step');
await shot('camera-crop-draw');
// a plain click outside doesn't change anything
const camBefore = JSON.stringify(st.project.settings.camera);
const c0 = w2s(b, view0, 5, -3);
await win.mouse.click(c0.x, c0.y);
st = await state();
check(JSON.stringify(st.project.settings.camera) === camBefore && st.selection[0] === '__camera__', 'clicking outside the crop leaves the camera alone');
// right-drag in the full-scene view looks around in the editor view; the crop is untouched
const camCrop = JSON.stringify(st.project.settings.camera);
await win.mouse.move(c0.x, c0.y);
await win.mouse.down({ button: 'right' });
await win.mouse.move(c0.x - 60, c0.y - 20, { steps: 6 });
await win.mouse.up({ button: 'right' });
st = await waitFrame((s) => s.editorView);
check(!!st.editorView && JSON.stringify(st.project.settings.camera) === camCrop && await win.locator('[data-testid="crop-box"]').count() === 0, 'right-drag in full scene enters the editor view without moving the camera');
await win.click('[data-testid="cam-full"]');
st = await waitFrame((s) => !s.editorView && s.meta.view && near(s.meta.view.zoom, view0.zoom, 1e-6));
check(!st.editorView && await win.locator('[data-testid="crop-box"]').count() === 1, 'Full scene button brings the crop overview back');
// C looks through the camera
await win.keyboard.press('c');
st = await waitFrame((s) => s.meta.view && near(s.meta.view.zoom, s.meta.camera.zoom, 1e-6));
check(st.meta.view && near(st.meta.view.zoom, ck.zoom, 1e-3) && near(st.meta.view.x, ck.x, 1e-3), 'C switches to looking through the camera');
check(await win.locator('[data-testid="crop-box"]').count() === 0, 'no crop box in camera view');
await shot('camera-through');
await win.keyboard.press('c');
await win.keyboard.press('Escape');
st = await waitFrame((s) => s.selection.length === 0 && (!s.meta.view || near(s.meta.view.zoom, s.meta.camera.zoom, 1e-6)));
check(!st.meta.view || (near(st.meta.view.zoom, st.meta.camera.zoom, 1e-6)), 'deselecting the camera previews through it again');
await S(() => window.__ms.store.getState().commit((p) => { p.settings.camera = []; }));

// ---------------------------------------------------------------- 12c. example project
console.log('12c. example project renders at every point in time');
await S(() => window.__ms.store.getState().loadProject({ version: 1, settings: { name: 'e', duration: 5, fps: 30, background: '#1e1e1e', resolution: [1920, 1080] }, tracks: [{ id: 'A', name: 'A' }], clips: [], assets: [] }, null));
await win.click('[data-testid="load-example"]');
await win.waitForTimeout(300);
st = await state();
check(st.project.clips.length >= 8, `example loaded (${st.project.clips.length} clips)`);
let exErrors = new Set();
for (let t = 0; t <= 14; t += 0.25) {
  await setTime(t);
  st = await waitFrame(() => true, 20000);
  Object.values(st.meta.errors).forEach((e) => exErrors.add(e));
  if ([2, 6.0, 7.0, 10].includes(t)) await shot(`example-${t}s`);
}
check(exErrors.size === 0, `example renders without errors ${[...exErrors].join(' | ')}`);
await S(() => window.__ms.store.setState({ selection: [] }));

// ---------------------------------------------------------------- 12d. semantic library search
console.log('12d. semantic library search');
{
  const ML = await S(() => window.__ms.store.getState().library.items.filter((i) => i.category === 'AI & ML').map((i) => i.id));
  check(ML.length >= 12, `AI & ML category present (${ML.length} items)`);
  await win.keyboard.press('Escape');
  await win.keyboard.press('Meta+f');
  check(await win.evaluate(() => document.activeElement?.matches('.library .search input')), '⌘F focuses the library search');
  await win.waitForSelector('.search-mode.ready', { timeout: 120000 }).catch(() => {});
  check(await win.locator('.search-mode.ready').count() === 1, 'semantic model ready indicator');
  await win.keyboard.type('transformer architecture', { delay: 15 });
  const cardsFor = async (q) => {
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      const r = await win.evaluate(() => ({
        pending: !!document.querySelector('.search-results.pending'),
        ids: [...document.querySelectorAll('.search-results .lib-card')].map((c) => c.dataset.item),
        heads: [...document.querySelectorAll('.search-results h4')].map((h) => h.textContent),
      }));
      if (!r.pending && r.ids.length) return r;
      await win.waitForTimeout(50);
    }
    return { ids: [], heads: [] };
  };
  let r = await cardsFor();
  check(r.ids[0] === 'transformer_block', `transformer architecture → Transformer Block first (${r.ids.slice(0, 3)})`);
  check(ML.every((id) => r.ids.includes(id)), `…and every AI & ML item comes up (${r.ids.length})`);
  check(r.ids.every((id) => ML.includes(id)), `…and nothing unrelated (${r.ids.filter((i) => !ML.includes(i))})`);
  check(r.heads.some((h) => h.includes('Related in AI & ML')), 'related section is labelled');
  check(await win.locator('.lib-card[data-item="circle"]').count() === 0, 'category grid hidden while searching');
  await shot('search-transformer');
  const before = (await state()).project.clips.length;
  await win.keyboard.press('Enter');
  st = await waitFrame(() => true, 20000);
  const added = st.project.clips[st.project.clips.length - 1];
  check(st.project.clips.length === before + 1 && added.item === 'transformer_block', 'Enter adds the top result');
  check(!Object.keys(st.meta.errors).length, `added ML item renders (${Object.values(st.meta.errors)})`);
  await shot('search-added');
  await win.locator('.library .search input').focus();
  await win.keyboard.press('Meta+a');
  await win.keyboard.type('probabilty');
  r = await cardsFor();
  check(r.ids.slice(0, 4).includes('die') && r.ids.slice(0, 4).includes('softmax_probs'), `typo "probabilty" → die + softmax (${r.ids.slice(0, 4)})`);
  await win.keyboard.press('Meta+a');
  await win.keyboard.type('zzqxv');
  await win.waitForTimeout(400);
  check((await win.locator('.search-empty').innerText()).includes('No matches'), 'empty state for nonsense');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(100);
  check(await win.inputValue('.library .search input') === '', 'Esc clears the search');
  check(await win.locator('.lib-card[data-item="circle"]').count() === 1, 'categories come back after clearing');
  await win.locator('.lib-card[data-item="neural_network"]').scrollIntoViewIfNeeded();
  await win.waitForTimeout(1500);
  await shot('library-ml-category');
  await S(() => window.__ms.store.getState().commit((p) => { p.clips = p.clips.filter((c) => c.item !== 'transformer_block'); }));
}

// ---------------------------------------------------------------- 13. code panel, save, export
console.log('13. code panel, save, export');
await win.click('button:has-text("Code")');
await win.waitForTimeout(800);
const scene = await win.locator('[data-testid="scene-code"] .cm-content').innerText();
check(scene.includes('from studio_runtime import *') && scene.includes('def make_'), 'code panel shows the generated ManimGL scene');
await win.locator('[data-testid="scene-code"] .cm-scroller').evaluate((el) => (el.scrollTop = el.scrollHeight));
await win.waitForTimeout(300);
const tail = await win.locator('[data-testid="scene-code"] .cm-content').innerText();
check(tail.includes('self.clip(') && tail.includes('layer='), 'scene class with the clips at the bottom');
await shot('code-panel');
await win.click('button[title="Save (⌘S)"]');
await win.waitForTimeout(500);
check(fs.existsSync(env.MATHSTUDIO_TEST_SAVE_PATH), 'project saved');
const saved = JSON.parse(fs.readFileSync(env.MATHSTUDIO_TEST_SAVE_PATH, 'utf8'));
check(saved.clips.length === (await state()).project.clips.length, 'saved project contains all clips');
await S(() => window.__ms.store.setState({ exportOpen: true }));
await win.selectOption('.modal select >> nth=0', '854x480');
await win.click('[data-testid="export-start"]');
const t0 = Date.now();
let exported = null;
while (Date.now() - t0 < 120000) {
  const txt = await win.locator('.export-status').innerText().catch(() => '');
  if (txt.includes('Done') || txt.includes('failed')) { exported = txt; break; }
  await win.waitForTimeout(400);
}
await shot('export');
check(exported && exported.includes('Done'), `export finished (${exported?.split('\n')[0]})`);
const vid = path.join(TMP, `${saved.settings.name}.mp4`);
check(fs.existsSync(vid) && fs.statSync(vid).size > 10000, `video written (${vid})`);

check(errors.length === 0, `no console errors (${errors.slice(0, 3).join(' | ')})`);
await app.close();
console.log(`\n${fails.length} failure(s)`);
fails.forEach((f) => console.log(' -', f));
process.exit(fails.length ? 1 : 0);
