// Settings tab (right column): preview render quality, the OpenRouter API key for the agent, updates.
import { useEffect, useState } from 'react';
import { Check, Cpu, ExternalLink, Gauge, KeyRound, MonitorCog, X } from 'lucide-react';
import { useStore } from '../store';
import { refreshStatus } from '../agent/agent';
import { effectiveQuality, QUALITY_ORDER, QUALITY_PRESETS, type RenderQuality } from '../quality';
import type { AppSettings } from '../types';
import UpdatesSection from './UpdatesSection';

type KeyTest = { state: 'idle' | 'testing' | 'ok' | 'bad'; text?: string };

const SOURCE_LABEL: Record<string, string> = {
  settings: 'saved in Settings',
  environment: 'from the OPENROUTER_KEY environment variable',
  'env-file': 'from a .env file',
};

export default function SettingsPanel() {
  const quality = useStore((s) => s.renderQuality);
  const gl = useStore((s) => s.gl);
  const meta = useStore((s) => s.meta);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [test, setTest] = useState<KeyTest>({ state: 'idle' });

  useEffect(() => {
    window.studio.settings?.get().then(setSettings).catch(() => {});
  }, []);

  const setQuality = async (q: RenderQuality) => {
    useStore.setState({ renderQuality: q });
    const r = await window.studio.settings?.set({ quality: q });
    if (r && !r.error) setSettings(r);
  };

  const saveKey = async (key: string | null) => {
    setErr(null);
    const r = await window.studio.settings?.set({ openrouterKey: key });
    if (!r) return;
    if (r.error) return setErr(r.error);
    setSettings(r);
    setDraft('');
    setTest({ state: 'idle' });
    refreshStatus();
    if (key) {
      useStore.getState().toast('API key saved');
      runTest();
    }
  };

  const runTest = async (key?: string) => {
    setTest({ state: 'testing' });
    const r = await window.studio.settings?.testKey(key);
    if (!r) return setTest({ state: 'idle' });
    if (!r.ok) return setTest({ state: 'bad', text: r.error });
    const bits = [r.label && `“${r.label}”`, typeof r.usage === 'number' && `$${r.usage.toFixed(2)} used`, r.limit != null && `limit $${r.limit}`].filter(Boolean);
    setTest({ state: 'ok', text: `Key works${bits.length ? ` — ${bits.join(', ')}` : ''}.` });
  };

  const eff = effectiveQuality(quality, gl);
  const key = settings?.key;

  return (
    <div className="panel settings" data-testid="settings-panel">
      <div className="ins-scroll">
        <section className="ins-section">
          <h5 className="static"><KeyRound size={13} /> AI agent · API key</h5>
          <div className="ins-body">
            <p className="hint">
              The agent uses <b>OpenRouter</b> (model <code>{settings?.model || '…'}</code>). Create a key at{' '}
              <a onClick={() => window.studio.openExternal?.('https://openrouter.ai/keys')}>openrouter.ai/keys <ExternalLink size={10} /></a>
            </p>
            <div className={`set-keystate ${key?.set ? 'on' : ''}`} data-testid="settings-key-state">
              {key?.set ? (
                <>
                  <Check size={13} />
                  <span>
                    <code>{key.masked}</code> <span className="muted">{SOURCE_LABEL[key.source || ''] || ''}</span>
                  </span>
                </>
              ) : (
                <span className="muted">No key yet — the agent is disabled.</span>
              )}
            </div>
            <div className="set-keyrow">
              <input
                type={show ? 'text' : 'password'}
                placeholder={key?.set ? 'Paste a new key to replace it' : 'sk-or-v1-…'}
                value={draft}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => { setDraft(e.target.value); setErr(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) saveKey(draft.trim()); }}
                data-testid="settings-key-input"
              />
              <button className="mini text" onClick={() => setShow(!show)} title={show ? 'Hide' : 'Show'}>{show ? 'Hide' : 'Show'}</button>
            </div>
            {err && <div className="hint warn" data-testid="settings-key-error">{err}</div>}
            <div className="set-btns">
              <button className="btn small primary" disabled={!draft.trim()} onClick={() => saveKey(draft.trim())} data-testid="settings-key-save">Save key</button>
              <button className="btn small" disabled={!key?.set && !draft.trim()} onClick={() => runTest(draft.trim() || undefined)} data-testid="settings-key-test">
                {test.state === 'testing' ? 'Testing…' : 'Test'}
              </button>
              {key?.source === 'settings' && (
                <button className="btn small ghost" onClick={() => saveKey(null)} data-testid="settings-key-remove">Remove</button>
              )}
            </div>
            {test.state === 'ok' && <div className="set-test ok" data-testid="settings-key-test-result"><Check size={12} /> {test.text}</div>}
            {test.state === 'bad' && <div className="set-test bad" data-testid="settings-key-test-result"><X size={12} /> {test.text}</div>}
            <p className="hint faint-hint">Stored only on this computer{settings?.file ? <> in <code className="set-path">{settings.file}</code></> : null} (readable by your user only).</p>
          </div>
        </section>

        <section className="ins-section">
          <h5 className="static"><Gauge size={13} /> Preview quality</h5>
          <div className="ins-body">
            <div className="set-gl" data-testid="settings-gl">
              {gl?.software ? <Cpu size={14} /> : <MonitorCog size={14} />}
              <div>
                <div>
                  {gl ? (gl.software ? 'Software rendering (CPU)' : gl.software === false ? 'GPU rendering' : 'Renderer unknown') : 'Waiting for the engine…'}
                </div>
                {gl?.renderer && <div className="muted small set-glname">{gl.renderer}{gl.version ? ` · OpenGL ${gl.version.split(' ')[0]}` : ''}</div>}
              </div>
            </div>
            <div className="set-quality" role="radiogroup">
              {QUALITY_ORDER.map((q) => {
                const p = q === 'auto' ? null : QUALITY_PRESETS[q];
                return (
                  <button
                    key={q}
                    role="radio"
                    aria-checked={quality === q}
                    className={quality === q ? 'on' : ''}
                    onClick={() => setQuality(q)}
                    data-testid={`settings-quality-${q}`}
                  >
                    <b>{p ? p.label : 'Auto'}</b>
                    <span>{p ? p.note : `Picks ${QUALITY_PRESETS[effectiveQuality('auto', gl)].label} for this machine.`}</span>
                  </button>
                );
              })}
            </div>
            <p className="hint" data-testid="settings-quality-now">
              Preview: up to {QUALITY_PRESETS[eff].idle} px wide when still, {QUALITY_PRESETS[eff].moving} px while playing or dragging.
              {meta?.w ? <> Last frame {meta.w}×{meta.h}{typeof meta.ms === 'number' ? ` in ${Math.round(meta.ms)} ms` : ''}.</> : null}
            </p>
            <p className="hint faint-hint">Video export always renders at the resolution chosen in the Export dialog — on a CPU that is slower, not lower quality.</p>
          </div>
        </section>

        <UpdatesSection />
      </div>
    </div>
  );
}
