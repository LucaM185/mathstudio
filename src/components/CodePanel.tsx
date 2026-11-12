import { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { X } from 'lucide-react';
import { useStore } from '../store';
import { fetchCode } from '../engine';
import { CodeTab } from './Inspector';

// Code popup: opens straight as a modal (same look as the expanded Library) — no docked panel.
export default function CodePanel() {
  const project = useStore((s) => s.project);
  const codeClip = useStore((s) => s.codeClip);
  const clip = useStore((s) => (codeClip ? s.project.clips.find((c) => c.id === codeClip) : undefined));
  const [code, setCode] = useState('');
  const close = () => useStore.setState({ codeOpen: false, codeClip: null });

  useEffect(() => {
    const t = setTimeout(() => {
      fetchCode(project).then(setCode).catch(() => {});
    }, 150);
    return () => clearTimeout(t);
  }, [project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const closeBtn = (
    <button className="icon-btn lib-close" data-testid="code-close" title="Close (Esc)" onClick={close}><X size={16} /></button>
  );

  return (
    <>
      <div className="library-backdrop" data-testid="code-backdrop" onMouseDown={close} />
      <div className="code-panel full" data-testid="code-popup">
        {clip ? (
          <>
            <div className="code-head">
              {closeBtn}
              <span>{clip.name} <span className="muted">— clip code</span></span>
              <div className="spacer" />
              <button className="btn small" onClick={() => useStore.setState({ codeClip: null })}>Scene code</button>
            </div>
            <CodeTab clip={clip} />
          </>
        ) : (
          <>
            <div className="code-head">
              {closeBtn}
              <span>scene.py <span className="muted">— generated ManimGL code (read-only)</span></span>
              <div className="spacer" />
              <button className="btn small" onClick={() => { navigator.clipboard.writeText(code); useStore.getState().toast('Code copied'); }}>Copy</button>
            </div>
            <div className="code-body" data-testid="scene-code">
              <CodeMirror value={code} theme={oneDark} extensions={[python(), EditorView.editable.of(false)]} editable={false} height="100%" basicSetup={{ foldGutter: true, highlightActiveLine: false }} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
