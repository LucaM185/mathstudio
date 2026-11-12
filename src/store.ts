import { create } from 'zustand';
import type { GlInfo, RenderQuality } from './quality';
import type { CamView, Clip, FrameMeta, LibraryData, Project } from './types';
import { clone, newProject, normalizeProject, projectEnd } from './ops';
import { applyLayout } from './globals';

const HISTORY_LIMIT = 200;

/** Timeline tool, as in Final Cut Pro: A = Select (arrow), B = Blade. */
export type Tool = 'select' | 'blade';

export type EngineStatus = 'starting' | 'ready' | 'error' | 'restarting';

export interface AnimPreview {
  /** scratch copy of the project with the candidate animation applied */
  project: Project;
  /** scene-time window that is looped */
  t0: number;
  t1: number;
  label: string;
}

export interface Toast {
  id: number;
  text: string;
  kind?: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

interface State {
  /** the open project's session (see sessions.ts): other projects stay alive in the background */
  sessionId: string;
  project: Project;
  filePath: string | null;
  dirty: boolean;
  past: Project[];
  future: Project[];

  library: LibraryData | null;
  port: number | null;
  engineStatus: EngineStatus;
  engineError: string | null;

  selection: string[];
  selectedKey: { clip: string; key: string } | null;
  /** a part of a group clip picked on the timeline (path = submobject indices, see Clip.parts) */
  selectedPart: { clip: string; path: string } | null;
  /** group clips whose parts are shown on the timeline: clip ids, and "clipId|path" for opened nested groups */
  partsOpen: string[];
  time: number;
  playing: boolean;
  loop: boolean;
  zoom: number; // px per second
  meta: FrameMeta | null;
  metaProject: Project | null; // the project the current preview frame was rendered from
  codeOpen: boolean;
  exportOpen: boolean;
  projectsOpen: boolean;
  snapping: boolean;
  tool: Tool;
  interacting: boolean;
  camFullView: boolean; // camera selected: show the whole scene with a crop box instead of looking through the camera
  /** free editor viewpoint (CAD-style orbit / pan / zoom); not exported. null = look through the camera */
  editorView: CamView | null;
  toasts: Toast[];
  /** which clip's code the code drawer is editing; null shows the generated scene */
  codeClip: string | null;
  /** ask the inspector to open one section of a clip (n bumps on every request) */
  inspectorFocus: { clip: string; section: string; effectId?: string; n: number } | null;
  rightTab: 'inspector' | 'agent' | 'settings';
  /** preview quality from Settings (persisted by main in settings.json) */
  renderQuality: RenderQuality;
  /** OpenGL implementation the engine renders with (from /health) */
  gl: GlInfo | null;
  /** live preview of an animation choice in the main viewer (set while an animation picker is open) */
  animPreview: AnimPreview | null;

  // project mutations
  commit: (fn: (p: Project) => void, opts?: { transient?: boolean }) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  loadProject: (p: Project, path: string | null) => void;
  markSaved: (path: string) => void;

  set: (patch: Partial<State>) => void;
  select: (ids: string[], additive?: boolean) => void;
  setTime: (t: number) => void;
  toast: (text: string, kind?: Toast['kind'], action?: Toast['action']) => void;
}

export const newSessionId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Per-project state: what each open project keeps while another one is on screen. */
export const DOC_KEYS = ['project', 'filePath', 'dirty', 'past', 'future', 'time', 'selection', 'selectedKey', 'selectedPart', 'partsOpen', 'editorView', 'camFullView', 'codeClip', 'zoom'] as const;
export type DocState = Pick<State, (typeof DOC_KEYS)[number]>;
export const pickDoc = (s: State): DocState => Object.fromEntries(DOC_KEYS.map((k) => [k, s[k]])) as DocState;

/** One edit to a project: the patch to apply (shared by the store and background sessions). */
export function commitPatch(doc: Pick<DocState, 'project' | 'past'>, fn: (p: Project) => void, opts?: { transient?: boolean }): Partial<DocState> {
  const cur = doc.project;
  const next = clone(cur);
  fn(next);
  applyLayout(cur, next);
  // auto-extend the scene duration to cover all clips
  const end = projectEnd(next);
  if (end > next.settings.duration) next.settings.duration = Math.ceil(end * 2) / 2;
  if (opts?.transient) return { project: next, dirty: true };
  return { project: next, past: [...doc.past, cur].slice(-HISTORY_LIMIT), future: [], dirty: true };
}

export interface BgDoc extends DocState {
  /** last time this project was on screen */
  lastActive: number;
}

/**
 * Projects that are open but not on screen. The one on screen lives in `useStore`; switching moves
 * its state here and swaps the other one in (sessions.ts), so an agent working on a project keeps
 * editing that project — never the one the user is looking at.
 */
export const useSessions = create<{ docs: Record<string, BgDoc>; activeSince: number }>(() => ({ docs: {}, activeSince: Date.now() }));

/** Things that make a project worth keeping open when the user leaves it (e.g. an agent chat). */
export const sessionKeepers: ((sid: string) => boolean)[] = [];
export const sessionDroppers: ((sid: string) => void)[] = [];
const MAX_BACKGROUND = 10;

/** Move the project on screen to the background (or drop it if there's nothing worth keeping). */
export function stashActive(st: State) {
  const doc = pickDoc(st);
  const keep = !!doc.filePath || doc.project.clips.length > 0 || sessionKeepers.some((k) => k(st.sessionId));
  const docs = { ...useSessions.getState().docs };
  if (keep) docs[st.sessionId] = { ...doc, lastActive: Date.now() };
  else sessionDroppers.forEach((d) => d(st.sessionId));
  // cap memory: forget the oldest saved, idle projects (they reopen from their file)
  const idle = Object.entries(docs)
    .filter(([sid, d]) => !d.dirty && d.filePath && !sessionKeepers.some((k) => k(sid)))
    .sort((a, b) => a[1].lastActive - b[1].lastActive);
  let extra = Object.keys(docs).length - MAX_BACKGROUND;
  for (const [sid] of idle) {
    if (extra-- <= 0) break;
    delete docs[sid];
    sessionDroppers.forEach((d) => d(sid));
  }
  useSessions.setState({ docs });
}

export const useStore = create<State>((set, get) => ({
  sessionId: newSessionId(),
  project: newProject(),
  filePath: null,
  dirty: false,
  past: [],
  future: [],

  library: null,
  port: null,
  engineStatus: 'starting',
  engineError: null,

  selection: [],
  selectedKey: null,
  selectedPart: null,
  partsOpen: [],
  time: 0,
  playing: false,
  loop: true,
  zoom: 90,
  meta: null,
  metaProject: null,
  codeOpen: false,
  exportOpen: false,
  projectsOpen: false,
  snapping: true,
  tool: 'select',
  interacting: false,
  camFullView: true,
  editorView: null,
  toasts: [],
  codeClip: null,
  inspectorFocus: null,
  rightTab: 'inspector',
  renderQuality: 'auto',
  gl: null,
  animPreview: null,

  commit: (fn, opts) => set(commitPatch(get(), fn, opts)),
  checkpoint: () => {
    const cur = get().project;
    set({ past: [...get().past, cur].slice(-HISTORY_LIMIT), future: [] });
  },
  undo: () => {
    const { past, project, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future], dirty: true });
    pruneSelection();
  },
  redo: () => {
    const { past, project, future } = get();
    if (!future.length) return;
    const next = future[0];
    set({ project: next, past: [...past, project], future: future.slice(1), dirty: true });
    pruneSelection();
  },
  loadProject: (p, path) => {
    // the project being left stays open in the background (its agent may still be working)
    stashActive(get());
    useSessions.setState({ activeSince: Date.now() });
    set({ sessionId: newSessionId(), project: normalizeProject(p), filePath: path, dirty: false, past: [], future: [], selection: [], selectedKey: null, selectedPart: null, partsOpen: [], time: 0, playing: false, editorView: null, inspectorFocus: null, codeClip: null, camFullView: true, animPreview: null, meta: null, metaProject: null });
  },
  markSaved: (path) => set({ filePath: path, dirty: false }),

  set: (patch) => set(patch as any),
  select: (ids, additive) => {
    if (additive) {
      const cur = new Set(get().selection);
      for (const id of ids) {
        if (cur.has(id)) cur.delete(id);
        else cur.add(id);
      }
      set({ selection: [...cur], selectedKey: null, selectedPart: null });
    } else set({ selection: ids, selectedKey: null, selectedPart: null });
  },
  setTime: (t) => {
    const d = get().project.settings.duration;
    set({ time: Math.min(Math.max(0, t), d) });
  },
  toast: (text, kind = 'info', action) => {
    const id = Date.now() + Math.random();
    set({ toasts: [...get().toasts, { id, text, kind, action }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), action ? 8000 : kind === 'error' ? 6000 : 3000);
  },
}));

/** Switch the right column to the inspector and open one section of a clip. */
export function revealInspector(clip: string, section: string, effectId?: string) {
  const n = (useStore.getState().inspectorFocus?.n ?? 0) + 1;
  useStore.setState({
    rightTab: 'inspector',
    selection: [clip],
    inspectorFocus: { clip, section, effectId, n },
  });
}

/** Open the code drawer on one clip's source. */
export function editClipCode(id: string) {
  useStore.setState({ codeOpen: true, codeClip: id, selection: [id] });
}

function pruneSelection() {
  const s = useStore.getState();
  const ids = new Set(s.project.clips.map((c) => c.id));
  ids.add('__camera__'); // the camera is always there
  useStore.setState({
    selection: s.selection.filter((id) => ids.has(id) || (id.startsWith('__morph__:') && s.project.clips.some((c) => '__morph__:' + c.id === id && c.exit.target && (c.exit.type === 'TransformInto' || c.exit.type === 'TransformMatching')))),
    ...(s.selectedPart && !ids.has(s.selectedPart.clip) ? { selectedPart: null } : {}),
  });
}

export const getClip = (id: string): Clip | undefined => useStore.getState().project.clips.find((c) => c.id === id);
export const itemById = (id: string) => useStore.getState().library?.items.find((i) => i.id === id);
