import { useEffect, useMemo, useRef, useState } from 'react';
import { editClipCode, revealInspector, useStore, itemById } from '../store';
import { addAsset, addItem, addTransformAt, canCutAt, clipsCuttableAt, deleteSelection, duplicateSelection, hidePart, importFiles, removeTransform, selectTransform, splitAtPlayhead, splitClipsAt, transformPlan } from '../actions';
import { DND_ASSET, DND_ITEM } from './Library';
import { addKeyAt, CAMERA_ID, setCameraAt, CATEGORY_COLORS, clone, insertTrack, morphSelId, emptyTrackIds, overlaps, removeEmptyTrailingTracks, removeEmptyTracks, resolveOverlap, round, uid } from '../ops';
import type { Clip, PartNode, Project } from '../types';
import { cachedParts, findNode, hasOffset, isGroupTree, openKey, partName, partRows, partTiming, partWindows, resetPart, setPart, shiftParts, staggerParts, timedParts, useClipPartsMap, type PartRow } from '../parts';
import ContextMenu, { MenuItem } from './ContextMenu';
import { exitWindow, isMorph, useClipStrip, useClipThumb, type Strip } from '../clipThumbs';
import { AnimIcon, CategoryIcon } from '../icons';
import { AnimPopover, type AnchorRect } from './AnimPicker';
import {
  AlertTriangle, Camera, ChevronDown, ChevronRight, Code2, Copy, Eye, EyeOff, GripVertical, KeyRound, Layers, ListTree, Lock, Maximize, Minus, Move, Plus, RotateCcw, Scissors, Shuffle, Sparkles, Timer, Trash2, Unlock,
} from 'lucide-react';

const LANE_H = 64;
const RULER_H = 28;
const CAM_H = 40;
const HEADER_W = 168;
/** height of one part row under an expanded group clip */
const PART_H = 22;
const STAGGER_STEPS = [0.1, 0.25, 0.5, 1];

type AnimPop = { clip: string; kind: 'enter' | 'exit' | 'effect'; eff?: string; part?: string; anchor: AnchorRect };

/** Timeline drags call preventDefault, which would otherwise leave the agent prompt (or another field) focused so Space types instead of playing. */
function blurTypingFocus(e: React.PointerEvent) {
  const t = e.target as HTMLElement | null;
  if (!t || t.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return;
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return;
  const tag = active.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable || active.closest('.cm-editor')) active.blur();
}

const rectOf = (el: Element): AnchorRect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
};

type DragState =
  | { kind: 'move'; ids: string[]; sx: number; sy: number; starts: Record<string, number>; tracks: Record<string, number>; laneOffset: number; moved: boolean; zone?: { kind: 'enter' | 'exit'; anchor: AnchorRect } }
  | { kind: 'trim-l' | 'trim-r'; id: string; sx: number; orig: Clip }
  | { kind: 'enter' | 'exit'; id: string; sx: number; orig: Clip }
  /** the end of a transform clip: moves the cut between the morphing clip and the one it becomes */
  | { kind: 'roll'; sx: number; a0: Clip; b0: Clip }
  | { kind: 'key'; id: string; key: string; sx: number; t0: number; moved: boolean }
  | { kind: 'effect'; id: string; eff: string; sx: number; at0: number; moved: boolean; anchor: AnchorRect }
  | { kind: 'scrub' }
  | { kind: 'end'; sx: number; d0: number }
  | { kind: 'track'; id: string; sy: number; index0: number }
  | { kind: 'part-move' | 'part-l' | 'part-r' | 'part-enter' | 'part-exit'; id: string; path: string; sx: number; orig: Clip; moved: boolean; zone?: { kind: 'enter' | 'exit'; anchor: AnchorRect } };

function tickStep(zoom: number) {
  const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
  for (const s of steps) if (s * zoom >= 70) return s;
  return 120;
}

export default function Timeline() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const selectedKey = useStore((s) => s.selectedKey);
  const time = useStore((s) => s.time);
  const zoom = useStore((s) => s.zoom);
  const playing = useStore((s) => s.playing);
  const errors = useStore((s) => s.meta?.errors) || {};
  const library = useStore((s) => s.library);
  const tool = useStore((s) => s.tool);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropGhost, setDropGhost] = useState<{ x: number; lane: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  // Blade tool: where a click would cut (the hovered clip, or every clip at that time with ⇧)
  const [blade, setBlade] = useState<{ clip: string; t: number; all: boolean } | null>(null);
  useEffect(() => {
    if (tool !== 'blade') setBlade(null);
  }, [tool]);
  // the enter / exit / effect chooser opened by clicking that part of a clip
  const [animPop, setAnimPop] = useState<AnimPop | null>(null);
  const animPopRef = useRef(animPop);
  animPopRef.current = animPop;
  const samePop = (a: AnimPop | null, clip: string, kind: AnimPop['kind'], eff?: string, part?: string) => !!a && a.clip === clip && a.kind === kind && a.eff === eff && a.part === part;
  const partsOpen = useStore((s) => s.partsOpen);
  const selectedPart = useStore((s) => s.selectedPart);

  const { settings, tracks, clips } = project;
  const duration = settings.duration;
  const fps = settings.fps;
  const [viewW, setViewW] = useState(1200);
  useEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const contentW = Math.max(duration * zoom + 400, viewW - HEADER_W);

  // keep playhead visible while playing
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = time * zoom + HEADER_W;
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + HEADER_W) el.scrollLeft = Math.max(0, x - HEADER_W - 60);
  }, [time, playing, zoom]);

  // cmd/ctrl + wheel zoom around the cursor
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const xIn = e.clientX - r.left - HEADER_W + el.scrollLeft;
      const tAt = xIn / useStore.getState().zoom;
      const nz = Math.min(600, Math.max(12, useStore.getState().zoom * Math.exp(-e.deltaY * 0.01)));
      useStore.setState({ zoom: nz });
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, tAt * nz - (e.clientX - r.left - HEADER_W));
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const trackIdx = useMemo(() => Object.fromEntries(tracks.map((t, i) => [t.id, i])), [tracks]);
  // group clips: the structure of every clip's mobject, and the part rows of the expanded ones
  const trees = useClipPartsMap(clips);
  const rowsOf: Record<string, PartRow[]> = {};
  for (const c of clips) rowsOf[c.id] = partRows(c.id, trees[c.id], partsOpen);
  // tracks grow to fit the part rows of their expanded clips
  const trackH = tracks.map((t) => LANE_H + Math.max(0, ...clips.filter((c) => c.track === t.id).map((c) => rowsOf[c.id].length)) * PART_H);
  const trackTop: number[] = [];
  trackH.reduce((y, h, i) => ((trackTop[i] = y), y + h), 0);
  const tracksH = trackH.reduce((a, b) => a + b, 0);
  // morph chains: clip A's exit transforms it into clip B
  const morphs = useMemo(() => {
    const byId = new Map(clips.map((c) => [c.id, c]));
    const out: { a: Clip; b: Clip; joined: boolean }[] = [];
    for (const a of clips) {
      if (!isMorph(a)) continue;
      const b = byId.get(a.exit.target!);
      if (!b) continue;
      out.push({ a, b, joined: a.track === b.track && Math.abs(b.start - (a.start + a.duration)) < 0.02 });
    }
    return out;
  }, [clips]);

  // ------------------------------------------------------------------ geometry helpers
  const pointer = (e: { clientX: number; clientY: number }) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left + el.scrollLeft - HEADER_W, y: e.clientY - r.top + el.scrollTop - RULER_H - CAM_H };
  };
  const laneAt = (y: number) => {
    if (y < 0) return -1;
    for (let i = 0; i < tracks.length; i++) if (y < trackTop[i] + trackH[i]) return i;
    return tracks.length + Math.floor((y - tracksH) / LANE_H);
  };

  const snapTargets = (exclude: string[]) => {
    const ts = [0, useStore.getState().time, duration];
    for (const c of clips) {
      if (exclude.includes(c.id)) continue;
      ts.push(c.start, c.start + c.duration);
    }
    return ts;
  };
  const snap = (t: number, exclude: string[], e: { metaKey: boolean }) => {
    if (!useStore.getState().snapping || e.metaKey) return { t, hit: null as number | null };
    const tol = 8 / zoom;
    let best = tol;
    let hit: number | null = null;
    for (const s of snapTargets(exclude)) {
      if (Math.abs(s - t) < best) {
        best = Math.abs(s - t);
        hit = s;
      }
    }
    return { t: hit ?? t, hit };
  };

  // ------------------------------------------------------------------ pointer handling
  const startDrag = (e: React.PointerEvent, d: DragState) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag(d);
    if (d.kind !== 'scrub') useStore.setState({ interacting: true });
  };

  /** Blade target under the pointer: snaps to the playhead and other clips' edges (⌘ disables snapping). */
  const bladeAt = (e: React.PointerEvent): { clip: string; t: number; all: boolean } | null => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-clip]');
    const c = el && clips.find((x) => x.id === el.dataset.clip);
    if (!c || tracks.find((t) => t.id === c.track)?.locked) return null;
    const raw = pointer(e).x / zoom;
    const t = round(snap(raw, [c.id], e).t, 3);
    return canCutAt(c, t) ? { clip: c.id, t, all: e.shiftKey } : null;
  };

  const onClipDown = (e: React.PointerEvent, c: Clip) => {
    if (e.button !== 0) return;
    if (useStore.getState().tool === 'blade') {
      // Blade: click cuts this clip here; ⇧-click cuts every clip at this point
      e.stopPropagation();
      e.preventDefault();
      setAnimPop(null);
      const b = bladeAt(e);
      if (!b) return;
      useStore.setState({ playing: false });
      splitClipsAt(b.all ? clipsCuttableAt(b.t).map((x) => x.id) : [b.clip], b.t);
      return;
    }
    const role = (e.target as HTMLElement).closest<HTMLElement>('[data-role]')?.dataset.role || 'body';
    const st = useStore.getState();
    const locked = tracks.find((t) => t.id === c.track)?.locked;
    if (role === 'parts-toggle') {
      e.stopPropagation();
      e.preventDefault();
      togglePartsOpen(c.id);
      return;
    }
    if (e.shiftKey || e.metaKey) {
      st.select([c.id], true);
      e.stopPropagation();
      return;
    }
    let ids = st.selection;
    if (st.selectedPart) useStore.setState({ selectedPart: null });
    if (!ids.includes(c.id)) {
      ids = [c.id];
      useStore.setState({ selection: ids, selectedKey: null });
    }
    if (locked) {
      e.stopPropagation();
      return;
    }
    useStore.setState({ playing: false });
    if (role !== 'effect' && role !== 'body') setAnimPop(null);
    if (role === 'key') {
      const key = (e.target as HTMLElement).dataset.key!;
      const k = c.keys.find((k) => k.id === key)!;
      useStore.setState({ selectedKey: { clip: c.id, key }, selection: [c.id] });
      st.setTime(c.start + k.t);
      startDrag(e, { kind: 'key', id: c.id, key, sx: e.clientX, t0: k.t, moved: false });
      return;
    }
    if (role === 'effect') {
      const eff = (e.target as HTMLElement).dataset.eff!;
      const ef = c.effects.find((x) => x.id === eff)!;
      startDrag(e, { kind: 'effect', id: c.id, eff, sx: e.clientX, at0: ef.at, moved: false, anchor: rectOf(e.target as Element) });
      return;
    }
    if (role === 'trim-l' || role === 'trim-r' || role === 'enter' || role === 'exit') {
      st.checkpoint();
      startDrag(e, { kind: role as any, id: c.id, sx: e.clientX, orig: clone(c) });
      return;
    }
    const sel = st.project.clips.filter((x) => ids.includes(x.id) && !tracks.find((t) => t.id === x.track)?.locked);
    const p = pointer(e);
    // pressing on the enter / exit part of the clip: a click (no drag) opens its animation chooser
    const zoneEl = (e.target as HTMLElement).closest<HTMLElement>('[data-zone]');
    const zone = zoneEl ? { kind: zoneEl.dataset.zone as 'enter' | 'exit', anchor: rectOf(zoneEl) } : undefined;
    startDrag(e, {
      kind: 'move',
      ids: sel.map((x) => x.id),
      sx: e.clientX,
      sy: e.clientY,
      starts: Object.fromEntries(sel.map((x) => [x.id, x.start])),
      tracks: Object.fromEntries(sel.map((x) => [x.id, trackIdx[x.track]])),
      laneOffset: laneAt(p.y) - trackIdx[c.track],
      moved: false,
      zone,
    });
  };

  /** The clips fused into one changing object with `a` (each joined morph before and after it). */
  const morphChain = (a: Clip) => {
    const joined = (x: Clip, y: Clip) => isMorph(x) && x.exit.target === y.id && x.track === y.track && Math.abs(y.start - (x.start + x.duration)) < 0.02;
    const out = [a];
    for (let cur = a, guard = 0; guard < 100; guard++) {
      const prev = clips.find((x) => joined(x, cur) && !out.includes(x));
      if (!prev) break;
      out.unshift((cur = prev));
    }
    for (let cur = a, guard = 0; guard < 100; guard++) {
      const next = clips.find((y) => joined(cur, y) && !out.includes(y));
      if (!next) break;
      out.push((cur = next));
    }
    return out;
  };

  /**
   * Pressing the transform clip between two states: a click selects the transform; its left edge sets
   * when the morph starts, its right edge where the next state takes over; dragging the body moves
   * the whole changing object (every state and transform fused with it).
   */
  const onMorphDown = (e: React.PointerEvent, a: Clip, b: Clip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (useStore.getState().tool === 'blade') return;
    const role = (e.target as HTMLElement).closest<HTMLElement>('[data-role]')?.dataset.role || 'body';
    const st = useStore.getState();
    setAnimPop(null);
    selectTransform(a.id);
    useStore.setState({ playing: false });
    if (tracks.find((t) => t.id === a.track)?.locked) return;
    if (role === 'exit') {
      st.checkpoint();
      startDrag(e, { kind: 'exit', id: a.id, sx: e.clientX, orig: clone(a) });
      return;
    }
    if (role === 'morph-roll') {
      st.checkpoint();
      startDrag(e, { kind: 'roll', sx: e.clientX, a0: clone(a), b0: clone(b) });
      return;
    }
    const chain = morphChain(a).filter((x) => !tracks.find((t) => t.id === x.track)?.locked);
    const p = pointer(e);
    startDrag(e, {
      kind: 'move',
      ids: chain.map((x) => x.id),
      sx: e.clientX,
      sy: e.clientY,
      starts: Object.fromEntries(chain.map((x) => [x.id, x.start])),
      tracks: Object.fromEntries(chain.map((x) => [x.id, trackIdx[x.track]])),
      laneOffset: laneAt(p.y) - trackIdx[a.track],
      moved: false,
    });
  };

  const morphMenu = (e: React.MouseEvent, a: Clip, b: Clip) => {
    e.preventDefault();
    e.stopPropagation();
    selectTransform(a.id);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: `Select “${a.name}” (before)`, icon: <ChevronRight size={14} style={{ transform: 'scaleX(-1)' }} />, action: () => useStore.setState({ selection: [a.id] }) },
        { label: `Select “${b.name}” (after)`, icon: <ChevronRight size={14} />, action: () => useStore.setState({ selection: [b.id] }) },
        { sep: true },
        { label: 'Remove transform', icon: <Trash2 size={14} />, shortcut: '⌫', danger: true, action: () => removeTransform(a.id) },
      ],
    });
  };

  /** Show / hide a group clip's part rows (or, with a path, a nested group's). */
  const togglePartsOpen = (clipId: string, path = '') => {
    const k = openKey(clipId, path);
    const cur = useStore.getState().partsOpen;
    useStore.setState({ partsOpen: cur.includes(k) ? cur.filter((x) => x !== k && !(path === '' && x.startsWith(clipId + '|'))) : [...cur, k] });
  };

  const onPartDown = (e: React.PointerEvent, c: Clip, path: string) => {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    const role = el.closest<HTMLElement>('[data-role]')?.dataset.role || 'part-body';
    e.stopPropagation();
    if (role === 'part-toggle') {
      e.preventDefault();
      togglePartsOpen(c.id, path);
      return;
    }
    const st = useStore.getState();
    useStore.setState({ selection: [c.id], selectedKey: null, selectedPart: { clip: c.id, path }, playing: false });
    if (tracks.find((t) => t.id === c.track)?.locked || useStore.getState().tool === 'blade') return;
    const zoneEl = el.closest<HTMLElement>('[data-zone]');
    const zone = zoneEl && role === 'part-body' ? { kind: zoneEl.dataset.zone as 'enter' | 'exit', anchor: rectOf(zoneEl) } : undefined;
    const kind = role === 'part-l' ? 'part-l' : role === 'part-r' ? 'part-r' : role === 'part-enter' ? 'part-enter' : role === 'part-exit' ? 'part-exit' : 'part-move';
    if (kind !== 'part-move') {
      st.checkpoint();
      setAnimPop(null);
    }
    startDrag(e, { kind, id: c.id, path, sx: e.clientX, orig: clone(c), moved: kind !== 'part-move', zone });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) {
      if (tool === 'blade') {
        const b = bladeAt(e);
        setBlade((cur) => (cur?.clip === b?.clip && cur?.t === b?.t && cur?.all === b?.all ? cur : b));
      }
      return;
    }
    const st = useStore.getState();
    const p = pointer(e);
    const dt = (e.clientX - ((drag as any).sx ?? e.clientX)) / zoom;
    switch (drag.kind) {
      case 'scrub':
        st.setTime(Math.max(0, p.x / zoom));
        break;
      case 'move': {
        if (!drag.moved) {
          if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
          st.checkpoint();
          drag.moved = true;
          setAnimPop(null);
        }
        const minStart = Math.min(...drag.ids.map((id) => drag.starts[id]));
        let delta = Math.max(-minStart, dt);
        // snap the primary clip's edges
        const prim = st.project.clips.find((c) => c.id === drag.ids[0]);
        let hitLine: number | null = null;
        if (prim) {
          const s0 = drag.starts[prim.id] + delta;
          const a = snap(s0, drag.ids, e);
          const b = snap(s0 + prim.duration, drag.ids, e);
          if (a.hit !== null && (b.hit === null || Math.abs(a.t - s0) <= Math.abs(b.t - (s0 + prim.duration)))) {
            delta += a.t - s0;
            hitLine = a.hit;
          } else if (b.hit !== null) {
            delta += b.t - (s0 + prim.duration);
            hitLine = b.hit;
          }
        }
        delta = Math.max(-minStart, delta);
        setSnapLine(hitLine);
        const lane = laneAt(p.y);
        const primLane0 = drag.tracks[drag.ids[0]];
        let laneDelta = lane - drag.laneOffset - primLane0;
        const lanes = drag.ids.map((id) => drag.tracks[id]);
        laneDelta = Math.max(-Math.min(...lanes), Math.min(tracks.length - 1 - Math.max(...lanes), laneDelta));
        st.commit((pr) => {
          for (const id of drag.ids) {
            const c = pr.clips.find((c) => c.id === id);
            if (!c) continue;
            c.start = round(Math.max(0, drag.starts[id] + delta), 3);
            const ti = drag.tracks[id] + laneDelta;
            const t = pr.tracks[ti];
            if (t && !t.locked) c.track = t.id;
          }
        }, { transient: true });
        break;
      }
      case 'trim-l': {
        const o = drag.orig;
        const end = o.start + o.duration;
        let ns = snap(o.start + dt, [o.id], e).t;
        ns = Math.max(0, Math.min(end - 0.1, ns));
        const shift = ns - o.start;
        st.commit((pr) => {
          const c = pr.clips.find((c) => c.id === o.id);
          if (!c) return;
          c.start = round(ns, 3);
          c.duration = round(end - ns, 3);
          c.keys = o.keys.map((k) => ({ ...k, t: round(Math.max(0, k.t - shift), 4) }));
          c.effects = o.effects.map((x) => ({ ...x, at: round(Math.max(0, x.at - shift), 3) }));
          if (o.parts) c.parts = shiftParts(o.parts, shift);
        }, { transient: true });
        break;
      }
      case 'trim-r': {
        const o = drag.orig;
        let ne = snap(o.start + o.duration + dt, [o.id], e).t;
        ne = Math.max(o.start + 0.1, ne);
        st.commit((pr) => {
          const c = pr.clips.find((c) => c.id === o.id);
          if (c) c.duration = round(ne - o.start, 3);
        }, { transient: true });
        break;
      }
      case 'roll': {
        const { a0, b0 } = drag;
        const end0 = a0.start + a0.duration;
        const morphStart = a0.start + exitWindow(a0)[0];
        const bEnd = b0.start + b0.duration;
        let ne = snap(end0 + dt, [a0.id, b0.id], e).t;
        ne = Math.max(morphStart + 0.1, Math.min(bEnd - 0.1, ne));
        const d = ne - end0;
        st.commit((pr) => {
          const a = pr.clips.find((c) => c.id === a0.id);
          const b = pr.clips.find((c) => c.id === b0.id);
          if (!a || !b) return;
          a.duration = round(a0.duration + d, 3);
          a.exit = { ...a.exit, duration: round(ne - morphStart, 2) };
          b.start = round(ne, 3);
          b.duration = round(bEnd - ne, 3);
          b.keys = b0.keys.map((k) => ({ ...k, t: round(Math.max(0, k.t - d), 4) }));
          b.effects = b0.effects.map((x) => ({ ...x, at: round(Math.max(0, x.at - d), 3) }));
          if (b0.parts) b.parts = shiftParts(b0.parts, d);
        }, { transient: true });
        break;
      }
      case 'enter':
      case 'exit': {
        const o = drag.orig;
        const other = drag.kind === 'enter' ? (o.exit.type !== 'none' ? o.exit.duration : 0) : (o.enter.type !== 'none' ? o.enter.duration : 0);
        const cur = drag.kind === 'enter' ? o.enter.duration : o.exit.duration;
        const nd = Math.max(0.1, Math.min(o.duration - other, cur + (drag.kind === 'enter' ? dt : -dt)));
        st.commit((pr) => {
          const c = pr.clips.find((c) => c.id === o.id);
          if (!c) return;
          if (drag.kind === 'enter') c.enter = { ...c.enter, duration: round(nd, 2) };
          else c.exit = { ...c.exit, duration: round(nd, 2) };
        }, { transient: true });
        break;
      }
      case 'key': {
        const c = st.project.clips.find((c) => c.id === drag.id);
        if (!c) return;
        if (!drag.moved) {
          if (Math.abs(e.clientX - drag.sx) < 3) return;
          st.checkpoint();
          drag.moved = true;
        }
        let nt = drag.t0 + dt;
        nt = snap(c.start + nt, [], e).t - c.start;
        nt = Math.max(0, Math.min(c.duration, nt));
        st.commit((pr) => {
          const cc = pr.clips.find((x) => x.id === drag.id);
          const k = cc?.keys.find((k) => k.id === drag.key);
          if (k && cc) {
            k.t = round(nt, 4);
            cc.keys.sort((a, b) => a.t - b.t);
          }
        }, { transient: true });
        st.setTime(c.start + nt);
        break;
      }
      case 'effect': {
        const c = st.project.clips.find((c) => c.id === drag.id);
        if (!c) return;
        const ef = c.effects.find((x) => x.id === drag.eff);
        if (!ef) return;
        if (!drag.moved) {
          if (Math.abs(e.clientX - drag.sx) < 3) return;
          st.checkpoint();
          drag.moved = true;
          setAnimPop(null);
        }
        const na = Math.max(0, Math.min(c.duration - ef.duration, drag.at0 + dt));
        st.commit((pr) => {
          const cc = pr.clips.find((x) => x.id === drag.id);
          const x = cc?.effects.find((x) => x.id === drag.eff);
          if (x) x.at = round(na, 3);
        }, { transient: true });
        break;
      }
      case 'part-move':
      case 'part-l':
      case 'part-r':
      case 'part-enter':
      case 'part-exit': {
        const o = drag.orig;
        if (!drag.moved) {
          if (Math.abs(e.clientX - drag.sx) < 3) return;
          st.checkpoint();
          drag.moved = true;
          setAnimPop(null);
        }
        const tm = partTiming(o, drag.path);
        const [ed, xd] = partWindows(tm);
        const min = 0.05;
        // snap the dragged edge to the playhead / other clips' edges (in scene time)
        const snapU = (u: number) => snap(o.start + u, [], e).t - o.start;
        st.commit((pr) => {
          const c = pr.clips.find((x) => x.id === o.id);
          if (!c) return;
          if (drag.kind === 'part-move') {
            // a part that lasts to the end of the clip keeps that end (dragging = "appear later");
            // one that leaves earlier moves as a whole
            const toEnd = tm.until >= o.duration - 1e-6;
            const span = tm.until - tm.at;
            let at = tm.at + dt;
            if (toEnd) at = Math.max(0, Math.min(o.duration - min, snapU(at)));
            else {
              const sa = snapU(at), sb = snapU(at + span);
              at = Math.abs(sa - at) <= Math.abs(sb - (at + span)) ? sa : sb - span;
              at = Math.max(0, Math.min(o.duration - span, at));
            }
            const delta = at - tm.at;
            // the part moves with every part inside it that has its own timing
            c.parts = o.parts ? JSON.parse(JSON.stringify(o.parts)) : undefined;
            for (const p of Object.keys(o.parts || {})) {
              if (!p.startsWith(drag.path + '.')) continue;
              const s0 = o.parts![p];
              setPart(c, p, {
                at: s0.at !== undefined ? round(Math.max(0, Math.min(o.duration, s0.at + delta)), 3) : undefined,
                until: s0.until !== undefined ? round(Math.max(0, Math.min(o.duration, s0.until + delta)), 3) : undefined,
              });
            }
            setPart(c, drag.path, { at: round(at, 3), until: toEnd ? undefined : round(at + span, 3) });
          } else if (drag.kind === 'part-l') {
            const at = Math.max(0, Math.min(tm.until - min, snapU(tm.at + dt)));
            setPart(c, drag.path, { at: round(at, 3) });
          } else if (drag.kind === 'part-r') {
            const until = Math.max(tm.at + min, Math.min(o.duration, snapU(tm.until + dt)));
            setPart(c, drag.path, { until: until >= o.duration - 1e-6 ? null : round(until, 3) });
          } else if (drag.kind === 'part-enter') {
            const d = Math.max(0.05, Math.min(tm.until - tm.at - xd, ed + dt));
            setPart(c, drag.path, { enter: { ...tm.enter, duration: round(d, 2) } });
          } else {
            const d = Math.max(0.05, Math.min(tm.until - tm.at - ed, xd - dt));
            setPart(c, drag.path, { exit: { ...tm.exit, duration: round(d, 2) } });
          }
        }, { transient: true });
        break;
      }
      case 'end': {
        const nd = Math.max(0.5, round(drag.d0 + dt, 2));
        st.commit((pr) => {
          pr.settings.duration = nd;
        }, { transient: true });
        break;
      }
      case 'track': {
        const lane = Math.max(0, Math.min(tracks.length - 1, laneAt(p.y)));
        const cur = st.project.tracks.findIndex((t) => t.id === drag.id);
        if (lane !== cur) {
          st.commit((pr) => {
            const [t] = pr.tracks.splice(cur, 1);
            pr.tracks.splice(lane, 0, t);
          }, { transient: true });
        }
        break;
      }
    }
  };

  const onUp = () => {
    if (!drag) return;
    const st = useStore.getState();
    if (drag.kind === 'move' && drag.moved) {
      st.commit((pr) => {
        for (const id of drag.ids) resolveOverlap(pr, id);
      }, { transient: true });
    }
    if (drag.kind === 'trim-l' || drag.kind === 'trim-r') {
      st.commit((pr) => resolveOverlap(pr, drag.id), { transient: true });
    }
    // a plain click on the enter / exit part or on an effect toggles its chooser
    if (drag.kind === 'move' && !drag.moved) {
      const cur = animPopRef.current;
      const z = drag.zone;
      const id = drag.ids[0] ?? st.selection[0];
      if (z && id && !samePop(cur, id, z.kind)) setAnimPop({ clip: id, kind: z.kind, anchor: z.anchor });
      else setAnimPop(null);
    }
    if (drag.kind === 'part-move' && !drag.moved) {
      const cur = animPopRef.current;
      const z = drag.zone;
      if (z && !samePop(cur, drag.id, z.kind, undefined, drag.path)) setAnimPop({ clip: drag.id, kind: z.kind, part: drag.path, anchor: z.anchor });
      else setAnimPop(null);
      if (!z) revealInspector(drag.id, 'parts');
    }
    if (drag.kind === 'effect' && !drag.moved) {
      setAnimPop(null);
      revealInspector(drag.id, 'effects', drag.eff);
    }
    setDrag(null);
    setSnapLine(null);
    useStore.setState({ interacting: false });
  };

  // ------------------------------------------------------------------ drops
  const acceptDrop = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(DND_ITEM) || e.dataTransfer.types.includes(DND_ASSET) || e.dataTransfer.types.includes('Files');
  const onDragOver = (e: React.DragEvent) => {
    if (!acceptDrop(e)) return;
    e.preventDefault();
    const p = pointer(e);
    setDropGhost({ x: Math.max(0, p.x), lane: Math.max(0, laneAt(p.y)) });
  };
  const onDrop = (e: React.DragEvent) => {
    setDropGhost(null);
    if (!acceptDrop(e)) return;
    e.preventDefault();
    const p = pointer(e);
    let time = Math.max(0, p.x / zoom);
    time = snap(time, [], e as any).t;
    let lane = laneAt(p.y);
    const st = useStore.getState();
    let trackId: string | null = null;
    if (lane >= 0 && lane < st.project.tracks.length) trackId = st.project.tracks[lane].id;
    else if (lane >= st.project.tracks.length) {
      // dropped below the last track: create a new (back-most) track
      st.commit((pr) => {
        trackId = insertTrack(pr, pr.tracks.length).id;
      });
    }
    const place = { time: round(time, 2), track: trackId };
    const item = e.dataTransfer.getData(DND_ITEM);
    const assetName = e.dataTransfer.getData(DND_ASSET);
    if (item) addItem(item, place);
    else if (assetName) addAsset(assetName, place);
    else if (e.dataTransfer.files.length) {
      importFiles([...e.dataTransfer.files].map((f) => window.studio.pathForFile(f)).filter(Boolean), place);
    }
  };

  // ------------------------------------------------------------------ menus
  const clipMenu = (e: React.MouseEvent, c: Clip) => {
    e.preventDefault();
    const st = useStore.getState();
    if (!st.selection.includes(c.id)) useStore.setState({ selection: [c.id] });
    const effects = library?.animations.effects || [];
    // time under the pointer, snapped like a drag (playhead, clip edges); ⌘ right-click doesn't snap
    const at = round(Math.max(0, snap(pointer(e).x / zoom, [c.id], e).t), 3);
    const plan = transformPlan(c, at, st.project);
    const tree = trees[c.id];
    const group = isGroupTree(tree);
    const nParts = timedParts(c).length;
    const nMoved = Object.values(c.parts || {}).filter(hasOffset).length;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(group || nParts || nMoved
          ? [
              { label: partsOpen.includes(c.id) ? 'Hide parts' : `Show parts (${tree?.children?.length ?? '…'})`, icon: <ListTree size={14} />, action: () => togglePartsOpen(c.id) },
              ...(group ? [staggerItem(c, '')] : []),
              { label: 'Reset part timing', icon: <RotateCcw size={14} />, disabled: !nParts, action: () => st.commit((p) => { const cc = p.clips.find((x) => x.id === c.id); if (cc) resetPart(cc, '', true); }) },
              ...(nMoved ? [{ label: `Put moved parts back (${nMoved})`, icon: <RotateCcw size={14} />, action: () => st.commit((p) => { const cc = p.clips.find((x) => x.id === c.id); if (cc) resetPart(cc, '', true, 'position'); }) } as MenuItem] : []),
              { sep: true } as MenuItem,
            ]
          : []),
        {
          label: plan ? `Add transform here (${plan.t.toFixed(2)}s)` : 'Add transform here',
          icon: <Shuffle size={14} />,
          shortcut: 'T',
          disabled: !plan,
          action: () => addTransformAt(c.id, at),
        },
        { sep: true },
        { label: 'Duplicate', icon: <Copy size={14} />, shortcut: '⌘D', action: duplicateSelection },
        { label: 'Blade at playhead', icon: <Scissors size={14} />, shortcut: '⌘B', action: () => splitAtPlayhead(), disabled: !canCutAt(c, st.time) },
        { label: 'Add keyframe at playhead', icon: <KeyRound size={14} />, shortcut: 'K', action: () => st.commit((p) => { const cc = p.clips.find((x) => x.id === c.id); if (cc) addKeyAt(cc, st.time - cc.start, fps); }) },
        {
          label: 'Add effect at playhead',
          icon: <Sparkles size={14} />,
          submenu: effects.map((ef) => ({
            label: ef.label,
            icon: <AnimIcon id={ef.id} size={14} />,
            action: () =>
              st.commit((p) => {
                const cc = p.clips.find((x) => x.id === c.id);
                if (!cc) return;
                const at = Math.max(0, Math.min(cc.duration - 1, st.time - cc.start));
                cc.effects.push({ id: uid('e'), type: ef.id, at: round(at, 2), duration: 1, rate: 'smooth' });
              }),
          })),
        },
        { label: 'Move to new track above', icon: <Layers size={14} />, action: () => st.commit((p) => { const cc = p.clips.find((x) => x.id === c.id); if (!cc) return; const t = insertTrack(p, trackIdx[cc.track]); cc.track = t.id; }) },
        { label: 'Edit code', icon: <Code2 size={14} />, action: () => editClipCode(c.id) },
        { sep: true },
        { label: 'Delete', icon: <Trash2 size={14} />, shortcut: '⌫', danger: true, action: deleteSelection },
      ],
    });
  };

  /** "Stagger" submenu: the children of `path` ("" = the clip's parts) enter one after another (LaggedStart). */
  const staggerItem = (c: Clip, path: string): MenuItem => ({
    label: path ? 'Stagger its parts' : 'Stagger parts (one after another)',
    icon: <Layers size={14} />,
    submenu: STAGGER_STEPS.map((step) => ({
      label: `${step}s apart`,
      action: () => {
        const tree = trees[c.id];
        if (!tree) return;
        useStore.getState().commit((p) => {
          const cc = p.clips.find((x) => x.id === c.id);
          if (cc) staggerParts(cc, tree, path, step);
        });
        // show what happened
        const open = useStore.getState().partsOpen;
        const want = [openKey(c.id, ''), ...(path ? [openKey(c.id, path)] : [])].filter((k) => !open.includes(k));
        if (want.length) useStore.setState({ partsOpen: [...open, ...want] });
      },
    })),
  });

  const partMenu = (e: React.MouseEvent, c: Clip, node: PartNode) => {
    e.preventDefault();
    e.stopPropagation();
    const st = useStore.getState();
    useStore.setState({ selection: [c.id], selectedKey: null, selectedPart: { clip: c.id, path: node.path } });
    const anims = library?.animations;
    const tm = partTiming(c, node.path);
    const u = round(st.time - c.start, 3);
    const edit = (fn: (cc: Clip) => void) => st.commit((p) => { const cc = p.clips.find((x) => x.id === c.id); if (cc) fn(cc); });
    const animSub = (kind: 'enter' | 'exit'): MenuItem[] =>
      (kind === 'enter' ? anims?.enter || [] : (anims?.exit || []).filter((a) => a.id !== 'TransformInto' && a.id !== 'TransformMatching')).map((a) => ({
        label: `${(kind === 'enter' ? tm.enter.type : tm.exit.type) === a.id ? '✓ ' : ''}${labelFor(a.id, kind === 'enter' ? anims?.enter : anims?.exit)}`,
        icon: <AnimIcon id={a.id} size={14} />,
        action: () => edit((cc) => {
          const cur = kind === 'enter' ? tm.enter : tm.exit;
          setPart(cc, node.path, { [kind]: { type: a.id, duration: cur.type !== 'none' && cur.duration ? cur.duration : 0.5, rate: cur.rate || 'smooth' } });
        }),
      }));
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: `Enter animation`, icon: <AnimIcon id={tm.enter.type} size={14} />, submenu: animSub('enter') },
        { label: `Exit animation`, icon: <AnimIcon id={tm.exit.type} size={14} />, submenu: animSub('exit') },
        { label: `Appear at playhead (${st.time.toFixed(2)}s)`, disabled: u < 0 || u >= tm.until, action: () => edit((cc) => setPart(cc, node.path, { at: Math.max(0, u) })) },
        { label: `Leave at playhead (${st.time.toFixed(2)}s)`, disabled: u <= tm.at || u > c.duration, action: () => edit((cc) => setPart(cc, node.path, { until: u >= c.duration ? null : u })) },
        ...(node.children?.length ? [{ sep: true } as MenuItem, staggerItem(c, node.path)] : []),
        { sep: true },
        { label: 'Reset timing (follow the clip)', icon: <RotateCcw size={14} />, disabled: !tm.own, action: () => edit((cc) => resetPart(cc, node.path)) },
        ...(node.children?.length ? [{ label: 'Reset timing of everything inside', disabled: !Object.keys(c.parts || {}).some((p) => p.startsWith(node.path + '.')), action: () => edit((cc) => resetPart(cc, node.path, true)) } as MenuItem] : []),
        ...(hasOffset(c.parts?.[node.path]) || Object.entries(c.parts || {}).some(([p, s]) => p.startsWith(node.path + '.') && hasOffset(s))
          ? [{ label: 'Put back in place', icon: <Move size={14} />, action: () => edit((cc) => resetPart(cc, node.path, true, 'position')) } as MenuItem]
          : []),
        { label: 'Hide this part', icon: <EyeOff size={14} />, shortcut: '⌫', action: () => hidePart(c.id, node.path) },
      ],
    });
  };

  /** Right-click on empty track space: transform the element that was last on this track (holding it until here). */
  const laneMenu = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('lane')) return;
    e.preventDefault();
    const p = pointer(e);
    const lane = laneAt(p.y);
    const t = tracks[lane];
    if (!t) return;
    const at = round(Math.max(0, snap(p.x / zoom, [], e).t), 3);
    const before = clips.filter((c) => c.track === t.id && c.start + c.duration <= at + 1e-6).sort((a, b) => b.start + b.duration - (a.start + a.duration))[0];
    const plan = before && transformPlan(before, at, project);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        before
          ? { label: `Transform “${before.name}” here (${at.toFixed(2)}s)`, icon: <Shuffle size={14} />, disabled: !plan, action: () => addTransformAt(before.id, at) }
          : { label: 'Add transform here — no element on this track before this point', icon: <Shuffle size={14} />, disabled: true },
        { sep: true },
        { label: 'Insert track above', icon: <Plus size={14} />, action: () => useStore.getState().commit((pr) => { insertTrack(pr, lane); }) },
        { label: 'Insert track below', icon: <Plus size={14} />, action: () => useStore.getState().commit((pr) => { insertTrack(pr, lane + 1); }) },
        emptyTracksItem(),
      ],
    });
  };

  const emptyTracksItem = (): MenuItem => {
    const n = emptyTrackIds(project).size;
    const all = n >= project.tracks.length;
    return {
      label: n ? `Remove empty tracks (${all ? n - 1 : n})` : 'Remove empty tracks',
      icon: <Trash2 size={14} />,
      disabled: !n || (all && n <= 1),
      action: () => useStore.getState().commit((pr) => { removeEmptyTracks(pr); }),
    };
  };

  const trackMenu = (e: React.MouseEvent, ti: number) => {
    e.preventDefault();
    const st = useStore.getState();
    const t = tracks[ti];
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Insert track above', icon: <Plus size={14} />, action: () => st.commit((p) => { insertTrack(p, ti); }) },
        { label: 'Insert track below', icon: <Plus size={14} />, action: () => st.commit((p) => { insertTrack(p, ti + 1); }) },
        { label: 'Rename', action: () => setRenaming(t.id) },
        { label: 'Select all clips on track', action: () => useStore.setState({ selection: clips.filter((c) => c.track === t.id).map((c) => c.id) }) },
        emptyTracksItem(),
        { sep: true },
        { label: 'Delete track', icon: <Trash2 size={14} />, danger: true, disabled: tracks.length <= 1, action: () => deleteTrack(t.id) },
      ],
    });
  };

  const deleteTrack = async (id: string) => {
    const st = useStore.getState();
    const n = st.project.clips.filter((c) => c.track === id).length;
    if (n > 0) {
      const r = await window.studio.confirm(`Delete track and its ${n} clip${n > 1 ? 's' : ''}?`, undefined, ['Delete', 'Cancel']);
      if (r !== 0) return;
    }
    st.commit((p) => {
      if (p.tracks.length <= 1) return;
      p.tracks = p.tracks.filter((t) => t.id !== id);
      p.clips = p.clips.filter((c) => c.track !== id);
    });
  };

  // ------------------------------------------------------------------ render helpers
  const step = tickStep(zoom);
  const ticks: number[] = [];
  for (let t = 0; t <= duration + 400 / zoom; t += step) ticks.push(round(t, 3));
  const minor = step / (step >= 1 ? (step === 1 ? 4 : 5) : 2);

  const fmtTick = (t: number) => {
    if (step < 1) return `${t.toFixed(step < 0.5 ? 1 : 1)}s`;
    const m = Math.floor(t / 60);
    const s = Math.round(t % 60);
    return m ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
  };

  const lanesH = tracksH;

  return (
    <div className={`panel timeline tool-${tool}`} onPointerDownCapture={blurTypingFocus}>
      <div className="tl-scroll" ref={scrollRef} onScroll={() => animPopRef.current && setAnimPop(null)} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setBlade(null)} onDragOver={onDragOver} onDragLeave={() => setDropGhost(null)} onDrop={onDrop}>
        <div className="tl-grid" style={{ gridTemplateColumns: `${HEADER_W}px ${contentW}px`, gridTemplateRows: `${RULER_H}px ${CAM_H}px ${lanesH + LANE_H}px` }}>
          {/* ruler */}
          <div className="tl-corner">
            <span className="muted"><Layers size={12} /> z ↑ front</span>
          </div>
          <div
            className="tl-ruler"
            onPointerDown={(e) => {
              useStore.setState({ playing: false });
              useStore.getState().setTime(Math.max(0, pointer(e).x / zoom));
              startDrag(e, { kind: 'scrub' });
            }}
          >
            {ticks.map((t) => (
              <div key={t} className="tick major" style={{ left: t * zoom }}>
                <span>{fmtTick(t)}</span>
              </div>
            ))}
            {ticks.flatMap((t) =>
              Array.from({ length: Math.round(step / minor) - 1 }, (_, i) => (
                <div key={`${t}-${i}`} className="tick minor" style={{ left: (t + (i + 1) * minor) * zoom }} />
              )),
            )}
          </div>

          {/* camera track */}
          <div className={`tl-head tl-cam-head ${selection.includes(CAMERA_ID) ? 'sel' : ''}`} data-testid="camera-track-head" style={{ height: CAM_H, position: 'sticky', left: 0, zIndex: 5 }} onClick={() => useStore.setState({ selection: [CAMERA_ID], selectedKey: null })}>
            <Camera size={14} />
            <div className="tl-head-name"><span className="nm">Camera</span></div>
          </div>
          <div
            className={`tl-cam-lane ${selection.includes(CAMERA_ID) ? 'sel' : ''}`}
            data-testid="camera-track"
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget) return;
              useStore.setState({ selection: [CAMERA_ID], selectedKey: null, playing: false });
              useStore.getState().setTime(Math.max(0, pointer(e).x / zoom));
              startDrag(e, { kind: 'scrub' });
            }}
            onDoubleClick={(e) => {
              if (e.target !== e.currentTarget) return;
              const t = round(Math.max(0, pointer(e).x / zoom), 2);
              useStore.getState().commit((p) => setCameraAt(p, t, {}, fps));
              useStore.setState({ selection: [CAMERA_ID] });
            }}
          >
            {[...(settings.camera || [])].sort((a, b) => a.t - b.t).map((k, i, arr) => (
              <div key={k.id}>
                {i > 0 && <div className="cam-span" style={{ left: arr[i - 1].t * zoom, width: (k.t - arr[i - 1].t) * zoom }} />}
                <div
                  className={`cam-key ${Math.abs(k.t - time) < 0.5 / fps ? 'on' : ''}`}
                  style={{ left: k.t * zoom }}
                  title={`Camera key at ${k.t.toFixed(2)}s — drag to move, double-click to remove`}
                  onDoubleClick={(e) => { e.stopPropagation(); useStore.getState().commit((p) => { p.settings.camera = (p.settings.camera || []).filter((x) => x.id !== k.id); }); }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    useStore.setState({ selection: [CAMERA_ID], playing: false });
                    useStore.getState().setTime(k.t);
                    useStore.getState().checkpoint();
                    const x0 = e.clientX, t0 = k.t;
                    const mv = (ev: PointerEvent) => {
                      const nt = round(Math.max(0, t0 + (ev.clientX - x0) / zoom), 2);
                      useStore.getState().commit((p) => { const kk = p.settings.camera?.find((x) => x.id === k.id); if (kk) kk.t = nt; }, { transient: true });
                      useStore.getState().setTime(nt);
                    };
                    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
                    window.addEventListener('pointermove', mv);
                    window.addEventListener('pointerup', up);
                  }}
                />
              </div>
            ))}
            {!(settings.camera || []).length && <span className="cam-hint">double-click to add a camera keyframe</span>}
          </div>

          {/* track headers */}
          <div className="tl-headers">
            {tracks.map((t, i) => (
              <div
                key={t.id}
                className={`tl-head ${t.hidden ? 'is-hidden' : ''} ${drag?.kind === 'track' && drag.id === t.id ? 'is-dragging' : ''} ${trackH[i] > LANE_H ? 'has-parts' : ''}`}
                style={{ height: trackH[i], ['--lane-h' as any]: `${LANE_H}px` }}
                onContextMenu={(e) => trackMenu(e, i)}
              >
                <span
                  className="grip"
                  title="Drag to reorder (changes z-order)"
                  onPointerDown={(e) => {
                    useStore.getState().checkpoint();
                    startDrag(e, { kind: 'track', id: t.id, sy: e.clientY, index0: i });
                  }}
                >
                  <GripVertical size={14} />
                </span>
                <div className="tl-head-name" onDoubleClick={() => setRenaming(t.id)}>
                  {renaming === t.id ? (
                    <input
                      autoFocus
                      defaultValue={t.name}
                      onBlur={(e) => {
                        const v = e.target.value.trim() || t.name;
                        useStore.getState().commit((p) => { const tt = p.tracks.find((x) => x.id === t.id); if (tt) tt.name = v; });
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                    />
                  ) : (
                    <>
                      <span className="nm">{t.name}</span>
                      <span className="z">z {tracks.length - i}</span>
                    </>
                  )}
                </div>
                <button
                  className={`mini ${t.hidden ? 'off' : ''}`}
                  title={t.hidden ? 'Show track' : 'Hide track'}
                  onClick={() => useStore.getState().commit((p) => { const tt = p.tracks.find((x) => x.id === t.id); if (tt) tt.hidden = !tt.hidden; })}
                >
                  {t.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  className={`mini ${t.locked ? 'on' : ''}`}
                  title={t.locked ? 'Unlock track' : 'Lock track'}
                  onClick={() => useStore.getState().commit((p) => { const tt = p.tracks.find((x) => x.id === t.id); if (tt) tt.locked = !tt.locked; })}
                >
                  {t.locked ? <Lock size={13} /> : <Unlock size={13} />}
                </button>
              </div>
            ))}
            <div className="tl-head add" style={{ height: LANE_H }} onClick={() => useStore.getState().commit((p) => { insertTrack(p, p.tracks.length); })}>
              <Plus size={14} /> Add track
            </div>
          </div>

          {/* lanes */}
          <div
            className="tl-lanes"
            onContextMenu={laneMenu}
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('lane')) return;
              useStore.setState({ selection: [], selectedKey: null, selectedPart: null, playing: false });
              useStore.getState().setTime(Math.max(0, pointer(e).x / zoom));
              startDrag(e, { kind: 'scrub' });
            }}
          >
            {tracks.map((t, i) => (
              <div key={t.id} className={`lane ${i % 2 ? 'odd' : ''} ${t.hidden ? 'is-hidden' : ''} ${t.locked ? 'is-locked' : ''}`} style={{ top: trackTop[i], height: trackH[i] }} />
            ))}
            <div className="lane-past-end" style={{ left: duration * zoom, height: lanesH }} />
            {clips.map((c) => {
              const ti = trackIdx[c.track];
              if (ti === undefined) return null;
              return (
                <ClipView
                  key={c.id}
                  c={c}
                  top={trackTop[ti] + 4}
                  height={LANE_H - 8}
                  zoom={zoom}
                  selected={selection.includes(c.id)}
                  selectedKey={selectedKey?.key}
                  error={errors[c.id]}
                  conflict={clips.some((o) => o.id !== c.id && o.track === c.track && overlaps(o, c))}
                  hidden={!!tracks[ti].hidden}
                  target={(() => { const m = morphs.find((m) => m.a.id === c.id); return m ? m.b : null; })()}
                  joinOut={morphs.some((m) => m.joined && m.a.id === c.id)}
                  joinIn={morphs.some((m) => m.joined && m.b.id === c.id)}
                  from={morphs.find((m) => m.b.id === c.id)?.a.name}
                  morphSelected={selection.length === 1 && selection[0] === morphSelId(c.id)}
                  onMorphDown={onMorphDown}
                  onMorphMenu={morphMenu}
                  onPointerDown={(e) => onClipDown(e, c)}
                  onContextMenu={(e) => clipMenu(e, c)}
                  group={isGroupTree(trees[c.id]) || !!c.parts}
                  nParts={trees[c.id]?.children?.length ?? 0}
                  partsOpen={partsOpen.includes(c.id)}
                />
              );
            })}
            {clips.map((c) => {
              const ti = trackIdx[c.track];
              const rows = rowsOf[c.id];
              if (ti === undefined || !rows.length) return null;
              return rows.map((r, i) => (
                <PartRowView
                  key={`${c.id}|${r.node.path}`}
                  c={c}
                  row={r}
                  top={trackTop[ti] + LANE_H + i * PART_H}
                  zoom={zoom}
                  selected={selectedPart?.clip === c.id && selectedPart.path === r.node.path}
                  hidden={!!tracks[ti].hidden}
                  onPointerDown={(e) => onPartDown(e, c, r.node.path)}
                  onContextMenu={(e) => partMenu(e, c, r.node)}
                />
              ));
            })}
            {morphs.map(({ a, b, joined }) => {
              const ta = trackIdx[a.track], tb = trackIdx[b.track];
              if (ta === undefined || tb === undefined) return null;
              const x0 = (a.start + a.duration) * zoom;
              // same track, touching: the transform clip between them already shows the change
              if (joined) return null;
              // different tracks (or a gap): a connector from the end of A's morph to the start of B
              const x1 = b.start * zoom;
              const y0 = trackTop[ta] + LANE_H / 2, y1 = trackTop[tb] + LANE_H / 2;
              const left = Math.min(x0, x1) - 8, top = Math.min(y0, y1) - 8;
              const mx = (x0 + x1) / 2;
              const d = `M ${x0 - left} ${y0 - top} C ${mx - left + 18} ${y0 - top}, ${mx - left - 18} ${y1 - top}, ${x1 - left} ${y1 - top}`;
              return (
                <svg key={a.id} className="morph-link" data-testid="morph-link" style={{ left, top, width: Math.abs(x1 - x0) + 16, height: Math.abs(y1 - y0) + 16 }}>
                  <path d={d} />
                  <circle cx={x0 - left} cy={y0 - top} r={3} />
                  <circle cx={x1 - left} cy={y1 - top} r={3} />
                </svg>
              );
            })}
            {dropGhost && (
              <div className="drop-ghost" style={{ left: dropGhost.x, top: (dropGhost.lane < tracks.length ? trackTop[dropGhost.lane] : tracksH) + 4, width: 4 * zoom, height: LANE_H - 8 }}>
                {dropGhost.lane >= tracks.length ? 'New track' : ''}
              </div>
            )}
            {snapLine !== null && <div className="snap-line" style={{ left: snapLine * zoom, height: lanesH }} />}
            {blade && tool === 'blade' && (() => {
              const targets = blade.all ? clipsCuttableAt(blade.t, project) : clips.filter((c) => c.id === blade.clip);
              return targets.map((c) => trackIdx[c.track] === undefined ? null : (
                <div key={c.id} className="blade-line" data-testid="blade-line" style={{ left: blade.t * zoom, top: trackTop[trackIdx[c.track]] + 2, height: LANE_H - 4 }} />
              ));
            })()}
          </div>

          {/* scene end + playhead */}
          <div
            className="tl-end"
            style={{ left: HEADER_W + duration * zoom, top: 0, height: RULER_H + CAM_H + lanesH }}
            title={`Scene end (${duration}s) — drag to change`}
            onPointerDown={(e) => {
              useStore.getState().checkpoint();
              startDrag(e, { kind: 'end', sx: e.clientX, d0: duration });
            }}
          />
          <div className="tl-playhead" style={{ left: HEADER_W + time * zoom, height: RULER_H + CAM_H + lanesH }}>
            <div
              className="ph-handle"
              onPointerDown={(e) => {
                useStore.setState({ playing: false });
                startDrag(e, { kind: 'scrub' });
              }}
            />
          </div>
        </div>
      </div>
      <TimelineZoom scrollRef={scrollRef} zoom={zoom} duration={duration} viewW={viewW} time={time} />
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {animPop && <ClipAnimPopover pop={animPop} onClose={() => setAnimPop(null)} />}
    </div>
  );
}

/** Bottom-of-timeline zoom track: the thumb is the visible slice. Drag it to scroll, drag either edge to zoom. */
function TimelineZoom({ scrollRef, zoom, duration, viewW, time }: {
  scrollRef: React.RefObject<HTMLDivElement>;
  zoom: number;
  duration: number;
  viewW: number;
  time: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ scroll: 0, scrollW: 1, clientW: 1 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => setMetrics({ scroll: el.scrollLeft, scrollW: el.scrollWidth, clientW: el.clientWidth });
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, [scrollRef, zoom, duration, viewW]);

  const contentPx = Math.max(1, metrics.scrollW - HEADER_W);
  const viewPx = Math.max(1, metrics.clientW - HEADER_W);
  const thumbW = Math.min(1, viewPx / contentPx);
  const thumbL = Math.max(0, Math.min(1 - thumbW, metrics.scroll / contentPx));
  const visible = viewPx / Math.max(zoom, 1);

  const applyZoom = (nz: number, anchorSec: number) => {
    const el = scrollRef.current;
    const next = Math.max(12, Math.min(600, nz));
    useStore.setState({ zoom: next });
    requestAnimationFrame(() => {
      if (el) el.scrollLeft = Math.max(0, anchorSec * next);
    });
  };

  const onThumbDown = (e: React.PointerEvent, edge: 'pan' | 'l' | 'r') => {
    e.stopPropagation();
    e.preventDefault();
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const trackW = track.clientWidth || 1;
    const sx = e.clientX;
    const scroll0 = el.scrollLeft;
    const z0 = useStore.getState().zoom;
    const start0 = scroll0 / z0;
    const lane = Math.max(1, el.clientWidth - HEADER_W);
    const end0 = start0 + lane / z0;
    const total = contentPx / z0;
    const move = (ev: PointerEvent) => {
      const dSec = ((ev.clientX - sx) / trackW) * total;
      if (edge === 'pan') {
        const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
        el.scrollLeft = Math.max(0, Math.min(maxScroll, scroll0 + dSec * z0));
        return;
      }
      const minVis = lane / 600;
      const maxVis = lane / 12;
      if (edge === 'r') {
        const vis = Math.max(minVis, Math.min(maxVis, end0 + dSec - start0));
        applyZoom(lane / vis, start0);
      } else {
        const start = Math.max(0, Math.min(end0 - minVis, start0 + dSec));
        const vis = Math.max(minVis, Math.min(maxVis, end0 - start));
        applyZoom(lane / vis, Math.max(0, end0 - vis));
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="tl-zoombar" data-testid="timeline-zoom">
      <div className="tl-zoom-btns" style={{ width: HEADER_W }}>
        <button className="btn small" title="Zoom out" onClick={() => applyZoom(zoom / 1.3, (scrollRef.current?.scrollLeft || 0) / zoom)}><Minus size={14} /></button>
        <button className="btn small" title="Zoom in" onClick={() => applyZoom(zoom * 1.3, (scrollRef.current?.scrollLeft || 0) / zoom)}><Plus size={14} /></button>
        <button
          className="btn small"
          title="Fit the whole scene"
          onClick={() => {
            const w = (scrollRef.current?.clientWidth || viewW) - HEADER_W - 40;
            useStore.setState({ zoom: Math.max(12, Math.min(600, w / Math.max(duration, 1))) });
            if (scrollRef.current) scrollRef.current.scrollLeft = 0;
          }}
        >
          <Maximize size={13} /> Fit
        </button>
      </div>
      <div
        className="tl-zoom-track"
        ref={trackRef}
        title="Drag to scroll the timeline · drag the edges to zoom"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('.tl-zoom-thumb')) return;
          const el = scrollRef.current;
          const track = trackRef.current;
          if (!el || !track) return;
          const rect = track.getBoundingClientRect();
          const frac = (e.clientX - rect.left) / Math.max(1, rect.width);
          const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
          el.scrollLeft = Math.max(0, Math.min(maxScroll, frac * contentPx - viewPx / 2));
        }}
      >
        <div className="tl-zoom-playhead" style={{ left: `${Math.max(0, Math.min(1, (time * zoom) / contentPx)) * 100}%` }} />
        <div
          className="tl-zoom-thumb"
          style={{ left: `${thumbL * 100}%`, width: `${Math.max(thumbW * 100, 0)}%` }}
          onPointerDown={(e) => onThumbDown(e, 'pan')}
        >
          <div className="tl-zoom-edge l" onPointerDown={(e) => onThumbDown(e, 'l')} />
          <div className="tl-zoom-edge r" onPointerDown={(e) => onThumbDown(e, 'r')} />
        </div>
      </div>
      <span className="tl-zoom-span" title="Seconds visible">{visible >= 10 ? `${Math.round(visible)}s` : `${visible.toFixed(1)}s`}</span>
    </div>
  );
}

/** Animation chooser for one part (enter / exit / an effect) of a clip, opened from the timeline. */
function ClipAnimPopover({ pop, onClose }: { pop: AnimPop; onClose: () => void }) {
  const clip = useStore((s) => s.project.clips.find((c) => c.id === pop.clip));
  const anims = useStore((s) => s.library?.animations);
  const effect = pop.kind === 'effect' ? clip?.effects.find((x) => x.id === pop.eff) : undefined;
  const ptm = clip && pop.part !== undefined ? partTiming(clip, pop.part) : null;
  const value = ptm ? (pop.kind === 'enter' ? ptm.enter.type : ptm.exit.type) : pop.kind === 'enter' ? clip?.enter.type : pop.kind === 'exit' ? clip?.exit.type : effect?.type;
  const gone = !clip || !anims || !value || (pop.kind !== 'effect' && value === 'none');
  useEffect(() => {
    if (gone) onClose();
  }, [gone]);
  if (gone) return null;
  let options = pop.kind === 'enter' ? anims.enter : pop.kind === 'exit' ? anims.exit : anims.effects;
  if (ptm) options = options.filter((o) => o.id !== 'TransformInto' && o.id !== 'TransformMatching');
  const what = pop.kind === 'enter' ? 'Enter animation' : pop.kind === 'exit' ? 'Exit animation' : 'Effect';
  const tree = cachedParts(clip);
  const partLabel = ptm && pop.part !== undefined ? (() => { const n = findNode(tree, pop.part!); return n ? partName(n) : `part ${pop.part}`; })() : '';
  const onChange = (v: string) => {
    if (v === value) return;
    if (ptm && pop.part !== undefined) {
      const path = pop.part;
      useStore.getState().commit((p) => {
        const c = p.clips.find((x) => x.id === pop.clip);
        if (!c) return;
        const cur = pop.kind === 'enter' ? ptm.enter : ptm.exit;
        setPart(c, path, { [pop.kind]: { ...cur, type: v, duration: cur.duration || 0.5 } });
      });
      return;
    }
    useStore.getState().commit((p) => {
      const c = p.clips.find((x) => x.id === pop.clip);
      if (!c) return;
      if (pop.kind === 'enter') c.enter = { ...c.enter, type: v, duration: c.enter.duration || 1 };
      else if (pop.kind === 'exit') c.exit = { ...c.exit, type: v, duration: c.exit.duration || 1 };
      else {
        const x = c.effects.find((x) => x.id === pop.eff);
        if (x) x.type = v;
      }
    });
    // morphs need a target clip, which is picked in the inspector
    if (pop.kind === 'exit' && (v === 'TransformInto' || v === 'TransformMatching')) revealInspector(pop.clip, 'exit');
  };
  return (
    <AnimPopover
      kind={pop.kind}
      value={value}
      options={options}
      anchor={pop.anchor}
      align={pop.kind === 'exit' ? 'right' : 'left'}
      title={`${what} · ${clip.name}${partLabel ? ` › ${partLabel}` : ''}`}
      onChange={onChange}
      onClose={onClose}
      ignore={() => document.querySelector(pop.part !== undefined ? `.part-bar[data-clip-part="${pop.clip}"][data-part="${pop.part}"]` : `.clip[data-clip="${pop.clip}"]`)}
      testid="tl-anim"
      clipId={pop.clip}
      effId={pop.eff}
      part={pop.part}
    />
  );
}

function ClipView({ c, top, height, zoom, selected, selectedKey, error, conflict, hidden, target, joinIn, joinOut, from, morphSelected, onMorphDown, onMorphMenu, onPointerDown, onContextMenu, group, nParts, partsOpen }: {
  c: Clip; top: number; height: number; zoom: number; selected: boolean; selectedKey?: string; error?: string; conflict: boolean; hidden: boolean;
  /** the clip this one morphs into, if any */
  target: Clip | null;
  /** fused with the clip it morphs from / into (same track, touching) */
  joinIn: boolean; joinOut: boolean;
  /** name of the clip that morphs into this one */
  from?: string;
  /** the transform clip after this one (its morph into `target`) is selected */
  morphSelected?: boolean;
  onMorphDown?: (e: React.PointerEvent, a: Clip, b: Clip) => void;
  onMorphMenu?: (e: React.MouseEvent, a: Clip, b: Clip) => void;
  onPointerDown: (e: React.PointerEvent) => void; onContextMenu: (e: React.MouseEvent) => void;
  /** the mobject is a group: its parts can be shown and timed on rows under the clip */
  group?: boolean; nParts?: number; partsOpen?: boolean;
}) {
  const library = useStore((s) => s.library);
  const item = itemById(c.item);
  const category = item?.category || 'Custom';
  const color = CATEGORY_COLORS[category] || '#888';
  const thumb = useClipThumb(c);
  const dynamic = !!(item?.dynamic || c.dynamic);
  const strip = useClipStrip(c, dynamic, target);
  const contentH = height - 19; // .clip-content: top 4, bottom 15
  const ed = c.enter.type !== 'none' ? Math.min(c.enter.duration, c.duration) : 0;
  const xd = c.exit.type !== 'none' ? Math.min(c.exit.duration, c.duration) : 0;
  const scale = ed + xd > c.duration ? c.duration / (ed + xd) : 1;
  // a morph into another clip is drawn as its own clip after this one (the transform), not as an exit
  const morph = !!target && isMorph(c);
  const hold = morph ? c.duration - xd * scale : c.duration;
  const w = Math.max(4, hold * zoom);
  const anims = library?.animations;
  const holdStrip = strip && (dynamic || !morph) ? strip : null;
  return (
    <>
    <div
      data-clip={c.id}
      className={`clip ${selected ? 'selected' : ''} ${error ? 'has-error' : ''} ${conflict ? 'conflict' : ''} ${hidden ? 'is-hidden' : ''} ${morph ? 'morph-out' : ''} ${from ? 'morph-in' : ''}`}
      style={{ left: c.start * zoom, top, width: w, height, ['--clip' as any]: color }}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onDoubleClick={() => revealInspector(c.id, 'params')}
      title={`${c.name} · ${c.start.toFixed(2)}s → ${(c.start + c.duration).toFixed(2)}s${from ? `\nMorphed from “${from}”` : ''}${target ? `\nMorphs into “${target.name}”` : ''}${error ? `\n⚠ ${error}` : ''}`}
    >
      {ed > 0 && (
        <div className="clip-enter" data-zone="enter" style={{ width: ed * scale * zoom }} title={`Enter: ${labelFor(c.enter.type, anims?.enter)} — click to change`}>
          <span className="anim-chip"><AnimIcon id={c.enter.type} size={11} /></span>
          <div className="anim-handle right" data-role="enter" title="Drag to change the enter duration" />
        </div>
      )}
      {xd > 0 && !morph && (
        <div className="clip-exit" data-zone="exit" style={{ width: xd * scale * zoom }} title={`Exit: ${labelFor(c.exit.type, anims?.exit)} — click to change`}>
          <span className="anim-chip"><AnimIcon id={c.exit.type} size={11} /></span>
          <div className="anim-handle left" data-role="exit" title="Drag to change the exit duration" />
        </div>
      )}
      {holdStrip && <Filmstrip strip={holdStrip} zoom={zoom} height={contentH} origin={0} />}
      <div className="clip-content" style={holdStrip && !dynamic ? { right: Math.max(6, (c.duration - holdStrip.t0) * zoom + 4) } : undefined}>
        {dynamic && holdStrip ? null : thumb.url ? (
          <img className={`clip-img ${thumb.pending ? 'stale' : ''}`} src={thumb.url} alt={c.name} draggable={false} />
        ) : (
          <span className="clip-fallback">
            <CategoryIcon category={category} size={15} />
            <span className="nm">{c.name}</span>
          </span>
        )}
      </div>
      <div className="clip-badges">
        {error && <span className="err-badge" title={error}><AlertTriangle size={10} /></span>}
        {item?.dynamic || c.dynamic ? <span className="dyn-badge" title="Animated — rebuilt every frame"><Timer size={10} /></span> : null}
        {c.code && <span className="dyn-badge" title="Custom code"><Code2 size={10} /></span>}
        {c.exit.target && !morph && <span className="dyn-badge" title={target ? `Morphs into “${target.name}”` : 'Transforms into another clip'}><Shuffle size={10} /></span>}
      </div>
      {c.effects.map((ef) => (
        <div
          key={ef.id}
          className="clip-effect"
          data-role="effect"
          data-eff={ef.id}
          style={{ left: ef.at * zoom, width: Math.max(12, ef.duration * zoom) }}
          title={`${labelFor(ef.type, anims?.effects)} — drag to move, click to edit in the inspector`}
        >
          <AnimIcon id={ef.type} size={9} />
        </div>
      ))}
      {c.keys.map((k) => (
        <div
          key={k.id}
          className={`kf ${selectedKey === k.id ? 'sel' : ''}`}
          data-role="key"
          data-key={k.id}
          style={{ left: k.t * zoom }}
          title={`Keyframe @ ${(c.start + k.t).toFixed(2)}s — drag to move, ⌫ to delete`}
        />
      ))}
      {/* where parts with their own timing come in (a LaggedStart shows as a row of ticks) */}
      {Object.entries(c.parts || {}).map(([p, sp]) =>
        sp.at !== undefined && sp.at > 0 && sp.at < c.duration ? <div key={p} className="part-tick" style={{ left: sp.at * zoom }} /> : null,
      )}
      {group && (
        <button
          className={`parts-toggle ${partsOpen ? 'on' : ''} ${c.parts ? 'custom' : ''}`}
          data-role="parts-toggle"
          data-testid="parts-toggle"
          title={`${partsOpen ? 'Hide' : 'Show'} the ${nParts || ''} parts of this group${timedParts(c).length ? ` · ${timedParts(c).length} with their own timing` : ''}`}
        >
          {partsOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <ListTree size={10} />
          {nParts ? <span>{nParts}</span> : null}
        </button>
      )}
      <div className="trim l" data-role="trim-l" />
      {/* a morphing clip's end is where its transform starts */}
      <div className="trim r" data-role={morph ? 'exit' : 'trim-r'} title={morph ? 'Drag to change when the transform starts' : undefined} />
    </div>
    {morph && target && (
      <div
        className={`tclip ${morphSelected ? 'selected' : ''} ${hidden ? 'is-hidden' : ''} ${joinOut ? 'joined' : ''}`}
        data-morph={c.id}
        data-testid="transform-clip"
        style={{ left: (c.start + hold) * zoom, top, width: Math.max(4, xd * scale * zoom), height }}
        onPointerDown={(e) => onMorphDown?.(e, c, target)}
        onContextMenu={(e) => onMorphMenu?.(e, c, target)}
        title={`${labelFor(c.exit.type, anims?.exit)}: “${c.name}” → “${target.name}” · ${(c.start + hold).toFixed(2)}s → ${(c.start + c.duration).toFixed(2)}s\nClick to edit · drag the edges to change when it starts / ends`}
      >
        {strip && <Filmstrip strip={strip} zoom={zoom} height={contentH} origin={hold} />}
        <span className="tclip-chip"><Shuffle size={10} /></span>
        <div className="trim l" data-role="exit" title="Drag to change when the transform starts" />
        {joinOut && <div className="trim r" data-role="morph-roll" title={`Drag to change when the transform ends (where “${target.name}” starts)`} />}
      </div>
    )}
    </>
  );
}

/** One part (submobject) of an expanded group clip: a bar from when it appears to when it is gone. */
function PartRowView({ c, row, top, zoom, selected, hidden, onPointerDown, onContextMenu }: {
  c: Clip; row: PartRow; top: number; zoom: number; selected: boolean; hidden: boolean;
  onPointerDown: (e: React.PointerEvent) => void; onContextMenu: (e: React.MouseEvent) => void;
}) {
  const anims = useStore((s) => s.library?.animations);
  const item = itemById(c.item);
  const color = CATEGORY_COLORS[item?.category || 'Custom'] || '#888';
  const { node, depth } = row;
  const tm = partTiming(c, node.path);
  const [ed, xd] = partWindows(tm);
  const gone = tm.until - tm.at < 1e-6;
  const left = (c.start + tm.at) * zoom;
  const w = Math.max(gone ? 0 : 6, (tm.until - tm.at) * zoom);
  const name = partName(node);
  const kind = node.label ? node.type : '';
  const nested = !!node.children?.length;
  const tip = `${name}${kind ? ` · ${kind}` : ''}${nested ? ` · ${node.n} parts` : ''}\n` +
    (gone ? 'Hidden — right-click → Reset timing' : `${(c.start + tm.at).toFixed(2)}s → ${(c.start + tm.until).toFixed(2)}s · enter ${labelFor(tm.enter.type, anims?.enter)}${tm.exit.type !== 'none' ? ` · exit ${labelFor(tm.exit.type, anims?.exit)}` : ''}`) +
    (tm.own ? '\nOwn timing' : tm.custom ? '\nTiming from its group' : '\nFollows the clip') + '\nDrag to retime · drag the edges to change when it appears / leaves · right-click for animations';
  return (
    <>
      <div className={`part-guide ${hidden ? 'is-hidden' : ''}`} style={{ left: c.start * zoom, top, width: c.duration * zoom, height: PART_H }} />
      <div
        className={`part-bar ${selected ? 'selected' : ''} ${tm.own ? 'own' : tm.custom ? 'inherited' : ''} ${gone ? 'gone' : ''} ${hidden ? 'is-hidden' : ''}`}
        data-clip-part={c.id}
        data-part={node.path}
        data-testid="part-bar"
        style={{ left: gone ? (c.start + tm.at) * zoom - 1 : left, top: top + 2, width: gone ? 2 : w, height: PART_H - 4, ['--clip' as any]: color }}
        title={tip}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
        onDoubleClick={(e) => { e.stopPropagation(); revealInspector(c.id, 'params'); }}
      >
        {!gone && ed > 0 && (
          <div className="part-enter" data-zone="enter" style={{ width: ed * zoom }}>
            <div className="anim-handle right" data-role="part-enter" title="Drag to change this part's enter duration" />
          </div>
        )}
        {!gone && xd > 0 && (
          <div className="part-exit" data-zone="exit" style={{ width: xd * zoom }}>
            <div className="anim-handle left" data-role="part-exit" title="Drag to change this part's exit duration" />
          </div>
        )}
        {!gone && (
          <span className="part-label" style={{ paddingLeft: 4 + depth * 10 }}>
            {nested && (
              <span className="part-caret" data-role="part-toggle" data-testid="part-toggle" title={row.open ? 'Hide its parts' : 'Show its parts'}>
                {row.open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </span>
            )}
            {tm.enter.type !== 'none' && <AnimIcon id={tm.enter.type} size={10} />}
            <span className="nm">{name}</span>
            {kind && <span className="ty">{kind}</span>}
            {hasOffset(c.parts?.[node.path]) && <span className="moved" data-testid="part-moved" title="Moved in the preview — right-click → Put back in place"><Move size={9} /></span>}
          </span>
        )}
        {!gone && <div className="trim l" data-role="part-l" />}
        {!gone && <div className="trim r" data-role="part-r" />}
      </div>
    </>
  );
}

/**
 * Frames of a changing clip tiled along its bar (like a video editor's filmstrip): each tile shows the
 * frame nearest the time at its centre, so zooming the timeline reveals more of the motion. A frame that
 * looks like the one before it is not repeated: the bar stays empty (a thin hold line) until the look changes.
 */
function Filmstrip({ strip, zoom, height, origin }: { strip: Strip; zoom: number; height: number; /** clip-local time at the container's left edge */ origin: number }) {
  const span = Math.max(strip.t1 - strip.t0, 1e-3);
  const W = span * zoom;
  const H = Math.max(8, height);
  const fw = Math.max(4, (strip.w / Math.max(strip.h, 1)) * H);
  const tw = Math.max(fw + 5, 14); // a little air between frames so dense shapes don't merge
  const k = Math.max(1, Math.min(240, Math.ceil(W / tw)));
  const runs = strip.runs?.length === strip.n ? strip.runs : null;
  const tiles = [];
  let lastRun = -1;
  for (let i = 0; i < k; i++) {
    const frac = Math.min(1, ((i + 0.5) * tw) / W);
    const idx = Math.max(0, Math.min(strip.n - 1, Math.floor(frac * strip.n)));
    const run = runs ? runs[idx] : idx;
    const hold = run === lastRun;
    lastRun = run;
    tiles.push(
      hold ? (
        <div key={i} className="strip-tile hold" style={{ width: tw }} />
      ) : (
        <div
          key={i}
          className="strip-tile"
          style={{
            width: tw,
            backgroundImage: `url(${strip.url})`,
            backgroundSize: `${strip.n * fw}px ${H}px`,
            backgroundPosition: `${(tw - fw) / 2 - idx * fw}px 0`,
          }}
        />
      ),
    );
  }
  return (
    <div className={`clip-strip ${strip.pending ? 'stale' : ''}`} data-testid="clip-strip" data-frames={strip.n} style={{ left: (strip.t0 - origin) * zoom, width: W, height: H }}>
      {tiles}
    </div>
  );
}

function labelFor(id: string, list?: { id: string; label: string }[]) {
  return list?.find((a) => a.id === id)?.label.replace(' (no animation)', '') || id;
}
