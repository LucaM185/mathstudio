// Tools the AI agent can call. Each one edits the agent's own project through a DocHandle: when
// that project is on screen the timeline, preview and inspector update while the agent works;
// when the user has switched to another project, the edits still land in the right one.
import { useStore } from '../store';
import type { DocHandle } from '../sessions';
import { fetchCode, renderFrame } from '../engine';
import type { AnimSpec, Clip, ClipInfo, GlobalType, LibraryItem, PartSpec, Project, Track } from '../types';
import { findNode, loadClipParts, PART_PATH, staggerParts } from '../parts';
import { GLOBAL_TYPES, coerceGlobalValue, deleteGlobal, evalLayout, globalUsage, isGlobalName, layoutProblems, linkable, linkedGlobal, newGlobal, renameGlobal, sanitizeGlobalName } from '../globals';
import { describeView, fitView, presetAngles, VIEW_PRESETS, type V3 } from '../view3d';
import { CAMERA_ID, DEFAULT_TRANSFORM, cameraAt, FRAME_H, FRAME_W, TKEYS, emptyTrackIds, freeTrackFor, insertTrack, joinMorphTrack, makeClip, removeEmptyTracks, resolveOverlap, round, uid } from '../ops';

const S = () => useStore.getState();

export interface ToolResult {
  ok: boolean;
  /** what goes back to the model */
  text: string;
  /** one-line label for the chat UI */
  summary: string;
  /** PNG data URLs (render_preview) */
  images?: { t: number; url: string }[];
}

// ------------------------------------------------------------------ schemas
const num = (description: string) => ({ type: 'number', description });
const animSchema = (kind: string) => ({
  type: 'object',
  description: `${kind} animation`,
  properties: {
    type: { type: 'string', description: `${kind} animation type (see the list in the system prompt)` },
    duration: num('seconds'),
    rate: { type: 'string', description: 'rate function' },
    ...(kind === 'exit' ? { target: { type: ['string', 'null'], description: 'clip id to morph into (TransformInto / TransformMatching only)' } } : {}),
  },
});
const keySchema = {
  type: 'object',
  properties: {
    t: num('seconds since the clip start'),
    x: num('x'), y: num('y'), z: num('z (depth; 3D scenes)'), scale: num('scale (1 = original)'), rotation: num('degrees, counter-clockwise in its own plane (about z)'), rx: num('3D tilt about the x axis, degrees (-90 = lying flat on the floor, readable from Top)'), ry: num('3D turn about the y axis, degrees (90 = facing Right/+x)'), opacity: num('0..1'),
    ease: { type: 'string', description: 'rate used to reach this key (default smooth)' },
  },
  required: ['t'],
};
const clipProps = {
  name: { type: 'string', description: 'display name' },
  start: num('start time in seconds (absolute)'),
  duration: num('length in seconds'),
  track: { type: 'string', description: 'track id or track name. An unknown name creates a new track at the front. Omit to use the front-most free track.' },
  x: num('static position x'), y: num('static position y'),
  layout: {
    type: ['object', 'null'],
    description: 'position that follows the globals: x and/or y as arithmetic expressions over number globals (and FRAME_WIDTH / FRAME_HEIGHT), e.g. {x: "LEFT_X", y: "TOP_Y - 2*ROW_GAP"}. Re-evaluated whenever a global changes, so spacing globals move separate elements. Overrides x/y for that axis; null removes the binding. If the user drags the clip, that axis becomes hand-placed.',
    properties: { x: { type: ['string', 'null'] }, y: { type: ['string', 'null'] } },
  }, z: num('static position z (3D; out of the screen in the flat view)'),
  fixed: { type: 'boolean', description: 'pin to the screen: ignores the camera (titles/labels over a 3D scene)' },
  scale: num('static scale'), rotation: num('static rotation in degrees, in the clip\'s own plane (about z)'),
  rx: num('static 3D tilt about the x axis in degrees, applied after rotation (-90 = lay flat on the XZ floor, readable from the Top view)'),
  ry: num('static 3D turn about the y axis in degrees, applied after rx (90 = face the Right view, -90 = Left, 180 = Back)'),
  opacity: num('static opacity 0..1'),
  params: { type: 'object', description: 'template parameters to change (merged into the current ones). A value "$NAME" links the param to the project global NAME (e.g. font_size: "$BODY_SIZE", fill: "$ACCENT").', additionalProperties: true },
  code: { type: ['string', 'null'], description: 'raw ManimGL function body that returns a mobject; replaces the template. null resets to the template.' },
  dynamic: { type: 'boolean', description: 'rebuild every frame; code may use t and a' },
  enter: animSchema('enter'),
  exit: animSchema('exit'),
  effects: { type: 'array', description: 'REPLACES all effects', items: { type: 'object', properties: { type: { type: 'string' }, at: num('seconds since the clip start'), duration: num('seconds'), rate: { type: 'string' } }, required: ['type', 'at'] } },
  keyframes: { type: 'array', description: 'REPLACES all transform keyframes ([] removes them)', items: keySchema },
  parts: {
    type: ['object', 'null'],
    description:
      'Timing of the parts (submobjects) of a group clip — VGroup / Group children, Tex / Text glyphs, Axes pieces — so one clip can build up piece by piece (like LaggedStart). ' +
      'Keys are paths of child indices into the returned mobject: "0" = mob[0], "1.2" = mob[1][2]. Value: {at?: seconds from the clip start when it appears, until?: when it is gone, enter?: {type, duration, rate}, exit?: {type, duration, rate}, dx?, dy?: moves the part from where the code puts it, in the clip\'s own units}. ' +
      'Missing timing fields come from the nearest ancestor part that sets them, else the clip. Parts not listed follow the clip. REPLACES all part timing; null or {} removes it. Parts the user moved by hand (dx / dy) keep their position unless you give dx / dy for them. ' +
      'Shortcut: {"stagger": 0.3} makes every top-level part enter 0.3 s after the previous one.',
    additionalProperties: true,
  },
};

export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'add_clips',
      description: 'Add one or more clips (mobjects) to the timeline. Returns their ids plus any warnings or render errors.',
      parameters: {
        type: 'object',
        properties: {
          clips: { type: 'array', items: { type: 'object', properties: { item: { type: 'string', description: 'library item id, e.g. "tex", "circle", "custom"' }, ...clipProps }, required: ['item'] } },
        },
        required: ['clips'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_clips',
      description: 'Change existing clips. Only the fields you pass change; params are merged; effects and keyframes are replaced when given.',
      parameters: {
        type: 'object',
        properties: { updates: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', description: 'clip id' }, ...clipProps }, required: ['id'] } } },
        required: ['updates'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_clips',
      description: 'Delete clips by id.',
      parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_camera',
      description: 'Permanently replace all camera keyframes of the project. ONLY call this when the user asked for a camera change; to merely look from another angle, use the camera argument of render_preview instead. t is absolute scene time; zoom 1 = full frame, 2 = twice as close. theta/phi/gamma are ManimGL frame.reorient angles in degrees (all 0 = flat 2D view; theta -30, phi 70 = the usual 3D view; animate theta for an orbit). One key = static camera. Pass [] for the default flat camera.',
      parameters: {
        type: 'object',
        properties: { keys: { type: 'array', items: { type: 'object', properties: { t: num('scene time'), x: num('view centre x'), y: num('view centre y'), z: num('view centre z'), zoom: num('zoom'), theta: num('degrees, turns the camera around the z axis'), phi: num('degrees, tilt away from looking straight down z (0..180)'), gamma: num('degrees, roll'), ease: { type: 'string' } }, required: ['t'] } } },
        required: ['keys'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_scene',
      description: 'Change scene settings.',
      parameters: { type: 'object', properties: { name: { type: 'string' }, duration: num('seconds'), background: { type: 'string', description: 'hex colour' }, fps: { type: 'integer' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_globals',
      description: 'Create, change, rename or delete project globals: named constants (fonts, font sizes, spacing, colours, counts…) shown in the user\'s Globals panel. Clip code reads them by name (they are Python constants at the top of scene.py) and template params link to them with "$NAME". Changing a global restyles every clip that uses it.',
      parameters: {
        type: 'object',
        properties: {
          set: {
            type: 'array',
            description: 'globals to create or update (matched by name)',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'UPPER_SNAKE_CASE Python name, e.g. BODY_FONT, ROW_GAP. Must not shadow ManimGL names (BLUE, UP, PI, FRAME_WIDTH…).' },
                type: { type: 'string', enum: GLOBAL_TYPES.map((t) => t.id), description: 'number (sizes, distances, counts), color (hex), font (font family name), text, bool' },
                value: { description: 'the value (number, "#RRGGBB", font name, string or boolean)' },
                note: { type: 'string', description: 'short description of what it controls, shown to the user' },
              },
              required: ['name'],
            },
          },
          rename: { type: 'array', description: 'rename globals; every linked param and every use in clip code is updated', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
          delete: { type: 'array', items: { type: 'string' }, description: 'names to delete (linked params keep the last value; code that still uses the name will break, so fix it)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_tracks',
      description: 'Set the track list, front-most first (this is the z-order). Existing tracks keep their id; entries without id are created. Empty tracks that are left out are removed.',
      parameters: {
        type: 'object',
        properties: { tracks: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, hidden: { type: 'boolean' }, locked: { type: 'boolean' } } } } },
        required: ['tracks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'render_preview',
      description: 'Render the scene at up to 4 times and LOOK at the images. Also reports which clips are visible, their bounding boxes (of what they draw) and any errors; `invisible_padding` means empty frames make a clip much bigger than its content — fix that.',
      parameters: { type: 'object', properties: { view: { type: 'string', enum: ['user', ...Object.keys(VIEW_PRESETS)], description: 'OPTIONAL look from a named view instead of the scene camera, without changing anything: "user" = exactly what the user sees in the viewport right now (their editor view, or the camera); front / top / right / left / back / bottom / iso = the view-cube views (Y up; top = eye above, looking down at the XZ floor), framed to fit the content. Use this whenever the user talks about a view ("from the top", "in my view").' }, times: { type: 'array', items: { type: 'number' }, description: 'scene times in seconds (max 4)' }, camera: { type: 'array', description: 'OPTIONAL temporary camera for this preview only (same keys as set_camera). The project camera is NOT changed. Use it to inspect a specific angle. Overrides view.', items: { type: 'object', properties: { t: num('scene time'), x: num('x'), y: num('y'), z: num('z'), zoom: num('zoom'), theta: num('degrees'), phi: num('degrees'), gamma: num('degrees'), ease: { type: 'string' } }, required: ['t'] } } }, required: ['times'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_item',
      description: 'Details of a library item: parameter ranges and its ManimGL template code (useful as a starting point for custom code).',
      parameters: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_import',
      description: 'Edit an imported mobject (from the mathstudio library) that the project uses. Its definition sits once at the top of scene.py and every clip that uses it calls it, so editing it changes all of them. Pass the function name `fn` (from get_item) and the full new Python source. The source must still define `def <fn>():` and return a Mobject.',
      parameters: {
        type: 'object',
        properties: { fn: { type: 'string', description: 'function name, e.g. imp_… from get_item' }, code: { type: 'string', description: 'full Python source of the definition' } },
        required: ['fn', 'code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_scene_code',
      description: 'The complete generated ManimGL scene.py for the project.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_playhead',
      description: 'Move the editor playhead and optionally select clips, to show the user something.',
      parameters: { type: 'object', properties: { time: num('seconds'), select: { type: 'array', items: { type: 'string' }, description: 'clip ids to select' } }, required: ['time'] },
    },
  },
];

// ------------------------------------------------------------------ project summary for the model
const r3 = (v: number) => round(Number(v) || 0, 3);

export function compactProject(p: Project) {
  const lib = S().library;
  const nonDefault = (c: Clip) => {
    const it = lib?.items.find((i) => i.id === c.item);
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(c.params || {})) {
      const g = linkedGlobal(v);
      if (g) {
        out[k] = `$${g}`;
        continue;
      }
      const def = it?.params.find((pp) => pp.id === k)?.default;
      if (JSON.stringify(def) !== JSON.stringify(v)) out[k] = v;
    }
    return out;
  };
  const clipOut = (c: Clip) => {
    const o: Record<string, any> = { id: c.id, name: c.name, item: c.item, start: r3(c.start), duration: r3(c.duration) };
    const params = nonDefault(c);
    if (Object.keys(params).length) o.params = params;
    const tr: Record<string, number> = {};
    for (const k of TKEYS) if (r3((c.transform[k] ?? DEFAULT_TRANSFORM[k] ?? 0)) !== (DEFAULT_TRANSFORM[k] ?? 0)) tr[k] = r3((c.transform[k] ?? DEFAULT_TRANSFORM[k] ?? 0));
    if (Object.keys(tr).length) o.transform = tr;
    if (c.keys?.length) o.keyframes = c.keys.map((k) => ({ t: r3(k.t), x: r3(k.x), y: r3(k.y), ...(k.z ? { z: r3(k.z) } : {}), scale: r3(k.scale), rotation: r3(k.rotation), ...(k.rx ? { rx: r3(k.rx) } : {}), ...(k.ry ? { ry: r3(k.ry) } : {}), opacity: r3(k.opacity), ease: k.ease || 'smooth' }));
    if (c.layout && (c.layout.x != null || c.layout.y != null)) o.layout = c.layout;
    if (c.fixed) o.fixed = true;
    o.enter = { ...c.enter, duration: r3(c.enter.duration) };
    o.exit = { ...c.exit, duration: r3(c.exit.duration) };
    if (!o.exit.target) delete o.exit.target;
    if (c.effects?.length) o.effects = c.effects.map((e) => ({ type: e.type, at: r3(e.at), duration: r3(e.duration), rate: e.rate }));
    if (c.code) o.code = c.code;
    if (c.dynamic !== undefined && c.dynamic !== null) o.dynamic = c.dynamic;
    if (c.parts && Object.keys(c.parts).length) o.parts = c.parts;
    return o;
  };
  return {
    settings: {
      name: p.settings.name,
      duration: p.settings.duration,
      fps: p.settings.fps,
      background: p.settings.background,
      camera: (p.settings.camera || []).map((k) => ({ t: r3(k.t), x: r3(k.x), y: r3(k.y), ...(k.z ? { z: r3(k.z) } : {}), zoom: r3(k.zoom), ...(k.theta || k.phi || k.gamma ? { theta: r3(k.theta || 0), phi: r3(k.phi || 0), gamma: r3(k.gamma || 0) } : {}), ease: k.ease })),
    },
    globals: (p.globals || []).map((g) => ({ name: g.name, type: g.type, value: g.value, ...(g.note ? { note: g.note } : {}) })),
    tracks_front_to_back: p.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      ...(t.hidden ? { hidden: true } : {}),
      ...(t.locked ? { locked: true } : {}),
      clips: p.clips.filter((c) => c.track === t.id).sort((a, b) => a.start - b.start).map(clipOut),
    })),
  };
}

export function editorState(d: DocHandle) {
  const s = d.get();
  const sel = s.selection.map((id) => (id === CAMERA_ID ? 'camera' : id.startsWith('__morph__:') ? `the transform that morphs ${id.slice(10)} (${s.project.clips.find((c) => '__morph__:' + c.id === id)?.name ?? '?'}) into the next clip` : `${id} (${s.project.clips.find((c) => c.id === id)?.name ?? '?'})`));
  // the live preview's errors only describe this project while it's on screen
  const meta = d.active() ? S().meta : null;
  const errors = Object.entries(meta?.errors || {}).map(([id, e]) => `${id}: ${String(e).split('\n').slice(-3).join(' ').slice(0, 300)}`);
  return [
    '<editor_state>',
    `playhead: ${r3(s.time)}s · selected: ${sel.length ? sel.join(', ') : 'nothing'}`,
    `user's viewport: ${s.editorView ? `free editor view (not exported) ${describeView(s.editorView)}` : `through the scene camera at the playhead ${describeView(cameraAt(s.project, s.time))}`}`,
    errors.length ? `current render errors: ${errors.join(' | ')}` : '',
    `project: ${JSON.stringify(compactProject(s.project))}`,
    '</editor_state>',
  ].filter(Boolean).join('\n');
}

// ------------------------------------------------------------------ applying clip specs
const isNum = (v: any) => typeof v === 'number' && Number.isFinite(v);

function resolveTrack(p: Project, ref: string, warnings: string[]): string {
  const byId = p.tracks.find((t) => t.id === ref);
  if (byId) return byId.id;
  const byName = p.tracks.find((t) => t.name.toLowerCase() === ref.trim().toLowerCase());
  if (byName) return byName.id;
  const t = insertTrack(p, 0, ref.trim() || undefined);
  warnings.push(`created track "${t.name}" (${t.id}) at the front`);
  return t.id;
}

function coerceParam(def: LibraryItem['params'][number], v: any): { ok: boolean; v?: any; why?: string } {
  switch (def.type) {
    case 'number':
    case 'int': {
      const n = typeof v === 'string' ? Number(v) : v;
      if (!isNum(n)) return { ok: false, why: 'expected a number' };
      return { ok: true, v: def.type === 'int' ? Math.round(n) : n };
    }
    case 'bool':
      return { ok: true, v: v === true || v === 'true' || v === 1 };
    case 'color': {
      const s = String(v).trim();
      if (!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return { ok: false, why: 'expected a hex colour like #58C4DD' };
      return { ok: true, v: s.toUpperCase() };
    }
    case 'select':
      if (def.options && !def.options.includes(String(v))) return { ok: false, why: `must be one of ${def.options.join(', ')}` };
      return { ok: true, v: String(v) };
    default:
      return { ok: true, v: typeof v === 'string' ? v : JSON.stringify(v) };
  }
}

/** Clips whose part timing needs the mobject's structure (stagger, path checks): done after the commit. */
type PendingParts = { id: string; label: string; stagger?: number }[];

function applySpec(p: Project, c: Clip, spec: any, warnings: string[], pending?: PendingParts) {
  const lib = S().library!;
  const label = `"${c.name}"`;
  if (typeof spec.name === 'string' && spec.name.trim()) c.name = spec.name.trim();
  if (isNum(spec.start)) c.start = r3(Math.max(0, spec.start));
  if (isNum(spec.duration)) c.duration = r3(Math.max(0.1, spec.duration));
  if (typeof spec.track === 'string' && spec.track) {
    const tid = resolveTrack(p, spec.track, warnings);
    if (p.tracks.find((t) => t.id === tid)?.locked) warnings.push(`${label}: track is locked, kept the previous track`);
    else c.track = tid;
  }
  for (const k of TKEYS) if (isNum(spec[k])) (c.transform as any)[k] = k === 'opacity' ? Math.min(1, Math.max(0, spec[k])) : spec[k];
  if ((TKEYS.some((k) => isNum(spec[k]))) && c.keys.length && !Array.isArray(spec.keyframes)) {
    warnings.push(`${label} has keyframes, which override the static transform you set; pass keyframes to change the motion`);
  }

  if (spec.params && typeof spec.params === 'object') {
    const item = lib.items.find((i) => i.id === c.item);
    for (const [k, v] of Object.entries(spec.params)) {
      const def = item?.params.find((pp) => pp.id === k);
      if (!def) {
        warnings.push(`${label}: unknown param "${k}" for item ${c.item} (valid: ${item?.params.map((pp) => pp.id).join(', ') || 'none'})`);
        continue;
      }
      // "$NAME" (or {$g: NAME}) links the param to a project global
      const ref = linkedGlobal(v) ?? (typeof v === 'string' && /^\$[A-Za-z_]\w*$/.test(v.trim()) ? v.trim().slice(1) : null);
      if (ref) {
        const g = (p.globals || []).find((x) => x.name === ref);
        if (!g) warnings.push(`${label}: param ${k} links to "$${ref}" but there is no global named ${ref} (create it with set_globals first)`);
        else if (!linkable(def.type, g.type)) warnings.push(`${label}: param ${k} (${def.type}) can't be linked to ${ref} (${g.type})`);
        else c.params[k] = { $g: ref };
        continue;
      }
      const r = coerceParam(def, v);
      if (!r.ok) warnings.push(`${label}: param ${k} ${r.why}`);
      else c.params[k] = r.v;
    }
    if (c.code && !('code' in spec)) warnings.push(`${label} uses custom code, so template params have no effect until code is reset with code: null`);
  }
  if ('code' in spec) {
    if (spec.code === null || spec.code === '') {
      c.code = null;
      delete (c as any).dynamic;
    } else if (typeof spec.code === 'string') c.code = spec.code;
  }
  if (typeof spec.dynamic === 'boolean') (c as any).dynamic = spec.dynamic;
  for (const ax of ['x', 'y'] as const) {
    if (isNum(spec[ax]) && c.layout?.[ax] != null && !(spec.layout && typeof spec.layout === 'object' && ax in spec.layout)) {
      warnings.push(`${label}: setting ${ax} directly unbinds its layout expression "${c.layout[ax]}"`);
    }
  }
  if (spec.layout === null) delete c.layout;
  else if (spec.layout && typeof spec.layout === 'object') {
    const l = { ...(c.layout || {}) };
    for (const ax of ['x', 'y'] as const) {
      if (!(ax in spec.layout)) continue;
      const e = spec.layout[ax];
      if (e === null || e === '') { delete l[ax]; continue; }
      const expr = String(typeof e === 'number' ? e : e).trim();
      if (evalLayout(expr, p.globals) === null) {
        const unknown = layoutProblems(expr, p.globals);
        warnings.push(`${label}: layout.${ax} "${expr}" is invalid${unknown.length ? ` (unknown names: ${unknown.join(', ')}; only number globals can be used — create them first with set_globals)` : ''}`);
        continue;
      }
      l[ax] = expr;
    }
    if (l.x != null || l.y != null) c.layout = l;
    else delete c.layout;
    if (c.layout && c.keys.length && !Array.isArray(spec.keyframes)) warnings.push(`${label}: has keyframes, so its layout binding has no effect`);
  }
  if (typeof spec.fixed === 'boolean') {
    if (spec.fixed) c.fixed = true;
    else delete c.fixed;
  }

  const animIds = (kind: 'enter' | 'exit' | 'effects') => lib.animations[kind].map((a) => a.id);
  const rate = (r: any, where: string) => {
    if (r === undefined) return undefined;
    if (lib.animations.rates.includes(r)) return r;
    warnings.push(`${label}: unknown rate "${r}" for ${where}, using smooth`);
    return 'smooth';
  };
  for (const kind of ['enter', 'exit'] as const) {
    const a = spec[kind];
    if (!a || typeof a !== 'object') continue;
    const next = { ...c[kind] };
    if (a.type !== undefined) {
      if (animIds(kind).includes(a.type)) next.type = a.type;
      else warnings.push(`${label}: unknown ${kind} type "${a.type}"`);
    }
    if (isNum(a.duration)) next.duration = r3(Math.max(0.05, a.duration));
    const rr = rate(a.rate, kind);
    if (rr) next.rate = rr;
    if (kind === 'exit') {
      if ('target' in a) next.target = a.target ?? null;
      if (!['TransformInto', 'TransformMatching'].includes(next.type)) next.target = null;
    }
    c[kind] = next;
  }
  if (Array.isArray(spec.effects)) {
    c.effects = [];
    for (const e of spec.effects) {
      if (!animIds('effects').includes(e?.type)) {
        warnings.push(`${label}: unknown effect "${e?.type}"`);
        continue;
      }
      c.effects.push({ id: uid('e'), type: e.type, at: r3(Math.max(0, Number(e.at) || 0)), duration: r3(isNum(e.duration) ? Math.max(0.1, e.duration) : 1), rate: rate(e.rate, 'effect') || 'smooth' });
    }
  }
  if (spec.parts !== undefined) {
    // positions of parts the user dragged survive a timing rewrite
    const kept: Record<string, PartSpec> = {};
    for (const [p, s] of Object.entries(c.parts || {})) if (s.dx || s.dy) kept[p] = { ...(s.dx ? { dx: s.dx } : {}), ...(s.dy ? { dy: s.dy } : {}) };
    if (!spec.parts || typeof spec.parts !== 'object' || !Object.keys(spec.parts).length) {
      if (Object.keys(kept).length) c.parts = kept;
      else delete c.parts;
    } else {
      const out: Record<string, PartSpec> = { ...kept };
      const anim = (a: any, kind: 'enter' | 'exit', path: string): AnimSpec | undefined => {
        if (!a || typeof a !== 'object') return undefined;
        const type = typeof a.type === 'string' ? a.type : 'none';
        if (!animIds(kind).includes(type) || type === 'TransformInto' || type === 'TransformMatching') {
          warnings.push(`${label}: part ${path} has unknown or unsupported ${kind} type "${a.type}"`);
          return undefined;
        }
        return { type, duration: r3(isNum(a.duration) ? Math.max(0.05, a.duration) : 0.5), rate: rate(a.rate, `part ${path} ${kind}`) || 'smooth' };
      };
      for (const [path, v] of Object.entries<any>(spec.parts)) {
        if (path === 'stagger') continue;
        if (!PART_PATH.test(path) || !v || typeof v !== 'object') {
          warnings.push(`${label}: part key "${path}" must be a path of child indices like "0" or "1.2"`);
          continue;
        }
        const ps: PartSpec = { ...kept[path] };
        if (isNum(v.dx)) ps.dx = r3(v.dx);
        if (isNum(v.dy)) ps.dy = r3(v.dy);
        if (!ps.dx) delete ps.dx;
        if (!ps.dy) delete ps.dy;
        if (isNum(v.at)) ps.at = r3(Math.max(0, Math.min(c.duration, v.at)));
        if (isNum(v.until)) ps.until = r3(Math.max(0, Math.min(c.duration, v.until)));
        const en = anim(v.enter, 'enter', path), ex = anim(v.exit, 'exit', path);
        if (en) ps.enter = en;
        if (ex) ps.exit = ex;
        if (Object.keys(ps).length) out[path] = ps;
      }
      pending?.push({ id: c.id, label, stagger: isNum(spec.parts.stagger) ? Math.max(0, spec.parts.stagger) : undefined });
      if (Object.keys(out).length) c.parts = out;
      else delete c.parts;
    }
  }
  if (Array.isArray(spec.keyframes)) {
    const base = { ...DEFAULT_TRANSFORM, ...c.transform };
    let prev = base;
    c.keys = [...spec.keyframes]
      .filter((k) => isNum(k?.t))
      .sort((a, b) => a.t - b.t)
      .map((k) => {
        const key: any = { id: uid('k'), t: round(Math.min(Math.max(0, k.t), c.duration), 4), ease: rate(k.ease, 'keyframe') || 'smooth' };
        for (const f of TKEYS) key[f] = isNum(k[f]) ? k[f] : (prev as any)[f] ?? 0; // unspecified fields carry over from the previous key
        prev = key;
        return key;
      });
    if (spec.keyframes.some((k: any) => isNum(k?.t) && (k.t < 0 || k.t > c.duration + 1e-6))) {
      warnings.push(`${label}: keyframe times are relative to the clip start and were clamped to [0, ${c.duration}]`);
    }
  }
  // the enter and exit animations have to fit inside the clip
  const used = (c.enter.type !== 'none' ? c.enter.duration : 0) + (c.exit.type !== 'none' ? c.exit.duration : 0);
  if (used > c.duration + 1e-6) {
    const f = c.duration / used;
    c.enter.duration = r3(c.enter.duration * f);
    c.exit.duration = r3(c.exit.duration * f);
    warnings.push(`${label}: enter+exit (${r3(used)}s) were longer than the clip (${c.duration}s); scaled them down`);
  }
}

function checkTargets(p: Project, warnings: string[]) {
  for (const c of p.clips) {
    if (!['TransformInto', 'TransformMatching'].includes(c.exit.type)) continue;
    const t = c.exit.target ? p.clips.find((x) => x.id === c.exit.target || x.name === c.exit.target) : null;
    if (!t) {
      warnings.push(`"${c.name}": ${c.exit.type} needs exit.target = id of the clip to morph into`);
      continue;
    }
    c.exit.target = t.id;
    if (Math.abs(t.start - (c.start + c.duration)) > 0.02) warnings.push(`"${c.name}" morphs into "${t.name}" but "${t.name}" starts at ${t.start}s instead of ${r3(c.start + c.duration)}s`);
    if (t.enter.type !== 'none') warnings.push(`"${t.name}" is a morph target; set its enter type to "none"`);
    if (Math.abs(t.start - (c.start + c.duration)) <= 0.02) joinMorphTrack(p, c, t); // keep the chain on one track
  }
}

/** Render each touched clip once (tiny, no image) to surface code errors and off-screen content. */
async function resolveParts(d: DocHandle, pending: PendingParts, warnings: string[]) {
  for (const { id, label, stagger } of pending) {
    const c = d.get().project.clips.find((x) => x.id === id);
    if (!c) continue;
    const tree = await loadClipParts(c);
    if (!tree) {
      warnings.push(`${label}: couldn't read the parts of this mobject (does its code run?)`);
      continue;
    }
    const n = tree.children?.length || 0;
    if (stagger !== undefined) {
      if (n < 2) warnings.push(`${label}: stagger needs a group with several parts (this mobject has ${n})`);
      else d.commit((p) => { const cc = p.clips.find((x) => x.id === id); if (cc) staggerParts(cc, tree, '', stagger); }, { transient: true });
    }
    for (const path of Object.keys(c.parts || {})) {
      if (!findNode(tree, path)) warnings.push(`${label}: part "${path}" doesn't exist in this mobject (it has ${n} top-level parts)`);
    }
  }
}

async function validate(d: DocHandle, ids: string[]) {
  const p = d.get().project;
  const errors: Record<string, string> = {};
  const notes: string[] = [];
  const camStatic = !(p.settings.camera || []).length;
  for (const id of ids) {
    const c = p.clips.find((x) => x.id === id);
    if (!c) continue;
    const enterEnd = c.enter.type !== 'none' ? c.enter.duration : 0;
    const exitStart = c.duration - (c.exit.type !== 'none' ? c.exit.duration : 0);
    const u = enterEnd < exitStart ? (enterEnd + exitStart) / 2 : c.duration / 2;
    try {
      const { meta } = await renderFrame(p, c.start + u, 96, 54, false, d.sid);
      if (meta.errors?.[id]) errors[id] = tail(meta.errors[id]);
      const info = meta.clips?.[id];
      const pad = paddingNote(c.name, info);
      if (pad) notes.push(pad);
      const bb = info?.bbox;
      if (bb && camStatic) {
        const [x0, y0, x1, y1] = bb;
        const hw = FRAME_W / 2;
        const hh = FRAME_H / 2;
        if (x0 < -hw - 0.05 || x1 > hw + 0.05 || y0 < -hh - 0.05 || y1 > hh + 0.05) {
          notes.push(`"${c.name}" extends outside the frame at t=${r3(c.start + u)} (bbox x ${r3(x0)}..${r3(x1)}, y ${r3(y0)}..${r3(y1)})`);
        }
      }
    } catch (e: any) {
      errors[id] = `render failed: ${e.message || e}`;
    }
  }
  return { errors, notes };
}

/** Warn when invisible parts (empty frames / reference rectangles) blow a clip's box far beyond what it draws. */
function paddingNote(name: string, info: ClipInfo | undefined) {
  if (!info?.full) return null;
  const [W, H] = info.full;
  const big = (full: number, vis: number, frame: number) => full - vis > 0.6 && full > 1.5 * vis && full > 0.4 * frame;
  if (!big(W, info.w, FRAME_W) && !big(H, info.h, FRAME_H)) return null;
  return `"${name}" has invisible padding: an empty frame/reference shape makes it ${r3(W)}×${r3(H)} while it only draws ${r3(info.w)}×${r3(info.h)}. Remove it (static code needs none) or shrink it to the content's extent, then re-centre with x/y.`;
}

const tail = (s: string) => String(s).split('\n').filter(Boolean).slice(-6).join('\n').slice(0, 900);

function finish(payload: Record<string, any>, summary: string): ToolResult {
  const hasErr = payload.errors && Object.keys(payload.errors).length > 0;
  for (const k of Object.keys(payload)) {
    const v = payload[k];
    if ((Array.isArray(v) && !v.length) || (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) delete payload[k];
  }
  return { ok: !hasErr, text: JSON.stringify(payload), summary };
}

// ------------------------------------------------------------------ tool implementations
type Impl = (args: any, d: DocHandle) => Promise<ToolResult>;

function buildCameraKeys(keys: any) {
  const list = (Array.isArray(keys) ? keys : []).filter((k: any) => isNum(k?.t)).sort((a: any, b: any) => a.t - b.t);
  let prev = { x: 0, y: 0, z: 0, zoom: 1, theta: 0, phi: 0, gamma: 0 };
  return list.map((k: any) => {
    const pick = (f: keyof typeof prev) => (isNum(k[f]) ? k[f] : prev[f]);
    const key = { id: uid('ck'), t: r3(Math.max(0, k.t)), x: pick('x'), y: pick('y'), z: pick('z'), zoom: Math.max(0.05, pick('zoom')), theta: pick('theta'), phi: pick('phi'), gamma: pick('gamma'), ease: S().library!.animations.rates.includes(k.ease) ? k.ease : 'smooth' };
    prev = key;
    return key;
  });
}

const impls: Record<string, Impl> = {
  async add_clips({ clips }, d) {
    const lib = S().library!;
    if (!Array.isArray(clips) || !clips.length) return { ok: false, text: 'clips must be a non-empty array', summary: 'Add clips: nothing to add' };
    const warnings: string[] = [];
    const added: Clip[] = [];
    const pending: PendingParts = [];
    d.commit((p) => {
      for (const spec of clips) {
        const item = lib.items.find((i) => i.id === spec?.item);
        if (!item) {
          warnings.push(`unknown item "${spec?.item}" — skipped`);
          continue;
        }
        const start = isNum(spec.start) ? Math.max(0, spec.start) : d.get().time;
        const duration = isNum(spec.duration) ? Math.max(0.1, spec.duration) : 4;
        const c = makeClip(item, { track: '', start, duration, name: spec.name }, p.clips);
        p.clips.push(c);
        const { track, name, ...rest } = spec; // makeClip already made the name unique
        applySpec(p, c, rest, warnings, pending);
        c.track = typeof track === 'string' && track ? resolveTrack(p, track, warnings) : freeTrackFor(p, c.start, c.duration);
        if (p.tracks.find((t) => t.id === c.track)?.locked) c.track = freeTrackFor(p, c.start, c.duration);
        const before = c.track;
        resolveOverlap(p, c.id);
        if (c.track !== before) warnings.push(`"${c.name}" overlapped another clip on its track, moved to the track above`);
        added.push(c);
      }
      checkTargets(p, warnings);
    }, { transient: true });
    await resolveParts(d, pending, warnings);
    const { errors, notes } = await validate(d, added.map((c) => c.id));
    const p = d.get().project;
    const names = added.map((c) => c.name);
    return finish(
      {
        added: added.map((c) => {
          const cur = p.clips.find((x) => x.id === c.id)!;
          return { id: cur.id, name: cur.name, track: p.tracks.find((t) => t.id === cur.track)?.name, start: cur.start, end: r3(cur.start + cur.duration) };
        }),
        warnings: [...warnings, ...notes],
        errors,
      },
      added.length ? `Added ${names.length > 3 ? `${names.length} clips` : names.join(', ')}` : 'Add clips failed',
    );
  },

  async update_clips({ updates }, d) {
    if (!Array.isArray(updates) || !updates.length) return { ok: false, text: 'updates must be a non-empty array', summary: 'Update: nothing to do' };
    const warnings: string[] = [];
    const touched: string[] = [];
    const moved: string[] = [];
    const pending: PendingParts = [];
    d.commit((p) => {
      for (const spec of updates) {
        const c = p.clips.find((x) => x.id === spec?.id) || p.clips.find((x) => x.name === spec?.id);
        if (!c) {
          warnings.push(`no clip with id "${spec?.id}"`);
          continue;
        }
        const before = { track: c.track, start: c.start, duration: c.duration };
        const { id, ...rest } = spec;
        applySpec(p, c, rest, warnings, pending);
        if (before.track !== c.track || before.start !== c.start || before.duration !== c.duration) moved.push(c.id);
        touched.push(c.id);
      }
      // resolve overlaps once the whole batch is applied: a clip that only collides with one that
      // moves away later in the same call must not get a track of its own
      for (const cid of moved) {
        const c = p.clips.find((x) => x.id === cid);
        if (!c) continue;
        const t0 = c.track;
        resolveOverlap(p, c.id);
        if (c.track !== t0) warnings.push(`"${c.name}" overlapped another clip on its track, moved to the track above`);
      }
      checkTargets(p, warnings);
    }, { transient: true });
    await resolveParts(d, pending, warnings);
    const { errors, notes } = await validate(d, touched);
    const p = d.get().project;
    const names = touched.map((id) => p.clips.find((c) => c.id === id)?.name || id);
    return finish({ updated: touched, warnings: [...warnings, ...notes], errors }, touched.length ? `Updated ${names.length > 3 ? `${names.length} clips` : names.join(', ')}` : 'Update failed');
  },

  async delete_clips({ ids }, d) {
    const set = new Set<string>(Array.isArray(ids) ? ids : []);
    const p0 = d.get().project;
    const found = p0.clips.filter((c) => set.has(c.id));
    const missing = [...set].filter((id) => !found.find((c) => c.id === id));
    d.commit((p) => {
      p.clips = p.clips.filter((c) => !set.has(c.id));
      for (const c of p.clips) if (c.exit.target && set.has(c.exit.target)) c.exit = { ...c.exit, type: 'FadeOut', target: null };
    }, { transient: true });
    d.set({ selection: d.get().selection.filter((id) => !set.has(id)) });
    return finish({ deleted: found.map((c) => c.id), warnings: missing.map((id) => `no clip with id "${id}"`) }, `Deleted ${found.length > 3 ? `${found.length} clips` : found.map((c) => c.name).join(', ') || 'nothing'}`);
  },

  async set_camera({ keys }, d) {
    const list = buildCameraKeys(keys);
    d.commit((p) => { p.settings.camera = list; }, { transient: true });
    return finish({ camera_keys: list.length }, list.length ? `Camera: ${list.length} keyframe${list.length > 1 ? 's' : ''}` : 'Camera reset');
  },

  async update_scene(args, d) {
    const changed: string[] = [];
    d.commit((p) => {
      if (typeof args.name === 'string' && args.name.trim()) { p.settings.name = args.name.trim(); changed.push('name'); }
      if (isNum(args.duration)) { p.settings.duration = Math.max(0.5, args.duration); changed.push('duration'); }
      if (typeof args.background === 'string' && /^#[0-9a-f]{3,8}$/i.test(args.background)) { p.settings.background = args.background; changed.push('background'); }
      if (isNum(args.fps)) { p.settings.fps = Math.max(1, Math.min(120, Math.round(args.fps))); changed.push('fps'); }
    }, { transient: true });
    return finish({ changed, settings: d.get().project.settings }, `Scene: ${changed.join(', ') || 'no change'}`);
  },

  async set_globals(args, d) {
    const warnings: string[] = [];
    const changed: string[] = [];
    const sets = Array.isArray(args?.set) ? args.set : [];
    const renames = Array.isArray(args?.rename) ? args.rename : [];
    const dels = Array.isArray(args?.delete) ? args.delete : [];
    if (!sets.length && !renames.length && !dels.length) return { ok: false, text: 'pass set, rename and/or delete', summary: 'Globals: nothing to do' };
    d.commit((p) => {
      p.globals = p.globals || [];
      for (const r of renames) {
        const from = String(r?.from || '');
        const to = sanitizeGlobalName(String(r?.to || ''));
        if (!p.globals.find((g) => g.name === from)) { warnings.push(`no global named ${from}`); continue; }
        if (!to || p.globals.find((g) => g.name === to)) { warnings.push(`can't rename ${from} to "${r?.to}"`); continue; }
        renameGlobal(p, from, to);
        changed.push(`${from}→${to}`);
      }
      for (const spec of sets) {
        const raw = String(spec?.name || '');
        const name = isGlobalName(raw) ? raw : sanitizeGlobalName(raw);
        if (!name) { warnings.push(`invalid global name "${raw}"`); continue; }
        if (name !== raw) warnings.push(`"${raw}" is not a valid Python name; used ${name}`);
        let g = p.globals.find((x) => x.name === name);
        const type: GlobalType | undefined = GLOBAL_TYPES.some((t) => t.id === spec.type) ? spec.type : undefined;
        if (spec.type !== undefined && !type) warnings.push(`${name}: unknown type "${spec.type}"`);
        if (!g) {
          const guessed: GlobalType = type ?? (typeof spec.value === 'number' ? 'number' : typeof spec.value === 'boolean' ? 'bool' : /^#[0-9a-f]{6}$/i.test(String(spec.value)) ? 'color' : 'text');
          g = newGlobal(p, guessed, name);
          g.name = name;
          p.globals.push(g);
        } else if (type && type !== g.type) {
          g.type = type;
        }
        if (spec && 'value' in spec) {
          const r = coerceGlobalValue(g.type, spec.value);
          if (r.ok) g.value = r.v;
          else warnings.push(`${name}: ${r.why}`);
        }
        if (typeof spec.note === 'string') {
          if (spec.note.trim()) g.note = spec.note.trim();
          else delete g.note;
        }
        changed.push(name);
      }
      for (const n of dels) {
        const name = String(n);
        if (!p.globals.find((g) => g.name === name)) { warnings.push(`no global named ${name}`); continue; }
        const word = new RegExp('\\b' + name + '\\b');
        const users = p.clips.filter((c) => c.code && word.test(c.code));
        if (users.length) warnings.push(`deleted ${name}, but the code of ${users.map((c) => `"${c.name}"`).join(', ')} still uses it; update that code`);
        deleteGlobal(p, name);
        changed.push(`-${name}`);
      }
      if (!p.globals.length) delete p.globals;
    }, { transient: true });
    // one tiny render surfaces reserved names and errors in the clips that read the globals
    const p = d.get().project;
    const errors: Record<string, string> = {};
    let globalErrors: Record<string, string> = {};
    try {
      const { meta } = await renderFrame(p, d.get().time, 96, 54, false, d.sid);
      globalErrors = meta.global_errors || {};
      for (const [id, e] of Object.entries(meta.errors || {})) errors[id] = tail(e);
    } catch (e: any) {
      warnings.push(`could not check the globals: ${e?.message || e}`);
    }
    const globals = (p.globals || []).map((g) => ({ name: g.name, type: g.type, value: g.value, used_by: globalUsage(p, g.name).length }));
    return finish({ globals, global_errors: globalErrors, warnings, errors }, `Globals: ${changed.join(', ') || 'no change'}`);
  },

  async set_tracks({ tracks }, d) {
    if (!Array.isArray(tracks) || !tracks.length) return { ok: false, text: 'tracks must be a non-empty array', summary: 'Tracks: invalid' };
    const warnings: string[] = [];
    d.commit((p) => {
      const next: Track[] = [];
      for (const t of tracks) {
        const ex = t.id ? p.tracks.find((x) => x.id === t.id) : null;
        if (t.id && !ex) warnings.push(`no track with id "${t.id}", created a new one`);
        const tr: Track = ex ? { ...ex } : { id: uid('t'), name: '' };
        if (typeof t.name === 'string' && t.name.trim()) tr.name = t.name.trim();
        if (!tr.name) tr.name = `Track ${next.length + 1}`;
        if (typeof t.hidden === 'boolean') tr.hidden = t.hidden;
        if (typeof t.locked === 'boolean') tr.locked = t.locked;
        if (!next.find((x) => x.id === tr.id)) next.push(tr);
      }
      for (const old of p.tracks) {
        if (next.find((x) => x.id === old.id)) continue;
        if (p.clips.some((c) => c.track === old.id)) {
          next.push(old);
          warnings.push(`track "${old.name}" still has clips, kept it at the back`);
        }
      }
      p.tracks = next;
    }, { transient: true });
    const tr = d.get().project.tracks;
    return finish({ tracks: tr.map((t) => ({ id: t.id, name: t.name })), warnings }, `Tracks: ${tr.map((t) => t.name).join(', ')}`);
  },

  async render_preview({ times, camera, view }, d) {
    let p = d.get().project;
    let ts: number[] = (Array.isArray(times) ? times : []).filter(isNum).slice(0, 4);
    if (!ts.length) ts = [d.get().time];
    ts = ts.map((t) => Math.min(Math.max(0, t), p.settings.duration));
    let viewNote = '';
    if (Array.isArray(camera) && camera.length) p = { ...p, settings: { ...p.settings, camera: buildCameraKeys(camera) } };
    else if (view === 'user') {
      const ev = d.get().editorView;
      if (ev) {
        p = { ...p, settings: { ...p.settings, camera: [{ id: 'ck_view', t: 0, ...ev, ease: 'smooth' }] } };
        viewNote = `the user's editor view: ${describeView(ev)}`;
      } else viewNote = 'the user is looking through the scene camera';
    } else if (typeof view === 'string' && VIEW_PRESETS[view]) {
      // orientation of the named view, framed to fit what is on screen at the first time asked
      const { meta } = await renderFrame(p, ts[0], 192, 108, false, d.sid);
      const boxes: [V3, V3][] = [];
      for (const info of Object.values(meta.clips || {})) {
        if (!info.bbox || info.fixed) continue;
        const zr = info.zr || [0, 0];
        boxes.push([[info.bbox[0], info.bbox[1], zr[0]], [info.bbox[2], info.bbox[3], zr[1]]]);
      }
      const c0 = { x: 0, y: 0, z: 0, zoom: 1, ...presetAngles(view) };
      const cam = boxes.length ? fitView(c0, boxes, 768, 432) : c0;
      p = { ...p, settings: { ...p.settings, camera: [{ id: 'ck_view', t: 0, ...cam, ease: 'smooth' }] } };
      viewNote = describeView(cam);
    }
    const images: { t: number; url: string }[] = [];
    const frames: any[] = [];
    for (const t of ts) {
      const { meta, png } = await renderFrame(p, t, 768, 432, true, d.sid);
      images.push({ t, url: png! });
      const visible = Object.entries(meta.clips || {}).map(([id, info]) => ({
        id,
        name: p.clips.find((c) => c.id === id)?.name,
        phase: info.phase,
        bbox: info.bbox?.map((v) => round(v, 2)),
        ...(paddingNote('', info) ? { invisible_padding: info.full!.map((v) => round(v, 2)) } : {}),
      }));
      const errs = Object.fromEntries(Object.entries(meta.errors || {}).map(([id, e]) => [id, tail(e)]));
      frames.push({ t: r3(t), camera: meta.camera, visible, ...(Object.keys(errs).length ? { errors: errs } : {}) });
    }
    const anyErr = frames.some((f) => f.errors);
    return { ok: !anyErr, text: JSON.stringify({ ...(viewNote ? { view: viewNote } : {}), frames, note: 'The rendered images follow in the next message, in the same order.' }), summary: `Preview${typeof view === 'string' && (view === 'user' || VIEW_PRESETS[view]) && !(Array.isArray(camera) && camera.length) ? ` (${view === 'user' ? 'your view' : VIEW_PRESETS[view].label})` : ''} at ${ts.map((t) => `${r3(t)}s`).join(', ')}`, images };
  },

  async get_item({ item }) {
    const lib = S().library!;
    const it = lib.items.find((i) => i.id === item);
    if (!it) return { ok: false, text: `unknown item "${item}"`, summary: `Item ${item}: not found` };
    const extra = it.prelude ? { fn: it.fn, definition: it.prelude, source: it.source, license: it.license, non_commercial: !!it.nc } : {};
    return { ok: true, text: JSON.stringify({ id: it.id, name: it.name, category: it.category, default_enter: it.enter, dynamic: !!it.dynamic, params: it.params, template_code: it.code, ...extra }), summary: `Read item ${it.name}` };
  },

  async set_import({ fn, code }, d) {
    const name = String(fn || '').replace(/[^A-Za-z0-9_]/g, '');
    const src = String(code || '');
    if (!name || !new RegExp(`^def\\s+${name}\\s*\\(`, 'm').test(src)) {
      return { ok: false, text: `the source must define "def ${name}():"`, summary: `Import ${name}: no matching def` };
    }
    d.commit((p) => {
      p.imports = p.imports || [];
      const ex = p.imports.find((i) => i.fn === name);
      if (ex) ex.code = src;
      else p.imports.push({ fn: name, code: src });
    });
    return { ok: true, text: `updated ${name}; the scene file and the preview use the new definition`, summary: `Edited imported ${name}` };
  },

  async get_scene_code(_args, d) {
    const code = await fetchCode(d.get().project);
    return { ok: true, text: code.length > 40000 ? code.slice(0, 40000) + '\n# … truncated' : code, summary: 'Read scene.py' };
  },

  async set_playhead({ time, select }, d) {
    d.setTime(Number(time) || 0);
    const p = d.get().project;
    const sel = Array.isArray(select) ? select.filter((id: string) => p.clips.find((c) => c.id === id)) : null;
    if (d.active()) useStore.setState({ playing: false });
    if (sel) d.set({ selection: sel, selectedKey: null });
    const now = d.get();
    return { ok: true, text: JSON.stringify({ time: now.time, selected: sel ?? now.selection }), summary: `Playhead → ${r3(now.time)}s` };
  },
};

export async function runTool(d: DocHandle, name: string, rawArgs: string): Promise<ToolResult & { args: any }> {
  let args: any = {};
  try {
    args = rawArgs && rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch (e) {
    return { ok: false, args: rawArgs, text: `Invalid JSON arguments: ${(e as Error).message}. Call the tool again with valid JSON.`, summary: `${name}: invalid arguments` };
  }
  const impl = impls[name];
  if (!impl) return { ok: false, args, text: `Unknown tool "${name}"`, summary: `Unknown tool ${name}` };
  // tracks this call creates or empties (clips moved / deleted / joined onto a morph chain) are
  // dropped afterwards; tracks that were already empty are left alone, and set_tracks is the one
  // tool that may deliberately leave empty tracks behind
  const emptyBefore = emptyTrackIds(d.get().project);
  try {
    return { ...(await impl(args, d)), args };
  } catch (e: any) {
    return { ok: false, args, text: `Tool failed: ${e?.message || e}`, summary: `${name} failed` };
  } finally {
    if (name !== 'set_tracks') pruneTracks(d, emptyBefore);
  }
}

function pruneTracks(d: DocHandle, keep: Set<string>) {
  const p0 = d.get().project;
  const empty = emptyTrackIds(p0);
  if (![...empty].some((id) => !keep.has(id))) return;
  d.commit((p) => { removeEmptyTracks(p, keep); }, { transient: true });
}
