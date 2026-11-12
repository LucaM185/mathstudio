// Group clips on the timeline: expand a VGroup / Tex / nested group into part rows, retime parts by
// dragging, pick part animations, stagger, blade, hide, inspector + preview outline, agent tool.
//   npm run test:parts
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out', 'parts');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-parts-'));
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
const shot = async (name, sel = '.timeline') => {
  const el = await win.$(sel);
  await (el || win).screenshot({ path: path.join(OUT, name) });
};
const proj = () => S(() => window.__ms.store.getState().project);
const clipOf = async (id) => (await proj()).clips.find((c) => c.id === id);
const box = (sel) => S((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; }, sel);
const near = (a, b, tol = 0.06) => Math.abs(a - b) <= tol;

const mk = (id, track, start, duration, code, extra = {}) => ({
  id, name: id, item: 'custom', track, start, duration, params: {}, code,
  transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0, opacity: 1 }, keys: [],
  enter: { type: 'FadeIn', duration: 0.5, rate: 'smooth' }, exit: { type: 'none', duration: 1, rate: 'smooth', target: null }, effects: [], ...extra,
});
const GROUP = `sq = Square(fill_opacity=0.8).set_fill(BLUE).shift(LEFT*3)
circ = Circle(fill_opacity=0.8).set_fill(GREEN)
tri = Triangle(fill_opacity=0.8).set_fill(RED).shift(RIGHT*3)
return VGroup(sq, circ, tri)`;
await S(([a, b, c]) => {
  const st = window.__ms.store.getState();
  st.commit((p) => {
    p.settings.duration = 10;
    while (p.tracks.length < 3) p.tracks.push({ id: 'tk' + p.tracks.length, name: 'Track ' + (p.tracks.length + 1) });
    p.clips.push(a, { ...b, track: p.tracks[1].id }, { ...c, track: p.tracks[2].id });
    a.track = p.tracks[0].id;
  });
  window.__ms.store.setState({ zoom: 100 });
}, [
  mk('grp', 't', 0, 6, GROUP),
  mk('eq', 't', 0, 6, 'return Tex(r"x^2 + y^2 = r^2", font_size=72).shift(DOWN*2.5)'),
  mk('nest', 't', 0, 6, 'row1 = VGroup(Dot(LEFT), Dot(), Dot(RIGHT)).shift(UP*2.5)\nrow2 = VGroup(Square(0.5).shift(LEFT), Square(0.5).shift(RIGHT)).shift(UP*1.5)\nreturn VGroup(row1, row2)'),
]);
// fix the track of the first clip (pushed before it was set)
await S(() => window.__ms.store.getState().commit((p) => { p.clips.find((c) => c.id === 'grp').track = p.tracks[0].id; }));

// ------------------------------------------------------------------ expand
console.log('\n▶ A VGroup clip shows its parts on rows under it');
let ok = await waitFor(() => !!document.querySelector('.clip[data-clip="grp"] [data-testid=parts-toggle]'));
check(ok, 'group clip gets a parts toggle');
ok = await waitFor(() => !!document.querySelector('.clip[data-clip="eq"] [data-testid=parts-toggle]'));
check(ok, 'Tex clip gets a parts toggle too (its glyphs are parts)');
const eqTop0 = (await box('.clip[data-clip="eq"]')).y;
await win.click('.clip[data-clip="grp"] [data-testid=parts-toggle]');
ok = await waitFor(() => document.querySelectorAll('.part-bar[data-clip-part="grp"]').length === 3, null, 5000);
check(ok, 'three part rows appear');
const labels = await S(() => [...document.querySelectorAll('.part-bar[data-clip-part="grp"] .nm')].map((e) => e.textContent));
check(JSON.stringify(labels) === '["sq","circ","tri"]', `rows are named after the code's variables (${labels})`);
const eqTop1 = (await box('.clip[data-clip="eq"]')).y;
check(near(eqTop1 - eqTop0, 3 * 22, 2), `the track grows and pushes the next one down (${(eqTop1 - eqTop0).toFixed(0)}px)`);
const headH = await S(() => document.querySelectorAll('.tl-headers .tl-head')[0].getBoundingClientRect().height);
check(near(headH, 64 + 66, 2), `track header matches the taller track (${headH}px)`);
await shot('1-expanded.png');

// ------------------------------------------------------------------ drag a part
console.log('\n▶ Dragging a part bar retimes that part only');
let b = await box('.part-bar[data-clip-part="grp"][data-part="2"]');
await win.mouse.move(b.x + 60, b.y + b.h / 2);
await win.mouse.down();
await win.mouse.move(b.x + 160, b.y + b.h / 2, { steps: 6 });
await win.mouse.move(b.x + 260, b.y + b.h / 2, { steps: 6 });
await win.mouse.up();
let c = await clipOf('grp');
check(c.parts?.['2'] && near(c.parts['2'].at, 2, 0.08), `part 2 now appears at ~2s (${JSON.stringify(c.parts)})`);
check(c.parts?.['2']?.until === undefined, 'it still lasts to the end of the clip');
check(Object.keys(c.parts || {}).length === 1, 'other parts untouched');
b = await box('.part-bar[data-clip-part="grp"][data-part="2"]');
const cb = await box('.clip[data-clip="grp"]');
check(near(b.x - cb.x, c.parts['2'].at * 100, 3), 'bar is drawn where the part appears');
// the engine hides it before then
await S(() => window.__ms.store.getState().setTime(1.0));
await waitFor(() => window.__ms.store.getState().meta?.t === 1.0, null, 8000);
await win.waitForTimeout(300);
const w1 = await S(() => window.__ms.store.getState().meta.clips.grp.bbox);
await S(() => window.__ms.store.getState().setTime(3.0));
await waitFor(() => window.__ms.store.getState().meta?.t === 3.0, null, 8000);
await win.waitForTimeout(300);
const w3 = await S(() => window.__ms.store.getState().meta.clips.grp.bbox);
check(w1 && w3 && w1[2] < 2 && w3[2] > 3.5, `preview: triangle hidden at 1s, shown at 3s (right edge ${w1?.[2]?.toFixed(2)} → ${w3?.[2]?.toFixed(2)})`);

// trim edges
console.log('\n▶ Part edges: when it appears / leaves');
b = await box('.part-bar[data-clip-part="grp"][data-part="0"]');
await win.mouse.move(b.x + b.w - 2, b.y + b.h / 2);
await win.mouse.down();
await win.mouse.move(b.x + b.w - 100, b.y + b.h / 2, { steps: 5 });
await win.mouse.move(b.x + b.w - 200, b.y + b.h / 2, { steps: 5 });
await win.mouse.up();
c = await clipOf('grp');
check(c.parts?.['0'] && near(c.parts['0'].until, 4, 0.08), `right edge: square leaves at ~4s (${c.parts?.['0']?.until})`);
b = await box('.part-bar[data-clip-part="grp"][data-part="1"]');
await win.mouse.move(b.x + 2, b.y + b.h / 2);
await win.mouse.down();
await win.mouse.move(b.x + 52, b.y + b.h / 2, { steps: 4 });
await win.mouse.move(b.x + 102, b.y + b.h / 2, { steps: 4 });
await win.mouse.up();
c = await clipOf('grp');
check(c.parts?.['1'] && near(c.parts['1'].at, 1, 0.08), `left edge: circle appears at ~1s (${c.parts?.['1']?.at})`);
await shot('2-retimed.png');

// ------------------------------------------------------------------ part animations
console.log('\n▶ Part enter animation from the context menu and the zone popover');
b = await box('.part-bar[data-clip-part="grp"][data-part="1"]');
await win.mouse.click(b.x + b.w / 2, b.y + b.h / 2, { button: 'right' });
await win.waitForSelector('.ctx-menu, .context-menu, [class*=menu]', { timeout: 3000 }).catch(() => {});
await win.hover('text=Enter animation');
await win.click('text=Grow From Center');
c = await clipOf('grp');
check(c.parts?.['1']?.enter?.type === 'GrowFromCenter', `part 1 enter = Grow From Center (${JSON.stringify(c.parts?.['1'])})`);
check(near(c.parts?.['1']?.at, 1, 0.08), 'its timing is kept');
// click its enter zone → popover with the part title; pick Spin In
await win.waitForTimeout(150);
b = await box('.part-bar[data-clip-part="grp"][data-part="1"] .part-enter');
check(!!b && b.w > 20, `part has an enter zone (${b?.w?.toFixed(0)}px)`);
await win.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
ok = await waitFor(() => /circ/.test(document.querySelector('[data-testid=tl-anim-pop] .anim-pop-title')?.textContent || ''), null, 3000);
check(ok, 'zone click opens the chooser titled with the part');
const ap = await S(() => window.__ms.store.getState().animPreview);
check(!!ap && ap.t0 >= 0.6 && ap.t0 <= 1.0, `live preview loops around the part's enter (${ap?.t0?.toFixed(2)}–${ap?.t1?.toFixed(2)}s)`);
await win.click('[data-testid=tl-anim-pop] .anim-tile[data-anim="SpinIn"]');
c = await clipOf('grp');
check(c.parts?.['1']?.enter?.type === 'SpinIn', 'chooser sets the part animation');
// enter duration handle
b = await box('.part-bar[data-clip-part="grp"][data-part="1"] [data-role=part-enter]');
const before = c.parts['1'].enter.duration;
await win.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
await win.mouse.down();
await win.mouse.move(b.x + b.w / 2 + 40, b.y + b.h / 2, { steps: 4 });
await win.mouse.move(b.x + b.w / 2 + 80, b.y + b.h / 2, { steps: 4 });
await win.mouse.up();
c = await clipOf('grp');
check(near(c.parts['1'].enter.duration, before + 0.8, 0.1), `dragging the handle lengthens the part's enter (${before} → ${c.parts['1'].enter.duration})`);

// ------------------------------------------------------------------ inspector + preview outline
console.log('\n▶ Selecting a part: inspector section and preview outline');
await S(() => window.__ms.store.getState().setTime(4.5));
b = await box('.part-bar[data-clip-part="grp"][data-part="2"]');
await win.mouse.click(b.x + b.w - 30, b.y + b.h / 2);
let sp = await S(() => window.__ms.store.getState().selectedPart);
check(sp?.clip === 'grp' && sp.path === '2', `part selected (${JSON.stringify(sp)})`);
ok = await waitFor(() => !!document.querySelector('[data-testid=part-edit]'), null, 4000);
check(ok, 'inspector opens the Parts section on that part');
ok = await waitFor(() => !!document.querySelector('[data-testid=part-outline]'), null, 4000);
check(ok, 'preview outlines the part');
const ol = await box('[data-testid=part-outline] rect');
const sel = await box('.sel-box');
check(ol && sel && ol.x > sel.x + sel.w * 0.55 && ol.w < sel.w * 0.45, `outline sits on the triangle (right third of the clip box)`);
// edit appear time from the inspector
await win.fill('[data-testid=part-at] input', '2.5').catch(async () => {
  const inp = await win.$('[data-testid=part-at]');
  if (inp) { await inp.fill('2.5'); }
});
await win.keyboard.press('Enter');
c = await clipOf('grp');
check(near(c.parts['2'].at, 2.5, 0.01), `inspector "Appears" sets the time (${c.parts['2'].at})`);
await shot('3-inspector.png', 'body');

// ------------------------------------------------------------------ hide with ⌫, undo
console.log('\n▶ ⌫ on a selected part hides it (the clip stays)');
await win.click('.part-bar[data-clip-part="grp"][data-part="2"]', { position: { x: 30, y: 8 } });
await win.keyboard.press('Backspace');
c = await clipOf('grp');
check(!!c && c.parts['2'].until === 0 && c.parts['2'].at === 0, `part hidden, clip kept (${JSON.stringify(c?.parts?.['2'])})`);
check(await S(() => !!document.querySelector('.part-bar.gone[data-part="2"]')), 'hidden part shows as a thin red marker');
await S(() => window.__ms.store.getState().undo());
c = await clipOf('grp');
check(near(c.parts['2'].at, 2.5, 0.01), 'undo brings it back');

// ------------------------------------------------------------------ stagger
console.log('\n▶ Stagger (LaggedStart) from the clip menu');
await win.click('.clip[data-clip="eq"]', { button: 'right', position: { x: 120, y: 12 } });
await win.hover('text=Stagger parts');
await win.click('text=0.25s apart');
c = await clipOf('eq');
const n = Object.keys(c.parts || {}).length;
check(n >= 8, `every glyph gets a time (${n} parts)`);
check(near(c.parts['1'].at, 0.25, 0.001) && near(c.parts['4'].at, 1.0, 0.001), `0.25s apart (${c.parts['1'].at}, ${c.parts['4'].at})`);
ok = await waitFor(() => document.querySelectorAll('.part-bar[data-clip-part="eq"]').length >= 8, null, 4000);
check(ok, 'stagger opens the rows so you see the cascade');
const glyphs = await S(() => [...document.querySelectorAll('.part-bar[data-clip-part="eq"] .nm')].map((e) => e.textContent).join(''));
check(/x2\+y2=r2/.test(glyphs), `glyph rows are labelled with their characters (${glyphs})`);
const ticks = await S(() => document.querySelectorAll('.clip[data-clip="eq"] .part-tick').length);
check(ticks >= 7, `collapsed-bar ticks show the cascade (${ticks})`);
await shot('4-stagger.png');

// ------------------------------------------------------------------ nested groups
console.log('\n▶ Nested groups open level by level');
await win.click('.clip[data-clip="nest"] [data-testid=parts-toggle]');
ok = await waitFor(() => document.querySelectorAll('.part-bar[data-clip-part="nest"]').length === 2, null, 5000);
check(ok, 'two top-level rows (row1, row2)');
await win.click('.part-bar[data-clip-part="nest"][data-part="0"] [data-testid=part-toggle]');
ok = await waitFor(() => document.querySelectorAll('.part-bar[data-clip-part="nest"]').length === 5, null, 3000);
check(ok, 'opening row1 adds its three dots');
const order = await S(() => [...document.querySelectorAll('.part-bar[data-clip-part="nest"]')].map((e) => e.dataset.part).join(','));
// rows are ordered by their top
const tops = await S(() => [...document.querySelectorAll('.part-bar[data-clip-part="nest"]')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((e) => e.dataset.part).join(','));
check(tops === '0,0.0,0.1,0.2,1', `rows nest under their group (${tops})`);
// drag the group row: the group and its own-timed children move together
await S(() => window.__ms.store.getState().commit((p) => { const cc = p.clips.find((x) => x.id === 'nest'); cc.parts = { '0.2': { at: 1 } }; }));
await win.waitForTimeout(100);
b = await box('.part-bar[data-clip-part="nest"][data-part="0"]');
await win.mouse.move(b.x + 40, b.y + b.h / 2);
await win.mouse.down();
await win.mouse.move(b.x + 90, b.y + b.h / 2, { steps: 4 });
await win.mouse.move(b.x + 140, b.y + b.h / 2, { steps: 4 });
await win.mouse.up();
c = await clipOf('nest');
check(near(c.parts['0']?.at, 1, 0.08) && near(c.parts['0.2']?.at, 2, 0.08), `moving row1 carries its timed child along (${JSON.stringify(c.parts)})`);
await shot('5-nested.png');

// ------------------------------------------------------------------ blade keeps scene times
console.log('\n▶ Blade through a group with part timing');
await S(() => window.__ms.actions.splitClipsAt(['grp'], 1.5));
const p2 = await proj();
const left = p2.clips.find((x) => x.id === 'grp');
const right = p2.clips.find((x) => x.id !== 'grp' && x.track === left.track && near(x.start, 1.5, 0.001));
check(!!right, 'cut made a right half');
check(near(left.parts?.['2']?.at ?? -1, 1.5, 0.001), `left half: triangle (at 2.5) is not in it (${JSON.stringify(left.parts?.['2'])})`);
check(right && near(right.parts?.['2']?.at ?? -1, 1.0, 0.001), `right half: triangle still appears at 2.5s scene time (${JSON.stringify(right?.parts?.['2'])})`);
check(right && near(right.parts?.['0']?.until ?? -1, 2.5, 0.001), `right half: square still leaves at 4s scene time (${right?.parts?.['0']?.until})`);
check(right && right.parts?.['1']?.enter?.type === 'none', 'right half: circle already on screen — no second enter');
await S(() => window.__ms.store.getState().undo());

// ------------------------------------------------------------------ generated code
console.log('\n▶ Generated scene.py carries the part timing');
const code = await S(async () => {
  const port = await window.studio.enginePort();
  const r = await fetch(`http://127.0.0.1:${port}/code`, { method: 'POST', body: JSON.stringify({ project: window.__ms.store.getState().project }) });
  return (await r.json()).code;
});
check(/parts=\{\n\s+'0': dict\(until=4/.test(code) && /'1': dict\(at=1\.0, enter=\('SpinIn'/.test(code), 'scene.py has parts={...} with the timings');

// ------------------------------------------------------------------ agent tool
console.log('\n▶ Agent: update_clips parts (stagger shortcut and explicit paths)');
const t1 = await S(async () => {
  const d = window.__ms.sessions.activeHandle ? window.__ms.sessions.activeHandle() : null;
  return !!d;
});
const res = await S(async () => {
  const sessions = window.__ms.sessions;
  const tools = window.__ms.agent?.tools || window.__ms.agent;
  const handle = sessions.handleFor ? sessions.handleFor(window.__ms.store.getState().sessionId) : sessions.activeHandle?.();
  if (!tools?.runTool || !handle) return { skipped: true, keys: Object.keys(window.__ms.agent || {}), skeys: Object.keys(sessions || {}) };
  const a = await tools.runTool(handle, 'update_clips', JSON.stringify({ updates: [{ id: 'nest', parts: { stagger: 0.5 } }] }));
  const b = await tools.runTool(handle, 'update_clips', JSON.stringify({ updates: [{ id: 'grp', parts: { '2': { at: 3, enter: { type: 'FadeInUp', duration: 0.4 } }, '9': { at: 1 } } }] }));
  return { a: a.text, b: b.text };
});
if (res.skipped) {
  console.log('   (agent handle not exposed:', JSON.stringify(res), ')');
} else {
  c = await clipOf('nest');
  check(near(c.parts?.['1']?.at ?? -1, 0.5, 0.001), `stagger shortcut times the top-level parts (${JSON.stringify(c.parts)})`);
  c = await clipOf('grp');
  check(c.parts?.['2']?.enter?.type === 'FadeInUp' && c.parts['2'].at === 3 && !c.parts['0'], 'explicit paths replace the timing');
  check(/part "9" doesn't exist/.test(res.b), 'a path that does not exist is reported');
}

check(!errors.length, `no page errors ${errors.slice(0, 3).join(' | ')}`);
await app.close();
console.log(fails.length ? `\n✗ ${fails.length} failed` : '\n✓ all passed');
process.exit(fails.length ? 1 : 0);
