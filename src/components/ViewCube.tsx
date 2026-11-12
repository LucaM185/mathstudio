// CAD-style view cube: shows the current orientation, click a face / edge / corner to look from
// there, drag it to orbit. Y is up: the front face is the classic 2D view (XY plane from +z).
import { useEffect, useRef, useState } from 'react';
import { House, Scan, Video } from 'lucide-react';
import type { Cam } from '../ops';
import { useStore } from '../store';
import { basis, dot, orbit, unit, type V3 } from '../view3d';
import { currentNavView, fitNav, homeView, lookFrom, navTarget, setNavView, stopNavAnim } from '../nav';

type Face = { id: string; label: string; n: V3; u: V3; v: V3 };
// u × v = n; (u, v) is how the label reads when looking straight at the face
const FACES: Face[] = [
  { id: 'top', label: 'TOP', n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { id: 'bottom', label: 'BOTTOM', n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { id: 'front', label: 'FRONT', n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { id: 'back', label: 'BACK', n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  { id: 'right', label: 'RIGHT', n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { id: 'left', label: 'LEFT', n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
];
const EDGE = 0.6; // inner square of each face; the rim is split into edge and corner zones
const SIZE = 104;
const SCALE = 25;

export default function ViewCube({ view, editor }: { view: Cam; editor: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ sx: number; sy: number; v0: Cam; moved: boolean; dir: V3 | null; target: 'camera' | 'editor' } | null>(null);
  const { right, up, out } = basis(view);
  const c0 = SIZE / 2;
  const scr = (w: V3) => ({ x: c0 + dot(w, right) * SCALE, y: c0 - dot(w, up) * SCALE });

  const cells: { key: string; pts: string; dir: V3; shade: number; face: Face; i: number; j: number }[] = [];
  const labels: { face: Face; m: string; shade: number }[] = [];
  for (const f of FACES) {
    const facing = dot(f.n, out);
    if (facing <= 0.02) continue;
    const span = [[-1, -EDGE], [-EDGE, EDGE], [EDGE, 1]];
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const [a0, a1] = span[i + 1];
        const [b0, b1] = span[j + 1];
        const pts = ([[a0, b0], [a1, b0], [a1, b1], [a0, b1]] as const)
          .map(([a, b]) => scr([f.n[0] + a * f.u[0] + b * f.v[0], f.n[1] + a * f.u[1] + b * f.v[1], f.n[2] + a * f.u[2] + b * f.v[2]]))
          .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
          .join(' ');
        const dir = unit([f.n[0] + i * f.u[0] + j * f.v[0], f.n[1] + i * f.u[1] + j * f.v[1], f.n[2] + i * f.u[2] + j * f.v[2]]);
        // edges / corners are shared by faces: name them by direction so hovering lights all their parts
        const key = dir.map((d) => Math.round(d * 10)).join(',');
        cells.push({ key, pts, dir, shade: facing, face: f, i, j });
      }
    }
    const pu = { x: dot(f.u, right) * SCALE, y: -dot(f.u, up) * SCALE };
    const pv = { x: -dot(f.v, right) * SCALE, y: dot(f.v, up) * SCALE };
    const pc = scr(f.n);
    labels.push({ face: f, m: `matrix(${pu.x / 100} ${pu.y / 100} ${pv.x / 100} ${pv.y / 100} ${pc.x} ${pc.y})`, shade: facing });
  }

  // The gesture is tracked on window, not via pointer capture on the cell: cells are re-created
  // as faces turn in / out of view mid-drag, and a removed element silently drops its capture,
  // so the release was lost and the cube kept orbiting whenever the mouse passed over it.
  const end = useRef<(() => void) | null>(null);
  useEffect(() => () => end.current?.(), []);

  const onDown = (e: React.PointerEvent, dir: V3 | null) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    end.current?.();
    stopNavAnim();
    const target = navTarget();
    const pid = e.pointerId;
    drag.current = { sx: e.clientX, sy: e.clientY, v0: currentNavView(target), moved: false, dir, target };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (!(ev.buttons & 1)) return finish(false); // released somewhere we never heard about
      onMove(ev);
    };
    const up = (ev: PointerEvent) => ev.pointerId === pid && finish(true);
    const cancel = (ev: PointerEvent) => ev.pointerId === pid && finish(false);
    const blur = () => finish(false);
    const detach = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', blur);
      end.current = null;
    };
    const finish = (click: boolean) => {
      detach();
      onUp(click);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', blur);
    end.current = () => finish(false);
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      if (d.target === 'camera') useStore.getState().checkpoint();
      useStore.setState({ interacting: true, playing: false });
      setHover(null);
    }
    setNavView(orbit(d.v0, dx, dy), { transient: true, target: d.target });
  };
  const onUp = (click: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) useStore.setState({ interacting: false });
    else if (click && d.dir) lookFrom(d.dir);
  };

  // little x / y / z triad in the corner
  const axes: [string, V3, string][] = [['x', [1, 0, 0], '#ff6b6b'], ['y', [0, 1, 0], '#6bd96b'], ['z', [0, 0, 1], '#6aa8ff']];
  const ax0 = { x: 12, y: SIZE - 12 };

  return (
    <div className="view-cube" data-testid="view-cube" onContextMenu={(e) => e.preventDefault()}>
      <svg width={SIZE} height={SIZE} onPointerLeave={() => setHover(null)}>
        {cells.map((c, k) => (
          <polygon
            key={k}
            points={c.pts}
            className={`vc-cell ${c.i === 0 && c.j === 0 ? 'face' : 'rim'} ${hover === c.key ? 'hot' : ''}`}
            data-face={c.face.id}
            data-dir={c.key}
            style={{ fill: hover === c.key ? undefined : `rgba(${Math.round(150 + 70 * c.shade)}, ${Math.round(160 + 70 * c.shade)}, ${Math.round(180 + 60 * c.shade)}, 0.92)` }}
            onPointerEnter={() => !drag.current && setHover(c.key)}
            onPointerDown={(e) => onDown(e, c.dir)}
          >
            <title>{titleFor(c.dir)}</title>
          </polygon>
        ))}
        {labels.map((l) => (
          <g key={l.face.id} transform={l.m} className="vc-label" style={{ opacity: Math.min(1, 0.25 + l.shade * 1.2) }}>
            <text x={0} y={0} fontSize={l.face.label.length > 5 ? 34 : 40}>{l.face.label}</text>
          </g>
        ))}
        {axes.map(([name, a, color]) => {
          const p = { x: ax0.x + dot(a, right) * 10, y: ax0.y - dot(a, up) * 10 };
          return (
            <g key={name} className="vc-axis">
              <line x1={ax0.x} y1={ax0.y} x2={p.x} y2={p.y} stroke={color} />
              <text x={ax0.x + (p.x - ax0.x) * 1.45} y={ax0.y + (p.y - ax0.y) * 1.45} fill={color}>{name}</text>
            </g>
          );
        })}
      </svg>
      <div className="vc-btns">
        <button title="2D view (top, whole frame)" data-testid="vc-home" onClick={homeView}><House size={13} /></button>
        <button title="Zoom to fit (F)" data-testid="vc-fit" onClick={() => fitNav()}><Scan size={13} /></button>
        {editor && (
          <button title="Look through the camera (0)" data-testid="vc-camera" onClick={() => useStore.setState({ editorView: null })}><Video size={13} /></button>
        )}
      </div>
    </div>
  );
}

function titleFor(d: V3) {
  const names: string[] = [];
  if (d[1] > 0.3) names.push('top');
  if (d[1] < -0.3) names.push('bottom');
  if (d[2] > 0.3) names.push('front');
  if (d[2] < -0.3) names.push('back');
  if (d[0] > 0.3) names.push('right');
  if (d[0] < -0.3) names.push('left');
  const s = names.join('-');
  return `Look from ${s || 'here'}`;
}

