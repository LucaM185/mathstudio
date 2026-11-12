import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { deleteMobject, reloadLibrary, searchLibrary, thumbUrl, updateMobject, type SearchResponse } from '../engine';
import { addItem, switchToProject } from '../actions';
import { CATEGORY_COLORS } from '../ops';
import type { LibraryItem } from '../types';
import { CategoryIcon } from '../icons';
import { FolderOpen, Globe, LoaderCircle, Lock, Maximize2, Minimize2, Package, Plus, Search, Sparkles, Timer, Trash2, X } from 'lucide-react';
import ContextMenu, { type MenuItem } from './ContextMenu';
import { usePlan } from './MakeMobjectDialog';

export const DND_ITEM = 'application/x-ms-item';
export const DND_ASSET = 'application/x-ms-asset';

/** Instant client-side keyword filter: used while the engine answers, or if it can't. */
function localMatch(it: LibraryItem, q: string) {
  const hay = `${it.name} ${it.category} ${it.id.replace(/_/g, ' ')} ${(it.tags || []).join(' ')} ${it.desc || ''}`.toLowerCase();
  const words = hay.split(/[^a-z0-9]+/);
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w) || words.some((h) => h.startsWith(w)));
}

function useSemanticSearch(q: string) {
  const [res, setRes] = useState<(SearchResponse & { q: string }) | null>(null);
  const [status, setStatus] = useState('idle');
  const [failed, setFailed] = useState(false);
  const port = useStore((s) => s.port);

  // query the engine (debounced, latest wins)
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setRes(null);
      return;
    }
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await searchLibrary(query, ctl.signal);
        setRes({ ...r, q: query });
        setStatus(r.status);
        setFailed(false);
      } catch (e: any) {
        if (e?.name !== 'AbortError') setFailed(true);
      }
    }, 90);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [q, port]);

  // follow the model while it loads so the indicator (and results) upgrade by themselves
  useEffect(() => {
    if (status === 'ready' || status === 'unavailable') return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await searchLibrary('');
        if (!alive) return;
        setStatus(r.status);
      } catch {
        /* engine not up yet */
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [status, port]);

  return { res, status, failed };
}

/** Animated previews are fetched ahead of time (a few at a time, once a card's still is on
 *  screen) and kept as blob URLs, so hovering plays instantly and never restarts a download. */
const gifCache = new Map<string, string>();
const gifWaiters = new Map<string, Set<(u: string) => void>>();
const gifQueue: string[] = [];
let gifActive = 0;
function pumpGifs() {
  while (gifActive < 3 && gifQueue.length) {
    const id = gifQueue.shift()!;
    if (gifCache.has(id)) continue;
    gifActive++;
    fetch(thumbUrl(id, true))
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => {
        const u = URL.createObjectURL(b);
        gifCache.set(id, u);
        gifWaiters.get(id)?.forEach((f) => f(u));
      })
      .catch(() => {})
      .finally(() => {
        gifActive--;
        gifWaiters.delete(id);
        pumpGifs();
      });
  }
}
function useGif(id: string, want: boolean) {
  const [url, setUrl] = useState<string | undefined>(() => gifCache.get(id));
  useEffect(() => {
    if (!want) return;
    const have = gifCache.get(id);
    if (have) return setUrl(have);
    let set = gifWaiters.get(id);
    if (!set) gifWaiters.set(id, (set = new Set()));
    set.add(setUrl);
    if (!gifQueue.includes(id)) gifQueue.push(id);
    pumpGifs();
    return () => { set!.delete(setUrl); };
  }, [id, want]);
  return url;
}

/** Right-click menu of a mobject made from a project (My mobjects). */
function useMobjectMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null);
  const acct = usePlan();
  const free = acct?.plan !== 'pro';
  const toast = (t: string, k?: 'error') => useStore.getState().toast(t, k);
  const setVis = async (it: LibraryItem, visibility: 'public' | 'private') => {
    try {
      await updateMobject(it.id, { visibility });
      await reloadLibrary();
      toast(`“${it.name}” is now ${visibility}`);
    } catch (e: any) { toast(String(e?.message || e), 'error'); }
  };
  const items = (it: LibraryItem): MenuItem[] => [
    { label: 'Add at playhead', icon: <Plus size={13} />, action: () => addItem(it.id) },
    it.visibility === 'private'
      ? { label: 'Make public', icon: <Globe size={13} />, action: () => setVis(it, 'public') }
      : { label: free ? 'Make private (Pro)' : 'Make private', icon: <Lock size={13} />, disabled: free, action: () => setVis(it, 'private') },
    {
      label: 'Open source project', icon: <FolderOpen size={13} />, disabled: !it.source_path,
      action: () => { if (it.source_path && it.source_path !== useStore.getState().filePath) switchToProject(it.source_path); },
    },
    { sep: true },
    {
      label: 'Delete mobject…', icon: <Trash2 size={13} />, danger: true, action: async () => {
        const n = useStore.getState().project.clips.filter((c) => c.item === it.id).length;
        const ok = await window.studio.confirm(`Delete the mobject “${it.name}”?`, n ? `${n} clip${n === 1 ? '' : 's'} in this project use${n === 1 ? 's' : ''} it and will show nothing. The project it was made from is not touched.` : 'The project it was made from is not touched.', ['Delete', 'Cancel']);
        if (ok !== 0) return;
        try { await deleteMobject(it.id); await reloadLibrary(); toast(`Deleted “${it.name}”`); } catch (e: any) { toast(String(e?.message || e), 'error'); }
      },
    },
  ];
  const el = menu ? <ContextMenu x={menu.x} y={menu.y} items={items(menu.item)} onClose={() => setMenu(null)} /> : null;
  return { open: (x: number, y: number, item: LibraryItem) => setMenu({ x, y, item }), el };
}

const MobjectMenu = createContext<((x: number, y: number, item: LibraryItem) => void) | null>(null);

function Card({ item, active, related }: { item: LibraryItem; active?: boolean; related?: boolean }) {
  const openMenu = useContext(MobjectMenu);
  const [hover, setHover] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const gif = useGif(item.id, loaded);
  // Only request the thumbnail once the card is near the viewport: the browser allows a
  // handful of connections per host, so loading every card at once would queue a hovered
  // card's animated preview behind dozens of off-screen stills.
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { root: el.closest('.lib-scroll'), rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return (
    <div
      ref={ref}
      className={`lib-card ${active ? 'active' : ''} ${related ? 'related' : ''} ${item.nc ? 'nc' : ''}`}
      draggable
      data-item={item.id}
      title={`${item.name}${item.desc ? ` — ${item.desc}` : ''}${item.nc ? `\n${item.license}` : ''}${item.user ? `\n${item.visibility === 'private' ? 'Private: only you can use it' : `Public${item.author ? ` · by ${item.author}` : ''}`} · right-click for more` : ''}\nDrag onto the preview or the timeline (double-click to add at the playhead)`}
      onContextMenu={item.user ? (e) => { e.preventDefault(); openMenu?.(e.clientX, e.clientY, item); } : undefined}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_ITEM, item.id);
        e.dataTransfer.setData('text/plain', item.name);
        e.dataTransfer.effectAllowed = 'copy';
        const img = (e.currentTarget as HTMLElement).querySelector('img');
        if (img) e.dataTransfer.setDragImage(img, 60, 34);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={() => addItem(item.id)}
    >
      <div className="lib-thumb">
        {!near ? null : !failed ? (
          <img
            src={hover && gif ? gif : thumbUrl(item.id)}
            alt={item.name}
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="lib-thumb-fallback">{item.name[0]}</div>
        )}
        {item.dynamic && <span className="lib-badge" title="Animated"><Timer size={10} /></span>}
        {item.user && (
          <span className={`lib-badge vis-badge ${item.visibility === 'private' ? 'private' : 'public'}`} data-testid="mobject-visibility" title={item.visibility === 'private' ? 'Private' : 'Public'}>
            {item.visibility === 'private' ? <Lock size={9} /> : <Globe size={9} />}
          </span>
        )}
        {item.nc && (
          <>
            <div className="nc-overlay" aria-label="Non-commercial"><span>NON-COMMERCIAL</span></div>
            <span className="lib-badge nc-badge" title={item.license}>NC</span>
          </>
        )}
      </div>
      <div className="lib-name">
        <span className="cat-ico" style={{ color: CATEGORY_COLORS[item.category] || '#888' }}><CategoryIcon category={item.category} size={12} /></span>
        {item.name}
      </div>
    </div>
  );
}

/** Keyword filter for the mathstudio library (the engine's semantic index covers built-ins only). */
function importedMatch(it: LibraryItem, q: string) {
  const hay = `${it.name} ${it.desc || ''} ${it.rel || ''} ${it.source || ''} ${it.source_name || ''} ${it.author || ''} ${(it.tags || []).join(' ')}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

function Section({ id, title, icon, items, collapsed, toggle }: {
  id: string; title: string; icon?: ReactNode; items: LibraryItem[]; collapsed: boolean; toggle: (id: string) => void;
}) {
  return (
    <section>
      <h4 onClick={() => toggle(id)}>
        <span className={`chev ${collapsed ? '' : 'open'}`}>›</span> {icon} {title} <small>{items.length}</small>
      </h4>
      {!collapsed && (
        <div className="lib-grid">
          {items.map((it) => <Card key={it.id} item={it} />)}
        </div>
      )}
    </section>
  );
}

export default function Library() {
  const library = useStore((s) => s.library)!;
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { res, status, failed } = useSemanticSearch(q);
  const mobjectMenu = useMobjectMenu();
  const query = q.trim();
  const searching = query.length > 0;

  // One pool: built-in categories first, then the mathstudio library grouped by source.
  const groups = useMemo(() => {
    const out: { id: string; title: string; cat?: string; items: LibraryItem[] }[] = [];
    const idx = new Map<string, LibraryItem[]>();
    const push = (id: string, title: string, it: LibraryItem, cat?: string) => {
      let g = idx.get(id);
      if (!g) {
        idx.set(id, (g = []));
        out.push({ id, title, cat, items: g });
      }
      g.push(it);
    };
    // the user's own mobjects (made from projects) come first
    for (const it of library.items) if (it.user) push('user', 'My mobjects', it);
    const builtin: Record<string, LibraryItem[]> = {};
    for (const it of library.items) if (!it.hidden && !it.user && it.category !== 'Imported') (builtin[it.category] ||= []).push(it);
    for (const cat of library.categories) for (const it of builtin[cat] || []) push(cat, cat, it, cat);
    for (const it of library.items) if (it.category === 'Imported') push(`src:${it.source || 'Other'}`, it.source || 'Other', it);
    return out;
  }, [library]);

  // Ranked search results.  Engine results (semantic + keyword) for built-ins when they are
  // for the current query; an instant local keyword filter while typing / if the engine
  // fails.  Mathstudio-library matches follow in the same grid.
  const results = useMemo(() => {
    if (!searching) return null;
    const byId = new Map(library.items.map((it) => [it.id, it]));
    const imported = library.items.filter((it) => (it.user || it.category === 'Imported') && importedMatch(it, query));
    // An engine answer — for this query, or the previous one while the next is in flight
    // (keeps the grid stable while typing instead of flickering to the local filter).
    if (res && !failed) {
      const pick = (tier: string) => res.results.filter((h) => h.tier === tier).map((h) => byId.get(h.id)!).filter(Boolean);
      return { matches: [...pick('match'), ...imported], related: pick('related'), relatedCat: res.related, semantic: res.semantic, pending: res.q !== query };
    }
    const local = library.items.filter((it) => it.category !== 'Imported' && !it.user && !it.hidden && localMatch(it, query));
    return { matches: [...local, ...imported], related: [] as LibraryItem[], relatedCat: null as string | null, semantic: false, pending: !failed };
  }, [searching, res, query, failed, library]);

  const first = results?.matches[0] || results?.related[0];

  return (
    <MobjectMenu.Provider value={mobjectMenu.open}>
    {full && <div className="library-slot" />}
    {full && <div className="library-backdrop" data-testid="library-backdrop" onMouseDown={() => setFull(false)} />}
    <aside className={`panel library ${full ? 'full' : ''}`}>
      <div className="search">
        <div className="search-box">
        <Search size={14} className="search-ico" />
        <input
          ref={inputRef}
          placeholder="Search by name or idea…"
          value={q}
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && first) {
              e.preventDefault();
              addItem(first.id);
            } else if (e.key === 'Escape' && q) {
              e.preventDefault();
              e.stopPropagation();
              setQ('');
            }
          }}
        />
        {q && (
          <button className="search-clear" title="Clear (Esc)" onClick={() => { setQ(''); inputRef.current?.focus(); }}>
            <X size={12} />
          </button>
        )}
        <span
          className={`search-mode ${status}`}
          title={
            status === 'ready'
              ? 'Semantic search: describe what you need — e.g. “transformer architecture”, “probability”, “something round”'
              : status === 'unavailable'
                ? 'Keyword search (the semantic model could not be loaded)'
                : status === 'downloading'
                  ? 'Downloading the semantic search model (one-time, ~130 MB)… keyword search meanwhile'
                  : 'Loading semantic search… keyword search meanwhile'
          }
        >
          {status === 'loading' || status === 'downloading' || status === 'idle' ? <LoaderCircle size={13} className="spin" /> : <Sparkles size={13} />}
        </span>
        </div>
        {full ? (
          <button className="icon-btn lib-expand" data-testid="library-close" title="Close (Esc)" onClick={() => setFull(false)}>
            <Minimize2 size={14} />
          </button>
        ) : (
          <button className="icon-btn lib-expand" data-testid="library-expand" title="Expand library" onClick={() => setFull(true)}>
            <Maximize2 size={14} />
          </button>
        )}
      </div>
      <div className="lib-scroll">
        {results && (
          <div className={`search-results ${results.pending ? "pending" : ""}`} data-testid="search-results">
            {results.matches.length + results.related.length === 0 ? (
              <div className="search-empty">
                {results.pending ? 'Searching…' : <>No matches for “{query}”.<br /><span>Try describing the idea — “neural network”, “probability”, “arrow”…</span></>}
              </div>
            ) : (
              <>
                {results.matches.length > 0 && (
                  <section>
                    <h4 className="static">
                      {results.semantic ? <Sparkles size={12} /> : <Search size={12} />} Best matches <small>{results.matches.length}</small>
                    </h4>
                    <div className="lib-grid">
                      {results.matches.map((it) => (
                        <Card key={it.id} item={it} active={it === first} />
                      ))}
                    </div>
                  </section>
                )}
                {results.related.length > 0 && (
                  <section>
                    <h4 className="static">
                      <CategoryIcon category={results.relatedCat || ''} size={12} /> Related in {results.relatedCat} <small>{results.related.length}</small>
                    </h4>
                    <div className="lib-grid">
                      {results.related.map((it) => (
                        <Card key={it.id} item={it} related active={it === first} />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        )}
        {!searching && groups.map((g) => (
          <Section
            key={g.id}
            id={g.id}
            title={g.title}
            icon={g.cat ? <CategoryIcon category={g.cat} size={13} /> : g.id === 'user' ? <Package size={13} /> : undefined}
            items={g.items}
            collapsed={!!collapsed[g.id]}
            toggle={toggle}
          />
        ))}
      </div>
    </aside>
    {mobjectMenu.el}
    </MobjectMenu.Provider>
  );
}
