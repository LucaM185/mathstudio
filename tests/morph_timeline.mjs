// Timeline shows how a clip's shape changes: filmstrips for dynamic clips, morph frames in a
// Transform exit, and morph chains fused onto one track.
//   npm run build && node tests/morph_timeline.mjs
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out', 'morph');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-morph-'));
const fails = [];
const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };

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
const waitFor = (pred, arg, ms = 30000) => win.waitForFunction(pred, arg, { timeout: ms }).then(() => true, () => false);
const shot = async (name) => {
  const el = await win.$('.timeline');
  await (el || win).screenshot({ path: path.join(OUT, name) });
};

const clip = (id, track, start, duration, extra) => ({
  id, name: id, item: 'custom', track, start, duration, params: {}, code: 'return Square()',
  transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0, opacity: 1 }, keys: [],
  enter: { type: 'none', duration: 1, rate: 'smooth' }, exit: { type: 'none', duration: 1, rate: 'smooth', target: null }, effects: [], ...extra,
});

// ------------------------------------------------------------------ dynamic clip filmstrip
console.log('\n▶ Dynamic clip: filmstrip of its shape over time');
await S(() => {
  const st = window.__ms.store.getState();
  st.commit((p) => {
    p.settings.duration = 8;
    const code = `p = min(max((t - 2.0) / 1.6, 0), 1)
p = p * p * (3 - 2 * p)
g = VGroup()
for i in range(25):
    r, c = divmod(i, 5)
    gx, gy = (c - 2) * 0.8, (2 - r) * 0.8
    sq = Square(side_length=0.8 * (1 - p) + 0.25 * p)
    sq.move_to(np.array([gx * (1 - p), gy * (1 - p) + (12 - i) * 0.27 * p, 0]))
    sq.set_fill(WHITE if (i % 3 == 0) else BLACK, opacity=1).set_stroke(GREY, 1)
    g.add(sq)
return g`;
    p.clips.push({ id: 'dyn', name: 'Flatten', item: 'custom_dynamic', track: p.tracks[0].id, start: 0, duration: 6, params: {}, code, dynamic: true,
      transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0, opacity: 1 }, keys: [],
      enter: { type: 'none', duration: 1, rate: 'smooth' }, exit: { type: 'none', duration: 1, rate: 'smooth', target: null }, effects: [] });
  });
});
let ok = await waitFor(() => !!document.querySelector('.clip[data-clip="dyn"] .clip-strip:not(.stale)'));
check(ok, 'dynamic clip gets a filmstrip');
const dyn = await S(() => {
  const s = document.querySelector('.clip[data-clip="dyn"] .clip-strip');
  const all = [...s.querySelectorAll('.strip-tile')];
  const tiles = all.filter((t) => !t.classList.contains('hold'));
  const shown = all.map((t) => !t.classList.contains('hold'));
  return { frames: +s.dataset.frames, tiles: tiles.length, all: all.length, pos: [...new Set(tiles.map((t) => t.style.backgroundPosition))].length,
    firstHeld: shown.slice(1, 4).every((v) => !v), lastHeld: shown.slice(-4).every((v) => !v),
    w: s.getBoundingClientRect().width, clipW: document.querySelector('.clip[data-clip="dyn"]').getBoundingClientRect().width,
    img: !!document.querySelector('.clip[data-clip="dyn"] .clip-img') };
});
check(dyn.frames >= 12, `samples the whole clip (${dyn.frames} frames)`);
check(dyn.tiles > 3 && dyn.pos > 3, `tiles show different moments (${dyn.tiles} tiles, ${dyn.pos} distinct)`);
check(dyn.all > dyn.tiles, `unchanging frames are not repeated (${dyn.tiles} of ${dyn.all} tiles drawn)`);
check(dyn.firstHeld && dyn.lastHeld, 'the still start (0–2s) and end (after 3.6s) are drawn once, then a hold line');
check(Math.abs(dyn.w - dyn.clipW) < 4, `strip spans the clip (${dyn.w.toFixed(0)} / ${dyn.clipW.toFixed(0)}px)`);
check(!dyn.img, 'single frozen thumbnail is replaced by the strip');
const z0 = await S(() => window.__ms.store.getState().zoom);
await S(() => window.__ms.store.setState({ zoom: window.__ms.store.getState().zoom * 2.5 }));
await win.waitForTimeout(150);
const tiles2 = await S(() => document.querySelectorAll('.clip[data-clip="dyn"] .strip-tile:not(.hold)').length);
check(tiles2 > dyn.tiles, `zooming in reveals more frames (${dyn.tiles} → ${tiles2})`);
await shot('1-dynamic-zoomed.png');
await S((z) => window.__ms.store.setState({ zoom: z }), z0);

// ------------------------------------------------------------------ morph via the inspector
console.log('\n▶ Transform into: target joins the same track, morph frames in the exit');
await S(() => {
  const st = window.__ms.store.getState();
  st.commit((p) => {
    p.clips = p.clips.filter((c) => c.id !== 'dyn');
    while (p.tracks.length < 3) p.tracks.push({ id: 'tk' + p.tracks.length, name: 'Track ' + (p.tracks.length + 1) });
  });
});
const tracks = await S(() => window.__ms.store.getState().project.tracks.map((t) => t.id));
await S(([t0, t1, mk]) => {
  const mkc = new Function('return ' + mk)();
  window.__ms.store.getState().commit((p) => {
    p.clips.push(mkc('circ', t0, 0, 3, { code: 'return Circle(radius=1.2).set_fill(BLUE, 0.6)', exit: { type: 'TransformInto', duration: 1.5, rate: 'smooth', target: null } }));
    p.clips.push(mkc('sq', t1, 4, 3, { code: 'return Square(side_length=2).set_fill(GREEN, 0.6)', enter: { type: 'FadeIn', duration: 1, rate: 'smooth' } }));
  });
  window.__ms.store.setState({ selection: ['circ'] });
}, [tracks[0], tracks[1], clip.toString()]);
await S(() => window.__ms.revealInspector?.('circ', 'exit'));
await win.click('.clip[data-clip="circ"]', { position: { x: 20, y: 10 } });
// open the Animate tab's exit section
const tab = await win.$('text=/^Animat/i');
if (tab) await tab.click();
const h5 = await win.$('h5:has-text("Exit animation")');
if (h5 && !(await win.$('.field.select:has(label:text-is("Into"))'))) await h5.click();
await win.waitForSelector('.field.select:has(label:text-is("Into")) select', { timeout: 10000 });
await win.selectOption('.field.select:has(label:text-is("Into")) select', 'sq');
let p = await S(() => window.__ms.store.getState().project);
const sq = p.clips.find((c) => c.id === 'sq');
check(sq.track === tracks[0], `target moved onto the morphing clip's track (${sq.track})`);
check(Math.abs(sq.start - 3) < 1e-6 && sq.enter.type === 'none', `target starts when the morph ends (${sq.start}s, enter ${sq.enter.type})`);
// the transform is its own clip in the middle: circle (hold) | transform | square
ok = await waitFor(() => !!document.querySelector('.tclip[data-morph="circ"]'), null, 5000);
check(ok, 'the transform shows as its own clip between the two states');
const geo = () => S(() => {
  const z = window.__ms.store.getState().zoom;
  const lanes = document.querySelector('.tl-lanes').getBoundingClientRect();
  const r = (sel) => { const b = document.querySelector(sel)?.getBoundingClientRect(); return b && { l: (b.left - lanes.left) / z, r: (b.right - lanes.left) / z, top: b.top, x: b.left, y: b.top + b.height / 2, w: b.width }; };
  return { a: r('.clip[data-clip="circ"]'), t: r('.tclip[data-morph="circ"]'), b: r('.clip[data-clip="sq"]'), z, exitZone: !!document.querySelector('.clip[data-clip="circ"] .clip-exit'), joint: !!document.querySelector('[data-testid=morph-joint]') };
});
let g = await geo();
check(Math.abs(g.a.r - 1.5) < 0.03 && Math.abs(g.t.l - 1.5) < 0.03 && Math.abs(g.t.r - 3) < 0.03 && Math.abs(g.b.l - 3) < 0.03, `hold 0→1.5s, transform 1.5→3s, next state from 3s (${g.a.r.toFixed(2)} | ${g.t.l.toFixed(2)}–${g.t.r.toFixed(2)} | ${g.b.l.toFixed(2)})`);
check(g.a.top === g.t.top && g.t.top === g.b.top, 'all three sit on the same track');
check(!g.exitZone && !g.joint, 'no exit zone or joint marker on the first clip');
ok = await waitFor(() => !!document.querySelector('.tclip[data-morph="circ"] .clip-strip:not(.stale)'));
check(ok, 'morph frames render inside the transform clip');
const ms = await S(() => {
  const t = document.querySelector('.tclip[data-morph="circ"]').getBoundingClientRect();
  const s = document.querySelector('.tclip[data-morph="circ"] .clip-strip').getBoundingClientRect();
  return { sL: s.left - t.left, sW: s.width, tW: t.width, thumb: !!document.querySelector('.clip[data-clip="circ"] .clip-img'), holdStrip: !!document.querySelector('.clip[data-clip="circ"] .clip-strip') };
});
check(Math.abs(ms.sL) < 3 && Math.abs(ms.sW - ms.tW) < 4, `strip fills the transform clip (${JSON.stringify(ms)})`);
check(ms.thumb && !ms.holdStrip, 'the steady part keeps its normal thumbnail');
// undo is one step
await S(() => window.__ms.store.getState().undo());
p = await S(() => window.__ms.store.getState().project);
check(p.clips.find((c) => c.id === 'sq').track === tracks[1] && !p.clips.find((c) => c.id === 'circ').exit.target, 'undo restores the target track and link');
await S(() => window.__ms.store.getState().redo());
await win.waitForTimeout(300);
await shot('2-morph-joined.png');

console.log('\n▶ The transform clip: select, edit, drag its edges, move, remove');
g = await geo();
await win.mouse.click(g.t.x + g.t.w / 2, g.t.y);
let sel = await S(() => window.__ms.store.getState().selection);
check(sel.length === 1 && sel[0] === '__morph__:circ', `click selects the transform (${sel})`);
check(await win.locator('[data-testid=transform-inspector]').isVisible(), 'inspector shows the transform');
check((await win.locator('.tclip[data-morph="circ"]').getAttribute('class')).includes('selected'), 'the transform clip is highlighted');
check(!(await win.locator('.clip[data-clip="circ"]').getAttribute('class')).includes('selected'), 'its neighbours are not');
// length field
await win.fill('input[data-testid=morph-length]', '1');
await win.keyboard.press('Enter');
await win.waitForTimeout(100);
p = await S(() => window.__ms.store.getState().project);
check(Math.abs(p.clips.find((c) => c.id === 'circ').exit.duration - 1) < 1e-6, `Length field sets the morph length (${p.clips.find((c) => c.id === 'circ').exit.duration})`);
g = await geo();
check(Math.abs(g.t.l - 2) < 0.03 && Math.abs(g.a.r - 2) < 0.03, `the transform now starts at 2s (${g.t.l.toFixed(2)})`);
// left edge: earlier start
await win.mouse.move(g.t.x + 2, g.t.y);
await win.mouse.down();
await win.mouse.move(g.t.x + 2 - 0.5 * g.z, g.t.y, { steps: 6 });
await win.mouse.up();
p = await S(() => window.__ms.store.getState().project);
let a = p.clips.find((c) => c.id === 'circ'), b = p.clips.find((c) => c.id === 'sq');
check(Math.abs(a.exit.duration - 1.5) < 0.06 && Math.abs(a.duration - 3) < 1e-6, `dragging its left edge makes it start earlier (morph ${a.exit.duration}s, clip still ends at ${a.duration})`);
// right edge: rolls the cut (transform ends later, next state starts later)
g = await geo();
await win.mouse.move(g.t.x + g.t.w - 2, g.t.y);
await win.mouse.down();
await win.mouse.move(g.t.x + g.t.w - 2 + 0.5 * g.z, g.t.y, { steps: 6 });
await win.mouse.up();
p = await S(() => window.__ms.store.getState().project);
a = p.clips.find((c) => c.id === 'circ'); b = p.clips.find((c) => c.id === 'sq');
check(Math.abs(a.start + a.duration - 3.5) < 0.06 && Math.abs(b.start - (a.start + a.duration)) < 1e-6 && Math.abs(b.start + b.duration - 6) < 1e-6, `dragging its right edge ends it later; the next state starts then and keeps its end (${(a.start + a.duration).toFixed(2)}, ${b.start}–${(b.start + b.duration).toFixed(2)})`);
check(Math.abs(a.exit.duration - 2) < 0.08, `…and the morph got longer (${a.exit.duration}s)`);
// body drag moves the whole changing object
g = await geo();
await win.mouse.move(g.t.x + g.t.w / 2, g.t.y);
await win.mouse.down();
await win.mouse.move(g.t.x + g.t.w / 2 + 1 * g.z, g.t.y, { steps: 8 });
await win.mouse.up();
p = await S(() => window.__ms.store.getState().project);
const a2 = p.clips.find((c) => c.id === 'circ'), b2 = p.clips.find((c) => c.id === 'sq');
check(Math.abs(a2.start - (a.start + 1)) < 0.06 && Math.abs(b2.start - (a2.start + a2.duration)) < 1e-6, `dragging the transform moves both states together (${a2.start}, ${b2.start})`);
await S(() => window.__ms.store.getState().undo());
// right-click menu
g = await geo();
await win.mouse.click(g.t.x + g.t.w / 2, g.t.y, { button: 'right' });
check(await win.locator('.ctx-menu .ctx-item:has-text("Remove transform")').count() === 1, 'right-click offers Remove transform');
await win.keyboard.press('Escape');
// delete key removes the transform, keeps both clips
await win.mouse.click(g.t.x + g.t.w / 2, g.t.y);
await win.keyboard.press('Backspace');
p = await S(() => window.__ms.store.getState().project);
a = p.clips.find((c) => c.id === 'circ');
check(p.clips.some((c) => c.id === 'sq') && a.exit.type === 'none' && !a.exit.target, 'Delete removes the transform and keeps both states');
check(await win.locator('.tclip[data-morph="circ"]').count() === 0, 'the transform clip is gone');
await S(() => window.__ms.store.getState().undo());
check(await S(() => window.__ms.store.getState().project.clips.find((c) => c.id === 'circ').exit.target) === 'sq', 'undo brings it back');
await win.waitForTimeout(300);
await shot('2b-transform-clip.png');

// ------------------------------------------------------------------ morph across tracks
console.log('\n▶ Morph whose target cannot share the track: connector');
await S(([t0, t2, mk]) => {
  const mkc = new Function('return ' + mk)();
  window.__ms.store.getState().commit((p) => {
    p.clips.push(mkc('tri', t0, 6.5, 2, { code: 'return Triangle().scale(1.3).set_fill(RED, 0.6)', exit: { type: 'TransformInto', duration: 1, rate: 'smooth', target: 'hex' } }));
    p.clips.push(mkc('hex', t2, 8.5, 2, { code: 'return RegularPolygon(6).scale(1.3).set_fill(YELLOW, 0.6)' }));
    p.clips.push(mkc('blocker', t0, 8.5, 2, {}));
    p.settings.duration = 11;
  });
}, [tracks[0], tracks[2], clip.toString()]);
ok = await waitFor(() => !!document.querySelector('[data-testid=morph-link]'), null, 5000);
check(ok, 'cross-track morph draws a connector');
ok = await waitFor(() => !!document.querySelector('.tclip[data-morph="tri"] .clip-strip:not(.stale)'));
check(ok, 'cross-track morph also gets its frames');
await win.waitForTimeout(300);
await shot('3-morph-link.png');

// ------------------------------------------------------------------ engine endpoint directly
console.log('\n▶ /clip-strip');
const r = await S(async () => {
  const port = await window.studio.enginePort();
  const res = await fetch(`http://127.0.0.1:${port}/clip-strip`, { method: 'POST', body: JSON.stringify({ clip: { item: 'custom', params: {}, code: 'return Circle()', duration: 2, exit: { type: 'TransformInto', duration: 1, target: 'x' } }, target: { item: 'custom', params: {}, code: 'return Square()' }, times: [1.1, 1.5, 1.9] }) });
  const bad = await fetch(`http://127.0.0.1:${port}/clip-strip`, { method: 'POST', body: JSON.stringify({ clip: { item: 'custom', params: {}, code: 'return 1/0', dynamic: true, duration: 2 }, times: [0.5] }) });
  const b = await createImageBitmap(await res.blob());
  return { ok: res.ok, w: b.width, h: b.height, bad: bad.status };
});
check(r.ok && r.h === 72 && r.w % 3 === 0, `returns a 3-frame sprite (${r.w}×${r.h})`);
check(r.bad === 422, `broken code reports an error (${r.bad})`);

check(!errors.length, `no page errors ${errors.slice(0, 3).join(' | ')}`);
await app.close();
console.log(fails.length ? `\n✗ ${fails.length} failed` : '\n✓ all passed');
process.exit(fails.length ? 1 : 0);
