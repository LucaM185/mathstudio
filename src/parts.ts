// Group clips on the timeline: the structure of a clip's mobject (its submobjects, nested) and
// the per-part timing stored in Clip.parts. The engine (studio_runtime.Clip.set_parts) plays the
// same rules: a part's missing fields come from its nearest overridden ancestor, then the clip.
import { useEffect, useState } from 'react';
import type { AnimSpec, Clip, PartNode, PartSpec } from './types';
import { useStore } from './store';
import { base } from './engine';
import { thumbKey } from './clipThumbs';
import { globalsFor } from './globals';
import { round } from './ops';

// ------------------------------------------------------------------ structure (from the engine)
type Entry = { tree: PartNode | null; error: string | null };
const cache = new Map<string, Entry>();
const lastGood = new Map<string, PartNode>();
const listeners = new Set<() => void>();
let queue: Promise<void> = Promise.resolve();

function request(key: string, c: Clip) {
  const entry: Entry = { tree: null, error: null };
  cache.set(key, entry);
  const gl = globalsFor(c, useStore.getState().project.globals).map((g) => ({ name: g.name, type: g.type, value: g.value }));
  queue = queue.then(async () => {
    try {
      const r = await fetch(`${base()}/clip-parts`, {
        method: 'POST',
        body: JSON.stringify({ clip: { item: c.item, params: c.params, code: c.code || null, dynamic: c.dynamic }, globals: gl }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.tree) entry.error = j.error || `HTTP ${r.status}`;
      else entry.tree = j.tree;
    } catch (e: any) {
      entry.error = String(e?.message || e);
      cache.delete(key); // engine restarting: try again later
    }
    listeners.forEach((l) => l());
  });
}

/** The clip's submobject tree (null until the engine answered, or when it can't be built). */
export function useClipParts(c: Clip | undefined): PartNode | null {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const port = useStore((s) => s.port);
  const key = c ? thumbKey(c) : '';
  useEffect(() => {
    if (!c || !port || cache.has(key)) return;
    const t = setTimeout(() => request(key, c), 300);
    return () => clearTimeout(t);
  }, [key, port]);
  if (!c) return null;
  const e = cache.get(key);
  if (e?.tree) lastGood.set(c.id, e.tree);
  return e?.tree || lastGood.get(c.id) || null;
}

/** Trees for many clips at once (the timeline needs every clip's to lay out its rows). */
export function useClipPartsMap(clips: Clip[]): Record<string, PartNode | null> {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const port = useStore((s) => s.port);
  const keys = clips.map((c) => thumbKey(c));
  const sig = keys.join('\n');
  useEffect(() => {
    if (!port) return;
    const t = setTimeout(() => clips.forEach((c, i) => !cache.has(keys[i]) && request(keys[i], c)), 300);
    return () => clearTimeout(t);
  }, [sig, port]);
  const out: Record<string, PartNode | null> = {};
  clips.forEach((c, i) => {
    const tree = cache.get(keys[i])?.tree;
    if (tree) lastGood.set(c.id, tree);
    out[c.id] = tree || lastGood.get(c.id) || null;
  });
  return out;
}

/** Synchronous lookup (for menus / agent tools): the last tree seen for this clip. */
export function cachedParts(c: Clip): PartNode | null {
  return cache.get(thumbKey(c))?.tree || lastGood.get(c.id) || null;
}

/** Fetch (or reuse) the tree without a component (agent tools). */
export async function loadClipParts(c: Clip): Promise<PartNode | null> {
  const key = thumbKey(c);
  if (!cache.has(key)) request(key, c);
  await queue;
  return cache.get(key)?.tree || null;
}

/** A clip is a group worth expanding when its mobject has more than one part to time. */
export const isGroupTree = (t: PartNode | null) => !!t && !!t.children && (t.children.length > 1 || (t.children.length === 1 && !!t.children[0].children?.length));

export function findNode(t: PartNode | null, path: string): PartNode | null {
  if (!t) return null;
  if (t.path === path) return t;
  for (const ch of t.children || []) {
    if (path === ch.path || path.startsWith(ch.path + '.')) return findNode(ch, path);
  }
  return null;
}

export const partName = (n: PartNode) => (n.label ? `${n.label}` : `${n.type} ${n.path.split('.').pop()}`);

// ------------------------------------------------------------------ timing
export const PART_PATH = /^\d+(\.\d+)*$/;
const NONE: AnimSpec = { type: 'none', duration: 0, rate: 'smooth' };
const isMorphExit = (c: Clip) => c.exit.type === 'TransformInto' || c.exit.type === 'TransformMatching';

/** Ancestors of a path, outermost first, plus the path itself: "1.0.2" -> ["1", "1.0", "1.0.2"]. */
export function pathChain(path: string): string[] {
  const segs = path.split('.');
  return segs.map((_, i) => segs.slice(0, i + 1).join('.'));
}

export const parentPath = (path: string) => (path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : '');

const TIMING_KEYS = ['at', 'until', 'enter', 'exit'] as const;
/** the spec changes when / how the part plays (not only where it is) */
export const hasTiming = (s: PartSpec | undefined) => !!s && TIMING_KEYS.some((k) => s[k] !== undefined && s[k] !== null);
/** the spec moves the part */
export const hasOffset = (s: PartSpec | undefined) => !!s && (!!s.dx || !!s.dy);
/** paths with their own timing (position-only entries left out) */
export const timedParts = (c: Clip) => Object.keys(c.parts || {}).filter((p) => hasTiming(c.parts![p]));

/** Where a part is drawn relative to where the clip's code puts it: its own offset plus its groups'. */
export function partOffset(c: Clip, path: string): { dx: number; dy: number } {
  let dx = 0, dy = 0;
  if (!path) return { dx, dy };
  for (const p of pathChain(path)) {
    const s = c.parts?.[p];
    if (s) { dx += s.dx || 0; dy += s.dy || 0; }
  }
  return { dx, dy };
}

/** The part's box in the clip's own coordinates, moved parts included. */
export function partBox(c: Clip, node: PartNode): [number, number, number, number] {
  const { dx, dy } = partOffset(c, node.path);
  const [x0, y0, x1, y1] = node.bbox;
  return [x0 + dx, y0 + dy, x1 + dx, y1 + dy];
}

/**
 * The part under a point given in the clip's own coordinates: among the children of `parent`
 * ("" = the clip's top-level parts), the smallest box containing it (slack = tolerance in clip units).
 */
export function partAt(c: Clip, tree: PartNode | null, parent: string, x: number, y: number, slack = 0): PartNode | null {
  const node = findNode(tree, parent);
  let best: PartNode | null = null;
  let bestArea = Infinity;
  for (const ch of node?.children || []) {
    const [x0, y0, x1, y1] = partBox(c, ch);
    // an empty part (a point, an invisible layout frame bigger than everything) is not something to grab
    if (x1 - x0 < 1e-6 && y1 - y0 < 1e-6) continue;
    if (x < x0 - slack || x > x1 + slack || y < y0 - slack || y > y1 + slack) continue;
    const area = Math.max(x1 - x0, 1e-3) * Math.max(y1 - y0, 1e-3);
    if (area < bestArea) { best = ch; bestArea = area; }
  }
  return best;
}

export interface PartTiming {
  /** clip-local seconds */
  at: number;
  until: number;
  enter: AnimSpec;
  exit: AnimSpec;
  /** this part has its own entry in clip.parts */
  own: boolean;
  /** some ancestor part (or the part itself) changes the clip's timing */
  custom: boolean;
}

/** Effective timing of a part (path "" = the whole clip), exactly as the engine plays it. */
export function partTiming(c: Clip, path: string): PartTiming {
  const parts = c.parts || {};
  const spec: PartSpec = {};
  let custom = false;
  if (path) {
    for (const p of pathChain(path)) {
      const s = parts[p];
      if (!hasTiming(s)) continue;
      custom = true;
      for (const k of ['at', 'until', 'enter', 'exit'] as const) if (s[k] !== undefined && s[k] !== null) (spec as any)[k] = s[k];
    }
  }
  const at = Math.min(Math.max(spec.at ?? 0, 0), c.duration);
  const until = Math.min(Math.max(spec.until ?? c.duration, at), c.duration);
  const enter = spec.enter ?? c.enter;
  let exit = spec.exit ?? c.exit;
  if (!spec.exit && isMorphExit(c)) exit = path ? NONE : c.exit;
  if (exit.type === 'TransformInto' || exit.type === 'TransformMatching') exit = path ? NONE : exit;
  return { at, until, enter, exit, own: hasTiming(parts[path]), custom };
}

/** Enter / exit windows of a timing, scaled down like the engine does when they overflow it. */
export function partWindows(tm: PartTiming): [number, number] {
  const span = tm.until - tm.at;
  const ed = tm.enter.type !== 'none' ? tm.enter.duration : 0;
  const xd = tm.exit.type !== 'none' ? tm.exit.duration : 0;
  const f = ed + xd > span && ed + xd > 0 ? span / (ed + xd) : 1;
  return [ed * f, xd * f];
}

const clean = (s: PartSpec): PartSpec | null => {
  const out: PartSpec = {};
  if (s.at !== undefined && s.at !== null) out.at = round(s.at, 3);
  if (s.until !== undefined && s.until !== null) out.until = round(s.until, 3);
  if (s.enter) out.enter = s.enter;
  if (s.exit) out.exit = s.exit;
  if (s.dx && Math.abs(s.dx) > 1e-6) out.dx = round(s.dx, 4);
  if (s.dy && Math.abs(s.dy) > 1e-6) out.dy = round(s.dy, 4);
  return Object.keys(out).length ? out : null;
};

/** Merge `patch` into the part's own spec (inside a commit). undefined fields in patch are left alone; null removes. */
export function setPart(c: Clip, path: string, patch: { [K in keyof PartSpec]?: PartSpec[K] | null }) {
  if (!PART_PATH.test(path)) return;
  const parts = { ...(c.parts || {}) };
  const cur: any = { ...(parts[path] || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete cur[k];
    else cur[k] = v;
  }
  const s = clean(cur);
  if (s) parts[path] = s;
  else delete parts[path];
  c.parts = Object.keys(parts).length ? parts : undefined;
  if (!c.parts) delete c.parts;
}

/**
 * Remove the part's own timing (and, with `deep`, every part inside it). `what` = 'position' puts
 * moved parts back instead, 'all' does both.
 */
export function resetPart(c: Clip, path: string, deep = false, what: 'timing' | 'position' | 'all' = 'timing') {
  if (!c.parts) return;
  const parts: Record<string, PartSpec> = {};
  for (const [p, s] of Object.entries(c.parts)) {
    if (!(p === path || (deep && (path === '' || p.startsWith(path + '.'))))) {
      parts[p] = s;
      continue;
    }
    const keep: PartSpec = { ...s };
    if (what !== 'position') for (const k of TIMING_KEYS) delete keep[k];
    if (what !== 'timing') { delete keep.dx; delete keep.dy; }
    const k = clean(keep);
    if (k) parts[p] = k;
  }
  c.parts = Object.keys(parts).length ? parts : undefined;
  if (!c.parts) delete c.parts;
}

/** Set how far a part is moved from where the clip's code puts it, in clip units (inside a commit). */
export function movePart(c: Clip, path: string, dx: number, dy: number) {
  setPart(c, path, { dx: Math.abs(dx) < 1e-6 ? null : round(dx, 4), dy: Math.abs(dy) < 1e-6 ? null : round(dy, 4) });
}

/**
 * LaggedStart on the timeline: the children of `path` ("" = the clip's top-level parts) appear one
 * after another, `step` seconds apart, starting where their group starts. Each keeps its own enter
 * animation (the group's / clip's by default).
 */
export function staggerParts(c: Clip, tree: PartNode, path: string, step: number) {
  const node = findNode(tree, path);
  if (!node?.children?.length) return;
  const start = partTiming(c, path).at;
  node.children.forEach((ch, i) => {
    const at = Math.min(c.duration - 0.05, start + i * step);
    const tm = partTiming(c, ch.path);
    setPart(c, ch.path, { at: round(at, 3), until: tm.until > at ? undefined : null });
  });
}

/** Part timing for the two halves of a clip cut at clip-local time u. */
export function cutParts(parts: Clip['parts'], u: number, duration: number): [Clip['parts'], Clip['parts']] {
  if (!parts) return [undefined, undefined];
  const left: Record<string, PartSpec> = {};
  const right: Record<string, PartSpec> = {};
  for (const [p, s] of Object.entries(parts)) {
    const at = s.at ?? 0;
    const until = s.until ?? duration;
    // left half: ends at the cut
    const l: PartSpec = { ...s };
    if (s.until !== undefined) l.until = Math.min(s.until, u);
    if (at >= u) l.at = u; // appears after the cut: not in the left half
    const lc = clean(l);
    if (lc) left[p] = lc;
    // right half: time shifted, already on screen at the cut (no enter animation)
    const r: PartSpec = { ...s };
    if (s.at !== undefined) r.at = Math.max(0, s.at - u);
    if (s.until !== undefined) r.until = Math.max(0, s.until - u);
    if (until <= u) {
      r.at = 0;
      r.until = 0;
    }
    if (at < u && s.enter) r.enter = { ...s.enter, type: 'none' };
    const rc = clean(r);
    if (rc) right[p] = rc;
  }
  return [Object.keys(left).length ? left : undefined, Object.keys(right).length ? right : undefined];
}

/** Trimming the clip's start by `shift` seconds keeps every part where it was in scene time. */
export function shiftParts(parts: Clip['parts'], shift: number): Clip['parts'] {
  if (!parts) return parts;
  const out: Record<string, PartSpec> = {};
  for (const [p, s] of Object.entries(parts)) {
    const n: PartSpec = { ...s };
    if (s.at !== undefined) n.at = round(Math.max(0, s.at - shift), 3);
    if (s.until !== undefined) n.until = round(Math.max(0, s.until - shift), 3);
    out[p] = n;
  }
  return out;
}

// ------------------------------------------------------------------ timeline rows
export interface PartRow {
  node: PartNode;
  depth: number;
  open: boolean;
}

export const openKey = (clip: string, path: string) => (path ? `${clip}|${path}` : clip);

/** Rows shown under an expanded clip: its parts, depth first, nested groups only when opened. */
export function partRows(clipId: string, tree: PartNode | null, open: string[]): PartRow[] {
  if (!tree || !open.includes(clipId)) return [];
  const rows: PartRow[] = [];
  const walk = (n: PartNode, depth: number) => {
    for (const ch of n.children || []) {
      const isOpen = !!ch.children?.length && open.includes(openKey(clipId, ch.path));
      rows.push({ node: ch, depth, open: isOpen });
      if (isOpen) walk(ch, depth + 1);
    }
  };
  walk(tree, 0);
  return rows;
}
