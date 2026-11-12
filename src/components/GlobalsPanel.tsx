// "Globals" panel under the library: project-wide constants (fonts, sizes, spacing, colours…).
// Clip code reads them by name and template params can be linked to them, so changing one value
// here restyles every element that uses it. The AI agent creates and uses them too.
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Plus, Variable, X } from 'lucide-react';
import { useStore } from '../store';
import type { GlobalType, GlobalVar } from '../types';
import { FONTS, GLOBAL_TYPES, deleteGlobal, globalUsage, isGlobalName, newGlobal, renameGlobal, sanitizeGlobalName } from '../globals';
import { MANIM_COLORS } from './fields';

const st = () => useStore.getState();

/** Popups are position: fixed above their trigger, so no scrolling / clipped panel can hide them. */
function above(el: HTMLElement | null, align: 'left' | 'right' = 'left'): React.CSSProperties {
  const r = el?.getBoundingClientRect();
  if (!r) return {};
  return {
    position: 'fixed',
    bottom: window.innerHeight - r.top + 4,
    ...(align === 'left' ? { left: r.left } : { right: window.innerWidth - r.right }),
  };
}

/** One undo step per gesture: checkpoint on begin, transient commits while it lasts. */
function setValue(id: string, v: any) {
  st().commit((p) => {
    const g = (p.globals || []).find((x) => x.id === id);
    if (g) g.value = v;
  }, { transient: true });
}

function fmt(v: number) {
  return Number.isFinite(v) ? String(Number(v.toFixed(4))) : '0';
}

function NumberValue({ g }: { g: GlobalVar }) {
  const v = Number(g.value) || 0;
  const [text, setText] = useState(fmt(v));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(fmt(v)); }, [v, focused]);
  // step follows the magnitude: 0.3 spacing moves by 0.05, 36 pt font by 1
  const step = Math.abs(v) >= 10 || (Number.isInteger(v) && Math.abs(v) >= 2) ? 1 : 0.05;
  const scrub = (e: React.PointerEvent) => {
    e.preventDefault();
    const sx = e.clientX;
    let started = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      if (!started) {
        if (Math.abs(dx) < 2) return;
        started = true;
        st().checkpoint();
        document.body.classList.add('scrubbing');
      }
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      setValue(g.id, Number((v + Math.round(dx / 4) * step * mult).toFixed(6)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('scrubbing');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const commitText = () => {
    let n: number;
    try {
      const expr = text.replace(/pi/gi, String(Math.PI)).replace(/[^-+*/().\d\se]/g, '');
      n = Function(`"use strict"; return (${expr || '0'})`)();
    } catch {
      n = Number(text);
    }
    if (Number.isFinite(n) && n !== v) {
      st().checkpoint();
      setValue(g.id, n);
    } else setText(fmt(v));
  };
  return (
    <div className="gv-num">
      <span className="gv-scrub" onPointerDown={scrub} title="Drag to change (⇧ ×10, ⌥ ×0.1)">↔</span>
      <input
        data-testid={`global-value-${g.name}`}
        value={text}
        onFocus={(e) => { setFocused(true); e.target.select(); }}
        onBlur={() => { setFocused(false); commitText(); }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
            const n = Number((v + (e.key === 'ArrowUp' ? 1 : -1) * step * mult).toFixed(6));
            st().checkpoint();
            setValue(g.id, n);
            setText(fmt(n));
          }
        }}
      />
    </div>
  );
}

function TextValue({ g, list }: { g: GlobalVar; list?: string }) {
  const [text, setText] = useState(String(g.value ?? ''));
  useEffect(() => setText(String(g.value ?? '')), [g.value]);
  const commit = () => {
    if (text === String(g.value ?? '')) return;
    st().checkpoint();
    setValue(g.id, text);
  };
  return (
    <input
      className="gv-text"
      data-testid={`global-value-${g.name}`}
      list={list}
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function ColorValue({ g }: { g: GlobalVar }) {
  const v = String(g.value || '#FFFFFF');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="gv-color" ref={ref}>
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(v) ? v : '#ffffff'} onFocus={() => st().checkpoint()} onChange={(e) => setValue(g.id, e.target.value.toUpperCase())} data-testid={`global-value-${g.name}`} />
      <button className="gv-hex" onClick={() => setOpen(!open)} title="Manim palette">{v.toUpperCase()}</button>
      {open && (
        <div className="gv-palette" style={above(ref.current)} onMouseLeave={() => setOpen(false)}>
          {MANIM_COLORS.map(([n, c]) => (
            <button key={n} title={n} style={{ background: c }} onClick={() => { st().checkpoint(); setValue(g.id, c); setOpen(false); }} />
          ))}
        </div>
      )}
    </div>
  );
}

function Value({ g }: { g: GlobalVar }) {
  switch (g.type) {
    case 'number':
      return <NumberValue g={g} />;
    case 'color':
      return <ColorValue g={g} />;
    case 'font':
      return <TextValue g={g} list="ms-font-list" />;
    case 'bool':
      return (
        <button className={`switch ${g.value ? 'on' : ''}`} data-testid={`global-value-${g.name}`} onClick={() => { st().checkpoint(); setValue(g.id, !g.value); }}>
          <span />
        </button>
      );
    default:
      return <TextValue g={g} />;
  }
}

function NameInput({ g }: { g: GlobalVar }) {
  const [text, setText] = useState(g.name);
  useEffect(() => setText(g.name), [g.name]);
  const commit = () => {
    const name = sanitizeGlobalName(text);
    const p = st().project;
    if (!name || name === g.name) return setText(g.name);
    if ((p.globals || []).some((x) => x.name === name && x.id !== g.id)) {
      st().toast(`A global named ${name} already exists`, 'error');
      return setText(g.name);
    }
    st().commit((pp) => renameGlobal(pp, g.name, name));
  };
  return (
    <input
      className="gv-name"
      data-testid={`global-name-${g.name}`}
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value.toUpperCase())}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setText(g.name); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
}

const TYPE_GLYPH: Record<GlobalType, string> = { number: '#', color: '●', font: 'Aa', text: 'T', bool: '◐' };

function Row({ g, error }: { g: GlobalVar; error?: string }) {
  const project = useStore((s) => s.project);
  const used = globalUsage(project, g.name);
  return (
    <div className={`gv-row ${error ? 'err' : ''}`} data-testid="global-row" title={[g.note, error].filter(Boolean).join('\n') || undefined}>
      <span className={`gv-type t-${g.type}`} style={g.type === 'color' ? { color: g.value } : undefined}>{TYPE_GLYPH[g.type] || '#'}</span>
      <NameInput g={g} />
      <div className="gv-value"><Value g={g} /></div>
      <button
        className={`gv-uses ${used.length ? '' : 'none'}`}
        title={used.length ? `Used by ${used.map((c) => c.name).join(', ')} — click to select` : 'Not used yet'}
        onClick={() => used.length && st().select(used.map((c) => c.id))}
      >
        {used.length}
      </button>
      <button
        className="gv-del"
        title="Delete (linked params keep the current value)"
        data-testid={`global-del-${g.name}`}
        onClick={() => st().commit((p) => deleteGlobal(p, g.name))}
      >
        <X size={12} />
      </button>
      {error && <div className="gv-note err">{error}</div>}
    </div>
  );
}

export default function GlobalsPanel({ height, collapsed, onToggle }: { height: number; collapsed: boolean; onToggle: () => void }) {
  const globals = useStore((s) => s.project.globals) || [];
  const errors = useStore((s) => s.meta?.global_errors) || {};
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!adding) return;
    const off = (e: MouseEvent) => { if (!addRef.current?.contains(e.target as Node)) setAdding(false); };
    window.addEventListener('mousedown', off);
    return () => window.removeEventListener('mousedown', off);
  }, [adding]);

  const add = (type: GlobalType) => {
    setAdding(false);
    if (collapsed) onToggle();
    let name = '';
    st().commit((p) => {
      const g = newGlobal(p, type);
      name = g.name;
      p.globals = [...(p.globals || []), g];
    });
    // focus the new name so it can be typed right away
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(`[data-testid="global-name-${name}"]`);
      el?.focus();
      el?.select();
    }, 30);
  };

  return (
    <section className={`panel globals ${collapsed ? 'collapsed' : ''}`} style={collapsed ? undefined : { height }} data-testid="globals-panel">
      <div className="globals-head">
        <button className="globals-title" onClick={onToggle} data-testid="globals-toggle">
          <ChevronRight size={12} className={`chev ${collapsed ? '' : 'open'}`} />
          <Variable size={13} /> Globals <small>{globals.length}</small>
        </button>
        <div className="globals-add" ref={addRef}>
          <button className="mini" title="Add a global" data-testid="globals-add" onClick={() => setAdding(!adding)}>
            <Plus size={13} />
          </button>
          {adding && (
            <div className="globals-menu" style={above(addRef.current, 'right')}>
              {GLOBAL_TYPES.map((t) => (
                <button key={t.id} data-testid={`globals-add-${t.id}`} onClick={() => add(t.id)}>
                  <span className={`gv-type t-${t.id}`}>{TYPE_GLYPH[t.id]}</span> {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {!collapsed && (
        <div className="globals-list">
          {globals.map((g) => <Row key={g.id} g={g} error={errors[g.name]} />)}
          {Object.entries(errors).filter(([n]) => !globals.some((g) => g.name === n)).map(([n, e]) => (
            <div key={n} className="gv-note err">{n}: {e}</div>
          ))}
          {!globals.length && (
            <div className="globals-empty">
              Shared values — fonts, font sizes, spacing, colours — that the whole scene uses. Change one here and every element that reads it updates. Code uses them by name (e.g. <code>FONT_SIZE</code>); the AI agent creates and uses them too.
            </div>
          )}
          {globals.some((g) => !isGlobalName(g.name)) && <div className="gv-note err">Names must be Python identifiers.</div>}
        </div>
      )}
      <datalist id="ms-font-list">
        {FONTS.map((f) => <option key={f} value={f} />)}
      </datalist>
    </section>
  );
}
