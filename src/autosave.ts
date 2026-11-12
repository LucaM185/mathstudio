// Projects save themselves: shortly after every change an open project is written to its file —
// the one on screen and any other open project an agent is editing in the background.
// A new project gets a file in the projects folder (~/Documents/MathStudio) as soon as it has
// something in it, named after the project — renaming the project renames the file.
import { useSessions, useStore } from './store';
import { activeSid, docHandle } from './sessions';

const DELAY = 700;

const timers = new Map<string, any>();
// one write at a time: two new projects called "Untitled" must not race for the same file name
let chain: Promise<unknown> = Promise.resolve();
let lastError = '';

/** Save soon (debounced), by default the project on screen. */
export function scheduleSave(sid = activeSid()) {
  clearTimeout(timers.get(sid));
  timers.set(sid, setTimeout(() => { timers.delete(sid); queue(sid, false); }, DELAY));
}

/**
 * Save now and wait for it. `force` also writes an empty, untouched project (⌘S).
 * Resolves to false only when a write was attempted and failed.
 */
export async function flushSave(force = false, sid = activeSid()): Promise<boolean> {
  clearTimeout(timers.get(sid));
  timers.delete(sid);
  return queue(sid, force);
}

/** Save every open project (quitting). */
export async function flushAll(): Promise<boolean> {
  const sids = [activeSid(), ...Object.keys(useSessions.getState().docs)];
  const r = await Promise.all(sids.map((sid) => flushSave(false, sid)));
  return r.every(Boolean);
}

export const hasPendingSave = (sid: string) => timers.has(sid);

function queue(sid: string, force: boolean): Promise<boolean> {
  const run = chain.then(() => write(sid, force));
  chain = run.catch(() => {});
  return run;
}

async function write(sid: string, force: boolean): Promise<boolean> {
  const h = docHandle(sid);
  if (!h.alive()) return true; // closed meanwhile (it was flushed before closing)
  const { project, filePath, dirty } = h.get();
  if (!force && !dirty) return true;
  // an empty "Untitled" project isn't worth a file until something is put in it
  if (!force && !filePath && !project.clips.length) return true;
  const r = await window.studio.autosaveProject(filePath, project);
  if (r.disabled) return true;
  if (r.error || !r.path) {
    if (r.error !== lastError) useStore.getState().toast(`Could not save “${project.settings.name}”: ${r.error}`, 'error');
    lastError = r.error || '';
    return false;
  }
  lastError = '';
  const now = h.get();
  if (now.filePath !== filePath) return true; // the file was renamed / replaced meanwhile
  h.set({ filePath: r.path, ...(now.project === project ? { dirty: false } : {}) });
  return true;
}

// background projects (edited by an agent) save themselves too
useSessions.subscribe((s, prev) => {
  if (s.docs === prev.docs) return;
  for (const [sid, d] of Object.entries(s.docs)) {
    const before = prev.docs[sid];
    if (before && d.dirty && d.project !== before.project) scheduleSave(sid);
  }
});
