import { useEffect, useMemo, useRef } from 'react';
import { RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import { useStore } from '../store';
import { CAMERA_ID, MORPH_SEL, round, setTransformAt, transformAt } from '../ops';
import type { Cam } from '../ops';
import type { Clip } from '../types';
import { basis, dot, orientMatrix, type Axis, type Orient, type V3 } from '../view3d';

/**
 * 3D rotation widget, bottom-right of the stage while rotatable clips are selected. Each row drives
 * one of the clip's angles (colours match the view cube's axis triad), gimbal-style in the engine's
 * order: Z spins the clip in its own plane, X tips it, Y turns it about the vertical axis:
 *   ↶ / ↷ click = ±15° (Shift ±90°, Alt ±1°), hold = keep turning; drag the value = scrub;
 *   double-click the value = put that angle back to 0.
 * Values shown are the clip's Rot X / Rot Y / Rotation (the Inspector's fields) at the playhead;
 * with keyframes, edits go to (or create) the key at the playhead like every other stage edit.
 */

const AXES: { axis: Axis; field: keyof Orient; color: string; label: string }[] = [
  { axis: 'x', field: 'rx', color: '#ff6b6b', label: 'X' },
  { axis: 'y', field: 'ry', color: '#6bd96b', label: 'Y' },
  { axis: 'z', field: 'rotation', color: '#6aa8ff', label: 'Z' },
];
const HINT: Record<Axis, string> = { x: 'Tip (about X)', y: 'Turn (about Y)', z: 'Spin in its own plane (Z)' };
const HOLD_MS = 350;
const HOLD_DEG_PER_S = 90;
const SCRUB_DEG_PER_PX = 0.5;

const orientOf = (c: Clip, u: number): Orient => {
  const t = transformAt(c, u);
  return { rotation: t.rotation || 0, rx: t.rx || 0, ry: t.ry || 0 };
};

/** Selected clips the widget can turn: not the camera / a morph link, not on a locked track. */
export function rotatableIds(s: { selection: string[]; project: { clips: Clip[]; tracks: { id: string; locked?: boolean }[] } }) {
  const locked = new Set(s.project.tracks.filter((t) => t.locked).map((t) => t.id));
  return s.selection.filter((id) => {
    if (id === CAMERA_ID || id.startsWith(MORPH_SEL)) return false;
    const c = s.project.clips.find((c) => c.id === id);
    return !!c && !locked.has(c.track);
  });
}

type Gesture = { ids: string[]; start: Record<string, Orient>; field: keyof Orient; raf: number; timer: number; checkpointed: boolean };

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
  const begin = (axis: Axis): Gesture => {
    const field = AXES.find((a) => a.axis === axis)!.field;
    stop();
    const st = useStore.getState();
    const start: Record<string, Orient> = {};
    for (const id of ids) {
      const c = st.project.clips.find((c) => c.id === id);
      if (c) start[id] = orientOf(c, st.time - c.start);
    }
    g.current = { ids, start, field, raf: 0, timer: 0, checkpointed: false };
    return g.current;
  };
  /** Set the gesture's angle to its start value + `total` degrees on every selected clip. */
  const apply = (gs: Gesture, total: number) => {
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
        setTransformAt(c, st.time - c.start, { [gs.field]: round(o0[gs.field] + total, 2) }, fps);
      }
    }, { transient: true });
  };
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
    const gs = begin(axis);
    const step = sign * stepOf(e);
    apply(gs, step);
    // held: keep turning smoothly from where the click left it
    gs.timer = window.setTimeout(() => {
      const t0 = performance.now();
      const tick = () => {
        if (g.current !== gs) return;
        apply(gs, step + (sign * HOLD_DEG_PER_S * (performance.now() - t0)) / 1000);
        gs.raf = requestAnimationFrame(tick);
      };
      gs.raf = requestAnimationFrame(tick);
    }, HOLD_MS);
  };
  const onArrowKey = (e: React.MouseEvent, axis: Axis, sign: number) => {
    if (e.detail !== 0) return; // pointer clicks are handled on pointerdown; this is Enter / Space
    apply(begin(axis), sign * stepOf(e));
    stop();
  };

  const onValueDown = (e: React.PointerEvent, axis: Axis) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const gs = begin(axis);
    const x0 = e.clientX;
    const el = e.currentTarget as HTMLElement;
    const move = (ev: PointerEvent) => {
      if (g.current !== gs) return;
      const dx = ev.clientX - x0;
      if (!gs.checkpointed && Math.abs(dx) < 2) return;
      let total = dx * SCRUB_DEG_PER_PX;
      if (ev.shiftKey) total = Math.round(total / 15) * 15;
      apply(gs, total);
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
  const zeroField = (field: keyof Orient) => {
    stop();
    const st = useStore.getState();
    st.checkpoint();
    const fps = st.project.settings.fps;
    st.commit((p) => {
      for (const id of ids) {
        const c = p.clips.find((c) => c.id === id);
        if (c) setTransformAt(c, st.time - c.start, { [field]: 0 }, fps);
      }
    }, { transient: true });
  };
  const resetAll = () => {
    stop();
    const st = useStore.getState();
    st.checkpoint();
    const fps = st.project.settings.fps;
    st.commit((p) => {
      for (const id of ids) {
        const c = p.clips.find((c) => c.id === id);
        if (c) setTransformAt(c, st.time - c.start, { rotation: 0, rx: 0, ry: 0 }, fps);
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
      <OrientPreview view={view} o={cur} />
      <div className="rot-rows">
        <div className="rot-head">
          <span title={many ? `Turns all ${ids.length} selected clips, each about its own centre` : undefined}>Rotate{many ? ` · ${ids.length}` : ''}</span>
          <button className="rot-reset" disabled={!turned && !many} onClick={resetAll} title="Reset all rotations to 0°" data-testid="rot-reset"><Undo2 size={11} /></button>
        </div>
        {AXES.map(({ axis, field, color, label }) => (
          <div className="rot-row" key={axis} style={{ ['--axis' as any]: color }}>
            <button
              className="rot-arrow"
              data-testid={`rot-${axis}-ccw`}
              title={`${HINT[axis]} counter-clockwise · 15° (Shift 90°, Alt 1°) · hold to keep turning`}
              onPointerDown={(e) => onArrowDown(e, axis, 1)}
              onPointerUp={stop}
              onPointerCancel={stop}
              onClick={(e) => onArrowKey(e, axis, 1)}
            ><RotateCcw size={13} /></button>
            <div
              className="rot-val"
              data-testid={`rot-${axis}-val`}
              title={`${label === 'Z' ? 'Rotation' : `Rot ${label}`}: drag to turn (Shift = 15° steps) · double-click for 0°`}
              onPointerDown={(e) => onValueDown(e, axis)}
              onDoubleClick={() => zeroField(field)}
            >
              <span className="rot-axis">{label}</span>
              <span className="rot-num">{fmt(cur[field])}</span>
            </div>
            <button
              className="rot-arrow"
              data-testid={`rot-${axis}-cw`}
              title={`${HINT[axis]} clockwise · 15° (Shift 90°, Alt 1°) · hold to keep turning`}
              onPointerDown={(e) => onArrowDown(e, axis, -1)}
              onPointerUp={stop}
              onPointerCancel={stop}
              onClick={(e) => onArrowKey(e, axis, -1)}
            ><RotateCw size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The clip's orientation as a small card seen from the current view, over the world axes. */
function OrientPreview({ view, o }: { view: Cam; o: Orient }) {
  const S = 62, C = S / 2, k = 17;
  const { right, up, out } = basis(view);
  const m = orientMatrix(o);
  const turn = (p: V3): V3 => [0, 1, 2].map((i) => m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2]) as V3;
  const px = (p: V3) => ({ x: C + dot(p, right) * k, y: C - dot(p, up) * k });
  const card = ([[-1, -0.65, 0], [1, -0.65, 0], [1, 0.65, 0], [-1, 0.65, 0]] as V3[]).map((p) => px(turn(p)));
  // a notch on the card's top edge shows which way is up; the face tint shows front / back
  const notch = ([[-0.28, 0.65, 0], [0.28, 0.65, 0], [0, 1.05, 0]] as V3[]).map((p) => px(turn(p)));
  const facing = dot(turn([0, 0, 1]), out);
  const axes: [V3, string][] = [[[1, 0, 0], '#ff6b6b'], [[0, 1, 0], '#6bd96b'], [[0, 0, 1], '#6aa8ff']];
  // the card's front normal: still readable when the card is edge-on (drawn behind it when it points away)
  const nTip = px(turn([0, 0, 1.25]));
  const normalStub = (
    <g className="rot-normal">
      <line x1={C} y1={C} x2={nTip.x} y2={nTip.y} />
      <circle cx={nTip.x} cy={nTip.y} r={2.2} />
    </g>
  );
  const pts = (q: { x: number; y: number }[]) => q.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return (
    <svg className="rot-preview" width={S} height={S} viewBox={`0 0 ${S} ${S}`} data-testid="rot-preview" data-facing={facing >= 0 ? 'front' : 'back'}>
      <circle cx={C} cy={C} r={C - 1} className="rot-preview-bg" />
      {axes.map(([a, color], i) => {
        const p = px([a[0] * 1.55, a[1] * 1.55, a[2] * 1.55]);
        return <line key={i} x1={C} y1={C} x2={p.x} y2={p.y} stroke={color} className="rot-preview-axis" opacity={dot(a, out) < -0.2 ? 0.35 : 0.9} />;
      })}
      {facing < 0 && normalStub}
      <polygon points={pts(card)} className={`rot-card ${facing >= 0 ? 'front' : 'back'}`} />
      <polygon points={pts(notch)} className="rot-notch" />
      {facing >= 0 && normalStub}
    </svg>
  );
}
