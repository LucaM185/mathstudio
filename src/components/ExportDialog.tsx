import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { cancelExport, exportCode, exportStatus, startExport } from '../engine';

const RESOLUTIONS: [string, [number, number]][] = [
  ['480p (854×480)', [854, 480]],
  ['720p (1280×720)', [1280, 720]],
  ['1080p (1920×1080)', [1920, 1080]],
  ['1440p (2560×1440)', [2560, 1440]],
  ['4K (3840×2160)', [3840, 2160]],
];

export default function ExportDialog() {
  const project = useStore((s) => s.project);
  const [format, setFormat] = useState<'mp4' | 'mov' | 'gif'>('mp4');
  const [res, setRes] = useState<[number, number]>(project.settings.resolution || [1920, 1080]);
  const [fps, setFps] = useState(project.settings.fps || 30);
  const [job, setJob] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [showLog, setShowLog] = useState(false);
  const timer = useRef<any>(null);

  useEffect(() => () => clearInterval(timer.current), []);

  const close = () => {
    if (status?.status === 'running') return;
    useStore.setState({ exportOpen: false });
  };

  const start = async () => {
    const out = await window.studio.chooseExportPath(project.settings.name || 'MathStudio', format);
    if (!out) return;
    useStore.getState().commit((p) => { p.settings.resolution = res; p.settings.fps = fps; }, { transient: true });
    try {
      const id = await startExport({ project, out, format, resolution: res, fps });
      setJob(id);
      setStatus({ status: 'running', progress: 0 });
      timer.current = setInterval(async () => {
        const st = await exportStatus(id);
        setStatus(st);
        if (st.status !== 'running') clearInterval(timer.current);
      }, 300);
    } catch (e: any) {
      setStatus({ status: 'error', log: String(e.message || e) });
    }
  };

  const saveCode = async () => {
    const dir = await window.studio.chooseDir();
    if (!dir) return;
    const folder = `${dir}/${(project.settings.name || 'scene').replace(/[^\w-]+/g, '_')}`;
    await exportCode(project, folder);
    useStore.getState().toast('ManimGL project written', 'success');
    window.studio.reveal(`${folder}/scene.py`);
  };

  const running = status?.status === 'running';
  const pct = Math.round((status?.progress || 0) * 100);
  const frames = Math.round(project.settings.duration * fps);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" data-testid="export-dialog">
        <div className="modal-head">
          <h3>Export</h3>
          <button className="icon-btn" onClick={close} disabled={running}>✕</button>
        </div>
        <div className="modal-body">
          <p className="muted">
            Renders the scene with <code>manimgl scene.py MainScene -w</code> — the exact code shown in the code panel.
          </p>
          <div className="form-grid">
            <label>Format</label>
            <div className="seg">
              {(['mp4', 'mov', 'gif'] as const).map((f) => (
                <button key={f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)} disabled={running}>
                  {f === 'mov' ? 'MOV (transparent)' : f.toUpperCase()}
                </button>
              ))}
            </div>
            <label>Resolution</label>
            <select value={res.join('x')} onChange={(e) => setRes(e.target.value.split('x').map(Number) as any)} disabled={running}>
              {RESOLUTIONS.map(([l, r]) => (
                <option key={l} value={r.join('x')}>{l}</option>
              ))}
            </select>
            <label>Frame rate</label>
            <select value={fps} onChange={(e) => setFps(Number(e.target.value))} disabled={running}>
              {[15, 24, 25, 30, 50, 60].map((f) => (
                <option key={f} value={f}>{f} fps</option>
              ))}
            </select>
            <label>Length</label>
            <div>{project.settings.duration.toFixed(2)} s · {frames} frames</div>
          </div>
          {status && (
            <div className={`export-status ${status.status}`}>
              <div className="bar"><div style={{ width: `${status.status === 'done' ? 100 : pct}%` }} /></div>
              <div className="row">
                {status.status === 'running' && <span>Rendering… {pct}%</span>}
                {status.status === 'done' && <span>✓ Done in {status.elapsed?.toFixed(1)}s</span>}
                {status.status === 'error' && <span>✕ Export failed</span>}
                {status.status === 'cancelled' && <span>Cancelled</span>}
                <div className="spacer" />
                {status.log && <button className="btn small ghost" onClick={() => setShowLog(!showLog)}>{showLog ? 'Hide' : 'Show'} log</button>}
                {status.status === 'done' && (
                  <>
                    <button className="btn small" onClick={() => window.studio.openPath(status.file)}>Open video</button>
                    <button className="btn small" onClick={() => window.studio.reveal(status.file)}>Show in Finder</button>
                  </>
                )}
              </div>
              {showLog && <pre className="log">{status.log}</pre>}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={saveCode} disabled={running} title="Write scene.py + studio_runtime.py + assets into a folder">
            Save as ManimGL project…
          </button>
          <div className="spacer" />
          {running ? (
            <button className="btn danger" onClick={() => job && cancelExport(job)}>Cancel</button>
          ) : (
            <button className="btn primary" onClick={start} data-testid="export-start">Render {format.toUpperCase()}…</button>
          )}
        </div>
      </div>
    </div>
  );
}
