import { cutParts, setPart } from './parts';
import { useStore, itemById, revealInspector } from './store';
import { importAsset, renderFrame } from './engine';
import type { Clip, LibraryItem, Project } from './types';
import {
  addKeyAt,
  clone,
  freeTrackFor,
  makeClip,
  newProject,
  normalizeProject,
  resolveOverlap,
  round,
  uid,
  morphSelId,
  selectedMorph,
} from './ops';
import { presetAngles } from './view3d';
import { flushSave } from './autosave';
import { commitVersion, type SavedVersion } from './history';
import { activateSession, docHandle, sessionForPath, setThumb } from './sessions';

const S = () => useStore.getState();

export function addItem(itemId: string, opts: { time?: number; track?: string | null; x?: number; y?: number; params?: Record<string, any>; name?: string } = {}) {
  const item = itemById(itemId);
  if (!item) return null;
  let createdId: string | null = null;
  const start = round(opts.time ?? S().time, 3);
  S().commit((p) => {
    // a mobject made from a project plays its whole timeline by default
    const duration = item.user && item.dynamic && item.duration ? round(Math.max(1, item.duration), 3) : 4;
    let track = opts.track ?? null;
    if (track && p.tracks.find((t) => t.id === track)?.locked) track = null;
    if (!track) track = freeTrackFor(p, start, duration);
    const c = makeClip(item, { track, start, duration, x: opts.x, y: opts.y, params: opts.params, name: opts.name }, p.clips);
    p.clips.push(c);
    resolveOverlap(p, c.id);
    createdId = c.id;
  });
  if (createdId) useStore.setState({ selection: [createdId], selectedKey: null });
  if (createdId && item.category === '3D') tiltCameraFor3D();
  return createdId;
}

/**
 * The first 3D object in a scene with an untouched camera: tilt the camera to ManimGL's usual 3D
 * view, otherwise a sphere renders as a disc. A separate undo step, so ⌘Z gives the flat view back.
 */
export function tiltCameraFor3D() {
  const s = S();
  if ((s.project.settings.camera || []).length) return;
  const v = presetAngles('iso');
  s.commit((p) => {
    p.settings.camera = [{ id: uid('ck'), t: 0, x: 0, y: 0, z: 0, zoom: 1, theta: v.theta, phi: v.phi, gamma: v.gamma, ease: 'smooth' }];
  });
  s.toast('Camera tilted to a 3D view — right-drag or ⌥-drag to orbit, ⌘Z to undo');
}

export async function importFiles(paths: string[], place?: { time?: number; track?: string | null; x?: number; y?: number }) {
  const ids: string[] = [];
  for (const path of paths) {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'heic'].includes(ext)) {
      S().toast(`Unsupported file type: .${ext}`, 'error');
      continue;
    }
    try {
      const res = await importAsset(path);
      const label = path.split('/').pop() || res.name;
      S().commit((p) => {
        if (!p.assets.find((a) => a.name === res.name)) {
          p.assets.push({ id: uid('a'), name: res.name, label, kind: res.kind, width: res.width ?? null, height: res.height ?? null });
        }
      });
      const id = addAsset(res.name, place);
      if (id) ids.push(id);
    } catch (e: any) {
      S().toast(`Could not import ${path.split('/').pop()}: ${e.message || e}`, 'error');
    }
  }
  if (ids.length) useStore.setState({ selection: ids });
  return ids;
}

export function addAsset(name: string, place?: { time?: number; track?: string | null; x?: number; y?: number }) {
  const asset = S().project.assets.find((a) => a.name === name);
  if (!asset) return null;
  const label = asset.label.replace(/\.[^.]+$/, '');
  return addItem(asset.kind === 'svg' ? 'svg' : 'image', { ...place, params: { path: name }, name: label });
}

export function deleteSelection() {
  const { selection, selectedKey, selectedPart } = S();
  if (selectedPart && selection.includes(selectedPart.clip)) {
    // a part of a group: take it out of the scene (its timing collapses), the clip stays
    hidePart(selectedPart.clip, selectedPart.path);
    return;
  }
  const morph = selectedMorph(selection);
  if (morph) {
    removeTransform(morph);
    return;
  }
  if (selection.includes('__camera__')) {
    // delete the camera key at the playhead (or all keys if none there)
    S().commit((p) => {
      const keys = p.settings.camera || [];
      const t = S().time;
      const k = keys.find((k) => Math.abs(k.t - t) < 0.5 / p.settings.fps);
      p.settings.camera = k ? keys.filter((x) => x !== k) : keys;
    });
    return;
  }
  if (selectedKey) {
    S().commit((p) => {
      const c = p.clips.find((c) => c.id === selectedKey.clip);
      if (c) c.keys = c.keys.filter((k) => k.id !== selectedKey.key);
    });
    useStore.setState({ selectedKey: null });
    return;
  }
  if (!selection.length) return;
  const ids = new Set(selection);
  S().commit((p) => {
    p.clips = p.clips.filter((c) => !ids.has(c.id) || p.tracks.find((t) => t.id === c.track)?.locked);
    for (const c of p.clips) {
      if (c.exit.target && ids.has(c.exit.target)) {
        c.exit = { ...c.exit, type: 'FadeOut', target: null };
      }
    }
  });
  useStore.setState({ selection: [] });
}

/** Remove one part of a group clip from the scene (it never appears); undo or "Reset timing" brings it back. */
export function hidePart(clipId: string, path: string) {
  S().commit((p) => {
    const c = p.clips.find((x) => x.id === clipId);
    if (c) setPart(c, path, { at: 0, until: 0 });
  });
  useStore.setState({ selectedPart: null });
  S().toast('Part hidden — right-click it → Reset timing to bring it back', 'info', { label: 'Undo', run: () => S().undo() });
}

export function duplicateSelection() {
  const { selection } = S();
  if (!selection.length) return;
  const newIds: string[] = [];
  S().commit((p) => {
    for (const id of selection) {
      const c = p.clips.find((c) => c.id === id);
      if (!c) continue;
      const d: Clip = clone(c);
      d.id = uid('c');
      d.name = uniqueName(p, c.name);
      d.start = round(c.start + c.duration, 3);
      d.keys = d.keys.map((k) => ({ ...k, id: uid('k') }));
      d.effects = d.effects.map((e) => ({ ...e, id: uid('e') }));
      p.clips.push(d);
      resolveOverlap(p, d.id);
      newIds.push(d.id);
    }
  });
  useStore.setState({ selection: newIds });
}

function uniqueName(p: Project, base: string) {
  const stem = base.replace(/ \d+$/, '');
  const names = new Set(p.clips.map((c) => c.name));
  let i = 2;
  let n = `${stem} ${i}`;
  while (names.has(n)) n = `${stem} ${++i}`;
  return n;
}

/** True when `time` is far enough inside the clip to cut it into two usable pieces. */
export const canCutAt = (c: Clip, time: number) => c.start + 0.05 < time && time < c.start + c.duration - 0.05;

/** Clips on unlocked tracks that can be cut at `time`. */
export function clipsCuttableAt(time: number, p: Project = S().project) {
  const locked = new Set(p.tracks.filter((t) => t.locked).map((t) => t.id));
  return p.clips.filter((c) => !locked.has(c.track) && canCutAt(c, time));
}

/**
 * Blade (Final Cut Pro style): ⌘B cuts the selected clips at the playhead, or every clip under it when
 * nothing is selected; ⇧⌘B ("Blade All") cuts every clip under the playhead regardless of selection.
 */
export function splitAtPlayhead(all = false) {
  const { selection, time } = S();
  const under = clipsCuttableAt(time).map((c) => c.id);
  const targets = !all && selection.length ? under.filter((id) => selection.includes(id)) : under;
  splitClipsAt(targets, time);
}

/** Cut each of `ids` into two clips at scene time `time` (one undo step). Returns the new right-hand clip ids. */
export function splitClipsAt(ids: string[], time: number) {
  const targets = clipsCuttableAt(time).filter((c) => ids.includes(c.id)).map((c) => c.id);
  const created: string[] = [];
  if (!targets.length) return created;
  S().commit((p) => {
    for (const id of targets) {
      const c = p.clips.find((c) => c.id === id);
      if (!c || !canCutAt(c, time)) continue;
      created.push(cutClip(p, c, time).id);
    }
  });
  if (created.length) S().toast(`Bladed ${created.length} clip${created.length > 1 ? 's' : ''}`);
  return created;
}

/** Cut `c` at scene time `time` inside a commit: `c` keeps the left part, the returned clip is the right part. */
function cutClip(p: Project, c: Clip, time: number): Clip {
  const u = time - c.start;
  const right: Clip = clone(c);
  right.id = uid('c');
  right.name = uniqueName(p, c.name);
  right.start = round(time, 3);
  right.duration = round(c.duration - u, 3);
  right.enter = { ...right.enter, type: 'none' };
  right.keys = c.keys.filter((k) => k.t >= u).map((k) => ({ ...k, id: uid('k'), t: round(k.t - u, 4) }));
  right.effects = c.effects.filter((e) => e.at >= u).map((e) => ({ ...e, id: uid('e'), at: round(e.at - u, 3) }));
  if (c.keys.length) {
    // keep the transform continuous across the cut
    const tmp = clone(c);
    addKeyAt(tmp, u);
    const kk = tmp.keys.find((k) => Math.abs(k.t - u) < 1e-3)!;
    if (!right.keys.find((k) => k.t === 0)) right.keys.unshift({ ...kk, id: uid('k'), t: 0 });
    c.keys = c.keys.filter((k) => k.t <= u);
    if (!c.keys.find((k) => Math.abs(k.t - u) < 1e-3)) c.keys.push({ ...kk, id: uid('k') });
  }
  // group part timing: each half keeps the parts' scene times
  const [lp, rp] = cutParts(c.parts, u, c.duration);
  if (lp) c.parts = lp;
  else delete c.parts;
  if (rp) right.parts = rp;
  else delete right.parts;
  c.duration = round(u, 3);
  c.exit = { ...c.exit, type: 'none', target: null };
  c.effects = c.effects.filter((e) => e.at < u);
  p.clips.push(right);
  return right;
}

export const TRANSFORM_DURATION = 1;

/**
 * Where "Add transform" at scene time `time` would put the morph on clip `c`, or null if it can't.
 * The morph starts at `time` (after the enter animation), lasts up to TRANSFORM_DURATION and is
 * followed by the new state; when the clip ends too soon it is lengthened into free track space.
 */
export function transformPlan(c: Clip, time: number, p: Project = S().project) {
  if (p.tracks.find((t) => t.id === c.track)?.locked || time < c.start - 1e-6) return null;
  const end = c.start + c.duration;
  const ed = c.enter.type !== 'none' ? Math.min(c.enter.duration, c.duration) : 0;
  const t = round(Math.max(time, c.start + ed + 0.05), 3);
  // a clip that already morphs into another one must keep its end where that one starts
  const chained = (c.exit.type === 'TransformInto' || c.exit.type === 'TransformMatching') && !!c.exit.target;
  const next = Math.min(Infinity, ...p.clips.filter((o) => o.id !== c.id && o.track === c.track && o.start >= end - 1e-6).map((o) => o.start));
  const limit = chained ? end : next;
  const want = t + TRANSFORM_DURATION + 1; // the morph plus a second of the new state
  const newEnd = round(end - t >= TRANSFORM_DURATION + 0.3 ? end : Math.max(end, Math.min(limit, want)), 3);
  const room = newEnd - t;
  if (room < 0.25) return null;
  const duration = round(room >= TRANSFORM_DURATION + 0.3 ? TRANSFORM_DURATION : room * 0.6, 2);
  return { t, duration, cut: round(t + duration, 3), end: newEnd };
}

/**
 * Right-click → "Add transform here": the element changes into a new version of itself at scene
 * time `time`. The clip is cut where the morph finishes; the first part's exit becomes
 * TransformInto the second part, a copy the user then moves / restyles to say what it turns into.
 * Returns the new clip's id (selected, with the playhead parked just after the morph).
 */
export function addTransformAt(clipId: string, time: number) {
  const st = S();
  const c0 = st.project.clips.find((c) => c.id === clipId);
  const plan = c0 && transformPlan(c0, time);
  if (!c0 || !plan) {
    st.toast(c0 ? 'Not enough room on this track for a transform here' : 'No clip to transform', 'error');
    return null;
  }
  let created: string | null = null;
  st.commit((p) => {
    const c = p.clips.find((x) => x.id === clipId);
    if (!c) return;
    c.duration = round(plan.end - c.start, 3);
    if (plan.end > p.settings.duration) p.settings.duration = round(Math.ceil(plan.end * 2) / 2, 2);
    const b = cutClip(p, c, plan.cut);
    c.exit = { type: 'TransformInto', duration: plan.duration, rate: 'smooth', target: b.id };
    created = b.id;
  });
  if (!created) return null;
  const b = S().project.clips.find((x) => x.id === created)!;
  useStore.setState({ selection: [created], selectedKey: null, playing: false });
  S().setTime(plan.cut);
  revealInspector(created, 'params');
  S().toast(`Transform added at ${plan.t.toFixed(2)}s — move or edit “${b.name}” to set what it becomes`, 'success');
  return created;
}

/** Select the transform (morph) of clip `clipId` — the middle clip between its two states. */
export function selectTransform(clipId: string) {
  useStore.setState({ selection: [morphSelId(clipId)], selectedKey: null, selectedPart: null, rightTab: 'inspector' });
}

/**
 * Delete the transform between `clipId` and the clip it morphs into: the first state now stays on
 * screen until the second one starts (a straight cut). Both clips are kept.
 */
export function removeTransform(clipId: string) {
  const c0 = S().project.clips.find((c) => c.id === clipId);
  if (!c0 || !c0.exit.target) return;
  const b = S().project.clips.find((c) => c.id === c0.exit.target);
  S().commit((p) => {
    const c = p.clips.find((x) => x.id === clipId);
    if (c) c.exit = { ...c.exit, type: 'none', target: null };
  });
  useStore.setState({ selection: [clipId] });
  S().toast(`Transform removed — “${c0.name}” now cuts straight to “${b?.name ?? 'the next clip'}”`);
}

let clipboard: Clip[] = [];
export function copySelection() {
  const { selection, project } = S();
  clipboard = project.clips.filter((c) => selection.includes(c.id)).map((c) => clone(c));
  if (clipboard.length) S().toast(`Copied ${clipboard.length} clip${clipboard.length > 1 ? 's' : ''}`);
}
export function pasteClipboard() {
  if (!clipboard.length) return;
  const t0 = Math.min(...clipboard.map((c) => c.start));
  const time = S().time;
  const ids: string[] = [];
  S().commit((p) => {
    for (const src of clipboard) {
      const c: Clip = clone(src);
      c.id = uid('c');
      c.name = uniqueName(p, src.name);
      c.start = round(time + (src.start - t0), 3);
      if (!p.tracks.find((t) => t.id === c.track)) c.track = p.tracks[0].id;
      c.exit = c.exit.target ? { ...c.exit, type: 'FadeOut', target: null } : c.exit;
      p.clips.push(c);
      resolveOverlap(p, c.id);
      ids.push(c.id);
    }
  });
  useStore.setState({ selection: ids });
}

// --------------------------------------------------------------------- files
export async function saveProject(saveAs = false) {
  // ⌘S: projects save themselves, but this writes right away (and gives an empty project a file)
  // ⌘S also records a version (git-like commit + small GIF), see Projects → ⋯ → See history
  if (!saveAs && (await window.studio.autosaveEnabled())) {
    const ok = await flushSave(true);
    const p = S().filePath;
    if (ok && p) {
      const v = await commitVersion();
      S().toast(savedText(v, p), 'success');
      refreshProjectThumb(p, S().project);
    }
    return ok ? p : null;
  }
  await flushSave();
  const { project, filePath } = S();
  const p = await window.studio.saveProject(filePath, project, saveAs);
  if (p) {
    S().markSaved(p);
    const name = p.split('/').pop()!.replace(/\.mstudio$/, '');
    if (project.settings.name === 'Untitled') {
      S().commit((pr) => {
        pr.settings.name = name;
      }, { transient: true });
      S().markSaved(p);
    }
    const v = await commitVersion();
    S().toast(savedText(v, p), 'success');
    refreshProjectThumb(p, S().project);
  }
  return p;
}

function savedText(v: SavedVersion | null, p: string) {
  if (!v) return `Saved to ${tildify(p)}`;
  if (v.unchanged) return `Saved · no changes since v${v.version}`;
  return `Saved v${v.version} · ${v.commit.message}`;
}

export function tildify(p: string) {
  const m = p.match(/^\/Users\/[^/]+/);
  return m ? '~' + p.slice(m[0].length) : p;
}

// --------------------------------------------------------------------- projects browser
/** A representative moment for a project's thumbnail: when the most clips are on screen. */
export function thumbTime(p: Project) {
  let best = Math.min(1, p.settings.duration / 2);
  let bestN = -1;
  for (const c of p.clips) {
    const t = c.start + Math.min((c.enter?.duration ?? 1) + 0.25, c.duration * 0.6);
    const n = p.clips.filter((d) => d.start <= t && t < d.start + d.duration).length;
    if (n > bestN) { bestN = n; best = t; }
  }
  return round(Math.max(0, Math.min(best, p.settings.duration - 0.01)), 3);
}

/** Render a small preview frame of `project` and cache it as the thumbnail of the file at `path`. */
export async function refreshProjectThumb(path: string, project: Project) {
  try {
    if (S().engineStatus !== 'ready') return null;
    const { png } = await renderFrame(project, thumbTime(project), 384, 216);
    if (png) {
      setThumb(path, png);
      await window.studio.projects.saveThumb(path, png);
    }
    return png || null;
  } catch (e) {
    return null;
  }
}

/**
 * Switch to the project file at `path`. A project that is still open (e.g. an agent is working on
 * it) comes back instantly with its chat and undo history; otherwise the file is read. Returns true
 * when the switch happened.
 */
export async function switchToProject(path: string, opts: { quiet?: boolean } = {}) {
  const { filePath } = S();
  if (filePath === path) return true;
  const open = sessionForPath(path);
  if (open) return switchToSession(open);
  if (!(await confirmSwitch())) return false;
  try {
    const r = await window.studio.readProject(path);
    S().loadProject(normalizeProject(r.data), r.path);
    if (!opts.quiet) S().toast(`Opened ${r.path.split('/').pop()}`);
    return true;
  } catch (e: any) {
    S().toast(`Could not open project: ${e.message || e}`, 'error');
    return false;
  }
}

/**
 * Quick switch to an open project. Nothing is waited for: the project being left keeps saving
 * itself (and its agent keeps working) in the background.
 */
export function switchToSession(sid: string) {
  const left = S().sessionId;
  if (left === sid) return true;
  if (!activateSession(sid)) return false;
  flushSave(false, left).then(() => {
    const d = docHandle(left);
    if (!d.alive()) return;
    const { filePath, project } = d.get();
    if (filePath && project.clips.length) refreshProjectThumb(filePath, project);
  });
  return true;
}

/** New empty project from the projects browser (same unsaved-changes handling as switching). */
export async function newProjectFromBrowser() {
  if (!(await confirmSwitch())) return false;
  S().loadProject(newProject(), null);
  return true;
}

/**
 * Before leaving the open project: write it to disk (no "Save changes?" prompt — projects save
 * themselves). Only if that write fails is the user asked whether to leave anyway.
 */
async function leaveCurrent() {
  const ok = await flushSave();
  const { project, filePath, dirty } = S();
  if (!ok && dirty && project.clips.length) {
    const r = await window.studio.confirm(`“${project.settings.name}” could not be saved.`, 'Leave it anyway? Your latest changes will be lost.', ['Leave Anyway', 'Cancel']);
    return r === 0;
  }
  if (filePath && project.clips.length) refreshProjectThumb(filePath, project);
  return true;
}
const confirmSwitch = leaveCurrent;
const confirmDiscard = leaveCurrent;

export async function openProject() {
  if (!(await confirmDiscard())) return;
  const r = await window.studio.openProject();
  if (!r) return;
  const open = sessionForPath(r.path);
  if (open) return void switchToSession(open);
  try {
    S().loadProject(normalizeProject(r.data), r.path);
    S().toast(`Opened ${r.path.split('/').pop()}`);
  } catch (e: any) {
    S().toast(`Could not open project: ${e.message}`, 'error');
  }
}

export async function newProjectAction() {
  if (!(await confirmDiscard())) return;
  S().loadProject(newProject(), null);
}

export function selectedClips(): Clip[] {
  const { selection, project } = S();
  return project.clips.filter((c) => selection.includes(c.id));
}

export function itemFor(c: Clip): LibraryItem | undefined {
  return itemById(c.item);
}

// --------------------------------------------------------------------- example project
export async function loadExample() {
  if (!(await confirmDiscard())) return;
  const lib = S().library;
  if (!lib) return;
  const p = newProject();
  p.settings.name = 'Pythagoras';
  p.settings.duration = 14;
  p.tracks = [
    { id: uid('t'), name: 'Titles' },
    { id: uid('t'), name: 'Math' },
    { id: uid('t'), name: 'Figures' },
    { id: uid('t'), name: 'Background' },
  ];
  const [titles, math, figs, bg] = p.tracks.map((t) => t.id);
  const add = (item: string, o: any, patch: Partial<Clip> = {}) => {
    const it = lib.items.find((i) => i.id === item)!;
    const c = makeClip(it, { track: o.track, start: o.start, duration: o.duration, x: o.x, y: o.y, params: o.params, name: o.name }, p.clips);
    Object.assign(c, patch);
    p.clips.push(c);
    return c;
  };
  add('number_plane', { track: bg, start: 0, duration: 14, params: { opacity: 0.25 } }, { exit: { type: 'none', duration: 1 }, enter: { type: 'FadeIn', duration: 1.5, rate: 'smooth' } });
  add('title', { track: titles, start: 0, duration: 4, y: 3, params: { text: 'The Pythagorean Theorem', font_size: 56 } });
  add('custom', { track: figs, start: 0.8, duration: 7.2, x: -3.2, y: -0.4, name: 'Right triangle' }, {
    code: `a, b = 2.4, 1.8
tri = Polygon(ORIGIN, RIGHT * a, UP * b, fill_color=BLUE, fill_opacity=0.35, stroke_color=BLUE)
sq_a = Square(side_length=a, fill_color=YELLOW, fill_opacity=0.25, stroke_color=YELLOW).next_to(tri, DOWN, buff=0).align_to(tri, LEFT)
sq_b = Square(side_length=b, fill_color=GREEN, fill_opacity=0.25, stroke_color=GREEN).next_to(tri, LEFT, buff=0).align_to(tri, DOWN)
labels = VGroup(Tex("a", fill_color=YELLOW).next_to(sq_a, DOWN), Tex("b", fill_color=GREEN).next_to(sq_b, LEFT))
return VGroup(sq_a, sq_b, tri, labels)`,
    enter: { type: 'DrawBorderThenFill', duration: 2, rate: 'smooth' },
  });
  const eq1 = add('tex', { track: math, start: 2.5, duration: 3, x: 3, y: 0.5, params: { tex: 'a^2 + b^2', font_size: 80 } });
  const eq2 = add('tex', { track: math, start: 5.5, duration: 5.5, x: 3, y: 0.5, params: { tex: 'a^2 + b^2 = c^2', font_size: 80 } });
  eq1.exit = { type: 'TransformMatching', duration: 1.2, rate: 'smooth', target: eq2.id };
  eq2.enter = { type: 'none', duration: 1, rate: 'smooth' };
  eq2.effects = [{ id: uid('e'), type: 'FlashAround', at: 1.2, duration: 1.2, rate: 'smooth' }];
  add('axes_graph', { track: figs, start: 8, duration: 6, x: -3.2, y: -0.2, params: { f: 'np.sqrt(9 + x**2)', ymin: 0, ymax: 6, xmin: -4, xmax: 4, width: 6.5, height: 5, curve: '#FFFF00' } }, {
    enter: { type: 'ShowCreation', duration: 2, rate: 'smooth' },
  });
  add('custom_dynamic', { track: math, start: 11, duration: 3, x: 4.6, y: 2.2, name: 'Orbit' }, { transform: { x: 4.6, y: 2.2, z: 0, scale: 0.5, rotation: 0, opacity: 1 } });
  add('tex', { track: titles, start: 9.5, duration: 4.5, x: 3.4, y: -1.4, name: 'Hypotenuse', params: { tex: 'c = \\sqrt{a^2 + b^2}', font_size: 60, fill: '#FFFF00' } });
  p.settings.camera = [
    { id: uid('ck'), t: 5.6, x: 0, y: 0, zoom: 1, ease: 'smooth' },
    { id: uid('ck'), t: 6.8, x: 3, y: 0.5, zoom: 1.8, ease: 'smooth' },
    { id: uid('ck'), t: 7.6, x: 3, y: 0.5, zoom: 1.8, ease: 'smooth' },
    { id: uid('ck'), t: 8.6, x: 0, y: 0, zoom: 1, ease: 'smooth' },
  ];
  S().loadProject(p, null);
  useStore.setState({ dirty: true }); // a fresh copy: autosave gives it its own file
  S().toast('Loaded the example project — press Space to play');
}
