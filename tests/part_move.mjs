// Moving the parts of a group clip on their own: double-click into a group in the viewer to pick a
// part, drag it (snaps back / onto siblings), click siblings, Escape goes up, inspector fields,
// rotated + scaled clips, undo, timeline marker, hit box follows, agent keeps positions.
//   npm run test:partmove
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out', 'part_move');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-partmove-'));
const fails = [];
const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_HIDDEN: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'), MATHSTUDIO_STARTUP_PROJECTS: '0' });
const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
win.on('console', (m) => m.type() === 'error' && !/status of 422/.test(m.text()) && errors.push(m.text()));
await win.setViewportSize({ width: 1600, height: 1000 });
await win.waitForSelector('.lib-card', { timeout: 90000 });
const S = (fn, arg) => win.evaluate(fn, arg);
const waitFor = (pred, arg, ms = 30000) => win.waitForFunction(pred, arg, { timeout: ms }).then(() => true, () => false);
const shot = (name) => win.screenshot({ path: path.join(OUT, name) });
const proj = () => S(() => window.__ms.store.getState().project);
const clipOf = async (id) => (await proj()).clips.find((c) => c.id === id);
const sel = () => S(() => { const s = window.__ms.store.getState(); return { selection: s.selection, part: s.selectedPart }; });
const near = (a, b, tol = 0.06) => Math.abs(a - b) <= tol;
const FW = 14.222222222222221, FH = 8;
const stageBox = () => win.locator('.stage-canvas').boundingBox();
const toScreen = (b, x, y) => ({ x: b.x + ((x + FW / 2) / FW) * b.width, y: b.y + ((FH / 2 - y) / FH) * b.height });
const settle = async () => {
  // wait for a frame rendered from the current project
  await waitFor(() => { const s = window.__ms.store.getState(); return s.meta && s.metaProject === s.project && Math.abs(s.meta.t - s.time) < 1e-6 && !s.interacting; }, null, 15000);
  await win.waitForTimeout(120);
};
const drag = async (from, to, steps = 10) => {
  await win.mouse.move(from.x, from.y);
  await win.mouse.down();
  await win.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps });
  await win.mouse.move(to.x, to.y, { steps });
  await win.mouse.up();
};

const mk = (id, track, code, extra = {}) => ({
  id, name: id, item: 'custom', track, start: 0, duration: 6, params: {}, code,
  transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0, opacity: 1 }, keys: [],
  enter: { type: 'none', duration: 0.5, rate: 'smooth' }, exit: { type: 'none', duration: 1, rate: 'smooth', target: null }, effects: [], ...extra,
});
const GROUP = `sq = Square(fill_opacity=0.8).set_fill(BLUE).shift(LEFT*3)
circ = Circle(fill_opacity=0.8).set_fill(GREEN)
tri = Triangle(fill_opacity=0.8).set_fill(RED).shift(RIGHT*3)
return VGroup(sq, circ, tri)`;
const NEST = `row1 = VGroup(Dot(LEFT*2, radius=0.3), Dot(radius=0.3), Dot(RIGHT*2, radius=0.3))
row2 = VGroup(Square(0.8).shift(LEFT), Square(0.8).shift(RIGHT))
return VGroup(row1, row2.shift(DOWN*1.5))`;
await S(([a]) => {
  const st = window.__ms.store.getState();
  st.commit((p) => {
    p.settings.duration = 6;
    a.track = p.tracks[0].id;
    p.clips.push(a);
  });
  window.__ms.store.setState({ time: 1 });
}, [mk('grp', 't', GROUP)]);
await settle();
let sb = await stageBox();

// ------------------------------------------------------------------ pick a part
console.log('\n▶ Double-click a group in the viewer picks the part under the pointer');
const triAt = toScreen(sb, 3, -0.1);
await win.mouse.click(triAt.x, triAt.y);
let s = await sel();
check(s.selection[0] === 'grp' && !s.part, 'first click selects the whole clip');
await win.waitForTimeout(500); // parts tree arrives
await win.mouse.dblclick(triAt.x, triAt.y);
await win.waitForTimeout(150);
s = await sel();
check(s.part?.clip === 'grp' && s.part.path === '2', `double-click picks the triangle (${JSON.stringify(s.part)})`);
let ok = await waitFor(() => document.querySelector('[data-testid=part-outline]')?.getAttribute('data-path') === '2', null, 3000);
check(ok, 'the viewer outlines the picked part');
ok = await waitFor(() => !!document.querySelector('.part-bar.selected[data-clip-part="grp"][data-part="2"]'), null, 3000);
check(ok, 'its row opens and is selected on the timeline');
const foc = await win.evaluate(() => { const s = window.__ms.store.getState(); return { tab: s.rightTab, section: s.inspectorFocus?.section }; });
check(foc.tab === 'inspector' && foc.section === 'params', `double-click opens the Parameters section (${JSON.stringify(foc)})`);
check(await waitFor(() => !!document.querySelector('[data-section=params] .ins-body'), null, 2000), 'Parameters is expanded');
if (!(await win.isVisible('[data-testid=part-dx]'))) await win.click('[data-section=parts] h5');
check(await win.isVisible('[data-testid=part-dx]'), 'the inspector shows Move X / Move Y for the part');

// ------------------------------------------------------------------ drag it
console.log('\n▶ Dragging the part moves only that part');
const unit = sb.width / FW;
await drag(triAt, { x: triAt.x + 2 * unit, y: triAt.y - 1 * unit });
let c = await clipOf('grp');
check(c.parts?.['2'] && near(c.parts['2'].dx, 2, 0.05) && near(c.parts['2'].dy, 1, 0.05), `triangle moved by (2, 1) (${JSON.stringify(c.parts)})`);
check(!c.parts?.['0'] && !c.parts?.['1'], 'square and circle untouched');
check(near(c.transform.x, 0, 1e-9) && near(c.transform.y, 0, 1e-9), 'the clip itself did not move');
check(c.parts?.['2'] && c.parts['2'].at === undefined && c.parts['2'].enter === undefined, 'no timing was added');
await settle();
let info = await S(() => window.__ms.store.getState().meta.clips.grp);
// unmoved: the group spans -3.93 … 3.93 (centred on its box); the triangle's right edge moves +2, its top to 1+0.5+… 
check(info.bbox && near(info.bbox[2], 5.93, 0.05) && near(info.bbox[3], 2, 0.05), `the engine draws it there (box ${info.bbox?.map((v) => v.toFixed(2))})`);
check(near(info.bbox[0], -3.93, 0.05), 'the square stays put');
ok = await waitFor(() => !!document.querySelector('.part-bar[data-part="2"] [data-testid=part-moved]'), null, 3000);
check(ok, 'the timeline row marks the part as moved');
const dxVal = await win.inputValue('[data-testid=part-dx]').catch(() => null);
check(dxVal !== null && near(parseFloat(dxVal), 2, 0.05), `inspector Move X shows ${dxVal}`);
await shot('1-moved.png');

// the clip's hit box follows the moved part: clicking it there still hits the clip
await win.mouse.click(sb.x + 5, sb.y + 5); // deselect
s = await sel();
check(!s.selection.length, 'clicking empty space deselects');
const movedTri = toScreen(sb, 5, 0.9);
await win.mouse.click(movedTri.x, movedTri.y);
s = await sel();
check(s.selection[0] === 'grp', 'the moved part is inside the clip\'s hit box');

// ------------------------------------------------------------------ siblings, snapping back
console.log('\n▶ With a part picked, clicking a sibling picks and drags it');
await win.mouse.dblclick(movedTri.x, movedTri.y);
await win.waitForTimeout(100);
s = await sel();
check(s.part?.path === '2', 'double-click on the moved triangle picks it again');
const sqAt = toScreen(sb, -3, 0);
await drag(sqAt, { x: sqAt.x, y: sqAt.y + 1.5 * unit });
c = await clipOf('grp');
s = await sel();
check(s.part?.path === '0', `pressing on the square picks it (${JSON.stringify(s.part)})`);
check(c.parts?.['0'] && near(c.parts['0'].dy, -1.5, 0.05) && !c.parts['0'].dx, `and drags it down (${JSON.stringify(c.parts?.['0'])})`);
// drag it almost back: snaps onto where its code put it
const sqNow = toScreen(sb, -3, -1.5);
await drag(sqNow, { x: sqNow.x + 3, y: sqNow.y - 1.5 * unit + 4 });
c = await clipOf('grp');
check(!c.parts?.['0'], `dropping it near its original spot snaps it back (${JSON.stringify(c.parts?.['0'])})`);
// shift constrains to one axis
await drag(sqAt, { x: sqAt.x + 1 * unit, y: sqAt.y });
c = await clipOf('grp');
check(c.parts?.['0'] && near(c.parts['0'].dx, 1, 0.08), `square moved right (${JSON.stringify(c.parts?.['0'])})`);
const sq2 = toScreen(sb, -2, 0);
await win.mouse.move(sq2.x, sq2.y);
await win.mouse.down();
await win.keyboard.down('Shift');
await win.mouse.move(sq2.x + 0.5 * unit, sq2.y + 0.2 * unit, { steps: 4 });
await win.mouse.move(sq2.x + 1 * unit, sq2.y + 0.4 * unit, { steps: 4 });
await win.mouse.up();
await win.keyboard.up('Shift');
const c2 = await clipOf('grp');
check(near((c2.parts['0'].dx || 0) - (c.parts['0'].dx || 0), 1, 0.08) && !c2.parts['0'].dy, `shift-drag stays horizontal (${JSON.stringify(c2.parts?.['0'])})`);

// ------------------------------------------------------------------ inspector + undo
console.log('\n▶ Inspector fields, Put back, undo');
await S(() => window.__ms.store.setState({ selectedPart: { clip: 'grp', path: '1' }, selection: ['grp'] }));
await win.waitForSelector('[data-testid=part-dy]');
await win.fill('[data-testid=part-dy]', '1.25');
await win.press('[data-testid=part-dy]', 'Enter');
c = await clipOf('grp');
check(near(c.parts?.['1']?.dy ?? 0, 1.25, 1e-6) && !c.parts['1'].dx, `typing Move Y moves the circle (${JSON.stringify(c.parts?.['1'])})`);
await win.click('[data-testid=part-put-back]');
c = await clipOf('grp');
check(!c.parts?.['1'], 'Put back removes its offset');
await S(() => window.__ms.store.getState().undo());
c = await clipOf('grp');
check(near(c.parts?.['1']?.dy ?? 0, 1.25, 1e-6), 'undo brings the offset back');
// timing still works on a moved part
await S(() => window.__ms.store.getState().commit((p) => { const g = p.clips.find((x) => x.id === 'grp'); g.parts['2'] = { ...g.parts['2'], at: 2 }; }));
await settle();
info = await S(() => window.__ms.store.getState().meta.clips.grp);
check(info.bbox && info.bbox[2] < 2, `moved part with its own timing is hidden before it appears (right edge ${info.bbox?.[2]?.toFixed(2)})`);
await S(() => window.__ms.store.getState().setTime(3));
await settle();
info = await S(() => window.__ms.store.getState().meta.clips.grp);
check(info.bbox && near(info.bbox[2], 5.93, 0.05), `…and appears where it was moved (right edge ${info.bbox?.[2]?.toFixed(2)})`);
// "Follow the clip" resets timing but keeps the position
await S(() => window.__ms.store.setState({ selectedPart: { clip: 'grp', path: '2' } }));
await win.click('button:has-text("Follow the clip")');
c = await clipOf('grp');
check(c.parts?.['2'] && c.parts['2'].at === undefined && near(c.parts['2'].dx, 2, 0.05), `Follow the clip keeps the position (${JSON.stringify(c.parts?.['2'])})`);

// ------------------------------------------------------------------ nested groups + Escape
console.log('\n▶ Nested groups: double-click goes deeper, Escape goes up');
await S(([n]) => window.__ms.store.getState().commit((p) => {
  p.clips = p.clips.filter((c) => c.id !== 'grp');
  n.track = p.tracks[0].id;
  p.clips.push(n);
}), [mk('nest', 't', NEST)]);
await S(() => window.__ms.store.setState({ selection: [], selectedPart: null, time: 1 }));
await settle();
// nest box: row1 at y=0.75 (centred: whole is from 1.05 to -1.95... use the tree)
const nestInfo = await S(() => window.__ms.store.getState().meta.clips.nest);
// row1 dots are at the top of the box; rightmost dot centre = (2, top - 0.3)
const dotY = nestInfo.bbox[3] - 0.3;
const dotAt = toScreen(sb, 2, dotY);
await win.mouse.click(dotAt.x, dotAt.y);
await win.waitForTimeout(500);
await win.mouse.dblclick(dotAt.x, dotAt.y);
await win.waitForTimeout(100);
s = await sel();
check(s.part?.path === '0', `first double-click picks the row (${JSON.stringify(s.part)})`);
await win.mouse.dblclick(dotAt.x, dotAt.y);
await win.waitForTimeout(100);
s = await sel();
check(s.part?.path === '0.2', `second double-click picks the dot inside it (${JSON.stringify(s.part)})`);
await drag(dotAt, { x: dotAt.x + 1 * unit, y: dotAt.y });
c = await clipOf('nest');
check(c.parts?.['0.2'] && near(c.parts['0.2'].dx, 1, 0.05) && !c.parts['0'], `only the dot moved (${JSON.stringify(c.parts)})`);
await win.keyboard.press('Escape');
s = await sel();
check(s.part?.path === '0' && s.selection[0] === 'nest', `Escape: back to the row (${JSON.stringify(s)})`);
// moving the row carries the moved dot along
const rowAt = toScreen(sb, -2, dotY);
await drag(rowAt, { x: rowAt.x, y: rowAt.y - 0.5 * unit });
c = await clipOf('nest');
check(c.parts?.['0'] && near(c.parts['0'].dy, 0.5, 0.05) && near(c.parts['0.2'].dx, 1, 0.05), `row moved up, dot keeps its own offset (${JSON.stringify(c.parts)})`);
await settle();
const ni = await S(() => window.__ms.store.getState().meta.clips.nest);
check(near(ni.bbox[2], 3.3, 0.1) && near(ni.bbox[3], nestInfo.bbox[3] + 0.5, 0.1), `engine: dot at x≈3, row 0.5 higher (box ${ni.bbox.map((v) => v.toFixed(2))})`);
await win.keyboard.press('Escape');
s = await sel();
check(!s.part && s.selection[0] === 'nest', 'Escape again: the whole clip');
await win.keyboard.press('Escape');
s = await sel();
check(!s.selection.length, 'Escape again: nothing');
await shot('2-nested.png');

// ------------------------------------------------------------------ rotated + scaled clip
console.log('\n▶ A rotated, scaled clip: the part follows the pointer');
await S(() => window.__ms.store.getState().commit((p) => {
  const c = p.clips.find((x) => x.id === 'nest');
  c.parts = undefined; delete c.parts;
  c.transform = { ...c.transform, x: 1, y: 0.5, rotation: 90, scale: 1.5 };
}));
await settle();
// local (2, top-0.3) → rotate 90°: (-ly, lx) * 1.5 + (1, 0.5)
const ly = nestInfo.bbox[3] - 0.3 - (nestInfo.bbox[1] + nestInfo.bbox[3]) / 2; // relative to the box centre (= pivot)
const lx = 2;
const rotAt = toScreen(sb, 1 + -ly * 1.5, 0.5 + lx * 1.5);
await win.mouse.click(rotAt.x, rotAt.y);
await win.waitForTimeout(500);
await win.mouse.dblclick(rotAt.x, rotAt.y);
await win.mouse.dblclick(rotAt.x, rotAt.y);
await win.waitForTimeout(100);
s = await sel();
check(s.part?.path === '0.2', `double-clicks reach the dot through the rotation (${JSON.stringify(s.part)})`);
await drag(rotAt, { x: rotAt.x + 1.5 * unit, y: rotAt.y });
c = await clipOf('nest');
// screen right (+x world) in the clip's frame rotated 90° = local -y; ÷ scale 1.5
check(c.parts?.['0.2'] && near(c.parts['0.2'].dy, -1, 0.06) && near(c.parts['0.2'].dx || 0, 0, 0.06), `offset is in the clip's own units (${JSON.stringify(c.parts?.['0.2'])})`);
await settle();
// read the rendered frame: the dot is now 1.5 units to the right of where it was
const inkAt = (pt) => S(([x, y]) => {
  const cv = document.querySelector('.stage-canvas');
  const r = cv.getBoundingClientRect();
  const px = Math.round(((x - r.left) / r.width) * cv.width), py = Math.round(((y - r.top) / r.height) * cv.height);
  const d = cv.getContext('2d').getImageData(px - 2, py - 2, 5, 5).data;
  let m = 0;
  for (let i = 0; i < d.length; i += 4) m = Math.max(m, d[i] + d[i + 1] + d[i + 2]);
  return m;
}, [pt.x, pt.y]);
const atNew = await inkAt({ x: rotAt.x + 1.5 * unit, y: rotAt.y }), atOld = await inkAt(rotAt);
check(atNew > 600 && atOld < 200, `engine draws the dot where it was dropped (new ${atNew}, old ${atOld})`);
await shot('3-rotated.png');

// ------------------------------------------------------------------ code + agent
console.log('\n▶ Code and agent');
const code = await S(async () => {
  const st = window.__ms.store.getState();
  const r = await fetch(`http://127.0.0.1:${st.port}/code`, { method: 'POST', body: JSON.stringify({ project: st.project }) });
  return (await r.json()).code;
});
check(/'0\.2': dict\(dy=-1(\.0)?\)/.test(code || ''), 'exported scene.py carries the offset');
const res = await S(async () => {
  const tools = window.__ms.agentTools;
  const handle = window.__ms.sessions.docHandle(window.__ms.store.getState().sessionId);
  if (!tools?.runTool || !handle) return { skipped: true };
  const r = await tools.runTool(handle, 'update_clips', JSON.stringify({ updates: [{ id: 'nest', parts: { '1': { at: 1 } } }] }));
  return { r: r.text };
});
if (res.skipped) console.log('   (agent handle not exposed)');
else {
  c = await clipOf('nest');
  check(c.parts?.['1']?.at === 1 && near(c.parts?.['0.2']?.dy ?? 0, -1, 0.06), `agent rewriting part timing keeps moved parts (${JSON.stringify(c.parts)})`);
}

check(!errors.length, `no page errors ${errors.slice(0, 3).join(' | ')}`);
await app.close();
console.log(fails.length ? `\n✗ ${fails.length} failed` : '\n✓ all passed');
process.exit(fails.length ? 1 : 0);
