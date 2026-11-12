// 3D / CAD-navigation UI test: drives the real Electron app with the mouse and keyboard.
//   npm run build && node tests/e2e3d.mjs        (screenshots go to tests/out/3d-*)
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.E2E_OUT || path.join(ROOT, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-e2e3d-'));
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
// navigation is Y-up: yaw swings around +y (0 = the 2D view from +z), pitch raises the eye towards +y
const DEG = Math.PI / 180;
const yp = (c) => {
  const t = c.theta * DEG, p = c.phi * DEG;
  const o = [Math.sin(t) * Math.sin(p), -Math.cos(t) * Math.sin(p), Math.cos(p)];
  return { yaw: Math.atan2(o[0], o[2]) / DEG, pitch: Math.asin(Math.max(-1, Math.min(1, o[1]))) / DEG };
};
// y component of the screen-right vector: 0 means no roll, i.e. +y stays up on screen
const rollY = (c) => { const [t, p, g] = [c.theta * DEG, c.phi * DEG, c.gamma * DEG]; return Math.sin(t) * Math.cos(g) + Math.cos(t) * Math.cos(p) * Math.sin(g); };
const nearA = (a, b, tol) => Math.abs((((a - b) % 360) + 540) % 360 - 180) <= tol;
const ypStr = (c) => `yaw ${yp(c).yaw.toFixed(1)}, pitch ${yp(c).pitch.toFixed(1)}`;

const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await win.waitForSelector('.lib-card', { timeout: 90000 });

const S = (fn, arg) => win.evaluate(fn, arg);
const state = () => S(() => {
  const s = window.__ms.store.getState();
  return { project: s.project, selection: s.selection, time: s.time, meta: s.meta, editorView: s.editorView, past: s.past.length, fresh: s.metaProject === s.project };
});
const shot = async (name) => win.screenshot({ path: path.join(OUT, `3d-${String(++step).padStart(2, '0')}-${name}.png`) });
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
const setTime = (t) => win.evaluate((t) => window.__ms.store.getState().setTime(t), t);
const cam0 = (st) => (st.project.settings.camera || [])[0] || {};
/** bounding box (CSS px, page coords) and centroid of canvas pixels that are not the background */
const ink = (colorOnly = false) => win.evaluate((colorOnly) => {
  const c = document.querySelector('.stage-canvas');
  const r = c.getBoundingClientRect();
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, sx = 0, sy = 0, n = 0;
  for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
    const i = (y * c.width + x) * 4;
    const hit = colorOnly ? d[i + 2] - d[i] > 70 && d[i + 1] - d[i] > 40 : Math.abs(d[i] - 30) + Math.abs(d[i + 1] - 30) + Math.abs(d[i + 2] - 30) > 60;
    if (hit) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); sx += x; sy += y; n++;
    }
  }
  const k = r.width / c.width;
  return n ? { x0: r.left + x0 * k, y0: r.top + y0 * k, x1: r.left + x1 * k, y1: r.top + y1 * k, cx: r.left + (sx / n) * k, cy: r.top + (sy / n) * k, n } : null;
}, colorOnly);
const rightDrag = async (x, y, dx, dy, opts = {}) => {
  if (opts.shift) await win.keyboard.down('Shift');
  await win.mouse.move(x, y);
  await win.mouse.down({ button: opts.button || 'right' });
  await win.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await win.mouse.move(x + dx, y + dy, { steps: 4 });
  await win.mouse.up({ button: opts.button || 'right' });
  if (opts.shift) await win.keyboard.up('Shift');
};
// (Playwright key events don't reach Electron's menu accelerators and the toolbar has no Undo/Redo
// buttons any more, so call the store — the same thing the ⌘Z menu item does)
const undo = async () => { await win.evaluate(() => window.__ms.store.getState().undo()); await win.waitForTimeout(50); };
const redo = async () => { await win.evaluate(() => window.__ms.store.getState().redo()); await win.waitForTimeout(50); };
const waitStill = async () => {
  // view-cube fly-to animations last ~0.3 s
  await win.waitForTimeout(400);
  // the frame on screen must be the one for the final view
  return waitFrame((s) => !s.editorView || (s.meta.view && ['x', 'y', 'z', 'zoom', 'theta', 'phi'].every((k) => Math.abs(s.meta.view[k] - s.editorView[k]) < 1e-6)));
};

await win.waitForTimeout(600);

// ---------------------------------------------------------------- 1. library
console.log('1. 3D library category');
const cards = await win.locator('.lib-card[data-item="sphere"], .lib-card[data-item="surface_plot"], .lib-card[data-item="axes3d"], .lib-card[data-item="torus"]').count();
check(cards === 4, `3D items are in the library (${cards}/4)`);
await win.locator('.lib-card[data-item="sphere"]').scrollIntoViewIfNeeded();
let th = null;
for (let i = 0; i < 100 && !(th && th.ok && th.w > 0); i++) {
  await win.waitForTimeout(100);
  th = await win.evaluate(() => { const i = document.querySelector('.lib-card[data-item="sphere"] img'); return i && { w: i.naturalWidth, ok: i.complete }; });
}
check(th && th.ok && th.w > 0, 'sphere thumbnail renders');

// ---------------------------------------------------------------- 2. drop a sphere: camera tilts
console.log('2. drop a Sphere: the camera tilts to a 3D view');
let b = await stageBox();
await win.dragAndDrop('.lib-card[data-item="sphere"]', '.stage', { targetPosition: { x: b.width / 2, y: b.height / 2 } });
await setTime(1.5);
let st = await waitFrame((s) => s.meta.clips[s.project.clips[0]?.id]);
const sphere = st.project.clips[0];
check(!!sphere && sphere.item === 'sphere', 'sphere clip created');
check((st.project.settings.camera || []).length === 1 && nearA(yp(cam0(st)).yaw, 35, 0.1) && near(yp(cam0(st)).pitch, 25, 0.1) && near(rollY(cam0(st)), 0, 1e-3), `camera tilted to the Y-up 3D view (${JSON.stringify(cam0(st))})`);
const ISO = cam0(st);
check(st.meta.camera && near(st.meta.camera.phi, ISO.phi, 1e-6) && near(st.meta.camera.gamma, ISO.gamma, 1e-6), 'engine renders through the tilted camera');
check(await win.locator('[data-testid="view-cube"]').count() === 1, 'view cube is shown');
check(await win.locator('[data-testid="sel-poly"]').count() === 1, 'the selection is drawn as a projected 3D outline');
// the outline must contain what's rendered
let ik = await ink();
let pb = await win.locator('[data-testid="sel-poly"] .sel-hull').boundingBox();
check(ik && pb && ik.x0 >= pb.x - 4 && ik.x1 <= pb.x + pb.width + 4 && ik.y0 >= pb.y - 4 && ik.y1 <= pb.y + pb.height + 4,
  `selection outline encloses the rendered sphere (ink ${JSON.stringify(ik && [ik.x0, ik.y0, ik.x1, ik.y1].map(Math.round))} in ${JSON.stringify(pb && [pb.x, pb.y, pb.x + pb.width, pb.y + pb.height].map(Math.round))})`);
await shot('sphere-tilted');
// ⌘Z takes the tilt back but keeps the sphere
await undo();
st = await waitFrame();
check(st.project.clips.length === 1 && !(st.project.settings.camera || []).length, 'undo removes only the camera tilt');
await redo();
st = await waitFrame();
check((st.project.settings.camera || []).length === 1, 'redo brings it back');

// ---------------------------------------------------------------- 3. overlay matches the render exactly
console.log('3. overlay projection matches the renderer');
await S(() => {
  const s = window.__ms.store.getState();
  s.commit((p) => {
    const c = p.clips[0];
    c.item = 'custom'; c.code = 'return Dot(radius=0.06, fill_color=WHITE)';
    c.transform = { ...c.transform, x: 1.7, y: -1.2, z: 1.4 };
    c.enter = { type: 'none', duration: 1 }; c.exit = { type: 'none', duration: 1 };
    p.settings.camera[0] = { ...p.settings.camera[0], x: 0.4, y: 0.3, z: 0.2, zoom: 1.4, theta: 25, phi: 60, gamma: 8 };
  });
});
st = await waitFrame((s) => s.meta.camera.gamma === 8 && s.meta.clips[sphere.id]);
await win.waitForTimeout(150);
ik = await ink();
const dotC = await win.locator('[data-testid="sel-poly"] .center-dot').boundingBox();
check(ik && dotC && near(ik.cx, dotC.x + dotC.width / 2, 2) && near(ik.cy, dotC.y + dotC.height / 2, 2),
  `overlay centre (${dotC && (dotC.x + dotC.width / 2).toFixed(1)}, ${dotC && (dotC.y + dotC.height / 2).toFixed(1)}) sits on the rendered dot (${ik?.cx.toFixed(1)}, ${ik?.cy.toFixed(1)})`);
await S(() => window.__ms.store.getState().undo());
st = await waitFrame((s) => s.project.clips[0].item === 'sphere');

// ---------------------------------------------------------------- 4. orbit / pan / zoom the editor view
console.log('4. CAD navigation: right-drag orbits the editor view, the camera stays');
await win.keyboard.press('Escape');
b = await stageBox();
const camBefore = JSON.stringify(st.project.settings.camera);
const pastBefore = st.past;
await rightDrag(b.x + b.width * 0.25, b.y + b.height * 0.7, 120, -60);
st = await waitFrame((s) => s.editorView && s.meta.view && Math.abs(s.meta.view.theta - s.editorView.theta) < 1e-6);
check(st.editorView && nearA(yp(st.editorView).yaw, 35 - 120 * 0.4, 1.5) && near(yp(st.editorView).pitch, 25 - 60 * 0.4, 1.5), `right-drag orbits (${ypStr(st.editorView)})`);
check(near(rollY(st.editorView), 0, 1e-3), `orbiting keeps +y up on screen (right.y ${rollY(st.editorView).toFixed(4)})`);
check(JSON.stringify(st.project.settings.camera) === camBefore && st.past === pastBefore, 'orbiting the editor view leaves the camera and the undo history alone');
check(st.meta.view && near(st.meta.view.theta, st.editorView.theta, 1e-6) && near(st.meta.camera.theta, ISO.theta, 1e-6), 'preview renders the editor view; meta still reports the camera');
check(await win.locator('[data-testid="editor-view-badge"]').isVisible(), 'editor view badge is shown');
check(await win.locator('[data-testid="cam-frame"]').count() === 1, 'the scene camera frame is drawn in the editor view');
await shot('editor-orbit');
// ⌥-drag also orbits (trackpad friendly)
let ev0 = st.editorView;
await win.keyboard.down('Alt');
await win.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.8);
await win.mouse.down();
await win.mouse.move(b.x + b.width * 0.3 - 50, b.y + b.height * 0.8, { steps: 5 });
await win.mouse.up();
await win.keyboard.up('Alt');
st = await waitFrame();
check(nearA(yp(st.editorView).yaw, yp(ev0).yaw + 50 * 0.4, 1.5) && st.selection.length === 0, `⌥-drag orbits without selecting (${ypStr(ev0)} → ${ypStr(st.editorView)})`);
// ⇧ + right-drag pans: the focal point moves with the pointer
ev0 = st.editorView;
await rightDrag(b.x + b.width * 0.5, b.y + b.height * 0.5, 80, 0, { shift: true });
st = await waitFrame();
const moved = Math.hypot(st.editorView.x - ev0.x, st.editorView.y - ev0.y, st.editorView.z - ev0.z);
const expect = 80 / ((b.width / 14.222222222222221) * ev0.zoom);
check(near(moved, expect, 0.05) && near(st.editorView.theta, ev0.theta, 1e-6), `⇧+right-drag pans by the pointer distance (${moved.toFixed(3)} vs ${expect.toFixed(3)})`);
// scroll zooms towards the pointer
ev0 = st.editorView;
await win.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5);
await win.mouse.wheel(0, -200);
st = await waitFrame((s) => s.editorView.zoom > ev0.zoom * 1.3);
check(st.editorView.zoom > ev0.zoom * 1.3, `scroll zooms the editor view (${ev0.zoom.toFixed(2)} → ${st.editorView.zoom.toFixed(2)})`);
await shot('editor-pan-zoom');

// ---------------------------------------------------------------- 5. view cube
console.log('5. view cube: click faces, edges and corners');
const clickCell = async (sel) => {
  const box = await win.locator(sel).first().boundingBox();
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return waitStill();
};
await win.keyboard.press('5');
await waitStill();
st = await clickCell('.vc-cell.face[data-face="top"]');
check(near(yp(st.editorView).pitch, 90, 0.5), `TOP looks straight down -y (${ypStr(st.editorView)})`);
check(await win.locator('.vc-cell.face[data-face="front"]').count() === 0, 'from the top the front face is hidden');
await shot('cube-top');
// the rim of the top face towards the front = the top-front edge
st = await clickCell('.vc-cell[data-dir="0,7,7"]');
check(near(yp(st.editorView).pitch, 45, 0.5) && nearA(yp(st.editorView).yaw, 0, 0.5), `top-front edge (${ypStr(st.editorView)})`);
st = await clickCell('.vc-cell.face[data-face="front"]');
check(near(st.editorView.phi, 0, 0.5) && nearA(st.editorView.theta + st.editorView.gamma, 0, 0.5), `FRONT is the classic 2D view of the XY plane (θ ${st.editorView.theta}, φ ${st.editorView.phi}, γ ${st.editorView.gamma})`);
await shot('cube-front');
st = await clickCell('.vc-cell[data-dir="7,0,7"]');
check(nearA(yp(st.editorView).yaw, 45, 0.5) && near(yp(st.editorView).pitch, 0, 0.5), `front-right edge (${ypStr(st.editorView)})`);
st = await clickCell('.vc-cell.face[data-face="right"]');
check(nearA(yp(st.editorView).yaw, 90, 0.5) && near(yp(st.editorView).pitch, 0, 0.5) && near(rollY(st.editorView), 0, 1e-3), `RIGHT looks from +x with y up (${ypStr(st.editorView)})`);
// a corner: right-front-top -> true isometric
const corner = await win.locator('.vc-cell[data-dir="6,6,6"]').count();
check(corner >= 1, `the front-right-top corner is clickable (${corner} parts)`);
st = await clickCell('.vc-cell[data-dir="6,6,6"]');
check(near(yp(st.editorView).pitch, 35.26, 0.5) && nearA(yp(st.editorView).yaw, 45, 0.5), `corner gives an isometric view (${ypStr(st.editorView)})`);
await shot('cube-iso');
// drag the cube to orbit
ev0 = st.editorView;
const cubeBox = await win.locator('.vc-cell.face').first().boundingBox();
await win.mouse.move(cubeBox.x + cubeBox.width / 2, cubeBox.y + cubeBox.height / 2);
await win.mouse.down();
await win.mouse.move(cubeBox.x + cubeBox.width / 2 + 40, cubeBox.y + cubeBox.height / 2, { steps: 5 });
await win.mouse.up();
st = await waitFrame();
check(nearA(yp(st.editorView).yaw, yp(ev0).yaw - 40 * 0.4, 1.5), `dragging the cube orbits (${ypStr(ev0)} → ${ypStr(st.editorView)})`);
// a long drag that turns faces in / out of view (re-creating the cells), released far outside the
// cube, must end the gesture: afterwards, hovering the cube without a button must not orbit
{
  const cx = cubeBox.x + cubeBox.width / 2, cy = cubeBox.y + cubeBox.height / 2;
  await win.mouse.move(cx, cy);
  await win.mouse.down();
  await win.mouse.move(cx - 250, cy + 180, { steps: 25 });
  await win.mouse.move(cx - 400, cy + 260, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(50);
  const evA = (await waitFrame()).editorView;
  const cube = await win.locator('[data-testid="view-cube"] > svg').boundingBox();
  await win.mouse.move(cube.x + 5, cube.y + 5);
  await win.mouse.move(cube.x + cube.width - 5, cube.y + cube.height - 5, { steps: 12 });
  await win.mouse.move(cube.x + 200, cube.y + 300, { steps: 8 });
  await win.waitForTimeout(100);
  const evB = (await waitFrame()).editorView;
  check(['theta', 'phi', 'gamma'].every((k) => near(evA[k], evB[k], 1e-6)) && !(await S(() => window.__ms.store.getState().interacting)), `the cube lets go after a drag released outside it (${ypStr(evA)} → ${ypStr(evB)})`);
}
// a corner fly-to goes straight there: no roll at any frame on the way
await win.keyboard.press('1');
await waitStill();
{
  const box = await win.locator('.vc-cell[data-dir="6,6,6"]').first().boundingBox();
  const rec = S(() => new Promise((res) => {
    const out = []; const t0 = performance.now();
    const tick = () => { out.push(window.__ms.store.getState().editorView); if (performance.now() - t0 < 450) requestAnimationFrame(tick); else res(out); };
    requestAnimationFrame(tick);
  }));
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const frames = (await rec).filter(Boolean);
  const worst = Math.max(...frames.map((v) => Math.abs(rollY(v))));
  const pitches = frames.map((v) => yp(v).pitch);
  const mono = pitches.every((p, i) => i === 0 || p >= pitches[i - 1] - 1e-6);
  check(frames.length > 5 && worst < 1e-3 && mono, `corner fly-to from FRONT has no roll and rises steadily (${frames.length} frames, max roll ${worst.toExponential(1)}, pitch ${pitches[0]?.toFixed(1)}→${pitches.at(-1)?.toFixed(1)})`);
  st = await waitStill();
  check(near(yp(st.editorView).pitch, 35.26, 0.5) && nearA(yp(st.editorView).yaw, 45, 0.5), `…and lands on the isometric view (${ypStr(st.editorView)})`);
}
// keyboard presets + fit
await win.keyboard.press('7');
st = await waitStill();
check(near(yp(st.editorView).pitch, 90, 0.5), '7 = top view');
await win.keyboard.press('5');
st = await waitStill();
check(near(yp(st.editorView).pitch, 25, 0.5) && nearA(yp(st.editorView).yaw, 35, 0.5), '5 = Y-up 3D view');
await S(() => window.__ms.store.setState({ editorView: { ...window.__ms.store.getState().editorView, zoom: 0.3, x: 4, y: -3 } }));
await win.keyboard.press('f');
st = await waitStill();
check(st.editorView.zoom > 1 && Math.hypot(st.editorView.x, st.editorView.y) < 0.3, `F fits the scene (zoom ${st.editorView.zoom.toFixed(2)}, centre ${st.editorView.x.toFixed(2)}, ${st.editorView.y.toFixed(2)})`);
ik = await ink(true); // the sphere is light blue, the editor grid is grey / red / green
b = await stageBox();
check(ik && ik.x1 - ik.x0 > b.width * 0.15 && ik.x0 > b.x && ik.x1 < b.x + b.width && near(ik.cx, b.x + b.width / 2, b.width * 0.05) && near(ik.cy, b.y + b.height / 2, b.height * 0.08), `after fitting, the sphere is big and fully on screen (ink ${JSON.stringify(ik && [ik.x0, ik.y0, ik.x1, ik.y1].map(Math.round))}, stage ${JSON.stringify([b.x, b.y, b.x + b.width, b.y + b.height].map(Math.round))}, time ${st.time})`);
await shot('fit');

// ---------------------------------------------------------------- 6. set camera here / back to camera
console.log('6. editor view -> camera');
const evSet = st.editorView;
await win.click('[data-testid="set-camera-here"]');
st = await waitFrame((s) => !s.editorView);
check(!st.editorView && (st.project.settings.camera || []).length === 1 && near(cam0(st).zoom, evSet.zoom, 1e-3) && near(cam0(st).theta, evSet.theta, 1e-3), 'Set camera here copies the view to the (static) camera');
check(near(st.meta.camera.zoom, evSet.zoom, 1e-3) && !st.meta.view?.grid, 'preview looks through the camera again');
await undo();
st = await waitFrame();
check(near(cam0(st).theta, ISO.theta, 1e-6), 'undo restores the previous camera');
// orbit again, then 0 goes back to the camera
b = await stageBox();
await rightDrag(b.x + b.width * 0.2, b.y + b.height * 0.8, 60, 0);
st = await waitFrame((s) => s.editorView);
check(!!st.editorView, 'editor view active');
await win.keyboard.press('0');
st = await waitFrame((s) => !s.editorView && s.meta.view && Math.abs(s.meta.view.theta - s.meta.camera.theta) < 1e-6);
check(!st.editorView && (!st.meta.view || near(st.meta.view.theta, st.meta.camera.theta, 1e-6)), `0 looks through the camera (${JSON.stringify(st.editorView)} ${JSON.stringify(st.meta.view)})`);

// ---------------------------------------------------------------- 7. move objects in 3D
console.log('7. drag an object in a tilted view: it slides on the ground plane under the pointer');
await win.click('.clip');
st = await waitFrame();
check(st.selection[0] === sphere.id, 'sphere selected');
let c0 = await win.locator('[data-testid="sel-poly"] .center-dot').boundingBox();
let from = { x: c0.x + c0.width / 2, y: c0.y + c0.height / 2 };
await win.mouse.move(from.x, from.y);
await win.mouse.down();
await win.mouse.move(from.x + 90, from.y + 40, { steps: 8 });
await win.mouse.up();
st = await waitFrame();
let tr = st.project.clips[0].transform;
check(near(tr.z, 0, 1e-6) && Math.hypot(tr.x, tr.y) > 0.5, `moved on the z = 0 plane (${tr.x}, ${tr.y}, ${tr.z})`);
await win.waitForTimeout(100);
c0 = await win.locator('[data-testid="sel-poly"] .center-dot').boundingBox();
check(near(c0.x + c0.width / 2, from.x + 90, 2.5) && near(c0.y + c0.height / 2, from.y + 40, 2.5), `the object stays under the pointer (${(c0.x + c0.width / 2).toFixed(1)}, ${(c0.y + c0.height / 2).toFixed(1)} vs ${from.x + 90}, ${from.y + 40})`);
await shot('moved-3d');
// from the front view the drag moves in x / z
await S(() => window.__ms.store.getState().commit((p) => { p.settings.camera[0] = { ...p.settings.camera[0], theta: 0, phi: 90, gamma: 0 }; }));
st = await waitFrame((s) => s.meta.camera.phi === 90);
await win.waitForTimeout(100);
const before = st.project.clips[0].transform;
c0 = await win.locator('[data-testid="sel-poly"] .center-dot').boundingBox();
from = { x: c0.x + c0.width / 2, y: c0.y + c0.height / 2 };
await win.mouse.move(from.x, from.y);
await win.mouse.down();
await win.mouse.move(from.x, from.y - 60, { steps: 6 });
await win.mouse.up();
st = await waitFrame();
tr = st.project.clips[0].transform;
check(tr.z > before.z + 0.5 && near(tr.y, before.y, 1e-6), `from the front, dragging up raises z (${before.z} → ${tr.z}) and keeps y`);
await undo();
await undo();
st = await waitFrame();

// ---------------------------------------------------------------- 8. camera selected: navigation leaves the camera alone
console.log('8. camera selected: orbit moves the editor view, not the camera');
await win.click('[data-testid="cam-through"]');
await win.waitForSelector('[data-testid="camera-inspector"]');
// inspector sections start collapsed: open View
if (!(await win.locator('[data-testid="cam-theta"]').count())) await win.locator('[data-testid="camera-inspector"] .ins-section h5').first().click();
check(await win.locator('[data-testid="cam-theta"]').count() === 1, 'camera inspector has orientation fields');
st = await state();
const thetaBefore = cameraTheta(st);
b = await stageBox();
const camBefore8 = JSON.stringify(st.project.settings.camera);
const past8 = st.past;
await rightDrag(b.x + b.width * 0.3, b.y + b.height * 0.6, -100, 0);
st = await waitFrame((s) => s.editorView && s.meta.view && Math.abs(s.meta.view.theta - s.editorView.theta) < 1e-6);
check(JSON.stringify(st.project.settings.camera) === camBefore8 && st.past === past8, `right-drag with the camera selected doesn't touch the camera (θ ${thetaBefore} → ${cameraTheta(st)})`);
check(!!st.editorView && nearA(yp(st.editorView).yaw, yp(st.meta.camera).yaw + 40, 1.5), `…it orbits the editor view from the camera's viewpoint (${ypStr(st.meta.camera)} → ${ypStr(st.editorView)})`);
check(st.selection.includes('__camera__') && await win.locator('[data-testid="editor-view-badge"]').count() === 1 && await win.locator('[data-testid="camera-inspector"]').count() === 1, 'camera stays selected; editor view badge shown');
await shot('camera-orbit-editor-view');
let ev8 = st.editorView;
await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await win.mouse.wheel(0, -300);
st = await waitFrame((s) => s.editorView && s.editorView.zoom > ev8.zoom * 1.2);
check(st.editorView.zoom > ev8.zoom * 1.2 && JSON.stringify(st.project.settings.camera) === camBefore8, `scroll zooms the editor view, camera unchanged (${ev8.zoom.toFixed(2)} → ${st.editorView.zoom.toFixed(2)})`);
await win.keyboard.press('7');
st = await waitStill();
check(near(yp(st.editorView).pitch, 90, 0.5) && JSON.stringify(st.project.settings.camera) === camBefore8, 'view keys move the editor view, camera unchanged');
ev8 = st.editorView;
await win.click('[data-testid="set-camera-here"]');
st = await waitFrame((s) => !s.editorView);
check(near(yp(cam0(st)).pitch, 90, 0.5) && near(cam0(st).zoom, ev8.zoom, 1e-3) && st.past === past8 + 1, `the camera button is what sets the camera (θ ${cameraTheta(st)})`);
await undo();
st = await waitFrame();
check(near(cameraTheta(st), thetaBefore, 1e-6), 'one undo step for Set camera here');
// view presets in the inspector
await win.click('[data-testid="cam-preset-top"]');
st = await waitStill();
check(near(yp(st.meta.camera).pitch, 90, 0.5), 'Top preset looks down -y');
await win.click('[data-testid="cam-preset-iso"]');
st = await waitStill();
check(near(yp(st.meta.camera).pitch, 25, 0.5), '3D preset tilts it again');
// in a tilted camera the 2D crop overview is off
check(await win.locator('[data-testid="crop-overlay"]').count() === 0, 'no 2D crop box with a tilted camera');
// animate an orbit with two keys
await setTime(0);
await S(() => window.__ms.store.getState().commit((p) => {
  p.settings.camera = [
    { id: 'k0', t: 0, x: 0, y: 0, z: 0, zoom: 1, theta: -60, phi: 70, gamma: 0, ease: 'linear' },
    { id: 'k1', t: 3, x: 0, y: 0, z: 0, zoom: 1, theta: 60, phi: 70, gamma: 0, ease: 'linear' },
  ];
}));
await setTime(1.5);
st = await waitFrame((s) => s.meta.camera.theta !== undefined);
check(near(st.meta.camera.theta, 0, 1e-3), `camera angles interpolate between keys (θ ${st.meta.camera.theta})`);
const code = await S(async () => (await fetch(`http://127.0.0.1:${window.__ms.store.getState().port}/code`, { method: 'POST', body: JSON.stringify({ project: window.__ms.store.getState().project }) })).json());
check(code.code.includes('theta=-60') && code.code.includes('phi=70'), 'generated script carries the camera orientation');
await win.keyboard.press('Escape');

// ---------------------------------------------------------------- 9. pinned title
console.log('9. pin a title to the screen');
b = await stageBox();
await win.dragAndDrop('.lib-card[data-item="text"]', '.stage', { targetPosition: { x: b.width / 2, y: b.height * 0.15 } });
st = await waitFrame((s) => s.project.clips.length === 2);
const title = st.project.clips.find((c) => c.item === 'text');
check(await win.locator('[data-testid="sel-poly"]').count() === 1, 'unpinned text in a 3D view gets a projected outline');
if (!(await win.locator('[data-testid="pin-toggle"]').count())) await win.locator('.inspector .ins-section h5', { hasText: 'Transform' }).first().click();
await win.click('[data-testid="pin-toggle"]');
st = await waitFrame((s) => s.project.clips.find((c) => c.id === title.id)?.fixed);
await S((id) => window.__ms.store.getState().commit((p) => { const c = p.clips.find((c) => c.id === id); c.transform = { ...c.transform, x: 0, y: 3.2, z: 0 }; }), title.id);
st = await waitFrame();
check(st.project.clips.find((c) => c.id === title.id).fixed === true, 'pin toggle sets fixed');
await win.waitForTimeout(100);
check(await win.locator('[data-testid="sel-poly"]').count() === 0 && await win.locator('.sel-box').count() >= 1, 'pinned text is edited as a flat screen rectangle');
const t1 = await win.locator('.sel-box').first().boundingBox();
await setTime(2.5);
st = await waitFrame();
const t2 = await win.locator('.sel-box').first().boundingBox();
check(t1 && t2 && near(t1.x, t2.x, 1) && near(t1.y, t2.y, 1), 'pinned text stays put while the camera orbits');
await shot('pinned-title');

// ---------------------------------------------------------------- 10. 3D items all render
console.log('10. every 3D item renders in a tilted view');
const ids3d = await S(() => window.__ms.store.getState().library.items.filter((i) => i.category === '3D').map((i) => i.id));
check(ids3d.length >= 12, `${ids3d.length} 3D items`);
for (const id of ids3d) {
  await S((id) => {
    const s = window.__ms.store.getState();
    const item = s.library.items.find((i) => i.id === id);
    s.commit((p) => {
      const c = p.clips.find((c) => c.item !== 'text') || p.clips[0];
      c.item = id; c.code = null;
      c.params = Object.fromEntries(item.params.map((pp) => [pp.id, pp.default]));
      c.transform = { x: 0, y: 0, z: 0, scale: 1, rotation: 0, opacity: 1 };
      c.enter = { type: 'none', duration: 1 };
    });
  }, id);
  st = await waitFrame();
  const errs = Object.values(st.meta.errors || {});
  check(!errs.length, `${id} renders without errors ${errs.join(' ')}`);
}
await shot('items');

await win.waitForTimeout(300);
check(errors.length === 0, `no console errors (${errors.slice(0, 3).join(' | ')})`);

function cameraTheta(st) {
  return yp(st.meta.camera).yaw;
}

console.log();
console.log(`${fails.length} failure(s)`);
for (const f of fails) console.log(' -', f);
await app.close();
process.exit(fails.length ? 1 : 0);
