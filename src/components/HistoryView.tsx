import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Copy, History, MoreHorizontal, Pencil, RotateCcw, Search, X } from 'lucide-react';
import { useStore } from '../store';
import type { ProjectEntry, ProjectVersion } from '../types';
import { HISTORY_EVENT, drawVersionPreview, openVersionCopy, restoreVersion } from '../history';
import { flushSave } from '../autosave';
import { sessionForPath } from '../sessions';
import ContextMenu, { type MenuItem } from './ContextMenu';

function ago(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDur = (d: number) => (d >= 60 ? `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}` : `${+d.toFixed(1)}s`);

/**
 * The versions of one project (saved with ⌘S), newest first, like `git log` with pictures:
 * each one plays its GIF on hover and can be restored (undoable) or opened as a copy.
 */
export default function HistoryView({ entry, onBack, onClose }: { entry: ProjectEntry; onBack: () => void; onClose: () => void }) {
  const [data, setData] = useState<{ hid: string | null; commits: ProjectVersion[]; changedSinceLast?: boolean } | null>(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [gifs, setGifs] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; v: ProjectVersion } | null>(null);
  const [labeling, setLabeling] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const reload = useCallback(async () => {
    const r = await window.studio.history.list(entry.path);
    if (!alive.current) return;
    if (r.error) useStore.getState().toast(r.error, 'error');
    setData({ hid: r.hid, commits: r.commits || [], changedSinceLast: r.changedSinceLast });
  }, [entry.path]);

  useEffect(() => {
    alive.current = true;
    (async () => {
      // an open project may have a save pending: list against what is really on disk
      const sid = sessionForPath(entry.path);
      if (sid) await flushSave(false, sid);
      reload();
    })();
    setTimeout(() => searchRef.current?.focus(), 0);
    return () => { alive.current = false; };
  }, [entry.path, reload]);

  // new version / preview drawn (also from ⌘S while this is open)
  useEffect(() => {
    const on = (e: Event) => {
      const hid = (e as CustomEvent).detail?.hid;
      if (!hid || !data?.hid || hid === data.hid) reload();
    };
    window.addEventListener(HISTORY_EVENT, on);
    return () => window.removeEventListener(HISTORY_EVENT, on);
  }, [reload, data?.hid]);

  // versions saved while the engine was busy / the app closed have no preview yet: draw them now
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!data?.hid) return;
    const missing = data.commits.filter((c) => !c.poster && !asked.current.has(c.id));
    for (const c of missing) {
      asked.current.add(c.id);
      drawVersionPreview(data.hid, c.id);
    }
  }, [data]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = data?.commits || [];
    return needle ? all.filter((c) => `v${c.version} ${c.label || ''} ${c.message}`.toLowerCase().includes(needle)) : all;
  }, [data, q]);
  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, shown.length - 1))); }, [shown.length]);

  const loadGif = useCallback(async (v: ProjectVersion) => {
    if (!data?.hid || !v.hasGif || gifs[v.id]) return;
    const g = await window.studio.history.gif(data.hid, v.id);
    if (g && alive.current) setGifs((m) => ({ ...m, [v.id]: g }));
  }, [data?.hid, gifs]);
  useEffect(() => { if (shown[active]) loadGif(shown[active]); }, [active, shown, loadGif]);

  const doRestore = async (v: ProjectVersion) => {
    if (busy || !data?.hid || v.current) return;
    setBusy(true);
    const ok = await restoreVersion(entry.path, data.hid, v);
    setBusy(false);
    if (ok) onClose();
  };
  const doCopy = async (v: ProjectVersion) => {
    if (busy || !data?.hid) return;
    setBusy(true);
    const ok = await openVersionCopy(entry.path, data.hid, v);
    setBusy(false);
    if (ok) onClose();
  };
  const saveLabel = async (v: ProjectVersion, label: string) => {
    setLabeling(null);
    if (!data?.hid || label.trim() === (v.label || '')) return;
    const r = await window.studio.history.label(data.hid, v.id, label);
    if (r.error) useStore.getState().toast(r.error, 'error');
    reload();
  };

  const menuFor = (v: ProjectVersion): MenuItem[] => [
    { label: v.current ? 'This is the current version' : `Restore v${v.version}`, icon: <RotateCcw size={13} />, disabled: !!v.current || busy, action: () => doRestore(v) },
    { label: 'Open as a copy', icon: <Copy size={13} />, disabled: busy, action: () => doCopy(v) },
    { sep: true },
    { label: v.label ? 'Rename version…' : 'Name this version…', icon: <Pencil size={13} />, action: () => setLabeling(v.id) },
  ];

  // keyboard: ↑↓ move, Enter restores, Esc goes back to the projects (closes a menu / rename first)
  const cancelLabel = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (menu) return setMenu(null);
        if (labeling) { cancelLabel.current = true; return setLabeling(null); }
        return onBack();
      }
      if (menu || labeling) return;
      const move = (d: number) => { e.preventDefault(); setActive((a) => Math.max(0, Math.min(shown.length - 1, a + d))); };
      if (e.key === 'ArrowDown') move(1);
      else if (e.key === 'ArrowUp') move(-1);
      else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); doRestore(shown[active]); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const n = data?.commits.length ?? 0;
  const latest = data?.commits[0];

  return (
    <>
      <div className="code-head proj-head">
        <button className="icon-btn lib-close" data-testid="projects-close" title="Close (Esc)" onClick={onClose}><X size={16} /></button>
        <button className="btn small ghost" data-testid="history-back" onClick={onBack}><ArrowLeft size={13} /> Projects</button>
        <span className="hist-title">History <span className="muted">— {entry.name} · {n} version{n === 1 ? '' : 's'}</span></span>
        <div className="spacer" />
      </div>
      <div className="proj-toolbar">
        <div className="search-box">
          <Search size={13} className="search-ico" />
          <input ref={searchRef} data-testid="history-search" placeholder="Search versions…" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
        </div>
        {data && n > 0 && (
          <span className={`muted small hist-state ${data.changedSinceLast ? 'warn' : ''}`} data-testid="history-state">
            {data.changedSinceLast ? `Changed since v${latest?.version} — press ⌘S to save a version` : `Up to date with v${latest?.version}`}
          </span>
        )}
      </div>
      <div className="proj-scroll">
        {data === null ? (
          <div className="proj-empty muted">Loading…</div>
        ) : !n ? (
          <div className="proj-empty" data-testid="history-empty">
            <History size={28} className="hist-empty-ico" />
            <div className="muted">No versions yet.</div>
            <div className="muted small">Projects save themselves as you work. Press ⌘S to keep a version of “{entry.name}” — with a little preview — that you can come back to.</div>
          </div>
        ) : !shown.length ? (
          <div className="proj-empty"><span className="muted">No versions match “{q}”.</span></div>
        ) : (
          <div className="hist-list" ref={listRef} data-testid="history-list">
            {shown.map((v, i) => (
              <div
                key={v.id}
                data-idx={i}
                data-testid="history-row"
                data-version={v.version}
                data-current={v.current ? '1' : undefined}
                className={`hist-row ${active === i ? 'kb' : ''} ${v.current ? 'current' : ''}`}
                onMouseEnter={() => { setActive(i); loadGif(v); }}
                onDoubleClick={() => doRestore(v)}
                onContextMenu={(ev) => { ev.preventDefault(); setMenu({ x: ev.clientX, y: ev.clientY, v }); }}
              >
                <div className="hist-rail"><span className="hist-dot" /></div>
                <div className="hist-thumb" style={{ background: v.background || '#1e1e1e' }}>
                  {v.clips === 0 ? (
                    <span className="proj-thumb-fallback small">Empty</span>
                  ) : active === i && gifs[v.id] ? (
                    <img src={gifs[v.id]} alt="" draggable={false} data-testid="history-gif" />
                  ) : v.poster ? (
                    <img src={v.poster} alt="" draggable={false} data-testid="history-poster" />
                  ) : (
                    <span className="hist-drawing muted small" data-testid="history-drawing">drawing preview…</span>
                  )}
                </div>
                <div className="hist-info">
                  <div className="hist-top">
                    <span className="hist-ver">v{v.version}</span>
                    {v.current && <span className="hist-badge cur" title="The project file is exactly this version">Current</span>}
                    {i === 0 && !q && !v.current && <span className="hist-badge">Latest</span>}
                    {v.stats && (
                      <span className="hist-stat" title={`${v.stats.added} added · ${v.stats.edited} edited · ${v.stats.removed} removed`}>
                        {v.stats.added > 0 && <b className="add">+{v.stats.added}</b>}
                        {v.stats.edited > 0 && <b className="edit">~{v.stats.edited}</b>}
                        {v.stats.removed > 0 && <b className="rem">−{v.stats.removed}</b>}
                      </span>
                    )}
                  </div>
                  {labeling === v.id ? (
                    <input
                      className="proj-rename hist-label-input"
                      data-testid="history-label-input"
                      defaultValue={v.label || ''}
                      placeholder={v.message}
                      autoFocus
                      onFocus={(ev) => { cancelLabel.current = false; ev.currentTarget.select(); }}
                      onClick={(ev) => ev.stopPropagation()}
                      onDoubleClick={(ev) => ev.stopPropagation()}
                      onBlur={(ev) => { if (cancelLabel.current) { cancelLabel.current = false; return; } saveLabel(v, ev.currentTarget.value); }}
                      onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); ev.currentTarget.blur(); } }}
                    />
                  ) : (
                    <div className="hist-msg" data-testid="history-message" title="Double-click to name this version" onDoubleClick={(ev) => { ev.stopPropagation(); setLabeling(v.id); }}>
                      {v.label ? <><span className="hist-label">{v.label}</span><span className="hist-auto">{v.message}</span></> : v.message}
                    </div>
                  )}
                  <div className="proj-meta" title={new Date(v.time).toLocaleString()}>
                    {ago(v.time)} · {when(v.time)} · {v.clips} clip{v.clips === 1 ? '' : 's'} · {fmtDur(v.duration)}
                  </div>
                </div>
                <div className="hist-actions">
                  <button className="btn small primary" data-testid="history-restore" disabled={busy || !!v.current} title={v.current ? 'The project is already at this version' : 'Bring the project back to this version (⌘Z undoes it)'} onClick={(ev) => { ev.stopPropagation(); doRestore(v); }}>
                    <RotateCcw size={13} /> Restore
                  </button>
                  <button className="btn small" data-testid="history-copy" disabled={busy} title="Open this version as a new project" onClick={(ev) => { ev.stopPropagation(); doCopy(v); }}>
                    <Copy size={13} /> Copy
                  </button>
                  <button
                    className="icon-btn"
                    data-testid="history-more"
                    title="More…"
                    onClick={(ev) => { ev.stopPropagation(); const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, v }); }}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="proj-foot muted">↑↓ to move · hover to play · Enter or double-click to restore · double-click a message to name it · Esc back to projects</div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuFor(menu.v)} onClose={closeMenu} />}
    </>
  );
}
