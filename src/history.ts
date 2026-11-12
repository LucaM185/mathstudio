// Version history: autosave keeps the file current, ⌘S also records a *version* of it — a
// git-like commit of the whole project plus a small looping GIF — listed in the Projects popup
// (⋯ → See history), where any version can be restored (undoable) or opened as a copy.
import { useStore } from './store';
import { flushSave } from './autosave';
import { projectGif } from './engine';
import { normalizeProject } from './ops';
import { switchToProject, thumbTime } from './actions';
import type { Project, ProjectVersion } from './types';

const S = () => useStore.getState();

/** Something changed in a history (new version, preview drawn, label): open history views reload. */
export const HISTORY_EVENT = 'ms:history';
const changed = (hid?: string) => window.dispatchEvent(new CustomEvent(HISTORY_EVENT, { detail: { hid } }));

// previews are drawn one at a time, after the save itself
let gifChain: Promise<unknown> = Promise.resolve();
const drawing = new Set<string>();

/** Draw (and store) the GIF + poster of a version. `project` = its content, when already in hand. */
export function drawVersionPreview(hid: string, id: string, project?: Project): Promise<boolean> {
  const key = `${hid}/${id}`;
  if (drawing.has(key)) return Promise.resolve(false);
  drawing.add(key);
  const run = gifChain.then(async () => {
    try {
      if (S().engineStatus !== 'ready') return false;
      let p = project;
      if (!p) {
        const r = await window.studio.history.read(hid, id);
        if (!r.data) return false;
        p = normalizeProject(r.data);
      }
      const { gif, png } = await projectGif(p, p.clips.length ? thumbTime(p) : 0);
      const ok = await window.studio.history.attach(hid, id, gif, png);
      if (ok) changed(hid);
      return ok;
    } catch (e) {
      return false;
    } finally {
      drawing.delete(key);
    }
  });
  gifChain = run.catch(() => {});
  return run;
}

export interface SavedVersion {
  version: number;
  commit: ProjectVersion;
  unchanged: boolean;
}

/**
 * Record a version of the open project's file (it must have just been written). The GIF is drawn
 * afterwards in the background. Returns null when there is no file / it failed (with a toast).
 */
export async function commitVersion(opts: { message?: string; note?: string } = {}): Promise<SavedVersion | null> {
  const { filePath, project } = S();
  if (!filePath) return null;
  const r = await window.studio.history.commit(filePath, opts);
  if (r.error || !r.commit || !r.hid) {
    S().toast(`Saved, but the version could not be recorded: ${r.error || 'unknown error'}`, 'error');
    return null;
  }
  if (!r.unchanged) {
    changed(r.hid);
    drawVersionPreview(r.hid, r.commit.id, project);
  }
  return { version: r.version!, commit: r.commit, unchanged: !!r.unchanged };
}

/**
 * Bring a project back to an earlier version. The project is opened if needed, its current state
 * is recorded first (when it isn't a version already) so nothing is lost, and the restore is one
 * undo step (⌘Z) — then recorded as a new version, like `git revert`.
 */
export async function restoreVersion(path: string, hid: string, v: ProjectVersion & { version?: number }): Promise<boolean> {
  const r = await window.studio.history.read(hid, v.id);
  if (!r.data) {
    S().toast(`Could not read that version: ${r.error || 'missing'}`, 'error');
    return false;
  }
  if (!(await switchToProject(path, { quiet: true }))) return false;
  if (S().filePath !== path) return false;
  const n = v.version ? `v${v.version}` : 'that version';
  await flushSave();
  await commitVersion({ note: `before restoring ${n}` });
  const target = normalizeProject(r.data);
  const keepName = S().project.settings.name; // restoring content, not the file's name
  S().commit((p) => {
    for (const k of Object.keys(p)) delete (p as any)[k];
    Object.assign(p, target);
    p.settings = { ...target.settings, name: keepName };
  });
  const ids = new Set(S().project.clips.map((c) => c.id));
  useStore.setState({ selection: S().selection.filter((id) => ids.has(id)), selectedKey: null, selectedPart: null });
  await flushSave();
  await commitVersion({ message: `Restored ${n}${v.label ? ` “${v.label}”` : ''}` });
  S().toast(`Restored ${n}`, 'success', { label: 'Undo', run: () => S().undo() });
  return true;
}

/** Open a version as a new project file next to the original ("<name> v3"). */
export async function openVersionCopy(path: string, hid: string, v: ProjectVersion): Promise<boolean> {
  const r = await window.studio.history.checkout(hid, v.id, path);
  if (r.error || !r.path) {
    S().toast(r.error || 'Could not copy that version', 'error');
    return false;
  }
  const ok = await switchToProject(r.path, { quiet: true });
  if (ok) S().toast(`Opened ${r.path.split('/').pop()}`, 'success');
  return ok;
}
