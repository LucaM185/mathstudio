// Rendered previews of each clip's mobject (timeline + inspector).
import { useEffect, useState } from 'react';
import type { Clip, GlobalVar } from './types';
import { useStore } from './store';
import { globalsFor } from './globals';
import { base } from './engine';

type Entry = { url: string | null; error: string | null; promise?: Promise<void>; w?: number; h?: number; runs?: number[] };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
const lastGood = new Map<string, string>(); // clip id -> last successful url (shown while a new one renders)
const lastStrip = new Map<string, { url: string; n: number; w: number; h: number; t0: number; t1: number; runs?: number[] }>();

const usedGlobals = (c: Pick<Clip, 'params' | 'code'>) =>
  globalsFor(c, useStore.getState().project.globals).map((g: GlobalVar) => ({ name: g.name, type: g.type, value: g.value }));

export function thumbKey(c: Pick<Clip, 'item' | 'params' | 'code' | 'dynamic'>) {
  const gl = usedGlobals(c);
  return JSON.stringify([c.item, c.params, c.code || null, c.dynamic ?? null, ...(gl.length ? [gl] : [])]);
}

// one request at a time keeps the render engine free for the preview
let queue: Promise<void> = Promise.resolve();

/**
 * Groups a sprite's frames into runs that look the same (each frame compared with the first frame of
 * its run, so a slow drift still starts a new run). runs[i] = index of the frame that starts i's run.
 */
function frameRuns(bmp: ImageBitmap, n: number): number[] | undefined {
  try {
    const fw = Math.floor(bmp.width / n), H = bmp.height;
    if (fw < 1 || n < 2) return undefined;
    const cv = new OffscreenCanvas(bmp.width, H);
    const g = cv.getContext('2d', { willReadFrequently: true });
    if (!g) return undefined;
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, bmp.width, H).data;
    const differs = (a: number, b: number) => {
      let cover = 0, changed = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < fw; x++) {
          const i = (y * bmp.width + a * fw + x) * 4, j = (y * bmp.width + b * fw + x) * 4;
          const aa = px[i + 3], ab = px[j + 3];
          if (aa < 24 && ab < 24) continue;
          cover++;
          if (Math.abs(aa - ab) > 48 || Math.max(Math.abs(px[i] - px[j]), Math.abs(px[i + 1] - px[j + 1]), Math.abs(px[i + 2] - px[j + 2])) > 48) changed++;
        }
      }
      return cover > 0 && changed / cover > 0.04;
    };
    const runs = [0];
    for (let i = 1; i < n; i++) runs.push(differs(runs[i - 1], i) ? i : runs[i - 1]);
    return runs;
  } catch {
    return undefined; // no canvas: every frame is shown
  }
}

/** Resolves once playback stops: thumbnails / filmstrips never compete with the playing preview. */
const whenNotPlaying = () =>
  new Promise<void>((resolve) => {
    if (!useStore.getState().playing) return resolve();
    const unsub = useStore.subscribe((s) => {
      if (!s.playing) {
        unsub();
        resolve();
      }
    });
  });

/**
 * Every edit of a clip's look makes a new key (a slider drag: dozens), each with its own blob URL.
 * Keep the most recent MAX_ENTRIES and free the image data of older ones, unless a clip still
 * shows that image (lastGood / lastStrip hold what is on screen while a newer one renders).
 */
const MAX_ENTRIES = 300;
function evictOld() {
  if (cache.size <= MAX_ENTRIES) return;
  const inUse = new Set<string>([...lastGood.values(), ...[...lastStrip.values()].map((s) => s.url)]);
  for (const [k, e] of cache) {
    if (cache.size <= MAX_ENTRIES) break;
    if (!e.url && !e.error) continue; // still rendering
    cache.delete(k);
    if (e.url && !inUse.has(e.url)) URL.revokeObjectURL(e.url);
  }
}

function enqueue(key: string, path: string, body: any) {
  const entry: Entry = { url: null, error: null };
  cache.set(key, entry);
  evictOld();
  entry.promise = queue = queue.then(async () => {
    await whenNotPlaying();
    try {
      const r = await fetch(`${base()}${path}`, { method: 'POST', body: JSON.stringify(body) });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        entry.error = j.error || `HTTP ${r.status}`;
      } else {
        const blob = await r.blob();
        entry.url = URL.createObjectURL(blob);
        try {
          const bmp = await createImageBitmap(blob);
          entry.w = bmp.width;
          entry.h = bmp.height;
          if (path === '/clip-strip') entry.runs = frameRuns(bmp, (body.times || []).length);
          bmp.close();
        } catch {
          /* size unknown: the strip falls back to a square frame */
        }
      }
    } catch (e: any) {
      entry.error = String(e?.message || e);
      cache.delete(key); // retry later (engine restarting)
    }
    listeners.forEach((l) => l());
  });
}

const minimal = (c: Clip) => ({ item: c.item, params: c.params, code: c.code || null, dynamic: c.dynamic });

function useCacheListener() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}

/** Returns the preview image url for the clip's current content (debounced while editing). */
export function useClipThumb(c: Clip | undefined): { url: string | null; error: string | null; pending: boolean } {
  useCacheListener();
  const key = c ? thumbKey(c) : '';
  useEffect(() => {
    if (!c || cache.has(key)) return;
    const t = setTimeout(() => enqueue(key, '/clip-thumb', { clip: minimal(c), globals: usedGlobals(c) }), 350);
    return () => clearTimeout(t);
  }, [key]);
  if (!c) return { url: null, error: null, pending: false };
  const e = cache.get(key);
  if (e?.url) lastGood.set(c.id, e.url);
  return { url: e?.url || lastGood.get(c.id) || null, error: e?.error || null, pending: !e || (!e.url && !e.error) };
}

export const isMorph = (c: Clip) => (c.exit.type === 'TransformInto' || c.exit.type === 'TransformMatching') && !!c.exit.target;

/** Exit window in clip-local seconds, scaled down like the engine does when enter + exit overflow the clip. */
export function exitWindow(c: Clip): [number, number] {
  const ed = c.enter.type !== 'none' ? c.enter.duration : 0;
  const xd = c.exit.type !== 'none' ? c.exit.duration : 0;
  const f = ed + xd > c.duration ? c.duration / (ed + xd) : 1;
  return [c.duration - xd * f, c.duration];
}

export interface StripPlan {
  /** clip-local span the frames cover */
  t0: number;
  t1: number;
  /** sample times (clip-local), evenly spaced at the centres of n equal slices of [t0, t1] */
  times: number[];
}

/** Which part of a clip changes shape over time: a dynamic clip changes everywhere, a morph only in its exit. */
export function stripPlan(c: Clip, dynamic: boolean, target: Clip | null): StripPlan | null {
  const morph = isMorph(c) && !!target;
  if (!dynamic && !morph) return null;
  const [t0, t1] = dynamic ? [0, c.duration] : exitWindow(c);
  const span = Math.max(t1 - t0, 1e-3);
  // ~4 samples / s for a whole clip, denser across a short morph; capped so a long clip stays cheap
  const n = dynamic ? Math.max(4, Math.min(48, Math.round(span * 4))) : Math.max(4, Math.min(12, Math.round(span * 8)));
  const times = Array.from({ length: n }, (_, i) => +(t0 + ((i + 0.5) * span) / n).toFixed(4));
  return { t0, t1, times };
}

export interface Strip {
  url: string;
  n: number;
  /** size of one frame inside the sprite (px) */
  w: number;
  h: number;
  t0: number;
  t1: number;
  /** runs[i] = first frame of the run of look-alike frames that frame i belongs to (absent: all differ) */
  runs?: number[];
  pending: boolean;
}

/**
 * Filmstrip of a clip whose look changes while it plays (dynamic code, or a morph into its target):
 * a horizontal sprite of frames all framed by the same camera, so growth / shrinking / reshaping shows.
 */
export function useClipStrip(c: Clip | undefined, dynamic: boolean, target: Clip | null): Strip | null {
  useCacheListener();
  const plan = c ? stripPlan(c, dynamic, target) : null;
  const morph = !!(c && target && isMorph(c));
  const key = c && plan
    ? JSON.stringify(['strip', thumbKey(c), dynamic, c.duration, plan.times, morph ? [c.exit.type, c.exit.duration, c.exit.rate, thumbKey(target!)] : null])
    : '';
  useEffect(() => {
    if (!c || !plan || cache.has(key)) return;
    const body = {
      clip: { ...minimal(c), duration: c.duration, exit: c.exit },
      target: morph ? minimal(target!) : null,
      times: plan.times,
      globals: [...usedGlobals(c), ...(morph ? usedGlobals(target!) : [])],
    };
    const t = setTimeout(() => enqueue(key, '/clip-strip', body), 450);
    return () => clearTimeout(t);
  }, [key]);
  if (!c || !plan) return null;
  const e = cache.get(key);
  const n = plan.times.length;
  if (e?.url) {
    const s = { url: e.url, n, w: e.w ? e.w / n : 72, h: e.h || 72, t0: plan.t0, t1: plan.t1, runs: e.runs };
    lastStrip.set(c.id, s);
    return { ...s, pending: false };
  }
  // while re-rendering, keep showing the previous strip (stretched over the new span)
  const prev = lastStrip.get(c.id);
  return prev ? { ...prev, t0: plan.t0, t1: plan.t1, pending: true } : null;
}
