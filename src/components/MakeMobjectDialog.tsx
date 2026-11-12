import { useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, Globe, Image as ImageIcon, LoaderCircle, Lock, Package, X } from 'lucide-react';
import { useStore } from '../store';
import type { LibraryItem, Project, ProjectEntry } from '../types';
import { makeMobject, reloadLibrary, renderFrame } from '../engine';
import { addItem, thumbTime } from '../actions';
import { normalizeProject } from '../ops';

export type Plan = 'free' | 'pro';

let planCache: Promise<{ plan: Plan; name: string }> | null = null;
/** The account's plan (Free / Pro), from the main process. */
export function usePlan() {
  const [acct, setAcct] = useState<{ plan: Plan; name: string } | null>(null);
  useEffect(() => {
    planCache ||= (window.studio.account?.() ?? Promise.resolve({ plan: 'free' as Plan, name: '' })).catch(() => ({ plan: 'free' as Plan, name: '' }));
    let alive = true;
    planCache.then((a) => alive && setAcct(a));
    return () => { alive = false; };
  }, []);
  return acct;
}

/** Anything that changes over time? Then the mobject defaults to replaying the timeline. */
function isAnimated(p: Project) {
  const d = p.settings.duration;
  return p.clips.some((c) => (c.enter?.type && c.enter.type !== 'none') || (c.exit?.type && c.exit.type !== 'none') || c.keys.length || c.effects.length || c.dynamic || c.start > 0.01 || c.start + c.duration < d - 0.01);
}

const fmt = (s: number) => `${+s.toFixed(2)}s`;

/**
 * Projects popup → ⋯ → "Make into mobject…": turns a whole project into one library mobject that
 * can be dropped into any other project. On the Free plan the mobject is always public.
 */
export default function MakeMobjectDialog({ entry, onClose }: { entry: ProjectEntry; onClose: () => void }) {
  const acct = usePlan();
  const free = acct?.plan !== 'pro';
  const filePath = useStore((s) => s.filePath);
  const library = useStore((s) => s.library);
  const isCur = entry.path === filePath;
  const [project, setProject] = useState<Project | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [name, setName] = useState(entry.title || entry.name);
  const [desc, setDesc] = useState('');
  const [mode, setMode] = useState<'animated' | 'still'>('animated');
  const [at, setAt] = useState(0);
  const [vis, setVis] = useState<'public' | 'private'>('public');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(entry.thumb || null);
  const nameRef = useRef<HTMLInputElement>(null);

  // earlier mobjects made from this project: offer to replace the newest one
  const earlier = useMemo(() => (library?.items || []).filter((it) => it.user && it.source_path === entry.path).sort((a, b) => (b.updated || 0) - (a.updated || 0)), [library, entry.path]);
  const [replace, setReplace] = useState(true);
  const target: LibraryItem | undefined = earlier[0];

  useEffect(() => {
    let alive = true;
    (async () => {
      let p: Project | null = null;
      if (isCur) p = useStore.getState().project;
      else {
        const r = await window.studio.projects.peek(entry.path);
        if (r.error || !r.data) { if (alive) setLoadErr(r.error || 'Could not read the project'); return; }
        p = normalizeProject(r.data);
      }
      if (!alive || !p) return;
      setProject(p);
      setMode(isAnimated(p) ? 'animated' : 'still');
      setAt(thumbTime(p));
    })();
    setTimeout(() => nameRef.current?.select(), 0);
    return () => { alive = false; };
  }, [entry.path, isCur]);

  useEffect(() => {
    if (!target) return;
    setName(target.name);
    setVis(target.visibility === 'private' ? 'private' : 'public');
    // keep a description the user wrote (not the generated "Made from the project …" one)
    if (target.desc && !target.desc.startsWith('Made from the project')) setDesc(target.desc);
  }, [target?.id]);
  useEffect(() => { if (free) setVis('public'); }, [free]);

  // the frame a still mobject shows (or the project's thumbnail frame for an animated one)
  useEffect(() => {
    if (!project) return;
    const t = mode === 'still' ? at : thumbTime(project);
    const id = setTimeout(() => {
      renderFrame(project, t, 384, 216).then((r) => r.png && setPreview(r.png)).catch(() => {});
    }, 120);
    return () => clearTimeout(id);
  }, [project, mode, at]);

  const dur = project?.settings.duration ?? entry.duration ?? 0;
  const empty = !!project && !project.clips.length;

  const create = async () => {
    if (!project || busy || empty) return;
    setBusy(true);
    setErr(null);
    try {
      const item = await makeMobject({
        project, name: name.trim() || entry.name, desc, visibility: free ? 'public' : vis, mode, at, thumb_t: thumbTime(project),
        replace: replace && target ? target.id : null, source_path: entry.path,
      });
      await reloadLibrary();
      const st = useStore.getState();
      st.toast(
        `“${item.name}” ${replace && target ? 'updated' : 'added'} under My mobjects${item.visibility === 'public' ? ' · public' : ' · private'}`,
        'info',
        { label: 'Add to scene', run: () => { useStore.setState({ projectsOpen: false }); addItem(item.id); } },
      );
      for (const w of item.warnings || []) st.toast(w, 'error');
      onClose();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mm-backdrop" onMouseDown={() => !busy && onClose()} />
      <div className="mm-dialog" data-testid="mobject-dialog" role="dialog" aria-label="Make into mobject"
        onKeyDown={(e) => { if (e.key === 'Enter' && !(e.target as HTMLElement).matches('textarea')) { e.preventDefault(); create(); } }}>
        <div className="mm-head">
          <Package size={15} />
          <span>Make into mobject</span>
          <div className="spacer" />
          <button className="icon-btn" title="Close (Esc)" onClick={onClose} disabled={busy}><X size={15} /></button>
        </div>
        <div className="mm-body">
          <div className="mm-left">
            <div className="mm-preview" style={{ background: project?.settings.background || entry.background || '#1e1e1e' }}>
              {preview ? <img src={preview} alt="" /> : <span className="proj-thumb-fallback">∑</span>}
              <span className="mm-preview-tag">{mode === 'still' ? `Frame at ${fmt(at)}` : `Plays ${fmt(dur)}`}</span>
            </div>
            <div className="mm-from muted">From <b>{entry.title || entry.name}</b> · {project ? `${project.clips.length} clip${project.clips.length === 1 ? '' : 's'}` : '…'} · {fmt(dur)}</div>
          </div>
          <div className="mm-form">
            <label className="mm-field">
              <span>Name</span>
              <input ref={nameRef} data-testid="mobject-name" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
            </label>
            <label className="mm-field">
              <span>Description <i className="muted">optional</i></span>
              <input data-testid="mobject-desc" value={desc} placeholder="What it shows — helps search find it" onChange={(e) => setDesc(e.target.value)} />
            </label>

            <div className="mm-field">
              <span>Content</span>
              <div className="mm-choices">
                <button className={`mm-choice ${mode === 'animated' ? 'on' : ''}`} data-testid="mobject-animated" onClick={() => setMode('animated')}>
                  <Clapperboard size={15} />
                  <div><b>Animated</b><small>Replays the whole {fmt(dur)} timeline; speed and loop are adjustable per use</small></div>
                </button>
                <button className={`mm-choice ${mode === 'still' ? 'on' : ''}`} data-testid="mobject-still" onClick={() => setMode('still')}>
                  <ImageIcon size={15} />
                  <div><b>Still</b><small>One frame of the project, as a static mobject</small></div>
                </button>
              </div>
              {mode === 'still' && (
                <div className="mm-at">
                  <input type="range" min={0} max={Math.max(0, dur - 0.01)} step={0.01} value={at} data-testid="mobject-at" onChange={(e) => setAt(+e.target.value)} />
                  <span className="mono">{fmt(at)}</span>
                </div>
              )}
            </div>

            <div className="mm-field">
              <span>Visibility</span>
              <div className="mm-choices">
                <button className={`mm-choice ${vis === 'public' ? 'on' : ''}`} data-testid="mobject-public" onClick={() => setVis('public')}>
                  <Globe size={15} />
                  <div><b>Public</b><small>Listed with your name{acct?.name ? ` (${acct.name})` : ''}; anyone can find and reuse it</small></div>
                </button>
                <button
                  className={`mm-choice ${vis === 'private' ? 'on' : ''} ${free ? 'locked' : ''}`}
                  data-testid="mobject-private"
                  disabled={free}
                  title={free ? 'Private mobjects are a Pro feature' : undefined}
                  onClick={() => !free && setVis('private')}
                >
                  <Lock size={15} />
                  <div><b>Private {free && <span className="pro-chip">PRO</span>}</b><small>Only you can see and use it</small></div>
                </button>
              </div>
              {free && <div className="mm-note" data-testid="mobject-free-note">On the Free plan, every mobject you make is public. Upgrade to Pro to keep mobjects private.</div>}
            </div>

            {target && (
              <label className="mm-check">
                <input type="checkbox" checked={replace} data-testid="mobject-replace" onChange={(e) => setReplace(e.target.checked)} />
                <span>Replace “{target.name}”, made from this project {target.updated ? new Date(target.updated).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'earlier'} (scenes using it update too)</span>
              </label>
            )}
            {loadErr && <div className="mm-err">{loadErr}</div>}
            {empty && <div className="mm-err">This project is empty: add something to it first.</div>}
            {err && <div className="mm-err" data-testid="mobject-error">{err}</div>}
          </div>
        </div>
        <div className="mm-foot">
          <div className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" data-testid="mobject-create" disabled={!project || busy || empty || !name.trim()} onClick={create}>
            {busy ? <><LoaderCircle size={13} className="spin" /> Building…</> : replace && target ? 'Update mobject' : 'Create mobject'}
          </button>
        </div>
      </div>
    </>
  );
}
