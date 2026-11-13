// 3D rotate widget (bottom-right of the stage): shown only while a rotatable clip is selected;
// arrows turn the clip about world X / Y / Z, hold keeps turning, the value scrubs, reset / undo work,
// and the engine really renders the turn. No model calls.
//   npm run build && node tests/rotate_gizmo.mjs
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out', 'rotate_gizmo');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-rg-'));
const fails = [];
const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

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
const tool = (name, args) => S(async ([name, args]) => {
  const h = window.__ms.sessions.docHandle(window.__ms.store.getState().sessionId);
  const r = await window.__ms.agentTools.runTool(h, name, JSON.stringify(args));
  return { ok: r.ok, summary: r.summary };
}, [name, args]);
const tr = (id) => S((id) => { const c = window.__ms.store.getState().project.clips.find((c) => c.id === id); return { ...c.transform, keys: c.keys.length }; }, id);
const gizmo = win.locator('[data-testid="rot-gizmo"]');
const settle = () => win.waitForTimeout(700);

console.log('1. hidden until a rotatable clip is selected');
const add = await tool('add_clips', { clips: [
  { item: 'custom', name: 'Card', code: "return Rectangle(4, 2.4).set_fill(BLUE, 0.8).set_stroke(WHITE, 4)", start: 0, duration: 6, x: -2, y: 0, enter: { type: 'none' }, exit: { type: 'none' } },
  { item: 'custom', name: 'Dot2', code: "return Circle(radius=0.8).set_fill(RED, 1)", start: 0, duration: 6, x: 4, y: 0, enter: { type: 'none' }, exit: { type: 'none' } },
] });
check(add.ok, `add_clips ok (${add.summary})`);
const [cid, did] = await S(() => window.__ms.store.getState().project.clips.map((c) => c.id));
await S(() => { window.__ms.store.getState().setTime(1); window.__ms.store.setState({ selection: [] }); });
await settle();
check(await gizmo.count() === 0, 'no widget with nothing selected');
await S(() => window.__ms.store.setState({ selection: ['__camera__'] }));
await settle();
check(await gizmo.count() === 0, 'no widget while the camera is selected');

// select by clicking the clip on the stage
await S(() => window.__ms.store.setState({ selection: [] }));
await settle();
const stage = await win.locator('.stage-canvas').boundingBox();
const cardPx = await S(() => {
  const m = window.__ms.store.getState().meta; const c = window.__ms.store.getState().project.clips[0];
  return { x: c.transform.x, y: c.transform.y, fw: m.frame[0], fh: m.frame[1] };
});
await win.mouse.click(stage.x + stage.width * (0.5 + cardPx.x / cardPx.fw), stage.y + stage.height * (0.5 - cardPx.y / cardPx.fh));
await settle();
check((await S(() => window.__ms.store.getState().selection)).includes(cid), 'clicking the card selects it');
check(await gizmo.isVisible(), 'widget appears for the selected clip');
const gb = await gizmo.boundingBox();
check(gb && gb.x + gb.width > stage.x + stage.width - 20 && gb.y + gb.height > stage.y + stage.height - 20, `widget sits in the stage's bottom-right corner (${JSON.stringify(gb)})`);
await win.screenshot({ path: path.join(OUT, '1_selected.png') });

console.log('2. arrows turn about X / Y / Z');
const past0 = await S(() => window.__ms.store.getState().past.length);
await win.click('[data-testid="rot-x-ccw"]');
await win.waitForTimeout(100);
let t = await tr(cid);
check(near(t.rx, 15) && near(t.ry || 0, 0) && near(t.rotation, 0), `↶ X = +15° Rot X (${t.rx})`);
check(await S(() => window.__ms.store.getState().past.length) === past0 + 1, 'one click = one undo step');
await win.click('[data-testid="rot-x-cw"]', { modifiers: ['Shift'] });
await win.waitForTimeout(100);
t = await tr(cid);
check(near(t.rx, -75), `Shift-↷ X = −90° (${t.rx})`);
check((await win.locator('[data-testid="rot-x-val"]').innerText()).includes('-75'), 'X value shows −75°');
await win.click('[data-testid="rot-y-ccw"]');
await win.waitForTimeout(100);
t = await tr(cid);
check(near(t.ry, 15) && near(t.rx, -75), `↶ Y = +15° Rot Y, X untouched (${t.rx}, ${t.ry})`);
// Z spins the clip in its own plane: only Rotation changes, even when it is tipped / turned
await win.click('[data-testid="rot-z-ccw"]');
await win.click('[data-testid="rot-z-ccw"]', { modifiers: ['Alt'] });
await win.waitForTimeout(100);
const tz = await tr(cid);
check(near(tz.rotation, 16) && near(tz.rx, -75) && near(tz.ry, 15), `↶ Z then Alt-↶ Z = Rotation +16°, tip / turn untouched (${tz.rx}, ${tz.ry}, ${tz.rotation})`);
check(/16°/.test(await win.locator('[data-testid="rot-z-val"]').innerText()), 'Z value shows 16°');
await settle();
await win.screenshot({ path: path.join(OUT, '2_turned.png') });

console.log('3. the engine renders the turn (card edge-on at rx 90)');
await S((id) => window.__ms.store.getState().commit((p) => { const c = p.clips.find((c) => c.id === id); c.transform = { ...c.transform, rotation: 0, rx: 0, ry: 0 }; }), cid);
await settle();
const ink = () => S(() => {
  const cv = document.querySelector('.stage-canvas');
  const g = cv.getContext('2d');
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 150 && d[i] < 120) n++; // blue fill
  return n;
});
const inkFlat = await ink();
await win.click('[data-testid="rot-x-ccw"]', { modifiers: ['Shift'] });
await win.waitForTimeout(1200);
const inkEdge = await ink();
check(inkFlat > 2000 && inkEdge < inkFlat * 0.1, `card's blue fill: ${inkFlat}px flat → ${inkEdge}px edge-on`);
check(await S(() => document.querySelector('[data-testid="rot-preview"]').getAttribute('data-facing')) === 'front', 'orientation preview shows the card');
await win.screenshot({ path: path.join(OUT, '3_edge_on.png') });

console.log('4. double-click a value = 0, reset = all 0, undo restores');
await win.dblclick('[data-testid="rot-x-val"]');
await win.waitForTimeout(100);
check(near((await tr(cid)).rx, 0), 'double-click X value → Rot X 0');
await win.click('[data-testid="rot-y-cw"]');
await win.click('[data-testid="rot-z-cw"]');
await win.waitForTimeout(100);
t = await tr(cid);
check(near(t.ry, -15) && near(t.rotation, -15), `↷ Y and ↷ Z (${t.ry}, ${t.rotation})`);
await win.click('[data-testid="rot-reset"]');
await win.waitForTimeout(100);
t = await tr(cid);
check(near(t.rx, 0) && near(t.ry, 0) && near(t.rotation, 0), 'reset puts every angle back to 0');
await S(() => window.__ms.store.getState().undo());
t = await tr(cid);
check(near(t.ry, -15) && near(t.rotation, -15), `undo brings the turn back (${t.ry}, ${t.rotation})`);

console.log('5. hold an arrow = keep turning; drag the value = scrub');
await S((id) => window.__ms.store.getState().commit((p) => { const c = p.clips.find((c) => c.id === id); c.transform = { ...c.transform, rotation: 0, rx: 0, ry: 0 }; }), cid);
const yb = await win.locator('[data-testid="rot-y-ccw"]').boundingBox();
const pastH = await S(() => window.__ms.store.getState().past.length);
await win.mouse.move(yb.x + yb.width / 2, yb.y + yb.height / 2);
await win.mouse.down();
await win.waitForTimeout(1350);
await win.mouse.up();
const held = (await tr(cid)).ry;
await win.waitForTimeout(300);
check(held > 60 && held < 140, `holding ↶ Y for ~1.35 s turned ${held.toFixed(1)}° (15 + ~90°/s)`);
check(near((await tr(cid)).ry, held, 0.01), 'stops turning on release');
check(await S(() => window.__ms.store.getState().past.length) === pastH + 1, 'the whole hold is one undo step');
check(await S(() => window.__ms.store.getState().interacting) === false, 'interacting flag cleared');
const zv = await win.locator('[data-testid="rot-z-val"]').boundingBox();
await win.mouse.move(zv.x + zv.width / 2, zv.y + zv.height / 2);
await win.mouse.down();
for (let i = 1; i <= 8; i++) await win.mouse.move(zv.x + zv.width / 2 + i * 10, zv.y + zv.height / 2);
await win.mouse.up();
t = await tr(cid);
check(near(t.rotation, 40, 0.5) && near(t.ry, held, 0.01), `dragging the Z value 80px right → Rotation +40°, Y kept (${t.rotation}, ${t.ry})`);
check((await S(() => window.__ms.store.getState().selection)).includes(cid), 'using the widget keeps the selection');

console.log('6. keyframed clips get a key at the playhead; multi-selection turns every clip');
await tool('update_clips', { updates: [{ id: did, keyframes: [{ t: 0, x: 4 }, { t: 4, x: 3 }] }] });
await S(([a, b]) => window.__ms.store.setState({ selection: [a, b] }), [cid, did]);
await S(() => window.__ms.store.getState().setTime(2));
await settle();
check((await gizmo.innerText()).includes('2'), 'header shows the count of selected clips');
const before = await tr(cid);
await win.click('[data-testid="rot-x-ccw"]');
await win.waitForTimeout(100);
const after = await tr(cid);
const dk = await S((id) => window.__ms.store.getState().project.clips.find((c) => c.id === id).keys.map((k) => ({ t: k.t, rx: k.rx })), did);
check(near(after.rx, (before.rx || 0) + 15), `first clip turned (${after.rx})`);
check(dk.length === 3 && dk.some((k) => near(k.t, 2) && near(k.rx, 15)), `keyframed clip got a key at 2 s with Rot X 15 (${JSON.stringify(dk)})`);

console.log('6b. depth handle: ⊙ / ⊗ pull toward the viewer / push into the screen');
await S((id) => { window.__ms.store.getState().commit((p) => { const c = p.clips.find((c) => c.id === id); c.transform = { ...c.transform, rotation: 0, rx: 0, ry: 0, z: 0 }; }); window.__ms.store.setState({ selection: [id] }); window.__ms.store.getState().setTime(1); }, cid);
await settle();
const dh = win.locator('[data-testid="depth-handle"]');
check(await dh.count() === 1, 'depth handle shown for the selected clip');
check(await dh.getAttribute('data-axis') === 'z', 'front (2D) view: depth = z');
const hb = await win.locator('[data-testid="depth-drag"]').boundingBox();
const cardBox = await win.locator('.sel-box').boundingBox();
check(hb && cardBox && hb.x > cardBox.x + cardBox.width && Math.abs(hb.y + hb.height / 2 - (cardBox.y + cardBox.height / 2)) < 4, 'handle sits right of the selection box, vertically centred');
const pastD = await S(() => window.__ms.store.getState().past.length);
await win.click('[data-testid="depth-out"]');
await win.waitForTimeout(100);
check(near((await tr(cid)).z, 0.5), `click ⊙ = +0.5 toward you (z ${(await tr(cid)).z})`);
check(await S(() => window.__ms.store.getState().past.length) === pastD + 1, 'one click = one undo step');
await win.click('[data-testid="depth-in"]');
await win.click('[data-testid="depth-in"]');
await win.waitForTimeout(100);
check(near((await tr(cid)).z, -0.5), `two ⊗ clicks = −1 (z ${(await tr(cid)).z})`);
check((await S(() => window.__ms.store.getState().selection)).join() === cid, 'clicking the handle keeps the selection');
// drag up = pull out
const unitPx = await S(() => { const m = window.__ms.store.getState().meta; const cv = document.querySelector('.stage-canvas').getBoundingClientRect(); return cv.width / m.frame[0]; });
const hb2 = await win.locator('[data-testid="depth-drag"]').boundingBox();
const hx = hb2.x + hb2.width / 2, hy = hb2.y + hb2.height / 2;
await win.mouse.move(hx, hy);
await win.mouse.down();
for (let i = 1; i <= 10; i++) await win.mouse.move(hx, hy - (unitPx * 2.5 * i) / 10);
await win.waitForTimeout(150);
check(/z 2\.00/.test(await win.locator('[data-testid="depth-readout"]').textContent()), 'readout shows the depth while dragging');
await win.screenshot({ path: path.join(OUT, '4_depth_drag.png') });
await win.mouse.up();
check(near((await tr(cid)).z, 2, 0.02), `dragging up 2.5 units pulls z from −0.5 to 2 (${(await tr(cid)).z})`);
// snapping back to the 0 plane
const hb3 = await win.locator('[data-testid="depth-drag"]').boundingBox();
const h3x = hb3.x + hb3.width / 2, h3y = hb3.y + hb3.height / 2;
await win.mouse.move(h3x, h3y);
await win.mouse.down();
for (let i = 1; i <= 10; i++) await win.mouse.move(h3x, h3y + (unitPx * 2.03 * i) / 10);
await win.mouse.up();
check(near((await tr(cid)).z, 0, 1e-6), `dragging near z 0 snaps onto it (${(await tr(cid)).z})`);
await win.waitForTimeout(900);
const big = await S(() => window.__ms.store.getState().meta.clips[window.__ms.store.getState().selection[0]]);
check(!!big, 'engine still reports the clip');

// tilted 3D editor view from above: the move plane is XZ, so depth is y and ⊙ (toward the eye above) raises it
await S(() => window.__ms.store.setState({ editorView: { x: 0, y: 0, z: 0, zoom: 1, theta: 180, phi: 90, gamma: 180 } }));
await settle();
check(await dh.getAttribute('data-axis') === 'y', `Top view: depth = y (${await dh.getAttribute('data-axis')})`);
const y0 = (await tr(cid)).y;
await win.click('[data-testid="depth-out"]');
await win.waitForTimeout(100);
check(near((await tr(cid)).y, y0 + 0.5), `⊙ from Top raises the clip toward the eye (y ${y0} → ${(await tr(cid)).y})`);
// a 3/4 view: plane XY, depth z, and the dashed axis guide appears while dragging
await S(() => window.__ms.store.setState({ editorView: { x: 0, y: 0, z: 0, zoom: 0.8, theta: -30, phi: 15, gamma: 0 } }));
await settle();
check(await dh.getAttribute('data-axis') === 'z', '3/4 view from the front: depth = z');
const hb4 = await win.locator('[data-testid="depth-drag"]').boundingBox();
await win.mouse.move(hb4.x + hb4.width / 2, hb4.y + hb4.height / 2);
await win.mouse.down();
await win.mouse.move(hb4.x + hb4.width / 2, hb4.y + hb4.height / 2 - 40, { steps: 5 });
check(await win.locator('.depth-guide').count() === 1, 'dragging shows the depth axis through the clip');
await win.screenshot({ path: path.join(OUT, '5_depth_3d.png') });
await win.mouse.up();
check((await tr(cid)).z > 0.5, `dragging up in 3D pulls it out (z ${(await tr(cid)).z})`);
await S(() => window.__ms.store.setState({ editorView: null }));
await settle();

console.log('7. hidden for locked tracks and during playback-free states');
await S((id) => { const st = window.__ms.store.getState(); const c = st.project.clips.find((c) => c.id === id); st.commit((p) => { p.tracks.find((t) => t.id === c.track).locked = true; }); window.__ms.store.setState({ selection: [id] }); }, did);
await settle();
check(await gizmo.count() === 0, 'no widget for a clip on a locked track');
await S(() => window.__ms.store.setState({ selection: [] }));
await settle();
check(await gizmo.count() === 0, 'gone again after deselecting');

check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
await app.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
