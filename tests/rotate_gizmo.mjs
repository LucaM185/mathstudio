// 3D rotate widget (bottom-right of the stage): shown only while a rotatable clip is selected;
// three rings drawn from the viewer's point of view, six ribbon arrows that turn the clip 15° about
// world X / Y / Z; the rendered clip really moves the way the clicked arrow points (any view), hold
// keeps turning, the value chips scrub, reset / undo work. No model calls.
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
const zero = (id) => S((id) => window.__ms.store.getState().commit((p) => { const c = p.clips.find((c) => c.id === id); c.transform = { ...c.transform, rotation: 0, rx: 0, ry: 0 }; c.keys = []; }), id);
// an arrow of the widget: where to click it, and the way it points on screen (y down)
const arrow = async (axis, name) => {
  const el = win.locator(`[data-testid="rot-${axis}-${name}"]`);
  const mid = (await el.getAttribute('data-mid')).split(',').map(Number);
  const dir = (await el.getAttribute('data-dir')).split(',').map(Number);
  const box = await win.locator(`[data-testid="rot-ring-${axis}"]`).boundingBox();
  return { x: box.x + mid[0], y: box.y + mid[1], dir };
};
const clickArrow = async (axis, name, mod) => {
  const a = await arrow(axis, name);
  if (mod) await win.keyboard.down(mod);
  await win.mouse.click(a.x, a.y);
  if (mod) await win.keyboard.up(mod);
  await win.waitForTimeout(100);
  return a;
};
// rotation matrices, as the engine applies them: Ry(ry) · Rx(rx) · Rz(rotation)
const D = Math.PI / 180;
const rot = (ax, deg) => { const c = Math.cos(deg * D), s = Math.sin(deg * D); return ax === 'x' ? [[1, 0, 0], [0, c, -s], [0, s, c]] : ax === 'y' ? [[c, 0, s], [0, 1, 0], [-s, 0, c]] : [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
const mm = (a, b) => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
const matOf = (t) => mm(rot('y', t.ry || 0), mm(rot('x', t.rx || 0), rot('z', t.rotation || 0)));
const mdiff = (a, b) => Math.max(...a.flatMap((r, i) => r.map((v, j) => Math.abs(v - b[i][j]))));
// centre of the pure red / pure green pixels of the rendered frame, in canvas px
const blob = (which) => S((which) => {
  const cv = document.querySelector('.stage-canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < d.length; i += 4) {
    const hit = which === 'red' ? d[i] > 200 && d[i + 1] < 70 && d[i + 2] < 70 : d[i + 1] > 200 && d[i] < 70 && d[i + 2] < 70;
    if (hit) { n++; sx += (i / 4) % cv.width; sy += Math.floor(i / 4 / cv.width); }
  }
  return n ? { x: sx / n, y: sy / n, n } : null;
}, which);

console.log('1. hidden until a rotatable clip is selected');
const add = await tool('add_clips', { clips: [
  // red dot = on the side facing a front viewer, green dot = near the card's top edge
  { item: 'custom', name: 'Card', code: "return VGroup(Rectangle(4, 2.4).set_fill(BLUE, 0.8).set_stroke(WHITE, 4), Dot(OUT * 1.2, radius=0.25).set_fill('#ff0000', 1), Dot(UP * 0.85, radius=0.2).set_fill('#00ff00', 1))", start: 0, duration: 6, x: -2, y: 0, enter: { type: 'none' }, exit: { type: 'none' } },
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

console.log('2. six arrows, 15° about the world axes');
check(await win.locator('.rot-arrow').count() === 6, 'three rings carry six arrows');
const past0 = await S(() => window.__ms.store.getState().past.length);
await clickArrow('x', 'pos');
let t = await tr(cid);
check(near(t.rx, 15) && near(t.ry || 0, 0) && near(t.rotation, 0), `X arrow = +15° about X (${t.rx})`);
check(await S(() => window.__ms.store.getState().past.length) === past0 + 1, 'one click = one undo step');
await clickArrow('x', 'neg', 'Shift');
t = await tr(cid);
check(near(t.rx, -75), `Shift + the other X arrow = −90° (${t.rx})`);
check((await win.locator('[data-testid="rot-x-val"]').innerText()).includes('-75'), 'X chip shows −75°');
await clickArrow('y', 'pos');
t = await tr(cid);
check(near(t.ry, 15) && near(t.rx, -75), `Y arrow = +15° about Y, X untouched (${t.rx}, ${t.ry})`);
// on a tilted clip the arrows still turn about the WORLD axis: new = R_axis(±15°) · old
for (const [axis, name, deg] of [['z', 'pos', 15], ['x', 'pos', 15], ['z', 'neg', -15], ['y', 'neg', -15], ['x', 'neg', -15]]) {
  const m0 = matOf(await tr(cid));
  await clickArrow(axis, name);
  const t1 = await tr(cid);
  const err = mdiff(matOf(t1), mm(rot(axis, deg), m0));
  check(err < 2e-3, `tilted clip: ${axis.toUpperCase()} ${name} arrow = ${deg}° about world ${axis.toUpperCase()} (err ${err.toExponential(1)}; now ${t1.rx}, ${t1.ry}, ${t1.rotation})`);
}
await zero(cid);
await clickArrow('z', 'pos');
await clickArrow('z', 'pos', 'Alt');
const tz = await tr(cid);
check(near(tz.rotation, 16) && near(tz.rx, 0) && near(tz.ry, 0), `flat clip: Z arrow then Alt + Z arrow = Rotation +16° only (${tz.rx}, ${tz.ry}, ${tz.rotation})`);
check(/16°/.test(await win.locator('[data-testid="rot-z-val"]').innerText()), 'Z chip shows 16°');
// 24 clicks = a full turn, back where it started (numbers stay continuous, no drift)
await S((id) => window.__ms.store.getState().commit((p) => { const c = p.clips.find((c) => c.id === id); c.transform = { ...c.transform, rotation: 20, rx: -35, ry: 50 }; }), cid);
const mStart = matOf(await tr(cid));
let maxJump = 0, prev = await tr(cid);
for (let i = 0; i < 24; i++) {
  await clickArrow('x', 'pos');
  const c = await tr(cid);
  maxJump = Math.max(maxJump, Math.abs(c.rx - prev.rx), Math.abs(c.ry - prev.ry), Math.abs(c.rotation - prev.rotation));
  prev = c;
}
check(mdiff(matOf(prev), mStart) < 5e-3, `24 × 15° about X = back at the start (err ${mdiff(matOf(prev), mStart).toExponential(1)})`);
check(maxJump < 60, `angles never jump by a turn on the way (largest step ${maxJump.toFixed(1)}°)`);
await zero(cid);
await settle();
await win.screenshot({ path: path.join(OUT, '2_turned.png') });

console.log('2b. the rendered clip moves the way the clicked arrow points');
// front view: the red dot sits on the side facing the viewer, the green one at the top of the card
const follows = async (label, axis, name, which, minCos) => {
  await zero(cid);
  await win.waitForTimeout(900);
  const p0 = await blob(which);
  const a = await clickArrow(axis, name);
  let p1 = null;
  for (let i = 0; i < 12; i++) { // wait for the re-rendered frame
    await win.waitForTimeout(300);
    p1 = await blob(which);
    if (p0 && p1 && Math.hypot(p1.x - p0.x, p1.y - p0.y) > 1) break;
  }
  await win.waitForTimeout(300);
  p1 = await blob(which);
  if (!p0 || !p1) return check(false, `${label}: ${which} marker visible (${JSON.stringify(p0)} → ${JSON.stringify(p1)})`);
  const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy);
  const cos = len ? (dx * a.dir[0] + dy * a.dir[1]) / len : 0;
  check(len > 3 && cos > minCos, `${label}: ${axis.toUpperCase()} ${name} arrow points (${a.dir.map((v) => v.toFixed(2))}), ${which} marker moved (${dx.toFixed(1)}, ${dy.toFixed(1)}) px — cos ${cos.toFixed(2)}`);
};
for (const [axis, which] of [['x', 'red'], ['y', 'red'], ['z', 'green']]) for (const name of ['pos', 'neg']) await follows('front view', axis, name, which, 0.9);
await zero(cid);
await win.screenshot({ path: path.join(OUT, '2b_front.png') });
// the rings follow the camera: in a 3/4 view every arrow points somewhere else, and still tells the truth
const dirsFront = {};
for (const ax of ['x', 'y', 'z']) dirsFront[ax] = (await arrow(ax, 'pos')).dir;
await S(() => window.__ms.store.setState({ editorView: { x: 0, y: 0, z: 0, zoom: 0.8, theta: -30, phi: 15, gamma: 0 } }));
await settle();
const dirs34 = {};
for (const ax of ['x', 'y', 'z']) dirs34[ax] = (await arrow(ax, 'pos')).dir;
check(['x', 'y', 'z'].some((ax) => Math.hypot(dirs34[ax][0] - dirsFront[ax][0], dirs34[ax][1] - dirsFront[ax][1]) > 0.15), `arrows are redrawn for the 3/4 view (${JSON.stringify(dirs34)})`);
for (const [axis, which] of [['x', 'red'], ['y', 'red'], ['z', 'green']]) for (const name of ['pos', 'neg']) await follows('3/4 view', axis, name, which, 0.5);
await win.screenshot({ path: path.join(OUT, '2c_three_quarter.png') });
// from the top (eye on +y) and from behind
for (const [label, ev] of [['top', { theta: 180, phi: 90, gamma: 180 }], ['back', { theta: 180, phi: 0.001, gamma: 0 }]]) {
  await S((ev) => window.__ms.store.setState({ editorView: { x: 0, y: 0, z: 0, zoom: 0.8, ...ev } }), ev);
  await settle();
  await win.screenshot({ path: path.join(OUT, `2d_${label}.png`) });
}
await S(() => window.__ms.store.setState({ editorView: null }));
await zero(cid);
await settle();

console.log('3. the engine renders the turn (card edge-on at rx 90)');
const ink = () => S(() => {
  const cv = document.querySelector('.stage-canvas');
  const g = cv.getContext('2d');
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 150 && d[i] < 120 && d[i + 1] > 100) n++; // blue fill
  return n;
});
const inkFlat = await ink();
await clickArrow('x', 'pos', 'Shift');
await win.waitForTimeout(1200);
const inkEdge = await ink();
check(near((await tr(cid)).rx, 90), `Shift-click from flat = Rot X 90 (${(await tr(cid)).rx})`);
check(inkFlat > 2000 && inkEdge < inkFlat * 0.1, `card's blue fill: ${inkFlat}px flat → ${inkEdge}px edge-on`);
await win.screenshot({ path: path.join(OUT, '3_edge_on.png') });

console.log('4. double-click a chip = 0, reset = all 0, undo restores');
await win.dblclick('[data-testid="rot-x-val"]');
await win.waitForTimeout(100);
check(near((await tr(cid)).rx, 0), 'double-click X chip → Rot X 0');
await clickArrow('z', 'neg');
await clickArrow('y', 'neg');
t = await tr(cid);
check(near(t.ry, -15) && near(t.rotation, -15), `Z then Y arrows (${t.ry}, ${t.rotation})`);
await win.click('[data-testid="rot-reset"]');
await win.waitForTimeout(100);
t = await tr(cid);
check(near(t.rx, 0) && near(t.ry, 0) && near(t.rotation, 0), 'reset puts every angle back to 0');
await S(() => window.__ms.store.getState().undo());
t = await tr(cid);
check(near(t.ry, -15) && near(t.rotation, -15), `undo brings the turn back (${t.ry}, ${t.rotation})`);

console.log('5. hold an arrow = keep turning; drag a chip = scrub');
await zero(cid);
const ya = await arrow('y', 'pos');
const pastH = await S(() => window.__ms.store.getState().past.length);
await win.mouse.move(ya.x, ya.y);
await win.mouse.down();
await win.waitForTimeout(1350);
await win.mouse.up();
const held = (await tr(cid)).ry;
await win.waitForTimeout(300);
check(held > 60 && held < 140, `holding the Y arrow for ~1.35 s turned ${held.toFixed(1)}° (15 + ~90°/s)`);
check(near((await tr(cid)).ry, held, 0.01), 'stops turning on release');
check(await S(() => window.__ms.store.getState().past.length) === pastH + 1, 'the whole hold is one undo step');
check(await S(() => window.__ms.store.getState().interacting) === false, 'interacting flag cleared');
const zv = await win.locator('[data-testid="rot-z-val"]').boundingBox();
await win.mouse.move(zv.x + zv.width / 2, zv.y + zv.height / 2);
await win.mouse.down();
for (let i = 1; i <= 8; i++) await win.mouse.move(zv.x + zv.width / 2 + i * 10, zv.y + zv.height / 2);
await win.mouse.up();
t = await tr(cid);
check(near(t.rotation, 40, 0.5) && near(t.ry, held, 0.01), `dragging the Z chip 80px right → Rotation +40°, Y kept (${t.rotation}, ${t.ry})`);
check((await S(() => window.__ms.store.getState().selection)).includes(cid), 'using the widget keeps the selection');
// keyboard: focus an arrow, Enter = one step
await zero(cid);
await win.locator('[data-testid="rot-x-neg"]').focus();
await win.keyboard.press('Enter');
await win.waitForTimeout(100);
check(near((await tr(cid)).rx, -15), `Enter on a focused arrow = one 15° step (${(await tr(cid)).rx})`);
await zero(cid);

console.log('6. keyframed clips get a key at the playhead; multi-selection turns every clip');
await tool('update_clips', { updates: [{ id: did, keyframes: [{ t: 0, x: 4 }, { t: 4, x: 3 }] }] });
await S(([a, b]) => window.__ms.store.setState({ selection: [a, b] }), [cid, did]);
await S(() => window.__ms.store.getState().setTime(2));
await settle();
check((await gizmo.innerText()).includes('2'), 'header shows the count of selected clips');
const before = await tr(cid);
await clickArrow('x', 'pos');
const after = await tr(cid);
const dk = await S((id) => window.__ms.store.getState().project.clips.find((c) => c.id === id).keys.map((k) => ({ t: k.t, rx: k.rx })), did);
check(near(after.rx, (before.rx || 0) + 15), `first clip turned (${after.rx})`);
check(dk.length === 3 && dk.some((k) => near(k.t, 2) && near(k.rx, 15)), `keyframed clip got a key at 2 s with Rot X 15 (${JSON.stringify(dk)})`);

console.log('6b. depth handle: ⊙ / ⊗ pull toward the viewer / push into the screen');
await S((id) => { window.__ms.store.getState().commit((p) => { const c = p.clips.find((c) => c.id === id); c.transform = { ...c.transform, rotation: 0, rx: 0, ry: 0, z: 0 }; c.keys = []; }); window.__ms.store.setState({ selection: [id] }); window.__ms.store.getState().setTime(1); }, cid);
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
