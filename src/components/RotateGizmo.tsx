import { useEffect, useMemo, useRef } from 'react';
import { Undo2 } from 'lucide-react';
import { useStore } from '../store';
import { CAMERA_ID, MORPH_SEL, round, setTransformAt, transformAt } from '../ops';
import type { Cam } from '../ops';
import type { Clip } from '../types';
import { add, basis, dot, mul, orientMatrix, sub, turnWorld, type Axis, type Orient, type V3 } from '../view3d';

/**
 * 3D rotation widget, bottom-right of the stage while rotatable clips are selected.
 *
 * Three rings, one per world axis (colours match the view cube), drawn in 3D from the viewer's
 * current point of view, each around a small card that shows the clip's orientation. Every ring
 * carries two ribbon arrows on the side facing the viewer; an arrow points the way the near side of
 * the clip will move, whatever the camera angle:
 *   click = 15° that way (Shift 90°, Alt 1°), hold = keep turning.
 * Arrows turn the clip about the world axis through its centre, so what happens on the stage is
 * exactly what the arrow shows (on an already tilted clip that changes more than one of the
 * Inspector's angles). The chips below are those angles (Rot X / Rot Y / Rotation) at the playhead:
 * drag = scrub that one angle, double-click = 0. With keyframes, edits go to (or create) the key at
 * the playhead like every other stage edit.
 */

type Spec = { axis: Axis; field: keyof Orient; label: string; a: V3; u: V3; v: V3; bias: number; dark: string; base: string; light: string };
// u × v = a, so a ring angle grows the way a positive (right-handed) turn about `a` moves things
const AXES: Spec[] = [
  { axis: 'x', field: 'rx', label: 'X', a: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], bias: 1, dark: '#c23d3d', base: '#ff6b6b', light: '#ffc0c0' },
  { axis: 'y', field: 'ry', label: 'Y', a: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], bias: -1, dark: '#2f9d3c', base: '#6bd96b', light: '#c4f5c4' },
  { axis: 'z', field: 'rotation', label: 'Z', a: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], bias: 1, dark: '#2f6fd6', base: '#6aa8ff', light: '#c6ddff' },
];
const HOLD_MS = 350;
const HOLD_DEG_PER_S = 90;
const SCRUB_DEG_PER_PX = 0.5;
const DEG = Math.PI / 180;

const orientOf = (c: Clip, u: number): Orient => {
  const t = transformAt(c, u);
  return { rotation: t.rotation || 0, rx: t.rx || 0, ry: t.ry || 0 };
};
const rounded = (o: Orient): Orient => ({ rotation: round(o.rotation, 2), rx: round(o.rx, 2), ry: round(o.ry, 2) });

/** Selected clips the widget can turn: not the camera / a morph link, not on a locked track. */
export function rotatableIds(s: { selection: string[]; project: { clips: Clip[]; tracks: { id: string; locked?: boolean }[] } }) {
  const locked = new Set(s.project.tracks.filter((t) => t.locked).map((t) => t.id));
  return s.selection.filter((id) => {
    if (id === CAMERA_ID || id.startsWith(MORPH_SEL)) return false;
    const c = s.project.clips.find((c) => c.id === id);
    return !!c && !locked.has(c.track);
  });
}

type Gesture = { ids: string[]; start: Record<string, Orient>; last: Record<string, Orient>; raf: number; timer: number; checkpointed: boolean };

export default function RotateGizmo({ view }: { view: Cam }) {
  const selection = useStore((s) => s.selection);
  const project = useStore((s) => s.project);
  const time = useStore((s) => s.time);
  const ids = useMemo(() => rotatableIds({ selection, project }), [selection, project]);
  const g = useRef<Gesture | null>(null);

  useEffect(() => () => stop(), []);
  if (!ids.length) return null;
  const primary = project.clips.find((c) => c.id === ids[0])!;
  const cur = orientOf(primary, time - primary.start);

  // ---------------------------------------------------------------- editing
  const begin = (): Gesture => {
    stop();
    const st = useStore.getState();
    const start: Record<string, Orient> = {};
    for (const id of ids) {
      const c = st.project.clips.find((c) => c.id === id);
      if (c) start[id] = orientOf(c, st.time - c.start);
    }
    g.current = { ids, start, last: { ...start }, raf: 0, timer: 0, checkpointed: false };
    return g.current;
  };
  /** Give every selected clip the orientation `next(start, last)` (one undo step per gesture). */
  const apply = (gs: Gesture, next: (start: Orient, last: Orient) => Orient) => {
    const st = useStore.getState();
    if (!gs.checkpointed) {
      st.checkpoint();
      gs.checkpointed = true;
      useStore.setState({ interacting: true, playing: false });
    }
    const fps = st.project.settings.fps;
    st.commit((p) => {
      for (const id of gs.ids) {
        const c = p.clips.find((c) => c.id === id);
        const o0 = gs.start[id];
        if (!c || !o0) continue;
        const o = rounded(next(o0, gs.last[id]));
        gs.last[id] = o;
        setTransformAt(c, st.time - c.start, o, fps);
      }
    }, { transient: true });
  };
  /** Turn `total` degrees from the gesture's start about a world axis, each clip about its own centre. */
  const turn = (gs: Gesture, axis: Axis, total: number) => apply(gs, (o0, last) => turnWorld(o0, axis, total, last));
  function stop() {
    const gs = g.current;
    if (!gs) return;
    cancelAnimationFrame(gs.raf);
    clearTimeout(gs.timer);
    g.current = null;
    if (gs.checkpointed) useStore.setState({ interacting: false });
  }

  const stepOf = (e: { shiftKey: boolean; altKey: boolean }) => (e.shiftKey ? 90 : e.altKey ? 1 : 15);

  const onArrowDown = (e: React.PointerEvent, axis: Axis, sign: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const gs = begin();
    const step = sign * stepOf(e);
    turn(gs, axis, step);
    // held: keep turning smoothly from where the click left it
    gs.timer = window.setTimeout(() => {
      const t0 = performance.now();
      const tick = () => {
        if (g.current !== gs) return;
        turn(gs, axis, step + (sign * HOLD_DEG_PER_S * (performance.now() - t0)) / 1000);
        gs.raf = requestAnimationFrame(tick);
      };
      gs.raf = requestAnimationFrame(tick);
    }, HOLD_MS);
  };
  const onArrowKey = (e: React.KeyboardEvent, axis: Axis, sign: number) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    turn(begin(), axis, sign * stepOf(e));
    stop();
  };

  const onValueDown = (e: React.PointerEvent, field: keyof Orient) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const gs = begin();
    const x0 = e.clientX;
    const el = e.currentTarget as HTMLElement;
    const move = (ev: PointerEvent) => {
      if (g.current !== gs) return;
      const dx = ev.clientX - x0;
      if (!gs.checkpointed && Math.abs(dx) < 2) return;
      let total = dx * SCRUB_DEG_PER_PX;
      if (ev.shiftKey) total = Math.round(total / 15) * 15;
      apply(gs, (o0) => ({ ...o0, [field]: o0[field] + total }));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      stop();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const setAll = (patch: Partial<Orient>) => {
    stop();
    const st = useStore.getState();
    st.checkpoint();
    const fps = st.project.settings.fps;
    st.commit((p) => {
      for (const id of ids) {
        const c = p.clips.find((c) => c.id === id);
        if (c) setTransformAt(c, st.time - c.start, patch, fps);
      }
    }, { transient: true });
  };

  const fmt = (v: number) => `${Math.abs(v) < 0.05 ? 0 : Math.round(v * 10) / 10}°`;
  const turned = Math.abs(cur.rotation) > 1e-6 || Math.abs(cur.rx) > 1e-6 || Math.abs(cur.ry) > 1e-6;
  const many = ids.length > 1;

  return (
    <div
      className="rot-gizmo"
      data-testid="rot-gizmo"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="rot-head">
        <span title={many ? `Turns all ${ids.length} selected clips, each about its own centre` : 'Click an arrow: the side of the clip facing you moves the way the arrow points'}>Rotate{many ? ` · ${ids.length}` : ''}</span>
        <button className="rot-reset" disabled={!turned && !many} onClick={() => setAll({ rotation: 0, rx: 0, ry: 0 })} title="Reset all rotations to 0°" data-testid="rot-reset"><Undo2 size={11} /></button>
      </div>
      <div className="rot-rings">
        {AXES.map((spec) => (
          <div className="rot-cell" key={spec.axis} style={{ ['--axis' as any]: spec.base }}>
            <Ring
              view={view}
              o={cur}
              spec={spec}
              onDown={(e, sign) => onArrowDown(e, spec.axis, sign)}
              onKey={(e, sign) => onArrowKey(e, spec.axis, sign)}
              onUp={stop}
            />
            <div
              className="rot-val"
              data-testid={`rot-${spec.axis}-val`}
              title={`${spec.label === 'Z' ? 'Rotation' : `Rot ${spec.label}`} (as in the Inspector): drag to change just this angle (Shift = 15° steps) · double-click for 0°`}
              onPointerDown={(e) => onValueDown(e, spec.field)}
              onDoubleClick={() => setAll({ [spec.field]: 0 })}
            >
              <span className="rot-axis">{spec.label}</span>
              <span className="rot-num">{fmt(cur[spec.field])}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- one ring
const S = 88, C = S / 2, R = 30; // svg size, centre, ring radius (px)
const HB = 5.2, HH = 10.6;       // ribbon / arrowhead half-width
const A_GAP = 9, A_BODY = 50, A_TIP = 76; // arrow: degrees along the ring from the point facing the viewer
const BIAS = 0.3;

type P2 = { x: number; y: number };
const path = (q: P2[]) => `M${q.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}Z`;

/**
 * The ring about one world axis as seen from `view`: a ribbon band (a cone section tilted so that
 * its near part faces the viewer: a flat strip when the ring is edge-on, an annulus when face-on),
 * with the two arrows starting back to back at the point of the ring nearest the viewer.
 */
function Ring({ view, o, spec, onDown, onKey, onUp }: {
  view: Cam; o: Orient; spec: Spec;
  onDown: (e: React.PointerEvent, sign: number) => void;
  onKey: (e: React.KeyboardEvent, sign: number) => void;
  onUp: () => void;
}) {
  const { right, up, out } = basis(view);
  const { a, u, v, axis } = spec;
  const ao = dot(a, out), cr = Math.sqrt(Math.max(0, 1 - ao * ao));
  const rad = (f: number): V3 => add(mul(u, Math.cos(f)), mul(v, Math.sin(f)));
  /** Point of the ribbon at ring angle f, s px across it. */
  const pt = (f: number, s: number): V3 => {
    const r = rad(f);
    return add(mul(r, R), mul(add(mul(a, cr), mul(r, -ao)), s));
  };
  const px = (p: V3): P2 => ({ x: C + dot(p, right), y: C - dot(p, up) });

  // where the arrows sit: the ring point nearest the viewer; a face-on ring has none, so the more
  // face-on it is, the more they lean towards the top (bottom for the Y ring) of the screen, which
  // keeps them steady while orbiting
  const flat = (d: V3) => sub(d, mul(a, dot(d, a)));
  const front = add(flat(out), mul(flat(up), BIAS * spec.bias * Math.abs(ao)));
  const f0 = Math.atan2(dot(front, v), dot(front, u));

  // the band, as quads: far half first
  const N = 48;
  const back: string[] = [], near: string[] = [];
  for (let i = 0; i < N; i++) {
    const f1 = (i / N) * 2 * Math.PI, f2 = ((i + 1) / N) * 2 * Math.PI;
    const q = path([px(pt(f1, HB)), px(pt(f2, HB)), px(pt(f2, -HB)), px(pt(f1, -HB))]);
    (cr > 0.06 && dot(rad((f1 + f2) / 2), out) < 0 ? back : near).push(q);
  }

  // the clip, as a card (notch = its top edge; tint = front / back)
  const m = orientMatrix(o);
  const turnP = (p: V3): V3 => [0, 1, 2].map((i) => m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2]) as V3;
  const k = R * 0.5;
  const card = ([[-1, -0.65, 0], [1, -0.65, 0], [1, 0.65, 0], [-1, 0.65, 0]] as V3[]).map((p) => px(mul(turnP(p), k)));
  const notch = ([[-0.28, 0.65, 0], [0.28, 0.65, 0], [0, 1.02, 0]] as V3[]).map((p) => px(mul(turnP(p), k)));
  const facing = dot(turnP([0, 0, 1]), out);
  const ax0 = px(mul(a, -R * 1.32)), ax1 = px(mul(a, R * 1.32));

  const arrow = (sign: number) => {
    const at = (d: number) => f0 + sign * d * DEG;
    const n = 8;
    const top: P2[] = [], bot: P2[] = [];
    for (let i = 0; i <= n; i++) {
      const f = at(A_GAP + ((A_BODY - A_GAP) * i) / n);
      top.push(px(pt(f, HB)));
      bot.push(px(pt(f, -HB)));
    }
    const tail = px(pt(at(A_GAP), 0)), tip = px(pt(at(A_TIP), 0)), mid = px(pt(at((A_GAP + A_BODY) / 2 + 6), 0));
    const d = path([...top, px(pt(at(A_BODY), HH)), tip, px(pt(at(A_BODY), -HH)), ...bot.reverse()]);
    // the way the arrow sets off (where the near side of the clip goes), for tests
    const go = px(pt(at(A_GAP + 10), 0));
    const len = Math.hypot(go.x - tail.x, go.y - tail.y) || 1;
    const id = `rot-grad-${axis}-${sign > 0 ? 'p' : 'n'}`;
    const name = sign > 0 ? 'pos' : 'neg';
    return (
      <g
        key={name}
        className="rot-arrow"
        role="button"
        tabIndex={0}
        aria-label={`Turn 15° about ${spec.label}, ${sign > 0 ? 'counter-clockwise' : 'clockwise'} seen from +${spec.label}`}
        data-testid={`rot-${axis}-${name}`}
        data-mid={`${mid.x.toFixed(1)},${mid.y.toFixed(1)}`}
        data-dir={`${((go.x - tail.x) / len).toFixed(4)},${((go.y - tail.y) / len).toFixed(4)}`}
        onPointerDown={(e) => onDown(e, sign)}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={(e) => onKey(e, sign)}
      >
        <title>{`Turn 15° this way (about ${spec.label}): the side facing you follows the arrow · Shift 90° · Alt 1° · hold to keep turning`}</title>
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={tail.x} y1={tail.y} x2={tip.x} y2={tip.y}>
            <stop offset="0" stopColor={spec.dark} />
            <stop offset="0.6" stopColor={spec.base} />
            <stop offset="1" stopColor={spec.light} />
          </linearGradient>
        </defs>
        <path d={d} className="rot-arrow-hit" />
        <path d={d} className="rot-arrow-edge" fill={spec.dark} transform="translate(0 1.8)" />
        <path d={d} className="rot-arrow-shape" fill={`url(#${id})`} />
      </g>
    );
  };

  return (
    <svg className="rot-ring" width={S} height={S} viewBox={`0 0 ${S} ${S}`} data-testid={`rot-ring-${axis}`} data-facing={facing >= 0 ? 'front' : 'back'}>
      <line x1={ax0.x} y1={ax0.y} x2={ax1.x} y2={ax1.y} className="rot-axis-line" />
      <path d={back.join('')} className="rot-band back" />
      <polygon points={card.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} className={`rot-card ${facing >= 0 ? 'front' : 'back'}`} />
      <polygon points={notch.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} className="rot-notch" />
      <path d={near.join('')} className="rot-band near" />
      {arrow(1)}
      {arrow(-1)}
    </svg>
  );
}
