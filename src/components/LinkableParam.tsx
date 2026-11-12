import { useEffect, useRef, useState } from 'react';
import { Link2, Unlink } from 'lucide-react';
import { useStore } from '../store';
import type { Asset, GlobalType, ParamDef } from '../types';
import { linkable, linkedGlobal, newGlobal } from '../globals';
import { ParamField, type FieldHooks } from './fields';

// ---------------------------------------------------------------------------- params linked to globals
/** A template param that can be driven by a project global (Globals panel, under the library). */
export default function LinkableParam({ def, value, assets, hooks }: { def: ParamDef; value: any; assets: Asset[]; hooks: FieldHooks }) {
  const globals = useStore((s) => s.project.globals) || [];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', off);
    return () => window.removeEventListener('mousedown', off);
  }, [open]);
  const linked = linkedGlobal(value);
  const choices = globals.filter((g) => linkable(def.type, g.type));
  const canLink = def.type !== 'asset' && (def.type !== 'select' || /font/i.test(def.id));
  if (linked) {
    const g = globals.find((x) => x.name === linked);
    return (
      <div className="field linked" data-testid={`param-linked-${def.id}`}>
        <label title={`Linked to the global ${linked}`}>{def.label}</label>
        <div className={`linked-chip ${g ? '' : 'missing'}`} title={g ? 'Change it in the Globals panel (under the library)' : `No global named ${linked}`}>
          <Link2 size={11} />
          <span>{linked}</span>
          {g && g.type === 'color' ? <span className="sw" style={{ background: g.value }} /> : null}
          <span className="val">{g ? (g.type === 'color' ? '' : `= ${String(g.value)}`) : 'missing'}</span>
          <button
            title="Unlink (keeps the current value)"
            data-testid={`param-unlink-${def.id}`}
            onClick={() => { hooks.onBegin(); hooks.onChange(g ? g.value : def.default); }}
          >
            <Unlink size={11} />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="param-link-wrap" ref={ref}>
      <ParamField def={def} value={value} assets={assets} hooks={hooks} />
      {canLink && (
        <button className={`param-link-btn ${open ? 'open' : ''}`} title="Link to a global" data-testid={`param-link-${def.id}`} onClick={() => setOpen(!open)}>
          <Link2 size={11} />
        </button>
      )}
      {open && (
        <div className="param-link-menu">
          <div className="hd">Link to global</div>
          {choices.map((g) => (
            <button key={g.id} onClick={() => { setOpen(false); hooks.onBegin(); hooks.onChange({ $g: g.name }); }}>
              {g.name} <small>{g.type === 'color' ? g.value : String(g.value)}</small>
            </button>
          ))}
          <button
            data-testid={`param-promote-${def.id}`}
            onClick={() => {
              // create a global from this param's current value and link to it
              setOpen(false);
              const gt: GlobalType = def.type === 'color' ? 'color' : def.type === 'bool' ? 'bool' : def.type === 'number' || def.type === 'int' ? 'number' : def.id.includes('font') ? 'font' : 'text';
              const st = useStore.getState();
              let name = '';
              st.checkpoint();
              st.commit((p) => {
                const g = newGlobal(p, gt, def.id, value ?? def.default);
                name = g.name;
                p.globals = [...(p.globals || []), g];
              }, { transient: true });
              hooks.onChange({ $g: name });
            }}
          >
            <span>+ New global from this value</span>
          </button>
        </div>
      )}
    </div>
  );
}

