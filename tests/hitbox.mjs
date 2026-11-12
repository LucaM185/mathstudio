// Hit boxes hug what a clip draws: invisible layout frames / reference rectangles (e.g. an agent's
// 12×8 "centring" rectangle) must not make the selection box, hit-testing or fit-to-view huge.
//   npm run build && node tests/hitbox.mjs
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out', 'hitbox');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-hb-'));
const fails = [];
const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_HIDDEN: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'), MATHSTUDIO_STARTUP_PROJECTS: '0' });
const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
// scripted mock model (free): adds a padded grid, then replies
await app.evaluate(({ ipcMain }, code) => {
  ipcMain.removeHandler('ai:status');
  ipcMain.removeHandler('ai:chat');
  global.__toolResults = [];
  ipcMain.handle('ai:status', async () => ({ configured: true, model: 'mock/scripted' }));
  ipcMain.handle('ai:chat', async (_e, { body }) => {
    const msgs = body.messages;
    global.__lastSystem = JSON.stringify(msgs[0]?.content);
    for (const m of msgs) if (m.role === 'tool' && !global.__toolResults.includes(m.content)) global.__toolResults.push(m.content);
    if (!msgs.some((m) => m.role === 'tool')) {
      const args = { clips: [{ item: 'custom', name: 'Padded grid', code, start: 0, duration: 4, x: 0, y: 0 }] };
      return { message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_add', type: 'function', function: { name: 'add_clips', arguments: JSON.stringify(args) } }] }, finish: 'tool_calls', usage: { cost: 0 } };
    }
    return { message: { role: 'assistant', content: 'done' }, finish: 'stop', usage: { cost: 0 } };
  });
}, `g = VGroup(Square(1).set_fill(WHITE, 1))
ref = Rectangle(width=12, height=8)
ref.set_stroke(width=0)
ref.set_fill(opacity=0)
g.add(ref)
return g`);
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
win.on('console', (m) => m.type() === 'error' && !/status of 422/.test(m.text()) && errors.push(m.text()));
await win.setViewportSize({ width: 1600, height: 950 });
await win.waitForSelector('.lib-card', { timeout: 90000 });

const S = (fn, arg) => win.evaluate(fn, arg);
const state = () => S(() => {
  const s = window.__ms.store.getState();
  return { project: s.project, selection: s.selection, time: s.time, meta: s.meta, fresh: s.metaProject === s.project };
});
const waitFrame = async (pred = () => true, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const st = await state();
    if (st.meta && st.fresh && Math.abs(st.meta.t - st.time) < 1e-6 && pred(st)) return st;
    await win.waitForTimeout(60);
  }
  return state();
};
const FW = 14.222222222222221, FH = 8;
const stageBox = () => win.locator('.stage-canvas').boundingBox();
const worldToScreen = (b, x, y) => ({ x: b.x + ((x + FW / 2) / FW) * b.width, y: b.y + ((FH / 2 - y) / FH) * b.height });
const shot = (name) => win.screenshot({ path: path.join(OUT, name) });

// a 4×4 grid with a label above, padded by an invisible 12×8 rectangle (what the agent produced)
const grid = (label) => `pattern = ['0110', '1001', '1001', '0110']
gs = 0.7
g = VGroup()
for r, row in enumerate(pattern):
    for c, ch in enumerate(row):
        sq = Square(side_length=gs)
        sq.move_to(np.array([(c - 1.5) * gs, (1.5 - r) * gs, 0]))
        sq.set_fill(WHITE if ch == '1' else BLACK, opacity=1)
        sq.set_stroke(GREY_C, width=2)
        g.add(sq)
g.add(Text('${label}', font_size=48).move_to(np.array([0, 1.5 * gs + 0.6, 0])))
ref = Rectangle(width=12, height=8)
ref.set_stroke(width=0)
ref.set_fill(opacity=0)
g.add(ref)
return g`;
// content off-centre inside its invisible frame: the box must follow the content, not the frame centre
const offset = `box = Rectangle(width=6, height=2, stroke_width=0)
dot = Square(1).set_fill(RED, 1).set_stroke(width=0).move_to(box).align_to(box, RIGHT)
return VGroup(box, dot)`;

const clip = (id, name, code, x, y, extra = {}) => ({
  id, name, item: 'custom', code, params: {}, track: 't' + id, start: 0, duration: 6, dynamic: false,
  transform: { x, y, z: 0, scale: 1, rotation: 0, opacity: 1 }, keys: [], effects: [],
  enter: { type: 'FadeIn', duration: 0.6, rate: 'smooth' }, exit: { type: 'FadeOut', duration: 0.5, rate: 'smooth', target: null }, ...extra,
});

console.log('\n▶ Invisible 12×8 frames don\'t inflate hit boxes');
await S((p) => window.__ms.store.getState().loadProject(p, null), {
  version: 1, settings: { name: 'Hitbox test', duration: 8 },
  tracks: ['A', 'B', 'C', 'D'].map((n) => ({ id: 't' + n, name: n })),
  clips: [clip('A', 'Grid 0', grid('0'), -4, 0), clip('B', 'Grid 1', grid('1'), 0, 0), clip('C', 'Grid 2', grid('2'), 4, 0),
    clip('D', 'Offset', offset, 0, -2.8, { transform: { x: 0, y: -2.8, z: 0, scale: 0.8, rotation: 30, opacity: 1 } })],
  assets: [],
}, null);
await S(() => window.__ms.store.getState().setTime(3));
let st = await waitFrame((s) => Object.keys(s.meta.clips).length === 4);
const iA = st.meta.clips.A;
check(near(iA.w, 2.8, 0.05) && near(iA.h, 3.22, 0.15), `grid hit box is the drawn grid (${iA.w?.toFixed(2)}×${iA.h?.toFixed(2)}), not 12×8`);
check(iA.full && near(iA.full[0], 12, 0.01), 'engine still reports the full (padded) size');
check(iA.bbox && near(iA.bbox[0], -5.4, 0.05) && near(iA.bbox[2], -2.6, 0.05), `world bbox is the drawn grid (${iA.bbox?.map((v) => v.toFixed(2)).join(', ')})`);
check(!st.meta.clips.B.ox && near(st.meta.clips.B.oy, 0.21, 0.05), 'label above the grid shifts the box centre up (oy)');

const b = await stageBox();
// empty space between grids / below them: previously inside every 12×8 box → must select nothing now
await win.mouse.click(...Object.values(worldToScreen(b, 0, 3.2)));
st = await state();
check(st.selection.length === 0, `clicking empty space above the grids selects nothing (got ${JSON.stringify(st.selection)})`);
await win.mouse.click(...Object.values(worldToScreen(b, -2, -1)));
st = await state();
check(st.selection.length === 0, `clicking the gap between grid 0 and grid 1 selects nothing (got ${JSON.stringify(st.selection)})`);
// on a grid → that grid
await win.mouse.click(...Object.values(worldToScreen(b, 4.3, 0.3)));
st = await state();
check(st.selection.join() === 'C', `clicking grid 2 selects it (got ${JSON.stringify(st.selection)})`);
await win.waitForTimeout(150);
const sel = await win.locator('.sel-box').first().boundingBox();
const exp = { w: (2.8 / FW) * b.width, h: (3.22 / FH) * b.height };
check(sel && near(sel.width, exp.w, 8) && near(sel.height, exp.h, 10), `selection box ≈ grid on screen (${sel?.width.toFixed(0)}×${sel?.height.toFixed(0)} px vs ${exp.w.toFixed(0)}×${exp.h.toFixed(0)})`);
const gc = worldToScreen(b, 4, 0.21);
check(sel && near(sel.x + sel.width / 2, gc.x, 6) && near(sel.y + sel.height / 2, gc.y, 6), 'selection box centred on the grid + label');
await shot('grid-selected.png');

console.log('\n▶ Off-centre content inside a rotated, scaled invisible frame');
// the red square sits at the right end of a 6-wide frame: local (2.5, 0) → ×0.8, rotated 30°
const a = (30 * Math.PI) / 180;
const wx = 0 + 0.8 * 2.5 * Math.cos(a), wy = -2.8 + 0.8 * 2.5 * Math.sin(a);
await win.mouse.click(...Object.values(worldToScreen(b, wx, wy)));
st = await state();
check(st.selection.join() === 'D', `clicking the red square selects it (got ${JSON.stringify(st.selection)})`);
await win.mouse.click(...Object.values(worldToScreen(b, 0 - 0.8 * 2.2 * Math.cos(a), -2.8 - 0.8 * 2.2 * Math.sin(a))));
st = await state();
check(st.selection.length === 0, 'clicking the empty left end of its frame selects nothing');
await win.mouse.click(...Object.values(worldToScreen(b, wx, wy)));
await win.waitForTimeout(150);
const r = await win.locator('.sel-box').first().boundingBox();
const sq = worldToScreen(b, wx, wy);
check(r && near(r.x + r.width / 2, sq.x, 5) && near(r.y + r.height / 2, sq.y, 5), `rotated selection box sits on the square (${r && (r.x + r.width / 2).toFixed(0)},${r && (r.y + r.height / 2).toFixed(0)} vs ${sq.x.toFixed(0)},${sq.y.toFixed(0)})`);
await shot('offset-selected.png');

console.log('\n▶ Fade-in start (nothing drawn yet) still reports the content box');
await S(() => window.__ms.store.getState().setTime(0));
st = await waitFrame((s) => s.meta.clips.A);
const b0 = st.meta.clips.A.bbox;
check(b0 && near(b0[0], -5.4, 0.05) && near(b0[2], -2.6, 0.05), `bbox at t=0 = grid (${b0?.map((v) => v.toFixed(2)).join(', ')})`);

console.log('\n▶ Agent: prompt forbids frame-sized padding, tools warn about it');
await S(() => window.__ms.store.getState().loadProject({ version: 1, settings: { name: 'Agent pad' }, tracks: [], clips: [], assets: [] }, null));
await win.click('[data-testid=right-tab-agent]');
await win.waitForSelector('[data-testid=agent-panel]');
await S(() => window.__ms.agent.refreshStatus());
await win.fill('[data-testid=agent-input]', 'add a grid');
await win.keyboard.press('Enter');
await win.waitForFunction(() => window.__ms.agent.useAgent.getState().running, null, { timeout: 5000 }).catch(() => {});
await win.waitForFunction(() => !window.__ms.agent.useAgent.getState().running, null, { timeout: 60000 });
const sys = await app.evaluate(() => global.__lastSystem);
check(/NEVER frame-sized/.test(sys) && /Static code needs no reference/.test(sys), 'system prompt forbids frame-sized invisible references');
const res = (await app.evaluate(() => global.__toolResults)).join('\n');
check(/invisible padding/.test(res) && /12×8/.test(res), `add_clips result warns about the 12×8 invisible padding`);
check(!/extends outside the frame/.test(res), 'no misleading "outside the frame" note for invisible parts');

check(!errors.length, `no page errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
await app.close();
console.log(fails.length ? `\nFAILURES: ${fails.length}` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
