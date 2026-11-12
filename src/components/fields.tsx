import { useEffect, useRef, useState } from 'react';
import type { Asset, ParamDef } from '../types';
import { fileUrl } from '../engine';

export const MANIM_COLORS: [string, string][] = [
  ['WHITE', '#FFFFFF'], ['GREY_B', '#BBBBBB'], ['GREY', '#888888'], ['BLUE', '#58C4DD'], ['BLUE_E', '#1C758A'],
  ['TEAL', '#5CD0B3'], ['GREEN', '#83C167'], ['YELLOW', '#FFFF00'], ['GOLD', '#F0AC5F'], ['ORANGE', '#FF862F'],
  ['RED', '#FC6255'], ['MAROON', '#C55F73'], ['PINK', '#D147BD'], ['PURPLE', '#9A72AC'], ['BLACK', '#000000'],
];

export interface FieldHooks {
  onBegin: () => void; // called once before a series of live changes (one undo step)
  onChange: (v: any) => void; // live, transient change
}

function fmt(v: number, step = 0.1) {
  if (!Number.isFinite(v)) return '0';
  const d = step >= 1 ? 0 : step >= 0.1 ? 2 : step >= 0.01 ? 3 : 4;
  return String(Number(v.toFixed(d)));
}

export function NumberField({ label, value, step = 0.1, min, max, onBegin, onChange, suffix, testid }: { label: string; value: number; step?: number; min?: number | null; max?: number | null; suffix?: string; testid?: string } & FieldHooks) {
  const [text, setText] = useState(fmt(value, step));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(value, step));
  }, [value, focused, step]);
  const clamp = (v: number) => {
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    return v;
  };
  const commitText = () => {
    let v: number;
    try {
      // allow small arithmetic like "2*pi" or "1/3"
      const expr = text.replace(/pi/gi, String(Math.PI)).replace(/[^-+*/().\d\se]/g, '');
      v = Function(`"use strict"; return (${expr || '0'})`)();
    } catch {
      v = Number(text);
    }
    if (Number.isFinite(v)) {
      onBegin();
      onChange(clamp(v));
    } else setText(fmt(value, step));
  };
  const scrub = (e: React.PointerEvent) => {
    e.preventDefault();
    const sx = e.clientX;
    const v0 = value;
    let started = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      if (!started) {
        if (Math.abs(dx) < 2) return;
        started = true;
        onBegin();
        document.body.classList.add('scrubbing');
      }
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const v = clamp(v0 + Math.round(dx / 3) * step * mult);
      onChange(Number(v.toFixed(6)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('scrubbing');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="field num">
      <label onPointerDown={scrub} title="Drag to change (⇧ ×10, ⌥ ×0.1)">{label}</label>
      <div className="num-wrap">
        <input
          data-testid={testid}
          value={text}
          onFocus={(e) => {
            setFocused(true);
            e.target.select();
          }}
          onBlur={() => {
            setFocused(false);
            commitText();
          }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
              const v = clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * step * mult);
              onBegin();
              onChange(Number(v.toFixed(6)));
              setText(fmt(v, step));
            }
          }}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
    </div>
  );
}

export function ColorField({ label, value, onBegin, onChange }: { label: string; value: string } & FieldHooks) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  useEffect(() => setText(value), [value]);
  return (
    <div className="field color">
      <label>{label}</label>
      <div className="color-row">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onFocus={onBegin} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <input
          className="hex"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = text.startsWith('#') ? text : `#${text}`;
            if (/^#[0-9a-f]{6}$/i.test(v)) {
              onBegin();
              onChange(v.toUpperCase());
            } else setText(value);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <button className="mini" onClick={() => setOpen(!open)} title="Manim palette">▾</button>
      </div>
      {open && (
        <div className="palette">
          {MANIM_COLORS.map(([n, c]) => (
            <button
              key={n}
              title={n}
              style={{ background: c }}
              className={c.toUpperCase() === value.toUpperCase() ? 'on' : ''}
              onClick={() => {
                onBegin();
                onChange(c);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TextField({ label, value, multiline, mono, onBegin, onChange, hint, testid, debounce = 0 }: { label: string; value: string; multiline?: boolean; mono?: boolean; hint?: string; testid?: string; debounce?: number } & FieldHooks) {
  const [text, setText] = useState(value ?? '');
  const focused = useRef(false);
  const timer = useRef<any>(null);
  useEffect(() => {
    if (!focused.current) setText(value ?? '');
  }, [value]);
  const push = (v: string) => {
    clearTimeout(timer.current);
    if (debounce) timer.current = setTimeout(() => onChange(v), debounce);
    else onChange(v);
  };
  const props = {
    value: text,
    spellCheck: false,
    'data-testid': testid,
    className: mono ? 'mono' : '',
    onFocus: () => {
      focused.current = true;
      onBegin();
    },
    onBlur: () => {
      focused.current = false;
      clearTimeout(timer.current);
      if (text !== value) onChange(text);
    },
    onChange: (e: any) => {
      setText(e.target.value);
      push(e.target.value);
    },
  };
  return (
    <div className={`field text ${multiline ? 'multi' : ''}`}>
      <label>{label}</label>
      {multiline ? <textarea rows={Math.min(8, Math.max(2, (text.match(/\n/g)?.length || 0) + 1))} {...props} /> : <input {...props} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function BoolField({ label, value, onBegin, onChange }: { label: string; value: boolean } & FieldHooks) {
  return (
    <div className="field bool">
      <label>{label}</label>
      <button
        className={`switch ${value ? 'on' : ''}`}
        onClick={() => {
          onBegin();
          onChange(!value);
        }}
      >
        <span />
      </button>
    </div>
  );
}

export function SelectField({ label, value, options, onBegin, onChange, labels }: { label: string; value: string; options: string[]; labels?: Record<string, string> } & FieldHooks) {
  return (
    <div className="field select">
      <label>{label}</label>
      <select
        value={value}
        onChange={(e) => {
          onBegin();
          onChange(e.target.value);
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {labels?.[o] ?? o}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AssetField({ label, value, assets, kind, onBegin, onChange }: { label: string; value: string; assets: Asset[]; kind: string } & FieldHooks) {
  const list = assets.filter((a) => a.kind === kind);
  return (
    <div className="field asset">
      <label>{label}</label>
      <div className="asset-row">
        {value && <img src={fileUrl(value)} alt="" />}
        <select
          value={value}
          onChange={(e) => {
            onBegin();
            onChange(e.target.value);
          }}
        >
          {!list.find((a) => a.name === value) && <option value={value}>{value || '—'}</option>}
          {list.map((a) => (
            <option key={a.id} value={a.name}>{a.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function ParamField({ def, value, assets, hooks, autoFocus }: { def: ParamDef; value: any; assets: Asset[]; hooks: FieldHooks; autoFocus?: boolean }) {
  const v = value ?? def.default;
  switch (def.type) {
    case 'number':
    case 'int':
      return <NumberField label={def.label} value={Number(v)} step={def.type === 'int' ? 1 : def.step ?? 0.1} min={def.min} max={def.max} {...hooks} testid={`param-${def.id}`} />;
    case 'color':
      return <ColorField label={def.label} value={String(v)} {...hooks} />;
    case 'bool':
      return <BoolField label={def.label} value={!!v} {...hooks} />;
    case 'select':
      return <SelectField label={def.label} value={String(v)} options={def.options || []} labels={def.labels} {...hooks} />;
    case 'latex':
      return <TextField label={def.label} value={String(v)} mono multiline={String(v).includes('\n') || String(v).length > 28} {...hooks} debounce={350} testid={`param-${def.id}`} hint="LaTeX (math mode)" />;
    case 'expr':
      return <TextField label={def.label} value={String(v)} mono {...hooks} debounce={300} hint={def.hint} testid={`param-${def.id}`} />;
    case 'asset':
      return <AssetField label={def.label} value={String(v)} assets={assets} kind={def.accept || 'image'} {...hooks} />;
    default:
      return <TextField label={def.label} value={String(v)} multiline={def.multiline} {...hooks} debounce={120} testid={`param-${def.id}`} />;
  }
}
