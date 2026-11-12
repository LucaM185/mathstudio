// CAD-style viewport navigation shared by the preview gestures, the view cube, the keyboard
// shortcuts and the inspector.
//
// Viewport navigation (orbit / pan / zoom / view cube / view keys) always moves the editor view:
// a free viewpoint for looking around the scene while editing, even when the camera is selected.
// It is never exported, so the scene camera stays where it is; "Set camera here" copies the view
// to the camera. Only the camera inspector (fields, presets) edits the camera directly.
import { useStore } from './store';
import { CAMERA_ID, DEFAULT_CAM, cameraAt, fullCam, round, setCameraAt, uid, type Cam } from './ops';
import { anglesFor, fitView, lerpView, nearestTurn, presetAngles, type V3 } from './view3d';

const S = useStore.getState;

/** Size of the preview stage in CSS px (kept up to date by the Preview). */
export const stageSize = { w: 960, h: 540 };

export type NavTarget = 'camera' | 'editor';

export function navTarget(): NavTarget {
  return 'editor';
}

/** The view navigation starts from. `seed` = what the preview shows now (e.g. the full-scene
 *  overview), used when the editor view isn't active yet so the picture doesn't jump. */
export function currentNavView(target = navTarget(), seed?: Cam | null): Cam {
  const s = S();
  if (target === 'editor' && s.editorView) return s.editorView;
  if (target === 'editor' && seed) return seed;
  return cameraAt(s.project, s.time);
}

function tidy(c: Cam): Cam {
  return {
    x: round(c.x, 4), y: round(c.y, 4), z: round(c.z, 4), zoom: round(c.zoom, 4),
    theta: round(c.theta, 3), phi: round(c.phi, 3), gamma: round(c.gamma, 3),
  };
}

/** transient: part of a gesture (the caller made an undo checkpoint for camera edits). */
export function setNavView(c: Cam, opts: { transient?: boolean; target?: NavTarget } = {}) {
  const target = opts.target || navTarget();
  const v = tidy(c);
  if (target === 'editor') {
    useStore.setState({ editorView: v });
    return;
  }
  const s = S();
  s.commit((p) => setCameraAt(p, s.time, v, p.settings.fps), { transient: !!opts.transient });
}

let anim = 0;
/** Stop a running fly-to (a new gesture takes over the view). */
export function stopNavAnim() {
  if (!anim) return;
  cancelAnimationFrame(anim);
  anim = 0;
  useStore.setState({ interacting: false });
}
/** Smoothly fly the view to `to` (CAD-style view change). */
export function animateNavView(to: Cam, ms = 320, target = navTarget()) {
  cancelAnimationFrame(anim);
  const from = currentNavView(target);
  const goal = { ...to, theta: nearestTurn(to.theta, from.theta), gamma: nearestTurn(to.gamma, from.gamma) };
  if (target === 'camera') S().checkpoint();
  if (ms <= 0) {
    setNavView(goal, { transient: true, target });
    return;
  }
  const t0 = performance.now();
  let prev: Cam = from; // keeps theta / gamma continuous frame to frame
  useStore.setState({ interacting: true });
  const step = (now: number) => {
    const u = Math.min(1, (now - t0) / ms);
    const f = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    prev = u >= 1 ? goal : lerpView(from, goal, f, prev);
    setNavView(prev, { transient: true, target });
    if (u < 1) anim = requestAnimationFrame(step);
    else {
      anim = 0;
      useStore.setState({ interacting: false });
    }
  };
  anim = requestAnimationFrame(step);
}

/** Look at the current centre from a direction (world vector from the centre towards the eye). */
export function lookFrom(d: V3) {
  const from = currentNavView();
  animateNavView({ ...from, ...anglesFor(d, from) });
}

/** target 'camera' = the camera inspector's presets, which aim the camera itself. */
export function lookPreset(name: string, target: NavTarget = navTarget()) {
  const from = currentNavView(target);
  animateNavView({ ...from, ...presetAngles(name, from) }, 320, target);
}

/** Back to the plain 2D view (top view, whole frame). */
export function homeView() {
  animateNavView({ ...DEFAULT_CAM });
}

/** Zoom to fit the selected clips (or everything on screen), keeping the orientation. */
export function fitNav(target: NavTarget = navTarget()) {
  const s = S();
  const meta = s.meta;
  if (!meta) return;
  const sel = s.selection.filter((id) => id !== CAMERA_ID);
  const boxes: [V3, V3][] = [];
  for (const [id, info] of Object.entries(meta.clips)) {
    if (!info.bbox || info.fixed) continue;
    if (sel.length && !sel.includes(id)) continue;
    const zr = info.zr || [0, 0];
    boxes.push([[info.bbox[0], info.bbox[1], zr[0]], [info.bbox[2], info.bbox[3], zr[1]]]);
  }
  const from = currentNavView(target);
  animateNavView(fitView(from, boxes, stageSize.w, stageSize.h), 320, target);
}

/** Leave the editor view and look through the scene camera again. */
export function exitEditorView() {
  cancelAnimationFrame(anim);
  useStore.setState({ editorView: null, interacting: false });
}

/** Copy the editor view to the camera (a keyframe at the playhead if the camera is animated). */
export function cameraToEditorView() {
  const s = S();
  const v = s.editorView;
  if (!v) return;
  const animated = (s.project.settings.camera || []).length > 1;
  s.commit((p) => {
    // a static camera stays static; an animated one gets a keyframe at the playhead
    if (!animated) p.settings.camera = [{ id: uid('ck'), t: 0, ...tidy(v), ease: 'smooth' }];
    else setCameraAt(p, s.time, tidy(v), p.settings.fps);
  });
  useStore.setState({ editorView: null });
  s.toast(animated ? 'Camera keyframe set to this view' : 'Camera set to this view', 'success');
}

export const isEditorView = () => !!S().editorView;
export { fullCam };
