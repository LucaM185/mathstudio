// Project globals: named constants (fonts, sizes, spacing, colours…) shared by the whole scene.
// The engine writes them at the top of scene.py; clip code reads them by name and template
// params can be linked to one ({ $g: NAME }), so changing a global restyles every element using it.
import type { Clip, GlobalType, GlobalVar, ParamType, Project } from './types';
import { uid } from './ops';

export const GLOBAL_TYPES: { id: GlobalType; label: string }[] = [
  { id: 'number', label: 'Number' },
  { id: 'color', label: 'Color' },
  { id: 'font', label: 'Font' },
  { id: 'text', label: 'Text' },
  { id: 'bool', label: 'Toggle' },
];

export const FONTS = ['Helvetica Neue', 'Avenir Next', 'Georgia', 'Menlo', 'Futura', 'Gill Sans', 'Times New Roman', 'Courier New', 'SF Mono', 'Monaco', 'Palatino', 'Baskerville', 'Optima'];

export const defaultGlobalValue = (t: GlobalType): any =>
  t === 'number' ? 1 : t === 'color' ? '#58C4DD' : t === 'font' ? 'Helvetica Neue' : t === 'bool' ? true : '';

/** UPPER_SNAKE identifier from whatever the user typed ("font size" -> FONT_SIZE). */
export function sanitizeGlobalName(s: string) {
  let n = String(s || '')
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  if (/^\d/.test(n)) n = 'G_' + n;
  return n;
}

export const isGlobalName = (s: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);

export function linkedGlobal(v: any): string | null {
  return v && typeof v === 'object' && typeof v.$g === 'string' ? v.$g : null;
}

/** Can a template param of this type be driven by a global of that type? */
export function linkable(param: ParamType, g: GlobalType) {
  switch (param) {
    case 'number':
    case 'int':
      return g === 'number';
    case 'expr':
      return g === 'number' || g === 'bool';
    case 'color':
      return g === 'color';
    case 'select':
      return g === 'font' || g === 'text';
    case 'text':
    case 'latex':
      return g === 'text' || g === 'font';
    case 'bool':
      return g === 'bool';
    default:
      return false;
  }
}

/** Value to show (and to unlink to) for a param linked to a global. */
export function resolveParam(p: Project, v: any) {
  const name = linkedGlobal(v);
  if (!name) return v;
  return (p.globals || []).find((g) => g.name === name)?.value;
}

const word = (name: string) => new RegExp(`\\b${name.replace(/[^A-Za-z0-9_]/g, '')}\\b`);

/** Does this clip read the global (a linked param, or its name in the clip's code)? */
export function clipUsesGlobal(c: Clip, name: string) {
  if (Object.values(c.params || {}).some((v) => linkedGlobal(v) === name)) return true;
  const w = word(name);
  if (c.layout && [c.layout.x, c.layout.y].some((e) => typeof e === 'string' && w.test(e))) return true;
  return !!c.code && w.test(c.code);
}

export function globalUsage(p: Project, name: string) {
  return p.clips.filter((c) => clipUsesGlobal(c, name));
}

/** The globals a clip reads (sent with its thumbnail request so the thumb changes with them). */
export function globalsFor(c: Pick<Clip, 'params' | 'code'>, globals: GlobalVar[] | undefined) {
  if (!globals?.length) return [];
  return globals.filter((g) => Object.values(c.params || {}).some((v) => linkedGlobal(v) === g.name) || (!!c.code && word(g.name).test(c.code)));
}

/** Rename a global and every reference to it (linked params and whole-word uses in clip code). */
export function renameGlobal(p: Project, from: string, to: string) {
  const g = (p.globals || []).find((x) => x.name === from);
  if (!g || from === to) return;
  g.name = to;
  const re = new RegExp(`\\b${from}\\b`, 'g');
  for (const c of p.clips) {
    for (const [k, v] of Object.entries(c.params || {})) if (linkedGlobal(v) === from) c.params[k] = { $g: to };
    if (c.code) c.code = c.code.replace(re, to);
    if (c.layout) {
      const l = { ...c.layout };
      for (const ax of ['x', 'y'] as const) if (typeof l[ax] === 'string') l[ax] = l[ax]!.replace(re, to);
      c.layout = l;
    }
  }
}

/** Delete a global; linked params keep its last value so nothing breaks. */
export function deleteGlobal(p: Project, name: string) {
  const g = (p.globals || []).find((x) => x.name === name);
  if (!g) return;
  p.globals = (p.globals || []).filter((x) => x !== g);
  const re = new RegExp(`\\b${name}\\b`, 'g');
  for (const c of p.clips) {
    for (const [k, v] of Object.entries(c.params || {})) if (linkedGlobal(v) === name) c.params[k] = g.value;
    // layout expressions keep working with the last value written in
    if (c.layout) {
      const l = { ...c.layout };
      const lit = g.type === 'bool' ? (g.value ? '1' : '0') : `(${Number(g.value) || 0})`;
      for (const ax of ['x', 'y'] as const) if (typeof l[ax] === 'string') l[ax] = l[ax]!.replace(re, lit);
      c.layout = l;
    }
  }
}

export function uniqueGlobalName(p: Project, base: string) {
  const names = new Set((p.globals || []).map((g) => g.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export function newGlobal(p: Project, type: GlobalType, name?: string, value?: any): GlobalVar {
  const base = sanitizeGlobalName(name || (type === 'number' ? 'SIZE' : type === 'color' ? 'COLOR' : type === 'font' ? 'FONT' : type === 'bool' ? 'SHOW' : 'LABEL'));
  return { id: uid('g'), name: uniqueGlobalName(p, base), type, value: value ?? defaultGlobalValue(type) };
}

export function coerceGlobalValue(type: GlobalType, v: any): { ok: boolean; v?: any; why?: string } {
  switch (type) {
    case 'number': {
      const n = typeof v === 'string' ? Number(v) : v;
      return typeof n === 'number' && Number.isFinite(n) ? { ok: true, v: n } : { ok: false, why: 'expected a number' };
    }
    case 'color': {
      const s = String(v ?? '').trim();
      return /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) ? { ok: true, v: s.toUpperCase() } : { ok: false, why: 'expected a hex colour like #58C4DD' };
    }
    case 'bool':
      return { ok: true, v: v === true || v === 'true' || v === 1 };
    default:
      return { ok: true, v: v == null ? '' : String(v) };
  }
}

// ---------------------------------------------------------------- layout bindings
// A clip's x / y can follow an expression over number globals ("LEFT_X + 2*COL_GAP"), so spacing
// globals move separate elements. Moving the clip by hand unbinds that axis.

const FRAME_CONSTS: Record<string, number> = { FRAME_WIDTH: 14.222222222222221, FRAME_HEIGHT: 8 };

/** Evaluate a layout expression; null when it is invalid or reads an unknown / non-number global. */
export function evalLayout(expr: string, globals: GlobalVar[] | undefined): number | null {
  if (typeof expr !== 'string' || !expr.trim() || expr.length > 300) return null;
  const vals: Record<string, number> = { ...FRAME_CONSTS };
  for (const g of globals || []) {
    if (g.type === 'number' && Number.isFinite(Number(g.value))) vals[g.name] = Number(g.value);
    else if (g.type === 'bool') vals[g.name] = g.value ? 1 : 0;
  }
  let bad = false;
  const js = expr.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (id) => {
    if (id in vals) return `(${vals[id]})`;
    bad = true;
    return '0';
  });
  if (bad || !/^[-+*/().\d\seE]*$/.test(js)) return null;
  try {
    const v = Function(`"use strict"; return (${js});`)();
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Unknown names in a layout expression (for warnings). */
export function layoutProblems(expr: string, globals: GlobalVar[] | undefined) {
  const known = new Set([...Object.keys(FRAME_CONSTS), ...(globals || []).filter((g) => g.type === 'number' || g.type === 'bool').map((g) => g.name)]);
  const unknown = [...new Set((expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).filter((id) => !known.has(id)))];
  return unknown;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Run after every edit (store commits and agent edits): bound axes follow their expression, and an
 * axis the edit moved by hand (same expression, same result, different position) is unbound.
 */
export function applyLayout(prev: Project, next: Project) {
  if (!next.clips.some((c) => c.layout)) return;
  const before = new Map(prev.clips.map((c) => [c.id, c]));
  for (const c of next.clips) {
    if (!c.layout) continue;
    const old = before.get(c.id);
    for (const ax of ['x', 'y'] as const) {
      const expr = c.layout[ax];
      if (expr == null) continue;
      const v = evalLayout(expr, next.globals);
      if (old && old.layout?.[ax] === expr && c.transform[ax] !== old.transform[ax]) {
        const was = evalLayout(expr, prev.globals);
        if (was === v) {
          // this edit moved the clip itself: it is placed by hand now
          delete c.layout[ax];
          continue;
        }
      }
      if (v !== null) c.transform = { ...c.transform, [ax]: r4(v) };
    }
    if (c.layout.x == null && c.layout.y == null) delete c.layout;
  }
}
