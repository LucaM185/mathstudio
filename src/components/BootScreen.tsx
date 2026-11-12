import { useStore } from '../store';

/** Σ drawn as a single stroke — animated like ManimGL's Write/ShowCreation. */
function SigmaMark({ drawing }: { drawing: boolean }) {
  return (
    <div className={`boot-mark${drawing ? ' drawing' : ''}`}>
      <svg viewBox="0 0 64 64" aria-hidden>
        <defs>
          <linearGradient id="bootGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#5b9dff" />
            <stop offset="1" stopColor="#9b6cff" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="62" height="62" rx="16" fill="url(#bootGrad)" />
        <rect x="1.5" y="1.5" width="61" height="61" rx="15.5" fill="none" stroke="rgba(255,255,255,.22)" />
        <path className="sigma-ghost" d="M43 17H21l12.5 15L21 47h22" pathLength={100} />
        <path className="sigma" d="M43 17H21l12.5 15L21 47h22" pathLength={100} />
      </svg>
    </div>
  );
}

export function BootScreen() {
  const port = useStore((s) => s.port);
  const status = useStore((s) => s.engineStatus);
  const stage = status === 'restarting' ? 'Restarting render engine' : port == null ? 'Starting ManimGL engine' : 'Loading library';
  return (
    <div className="boot" data-testid="boot">
      <div className="boot-glow" />
      <div className="boot-card loading">
        <SigmaMark drawing />
        <div className="boot-word">MathStudio</div>
        <div className="boot-stage" key={stage}>{stage}</div>
        <div className="boot-bar"><i /></div>
      </div>
    </div>
  );
}

export function BootError({ error }: { error: string | null }) {
  return (
    <div className="boot" data-testid="boot-error">
      <div className="boot-glow err" />
      <div className="boot-card">
        <SigmaMark drawing={false} />
        <h2>The render engine could not start</h2>
        <pre>{error}</pre>
        <p className="muted">Run <code>./setup.sh</code> in the project folder, then restart MathStudio.</p>
      </div>
    </div>
  );
}
