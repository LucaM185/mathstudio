import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Copy, FilePlus2, FolderOpen, FolderSearch, Heart, History, MoreHorizontal, Package, Pencil, RotateCcw, Search, Trash2, X, XCircle } from 'lucide-react';
import { useStore } from '../store';
import type { ProjectEntry, TrashedProject } from '../types';
import { newProjectFromBrowser, openProject, refreshProjectThumb, switchToProject, thumbTime, tildify } from '../actions';
import { flushSave } from '../autosave';
import { renderFrame } from '../engine';
import { normalizeProject } from '../ops';
import ContextMenu, { type MenuItem } from './ContextMenu';
import { closeSession, entryPath, removeFromStrip, renamedFile, sessionForPath } from '../sessions';
import { useAgents } from '../agent/agent';
import MakeMobjectDialog from './MakeMobjectDialog';
import HistoryView from './HistoryView';

type Sort = 'recent' | 'modified' | 'name';

const CURRENT = '__current__';

function ago(ms?: number) {
  if (!ms) return '';
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function left(expires: number) {
  const d = Math.ceil((expires - Date.now()) / 86400e3);
  return d <= 1 ? 'goes to the macOS Trash today' : `${d} days left`;
}

const fmtDur = (d?: number) => (d == null ? '' : d >= 60 ? `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}` : `${+d.toFixed(1)}s`);

// Projects popup: the same modal look as the Code popup, listing recent projects and every
// project in the projects folder. Click a card to switch to it.
export default function ProjectsPanel() {
  const filePath = useStore((s) => s.filePath);
  const curName = useStore((s) => s.project.settings.name);
  const curClips = useStore((s) => s.project.clips.length);
  const curDur = useStore((s) => s.project.settings.duration);
  const [list, setList] = useState<ProjectEntry[] | null>(null);
  // projects an agent is working on right now (they may be open in the background)
  const runningSids = useAgents((s) => Object.entries(s.chats).filter(([, c]) => c.running).map(([k]) => k).join(','));
  const busyPaths = useMemo(() => new Set(runningSids.split(',').filter(Boolean).map(entryPath).filter(Boolean) as string[]), [runningSids, filePath, list]);
  const [dir, setDir] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem('ms.projects.sort') as Sort) || 'recent');
  const [active, setActive] = useState(0);
  const [view, setView] = useState<'projects' | 'trash'>('projects');
  const [trash, setTrash] = useState<{ days: number; items: TrashedProject[] } | null>(null);
  const [likedOnly, setLikedOnly] = useState(() => { try { return localStorage.getItem('ms.projects.liked') === '1'; } catch (e) { return false; } });
  const [menu, setMenu] = useState<{ x: number; y: number; entry: ProjectEntry | TrashedProject } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [making, setMaking] = useState<ProjectEntry | null>(null);
  // ⋯ → See history: the versions saved with ⌘S
  const [historyOf, setHistoryOf] = useState<ProjectEntry | null>(null);
  const library = useStore((s) => s.library);
  const hasMobject = useCallback((p: string) => !!library?.items.some((it) => it.user && it.source_path === p), [library]);
  const [busy, setBusy] = useState(false);
  const [curThumb, setCurThumb] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const close = () => useStore.setState({ projectsOpen: false });
  const closeMenu = useCallback(() => setMenu(null), []);

  const toggleLike = useCallback(async (e: ProjectEntry) => {
    if (!e.exists) return;
    const on = !e.favorite;
    setList((l) => l && l.map((x) => (x.path === e.path ? { ...x, favorite: on } : x)));
    await window.studio.projects.favorite(e.path, on);
  }, []);

  const reloadTrash = useCallback(async () => {
    const t = await window.studio.projects.trashList();
    if (alive.current) setTrash(t);
  }, []);

  const reload = useCallback(async () => {
    const r = await window.studio.projects.list();
    if (!alive.current) return;
    setDir(r.dir);
    setList(r.projects);
    reloadTrash();
  }, [reloadTrash]);

  // Deleting is always undoable: the file moves to the MathStudio Trash (restorable for a month).
  const moveToTrash = async (e: ProjectEntry) => {
    const openSid = sessionForPath(e.path);
    if (openSid) await flushSave(false, openSid);
    const r = await window.studio.projects.trash(e.path);
    if (r.error) useStore.getState().toast(r.error, 'error');
    else {
      if (openSid) closeSession(openSid);
      removeFromStrip(e.path);
      useStore.getState().toast(`Moved ${e.name} to the Trash`, 'info', {
        label: 'Undo',
        run: async () => {
          const u = await window.studio.projects.restore(r.id!);
          if (u.error) useStore.getState().toast(u.error, 'error');
          if (alive.current) reload();
        },
      });
    }
    reload();
  };

  const restore = async (t: TrashedProject) => {
    const r = await window.studio.projects.restore(t.id);
    if (r.error) return useStore.getState().toast(r.error, 'error');
    const moved = r.path !== t.original;
    useStore.getState().toast(moved ? `Restored as ${tildify(r.path!)}` : `Restored ${t.name}`, 'success');
    reload();
  };

  const purge = async (t?: TrashedProject) => {
    const n = trash?.items.length ?? 0;
    const ok = await window.studio.confirm(
      t ? `Delete “${t.name}” now?` : `Empty the Trash (${n} project${n === 1 ? '' : 's'})?`,
      'It will be moved to the macOS Trash, where you can still recover it from Finder until you empty that too.',
      [t ? 'Delete now' : 'Empty Trash', 'Cancel'],
    );
    if (ok !== 0) return;
    const r = await window.studio.projects.purge(t?.id);
    if (r.error) useStore.getState().toast(r.error, 'error');
    reloadTrash();
  };

  useEffect(() => {
    alive.current = true;
    reload();
    setTimeout(() => searchRef.current?.focus(), 0);
    return () => { alive.current = false; };
  }, [reload]);

  // the open project got its first file (or was renamed) by autosave → show it as a file
  const firstPath = useRef(filePath);
  useEffect(() => { if (filePath !== firstPath.current) { firstPath.current = filePath; reload(); } }, [filePath, reload]);

  // Thumbnails: render missing ones one at a time while the popup is open.
  const pendingThumbs = useRef(new Set<string>());
  useEffect(() => {
    if (!list) return;
    const todo = list.filter((p) => p.exists && !p.error && (!p.thumb || p.thumbStale) && p.clips && !pendingThumbs.current.has(p.path));
    if (!todo.length) return;
    (async () => {
      for (const p of todo) {
        if (!alive.current) return;
        pendingThumbs.current.add(p.path);
        // the open project is drawn from memory (its file may be a moment behind)
        const s = useStore.getState();
        const data = s.filePath === p.path ? s.project : (await window.studio.projects.peek(p.path)).data;
        if (!data || !alive.current) continue;
        const png = await refreshProjectThumb(p.path, s.filePath === p.path ? data : normalizeProject(data));
        if (png && alive.current) setList((l) => l && l.map((x) => (x.path === p.path ? { ...x, thumb: png } : x)));
      }
    })();
  }, [list]);

  // A current project that has no file yet gets a live thumbnail of its own.
  useEffect(() => {
    if (filePath) return;
    const s = useStore.getState();
    if (!s.project.clips.length) return;
    renderFrame(s.project, thumbTime(s.project), 384, 216).then((r) => alive.current && setCurThumb(r.png || null)).catch(() => {});
  }, [filePath]);

  const entries = useMemo(() => {
    if (!list) return [];
    const needle = q.trim().toLowerCase();
    let out = list.filter((p) => (!likedOnly || p.favorite) && (!needle || `${p.title || ''} ${p.name} ${p.path}`.toLowerCase().includes(needle)));
    if (sort === 'name') out = [...out].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    else if (sort === 'modified') out = [...out].sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
    // recent: opened in MathStudio (newest first), then the rest of the projects folder by date
    else out = [...out].sort((a, b) => (b.opened || 0) - (a.opened || 0) || (b.mtime ?? 0) - (a.mtime ?? 0));
    // liked projects next (stable: keeps the chosen order inside each group); the open one first
    out = [...out.filter((p) => p.favorite), ...out.filter((p) => !p.favorite)];
    const cur = out.findIndex((p) => p.path === filePath);
    if (cur > 0) out = [out[cur], ...out.slice(0, cur), ...out.slice(cur + 1)];
    return out;
  }, [list, q, sort, filePath, likedOnly]);

  const trashCards = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (trash?.items || []).filter((t) => !needle || `${t.title || ''} ${t.name} ${t.original}`.toLowerCase().includes(needle));
  }, [trash, q]);
  const inTrash = view === 'trash';

  const showUnsaved = !filePath && !likedOnly && (!q.trim() || curName.toLowerCase().includes(q.trim().toLowerCase()));
  const cards: (ProjectEntry | typeof CURRENT)[] = inTrash ? trashCards : showUnsaved ? [CURRENT, ...entries] : entries;

  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, cards.length - 1))); }, [cards.length]);
  useEffect(() => { setActive(0); }, [q, sort, likedOnly, view]);
  const likedCount = list?.filter((p) => p.favorite).length ?? 0;

  const openEntry = async (e: ProjectEntry | typeof CURRENT) => {
    if (busy) return;
    if (e === CURRENT || e.path === filePath) return close();
    if (!e.exists) return useStore.getState().toast('That project file no longer exists', 'error');
    setBusy(true);
    const ok = await switchToProject(e.path);
    setBusy(false);
    if (ok) close();
  };

  const act = async (fn: () => Promise<boolean | void>) => {
    if (busy) return;
    setBusy(true);
    const ok = await fn();
    setBusy(false);
    if (ok) close();
  };

  const doRename = async (e: ProjectEntry, name: string) => {
    setRenaming(null);
    name = name.trim();
    if (!name || name === e.name) return;
    const openSid = sessionForPath(e.path);
    if (openSid) await flushSave(false, openSid);
    const r = await window.studio.projects.rename(e.path, name);
    if (r.error) return useStore.getState().toast(r.error, 'error');
    // the open copy (on screen or in the background) follows its file
    if (r.path) renamedFile(e.path, r.path, name);
    reload();
  };

  const menuFor = (e: ProjectEntry): MenuItem[] => {
    const isCur = e.path === filePath;
    return [
      { label: isCur ? 'Already open' : 'Open', icon: <FolderOpen size={13} />, disabled: isCur || !e.exists, action: () => openEntry(e) },
      { label: e.favorite ? 'Unlike' : 'Like', icon: <Heart size={13} />, disabled: !e.exists, action: () => toggleLike(e) },
      { label: e.versions ? `See history · ${e.versions}` : 'See history', icon: <History size={13} />, shortcut: 'H', disabled: !e.exists || !!e.error, action: () => setHistoryOf(e) },
      { label: 'Rename…', icon: <Pencil size={13} />, disabled: !e.exists, action: () => setRenaming(e.path) },
      {
        label: 'Duplicate', icon: <Copy size={13} />, disabled: !e.exists, action: async () => {
          const r = await window.studio.projects.duplicate(e.path);
          if (r.error) useStore.getState().toast(r.error, 'error');
          else { useStore.getState().toast(`Duplicated as ${r.path!.split('/').pop()}`); reload(); }
        },
      },
      {
        label: hasMobject(e.path) ? 'Update mobject…' : 'Make into mobject…', icon: <Package size={13} />,
        disabled: !e.exists || !!e.error || e.clips === 0, action: () => setMaking(e),
      },
      { label: 'Reveal in Finder', icon: <FolderSearch size={13} />, disabled: !e.exists, action: () => window.studio.reveal(e.path) },
      { sep: true },
      {
        label: 'Remove from Recents', icon: <XCircle size={13} />, disabled: e.inFolder && e.exists, action: async () => {
          await window.studio.projects.forget(e.path);
          reload();
        },
      },
      {
        label: busyPaths.has(e.path) ? 'Move to Trash (agent working)' : 'Move to Trash', icon: <Trash2 size={13} />, danger: true, shortcut: '⌘⌫',
        disabled: isCur || !e.exists || busyPaths.has(e.path), action: () => moveToTrash(e),
      },
    ];
  };

  const trashMenuFor = (t: TrashedProject): MenuItem[] => [
    { label: 'Restore', icon: <RotateCcw size={13} />, action: () => restore(t) },
    { sep: true },
    { label: 'Delete now…', icon: <Trash2 size={13} />, danger: true, action: () => purge(t) },
  ];

  // keyboard: arrows move, Enter opens, Esc closes (or closes the menu / cancels a rename first)
  const cancelRename = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (historyOf) return; // the history view has the keyboard
      if (making) {
        // the dialog has the keyboard (its own Enter); Escape closes just the dialog
        if (e.key === 'Escape') { e.stopPropagation(); setMaking(null); }
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (menu) return setMenu(null);
        if (renaming) { cancelRename.current = true; return setRenaming(null); }
        if (inTrash) return setView('projects');
        return close();
      }
      if (menu || renaming) return;
      const cols = (() => {
        const g = gridRef.current;
        if (!g) return 1;
        return getComputedStyle(g).gridTemplateColumns.split(' ').length || 1;
      })();
      const move = (d: number) => { e.preventDefault(); setActive((a) => Math.max(0, Math.min(cards.length - 1, a + d))); };
      const inSearch = document.activeElement === searchRef.current;
      if (e.key === 'ArrowRight' && !inSearch) move(1);
      else if (e.key === 'ArrowLeft' && !inSearch) move(-1);
      else if (e.key === 'ArrowDown') move(cols);
      else if (e.key === 'ArrowUp') move(-cols);
      else if (e.key === 'Enter' && cards[active]) { e.preventDefault(); if (inTrash) restore(cards[active] as TrashedProject); else openEntry(cards[active]); }
      else if (e.key === 'Backspace' && e.metaKey && !inSearch && !inTrash && cards[active] && cards[active] !== CURRENT) {
        const c = cards[active] as ProjectEntry;
        e.preventDefault();
        if (c.path !== filePath && c.exists && !busyPaths.has(c.path)) moveToTrash(c);
      }
      else if ((e.key === 'h' || e.key === 'H') && !inSearch && !inTrash && !e.metaKey && !e.ctrlKey && !e.altKey && cards[active] && cards[active] !== CURRENT) {
        const c = cards[active] as ProjectEntry;
        e.preventDefault();
        if (c.exists && !c.error) setHistoryOf(c);
      }
      else if ((e.key === 'l' || e.key === 'L') && !inSearch && !inTrash && !e.metaKey && !e.ctrlKey && !e.altKey && cards[active] && cards[active] !== CURRENT) {
        e.preventDefault(); toggleLike(cards[active] as ProjectEntry);
      }
    };
    // React's own handlers (the rename field) run below the document; the editor's window-level
    // shortcuts (Space, arrows, Delete…) must not fire behind the popup, so stop keys at the document.
    const block = (e: KeyboardEvent) => e.stopPropagation();
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('keydown', block);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keydown', block);
    };
  });

  // a click on a card's name waits a moment so a double-click can rename instead of opening
  const clickTimer = useRef<any>(null);
  useEffect(() => () => clearTimeout(clickTimer.current), []);
  const onCardClick = (ev: React.MouseEvent, e: ProjectEntry) => {
    if (renaming === e.path) return;
    clearTimeout(clickTimer.current);
    if ((ev.target as HTMLElement).closest('.proj-name') && e.exists) clickTimer.current = setTimeout(() => openEntry(e), 260);
    else openEntry(e);
  };

  useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const total = (list?.length ?? 0) + (filePath ? 0 : 1);

  return (
    <>
      <div className="library-backdrop" data-testid="projects-backdrop" onMouseDown={close} />
      <div className="code-panel full projects-panel" data-testid="projects-popup">
        {historyOf ? (
          <HistoryView entry={historyOf} onBack={() => { setHistoryOf(null); reload(); }} onClose={close} />
        ) : (
        <>
        <div className="code-head proj-head">
          <button className="icon-btn lib-close" data-testid="projects-close" title="Close (Esc)" onClick={close}><X size={16} /></button>
          {inTrash ? (
            <>
              <button className="btn small ghost" data-testid="trash-back" onClick={() => setView('projects')}><ArrowLeft size={13} /> Projects</button>
              <span>Trash <span className="muted">— {trash?.items.length ?? 0} project{trash?.items.length === 1 ? '' : 's'}</span></span>
              <div className="spacer" />
              <button className="btn small danger" data-testid="trash-empty" disabled={!trash?.items.length} onClick={() => purge()}><Trash2 size={13} /> Empty Trash…</button>
            </>
          ) : (
          <>
          <span>Projects <span className="muted">— {total} project{total === 1 ? '' : 's'}</span></span>
          <div className="spacer" />
          <button className="btn small primary" data-testid="projects-new" disabled={busy} onClick={() => act(newProjectFromBrowser)}><FilePlus2 size={13} /> New project</button>
          <button className="btn small" data-testid="projects-open-file" disabled={busy} onClick={() => act(async () => { const before = useStore.getState().filePath; await openProject(); return useStore.getState().filePath !== before; })}><FolderOpen size={13} /> Open file…</button>
          </>
          )}
        </div>
        <div className="proj-toolbar">
          <div className="search-box">
            <Search size={13} className="search-ico" />
            <input ref={searchRef} data-testid="projects-search" placeholder={inTrash ? 'Search the Trash…' : 'Search projects…'} value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
          </div>
          {inTrash ? (
            <span className="muted small trash-note" data-testid="trash-note">Deleted projects stay here for {trash?.days ?? 30} days, then move to the macOS Trash. Nothing is erased.</span>
          ) : (
          <>
          <div className="seg" role="tablist">
            {(['recent', 'modified', 'name'] as Sort[]).map((s) => (
              <button key={s} className={sort === s ? 'on' : ''} onClick={() => { setSort(s); try { localStorage.setItem('ms.projects.sort', s); } catch (e) { /* */ } }}>
                {s === 'recent' ? 'Recent' : s === 'modified' ? 'Modified' : 'Name'}
              </button>
            ))}
          </div>
          <button
            className={`btn small proj-liked-filter ${likedOnly ? 'on' : ''}`}
            data-testid="projects-liked-filter"
            title={likedOnly ? 'Show all projects' : 'Show only liked projects'}
            onClick={() => { const v = !likedOnly; setLikedOnly(v); try { localStorage.setItem('ms.projects.liked', v ? '1' : '0'); } catch (err) { /* */ } }}
          >
            <Heart size={13} fill={likedOnly ? 'currentColor' : 'none'} /> Liked{likedCount ? ` · ${likedCount}` : ''}
          </button>
          </>
          )}
          <div className="spacer" />
          {!inTrash && (
            <button className="btn small ghost proj-trash-btn" data-testid="projects-trash" title="Recently deleted projects" onClick={() => setView('trash')}>
              <Trash2 size={13} /> Trash{trash?.items.length ? ` · ${trash.items.length}` : ''}
            </button>
          )}
          {dir && !inTrash && <button className="btn small ghost proj-dir" title="Show the projects folder in Finder" onClick={async () => window.studio.openPath(await window.studio.projects.dir())}><FolderSearch size={13} /> {tildify(dir)}</button>}
        </div>
        <div className="proj-scroll">
          {inTrash ? (
            trash === null ? <div className="proj-empty muted">Loading…</div> : !trashCards.length ? (
              <div className="proj-empty">
                {q ? <span className="muted">Nothing in the Trash matches “{q}”.</span> : (
                  <>
                    <div className="muted">The Trash is empty.</div>
                    <div className="muted small">Deleted projects wait here for {trash.days} days so you can restore them.</div>
                  </>
                )}
              </div>
            ) : (
              <div className="proj-grid" ref={gridRef} data-testid="trash-grid">
                {trashCards.map((t, i) => (
                  <div
                    key={t.id}
                    data-idx={i}
                    className={`proj-card trashed ${active === i ? 'kb' : ''}`}
                    data-testid="trash-card"
                    data-id={t.id}
                    data-original={t.original}
                    title={`Was at ${t.original}`}
                    onMouseEnter={() => setActive(i)}
                    onDoubleClick={() => restore(t)}
                    onContextMenu={(ev) => { ev.preventDefault(); setMenu({ x: ev.clientX, y: ev.clientY, entry: t }); }}
                  >
                    <div className="proj-thumb" style={{ background: t.background || '#1e1e1e' }}>
                      {t.clips === 0 ? <span className="proj-thumb-fallback small">Empty</span> : t.thumb ? <img src={t.thumb} alt="" draggable={false} /> : <span className="proj-thumb-fallback">∑</span>}
                      <div className="trash-actions">
                        <button className="btn small primary" data-testid="trash-restore" onClick={(ev) => { ev.stopPropagation(); restore(t); }}><RotateCcw size={13} /> Restore</button>
                        <button className="btn small" data-testid="trash-delete" title="Move to the macOS Trash now" onClick={(ev) => { ev.stopPropagation(); purge(t); }}><Trash2 size={13} /></button>
                      </div>
                    </div>
                    <div className="proj-info">
                      <div className="proj-name">{t.favorite && <Heart size={11} className="trash-liked" fill="currentColor" />}{t.name}</div>
                      <div className="proj-meta">Deleted {ago(t.deletedAt)} · <span className={t.expires - Date.now() < 3 * 86400e3 ? 'warn' : ''}>{left(t.expires)}</span></div>
                      <div className="proj-path">{tildify(t.original.split('/').slice(0, -1).join('/'))}</div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : list === null ? (
            <div className="proj-empty muted">Loading…</div>
          ) : !cards.length ? (
            <div className="proj-empty">
              {likedOnly && !q ? (
                <>
                  <div className="muted">No liked projects yet.</div>
                  <div className="muted small">Click the ♥ on a project (or press L) to like it.</div>
                </>
              ) : q ? <span className="muted">No {likedOnly ? 'liked ' : ''}projects match “{q}”.</span> : (
                <>
                  <div className="muted">No projects yet.</div>
                  <div className="muted small">Projects save automatically to {tildify(dir)}.</div>
                </>
              )}
            </div>
          ) : (
            <div className="proj-grid" ref={gridRef} data-testid="projects-grid">
              {cards.map((e, i) => {
                if (e === CURRENT) {
                  return (
                    <div key={CURRENT} data-idx={i} className={`proj-card current ${active === i ? 'kb' : ''}`} data-testid="project-card" data-current="1" onClick={close} onMouseEnter={() => setActive(i)}>
                      <div className="proj-thumb" style={{ background: useStore.getState().project.settings.background }}>
                        {curThumb ? <img src={curThumb} alt="" /> : <span className="proj-thumb-fallback">∑</span>}
                        <span className="proj-badge open">Open</span>
                      </div>
                      <div className="proj-info">
                        <div className="proj-name">{curName}</div>
                        <div className="proj-meta">{curClips} clip{curClips === 1 ? '' : 's'} · {fmtDur(curDur)} · {curClips ? 'saving…' : 'new'}</div>
                      </div>
                    </div>
                  );
                }
                const isCur = e.path === filePath;
                return (
                  <div
                    key={e.path}
                    data-idx={i}
                    className={`proj-card ${isCur ? 'current' : ''} ${!e.exists || e.error ? 'missing' : ''} ${active === i ? 'kb' : ''} ${e.favorite ? 'liked' : ''}`}
                    data-testid="project-card"
                    data-path={e.path}
                    data-current={isCur ? '1' : undefined}
                    data-liked={e.favorite ? '1' : undefined}
                    title={e.path}
                    onClick={(ev) => onCardClick(ev, e)}
                    onMouseEnter={() => setActive(i)}
                    onContextMenu={(ev) => { ev.preventDefault(); setMenu({ x: ev.clientX, y: ev.clientY, entry: e }); }}
                  >
                    <div className="proj-thumb" style={{ background: e.background || '#1e1e1e' }}>
                      {e.clips === 0 ? <span className="proj-thumb-fallback small">Empty</span> : e.thumb ? <img src={e.thumb} alt="" draggable={false} /> : <span className="proj-thumb-fallback">{e.exists ? '∑' : '?'}</span>}
                      {isCur && <span className="proj-badge open">Open</span>}
                      {busyPaths.has(e.path) && <span className="proj-badge ai" data-testid="project-ai-badge">AI working</span>}
                      {!e.exists && <span className="proj-badge bad">Missing</span>}
                      {e.error && <span className="proj-badge bad">Unreadable</span>}
                      {hasMobject(e.path) && <span className="proj-badge mobj" data-testid="project-mobject-badge" title="This project is also a mobject in your library (My mobjects)"><Package size={10} /> Mobject</span>}
                      <button
                        className="icon-btn proj-more"
                        title="More…"
                        data-testid="project-more"
                        onClick={(ev) => { ev.stopPropagation(); const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, entry: e }); }}
                      >
                        <MoreHorizontal size={15} />
                      </button>
                    </div>
                    <div className="proj-info">
                      {e.exists && (
                        <button
                          className={`icon-btn proj-like ${e.favorite ? 'on' : ''}`}
                          data-testid="project-like"
                          title={e.favorite ? 'Unlike (L)' : 'Like (L)'}
                          aria-pressed={!!e.favorite}
                          onClick={(ev) => { ev.stopPropagation(); toggleLike(e); }}
                          onDoubleClick={(ev) => ev.stopPropagation()}
                        >
                          <Heart size={15} fill={e.favorite ? 'currentColor' : 'none'} />
                        </button>
                      )}
                      {renaming === e.path ? (
                        <input
                          className="proj-rename"
                          data-testid="project-rename"
                          defaultValue={e.name}
                          autoFocus
                          onFocus={(ev) => { cancelRename.current = false; ev.currentTarget.select(); }}
                          onClick={(ev) => ev.stopPropagation()}
                          onBlur={(ev) => {
                            if (cancelRename.current) { cancelRename.current = false; return; }
                            doRename(e, ev.currentTarget.value);
                          }}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); (ev.currentTarget as HTMLInputElement).blur(); }
                          }}
                        />
                      ) : (
                        <div className="proj-name" title="Double-click to rename" onDoubleClick={(ev) => { if (e.exists) { ev.stopPropagation(); clearTimeout(clickTimer.current); setRenaming(e.path); } }}>{e.name}</div>
                      )}
                      <div className="proj-meta">
                        {e.exists && !e.error ? (
                          <>
                            {e.clips} clip{e.clips === 1 ? '' : 's'} · {fmtDur(e.duration)} · {ago(sort === 'recent' && e.opened ? e.opened : e.mtime)}
                            {!!e.versions && <span className="proj-vers" data-testid="project-versions" title={`${e.versions} saved version${e.versions === 1 ? '' : 's'} (⌘S) — H or ⋯ → See history`}> · <History size={10} /> v{e.versions}</span>}
                          </>
                        ) : (
                          <span className="warn">{e.error || 'File not found'}</span>
                        )}
                      </div>
                      <div className="proj-path">{tildify(e.path.split('/').slice(0, -1).join('/'))}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="proj-foot muted">{inTrash ? '↑↓←→ to move · Enter or double-click to restore · Esc back to projects' : '↑↓←→ to move · Enter to open · L to like · H for history · ⌘⌫ to delete · right-click for more · double-click a name to rename'}</div>
        </>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={'id' in menu.entry ? trashMenuFor(menu.entry as TrashedProject) : menuFor(menu.entry)} onClose={closeMenu} />}
      {making && <MakeMobjectDialog entry={making} onClose={() => setMaking(null)} />}
    </>
  );
}
