// Open projects ("sessions"). The project on screen lives in `useStore`; every other open project
// keeps its state in `useSessions` — undo history, playhead, selection, its AI chat (agent.ts).
// Code that must keep working on one project while the user looks at another (the AI agent,
// autosave) goes through a DocHandle, which finds that project wherever it currently lives.
import { create } from 'zustand';
import type { Project } from './types';
import { commitPatch, pickDoc, sessionDroppers, sessionKeepers, stashActive, useSessions, useStore, type DocState } from './store';

export interface DocHandle {
  readonly sid: string;
  /** on screen right now */
  active(): boolean;
  /** still open (on screen or in the background) */
  alive(): boolean;
  get(): DocState;
  set(patch: Partial<DocState>): void;
  commit(fn: (p: Project) => void, opts?: { transient?: boolean }): void;
  setTime(t: number): void;
}

export const activeSid = () => useStore.getState().sessionId;

export function docHandle(sid: string): DocHandle {
  let last: DocState | null = null;
  const h: DocHandle = {
    sid,
    active: () => useStore.getState().sessionId === sid,
    alive: () => h.active() || !!useSessions.getState().docs[sid],
    get: () => {
      if (h.active()) return (last = pickDoc(useStore.getState()));
      const d = useSessions.getState().docs[sid];
      if (d) last = d;
      return last!;
    },
    set: (patch) => {
      if (h.active()) return useStore.setState(patch);
      const docs = useSessions.getState().docs;
      const d = docs[sid];
      if (!d) return; // the project was closed: nothing to write to
      useSessions.setState({ docs: { ...docs, [sid]: { ...d, ...patch } } });
    },
    commit: (fn, opts) => h.set(commitPatch(h.get(), fn, opts)),
    setTime: (t) => {
      const d = h.get().project.settings.duration;
      h.set({ time: Math.min(Math.max(0, t), d) });
    },
  };
  h.get();
  return h;
}

/** The open project whose file is `path`, if any. */
export function sessionForPath(path: string): string | null {
  const st = useStore.getState();
  if (st.filePath === path) return st.sessionId;
  for (const [sid, d] of Object.entries(useSessions.getState().docs)) if (d.filePath === path) return sid;
  return null;
}

/**
 * Put an open project on screen. Synchronous: no tool call or autosave can land in between with
 * the wrong project. The project being left stays open in the background.
 */
export function activateSession(sid: string): boolean {
  const st = useStore.getState();
  if (st.sessionId === sid) return true;
  const { [sid]: target, ...rest } = useSessions.getState().docs;
  if (!target) return false;
  switching = true;
  try {
  useSessions.setState({ docs: rest });
  stashActive(st);
  useSessions.setState({ activeSince: Date.now() });
  const { lastActive: _drop, ...doc } = target;
  useStore.setState({
    ...doc,
    sessionId: sid,
    playing: false,
    animPreview: null,
    meta: null,
    metaProject: null,
    inspectorFocus: null,
    selectedKey: null,
    interacting: false,
  });
  } finally {
    switching = false;
  }
  syncStrip();
  return true;
}
let switching = false;

/** Forget a background project (it reopens from its file). Callers flush its autosave first. */
export function closeSession(sid: string) {
  if (useStore.getState().sessionId === sid) return false;
  const { [sid]: gone, ...rest } = useSessions.getState().docs;
  if (!gone) return false;
  useSessions.setState({ docs: rest });
  sessionDroppers.forEach((d) => d(sid));
  return true;
}

/** A project file was renamed on disk: keep an open copy of it pointing at the new file. */
export function renamedFile(oldPath: string, newPath: string, name: string) {
  const sid = sessionForPath(oldPath);
  if (!sid) return;
  const h = docHandle(sid);
  const wasDirty = h.get().dirty;
  h.commit((p) => { p.settings.name = name; }, { transient: true });
  h.set({ filePath: newPath, dirty: wasDirty });
}

/** The background project that was on screen most recently (⌃Tab). */
export function previousSession(): string | null {
  let best: string | null = null;
  let at = -1;
  for (const [sid, d] of Object.entries(useSessions.getState().docs)) {
    if (d.lastActive > at) { at = d.lastActive; best = sid; }
  }
  return best;
}

// ------------------------------------------------------------------ recent-projects strip
// A stable, tab-like order: a project enters at the left the first time it's opened and keeps its
// place while you jump around. Entries are session ids (open projects) or file paths (closed ones).

/** last known file of each open project, so a closed one falls back to its file's entry */
const lastPaths = new Map<string, string>();
export const MAX_STRIP = 7;

interface StripState {
  order: string[];
  /** thumbnails by file path */
  thumbs: Record<string, string>;
  /** what the strip knows about closed files (from the projects list) */
  files: Record<string, { title: string; exists: boolean; background?: string }>;
}

// seeded at launch from the recent-projects list (recent-projects.json), most recent first
export const useStrip = create<StripState>(() => ({ order: [], thumbs: {}, files: {} }));

export const isSid = (id: string) => !id.startsWith('/');

/** File path behind a strip entry (null for a project that was never saved). */
export function entryPath(id: string): string | null {
  if (!isSid(id)) return id;
  const st = useStore.getState();
  if (st.sessionId === id) return st.filePath;
  return useSessions.getState().docs[id]?.filePath ?? null;
}

// Files the user closed from the strip. seedStrip refills empty slots from the recent-projects list,
// so without this a closed project came straight back on the next refresh (or relaunch). A file
// leaves this list when it's opened again.
const DISMISSED_KEY = 'ms.strip.dismissed';
const dismissed: Set<string> = (() => {
  try { return new Set<string>(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')); } catch { return new Set<string>(); }
})();
function saveDismissed() {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed].slice(-200))); } catch { /* storage unavailable */ }
}
/** Keep a closed file off the strip until it's opened again. */
export function dismissFromStrip(path: string | null | undefined) {
  if (!path || dismissed.has(path)) return;
  dismissed.add(path);
  saveDismissed();
}
function undismiss(path: string | null | undefined) {
  if (path && dismissed.delete(path)) saveDismissed();
}

const busySessions: ((sid: string) => boolean)[] = [];
/** Entries that must never fall off the strip (an agent is working there). */
export function pinStripWhile(fn: (sid: string) => boolean) { busySessions.push(fn); }

function setOrder(order: string[]) {
  const st = useStore.getState();
  const docs = useSessions.getState().docs;
  let out: string[] = [];
  for (const id of order) {
    if (isSid(id)) {
      if (id !== st.sessionId && !docs[id]) {
        // closed: fall back to its file if it had one
        const p = lastPaths.get(id);
        if (p && !out.includes(p) && !sessionForPath(p)) out.push(p);
        continue;
      }
      if (!out.includes(id)) out.push(id);
    } else {
      // an open project replaces its own file's entry
      const v = sessionForPath(id) ?? id;
      if (!out.includes(v)) out.push(v);
    }
  }
  // trim from the end, but never the one on screen or one with a busy agent
  while (out.length > MAX_STRIP) {
    let i = out.length - 1;
    while (i >= 0 && (out[i] === st.sessionId || (isSid(out[i]) && busySessions.some((f) => f(out[i]))))) i--;
    if (i < 0) break;
    out.splice(i, 1);
  }
  for (const id of out) if (isSid(id)) { const p = entryPath(id); if (p) lastPaths.set(id, p); }
  const prev = useStrip.getState().order;
  if (prev.length !== out.length || prev.some((x, i) => x !== out[i])) useStrip.setState({ order: out });
}

/** Keep the strip in sync with what's open: the project on screen is always on it. */
export function syncStrip() {
  const st = useStore.getState();
  const order = useStrip.getState().order;
  const sid = st.sessionId;
  undismiss(st.filePath);
  const has = order.includes(sid) || (st.filePath && order.includes(st.filePath));
  setOrder(has ? order : [sid, ...order]);
}

/** Add recently opened files to the strip when it has room (first launch, or after closing some). */
export function seedStrip(recent: { path: string; title?: string; exists: boolean; thumb?: string; background?: string; opened?: number }[]) {
  const files: StripState['files'] = {};
  const thumbs: Record<string, string> = { ...useStrip.getState().thumbs };
  for (const r of recent) {
    files[r.path] = { title: r.title || r.path.split('/').pop()!.replace(/\.mstudio$/i, ''), exists: r.exists, background: r.background };
    if (r.thumb && !thumbs[r.path]) thumbs[r.path] = r.thumb;
  }
  useStrip.setState({ files, thumbs });
  // drop files that no longer exist
  let order = useStrip.getState().order.filter((id) => isSid(id) || files[id]?.exists !== false);
  if (order.length < MAX_STRIP) {
    // only projects actually opened in MathStudio, most recent first (not every file in the folder)
    for (const r of [...recent].filter((r) => r.opened).sort((a, b) => (b.opened || 0) - (a.opened || 0))) {
      if (order.length >= MAX_STRIP) break;
      if (!r.exists || dismissed.has(r.path) || order.includes(r.path) || sessionForPath(r.path)) continue;
      order.push(r.path);
    }
  }
  setOrder(order);
}

export function setThumb(path: string, png: string) {
  useStrip.setState({ thumbs: { ...useStrip.getState().thumbs, [path]: png } });
}

/** Put an entry at the end of the strip (a new tab opens on the right, like a browser). */
export function moveStripToEnd(id: string) {
  const order = useStrip.getState().order;
  const path = entryPath(id);
  const key = order.includes(id) ? id : path && order.includes(path) ? path : null;
  if (!key) return;
  setOrder([...order.filter((x) => x !== key), key]);
}

export function removeFromStrip(id: string) {
  const path = entryPath(id);
  dismissFromStrip(path);
  setOrder(useStrip.getState().order.filter((x) => x !== id && x !== path));
  if (isSid(id)) lastPaths.delete(id);
}

// whenever the project on screen changes (switch, new, open) or an open project gets a file
useStore.subscribe((s, prev) => {
  if (switching) return;
  if (s.sessionId !== prev.sessionId || s.filePath !== prev.filePath) syncStrip();
});
useSessions.subscribe((s, prev) => {
  if (switching) return;
  if (s.docs !== prev.docs && Object.keys(s.docs).length < Object.keys(prev.docs).length) setOrder(useStrip.getState().order);
});

export { sessionKeepers };
