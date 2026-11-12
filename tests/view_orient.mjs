// The agent and the user must mean the same thing by "top": the agent is told the editor's Y-up
// view names (with exact angles) and the user's current viewport, render_preview can look from
// a named view or the user's view, and clips have a 3D orientation (rx / ry) so text can be laid
// flat and read from the Top view. Mock-free: tools are run directly (no model calls).
//   npm run build && node tests/view_orient.mjs
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out', 'view_orient');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-vo-'));
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
const tool = (name, args) => S(async ([name, args]) => {
  const h = window.__ms.sessions.docHandle(window.__ms.store.getState().sessionId);
  const r = await window.__ms.agentTools.runTool(h, name, JSON.stringify(args));
  return { ok: r.ok, text: r.text, summary: r.summary, images: (r.images || []).map((i) => i.url) };
}, [name, args]);
const editorState = () => S(() => window.__ms.agentTools.editorState(window.__ms.sessions.docHandle(window.__ms.store.getState().sessionId)));

// ink of a rendered preview: height / width (px) of the white text's bounding box
const inkBox = (url) => S(async (url) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = new OffscreenCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4;
    if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  return n ? { w: x1 - x0 + 1, h: y1 - y0 + 1, n } : { w: 0, h: 0, n: 0 };
}, url);
const saveImg = (url, name) => fs.writeFileSync(path.join(OUT, name), Buffer.from(url.split(',')[1], 'base64'));

console.log('1. the system prompt names the views like the view cube');
const sys = await S(() => window.__ms.agentTools.buildSystemPrompt(window.__ms.store.getState().library));
check(/Top \("top"\): eye ABOVE on \+y[^\n]*theta: 180, phi: 90, gamma: 180/.test(sys), 'Top = eye above on +y with its exact angles');
check(/Front \("front"\)[^\n]*theta: 0, phi: 0, gamma: 0/.test(sys), 'Front = the flat 2D view (0, 0, 0)');
check(/rx: -90 lays it flat on the XZ floor, readable from Top/.test(sys), 'prompt explains rx / ry orientation');

console.log('2. a text clip, seen from Top, before and after laying it flat');
const add = await tool('add_clips', { clips: [{ item: 'custom', name: 'Label', code: "return Text('HELLO', font_size=96).set_fill(WHITE, 1)", start: 0, duration: 4, x: 0, y: 0, enter: { type: 'none' }, exit: { type: 'none' } }] });
check(add.ok, `add_clips ok (${add.summary})`);
const cid = await S(() => window.__ms.store.getState().project.clips.at(-1).id);
await S(() => window.__ms.store.getState().setTime(1));

// the user flies the editor view to Top (what the view cube's TOP face produces)
await S(() => window.__ms.store.setState({ editorView: { x: 0, y: 0, z: 0, zoom: 1, theta: 180, phi: 90, gamma: 180 } }));
await win.waitForTimeout(600);
const ev = await S(() => window.__ms.store.getState().editorView);
check(ev && Math.abs(ev.phi - 90) < 1, `editor view is Top (${JSON.stringify(ev)})`);
const es = await editorState();
check(/user's viewport: free editor view \(not exported\) ≈ Top view: eye above on \+y/.test(es), 'editor_state tells the agent the user looks from Top');

const flatUser = await tool('render_preview', { times: [1], view: 'user' });
check(flatUser.ok && /the user's editor view: ≈ Top view/.test(flatUser.text), `render_preview view "user" = the user's Top view (${flatUser.summary})`);
const flatTop = await tool('render_preview', { times: [1], view: 'top' });
check(flatTop.ok && /≈ Top view/.test(flatTop.text) && flatTop.summary.includes('(Top)'), `render_preview view "top" (${flatTop.summary})`);
const bFlat = await inkBox(flatTop.images[0]);
saveImg(flatTop.images[0], '1_flat_from_top.png');
check(bFlat.h <= 6, `upright text from Top is edge-on (${bFlat.w}×${bFlat.h}px)`);
const front = await tool('render_preview', { times: [1], view: 'front' });
const bFront = await inkBox(front.images[0]);
check(bFront.h > 20 && bFront.w > 60, `same text from Front reads (${bFront.w}×${bFront.h}px)`);

const upd = await tool('update_clips', { updates: [{ id: cid, rx: -90 }] });
check(upd.ok, `update_clips rx -90 (${upd.summary})`);
const tr = await S((id) => window.__ms.store.getState().project.clips.find((c) => c.id === id).transform, cid);
check(tr.rx === -90, `clip transform has rx -90 (${JSON.stringify(tr)})`);
const laidTop = await tool('render_preview', { times: [1], view: 'top' });
const bLaid = await inkBox(laidTop.images[0]);
saveImg(laidTop.images[0], '2_laid_from_top.png');
check(bLaid.h > 20 && bLaid.w > 60, `laid-flat text reads from Top (${bLaid.w}×${bLaid.h}px)`);
const laidUser = await tool('render_preview', { times: [1], view: 'user' });
const bUser = await inkBox(laidUser.images[0]);
check(bUser.h > 15 && bUser.w > 40, `…and in the user's own view (${bUser.w}×${bUser.h}px)`);
check(/"rx":-90/.test(await editorState()), 'compact project shows rx to the agent');

console.log('3. the viewport: hit box and inspector follow the 3D orientation');
await S(() => window.__ms.store.setState({ selection: [] }));
await win.waitForTimeout(500);
const stage = await win.locator('.stage-canvas').boundingBox();
await win.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
await win.waitForTimeout(300);
let sel = await S(() => window.__ms.store.getState().selection);
check(sel.includes(cid), `clicking the laid-flat text in the Top view selects it (${JSON.stringify(sel)})`);
await win.screenshot({ path: path.join(OUT, '3_viewport_top.png') });
// open the transform section if collapsed and edit Rot Y
const rxField = win.locator('[data-testid="tr-rx"]');
if (!(await rxField.count())) {
  const h = win.locator('section.ins-section h5', { hasText: 'Transform' }).first();
  if (await h.count()) await h.click();
}
check(await rxField.count() > 0, 'inspector shows Rot X');
const rxVal = await rxField.inputValue();
check(Number(rxVal) === -90, `Rot X field shows -90 (${rxVal})`);
// a keyframed rx animates between keys
await tool('update_clips', { updates: [{ id: cid, keyframes: [{ t: 0, rx: 0 }, { t: 2, rx: -90, ease: 'linear' }] }] });
await S(() => window.__ms.store.getState().setTime(1));
let midRx = null;
for (let i = 0; i < 100; i++) {
  const st = await S((id) => { const s = window.__ms.store.getState(); return { fresh: s.metaProject === s.project && s.meta && Math.abs(s.meta.t - s.time) < 1e-6, rx: s.meta?.clips?.[id]?.rx, keys: s.project.clips.find((c) => c.id === id).keys }; }, cid);
  midRx = st.rx;
  if (st.fresh) { if (i === 0) console.log('     keys', JSON.stringify(st.keys.map((k) => [k.t, k.rx]))); break; }
  await win.waitForTimeout(100);
}
check(Math.abs((midRx ?? 0) + 45) < 0.5, `rx keyframes interpolate in the engine (rx at 1s = ${midRx})`);

check(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
await app.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
