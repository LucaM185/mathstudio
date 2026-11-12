// Parameters of a clip with custom code: the Inspector reads fonts, font sizes, colours, strokes and
// constants out of the code (engine/code_knobs.py) and editing them rewrites the code.
// Uses the clip from the user's "Addizione" project (agent-written binary sum, fs = 110, no font).
//   npm run test:knobs
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out', 'code_knobs');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-knobs-'));
const fails = [];
const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_HIDDEN: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'), MATHSTUDIO_STARTUP_PROJECTS: '0' });
const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
win.on('console', (m) => m.type() === 'error' && !/status of 422/.test(m.text()) && errors.push(m.text()));
await win.setViewportSize({ width: 1600, height: 1100 });
await win.waitForSelector('.lib-card', { timeout: 90000 });
const S = (fn, arg) => win.evaluate(fn, arg);
const waitFor = (pred, arg, ms = 15000) => win.waitForFunction(pred, arg, { timeout: ms }).then(() => true, () => false);
const shot = (name) => win.screenshot({ path: path.join(OUT, name) });
const code = () => S(() => window.__ms.store.getState().project.clips.find((c) => c.id === 'sum').code);
const settle = async () => {
  await waitFor(() => { const s = window.__ms.store.getState(); return s.meta && s.metaProject === s.project && !s.interacting; }, null, 20000);
  await win.waitForTimeout(100);
};
const knobsReady = () => waitFor(() => document.querySelector('[data-testid=code-knobs]')?.getAttribute('data-ready') === '1', null, 10000);
const meta = () => S(() => window.__ms.store.getState().meta);

const SUM = `import random
sp = 0.6
fs = 110
rng = random.Random(7)
A = rng.randrange(2**15, 2**16)
B = rng.randrange(2**15, 2**16)
def sm(x):
    x = min(max(x, 0), 1)
    return x * x * (3 - 2 * x)
n = 4.0
k = 4
a = A % (2**k)
b = B % (2**k)
s = a + b
MA = format(a, '016b')
MB = format(b, '016b')
MR = format(s % (2**k), '016b')
carry = s >> k
def row(M, y, color):
    out = []
    for i in range(16):
        op = min(max(n - i, 0), 1)
        if op <= 0:
            continue
        x = sp * ((n - 1) / 2 - i)
        m = Text(M[15 - i], font_size=fs).set_color(color).move_to([x, y, 0])
        m.set_opacity(op)
        out.append(m)
    return out
xr = (n - 1) * sp / 2
plus = Text('+', font_size=fs).set_color('#58C4DD').move_to([xr + 1.0, -0.1, 0])
half = xr + 0.3
line = Line([-half, -0.9, 0], [half, -0.9, 0], stroke_width=6, color='#BBBBBB')
cx = sp * ((n - 1) / 2 - n)
ovf = Text(str(carry), font_size=fs).set_color('#FC6255').move_to([cx, 2.9, 0])
items = [plus, line, ovf] + row(MA, 1.5, '#FFFFFF') + row(MB, -0.1, '#FFFFFF') + row(MR, -2.3, '#83C167')
return VGroup(*items)`;

await S(([code]) => {
  const st = window.__ms.store.getState();
  st.commit((p) => {
    p.settings.duration = 6;
    p.clips.push({
      id: 'sum', name: 'Somma binaria', item: 'custom_dynamic', dynamic: true, track: p.tracks[0].id, start: 0, duration: 6, params: {}, code,
      transform: { x: 0, y: 0, z: 0, scale: 0.6, rotation: 0, opacity: 1 }, keys: [],
      enter: { type: 'none', duration: 0.5, rate: 'smooth' }, exit: { type: 'none', duration: 1, rate: 'smooth', target: null }, effects: [],
    });
  });
  window.__ms.store.setState({ time: 1, selection: ['sum'] });
}, [SUM]);
await settle();
const h0 = (await meta()).clips.sum.h;

console.log('\n▶ Parameters of a custom-code clip are read from the code');
await win.click('[data-section=params] h5');
check(await knobsReady(), 'knobs load');
check(!(await win.isVisible('text=parameters are detached')), 'no more "detached from the template" dead end');
const val = (sel) => win.inputValue(sel).catch(() => null);
check(await val('[data-testid=param-font_size]') === '110', `Font size shows fs = 110 (${await val('[data-testid=param-font_size]')})`);
check(await win.isVisible('[data-testid=knob-font] select'), 'Font field is there');
check(await win.inputValue('[data-testid=knob-font] select') === '', 'Font reads as Default (not written yet)');
check(await win.isVisible('[data-testid=knob-weight] select'), 'Weight field');
check(await win.isVisible('[data-testid=knob-ovf_color]'), 'colour of ovf');
check(await win.isVisible('[data-testid=knob-plus_color]'), 'colour of plus');
check(await win.isVisible('[data-testid=knob-row_ma_row_mb_color]'), 'shared white of the rows: row(MA), row(MB)');
check(await val('[data-testid=param-sp]') === '0.6', 'constant sp = 0.6');
check(await val('[data-testid=param-stroke_width-line]') === '6', 'stroke width of line');
check(await val('[data-testid=param-text-plus]') === '+', 'text of plus');
await shot('1-knobs.png');

console.log('\n▶ Font size: typing rewrites the constant and the clip re-renders smaller');
await win.fill('[data-testid=param-font_size]', '60');
await win.press('[data-testid=param-font_size]', 'Enter');
await waitFor(() => /\nfs = 60\n/.test(window.__ms.store.getState().project.clips.find((c) => c.id === 'sum').code), null, 3000);
check((await code()).includes('\nfs = 60\n'), 'code now says fs = 60');
await settle();
const m1 = await meta();
check(!m1.errors.sum, `renders (${m1.errors.sum || 'ok'})`);
check(m1.clips.sum.h < h0 - 0.1, `clip got smaller (${h0.toFixed(2)} -> ${m1.clips.sum.h.toFixed(2)})`);

console.log('\n▶ Font: one pick writes font= into every Text');
await knobsReady();
await win.selectOption('[data-testid=knob-font] select', 'Georgia');
await waitFor(() => (window.__ms.store.getState().project.clips.find((c) => c.id === 'sum').code.match(/font="Georgia"/g) || []).length === 3, null, 3000);
let c = await code();
check((c.match(/font="Georgia"/g) || []).length === 3, 'font="Georgia" in all three Text calls');
check(c.includes(`Text('+', font_size=fs, font="Georgia")`), 'inserted after the last argument');
await settle();
check(!(await meta()).errors.sum, 'renders with Georgia');
check(await knobsReady(), 'knobs re-read');
check(await win.inputValue('[data-testid=knob-font] select') === 'Georgia', 'Font now reads Georgia');
await win.selectOption('[data-testid=knob-font] select', 'Futura');
await waitFor(() => (window.__ms.store.getState().project.clips.find((c) => c.id === 'sum').code.match(/font="Futura"/g) || []).length === 3, null, 3000);
check(!(await code()).includes('Georgia'), 'changing it again replaces (no duplicate font=)');
await win.selectOption('[data-testid=knob-weight] select', 'BOLD');
await waitFor(() => (window.__ms.store.getState().project.clips.find((c) => c.id === 'sum').code.match(/weight="BOLD"/g) || []).length === 3, null, 3000);
check(((await code()).match(/weight="BOLD"/g) || []).length === 3, 'Weight Bold');
await settle();
await shot('2-font.png');

console.log('\n▶ Scrubbing a number is many live edits, one undo step, always valid code');
await knobsReady();
const past0 = await S(() => window.__ms.store.getState().past.length);
const lab = await win.locator('[data-testid=knob-font_size] .field > label').boundingBox();
await win.mouse.move(lab.x + 10, lab.y + lab.height / 2);
await win.mouse.down();
for (let i = 1; i <= 12; i++) await win.mouse.move(lab.x + 10 + i * 6, lab.y + lab.height / 2);
await win.mouse.up();
c = await code();
const m = c.match(/\nfs = (\d+)\n/);
check(m && Number(m[1]) > 60, `fs grew while dragging (fs = ${m && m[1]})`);
check((c.match(/font_size=fs/g) || []).length === 3 && (c.match(/font="Futura"/g) || []).length === 3, 'rest of the code untouched');
check(await S(() => window.__ms.store.getState().past.length) === past0 + 1, 'one undo step');
await settle();
check(!(await meta()).errors.sum, 'still renders');

console.log('\n▶ Colours: per element and shared (palette)');
await knobsReady();
await win.fill('[data-testid=knob-ovf_color] input.hex', '#00FF88');
await win.press('[data-testid=knob-ovf_color] input.hex', 'Enter');
await waitFor(() => window.__ms.store.getState().project.clips.find((c) => c.id === 'sum').code.includes("'#00FF88'"), null, 3000);
check((await code()).includes(".set_color('#00FF88')"), 'ovf colour rewritten, quote style kept');
await knobsReady();
await win.fill('[data-testid=knob-row_ma_row_mb_color] input.hex', '#DDDDDD');
await win.press('[data-testid=knob-row_ma_row_mb_color] input.hex', 'Enter');
await waitFor(() => (window.__ms.store.getState().project.clips.find((c) => c.id === 'sum').code.match(/'#DDDDDD'/g) || []).length === 2, null, 3000);
check(((await code()).match(/'#DDDDDD'/g) || []).length === 2, 'the shared white changes both rows');

console.log('\n▶ Link a knob to a new global, then unlink');
await knobsReady();
await win.click('[data-testid=knob-font_size] [data-testid=param-link-font_size]');
await win.click('[data-testid=param-promote-font_size]');
await waitFor(() => /\nfs = FONT_SIZE\n/.test(window.__ms.store.getState().project.clips.find((c) => c.id === 'sum').code), null, 3000);
let p = await S(() => window.__ms.store.getState().project);
check(p.globals?.some((g) => g.name === 'FONT_SIZE' && g.type === 'number'), 'FONT_SIZE global created');
check((await code()).includes('\nfs = FONT_SIZE\n'), 'code reads the global');
check(await knobsReady(), 'knobs re-read');
check(await win.isVisible('[data-testid=param-linked-font_size]'), 'field shows the link chip');
await settle();
check(!(await meta()).errors.sum, 'renders through the global');
await S(() => window.__ms.store.getState().commit((p) => { p.globals.find((g) => g.name === 'FONT_SIZE').value = 40; }));
await settle();
const hG = (await meta()).clips.sum.h;
check(hG < m1.clips.sum.h, `changing the global resizes the clip (${hG.toFixed(2)})`);
await win.click('[data-testid=param-unlink-font_size]');
await waitFor(() => /\nfs = 40\n/.test(window.__ms.store.getState().project.clips.find((c) => c.id === 'sum').code), null, 3000);
check((await code()).includes('\nfs = 40\n'), 'unlink writes the value back');

console.log('\n▶ Style of one part (Parts section): only that part changes');
await knobsReady();
await win.click('[data-section=parts] h5').catch(() => {});
const ovfPath = await (async () => {
  for (let i = 0; i < 40; i++) {
    const path_ = await S(() => {
      const el = document.querySelector('[data-section=parts]');
      return el ? 'x' : null;
    });
    if (path_) break;
    await win.waitForTimeout(250);
  }
  return '2'; // items = [plus, line, ovf, ...]
})();
await S((pp) => window.__ms.store.setState({ selectedPart: { clip: 'sum', path: pp } }), ovfPath);
let ok = await waitFor(() => !!document.querySelector('[data-testid=part-style]'), null, 8000);
check(ok, 'the part card has a Style block for “ovf”');
if (ok) {
  await shot('3-part-style.png');
  await win.fill('[data-testid=part-knob-font_size] input', '30');
  await win.press('[data-testid=part-knob-font_size] input', 'Enter');
  await waitFor(() => window.__ms.store.getState().project.clips.find((c) => c.id === 'sum').code.includes('Text(str(carry), font_size=30'), null, 3000);
  c = await code();
  check(c.includes('Text(str(carry), font_size=30'), 'ovf gets its own size');
  check(c.includes('\nfs = 40\n') && (c.match(/font_size=fs/g) || []).length === 2, 'the others still read fs');
  ok = await waitFor(() => !!document.querySelector('[data-testid=knob-font_size-ovf]'), null, 4000);
  check(ok, 'the panel now lists a separate “Font size · ovf”');
  await shot('3b-part-size.png');
}

console.log('\n▶ Undo all the way back; broken code shows a hint instead of fields');
for (let i = 0; i < 30 && (await code()) !== SUM; i++) await S(() => window.__ms.store.getState().undo());
check((await code()) === SUM, 'undo restores the original code exactly');
await S(() => window.__ms.store.getState().commit((p) => { p.clips.find((c) => c.id === 'sum').code = 'x = Text("a"\nreturn x'; }));
ok = await waitFor(() => /doesn't parse/.test(document.querySelector('[data-testid=code-knobs]')?.textContent || ''), null, 5000);
check(ok, 'syntax error → hint, fields disabled');
await shot('4-broken.png');

check(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
await app.close();
console.log(fails.length ? `\n✗ ${fails.length} failed:\n  - ${fails.join('\n  - ')}` : '\n✓ all code-knob UI checks passed');
process.exit(fails.length ? 1 : 0);
