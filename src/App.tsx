import { BootScreen, BootError } from './components/BootScreen';
import { useEffect, useRef, useState } from 'react';
import { useStore, type Tool } from './store';
import { flushAll, scheduleSave } from './autosave';
import { previousSession, useStrip, isSid } from './sessions';
import { fetchHealth, fetchLibrary } from './engine';
import Library from './components/Library';
import GlobalsPanel from './components/GlobalsPanel';
import Preview from './components/Preview';
import Inspector from './components/Inspector';
import Timeline from './components/Timeline';
import TopBar from './components/TopBar';
import CodePanel from './components/CodePanel';
import ExportDialog from './components/ExportDialog';
import ProjectsPanel from './components/ProjectsPanel';
import Toasts from './components/Toasts';
import AgentPanel from './components/AgentPanel';
import SettingsPanel from './components/SettingsPanel';
import { useAgent } from './agent/agent';
import { hasUpdate, initUpdates, useUpdate } from './updates';
import { Settings, SlidersHorizontal, Sparkles } from 'lucide-react';
import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  importFiles,
  loadExample,
  newProjectAction,
  openProject,
  pasteClipboard,
  saveProject,
  addTransformAt,
  splitAtPlayhead,
  switchToProject,
  switchToSession,
} from './actions';
import { normalizeProject, addKeyAt, CAMERA_ID, setCameraAt } from './ops';
import { exitEditorView, fitNav, lookPreset } from './nav';

/** a tool key held at least this long reverts to the previous tool on release (FCP press-and-hold) */
const HOLD_MS = 350;

function isEditable(el: Element | null) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return !!(el as HTMLElement).closest?.('.cm-editor') || (el as HTMLElement).isContentEditable;
}

/** A bit of layout state remembered across launches (best effort: storage may be unavailable). */
function usePersisted<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? init : (JSON.parse(raw) as T);
    } catch {
      return init;
    }
  });
  const set = (nv: T) => {
    setV(nv);
    try { localStorage.setItem(key, JSON.stringify(nv)); } catch { /* ignore */ }
  };
  return [v, set];
}

export default function App() {
  const engineStatus = useStore((s) => s.engineStatus);
  const engineError = useStore((s) => s.engineError);
  const library = useStore((s) => s.library);
  const codeOpen = useStore((s) => s.codeOpen);
  const exportOpen = useStore((s) => s.exportOpen);
  const projectsOpen = useStore((s) => s.projectsOpen);
  const rightTab = useStore((s) => s.rightTab);
  const agentRunning = useAgent((s) => s.running);
  const updateDot = useUpdate((u) => hasUpdate(u.status));
  const [timelineH, setTimelineH] = useState(300);
  const [leftW, setLeftW] = useState(300);
  const [globalsH, setGlobalsH] = usePersisted('ms.globalsH', 200);
  const [globalsCollapsed, setGlobalsCollapsed] = usePersisted('ms.globalsCollapsed', false);
  const [rightW, setRightW] = useState(360);
  const booted = useRef(false);

  // ------------------------------------------------------------ boot the engine
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const connect = async (port: number) => {
      useStore.setState({ port, engineStatus: 'starting' });
      for (let i = 0; i < 100; i++) {
        try {
          const lib = await fetchLibrary();
          useStore.setState({ library: lib, engineStatus: 'ready', engineError: null });
          // which OpenGL the engine got (GPU or software): drives the Auto preview quality
          fetchHealth().then((h) => useStore.setState({ gl: h.gl && h.gl.renderer !== undefined ? h.gl : null })).catch(() => {});
          return;
        } catch (e) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      useStore.setState({ engineStatus: 'error', engineError: 'Could not reach the render engine.' });
    };
    window.studio.settings?.get().then((s) => useStore.setState({ renderQuality: s.quality })).catch(() => {});
    window.studio.onEnginePort((p) => connect(p));
    window.studio.onEngineStatus((s) => useStore.setState({ engineStatus: s as any }));
    window.studio.enginePort().then((p) => {
      if (typeof p === 'number') connect(p);
      else useStore.setState({ engineStatus: 'error', engineError: p.error });
    });
    window.studio.autosaveRead().then((data) => {
      if (data && data.project && Array.isArray(data.project.clips)) {
        useStore.getState().loadProject(normalizeProject(data.project), data.filePath || null);
        if (data.dirty) { useStore.setState({ dirty: true }); scheduleSave(); }
      }
    }).finally(() => {
      window.studio.startupProjects?.().then((show) => { if (show) useStore.setState({ projectsOpen: true }); });
    });
  }, []);

  // ------------------------------------------------------------ autosave + title
  useEffect(() => {
    let timer: any = null;
    const unsub = useStore.subscribe((s, prev) => {
      if (s.project !== prev.project || s.filePath !== prev.filePath || s.dirty !== prev.dirty) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const st = useStore.getState();
          window.studio.autosaveWrite({ project: st.project, filePath: st.filePath, dirty: st.dirty });
        }, 600);
        // (switching projects isn't an edit: a background project schedules its own saves)
        if (s.sessionId === prev.sessionId && s.dirty && (s.project !== prev.project || !prev.dirty)) scheduleSave();
        document.title = `${s.project.settings.name} — MathStudio`;
        window.studio.setTitle(document.title);
      }
    });
    initUpdates();
    window.studio.onClosing(async () => {
      await flushAll();
      const st = useStore.getState();
      await window.studio.autosaveWrite({ project: st.project, filePath: st.filePath, dirty: st.dirty });
    });
    return () => unsub();
  }, []);

  // ------------------------------------------------------------ menu + keyboard
  useEffect(() => {
    const S = useStore.getState;
    const undo = () => {
      if (isEditable(document.activeElement)) document.execCommand('undo');
      else S().undo();
    };
    const redo = () => {
      if (isEditable(document.activeElement)) document.execCommand('redo');
      else S().redo();
    };
    window.studio.onMenu(async (cmd) => {
      switch (cmd) {
        case 'new': return newProjectAction();
        case 'open': return openProject();
        case 'projects': return useStore.setState({ projectsOpen: !S().projectsOpen });
        case 'example': return loadExample();
        case 'save': return saveProject(false);
        case 'saveAs': return saveProject(true);
        case 'import': {
          const paths = await window.studio.chooseMedia();
          if (paths.length) importFiles(paths);
          return;
        }
        case 'export': return useStore.setState({ exportOpen: true });
        case 'exportCode': return useStore.setState({ exportOpen: true });
        case 'undo': return undo();
        case 'redo': return redo();
        case 'toggleCode': return useStore.setState({ codeOpen: !S().codeOpen, codeClip: null });
        case 'agent':
          useStore.setState({ rightTab: 'agent' });
          setTimeout(() => window.dispatchEvent(new Event('agent:focus')), 0);
          return;
        case 'settings': return useStore.setState({ rightTab: 'settings' });
      }
    });
    let held: { key: string; prev: Tool; at: number } | null = null;
    // quick project switching works everywhere, even while typing to the agent:
    // ⌃Tab = back to the previous project, ⌘1…⌘7 = the projects on the top-bar strip
    const onSwitchKey = (e: KeyboardEvent) => {
      if (S().projectsOpen || S().exportOpen) return;
      if (e.ctrlKey && !e.metaKey && e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        const sid = previousSession();
        if (sid) switchToSession(sid);
        return;
      }
      if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        const id = useStrip.getState().order[Number(e.key) - 1];
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        if (isSid(id)) switchToSession(id);
        else switchToProject(id, { quiet: true });
      }
    };
    window.addEventListener('keydown', onSwitchKey, true);
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(document.activeElement)) {
        if (e.key === 'Escape') (document.activeElement as HTMLElement).blur();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const st = S();
      const fps = st.project.settings.fps;
      switch (true) {
        case e.key === ' ':
          e.preventDefault();
          useStore.setState({ playing: !st.playing });
          break;
        case e.key === 'Backspace' || e.key === 'Delete':
          e.preventDefault();
          deleteSelection();
          break;
        case mod && e.key.toLowerCase() === 'd':
          e.preventDefault();
          duplicateSelection();
          break;
        case mod && e.key.toLowerCase() === 'c':
          copySelection();
          break;
        case mod && e.key.toLowerCase() === 'v':
          pasteClipboard();
          break;
        case mod && e.key.toLowerCase() === 'a':
          e.preventDefault();
          useStore.setState({ selection: st.project.clips.map((c) => c.id) });
          break;
        // Final Cut Pro tools: A = Select, B = Blade. Tap to switch; press-and-hold to use it only while held.
        case !mod && !e.altKey && (e.key.toLowerCase() === 'a' || e.key.toLowerCase() === 'b'): {
          if (e.repeat) break;
          const k = e.key.toLowerCase();
          held = { key: k, prev: st.tool, at: performance.now() };
          useStore.setState({ tool: k === 'a' ? 'select' : 'blade' });
          break;
        }
        // ⌘B = Blade (selected clips, or everything under the playhead); ⇧⌘B = Blade All
        case mod && !e.altKey && e.key.toLowerCase() === 'b':
          e.preventDefault();
          splitAtPlayhead(e.shiftKey);
          break;
        case !mod && e.key.toLowerCase() === 'c' && S().selection.includes(CAMERA_ID):
          e.preventDefault();
          // from the editor view, C first goes back to looking through the camera
          useStore.setState(S().editorView ? { editorView: null } : { camFullView: !S().camFullView });
          break;
        // T = transform the selected clip at the playhead (it morphs into an editable copy of itself)
        case !mod && !e.altKey && e.key.toLowerCase() === 't': {
          const c = st.project.clips.find((x) => x.id === st.selection[0]);
          if (!c) break;
          e.preventDefault();
          addTransformAt(c.id, st.time);
          break;
        }
        case !mod && e.key.toLowerCase() === 'k': {
          const id = st.selection[0];
          if (!id) break;
          if (id === CAMERA_ID) {
            st.commit((p) => setCameraAt(p, st.time, {}, fps));
            st.toast('Camera keyframe added');
            break;
          }
          st.commit((p) => {
            const c = p.clips.find((c) => c.id === id);
            if (c) addKeyAt(c, st.time - c.start, fps);
          });
          st.toast('Keyframe added');
          break;
        }
        case e.key === 'ArrowLeft':
          e.preventDefault();
          useStore.setState({ playing: false });
          st.setTime(st.time - (e.shiftKey ? 1 : 1 / fps));
          break;
        case e.key === 'ArrowRight':
          e.preventDefault();
          useStore.setState({ playing: false });
          st.setTime(st.time + (e.shiftKey ? 1 : 1 / fps));
          break;
        case e.key === 'Home':
          st.setTime(0);
          break;
        case e.key === 'End':
          st.setTime(st.project.settings.duration);
          break;
        case mod && e.key.toLowerCase() === 'f': {
          e.preventDefault();
          const el = document.querySelector<HTMLInputElement>('.library .search input');
          el?.focus();
          el?.select();
          break;
        }
        case e.key === 'Escape': {
          // inside a group: one level up (part -> its group -> the whole clip), then deselect
          const sp = st.selectedPart;
          if (sp && st.selection.includes(sp.clip)) useStore.setState({ selectedPart: sp.path.includes('.') ? { clip: sp.clip, path: sp.path.slice(0, sp.path.lastIndexOf('.')) } : null });
          else useStore.setState({ selection: [], selectedKey: null, selectedPart: null });
          break;
        }
        // 3D navigation (Blender-style numbers): 7 top, 1 front, 3 right, 5 = ManimGL's 3D view; ⌃ = opposite side
        case !e.metaKey && !e.altKey && ['1', '3', '5', '7'].includes(e.key): {
          e.preventDefault();
          const k = e.key;
          lookPreset(k === '7' ? (e.ctrlKey ? 'bottom' : 'top') : k === '1' ? (e.ctrlKey ? 'back' : 'front') : k === '3' ? (e.ctrlKey ? 'left' : 'right') : 'iso');
          break;
        }
        case !mod && !e.altKey && e.key === '0':
          exitEditorView();
          break;
        case !mod && !e.altKey && e.key.toLowerCase() === 'f':
          e.preventDefault();
          fitNav();
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!held || e.key.toLowerCase() !== held.key) return;
      // held rather than tapped: go back to the tool that was active before
      if (performance.now() - held.at > HOLD_MS) useStore.setState({ tool: held.prev });
      held = null;
    };
    const onBlur = () => { held = null; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onSwitchKey, true);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // ------------------------------------------------------------ resizers
  const drag = (onMove: (dx: number, dy: number) => void) => (e: React.PointerEvent) => {
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => onMove(ev.clientX - sx, ev.clientY - sy);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (engineStatus === 'error') return <BootError error={engineError} />;
  if (!library) return <BootScreen />;

  return (
    <div className="app" style={{ gridTemplateColumns: `${leftW}px 4px 1fr 4px ${rightW}px`, gridTemplateRows: `46px 1fr 4px ${timelineH}px` }}>
      <TopBar />
      <div className="left-col">
        <Library />
        {!globalsCollapsed && <div className="gsplit" data-testid="globals-split" onPointerDown={(e) => { const h = globalsH; drag((_dx, dy) => setGlobalsH(Math.max(90, Math.min(window.innerHeight - 360, h - dy))))(e); }} />}
        <GlobalsPanel height={globalsH} collapsed={globalsCollapsed} onToggle={() => setGlobalsCollapsed(!globalsCollapsed)} />
      </div>
      <div className="vsplit" onPointerDown={(e) => { const w = leftW; drag((dx) => setLeftW(Math.max(220, Math.min(520, w + dx))))(e); }} />
      <div className="center">
        <Preview />
        {codeOpen && <CodePanel />}
      </div>
      <div className="vsplit" onPointerDown={(e) => { const w = rightW; drag((dx) => setRightW(Math.max(280, Math.min(600, w - dx))))(e); }} />
      <div className="right-col">
        <div className="right-tabs">
          <button className={rightTab === 'inspector' ? 'on' : ''} onClick={() => useStore.setState({ rightTab: 'inspector' })} data-testid="right-tab-inspector">
            <SlidersHorizontal size={13} /> Inspector
          </button>
          <button className={rightTab === 'agent' ? 'on' : ''} onClick={() => useStore.setState({ rightTab: 'agent' })} data-testid="right-tab-agent" title="AI agent (⌘L)">
            <Sparkles size={13} /> AI Agent {agentRunning && rightTab !== 'agent' && <span className="busy-dot" />}
          </button>
          <button className={`icon-tab ${rightTab === 'settings' ? 'on' : ''}`} onClick={() => useStore.setState({ rightTab: 'settings' })} data-testid="right-tab-settings" title="Settings (⌘,)">
            <Settings size={13} /> <span className="tab-label">Settings</span>{updateDot && rightTab !== 'settings' && <span className="upd-dot" data-testid="update-dot" title="Update available" />}
          </button>
        </div>
        {rightTab === 'inspector' ? <Inspector /> : rightTab === 'agent' ? <AgentPanel /> : <SettingsPanel />}
      </div>
      <div className="hsplit" onPointerDown={(e) => { const h = timelineH; drag((_dx, dy) => setTimelineH(Math.max(160, Math.min(700, h - dy))))(e); }} />
      <Timeline />
      {exportOpen && <ExportDialog />}
      {projectsOpen && <ProjectsPanel />}
      <Toasts />
    </div>
  );
}
