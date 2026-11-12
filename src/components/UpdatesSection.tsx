// Settings → Updates: current version, "Check for updates", download progress, "Restart to update".
// An AppImage replaces itself; other installs get a link to the releases page (see main.cjs).
import { useState } from 'react';
import { Check, Download, ExternalLink, RefreshCw, RotateCcw, X } from 'lucide-react';
import { formatBytes, timeAgo, useUpdate } from '../updates';

export default function UpdatesSection() {
  const s = useUpdate((x) => x.status);
  const [busy, setBusy] = useState(false);
  const api = window.studio.updates;
  if (!api) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const state = s?.state || 'idle';
  const working = state === 'checking' || state === 'downloading' || busy;
  const canInstall = s?.mode === 'install';

  return (
    <section className="ins-section" data-testid="settings-updates">
      <h5 className="static"><RefreshCw size={13} /> Updates</h5>
      <div className="ins-body">
        <div className="upd-ver" data-testid="update-current">
          MathStudio <b>{s?.current || '…'}</b>
        </div>

        {s?.mode === 'source' ? (
          <p className="hint" data-testid="update-source">Running from source: update with <code>git pull</code>. Installed builds (AppImage) update themselves from here.</p>
        ) : (
          <>
            <div className="upd-status" data-testid="update-status" data-state={state}>
              {state === 'checking' && <span className="muted">Checking for updates…</span>}
              {state === 'latest' && <span className="set-test ok"><Check size={12} /> You’re up to date.</span>}
              {state === 'error' && <span className="set-test bad"><X size={12} /> {s?.error}</span>}
              {(state === 'available' || state === 'downloading' || state === 'ready') && (
                <div className="upd-new">
                  <div className="upd-title">
                    {state === 'ready' ? <>MathStudio <b>{s?.version}</b> is ready to install.</> : <>MathStudio <b>{s?.version}</b> is available.</>}
                  </div>
                  {state === 'downloading' && (
                    <>
                      <div className="upd-bar" data-testid="update-progress"><i style={{ width: `${Math.max(2, Math.min(100, s?.percent || 0))}%` }} /></div>
                      <div className="hint">
                        Downloading… {Math.floor(s?.percent || 0)}%
                        {s?.total ? <> · {formatBytes(s.transferred)} of {formatBytes(s.total)}</> : null}
                        {s?.bytesPerSecond ? <> · {formatBytes(s.bytesPerSecond)}/s</> : null}
                      </div>
                    </>
                  )}
                  {s?.notes ? <div className="upd-notes" data-testid="update-notes">{s.notes}</div> : null}
                </div>
              )}
            </div>

            <div className="set-btns">
              {state === 'available' && canInstall && (
                <button className="btn small primary" disabled={working} onClick={() => run(() => api.download())} data-testid="update-download">
                  <Download size={12} /> Download update
                </button>
              )}
              {state === 'available' && !canInstall && (
                <button className="btn small primary" onClick={() => api.openPage()} data-testid="update-open-page">
                  <ExternalLink size={12} /> Open download page
                </button>
              )}
              {state === 'ready' && (
                <button className="btn small primary" disabled={busy} onClick={() => run(() => api.install())} data-testid="update-install">
                  <RotateCcw size={12} /> Restart to update
                </button>
              )}
              {state !== 'ready' && state !== 'downloading' && (
                <button className="btn small" disabled={working} onClick={() => run(() => api.check())} data-testid="update-check">
                  {state === 'checking' ? 'Checking…' : 'Check for updates'}
                </button>
              )}
            </div>

            {state === 'ready' && <p className="hint faint-hint">Your project is saved first. If you don’t restart now, the update installs when you quit.</p>}
            {state === 'available' && !canInstall && (
              <p className="hint faint-hint">This copy can’t update itself (it was installed as a package). Download the new version and install it over this one — your projects and settings stay.</p>
            )}

            <label className="upd-auto">
              <input type="checkbox" checked={!!s?.autoCheck} onChange={(e) => api.setAuto(e.target.checked).then((n) => useUpdate.setState({ status: n }))} data-testid="update-auto" />
              Check for updates automatically
            </label>
            {s?.lastCheck && <p className="hint faint-hint" data-testid="update-last">Last checked {timeAgo(s.lastCheck)}.</p>}
          </>
        )}
      </div>
    </section>
  );
}
