import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, Plus, X } from 'lucide-react';
import { useSessions, useStore } from '../store';
import { closeSession, dismissFromStrip, entryPath, isSid, moveStripToEnd, removeFromStrip, seedStrip, syncStrip, useStrip } from '../sessions';
import { useAgents, type ChatState } from '../agent/agent';
import { newProjectAction, switchToProject, switchToSession, tildify } from '../actions';
import { flushSave } from '../autosave';

interface Pill {
  id: string;
  name: string;
  path: string | null;
  background: string;
  current: boolean;
  open: boolean;
  chat: ChatState | null;
}

/** One line about what a project's agent is doing (hover card / tooltip). */
function agentLine(c: ChatState | null): string | null {
  if (!c) return null;
  if (c.running) {
    const last = c.items[c.items.length - 1];
    if (last?.kind === 'tool' && (last.status === 'running' || last.status === 'pending')) return last.summary;
    return c.phase === 'writing' ? 'Writing a reply…' : c.phase === 'tools' ? 'Working…' : 'Thinking…';
  }
  if (c.unseen === 'error') {
    const err = [...c.items].reverse().find((i) => i.kind === 'error');
    return err && err.kind === 'error' ? `Problem: ${err.text}` : 'The agent hit a problem';
  }
  if (c.unseen === 'done') return 'Agent finished — have a look';
  return null;
}

// Chrome-style project tabs in the top bar: one click (or ⌘1…⌘7, ⌃Tab for the previous one)
// switches project instantly. Agents keep working in projects you leave; their tab shows it.
// The tab on screen holds the editable project name; + opens a new project in a new tab.
export default function RecentStrip() {
  const order = useStrip((s) => s.order);
  const thumbs = useStrip((s) => s.thumbs);
  const files = useStrip((s) => s.files);
  const docs = useSessions((s) => s.docs);
  const chats = useAgents((s) => s.chats);
  const sid = useStore((s) => s.sessionId);
  const curName = useStore((s) => s.project.settings.name);
  const curPath = useStore((s) => s.filePath);
  const curBg = useStore((s) => s.project.settings.background);
  const projectsOpen = useStore((s) => s.projectsOpen);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const hoverTimer = useRef<any>(null);

  // what's on disk: names, thumbnails, files that disappeared
  useEffect(() => {
    if (projectsOpen) return;
    let alive = true;
    window.studio.projects.list().then((r) => alive && seedStrip(r.projects)).catch(() => {});
    return () => { alive = false; };
  }, [projectsOpen, curPath]);
  useEffect(() => { syncStrip(); }, []);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const pills: Pill[] = order.map((id) => {
    if (id === sid) return { id, name: curName, path: curPath, background: curBg, current: true, open: true, chat: chats[id] ?? null };
    if (isSid(id)) {
      const d = docs[id];
      return { id, name: d?.project.settings.name ?? '…', path: d?.filePath ?? null, background: d?.project.settings.background ?? '#1e1e1e', current: false, open: true, chat: chats[id] ?? null };
    }
    const f = files[id];
    return { id, name: f?.title || id.split('/').pop()!.replace(/\.mstudio$/i, ''), path: id, background: f?.background || '#1e1e1e', current: false, open: false, chat: null };
  });

  const go = (p: Pill) => {
    setHover(null);
    clearTimeout(hoverTimer.current);
    if (p.current) return;
    if (p.open) switchToSession(p.id);
    else switchToProject(p.id, { quiet: true });
  };

  const close = async (ev: React.MouseEvent, p: Pill) => {
    ev.stopPropagation();
    setHover(null);
    if (p.chat?.running) return;
    if (p.current) {
      // like closing the active browser tab: the neighbour (right, else left) comes on screen
      const i = pills.indexOf(p);
      const next = pills[i + 1] ?? pills[i - 1];
      if (!next) return;
      if (next.open) { if (!switchToSession(next.id)) return; }
      else if (!(await switchToProject(next.id, { quiet: true }))) return;
    }
    removeFromStrip(p.id);
    if (p.open) {
      await flushSave(false, p.id);
      // an unsaved project gets its file on this flush: keep that file off the strip too
      dismissFromStrip(entryPath(p.id));
      closeSession(p.id);
    }
  };

  const newTab = async () => {
    setHover(null);
    await newProjectAction();
    moveStripToEnd(useStore.getState().sessionId);
  };

  const hovered = hover && pills.find((p) => p.id === hover.id);
  const canClose = (p: Pill) => !p.chat?.running && (!p.current || pills.length > 1);

  return (
    <div className="proj-strip" role="tablist" data-testid="project-strip" onMouseLeave={() => { clearTimeout(hoverTimer.current); setHover(null); }}>
      {pills.map((p) => {
        const c = p.chat;
        const running = !!c?.running;
        const unseen = !running && c?.unseen;
        const thumb = p.path ? thumbs[p.path] : undefined;
        const line = agentLine(c);
        return (
          <div
            key={p.id}
            role="tab"
            aria-selected={p.current}
            className={`strip-pill ${p.current ? 'current' : ''} ${running ? 'running' : ''} ${unseen ? `unseen-${unseen}` : ''}`}
            data-testid="strip-pill"
            data-id={p.id}
            data-name={p.name}
            data-current={p.current ? '1' : undefined}
            data-running={running ? '1' : undefined}
            data-unseen={unseen || undefined}
            onClick={() => go(p)}
            onAuxClick={(ev) => { if (ev.button === 1 && canClose(p)) close(ev, p); }}
            onMouseEnter={(ev) => {
              const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
              clearTimeout(hoverTimer.current);
              const show = () => setHover({ id: p.id, x: r.left + r.width / 2, y: r.bottom + 6 });
              if (hover) show();
              else hoverTimer.current = setTimeout(show, 380);
            }}
          >
            <span className="strip-thumb" style={{ background: p.background }}>
              {thumb ? <img src={thumb} alt="" draggable={false} /> : <span>∑</span>}
            </span>
            {p.current ? (
              <input
                className="project-name strip-name"
                value={curName}
                onChange={(e) => useStore.getState().commit((d) => { d.settings.name = e.target.value; }, { transient: true })}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
                onMouseEnter={() => { clearTimeout(hoverTimer.current); setHover(null); }}
                spellCheck={false}
                title={curPath ? `Click to rename · saved automatically to ${tildify(curPath)}` : 'Click to rename · it gets a file as soon as it has something in it'}
              />
            ) : (
              <span className="strip-name">{p.name}</span>
            )}
            {running ? (
              <span className="strip-status run" title={line || 'Agent working'} data-testid="strip-running"><span className="strip-spin" /></span>
            ) : unseen === 'done' ? (
              <span className="strip-status done" title="Agent finished"><Check size={10} strokeWidth={3} /></span>
            ) : unseen === 'error' ? (
              <span className="strip-status err" title="Agent hit a problem"><AlertCircle size={11} /></span>
            ) : null}
            {canClose(p) && (
              <span className="strip-close" role="button" title={p.current ? 'Close this tab' : 'Remove from this bar'} data-testid="strip-close" onClick={(ev) => close(ev, p)}>
                <X size={12} strokeWidth={2.2} />
              </span>
            )}
          </div>
        );
      })}
      <button className="strip-new" onClick={newTab} title="New project in a new tab (⌘N)" data-testid="strip-new">
        <Plus size={15} />
      </button>
      {hovered && hover && createPortal(
        <div className="strip-card" style={{ left: hover.x, top: hover.y }} data-testid="strip-card">
          <div className="strip-card-thumb" style={{ background: hovered.background }}>
            {hovered.path && thumbs[hovered.path] ? <img src={thumbs[hovered.path]} alt="" /> : <span>∑</span>}
            {hovered.chat?.running && <span className="strip-card-live"><span className="strip-spin" /> AI working</span>}
          </div>
          <div className="strip-card-name">{hovered.name}</div>
          <div className="strip-card-path">{hovered.path ? tildify(hovered.path) : 'Not saved yet'}</div>
          {agentLine(hovered.chat) && <div className={`strip-card-agent ${hovered.chat?.unseen === 'error' ? 'err' : ''}`}>{agentLine(hovered.chat)}</div>}
          <div className="strip-card-hint">{hovered.current ? 'On screen' : `Click to switch${pills.indexOf(hovered) < 9 ? ` · ⌘${pills.indexOf(hovered) + 1}` : ''}`}</div>
        </div>,
        document.body,
      )}
    </div>
  );
}
