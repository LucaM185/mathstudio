import { useEffect, useMemo, useRef, useState } from 'react';
import { previewCap } from '../quality';
import { editClipCode, revealInspector, useStore } from '../store';
import { FrameFetcher } from '../engine';
import { DND_ASSET, DND_ITEM } from './Library';
import { addAsset, addItem, importFiles, loadExample } from '../actions';
import { CAMERA_ID, MORPH_SEL, camRect, cameraAt, isFlat, overviewView, round, setCameraAt, setTransformAt, transformAt } from '../ops';
import type { Cam } from '../ops';
import type { Clip, FrameMeta, Transform } from '../types';
import ViewCube from './ViewCube';
import { basis, boxCorners, convexHull, isTilted, inPolygon, IDENTITY_CAM, orbit, pan, polyArea, projector, zoomAt, type Projector, type Pt, type V3 } from '../view3d';
import { cameraToEditorView, currentNavView, exitEditorView, navTarget, setNavView, stageSize, stopNavAnim, type NavTarget } from '../nav';
import { Crop, Video } from 'lucide-react';
import { cachedParts, findNode, isGroupTree, movePart, openKey, parentPath, partAt, partBox, partName, pathChain, useClipParts } from '../parts';
import type { PartNode } from '../types';

const FW = 14.222222222222221;
const FH = 8;

const MAX_ZOOM = 40;
const MIN_ZOOM = 0.05;

/** Centre crosshair. A dark halo keeps it readable on light glyphs and the grid. */
function CenterPlus({ hot, size = 8, tone = 'object' }: { hot?: boolean; size?: number; tone?: 'camera' | 'object' }) {
  return (
    <g className={`center-plus-wrap ${tone} ${hot ? 'hot' : ''}`}>
      <g className="center-plus-shadow">
        <line x1={-size} x2={size} /><line y1={-size} y2={size} />
      </g>
      <g className="center-plus">
        <line x1={-size} x2={size} /><line y1={-size} y2={size} />
        <circle className={tone === 'object' ? 'center-dot' : undefined} r={2.75} />
      </g>
    </g>
  );
}

/** Picking within this many px of a centre crosshair snaps that centre onto other centres. */
const CENTER_GRAB = 16;

function nearestCenter(x: number, y: number, pts: { x: number; y: number }[], tol: number) {
  let best: { x: number; y: number; d: number } | null = null;
  for (const p of pts) {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d <= tol && (!best || d < best.d)) best = { x: p.x, y: p.y, d };
  }
  return best;
}

function nearestAxis(v: number, targets: number[], tol: number) {
  let best = tol;
  let hit: number | undefined;
  for (const t of targets) {
    const d = Math.abs(t - v);
    if (d < best) { best = d; hit = t; }
  }
  return hit;
}

// While the camera is selected (and "Full scene" is on) the preview shows the whole scene and the
// camera's view as a crop box. The overview is frozen during a gesture so the stage doesn't refit under the cursor.
// The full-scene overview is a 2D tool: with a tilted (3D) camera the preview looks through the camera instead.
let frozenView: Cam | null = null;
type ViewState = { selection: string[]; camFullView: boolean; project: import('../types').Project; time: number; editorView: Cam | null };
export function previewView(s: ViewState): (Cam & { grid?: boolean }) | null {
  // free editor view (CAD-style navigation; also while the camera is selected); a ground grid helps to read 3D views
  if (s.editorView) return isFlat(s.editorView) ? s.editorView : { ...s.editorView, grid: true };
  if (s.selection.includes(CAMERA_ID)) {
    if (!s.camFullView || !isFlat(cameraAt(s.project, s.time))) return null;
    return frozenView || overviewView(s.project);
  }
  return null;
}

type Drag =
  | { kind: 'nav'; mode: 'orbit' | 'pan'; sx: number; sy: number; v0: Cam; viewZoom: number; moved: boolean; target: NavTarget }
  | { kind: 'crop-move'; sx: number; sy: number; x0: number; y0: number; moved: boolean; fromCenter: boolean }
  | { kind: 'crop-size'; ax: number; ay: number; dx: number; dy: number; cx: number; cy: number; moved: boolean }
  | { kind: 'crop-draw'; ax: number; ay: number; sx: number; sy: number; moved: boolean }
  | { kind: 'move'; ids: string[]; sx: number; sy: number; start: Record<string, Transform>; moved: boolean; unit: number; fromCenter: boolean }
  | { kind: 'move3d'; ids: string[]; sx: number; sy: number; start: Record<string, Transform>; moved: boolean; pr: Projector; n: V3 | null; p0: V3; hit0: V3 | null; fromCenter: boolean }
  | { kind: 'part'; id: string; path: string; sx: number; sy: number; k: number; rot: number; d0: { dx: number; dy: number }; moved: boolean; box0: [number, number, number, number]; snapX: number[]; snapY: number[] }
  | { kind: 'scale'; id: string; cx: number; cy: number; d0: number; s0: number }
  | { kind: 'rotate'; id: string; cx: number; cy: number; last: number; acc: number; r0: number; sign: number };

export default function Preview() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState({ w: 960, h: 540 });
  const meta = useStore((s) => s.meta);
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const time = useStore((s) => s.time);
  const snapping = useStore((s) => s.snapping);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guides, setGuides] = useState<{ x?: number; y?: number; sx?: number; sy?: number }>({});
  // guides while dragging a part: lines in the clip's own coordinates (they turn with the clip)
  const [partGuides, setPartGuides] = useState<{ x?: number; y?: number }>({});
  const [partHover, setPartHover] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [centerHot, setCenterHot] = useState<string | null>(null);
  const [dropPos, setDropPos] = useState<{ x: number; y: number } | null>(null);
  const baseSizes = useRef<Record<string, { w: number; h: number; d: number; ox: number; oy: number }>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const lastFrameAt = useRef(0);
  const wheelSession = useRef<any>(0);
  const camFullView = useStore((s) => s.camFullView);
  const editorView = useStore((s) => s.editorView);
  const navSuppress = useRef(false);
  const [cropHover, setCropHover] = useState(false);
  const [, bump] = useState(0);
  const reqRef = useRef<() => void>(() => {});
  const animPreview = useStore((s) => s.animPreview);
  const previewProjects = useRef(new WeakSet<object>());
  const previewBar = useRef<HTMLDivElement>(null);

  // ------------------------------------------------------------------ sizing
  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const pad = 20;
      const aw = Math.max(100, r.width - pad * 2);
      const ah = Math.max(60, r.height - pad * 2);
      let w = aw;
      let h = (w * 9) / 16;
      if (h > ah) {
        h = ah;
        w = (h * 16) / 9;
      }
      setStage({ w: Math.floor(w), h: Math.floor(h) });
      stageSize.w = Math.floor(w);
      stageSize.h = Math.floor(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ------------------------------------------------------------------ frame fetching
  const fetcher = useMemo(
    () =>
      new FrameFetcher(
        (data, m: FrameMeta, project) => {
          const c = canvasRef.current;
          if (!c) return;
          if (c.width !== m.w || c.height !== m.h) {
            c.width = m.w;
            c.height = m.h;
          }
          const ctx = c.getContext('2d')!;
          ctx.putImageData(new ImageData(data, m.w, m.h), 0, 0);
          for (const [id, info] of Object.entries(m.clips)) {
            if (info.scale > 1e-6) baseSizes.current[id] = { w: info.w / info.scale, h: info.h / info.scale, d: (info.d || 0) / info.scale, ox: info.ox || 0, oy: info.oy || 0 };
          }
          lastFrameAt.current = performance.now();
          // animation-picker preview frames come from a scratch project: don't let them drive handles/hit-testing
          if (previewProjects.current.has(project)) return;
          useStore.setState({ meta: m, metaProject: project });
          setErrorMsg(null);
        },
        (e) => {
          setErrorMsg(String(e?.message || e));
        },
      ),
    [],
  );

  const pixelSize = () => {
    const dpr = window.devicePixelRatio || 1;
    const { playing, interacting, animPreview, renderQuality, gl } = useStore.getState();
    // lighter frames while playing or dragging, full quality when idle; caps from Settings → quality
    const maxW = previewCap(renderQuality, gl, !!(playing || interacting || animPreview));
    let w = Math.min(maxW, Math.round(stage.w * dpr));
    w -= w % 16;
    const h = Math.round((w * 9) / 16);
    return { w, h: h - (h % 2) };
  };

  useEffect(() => {
    const req = () => {
      const s = useStore.getState();
      if (!s.port || s.engineStatus !== 'ready' || s.animPreview) return;
      const { w, h } = pixelSize();
      fetcher.request(s.project, s.time, w, h, previewView(s));
    };
    reqRef.current = req;
    req();
    const unsub = useStore.subscribe((s, prev) => {
      if (!s.animPreview && prev.animPreview) return req();
      if (s.project !== prev.project || s.time !== prev.time || s.port !== prev.port || s.engineStatus !== prev.engineStatus || s.playing !== prev.playing || s.interacting !== prev.interacting || s.renderQuality !== prev.renderQuality || s.gl !== prev.gl) req();
      else if ((s.selection !== prev.selection || s.camFullView !== prev.camFullView || s.editorView !== prev.editorView) && JSON.stringify(previewView(s)) !== JSON.stringify(previewView(prev))) req();
    });
    return unsub;
  }, [stage, fetcher]);

  // ------------------------------------------------------------------ animation-picker preview
  // While an animation picker is open, loop the candidate animation (on a scratch copy of
  // the project, so every other clip keeps playing around it) in the main viewer.
  useEffect(() => {
    if (!animPreview) return;
    const { project: pp, t0, t1 } = animPreview;
    previewProjects.current.add(pp);
    const span = Math.max(0.05, t1 - t0);
    const HOLD = 0.6;
    const startAt = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const s = useStore.getState();
      const local = ((now - startAt) / 1000) % (span + HOLD);
      const t = t0 + Math.min(local, span);
      if (previewBar.current) previewBar.current.style.width = `${(Math.min(local, span) / span) * 100}%`;
      if (s.port && s.engineStatus === 'ready' && !fetcher.isBusy) {
        const { w, h } = pixelSize();
        fetcher.request(pp, t, w, h, previewView(s));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animPreview, fetcher, stage]);

  // ------------------------------------------------------------------ playback
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = useStore.getState();
      if (!s.playing) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let t = s.time + dt;
      const d = s.project.settings.duration;
      if (t >= d) {
        if (s.loop) t = 0;
        else {
          useStore.setState({ playing: false, time: d });
          return;
        }
      }
      useStore.setState({ time: t });
      raf = requestAnimationFrame(tick);
    };
    const unsub = useStore.subscribe((s, prev) => {
      if (s.playing && !prev.playing) {
        if (s.time >= s.project.settings.duration - 1e-3) useStore.setState({ time: 0 });
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
      if (!s.playing && prev.playing) cancelAnimationFrame(raf);
    });
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, []);

  // ------------------------------------------------------------------ coordinates
  const cam = cameraAt(project, time); // what the camera sees (what gets exported)
  const cameraSelected = selection.includes(CAMERA_ID);
  const camFlat = isFlat(cam);
  const freeView = editorView; // CAD-style editor viewpoint (navigation never moves the camera)
  const fullView = cameraSelected && camFullView && camFlat && !freeView;
  const view: Cam = fullView ? frozenView || overviewView(project) : freeView || cam; // what the preview shows
  const viewKey = JSON.stringify(view);
  const pr = useMemo(() => projector(view, stage.w, stage.h), [viewKey, stage]);
  const prFixed = useMemo(() => projector(IDENTITY_CAM, stage.w, stage.h), [stage]);
  const toPx = (x: number, y: number) => pr.project([x, y, 0]);
  const toWorld = (px: number, py: number) => {
    const p = pr.toPlane(px, py, [0, 0, 1], [0, 0, 0]);
    return p ? { x: p[0], y: p[1] } : { x: view.x, y: view.y };
  };
  const unit = pr.unit; // px per world unit (on the focal plane)
  const insideCrop = (px: number, py: number) => {
    const w = toWorld(px, py);
    const r = camRect(cam);
    return w.x >= r[0] && w.x <= r[2] && w.y >= r[1] && w.y <= r[3];
  };
  const unfreeze = () => {
    if (!frozenView) return;
    frozenView = null;
    bump((n) => n + 1);
    reqRef.current();
  };

  const trackIndex = useMemo(() => Object.fromEntries(project.tracks.map((t, i) => [t.id, i])), [project.tracks]);
  const lockedTracks = useMemo(() => new Set(project.tracks.filter((t) => t.locked).map((t) => t.id)), [project.tracks]);

  // boxes for visible clips (computed from the project for instant feedback, sizes from the engine).
  // Flat views use rotated rectangles; tilted (3D) views use the projected outline of the clip's 3D box.
  type Box = { clip: Clip; cx: number; cy: number; w: number; h: number; ox: number; oy: number; rot: number; tr: Transform; pr: Projector; poly: Pt[] | null; edges: [Pt, Pt][]; ax: number; ay: number; area: number };
  const boxes: Box[] = useMemo(() => {
    if (!meta) return [];
    const out: Box[] = [];
    for (const c of project.clips) {
      const info = meta.clips[c.id];
      if (!info) continue;
      if (!(c.start <= time && time < c.start + c.duration)) continue;
      const tr = transformAt(c, time - c.start);
      const bs = baseSizes.current[c.id] || { w: 1, h: 1, d: 0, ox: 0, oy: 0 };
      const bpr = c.fixed ? prFixed : pr;
      if (bpr.flat && Math.abs(tr.z || 0) < 1e-9 && !isTilted(tr)) {
        const p = bpr.project([tr.x, tr.y, 0]);
        const w = Math.max(6, bs.w * tr.scale * bpr.unit);
        const h = Math.max(6, bs.h * tr.scale * bpr.unit);
        // offset of the drawn content from the pivot, in the box's rotated frame (screen y down)
        const ox = bs.ox * tr.scale * bpr.unit, oy = -bs.oy * tr.scale * bpr.unit;
        out.push({ clip: c, cx: p.x, cy: p.y, w, h, ox, oy, rot: tr.rotation, tr, pr: bpr, poly: null, edges: [], ax: p.x, ay: p.y, area: w * h });
        continue;
      }
      const all = boxCorners({ ...tr, z: tr.z || 0 }, { w: bs.w, h: bs.h, d: bs.d || 0, ox: bs.ox, oy: bs.oy }).map((q) => bpr.project(q));
      const pts = all.filter((q) => q.ok);
      if (!pts.length) continue;
      // wireframe of the 3D bounding box (bottom ring, top ring, verticals), as CAD tools draw it
      const edges: [Pt, Pt][] = [];
      const ring = (o: number) => [0, 1, 2, 3].map((i) => [o + i, o + ((i + 1) % 4)] as const);
      const pairs = all.length === 8 ? [...ring(0), ...ring(4), ...[0, 1, 2, 3].map((i) => [i, i + 4] as const)] : ring(0);
      for (const [i, j] of pairs) if (all[i].ok && all[j].ok) edges.push([all[i], all[j]]);
      const poly = convexHull(pts.map((q) => ({ x: q.x, y: q.y })));
      const ctr = bpr.project([tr.x, tr.y, tr.z || 0]);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of poly) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
      out.push({ clip: c, cx: ctr.x, cy: ctr.y, w: Math.max(6, x1 - x0), h: Math.max(6, y1 - y0), ox: 0, oy: 0, rot: 0, tr, pr: bpr, poly, edges, ax: (x0 + x1) / 2, ay: (y0 + y1) / 2, area: Math.max(36, polyArea(poly)) });
    }
    // front-most first (track 0 = front)
    out.sort((a, b) => trackIndex[a.clip.track] - trackIndex[b.clip.track]);
    return out;
  }, [meta, project, time, stage, trackIndex, pr, prFixed]);

  const hit = (px: number, py: number): Box | null => {
    const hits: Box[] = [];
    for (const b of boxes) {
      if (lockedTracks.has(b.clip.track)) continue;
      if (b.poly) {
        if (inPolygon({ x: px, y: py }, b.poly, 4)) hits.push(b);
        continue;
      }
      const a = (-b.rot * Math.PI) / 180;
      const dx = px - b.cx;
      const dy = py - b.cy;
      // screen y is down, world rotation is counter-clockwise
      const lx = dx * Math.cos(a) + dy * Math.sin(a) - b.ox;
      const ly = -dx * Math.sin(a) + dy * Math.cos(a) - b.oy;
      const pad = 4;
      if (Math.abs(lx) <= b.w / 2 + pad && Math.abs(ly) <= b.h / 2 + pad) hits.push(b);
    }
    if (hits.length <= 1 || !hits.some((b) => b.poly)) return hits[0] || null;
    // in 3D the outlines of big things (axes, planes) cover everything: prefer the smallest one under the pointer
    return hits.reduce((best, b) => (b.area < best.area ? b : best));
  };

  // ------------------------------------------------------------------ parts of a group clip
  // A selected part can be dragged on its own; clicking inside its clip picks one of its siblings,
  // double-click goes one level deeper (Figma-style), Escape one level up.
  /** pixels per clip unit, and a screen point in the clip's own (unscaled, unrotated, y-up) coordinates */
  const clipK = (b: Box) => Math.max(b.tr.scale, 1e-4) * b.pr.unit;
  const toClip = (b: Box, px: number, py: number) => {
    const k = clipK(b);
    const lx = px - b.cx, ly = -(py - b.cy);
    const r = (b.rot * Math.PI) / 180;
    return { x: (lx * Math.cos(r) + ly * Math.sin(r)) / k, y: (-lx * Math.sin(r) + ly * Math.cos(r)) / k };
  };
  /** The sibling of the selected part under the pointer (only inside the clip the part belongs to). */
  const partHit = (px: number, py: number): { b: Box; node: PartNode } | null => {
    const sp = useStore.getState().selectedPart;
    if (!sp) return null;
    const b = boxes.find((x) => x.clip.id === sp.clip);
    if (!b || b.poly || lockedTracks.has(b.clip.track)) return null;
    const tree = cachedParts(b.clip);
    const q = toClip(b, px, py);
    const node = partAt(b.clip, tree, parentPath(sp.path), q.x, q.y, 4 / clipK(b));
    return node ? { b, node } : null;
  };
  const selectPart = (clipId: string, path: string, section: 'parts' | 'params' = 'parts') => {
    const st = useStore.getState();
    // show its row on the timeline (and the rows of the groups it is in)
    const want = [clipId, ...pathChain(path).slice(0, -1).map((p) => openKey(clipId, p))].filter((k) => !st.partsOpen.includes(k));
    useStore.setState({ selection: [clipId], selectedKey: null, selectedPart: { clip: clipId, path }, ...(want.length ? { partsOpen: [...st.partsOpen, ...want] } : {}) });
    // a double-click opens the clip's parameters; picking a sibling shows the part's timing/position
    revealInspector(clipId, section);
  };
  const startPartDrag = (e: React.PointerEvent, b: Box, node: PartNode) => {
    const c = b.clip;
    const tree = cachedParts(c);
    const own = c.parts?.[node.path];
    // the part's centre snaps back to where the code put it, onto its siblings' centres and the clip's pivot
    const sib = findNode(tree, parentPath(node.path))?.children || [];
    const snapX: number[] = [0], snapY: number[] = [0];
    const pb = partBox(c, node);
    const ocx = (pb[0] + pb[2]) / 2 - (own?.dx || 0), ocy = (pb[1] + pb[3]) / 2 - (own?.dy || 0);
    snapX.push(ocx);
    snapY.push(ocy);
    for (const s of sib) {
      if (s.path === node.path) continue;
      const sb = partBox(c, s);
      if (sb[2] - sb[0] < 1e-6 && sb[3] - sb[1] < 1e-6) continue;
      snapX.push((sb[0] + sb[2]) / 2);
      snapY.push((sb[1] + sb[3]) / 2);
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag({ kind: 'part', id: c.id, path: node.path, sx: e.clientX, sy: e.clientY, k: clipK(b), rot: b.rot, d0: { dx: own?.dx || 0, dy: own?.dy || 0 }, moved: false, box0: pb, snapX, snapY });
    useStore.setState({ interacting: true, playing: false });
  };

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const r = (e as any).currentTarget?.getBoundingClientRect?.() || canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const stageRect = () => canvasRef.current!.getBoundingClientRect();

  // ------------------------------------------------------------------ interactions
  // CAD-style navigation: right / middle drag or ⌥-drag orbits, add ⇧ to pan, scroll / pinch zooms to the pointer
  const startNav = (e: React.PointerEvent, mode: 'orbit' | 'pan') => {
    (e.target as Element).setPointerCapture(e.pointerId);
    frozenView = null;
    stopNavAnim(); // a fly-to still running would fight the drag
    const target = navTarget();
    // start from what's on screen (camera or full-scene overview) so entering the editor view doesn't jump
    setDrag({ kind: 'nav', mode, sx: e.clientX, sy: e.clientY, v0: currentNavView(target, view), viewZoom: view.zoom, moved: false, target });
    useStore.setState({ interacting: true, playing: false });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (useStore.getState().animPreview) return;
    if (e.button === 1 || e.button === 2 || (e.button === 0 && (e.altKey || e.ctrlKey))) {
      e.preventDefault();
      startNav(e, e.shiftKey ? 'pan' : 'orbit');
      return;
    }
    if (e.button !== 0) return;
    const r = stageRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const st = useStore.getState();
    if (st.selection.includes(CAMERA_ID)) {
      (e.target as Element).setPointerCapture(e.pointerId);
      if (fullView) {
        frozenView = view;
        useStore.setState({ playing: false });
        if (insideCrop(px, py)) {
          const c = toPx(cam.x, cam.y);
          setDrag({ kind: 'crop-move', sx: e.clientX, sy: e.clientY, x0: cam.x, y0: cam.y, moved: false, fromCenter: Math.hypot(px - c.x, py - c.y) <= CENTER_GRAB });
        }
        else {
          const w = toWorld(px, py);
          setDrag({ kind: 'crop-draw', ax: w.x, ay: w.y, sx: e.clientX, sy: e.clientY, moved: false });
        }
        return;
      }
      startNav(e, 'pan');
      return;
    }
    if (!e.shiftKey && !e.metaKey) {
      const ph = partHit(px, py);
      if (ph) {
        if (st.selectedPart?.path !== ph.node.path) selectPart(ph.b.clip.id, ph.node.path);
        startPartDrag(e, ph.b, ph.node);
        return;
      }
    }
    const b = hit(px, py);
    if (!b) {
      if (!e.shiftKey) useStore.setState({ selection: [], selectedKey: null, selectedPart: null });
      return;
    }
    let ids = st.selection;
    if (e.shiftKey || e.metaKey) {
      st.select([b.clip.id], true);
      return;
    }
    if (!ids.includes(b.clip.id)) {
      ids = [b.clip.id];
      useStore.setState({ selection: ids, selectedKey: null, selectedPart: null });
    } else if (st.selectedPart) useStore.setState({ selectedPart: null }); // clicked the clip, not one of the parts
    const start: Record<string, Transform> = {};
    for (const id of ids) {
      const c = st.project.clips.find((c) => c.id === id);
      if (c && !lockedTracks.has(c.track)) start[id] = transformAt(c, st.time - c.start);
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    const fromCenter = Math.hypot(px - b.cx, py - b.cy) <= CENTER_GRAB;
    ids = [b.clip.id, ...Object.keys(start).filter((id) => id !== b.clip.id)];
    if (!b.poly) {
      setDrag({ kind: 'move', ids, sx: e.clientX, sy: e.clientY, start, moved: false, unit: b.pr.unit, fromCenter });
    } else {
      // 3D: slide on the ground plane through the object, like a CAD move. When the view is close to
      // edge-on (looking from the side), use the vertical plane that faces the viewer instead.
      const p0: V3 = [b.tr.x, b.tr.y, b.tr.z || 0];
      const o = b.pr.out;
      const k = Math.abs(o[2]) > 0.26 ? 2 : Math.abs(o[0]) > Math.abs(o[1]) ? 0 : 1;
      const n: V3 = [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0];
      const hit0 = b.pr.toPlane(px, py, n, p0);
      setDrag({ kind: 'move3d', ids, sx: e.clientX, sy: e.clientY, start, moved: false, pr: b.pr, n: hit0 ? n : null, p0, hit0, fromCenter });
    }
    useStore.setState({ interacting: true, playing: false });
  };

  const onHandleDown = (e: React.PointerEvent, b: Box, kind: 'scale' | 'rotate') => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const r = stageRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    useStore.getState().checkpoint();
    (e.target as Element).setPointerCapture(e.pointerId);
    if (kind === 'scale') {
      setDrag({ kind: 'scale', id: b.clip.id, cx: b.cx, cy: b.cy, d0: Math.hypot(px - b.cx, py - b.cy), s0: b.tr.scale });
    } else {
      // seen from below (camera under the xy plane) a counter-clockwise turn looks clockwise
      const sign = b.poly && b.pr.out[2] < 0 ? -1 : 1;
      setDrag({ kind: 'rotate', id: b.clip.id, cx: b.cx, cy: b.cy, last: Math.atan2(-(py - b.cy), px - b.cx), acc: 0, r0: b.tr.rotation, sign });
    }
    useStore.setState({ interacting: true, playing: false });
  };

  const onCropHandleDown = (e: React.PointerEvent, dx: number, dy: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const r = camRect(cam);
    frozenView = view;
    (e.target as Element).setPointerCapture(e.pointerId);
    // anchor = the opposite corner (world y is up: dy = 1 is the top edge)
    setDrag({ kind: 'crop-size', ax: dx > 0 ? r[0] : r[2], ay: dy > 0 ? r[1] : r[3], dx, dy, cx: cam.x, cy: cam.y, moved: false });
    useStore.setState({ playing: false });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const r = stageRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    if (!drag) {
      if (cameraSelected) {
        if (fullView) {
          setCropHover(insideCrop(px, py));
          const c = toPx(cam.x, cam.y);
          setCenterHot(Math.hypot(px - c.x, py - c.y) <= CENTER_GRAB ? 'camera' : null);
        } else setCenterHot(null);
        return;
      }
      const ph = partHit(px, py);
      setPartHover(ph ? ph.node.path : null);
      const b = ph ? null : hit(px, py);
      setHover(b ? b.clip.id : null);
      setCenterHot(b && Math.hypot(px - b.cx, py - b.cy) <= CENTER_GRAB ? b.clip.id : null);
      return;
    }
    if (drag.kind === 'part') {
      const st = useStore.getState();
      const ddx = e.clientX - drag.sx, ddy = e.clientY - drag.sy;
      if (!drag.moved) {
        if (Math.hypot(ddx, ddy) < 3) return;
        st.checkpoint();
        drag.moved = true;
      }
      // screen delta -> the clip's own units (undo its rotation and scale)
      const r = (drag.rot * Math.PI) / 180;
      const wx = ddx / drag.k, wy = -ddy / drag.k;
      let mx = wx * Math.cos(r) + wy * Math.sin(r);
      let my = -wx * Math.sin(r) + wy * Math.cos(r);
      const g: { x?: number; y?: number } = {};
      if (st.snapping && !e.metaKey) {
        const tol = 7 / drag.k;
        const cx = (drag.box0[0] + drag.box0[2]) / 2 + mx, cy = (drag.box0[1] + drag.box0[3]) / 2 + my;
        const sx = nearestAxis(cx, drag.snapX, tol);
        const sy = nearestAxis(cy, drag.snapY, tol);
        if (sx !== undefined) { mx += sx - cx; g.x = sx; }
        if (sy !== undefined) { my += sy - cy; g.y = sy; }
      }
      if (e.shiftKey) {
        if (Math.abs(mx) > Math.abs(my)) { my = 0; g.y = undefined; }
        else { mx = 0; g.x = undefined; }
      }
      setPartGuides(g);
      st.commit((p) => {
        const c = p.clips.find((c) => c.id === drag.id);
        if (c) movePart(c, drag.path, drag.d0.dx + mx, drag.d0.dy + my);
      }, { transient: true });
      return;
    }
    const st = useStore.getState();
    const fps = st.project.settings.fps;
    if (drag.kind === 'nav') {
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < 3) return;
        if (drag.target === 'camera') st.checkpoint();
        drag.moved = true;
      }
      const v = drag.mode === 'orbit' ? orbit(drag.v0, dx, dy) : pan(drag.v0, dx, dy, stage.w, drag.target === 'camera' && fullView ? drag.viewZoom : drag.v0.zoom);
      setNavView(v, { transient: true, target: drag.target });
      return;
    }
    if (drag.kind === 'crop-move') {
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
        st.checkpoint();
        drag.moved = true;
      }
      let nx = drag.x0 + (e.clientX - drag.sx) / unit;
      let ny = drag.y0 - (e.clientY - drag.sy) / unit;
      if (e.shiftKey) {
        if (Math.abs(nx - drag.x0) > Math.abs(ny - drag.y0)) ny = drag.y0;
        else nx = drag.x0;
      }
      // edges snap to the scene frame; the centre snaps to the origin.
      // picked by the + : the centre also locks onto other objects' centres.
      const g: { x?: number; y?: number } = {};
      if (st.snapping && !e.metaKey) {
        const hw = FW / 2 / cam.zoom;
        const hh = FH / 2 / cam.zoom;
        const tol = 8 / unit;
        const centers = [{ x: 0, y: 0 }, ...boxes.filter((b) => !b.clip.fixed).map((b) => ({ x: b.tr.x, y: b.tr.y }))];
        const hit = drag.fromCenter && !e.shiftKey ? nearestCenter(nx, ny, centers, 14 / unit) : null;
        if (hit) {
          nx = hit.x;
          ny = hit.y;
          g.x = hit.x;
          g.y = hit.y;
        } else {
          const extraX = drag.fromCenter ? centers.map((c) => c.x) : [];
          const extraY = drag.fromCenter ? centers.map((c) => c.y) : [];
          const snap = (c: number, half: number, edge: number, extra: number[]) => {
            let best: { d: number; line: number; shift: number } | null = null;
            const cands: [number, number][] = [[c, 0], [c - half, -edge], [c + half, edge]];
            for (const t of extra) cands.push([c, t]);
            for (const [v, line] of cands) {
              const d = Math.abs(v - line);
              if (d < tol && (!best || d < best.d)) best = { d, line, shift: line - v };
            }
            return best;
          };
          const sx = snap(nx, hw, FW / 2, extraX);
          const sy = snap(ny, hh, FH / 2, extraY);
          if (sx) { nx += sx.shift; g.x = sx.line; }
          if (sy) { ny += sy.shift; g.y = sy.line; }
        }
      }
      setGuides(g);
      st.commit((p) => setCameraAt(p, st.time, { x: round(nx, 3), y: round(ny, 3) }, fps), { transient: true });
      return;
    }
    if (drag.kind === 'crop-size' || drag.kind === 'crop-draw') {
      if (!drag.moved) {
        if (drag.kind === 'crop-draw' && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
        st.checkpoint();
        drag.moved = true;
      }
      const w = toWorld(px, py);
      const aspect = FW / FH;
      let x: number, y: number, width: number;
      if (drag.kind === 'crop-size' && e.altKey) {
        // ⌥: resize around the centre
        width = 2 * Math.max(Math.abs(w.x - drag.cx), Math.abs(w.y - drag.cy) * aspect);
        width = Math.min(FW / MIN_ZOOM, Math.max(FW / MAX_ZOOM, width));
        x = drag.cx;
        y = drag.cy;
      } else {
        const sx = drag.kind === 'crop-size' ? drag.dx : Math.sign(w.x - drag.ax) || 1;
        const sy = drag.kind === 'crop-size' ? drag.dy : Math.sign(w.y - drag.ay) || 1;
        // the 16:9 box from the anchor that just reaches the pointer
        width = Math.max(sx * (w.x - drag.ax), sy * (w.y - drag.ay) * aspect);
        width = Math.min(FW / MIN_ZOOM, Math.max(FW / MAX_ZOOM, width));
        x = drag.ax + (sx * width) / 2;
        y = drag.ay + (sy * width) / aspect / 2;
      }
      const zoom = FW / width;
      st.commit((p) => setCameraAt(p, st.time, { x: round(x, 3), y: round(y, 3), zoom: round(zoom, 4) }, fps), { transient: true });
      return;
    }
    if (drag.kind === 'move3d') {
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
        st.checkpoint();
        drag.moved = true;
      }
      let d: V3;
      if (drag.n && drag.hit0) {
        const q = drag.pr.toPlane(px, py, drag.n, drag.p0);
        if (!q) return;
        d = [q[0] - drag.hit0[0], q[1] - drag.hit0[1], q[2] - drag.hit0[2]];
      } else {
        // edge-on plane: move parallel to the screen
        const u = drag.pr.unit;
        const sx = (e.clientX - drag.sx) / u;
        const sy = -(e.clientY - drag.sy) / u;
        d = [drag.pr.right[0] * sx + drag.pr.up[0] * sy, drag.pr.right[1] * sx + drag.pr.up[1] * sy, drag.pr.right[2] * sx + drag.pr.up[2] * sy];
      }
      if (e.shiftKey) {
        // constrain to the dominant world axis
        const k = [0, 1, 2].reduce((a, b) => (Math.abs(d[b]) > Math.abs(d[a]) ? b : a), 0);
        d = d.map((v, i) => (i === k ? v : 0)) as V3;
      }
      const g3: { sx?: number; sy?: number } = {};
      if (drag.fromCenter && drag.n && st.snapping && !e.metaKey) {
        const primary = drag.ids[0];
        const p0 = primary ? drag.start[primary] : null;
        if (p0) {
          const pos: V3 = [p0.x + d[0], p0.y + d[1], (p0.z || 0) + d[2]];
          const fixed = !!boxes.find((b) => b.clip.id === primary)?.clip.fixed;
          const pts: V3[] = [[0, 0, 0]];
          if (!fixed) {
            const c = cameraAt(st.project, st.time);
            pts.push([c.x, c.y, c.z]);
          }
          for (const b of boxes) {
            if (drag.ids.includes(b.clip.id) || !!b.clip.fixed !== fixed) continue;
            pts.push([b.tr.x, b.tr.y, b.tr.z || 0]);
          }
          const free = ([0, 1, 2] as const).filter((i) => drag.n![i] === 0);
          const tol = 8 / drag.pr.unit;
          let snapped = false;
          if (!e.shiftKey && free.length === 2) {
            const [i, j] = free;
            const hit = nearestCenter(pos[i], pos[j], pts.map((p) => ({ x: p[i], y: p[j] })), 14 / drag.pr.unit);
            if (hit) {
              d[i] += hit.x - pos[i];
              d[j] += hit.y - pos[j];
              pos[i] = hit.x;
              pos[j] = hit.y;
              snapped = true;
            } else {
              for (const i of free) {
                const s = nearestAxis(pos[i], pts.map((p) => p[i]), tol);
                if (s !== undefined) { d[i] += s - pos[i]; pos[i] = s; snapped = true; }
              }
            }
          } else if (free.length) {
            const axis = free.reduce((a, b) => (Math.abs(d[b]) > Math.abs(d[a]) ? b : a));
            const s = nearestAxis(pos[axis], pts.map((p) => p[axis]), tol);
            if (s !== undefined) { d[axis] += s - pos[axis]; pos[axis] = s; snapped = true; }
          }
          if (snapped) {
            const q = drag.pr.project(pos);
            if (q.ok) { g3.sx = q.x; g3.sy = q.y; }
          }
        }
      }
      setGuides(g3);
      st.commit((p) => {
        for (const id of drag.ids) {
          const c = p.clips.find((c) => c.id === id);
          if (!c) continue;
          const s0 = drag.start[id];
          setTransformAt(c, st.time - c.start, { x: round(s0.x + d[0], 3), y: round(s0.y + d[1], 3), z: round((s0.z || 0) + d[2], 3) }, fps);
        }
      }, { transient: true });
      return;
    }
    if (drag.kind === 'move') {
      const unit = drag.unit;
      let dx = (e.clientX - drag.sx) / unit;
      let dy = -(e.clientY - drag.sy) / unit;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
        st.checkpoint();
        drag.moved = true;
      }
      // snapping on the grabbed object. Picked by its centre +: the centre locks onto
      // other centres (objects, the origin, the camera) instead of only lining up on one axis.
      const g: { x?: number; y?: number } = {};
      const primary = drag.ids[0];
      if (st.snapping && !e.metaKey && primary) {
        const p0 = drag.start[primary];
        const tx = p0.x + dx;
        const ty = p0.y + dy;
        const tol = 8 / unit;
        const fixed = !!boxes.find((b) => b.clip.id === primary)?.clip.fixed;
        const pts: { x: number; y: number }[] = [{ x: 0, y: 0 }];
        if (drag.fromCenter && !fixed) {
          const c = cameraAt(st.project, st.time);
          pts.push({ x: c.x, y: c.y });
        }
        for (const b of boxes) {
          if (drag.ids.includes(b.clip.id)) continue;
          if (drag.fromCenter && !!b.clip.fixed !== fixed) continue;
          pts.push({ x: b.tr.x, y: b.tr.y });
        }
        const hit = drag.fromCenter && !e.shiftKey ? nearestCenter(tx, ty, pts, 14 / unit) : null;
        if (hit) {
          dx = hit.x - p0.x;
          dy = hit.y - p0.y;
          g.x = hit.x;
          g.y = hit.y;
        } else {
          const sx = nearestAxis(tx, pts.map((p) => p.x), tol);
          const sy = nearestAxis(ty, pts.map((p) => p.y), tol);
          if (sx !== undefined) { dx = sx - p0.x; g.x = sx; }
          if (sy !== undefined) { dy = sy - p0.y; g.y = sy; }
        }
      }
      if (e.shiftKey) {
        // constrain to one axis
        if (Math.abs(dx) > Math.abs(dy)) { dy = 0; g.y = undefined; }
        else { dx = 0; g.x = undefined; }
      }
      setGuides(g);
      st.commit((p) => {
        for (const id of drag.ids) {
          const c = p.clips.find((c) => c.id === id);
          if (!c) continue;
          const s0 = drag.start[id];
          setTransformAt(c, st.time - c.start, { x: round(s0.x + dx, 3), y: round(s0.y + dy, 3) }, fps);
        }
      }, { transient: true });
    } else if (drag.kind === 'scale') {
      const d = Math.hypot(px - drag.cx, py - drag.cy);
      let s = Math.max(0.02, drag.s0 * (d / Math.max(drag.d0, 1)));
      if (e.shiftKey) s = Math.round(s * 10) / 10;
      st.commit((p) => {
        const c = p.clips.find((c) => c.id === drag.id);
        if (c) setTransformAt(c, st.time - c.start, { scale: round(s, 3) }, fps);
      }, { transient: true });
    } else if (drag.kind === 'rotate') {
      const a = Math.atan2(-(py - drag.cy), px - drag.cx);
      // unwrap so crossing the ±180° seam doesn't jump by a full turn
      let d = a - drag.last;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      drag.acc += d;
      drag.last = a;
      let rot = drag.r0 + (drag.sign * drag.acc * 180) / Math.PI;
      if (e.shiftKey) rot = Math.round(rot / 15) * 15;
      st.commit((p) => {
        const c = p.clips.find((c) => c.id === drag.id);
        if (c) setTransformAt(c, st.time - c.start, { rotation: round(rot, 2) }, fps);
      }, { transient: true });
    }
  };

  const onPointerUp = () => {
    if (drag) {
      if (drag.kind === 'nav' && drag.moved) navSuppress.current = true;
      setDrag(null);
      setGuides({});
      setPartGuides({});
      useStore.setState({ interacting: false });
      unfreeze();
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const r = stageRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const sp = useStore.getState().selectedPart;
    const inPart = partHit(px, py);
    const b = inPart?.b || hit(px, py);
    if (b && !b.poly) {
      // a group: go one level into it (the part under the pointer)
      const tree = cachedParts(b.clip);
      if (isGroupTree(tree)) {
        const parent = inPart ? inPart.node.path : sp?.clip === b.clip.id ? sp.path : '';
        const q = toClip(b, px, py);
        const node = partAt(b.clip, tree, parent, q.x, q.y, 4 / clipK(b));
        if (node) {
          selectPart(b.clip.id, node.path, 'params');
          setPartHover(null);
          return;
        }
        if (inPart) return; // already at the deepest part here
      }
    }
    if (b) {
      revealInspector(b.clip.id, 'params');
      setTimeout(() => window.dispatchEvent(new CustomEvent('focus-first-param')), 80);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const st = useStore.getState();
    if (st.animPreview || drag) return;
    // zoom towards the pointer (pinch = ctrl+wheel on a trackpad). Like every view gesture this
    // moves the editor view, never the camera (also from the full-scene overview).
    frozenView = null;
    const target = navTarget();
    if (!wheelSession.current && target === 'camera') st.checkpoint();
    clearTimeout(wheelSession.current);
    wheelSession.current = setTimeout(() => {
      wheelSession.current = 0;
      useStore.setState({ interacting: false });
    }, 300);
    const r = stageRect();
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
    useStore.setState({ interacting: true, playing: false });
    setNavView(zoomAt(currentNavView(target, view), factor, e.clientX - r.left, e.clientY - r.top, stage.w, stage.h), { transient: true, target });
  };

  // ------------------------------------------------------------------ drag & drop from library / Finder
  const acceptDrop = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(DND_ITEM) || e.dataTransfer.types.includes(DND_ASSET) || e.dataTransfer.types.includes('Files');

  const onDragOver = (e: React.DragEvent) => {
    if (!acceptDrop(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const r = stageRect();
    setDropPos({ x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const onDrop = (e: React.DragEvent) => {
    setDropPos(null);
    if (!acceptDrop(e)) return;
    e.preventDefault();
    const r = stageRect();
    let w = toWorld(e.clientX - r.left, e.clientY - r.top);
    if (useStore.getState().snapping && pr.flat) {
      const tol = 10 / unit;
      if (Math.abs(w.x) < tol) w = { ...w, x: 0 };
      if (Math.abs(w.y) < tol) w = { ...w, y: 0 };
    }
    const place = { x: round(w.x, 2), y: round(w.y, 2) };
    const item = e.dataTransfer.getData(DND_ITEM);
    const assetName = e.dataTransfer.getData(DND_ASSET);
    if (item) addItem(item, place);
    else if (assetName) addAsset(assetName, place);
    else if (e.dataTransfer.files.length) {
      const paths = [...e.dataTransfer.files].map((f) => window.studio.pathForFile(f)).filter(Boolean);
      importFiles(paths, place);
    }
  };

  const selectedBoxes = boxes.filter((b) => selection.includes(b.clip.id));
  const hoverBox = hover && !selection.includes(hover) ? boxes.find((b) => b.clip.id === hover) : null;
  const errors = meta?.errors || {};
  const errorEntries = Object.entries(errors);
  const selectedHidden = selection.length === 1 && selection[0] !== CAMERA_ID && !selection[0].startsWith(MORPH_SEL) && !boxes.find((b) => b.clip.id === selection[0]);

  return (
    <div className="preview-area">
      <div className="preview-wrap" ref={wrapRef}>
        <div
          className={`stage ${drag ? 'dragging' : ''} ${cameraSelected ? 'cam-mode' : ''} ${animPreview ? 'previewing' : ''}`}
          style={{ width: stage.w, height: stage.h }}
          onDragOver={onDragOver}
          onDragLeave={() => setDropPos(null)}
          onDrop={onDrop}
        >
          <canvas ref={canvasRef} className="stage-canvas" />
          <svg
            className="overlay"
            width={stage.w}
            height={stage.h}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => { if (!drag) { setHover(null); setCenterHot(null); } }}
            onDoubleClick={onDoubleClick}
            onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
            onAuxClick={(e) => e.preventDefault()}
            style={{ cursor: drag?.kind === 'part' ? 'grabbing' : partHover && !drag ? 'move' : centerHot && !drag ? 'crosshair' : drag?.kind === 'nav' ? (drag.mode === 'orbit' ? 'grabbing' : 'move') : fullView ? (drag?.kind === 'crop-move' ? 'grabbing' : drag ? 'crosshair' : cropHover ? 'move' : 'crosshair') : cameraSelected ? (drag ? 'grabbing' : 'move') : drag?.kind === 'move' || drag?.kind === 'move3d' ? 'grabbing' : hover ? 'grab' : 'default' }}
          >
            <defs><clipPath id="stage-clip"><rect x={0} y={0} width={stage.w} height={stage.h} /></clipPath></defs>
            {freeView && <g clipPath="url(#stage-clip)"><CameraFrameOverlay cam={cam} pr={pr} /></g>}
            {guides.x !== undefined && (
              <line className="guide" x1={toPx(guides.x, 0).x} x2={toPx(guides.x, 0).x} y1={0} y2={stage.h} />
            )}
            {guides.y !== undefined && (
              <line className="guide" y1={toPx(0, guides.y).y} y2={toPx(0, guides.y).y} x1={0} x2={stage.w} />
            )}
            {guides.sx !== undefined && (
              <line className="guide" x1={guides.sx} x2={guides.sx} y1={0} y2={stage.h} />
            )}
            {guides.sy !== undefined && (
              <line className="guide" y1={guides.sy} y2={guides.sy} x1={0} x2={stage.w} />
            )}
            {hoverBox && (hoverBox.poly ? (
              <g className="box3d hover">
                {hoverBox.edges.map(([a, c], i) => <line key={i} x1={a.x} y1={a.y} x2={c.x} y2={c.y} />)}
                <g transform={`translate(${hoverBox.cx} ${hoverBox.cy})`}><CenterPlus hot={centerHot === hoverBox.clip.id} /></g>
              </g>
            ) : (
              <g transform={`translate(${hoverBox.cx} ${hoverBox.cy}) rotate(${-hoverBox.rot})`}>
                <rect className="hover-box" x={hoverBox.ox - hoverBox.w / 2} y={hoverBox.oy - hoverBox.h / 2} width={hoverBox.w} height={hoverBox.h} />
                <CenterPlus hot={centerHot === hoverBox.clip.id} />
              </g>
            ))}
            {selectedBoxes.filter((b) => b.poly).map((b) => (
              <g key={b.clip.id} data-testid="sel-poly">
                <polygon className="sel-hull" points={b.poly!.map((q) => `${q.x},${q.y}`).join(' ')} />
                <g className="box3d">{b.edges.map(([a, c], i) => <line key={i} x1={a.x} y1={a.y} x2={c.x} y2={c.y} />)}</g>
                <text className="sel-label" x={b.ax - b.w / 2} y={b.ay - b.h / 2 - 6}>{b.clip.name}{b.clip.keys.length ? ' ◆' : ''}{b.clip.fixed ? ' 📌' : ''}</text>
                {selectedBoxes.length === 1 && (
                  <g transform={`translate(${b.ax} ${b.ay})`}>
                    <line className="rot-stem" x1={0} y1={-b.h / 2} x2={0} y2={-b.h / 2 - 22} />
                    <circle className="handle rot" data-handle="rotate" cx={0} cy={-b.h / 2 - 26} r={5.5} onPointerDown={(e) => onHandleDown(e, b, 'rotate')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
                    {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => (
                      <rect
                        key={`${sx}${sy}`}
                        className="handle"
                        data-handle="scale"
                        x={(sx * b.w) / 2 - 5}
                        y={(sy * b.h) / 2 - 5}
                        width={10}
                        height={10}
                        style={{ cursor: sx * sy > 0 ? 'nwse-resize' : 'nesw-resize' }}
                        onPointerDown={(e) => onHandleDown(e, b, 'scale')}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                      />
                    ))}
                  </g>
                )}
                <g transform={`translate(${b.cx} ${b.cy})`}><CenterPlus hot={centerHot === b.clip.id} /></g>
              </g>
            ))}
            {selectedBoxes.length === 1 && !selectedBoxes[0].poly && <PartOutline box={selectedBoxes[0]} hover={drag ? null : partHover} guides={partGuides} />}
            {selectedBoxes.filter((b) => !b.poly).map((b) => (
              <g key={b.clip.id} transform={`translate(${b.cx} ${b.cy}) rotate(${-b.rot})`}>
                <g transform={`translate(${b.ox} ${b.oy})`}>
                <rect className="sel-box" x={-b.w / 2} y={-b.h / 2} width={b.w} height={b.h} />
                <text className="sel-label" x={-b.w / 2} y={-b.h / 2 - 6}>{b.clip.name}{b.clip.keys.length ? ' ◆' : ''}{b.clip.fixed ? ' 📌' : ''}</text>
                {selectedBoxes.length === 1 && (
                  <>
                    <line className="rot-stem" x1={0} y1={-b.h / 2} x2={0} y2={-b.h / 2 - 22} />
                    <circle className="handle rot" data-handle="rotate" cx={0} cy={-b.h / 2 - 26} r={5.5} onPointerDown={(e) => onHandleDown(e, b, 'rotate')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
                    {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => (
                      <rect
                        key={`${sx}${sy}`}
                        className="handle"
                        data-handle="scale"
                        x={(sx * b.w) / 2 - 5}
                        y={(sy * b.h) / 2 - 5}
                        width={10}
                        height={10}
                        style={{ cursor: sx * sy > 0 ? 'nwse-resize' : 'nesw-resize' }}
                        onPointerDown={(e) => onHandleDown(e, b, 'scale')}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                      />
                    ))}
                  </>
                )}
                </g>
                <CenterPlus hot={centerHot === b.clip.id} />
              </g>
            ))}
            {fullView && <CropOverlay cam={cam} toPx={toPx} stage={stage} centerHot={centerHot === 'camera'} onHandleDown={onCropHandleDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />}
            {dropPos && (
              <g className="drop-cross">
                <line x1={dropPos.x - 14} x2={dropPos.x + 14} y1={dropPos.y} y2={dropPos.y} />
                <line y1={dropPos.y - 14} y2={dropPos.y + 14} x1={dropPos.x} x2={dropPos.x} />
                <circle cx={dropPos.x} cy={dropPos.y} r={18} />
              </g>
            )}
          </svg>
          {!meta && <div className="stage-loading">Rendering…</div>}
          {animPreview && (
            <div className="anim-live-badge" data-testid="anim-live">
              <span className="dot" /> Preview · {animPreview.label}
              <div className="bar"><div ref={previewBar} /></div>
            </div>
          )}
          {cameraSelected && !freeView && (
            <div className="camera-badge">
              {fullView
                ? <>🎥 Full scene · drag box / corners · drag outside to draw · right-drag / scroll to look around · C = look through</>
                : <>🎥 Camera view · drag / right-drag / scroll to look around (the camera stays put) · ({cam.x.toFixed(2)}, {cam.y.toFixed(2)}{camFlat ? '' : `, ${cam.z.toFixed(2)}`}) ×{cam.zoom.toFixed(2)}{camFlat ? '' : ` · θ ${cam.theta.toFixed(0)}° φ ${cam.phi.toFixed(0)}°`}</>}
            </div>
          )}
          {freeView && !animPreview && (
            <div className="editor-view-badge" data-testid="editor-view-badge">
              <span className="dot" /> Editor view <span className="muted">· not exported</span>
              <button onClick={cameraToEditorView} data-testid="set-camera-here" title="Copy this viewpoint to the scene camera">Set camera here</button>
              <button onClick={exitEditorView} data-testid="exit-editor-view" title="Look through the scene camera (0)">Camera view</button>
            </div>
          )}
          {!animPreview && meta && !fullView && <ViewCube view={view} editor={!!freeView} />}
          {project.clips.length === 0 && (
            <div className="stage-empty">
              <div className="big-hint">Drag a mobject here</div>
              <div>from the library on the left, or drop an image from Finder</div>
              <button className="btn" style={{ pointerEvents: 'auto', marginTop: 12 }} onClick={loadExample} data-testid="load-example">Open example project</button>
            </div>
          )}
          {selectedHidden && !animPreview && (
            <div className="stage-note">The selected clip isn’t on screen at the playhead</div>
          )}
          {errorEntries.length > 0 && (
            <div className="stage-errors">
              {errorEntries.slice(0, 3).map(([id, msg]) => {
                const c = project.clips.find((c) => c.id === id);
                return (
                  <div key={id} className="stage-error" onClick={() => (c?.code ? editClipCode(id) : revealInspector(id, 'params'))}>
                    <b>{c?.name || id}</b>: {msg}
                  </div>
                );
              })}
            </div>
          )}
          {errorMsg && <div className="stage-errors"><div className="stage-error">Engine: {errorMsg}</div></div>}
          {!animPreview && <CamViewToggle />}
        </div>
      </div>
    </div>
  );
}

function CamViewToggle() {
  const camFullView = useStore((s) => s.camFullView);
  const editorView = useStore((s) => s.editorView);
  const cameraSelected = useStore((s) => s.selection.includes(CAMERA_ID));
  const camFlat = useStore((s) => isFlat(cameraAt(s.project, s.time)));
  const fullOn = !editorView && cameraSelected && camFullView && camFlat;
  const throughOn = !editorView && !fullOn;
  const pick = (full: boolean) => {
    useStore.setState({ selection: [CAMERA_ID], selectedKey: null, camFullView: full, editorView: null });
  };
  return (
    <div className="stage-cam-toggle" data-testid="cam-view-toggle" onPointerDown={(e) => e.stopPropagation()}>
      <div className="seg cam-seg">
        <button className={fullOn ? 'on' : ''} disabled={!camFlat} title={camFlat ? 'Show the whole scene and edit the camera as a crop box (C)' : 'The full-scene crop view is for flat (2D) cameras'} onClick={() => pick(true)} data-testid="cam-full"><Crop size={12} /> Full scene</button>
        <button className={throughOn ? 'on' : ''} title="Look through the camera (C)" onClick={() => pick(false)} data-testid="cam-through"><Video size={12} /> Camera view</button>
      </div>
    </div>
  );
}

function CropOverlay({ cam, toPx, stage, centerHot, onHandleDown, onPointerMove, onPointerUp }: {
  cam: Cam;
  toPx: (x: number, y: number) => { x: number; y: number };
  stage: { w: number; h: number };
  centerHot: boolean;
  onHandleDown: (e: React.PointerEvent, dx: number, dy: number) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}) {
  const keys = useStore((s) => s.project.settings.camera) || [];
  const fps = useStore((s) => s.project.settings.fps);
  const time = useStore((s) => s.time);
  const box = (c: { x: number; y: number; zoom: number }) => {
    const r = camRect(c);
    const a = toPx(r[0], r[3]);
    const b = toPx(r[2], r[1]);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  };
  const b = box(cam);
  const f = box({ x: 0, y: 0, zoom: 1 });
  const onKey = keys.find((k) => Math.abs(k.t - time) <= 0.5 / fps);
  const ghosts = [...keys].sort((a, b) => a.t - b.t).filter((k) => k !== onKey);
  return (
    <g data-testid="crop-overlay">
      <path className="crop-dim" fillRule="evenodd" d={`M0 0H${stage.w}V${stage.h}H0Z M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}Z`} />
      <rect className="scene-frame" x={f.x} y={f.y} width={f.w} height={f.h} />
      <text className="scene-frame-label" x={f.x + f.w - 4} y={f.y + f.h + 13} textAnchor="end">scene frame</text>
      {ghosts.map((k) => {
        const g = box(k);
        return (
          <g key={k.id} className="crop-ghost">
            <rect x={g.x} y={g.y} width={g.w} height={g.h} />
            <text x={g.x + 4} y={g.y + 12}>{k.t.toFixed(2)}s</text>
          </g>
        );
      })}
      <rect className={`crop-box ${onKey ? 'on-key' : ''}`} data-testid="crop-box" x={b.x} y={b.y} width={b.w} height={b.h} />
      {[1, 2].map((i) => (
        <g key={i} className="crop-thirds">
          <line x1={b.x + (b.w * i) / 3} x2={b.x + (b.w * i) / 3} y1={b.y} y2={b.y + b.h} />
          <line y1={b.y + (b.h * i) / 3} y2={b.y + (b.h * i) / 3} x1={b.x} x2={b.x + b.w} />
        </g>
      ))}
      <g className="crop-center" transform={`translate(${b.x + b.w / 2} ${b.y + b.h / 2})`}>
        <CenterPlus hot={centerHot} tone="camera" size={10} />
      </g>
      <text className="crop-label" x={b.x + 4} y={Math.max(12, b.y - 6)}>{onKey ? '◆ ' : ''}Camera ×{cam.zoom.toFixed(2)} @ {time.toFixed(2)}s</text>
      {[[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => (
        <rect
          key={`${dx}${dy}`}
          className="handle crop-handle"
          data-handle="crop"
          data-corner={`${dx}${dy}`}
          x={b.x + (dx > 0 ? b.w : 0) - 6}
          y={b.y + (dy > 0 ? 0 : b.h) - 6}
          width={12}
          height={12}
          style={{ cursor: dx * dy < 0 ? 'nwse-resize' : 'nesw-resize' }}
          onPointerDown={(e) => onHandleDown(e, dx, dy)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      ))}
    </g>
  );
}

/** In the editor view: the scene camera's frame and frustum, so you can see what will be exported. */
function CameraFrameOverlay({ cam, pr }: { cam: Cam; pr: Projector }) {
  const { right, up } = basis(cam);
  const camPr = projector(cam, pr.w, pr.h);
  const hw = FW / 2 / cam.zoom;
  const hh = FH / 2 / cam.zoom;
  const c: V3 = [cam.x, cam.y, cam.z];
  const corner = (sx: number, sy: number): V3 => [
    c[0] + sx * hw * right[0] + sy * hh * up[0],
    c[1] + sx * hw * right[1] + sy * hh * up[1],
    c[2] + sx * hw * right[2] + sy * hh * up[2],
  ];
  const cs = [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)].map((p) => pr.project(p));
  if (cs.some((q) => !q.ok)) return null;
  const eye = pr.project(camPr.eye);
  const label = cs[0];
  return (
    <g className="cam-frame" data-testid="cam-frame">
      <polygon points={cs.map((q) => `${q.x},${q.y}`).join(' ')} />
      {eye.ok && cs.map((q, i) => <line key={i} className="frustum" x1={eye.x} y1={eye.y} x2={q.x} y2={q.y} />)}
      <text x={label.x + 4} y={label.y - 5}>🎥 Camera</text>
    </g>
  );
}


/**
 * Outline of the selected part of a group (picked on the timeline or by double-clicking into the
 * clip), the sibling under the pointer, and snap guides while a part is dragged — in the clip's transform.
 */
function PartOutline({ box, hover, guides }: { box: { clip: Clip; cx: number; cy: number; rot: number; tr: Transform; pr: Projector }; hover: string | null; guides: { x?: number; y?: number } }) {
  // the clip's tree is loaded as soon as it is selected, so double-click can go into it right away
  const tree = useClipParts(box.clip);
  const path = useStore((s) => (s.selectedPart?.clip === box.clip.id ? s.selectedPart.path : null));
  const node = path !== null ? findNode(tree, path) : null;
  if (!node) return null;
  const k = box.tr.scale * box.pr.unit;
  const [x0, y0, x1, y1] = partBox(box.clip, node);
  const hn = hover && hover !== path ? findNode(tree, hover) : null;
  const hb = hn ? partBox(box.clip, hn) : null;
  const pad = 3;
  const own = box.clip.parts?.[node.path];
  const odx = own?.dx || 0, ody = own?.dy || 0;
  const moved = !!(odx || ody);
  const L = 4000;
  return (
    <g transform={`translate(${box.cx} ${box.cy}) rotate(${-box.rot})`} data-testid="part-outline" data-path={node.path} pointerEvents="none">
      {guides.x !== undefined && <line className="guide" x1={guides.x * k} x2={guides.x * k} y1={-L} y2={L} />}
      {guides.y !== undefined && <line className="guide" y1={-guides.y * k} y2={-guides.y * k} x1={-L} x2={L} />}
      {hb && <rect className="part-hover" data-testid="part-hover" x={hb[0] * k - pad} y={-hb[3] * k - pad} width={Math.max(2, (hb[2] - hb[0]) * k) + 2 * pad} height={Math.max(2, (hb[3] - hb[1]) * k) + 2 * pad} rx={3} />}
      {moved && (
        // where the code put it: a ghost box and a line to where it is now
        <>
          <rect className="part-origin" x={(x0 - odx) * k - pad} y={-(y1 - ody) * k - pad} width={Math.max(2, (x1 - x0) * k) + 2 * pad} height={Math.max(2, (y1 - y0) * k) + 2 * pad} rx={3} />
          <line className="part-origin-link" x1={((x0 + x1) / 2 - odx) * k} y1={-((y0 + y1) / 2 - ody) * k} x2={((x0 + x1) / 2) * k} y2={-((y0 + y1) / 2) * k} />
        </>
      )}
      <rect className="part-outline" x={x0 * k - pad} y={-y1 * k - pad} width={Math.max(2, (x1 - x0) * k) + 2 * pad} height={Math.max(2, (y1 - y0) * k) + 2 * pad} rx={3} />
      <text className="sel-label part" x={x0 * k - pad} y={y1 * -k - pad - 5}>{partName(node)}</text>
    </g>
  );
}
