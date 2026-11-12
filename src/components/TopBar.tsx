import { useStore } from '../store';
import { ChevronDown, Code2, Download, LayoutGrid } from 'lucide-react';
import RecentStrip from './RecentStrip';

// Chrome-like title bar: Projects on the left, then one tab per project (the one on screen merges
// into the panels below and holds the editable name), free space to drag the window, Code/Export.
export default function TopBar() {
  const codeOpen = useStore((s) => s.codeOpen);
  const projectsOpen = useStore((s) => s.projectsOpen);

  return (
    <header className="topbar">
      <div className="title">
        <button
          className={`btn projects-btn ${projectsOpen ? 'active' : ''}`}
          onClick={() => useStore.setState({ projectsOpen: !useStore.getState().projectsOpen })}
          title="Browse and switch projects (⌘P)"
          data-testid="projects-btn"
        >
          <LayoutGrid size={14} /> Projects <ChevronDown size={13} className="chev" />
        </button>
      </div>
      <RecentStrip />
      <div className="tb-group right">
        <button className={`btn ${codeOpen ? 'active' : 'ghost'}`} onClick={() => { const s = useStore.getState(); if (s.codeClip) useStore.setState({ codeOpen: true, codeClip: null }); else useStore.setState({ codeOpen: !s.codeOpen }); }} title="Show the generated ManimGL code (⇧⌘C)">
          <Code2 size={15} /> Code
        </button>
        <button className="btn primary" onClick={() => useStore.setState({ exportOpen: true })} title="Render a video with manimgl (⌘E)" data-testid="export-btn">
          <Download size={15} /> Export
        </button>
      </div>
    </header>
  );
}
