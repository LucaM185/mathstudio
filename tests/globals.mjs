// Project globals: the Globals panel under the library, linked params, layout bindings, rename /
// delete / undo, and the agent's set_globals tool (scripted mock model: free, deterministic).
//   npm run build && node tests/globals.mjs
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out', 'globals');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-gl-'));
const fails = [];
const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };

/** Mock model: "build" -> set_globals, then add_clips using them, then a text reply. */
function installMock({ ipcMain }) {
  ipcMain.removeHandler('ai:status');
  ipcMain.removeHandler('ai:chat');
  global.__toolResults = [];
  ipcMain.handle('ai:status', async () => ({ configured: true, model: 'mock/scripted' }));
  ipcMain.handle('ai:chat', async (_e, { body }) => {
    const msgs = body.messages;
    for (const m of msgs) if (m.role === 'tool' && !global.__toolResults.includes(m.content)) global.__toolResults.push(m.content);
    global.__lastSystem = JSON.stringify(msgs[0]?.content);
    global.__tools = (body.tools || []).map((t) => t.function.name);
    const last = msgs[msgs.length - 1];
    const call = (name, args) => ({ message: { role: 'assistant', content: '', tool_calls: [{ id: `call_${name}_${Date.now()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish: 'tool_calls', usage: { cost: 0 } });
    const toolCount = msgs.filter((m) => m.role === 'tool').length;
    void last;
    if (toolCount < 2) {
      if (toolCount === 0) {
        return call('set_globals', { set: [
          { name: 'BODY_SIZE', type: 'number', value: 36, note: 'font size of the rows' },
          { name: 'MONO', type: 'font', value: 'Menlo' },
          { name: 'ROW_GAP', type: 'number', value: 0.8 },
          { name: 'TOP_Y', type: 'number', value: 2 },
          { name: 'ACCENT', type: 'color', value: '#FC6255' },
          { name: 'PI', type: 'number', value: 3 },
        ] });
      }
      return call('add_clips', { clips: [0, 1, 2].map((i) => ({
        item: 'text', name: `Row ${i + 1}`, start: 0, duration: 4,
        params: { text: `row ${i + 1}`, font_size: '$BODY_SIZE', font: '$MONO', fill: '$ACCENT' },
        layout: { x: '0', y: `TOP_Y - ${i}*ROW_GAP` },
        enter: { type: 'none' }, exit: { type: 'none' },
      })) });
    }
    return { message: { role: 'assistant', content: 'Built three rows driven by globals.' }, finish: 'stop', usage: { cost: 0 } };
  });
}

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_HIDDEN: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'), MATHSTUDIO_STARTUP_PROJECTS: '0' });
const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
await app.evaluate(installMock);
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
win.on('console', (m) => m.type() === 'error' && !/status of 422/.test(m.text()) && errors.push(m.text()));
await win.setViewportSize({ width: 1600, height: 950 });
await win.waitForSelector('.lib-card', { timeout: 90000 });

const S = (fn, arg) => win.evaluate(fn, arg);
const proj = () => S(() => window.__ms.store.getState().project);
const waitMeta = (pred, arg, ms = 15000) => win.waitForFunction(pred, arg, { timeout: ms }).then(() => true, () => false);

// ------------------------------------------------------------------ panel
console.log('\n▶ Globals panel');
const panel = await win.$('[data-testid=globals-panel]');
check(!!panel, 'Globals panel is mounted');
const geo = await S(() => {
  const g = document.querySelector('[data-testid=globals-panel]').getBoundingClientRect();
  const l = document.querySelector('.library').getBoundingClientRect();
  return { gTop: g.top, gLeft: g.left, gW: g.width, gH: g.height, lBottom: l.bottom, lLeft: l.left, lW: l.width };
});
check(geo.gTop >= geo.lBottom - 1 && Math.abs(geo.gLeft - geo.lLeft) < 2 && Math.abs(geo.gW - geo.lW) < 2, `sits under the library, same width (${JSON.stringify(geo)})`);
check(geo.gH > 80, `has room (${geo.gH}px)`);
check(await win.isVisible('.globals-empty'), 'empty state explains what globals are');

// add a number global and rename it
await win.click('[data-testid=globals-add]');
await win.click('[data-testid=globals-add-number]');
await win.waitForSelector('[data-testid=global-name-SIZE]');
const focusedOk = await waitMeta(() => document.activeElement?.getAttribute('data-testid') === 'global-name-SIZE', null, 3000);
check(focusedOk, "new global's name is focused, ready to type");
await win.keyboard.type('row gap');
await win.keyboard.press('Enter');
await win.waitForSelector('[data-testid=global-name-ROW_GAP]');
check(true, '"row gap" became ROW_GAP');
await win.fill('[data-testid=global-value-ROW_GAP]', '0.25');
await win.keyboard.press('Enter');
let p = await proj();
check(p.globals?.[0]?.name === 'ROW_GAP' && p.globals[0].value === 0.25 && p.globals[0].type === 'number', `stored in the project (${JSON.stringify(p.globals)})`);

// a custom clip that reads it
await S(() => {
  const st = window.__ms.store.getState();
  st.commit((p) => {
    p.clips.push({ id: 'cg', name: 'Squares', item: 'custom', track: p.tracks[0].id, start: 0, duration: 6, params: {}, code: 'return VGroup(*[Square(side_length=0.5) for _ in range(3)]).arrange(RIGHT, buff=ROW_GAP)', transform: { x: 0, y: -2, z: 0, scale: 1, rotation: 0, opacity: 1 }, keys: [], enter: { type: 'none', duration: 1 }, exit: { type: 'none', duration: 1 }, effects: [] });
  });
  st.setTime(1);
});
let ok = await waitMeta(() => Math.abs((window.__ms.store.getState().meta?.clips?.cg?.w ?? 0) - 2.0) < 0.03);
check(ok, 'custom code renders with ROW_GAP = 0.25 (width 2.0)');
check(await win.textContent('.gv-row .gv-uses') === '1', 'usage badge counts the clip');
await win.fill('[data-testid=global-value-ROW_GAP]', '1');
await win.keyboard.press('Enter');
ok = await waitMeta(() => Math.abs((window.__ms.store.getState().meta?.clips?.cg?.w ?? 0) - 3.5) < 0.03);
check(ok, 'changing the value in the panel re-renders the clip (width 3.5)');

// undo restores the old value
await S(() => window.__ms.store.getState().undo());
p = await proj();
check(p.globals[0].value === 0.25, `undo restores the value (${p.globals[0].value})`);
await S(() => window.__ms.store.getState().redo());

// scrub with the drag handle
const h = await win.$('.gv-row .gv-scrub');
const hb = await h.boundingBox();
await win.mouse.move(hb.x + 4, hb.y + 6);
await win.mouse.down();
await win.mouse.move(hb.x + 44, hb.y + 6, { steps: 6 });
await win.mouse.up();
p = await proj();
check(p.globals[0].value > 1, `dragging the ↔ handle increases the value (${p.globals[0].value})`);
const pastAfterScrub = await S(() => window.__ms.store.getState().past.length);

// rename refactors code
await win.fill('[data-testid=global-name-ROW_GAP]', 'GAP');
await win.keyboard.press('Enter');
p = await proj();
check(p.globals[0].name === 'GAP' && p.clips.find((c) => c.id === 'cg').code.includes('buff=GAP)'), 'renaming updates the code that uses it');
check(await S(() => window.__ms.store.getState().past.length) === pastAfterScrub + 1, 'rename is one undo step');

// reserved name -> visible error
await win.fill('[data-testid=global-name-GAP]', 'BLUE');
await win.keyboard.press('Enter');
ok = await waitMeta(() => !!window.__ms.store.getState().meta?.global_errors?.BLUE);
check(ok, 'reserved name BLUE reported by the engine');
check(await win.isVisible('.gv-row.err'), 'row shows the error');
await win.screenshot({ path: path.join(OUT, '1-reserved-name.png') });
await win.fill('[data-testid=global-name-BLUE]', 'GAP');
await win.keyboard.press('Enter');
ok = await waitMeta(() => !Object.keys(window.__ms.store.getState().meta?.global_errors || {}).length && !Object.keys(window.__ms.store.getState().meta?.errors || {}).length);
check(ok, 'renaming back clears the error');

// ------------------------------------------------------------------ inspector: link a param
console.log('\n▶ Linking template params');
await S(() => {
  const st = window.__ms.store.getState();
  const lib = st.library;
  const item = lib.items.find((i) => i.id === 'text');
  const params = Object.fromEntries(item.params.map((p) => [p.id, p.default]));
  st.commit((p) => {
    if (!p.tracks[1]) p.tracks.push({ id: 'tB', name: 'Track B' });
    p.clips.push({ id: 'ct', name: 'Label', item: 'text', track: p.tracks[1].id, start: 0, duration: 6, params: { ...params, text: 'Hello' }, transform: { x: 0, y: 1, z: 0, scale: 1, rotation: 0, opacity: 1 }, keys: [], enter: { type: 'none', duration: 1 }, exit: { type: 'none', duration: 1 }, effects: [] });
  });
  st.set({ selection: ['ct'], rightTab: 'inspector' });
});
await win.waitForSelector('.ins-section h5');
// open the Parameters section if collapsed
const paramsOpen = await win.$('[data-testid=param-font_size]');
if (!paramsOpen) {
  const heads = await win.$$('.ins-section h5');
  for (const hh of heads) if (/Parameters/.test(await hh.textContent())) await hh.click();
}
await win.waitForSelector('[data-testid=param-font_size]');
await waitMeta(() => (window.__ms.store.getState().meta?.clips?.ct?.h ?? 0) > 0);
const h0 = await S(() => window.__ms.store.getState().meta?.clips?.ct?.h);
await win.hover('[data-testid=param-font_size]');
await win.click('[data-testid=param-link-font_size]', { force: true });
await win.click('[data-testid=param-promote-font_size]');
await win.waitForSelector('[data-testid=param-linked-font_size]');
p = await proj();
const ct = p.clips.find((c) => c.id === 'ct');
check(JSON.stringify(ct.params.font_size) === '{"$g":"FONT_SIZE"}' && p.globals.find((g) => g.name === 'FONT_SIZE')?.value === 48, `"New global from this value" creates FONT_SIZE = 48 and links it (${JSON.stringify(ct.params.font_size)})`);
await win.fill('[data-testid=global-value-FONT_SIZE]', '96');
await win.keyboard.press('Enter');
ok = await waitMeta((h0) => (window.__ms.store.getState().meta?.clips?.ct?.h ?? 0) > h0 * 1.7, h0);
check(ok, 'changing FONT_SIZE in the panel grows the linked text');
await win.screenshot({ path: path.join(OUT, '2-linked-param.png') });
// unlink keeps the value
await win.click('[data-testid=param-unlink-font_size]');
p = await proj();
check(p.clips.find((c) => c.id === 'ct').params.font_size === 96, 'unlink keeps the current value');
// relink, then delete the global: the param keeps the last value
await win.hover('[data-testid=param-font_size]');
await win.click('[data-testid=param-link-font_size]', { force: true });
await win.click('.param-link-menu button:has-text("FONT_SIZE")');
p = await proj();
check(JSON.stringify(p.clips.find((c) => c.id === 'ct').params.font_size) === '{"$g":"FONT_SIZE"}', 'link to an existing global from the menu');
await win.hover('[data-testid=global-name-FONT_SIZE]');
await win.click('[data-testid=global-del-FONT_SIZE]');
p = await proj();
check(!p.globals.find((g) => g.name === 'FONT_SIZE') && p.clips.find((c) => c.id === 'ct').params.font_size === 96, 'deleting a global unlinks params at its last value');

// ------------------------------------------------------------------ layout bindings
console.log('\n▶ Layout bindings');
await S(() => window.__ms.store.getState().commit((p) => {
  p.globals.push({ id: 'gt', name: 'TOP_Y', type: 'number', value: 2 });
  p.clips.find((c) => c.id === 'ct').layout = { y: 'TOP_Y - GAP' };
}));
p = await proj();
const gap = p.globals.find((g) => g.name === 'GAP').value;
check(Math.abs(p.clips.find((c) => c.id === 'ct').transform.y - (2 - gap)) < 1e-6, `y follows TOP_Y - GAP (${p.clips.find((c) => c.id === 'ct').transform.y})`);
if (!(await win.$('[data-testid=layout-y]'))) {
  for (const hh of await win.$$('.ins-section h5')) if (/Transform/.test(await hh.textContent())) await hh.click();
}
await win.waitForSelector('[data-testid=layout-y]');
check(await win.inputValue('[data-testid=layout-y]') === 'TOP_Y - GAP', 'inspector shows the Y expression');
await win.fill('[data-testid=global-value-TOP_Y]', '3');
await win.keyboard.press('Enter');
p = await proj();
check(Math.abs(p.clips.find((c) => c.id === 'ct').transform.y - (3 - gap)) < 1e-6, 'changing TOP_Y moves the clip');
await win.fill('[data-testid=layout-y]', 'TOP_Y - NOPE');
await win.keyboard.press('Enter');
check(await win.isVisible('.layout-err'), 'unknown name in an expression is flagged, not applied');
await win.fill('[data-testid=layout-y]', 'TOP_Y - 2*GAP');
await win.keyboard.press('Enter');
p = await proj();
check(Math.abs(p.clips.find((c) => c.id === 'ct').transform.y - (3 - 2 * gap)) < 1e-6, 'editing the expression re-places the clip');
await win.screenshot({ path: path.join(OUT, '3-layout.png') });
// moving it by hand unbinds that axis
await S(() => window.__ms.store.getState().commit((p) => { const c = p.clips.find((c) => c.id === 'ct'); c.transform = { ...c.transform, y: -1 }; }));
p = await proj();
check(!p.clips.find((c) => c.id === 'ct').layout && p.clips.find((c) => c.id === 'ct').transform.y === -1, 'a manual move unbinds the axis and keeps the new position');

// ------------------------------------------------------------------ save / load round trip
const saved = await proj();
await S((pp) => window.__ms.store.getState().loadProject(pp, null), saved);
p = await proj();
check(p.globals?.length === saved.globals.length && p.globals.every((g, i) => g.name === saved.globals[i].name && g.value === saved.globals[i].value), 'globals survive save / load (normalizeProject)');

// ------------------------------------------------------------------ agent
console.log('\n▶ Agent set_globals + "$NAME" links + layout');
await S(() => window.__ms.store.getState().loadProject({ version: 1, settings: { name: 'Agent globals' }, tracks: [], clips: [], assets: [] }, null));
await win.click('[data-testid=right-tab-agent]');
await win.waitForSelector('[data-testid=agent-panel]');
await S(() => window.__ms.agent.refreshStatus());
await win.fill('[data-testid=agent-input]', 'build three rows');
await win.keyboard.press('Enter');
await win.waitForFunction(() => window.__ms.agent.useAgent.getState().running, null, { timeout: 5000 }).catch(() => {});
await win.waitForFunction(() => !window.__ms.agent.useAgent.getState().running, null, { timeout: 60000 });
const sys = await app.evaluate(() => global.__lastSystem);
const tools = await app.evaluate(() => global.__tools);
check(/Build scenes from SEPARATE, movable elements/.test(sys) && /# Globals/.test(sys), 'system prompt asks for separate elements and globals');
check(tools.includes('set_globals'), 'set_globals tool offered to the model');
const results = await app.evaluate(() => global.__toolResults);
const r0 = JSON.parse(results[0] || '{}');
check(r0.global_errors?.PI, `set_globals reports the reserved name PI (${JSON.stringify(r0.global_errors)})`);
p = await proj();
const rows = p.clips.filter((c) => /^Row/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name));
check(rows.length === 3, `three separate clips (${rows.map((c) => c.name)})`);
check(rows.every((c) => JSON.stringify(c.params.font_size) === '{"$g":"BODY_SIZE"}' && JSON.stringify(c.params.font) === '{"$g":"MONO"}' && JSON.stringify(c.params.fill) === '{"$g":"ACCENT"}'), '"$NAME" params stored as links');
check(rows.map((c) => c.transform.y).join() === '2,1.2,0.4', `layout bindings placed the rows (${rows.map((c) => c.transform.y)})`);
const r1 = JSON.parse(results[1] || '{}');
check(!r1.errors && !(r1.warnings || []).length, `add_clips had no warnings/errors (${results[1]?.slice(0, 300)})`);
await win.fill('[data-testid=global-value-ROW_GAP]', '1.5');
await win.keyboard.press('Enter');
p = await proj();
check(p.clips.filter((c) => /^Row/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.transform.y).join() === '2,0.5,-1', 'changing ROW_GAP in the panel re-spaces the agent\'s rows');
ok = await waitMeta(() => { const m = window.__ms.store.getState().meta; return m && !Object.keys(m.errors || {}).length && Object.keys(m.clips || {}).length === 3; });
check(ok, 'all three rows render without errors');
await win.click('[data-testid=right-tab-inspector]');
const badge = await S(() => [...document.querySelectorAll('.gv-row')].find((r) => r.querySelector('[data-testid=global-name-ROW_GAP]'))?.querySelector('.gv-uses')?.textContent);
check(badge === '3', `usage badge counts layout bindings (ROW_GAP used by ${badge})`);
ok = await waitMeta(() => document.querySelectorAll('.clip img.clip-img').length === 3, null, 20000);
check(ok, 'timeline shows a thumbnail for each linked text clip');
await win.screenshot({ path: path.join(OUT, '4-agent-rows.png') });
// renaming a global used in layout expressions rewrites them
await win.fill('[data-testid=global-name-ROW_GAP]', 'LINE_GAP');
await win.keyboard.press('Enter');
p = await proj();
check(p.clips.filter((c) => /^Row/.test(c.name)).every((c) => /LINE_GAP/.test(c.layout?.y || '') && !/ROW_GAP/.test(c.layout?.y || '')), 'rename rewrites layout expressions');
// deleting it bakes the value into the expressions: rows stay put
const ys = p.clips.filter((c) => /^Row/.test(c.name)).map((c) => c.transform.y).join();
await win.hover('[data-testid=global-name-LINE_GAP]');
await win.click('[data-testid=global-del-LINE_GAP]');
await win.fill('[data-testid=global-value-TOP_Y]', '3');
await win.keyboard.press('Enter');
p = await proj();
const ys2 = p.clips.filter((c) => /^Row/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.transform.y).join();
check(ys2 === '3,1.5,0', `after deleting LINE_GAP the rows keep its spacing and still follow TOP_Y (${ys} → ${ys2})`);
// generated code
const code = await S(async () => { const r = await fetch(`http://127.0.0.1:${window.__ms.store.getState().port}/code`, { method: 'POST', body: JSON.stringify({ project: window.__ms.store.getState().project }) }); return (await r.json()).code; });
check(/BODY_SIZE = 36/.test(code) && /TOP_Y = 3\b/.test(code) && !/LINE_GAP|ROW_GAP/.test(code) && /font_size=BODY_SIZE/.test(code) && !/^PI = /m.test(code), 'scene.py has the globals block and uses the names');

check(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
await app.close();
console.log(fails.length ? `\nFAILED ${fails.length}: ${fails.join(' | ')}` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
