// Pure helpers operating on projects
import type { CamView, Clip, Keyframe, LibraryItem, Project, Track, Transform } from './types';

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9);

export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, z: 0, scale: 1, rotation: 0, rx: 0, ry: 0, opacity: 1 };
export const TKEYS: (keyof Transform)[] = ['x', 'y', 'z', 'scale', 'rotation', 'rx', 'ry', 'opacity'];

export function newProject(): Project {
  return {
    version: 1,
    settings: { name: 'Untitled', duration: 10, fps: 30, background: '#1e1e1e', resolution: [1920, 1080] },
    tracks: [
      { id: uid('t'), name: 'Track 1' },
      { id: uid('t'), name: 'Track 2' },
      { id: uid('t'), name: 'Track 3' },
    ],
    clips: [],
    assets: [],
  };
}

export function normalizeProject(p: any): Project {
  const base = newProject();
  const out: Project = {
    version: 1,
    settings: { ...base.settings, ...(p?.settings || {}) },
    tracks: Array.isArray(p?.tracks) && p.tracks.length ? p.tracks : base.tracks,
    clips: Array.isArray(p?.clips) ? p.clips : [],
    assets: Array.isArray(p?.assets) ? p.assets : [],
  };
  if (Array.isArray(p?.imports) && p.imports.length) out.imports = p.imports;
  if (Array.isArray(p?.globals) && p.globals.length) {
    out.globals = p.globals
      .filter((g: any) => g && typeof g.name === 'string' && g.name)
      .map((g: any) => ({ ...g, id: g.id || uid('g'), type: g.type || 'number' }));
  }
  out.clips = out.clips.map((c: any) => ({
    params: {},
    enter: { type: 'none', duration: 1 },
    exit: { type: 'none', duration: 1 },
    ...c,
    keys: (c.keys || []).map((k: any) => ({ id: k.id || uid('k'), ...k, z: k.z ?? 0 })),
    effects: (c.effects || []).map((e: any) => ({ id: e.id || uid('e'), ...e })),
    transform: { ...DEFAULT_TRANSFORM, ...(c.transform || {}) },
  }));
  const trackIds = new Set(out.tracks.map((t) => t.id));
  out.clips = out.clips.filter((c) => trackIds.has(c.track));
  return out;
}

// ---------------------------------------------------------------- rate functions (mirror manim)
function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}
export function smooth(t: number, inflection = 10) {
  const error = sigmoid(-inflection / 2);
  return Math.min(Math.max((sigmoid(inflection * (t - 0.5)) - error) / (1 - 2 * error), 0), 1);
}
export const RATE_FNS: Record<string, (t: number) => number> = {
  smooth,
  linear: (t) => t,
  rush_into: (t) => 2 * smooth(t / 2),
  rush_from: (t) => 2 * smooth(t / 2 + 0.5) - 1,
  double_smooth: (t) => (t < 0.5 ? 0.5 * smooth(2 * t) : 0.5 * (1 + smooth(2 * t - 1))),
};

// ---------------------------------------------------------------- transforms / keyframes
export function transformAt(c: Clip, u: number): Transform {
  const ks = [...(c.keys || [])].sort((a, b) => a.t - b.t);
  if (!ks.length) return { ...DEFAULT_TRANSFORM, ...c.transform };
  const pick = (k: Keyframe): Transform => ({ x: k.x, y: k.y, z: k.z ?? 0, scale: k.scale, rotation: k.rotation, rx: k.rx ?? 0, ry: k.ry ?? 0, opacity: k.opacity });
  if (u <= ks[0].t) return pick(ks[0]);
  if (u >= ks[ks.length - 1].t) return pick(ks[ks.length - 1]);
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i];
    const b = ks[i + 1];
    if (a.t <= u && u <= b.t) {
      const span = Math.max(b.t - a.t, 1e-9);
      const f = (RATE_FNS[b.ease || 'smooth'] || smooth)((u - a.t) / span);
      const out: any = {};
      for (const k of TKEYS) out[k] = (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * f;
      return out;
    }
  }
  return pick(ks[ks.length - 1]);
}

/** Edit the clip's transform at local time u. With keyframes, edits (or creates) the key at u. */
export function setTransformAt(c: Clip, u: number, patch: Partial<Transform>, fps = 30): void {
  if (!c.keys || c.keys.length === 0) {
    c.transform = { ...c.transform, ...patch };
    return;
  }
  const tol = 0.5 / fps;
  u = Math.min(Math.max(u, 0), c.duration);
  let k = c.keys.find((k) => Math.abs(k.t - u) <= tol);
  if (!k) {
    const cur = transformAt(c, u);
    k = { id: uid('k'), t: round(u, 4), ...cur, ease: 'smooth' };
    c.keys.push(k);
    c.keys.sort((a, b) => a.t - b.t);
  }
  Object.assign(k, patch);
}

export function keyAt(c: Clip, u: number, fps = 30): Keyframe | undefined {
  const tol = 0.5 / fps;
  return (c.keys || []).find((k) => Math.abs(k.t - u) <= tol);
}

export function addKeyAt(c: Clip, u: number, fps = 30) {
  u = Math.min(Math.max(u, 0), c.duration);
  if (keyAt(c, u, fps)) return;
  const cur = transformAt(c, u);
  if (!c.keys.length) {
    // the first keyframe captures the current static transform
    c.keys.push({ id: uid('k'), t: round(u, 4), ...cur, ease: 'smooth' });
  } else {
    c.keys.push({ id: uid('k'), t: round(u, 4), ...cur, ease: 'smooth' });
    c.keys.sort((a, b) => a.t - b.t);
  }
}

export function round(v: number, d = 3) {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

// ---------------------------------------------------------------- tracks & overlap
export function overlaps(a: { start: number; duration: number }, b: { start: number; duration: number }) {
  const eps = 1e-6;
  return a.start < b.start + b.duration - eps && b.start < a.start + a.duration - eps;
}

export function clipsOnTrack(p: Project, trackId: string, exclude?: string) {
  return p.clips.filter((c) => c.track === trackId && c.id !== exclude);
}

export function trackIsFree(p: Project, trackId: string, start: number, duration: number, exclude?: string) {
  return !clipsOnTrack(p, trackId, exclude).some((c) => overlaps(c, { start, duration }));
}

export function insertTrack(p: Project, index: number, name?: string): Track {
  const n = p.tracks.length + 1;
  let label = name || `Track ${n}`;
  const names = new Set(p.tracks.map((t) => t.name));
  let i = n;
  while (names.has(label)) label = `Track ${++i}`;
  const t: Track = { id: uid('t'), name: label };
  p.tracks.splice(Math.max(0, Math.min(index, p.tracks.length)), 0, t);
  return t;
}

/** Find the top-most free track for [start, start+duration); create one at the top if needed. */
export function freeTrackFor(p: Project, start: number, duration: number): string {
  for (const t of p.tracks) {
    if (!t.locked && trackIsFree(p, t.id, start, duration)) return t.id;
  }
  return insertTrack(p, 0).id;
}

/**
 * If the clip overlaps another one on its track, move it just above: onto the track directly in
 * front when that one is free at this time (same z-order as a new track, since nothing on it
 * overlaps in time), otherwise onto a fresh track inserted there.
 */
export function resolveOverlap(p: Project, clipId: string) {
  const c = p.clips.find((c) => c.id === clipId);
  if (!c) return;
  if (trackIsFree(p, c.track, c.start, c.duration, c.id)) return;
  const idx = p.tracks.findIndex((t) => t.id === c.track);
  const above = idx > 0 ? p.tracks[idx - 1] : null;
  if (above && !above.locked && trackIsFree(p, above.id, c.start, c.duration, c.id)) {
    c.track = above.id;
    return;
  }
  const t = insertTrack(p, idx);
  c.track = t.id;
}

/** Ids of the tracks that hold no clip. */
export function emptyTrackIds(p: Project): Set<string> {
  const used = new Set(p.clips.map((c) => c.track));
  return new Set(p.tracks.filter((t) => !used.has(t.id)).map((t) => t.id));
}

/** Drop empty tracks (except `keep`), always leaving at least one track. Returns how many went. */
export function removeEmptyTracks(p: Project, keep: Set<string> = new Set()): number {
  const empty = emptyTrackIds(p);
  const next = p.tracks.filter((t) => !empty.has(t.id) || keep.has(t.id));
  if (!next.length && p.tracks.length) next.push(p.tracks[0]);
  const n = p.tracks.length - next.length;
  if (n) p.tracks = next;
  return n;
}

export function removeEmptyTrailingTracks(p: Project, keep = 3) {
  while (p.tracks.length > keep) {
    const last = p.tracks[p.tracks.length - 1];
    if (p.clips.some((c) => c.track === last.id)) break;
    p.tracks.pop();
  }
}

// ---------------------------------------------------------------- clip creation
export function makeClip(item: LibraryItem, opts: { track: string; start: number; duration?: number; x?: number; y?: number; params?: Record<string, any>; name?: string }, existing: Clip[]): Clip {
  const params: Record<string, any> = {};
  for (const p of item.params) params[p.id] = p.default;
  Object.assign(params, opts.params || {});
  const base = opts.name || item.name;
  let name = base;
  let i = 2;
  const names = new Set(existing.map((c) => c.name));
  while (names.has(name)) name = `${base} ${i++}`;
  const enterType = item.enter || 'FadeIn';
  const enterDur = ['Write', 'DrawBorderThenFill', 'Typewriter'].includes(enterType) ? 1.5 : 1;
  return {
    id: uid('c'),
    name,
    item: item.id,
    track: opts.track,
    start: round(Math.max(0, opts.start), 3),
    duration: opts.duration ?? 4,
    params,
    code: null,
    transform: { ...DEFAULT_TRANSFORM, x: round(opts.x ?? 0, 3), y: round(opts.y ?? 0, 3) },
    keys: [],
    enter: { type: enterType, duration: enterDur, rate: 'smooth' },
    exit: { type: 'FadeOut', duration: 0.6, rate: 'smooth' },
    effects: [],
  };
}

export function projectEnd(p: Project) {
  return Math.max(0, ...p.clips.map((c) => c.start + c.duration));
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}

export function fmtTime(t: number, fps = 30) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s - Math.floor(s)) * fps + 1e-6);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

export const CATEGORY_COLORS: Record<string, string> = {
  Shapes: '#4f8cff',
  'Lines & Arrows': '#2fb7a3',
  'Text & Math': '#e8a33d',
  Graphs: '#9b6cff',
  '3D': '#3fb6e0',
  'AI & ML': '#f2766b',
  Drawings: '#e0598b',
  Media: '#58b368',
  Custom: '#8a8f98',
};

// ---------------------------------------------------------------- camera
export const CAMERA_ID = '__camera__';
/** A camera / editor view: centre (x, y, z), zoom and ManimGL Euler angles in degrees. */
export type Cam = CamView;
export const CAM_KEYS = ['x', 'y', 'z', 'zoom', 'theta', 'phi', 'gamma'] as const;
export const DEFAULT_CAM: Cam = { x: 0, y: 0, z: 0, zoom: 1, theta: 0, phi: 0, gamma: 0 };

export function fullCam(k: Partial<Cam>): Cam {
  return { x: k.x ?? 0, y: k.y ?? 0, z: k.z ?? 0, zoom: k.zoom ?? 1, theta: k.theta ?? 0, phi: k.phi ?? 0, gamma: k.gamma ?? 0 };
}

/** True when the view looks straight down the z axis with no roll, i.e. the classic 2D view. */
export function isFlat(c: Partial<Cam>) {
  const turn = (((c.theta ?? 0) + (c.gamma ?? 0)) % 360 + 360) % 360;
  return Math.abs(c.phi ?? 0) < 1e-6 && (turn < 1e-6 || 360 - turn < 1e-6);
}

export function cameraAt(p: Project, t: number): Cam {
  const ks = [...(p.settings.camera || [])].sort((a, b) => a.t - b.t);
  if (!ks.length) return { ...DEFAULT_CAM };
  if (t <= ks[0].t) return fullCam(ks[0]);
  if (t >= ks[ks.length - 1].t) return fullCam(ks[ks.length - 1]);
  for (let i = 0; i < ks.length - 1; i++) {
    const a = fullCam(ks[i]);
    const b = fullCam(ks[i + 1]);
    if (ks[i].t <= t && t <= ks[i + 1].t) {
      const f = (RATE_FNS[ks[i + 1].ease || 'smooth'] || smooth)((t - ks[i].t) / Math.max(ks[i + 1].t - ks[i].t, 1e-9));
      const out: any = {};
      for (const k of CAM_KEYS) out[k] = a[k] + (b[k] - a[k]) * f;
      return out;
    }
  }
  return fullCam(ks[ks.length - 1]);
}

/** Edit the camera at time t: edits the key at t, or creates one (the first key captures the default view). */
export function setCameraAt(p: Project, t: number, patch: Partial<Cam>, fps = 30) {
  const keys = (p.settings.camera ||= []);
  const tol = 0.5 / fps;
  let k = keys.find((k) => Math.abs(k.t - t) <= tol);
  if (!k) {
    const cur = cameraAt(p, t);
    if (!keys.length && t > tol) {
      // anchor the default view at t=0 so the move is animated
      keys.push({ id: uid('ck'), t: 0, x: 0, y: 0, zoom: 1, ease: 'smooth' });
    }
    k = { id: uid('ck'), t: round(t, 4), ...cur, ease: 'smooth' };
    keys.push(k);
    keys.sort((a, b) => a.t - b.t);
  }
  Object.assign(k, patch);
  if (k.zoom !== undefined) k.zoom = Math.max(0.05, k.zoom);
}

export const FRAME_W = 14.222222222222221;
export const FRAME_H = 8;

/** World-space rectangle the camera sees: [x0, y0, x1, y1]. */
export function camRect(c: { x: number; y: number; zoom: number }): [number, number, number, number] {
  const hw = FRAME_W / 2 / c.zoom;
  const hh = FRAME_H / 2 / c.zoom;
  return [c.x - hw, c.y - hh, c.x + hw, c.y + hh];
}

/**
 * Editor "full scene" view used while setting camera crops: fits the scene frame plus every
 * camera key's crop, with a margin. Independent of time so it stays still while scrubbing.
 */
export function overviewView(p: Project): Cam {
  let [x0, y0, x1, y1] = camRect({ x: 0, y: 0, zoom: 1 });
  for (const k of p.settings.camera || []) {
    const r = camRect(k);
    x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]);
    x1 = Math.max(x1, r[2]); y1 = Math.max(y1, r[3]);
  }
  // a crop that only grazes the scene frame (rounding) shouldn't make the overview refit
  const eps = 0.02;
  if (x0 > -FRAME_W / 2 - eps) x0 = -FRAME_W / 2;
  if (x1 < FRAME_W / 2 + eps) x1 = FRAME_W / 2;
  if (y0 > -FRAME_H / 2 - eps) y0 = -FRAME_H / 2;
  if (y1 < FRAME_H / 2 + eps) y1 = FRAME_H / 2;
  const m = 1.14;
  const zoom = Math.min(FRAME_W / ((x1 - x0) * m), FRAME_H / ((y1 - y0) * m));
  return { ...DEFAULT_CAM, x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom };
}

/**
 * Morph targets continue the object that morphs into them, so they belong on the same track:
 * moves `b` onto `a`'s track when that slot is free (otherwise it stays where it is).
 */
export function joinMorphTrack(p: Project, a: Clip, b: Clip) {
  if (b.track === a.track) return;
  const t = p.tracks.find((t) => t.id === a.track);
  if (!t || t.locked) return;
  if (trackIsFree(p, a.track, b.start, b.duration, b.id)) b.track = a.track;
}

/**
 * A transform (morph) is shown on the timeline as its own clip between the two states. Selecting it
 * puts MORPH_SEL + <id of the clip that morphs> in `selection` (like CAMERA_ID for the camera).
 */
export const MORPH_SEL = '__morph__:';
export const morphSelId = (clipId: string) => MORPH_SEL + clipId;
export const selectedMorph = (sel: string[]) => (sel.length === 1 && sel[0].startsWith(MORPH_SEL) ? sel[0].slice(MORPH_SEL.length) : null);
