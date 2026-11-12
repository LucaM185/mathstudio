// Playback performance in the real app: loads a project, plays it at a preview quality and reports
// the preview frame rate, engine vs round-trip time per frame, UI main-thread stalls and the
// engine's memory before/after. Also guards the GL leak: engine memory must stay flat.
//   node tests/perf_playback.mjs [project.mstudio] [--quality low|balanced|high] [--seconds 8]
//   npm run test:perf   (uses a generated scene when no project is given)
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const projectPath = args.find((a) => a.endsWith('.mstudio'));
const QUALITY = opt('--quality', 'low');
const SECONDS = Number(opt('--seconds', '8'));
const MIN_FPS = Number(opt('--min-fps', '0'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-perf-'));
const fails = [];
const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
fs.writeFileSync(path.join(TMP, 'settings.json'), JSON.stringify({ quality: QUALITY }));
Object.assign(env, {
  MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'), MATHSTUDIO_STARTUP_PROJECTS: '0',
  MATHSTUDIO_SETTINGS: path.join(TMP, 'settings.json'), MATHSTUDIO_NO_SEMANTIC: '1',
});
const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.setViewportSize({ width: 1600, height: 950 });
await win.waitForSelector('.lib-card', { timeout: 120000 });
const S = (fn, arg) => win.evaluate(fn, arg);

// a scene shaped like a "moderately complex" real one: 3D camera path, groups, dynamic text, morphs
function generated() {
  const clips = [];
  const tracks = [];
  for (let i = 0; i < 8; i++) tracks.push({ id: `t${i}`, name: `Track ${i}` });
  for (let i = 0; i < 6; i++) {
    clips.push({ id: `nn${i}`, name: `Net ${i}`, item: 'neural_network', track: `t${i % 3}`, start: (i % 2) * 4, duration: 14,
      params: { layers: '3, 5, 5, 2', radius: 0.2, spacing: 1.8 }, enter: { type: 'ShowCreation', duration: 1, rate: 'smooth' },
      exit: { type: 'FadeOut', duration: 0.6, rate: 'smooth' }, transform: { x: (i % 3) * 4 - 4, y: 0, z: -4 * Math.floor(i / 3), scale: 1, rotation: 0, opacity: 1 } });
  }
  for (let i = 0; i < 8; i++) {
    clips.push({ id: `lab${i}`, name: `Label ${i}`, item: 'text', track: `t${3 + (i % 4)}`, start: 1 + i * 0.3, duration: 12, dynamic: true,
      params: { text: `Label ${i}` }, enter: { type: 'FadeIn', duration: 1, rate: 'smooth' }, exit: { type: 'FadeOut', duration: 0.6, rate: 'smooth' },
      code: `p = min(max((t - 3) / 2, 0.0), 1.0)\nw = Text("Label ${i}", font_size=48)\nw.rotate(-90 * p * DEG, axis=RIGHT)\nreturn w`,
      transform: { x: i - 4, y: 2.5, z: 0, scale: 1, rotation: 0, opacity: 1 } });
  }
  clips.push({ id: 'src', name: 'Morph from', item: 'text', track: 't7', start: 0, duration: 6, params: { text: 'Before' },
    enter: { type: 'Write', duration: 1, rate: 'smooth' }, exit: { type: 'TransformInto', duration: 1.5, rate: 'smooth', target: 'lab0' },
    transform: { x: 0, y: -3, z: 0, scale: 1, rotation: 0, opacity: 1 } });
  return {
    version: 1, tracks, clips, assets: [], globals: [],
    settings: { name: 'perf scene', duration: 14, fps: 30, background: '#1e1e1e', resolution: [1920, 1080],
      camera: [{ id: 'k0', t: 0, x: 0, y: 0, z: 0, zoom: 0.6, theta: 140, phi: 50, gamma: -130, ease: 'smooth' },
               { id: 'k1', t: 12, x: 2, y: -1, z: -1, zoom: 0.5, theta: 200, phi: 60, gamma: -200, ease: 'smooth' }] },
  };
}

const project = projectPath ? JSON.parse(fs.readFileSync(projectPath, 'utf8')) : generated();
await S((p) => window.__ms.store.getState().loadProject(p, null), project);
const port = await S(() => window.__ms.store.getState().port);
const enginePid = () => {
  try { return execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']).toString().trim().split('\n')[0]; } catch { return null; }
};
const footprint = (pid) => {
  if (!pid || process.platform !== 'darwin') return null;
  try {
    const out = execFileSync('vmmap', ['--summary', pid], { maxBuffer: 1 << 26 }).toString();
    const m = out.match(/Physical footprint:\s+([\d.]+)([KMG])/);
    return m ? Number(m[1]) * { K: 1 / 1024, M: 1, G: 1024 }[m[2]] : null;
  } catch { return null; }
};
const pid = enginePid();
console.log(`· ${projectPath ? path.basename(projectPath) : 'generated scene'} · quality ${QUALITY} · engine pid ${pid}`);

// warm: build every clip once (first frames pay for building mobjects)
const dur = project.settings.duration;
for (let t = 0; t < dur; t += 1) {
  await S((t) => window.__ms.store.getState().setTime(t), t);
  await win.waitForTimeout(120);
}
const mem0 = footprint(pid);

// instrument: frames delivered, engine ms, round trip, long tasks, rAF gaps
await S(() => {
  const w = window;
  w.__perf = { frames: [], long: [], gaps: [], reqs: [] };
  if (!w.__origFetch) {
    w.__origFetch = w.fetch;
    w.fetch = async (url, init) => {
      const t0 = performance.now();
      const r = await w.__origFetch(url, init);
      const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      const bodyLen = init && typeof init.body === 'string' ? init.body.length : 0;
      let tag = '';
      if (path === '/frame' && bodyLen) { try { const b = JSON.parse(init.body); tag = `${b.w}x${b.h}${b.thumb ? ' thumb' : ''}${b.view ? ' view' : ''}${b.seq ? '' : ' noseq'}`; } catch {} }
      w.__perf.reqs.push({ path: tag ? `${path} ${tag}` : path, start: t0, headers: performance.now() - t0, bodyLen });
      return r;
    };
  }
  const store = w.__ms.store;
  let lastMeta = null;
  w.__perfUnsub = store.subscribe((s) => {
    if (s.meta && s.meta !== lastMeta) { lastMeta = s.meta; w.__perf.frames.push({ at: performance.now(), ms: s.meta.ms, t: s.meta.t }); }
  });
  try {
    const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__perf.long.push(e.duration); });
    po.observe({ type: 'longtask', buffered: false });
    w.__perfPo = po;
  } catch {}
  let last = performance.now();
  const tick = (now) => { w.__perf.gaps.push(now - last); last = now; if (w.__perfOn) requestAnimationFrame(tick); };
  w.__perfOn = true;
  requestAnimationFrame(tick);
});

const segs = [[0, SECONDS], [Math.max(0, dur / 2 - SECONDS / 2), Math.min(dur, dur / 2 + SECONDS / 2)]];
const results = [];
for (const [a] of segs) {
  await S((a) => { const st = window.__ms.store.getState(); st.setTime(a); window.__perf.frames = []; window.__perf.long = []; window.__perf.gaps = []; }, a);
  await win.waitForTimeout(400);
  await S(() => { window.__perf.frames = []; window.__perf.long = []; window.__perf.gaps = []; window.__perf.reqs = []; window.__ms.store.setState({ playing: true }); });
  await win.waitForTimeout(SECONDS * 1000);
  const r = await S(() => {
    window.__ms.store.setState({ playing: false });
    const p = window.__perf;
    const f = p.frames;
    const span = f.length > 1 ? (f[f.length - 1].at - f[0].at) / 1000 : 1;
    const gaps = f.slice(1).map((x, i) => x.at - f[i].at).sort((a, b) => a - b);
    const eng = f.map((x) => x.ms).sort((a, b) => a - b);
    const q = (arr, k) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * k))] : 0;
    const raf = p.gaps.slice().sort((a, b) => a - b);
    const byPath = {};
    for (const r of p.reqs) { const k = r.path.startsWith('/frame') ? r.path : r.path.split('/').slice(0, 2).join('/'); (byPath[k] ||= []).push(r.headers); }
    const reqs = Object.fromEntries(Object.entries(byPath).map(([k, v]) => [k, `${v.length}× p50 ${v.sort((a, b) => a - b)[Math.floor(v.length / 2)].toFixed(0)}ms max ${Math.max(...v).toFixed(0)}`]));
    const fr = p.reqs.filter((r) => r.path.startsWith('/frame') && !/thumb/.test(r.path)).sort((a, b) => a.start - b.start);
    const frameBody = fr[0]?.bodyLen || 0;
    const idle = fr.slice(1).map((r, i) => r.start - (fr[i].start + fr[i].headers)).sort((a, b) => a - b);
    return {
      fps: (f.length - 1) / span, frames: f.length,
      gapP50: q(gaps, 0.5), gapP90: q(gaps, 0.9), gapMax: gaps[gaps.length - 1] || 0,
      engP50: q(eng, 0.5), engP90: q(eng, 0.9),
      longN: p.long.length, longTotal: p.long.reduce((a, b) => a + b, 0), longMax: Math.max(0, ...p.long),
      reqs, frameBody, idleP50: q(idle, 0.5), idleP90: q(idle, 0.9),
      rafP50: q(raf, 0.5), rafP90: q(raf, 0.9), rafMax: raf[raf.length - 1] || 0,
    };
  });
  results.push(r);
  console.log(`  t ${a.toFixed(1)}–${(a + SECONDS).toFixed(1)}s: preview ${r.fps.toFixed(1)} fps (${r.frames} frames) · frame gap p50 ${r.gapP50.toFixed(0)} / p90 ${r.gapP90.toFixed(0)} / max ${r.gapMax.toFixed(0)} ms · engine p50 ${r.engP50.toFixed(0)} / p90 ${r.engP90.toFixed(0)} ms`);
  console.log(`      requests: ${JSON.stringify(r.reqs)} · /frame body ${(r.frameBody / 1024).toFixed(0)} KB · engine idle between frames p50 ${r.idleP50.toFixed(0)} / p90 ${r.idleP90.toFixed(0)} ms`);
  console.log(`      UI: rAF p50 ${r.rafP50.toFixed(0)} / p90 ${r.rafP90.toFixed(0)} / max ${r.rafMax.toFixed(0)} ms · long tasks ${r.longN} (${r.longTotal.toFixed(0)} ms, max ${r.longMax.toFixed(0)})`);
}

// leak guard: scrub + edit for a while, engine memory must not keep growing
let mem1 = null;
if (pid) {
  for (let i = 0; i < 120; i++) {
    await S(([i, dur]) => {
      const st = window.__ms.store.getState();
      const c = st.project.clips[i % st.project.clips.length];
      st.setTime((i * 0.37) % dur);
      window.__ms.store.setState({ project: { ...st.project, clips: st.project.clips.map((x) => x === c ? { ...x, transform: { ...x.transform, x: (x.transform?.x || 0) + 0.001 } } : x) } });
    }, [i, dur]);
    await win.waitForTimeout(40);
  }
  await win.waitForTimeout(800);
  mem1 = footprint(pid);
}
if (mem0 != null && mem1 != null) {
  console.log(`· engine memory: ${mem0.toFixed(0)} MB after warm-up → ${mem1.toFixed(0)} MB after 120 edits + scrubs`);
  check(mem1 - mem0 < 150, `engine memory stays flat while editing (+${(mem1 - mem0).toFixed(0)} MB, limit 150)`);
}
if (MIN_FPS) for (const r of results) check(r.fps >= MIN_FPS, `preview ≥ ${MIN_FPS} fps while playing (${r.fps.toFixed(1)})`);
check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
await app.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
