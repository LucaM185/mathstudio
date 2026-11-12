// No-code fields for clips with custom code. The engine (engine/code_knobs.py) reads the code and
// returns "knobs" — font, font size, weight, colours, stroke widths, text, top-level constants —
// each with the character spans in the code that hold its value. Editing a knob rewrites those
// spans here, synchronously, so dragging a number is as smooth as a template param.
import { useEffect, useState } from 'react';
import type { GlobalVar } from './types';
import { base } from './engine';
import { useStore } from './store';

export interface KnobEdit {
  /** span in the code (JS string indices) replaced by pre + literal + suf */
  s: number;
  e: number;
  pre: string;
  suf: string;
  /** quote style of the string literal it replaces */
  q?: string;
}

export interface KnobOcc {
  /** what this use belongs to: variable, helper function or drawn string ("plus", "row", "“x”") */
  ctx: string;
  edits: KnobEdit[];
  /** rewrites only this use's own argument (detaching it from a shared constant like fs = 110) */
  own?: KnobEdit[];
}

export type KnobKind = 'string' | 'latex' | 'font' | 'font_size' | 'weight' | 'slant' | 'color' | 'number' | 'bool';

export interface Knob {
  id: string;
  group: 'text' | 'color' | 'shape' | 'value';
  kind: KnobKind;
  label: string;
  value: any;
  /** every spot reads this project global */
  linked: string | null;
  /** ManimGL's default: the argument isn't written in the code yet */
  default: boolean;
  where: string;
  occ: KnobOcc[];
  edits: KnobEdit[];
  /** the top-level constant it rewrites (fs = 110) */
  name?: string;
  note?: string;
  options?: string[];
  min?: number | null;
  max?: number | null;
  step?: number;
}

type Entry = { knobs: Knob[] | null; error: string | null };
const cache = new Map<string, Entry>();
const lastGood = new Map<string, Knob[]>();
const listeners = new Set<() => void>();

/** the globals the code reads, with the values that resolve linked knobs */
function globalsIn(code: string, globals: GlobalVar[] | undefined) {
  return (globals || [])
    .filter((g) => new RegExp(`\\b${g.name}\\b`).test(code))
    .map((g) => ({ name: g.name, type: g.type, value: g.value }));
}

const keyOf = (code: string, gl: { name: string; value: any }[]) => (gl.length ? JSON.stringify(gl) + '\n' : '') + code;

async function request(key: string, code: string, gl: any[]) {
  const entry: Entry = { knobs: null, error: null };
  cache.set(key, entry);
  try {
    const r = await fetch(`${base()}/code-knobs`, { method: 'POST', body: JSON.stringify({ code, globals: gl }) });
    const j = await r.json();
    entry.knobs = j.knobs || [];
    entry.error = j.error || null;
  } catch (e: any) {
    entry.error = String(e?.message || e);
    cache.delete(key); // engine restarting: ask again next render
  }
  if (cache.size > 400) cache.delete(cache.keys().next().value!);
  listeners.forEach((l) => l());
}

/**
 * Knobs for a clip's code. `ready` is false while the knobs shown are from an older version of the
 * code (spans may not match) — edits wait for the fresh ones.
 */
export function useCodeKnobs(clipId: string, code: string | null | undefined): { knobs: Knob[]; error: string | null; ready: boolean } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const port = useStore((s) => s.port);
  const globals = useStore((s) => s.project.globals);
  const gl = code ? globalsIn(code, globals) : [];
  const key = code ? keyOf(code, gl) : '';
  useEffect(() => {
    if (!code || !port || cache.has(key)) return;
    request(key, code, gl);
  }, [key, port]);
  const e = code ? cache.get(key) : undefined;
  if (e?.knobs && !e.error) lastGood.set(clipId, e.knobs);
  if (e?.knobs) return { knobs: e.error ? lastGood.get(clipId) || [] : e.knobs, error: e.error, ready: !e.error };
  return { knobs: lastGood.get(clipId) || [], error: e?.error || null, ready: false };
}

/** Knobs for exactly this code, if known (used to snapshot an edit). */
export function knobsFor(code: string): Knob[] | null {
  const gl = globalsIn(code, useStore.getState().project.globals);
  const e = cache.get(keyOf(code, gl));
  return e?.knobs && !e.error ? e.knobs : null;
}

// ------------------------------------------------------------------ writing values
const fmtNum = (v: number) => {
  if (!Number.isFinite(v)) return '0';
  const r = Number(v.toFixed(6));
  return String(r);
};

function pyStr(v: string, q = '"') {
  const s = String(v ?? '');
  return q + s.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), '\\' + q).replace(/\n/g, '\\n') + q;
}

/** Python source for a knob value; `{ $g: NAME }` writes the global's name (linking it). */
export function knobLiteral(kind: KnobKind, v: any, q = '"'): string {
  if (v && typeof v === 'object' && typeof v.$g === 'string') return v.$g;
  switch (kind) {
    case 'number':
    case 'font_size':
      return fmtNum(Number(v));
    case 'bool':
      return v ? 'True' : 'False';
    case 'color':
      return pyStr(String(v).toUpperCase(), q);
    case 'latex': {
      const s = String(v ?? '');
      // LaTeX reads best as a raw string when it can be one
      if (s.includes('\\') && !s.includes(q) && !s.includes('\n') && !s.endsWith('\\')) return `r${q}${s}${q}`;
      return pyStr(s, q);
    }
    default:
      return pyStr(String(v ?? ''), q);
  }
}

/** Replace the edits' spans (from the end, so earlier indices stay valid). */
export function applyEdits(code: string, edits: KnobEdit[], text: (e: KnobEdit) => string): string {
  const sorted = [...edits].sort((a, b) => b.s - a.s || b.e - a.e);
  let out = code;
  for (const e of sorted) out = out.slice(0, e.s) + e.pre + text(e) + e.suf + out.slice(e.e);
  return out;
}

/** Where every span of `knobs` lands after `edits` were applied with these replacement texts. */
function shiftKnobs(knobs: Knob[], applied: { ed: KnobEdit; len: number }[]): Knob[] {
  const asc = [...applied].sort((a, b) => a.ed.s - b.ed.s);
  const same = (x: KnobEdit, y: KnobEdit) => x.s === y.s && x.e === y.e && x.pre === y.pre;
  const move = (x: KnobEdit): KnobEdit => {
    let shift = 0;
    for (const { ed, len } of asc) {
      const delta = ed.pre.length + len + ed.suf.length - (ed.e - ed.s);
      if (same(x, ed)) {
        // the written literal is now a plain replacement span
        const s = x.s + shift + ed.pre.length;
        return { s, e: s + len, pre: '', suf: '', q: x.q };
      }
      if (x.s >= ed.e) shift += delta;
    }
    return { ...x, s: x.s + shift, e: x.e + shift };
  };
  return knobs.map((k) => ({
    ...k,
    edits: k.edits.map(move),
    occ: k.occ.map((o) => ({ ...o, edits: o.edits.map(move), ...(o.own ? { own: o.own.map(move) } : {}) })),
  }));
}

/**
 * New code with `value` written into `edits` (default: all of the knob's spots). The knobs for the
 * new code are known right away (spans shifted), so a drag can keep going without the engine.
 */
export function setKnob(code: string, knobs: Knob[], knob: Knob, value: any, edits: KnobEdit[] = knob.edits): string {
  const texts = new Map<KnobEdit, string>();
  const next = applyEdits(code, edits, (e) => {
    const t = knobLiteral(knob.kind, value, e.q || '"');
    texts.set(e, t);
    return t;
  });
  const applied = edits.map((ed) => ({ ed, len: (texts.get(ed) ?? '').length }));
  const whole = edits === knob.edits;
  const linkedTo = value && typeof value === 'object' && typeof value.$g === 'string' ? value.$g : null;
  const shifted = shiftKnobs(knobs, applied).map((k) => {
    if (k.id !== knob.id || !whole) return k;
    const g = linkedTo ? (useStore.getState().project.globals || []).find((x) => x.name === linkedTo) : null;
    return { ...k, value: linkedTo ? g?.value : value, linked: linkedTo, default: false };
  });
  const gl = globalsIn(next, useStore.getState().project.globals);
  const key = keyOf(next, gl);
  if (!cache.has(key)) {
    cache.set(key, { knobs: shifted, error: null });
    // refresh labels / grouping from the engine once the user pauses
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (cache.get(key)?.knobs === shifted) request(key, next, gl);
    }, 700);
  }
  return next;
}
let refreshTimer: any = null;

/** Value of one use (for the Parts section): own literal if it has one, else the knob's value. */
export function partKnobs(knobs: Knob[], label: string | null | undefined) {
  if (!label) return [];
  const out: { knob: Knob; occ: KnobOcc }[] = [];
  for (const k of knobs) {
    const o = k.occ.find((o) => o.ctx === label);
    if (o && (k.kind === 'color' || k.kind === 'font_size' || k.kind === 'string' || k.kind === 'latex' || k.kind === 'font')) out.push({ knob: k, occ: o });
  }
  return out;
}
