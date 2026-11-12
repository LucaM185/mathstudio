import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_DATA: process.env.MS_DATA || '' });
const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
const win = await app.firstWindow();
await win.waitForSelector('.lib-card', { timeout: 90000 });
await win.evaluate(() => {
  const a = window.__ms.actions;
  const s = window.__ms.store.getState();
  a.addItem('axes_graph', { time: 0, x: 0, y: 0 });
  a.addItem('tex_formula', { time: 0, x: 0, y: 3 });
  a.addItem('wave', { time: 0, x: 0, y: -2.5 });
  a.addItem('custom_dynamic', { time: 0, x: -5, y: 0 });
  a.addItem('bullets', { time: 0, x: 5, y: 0 });
  window.__ms.store.getState().setTime(0);
});
await win.waitForTimeout(4000);
for (const label of ['default']) {
  const r = await win.evaluate(async () => {
    const st = window.__ms.store;
    let frames = 0, last = st.getState().meta;
    const unsub = st.subscribe((s) => { if (s.meta !== last) { frames++; last = s.meta; } });
    st.setState({ playing: true, time: 0 });
    await new Promise((r) => setTimeout(r, 3000));
    st.setState({ playing: false });
    unsub();
    const m = st.getState().meta;
    return { fps: frames / 3, w: m.w, h: m.h, ms: m.ms, dpr: devicePixelRatio };
  });
  console.log(label, JSON.stringify(r));
}
// drag responsiveness: transform updates
const r2 = await win.evaluate(async () => {
  const st = window.__ms.store;
  st.setState({ playing: false, time: 2 });
  await new Promise((r) => setTimeout(r, 800));
  const id = st.getState().project.clips[0].id;
  let frames = 0, last = st.getState().meta;
  const unsub = st.subscribe((s) => { if (s.meta !== last) { frames++; last = s.meta; } });
  st.setState({ interacting: true });
  const t0 = performance.now();
  while (performance.now() - t0 < 2000) {
    st.getState().commit((p) => { const c = p.clips.find((c) => c.id === id); c.transform.x = Math.sin(performance.now() / 300) * 3; }, { transient: true });
    await new Promise((r) => requestAnimationFrame(r));
  }
  unsub();
  st.setState({ interacting: false });
  return { dragFps: frames / 2 };
});
console.log(JSON.stringify(r2));
await app.close();
