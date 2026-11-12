// Parameters of a clip with custom code: fonts, sizes, colours, strokes and constants read from the
// code itself (engine/code_knobs.py). Editing a field rewrites the code; nothing is "detached".
import { useRef } from 'react';
import { AlertTriangle, Code2, Palette, Shapes, SlidersHorizontal, Type } from 'lucide-react';
import { editClipCode, getClip, useStore } from '../store';
import type { Clip, ParamDef } from '../types';
import { FONTS } from '../globals';
import { knobsFor, partKnobs, setKnob, useCodeKnobs, type Knob, type KnobEdit } from '../knobs';
import type { FieldHooks } from './fields';
import LinkableParam from './LinkableParam';

const WEIGHT_LABELS: Record<string, string> = {
  THIN: 'Thin', ULTRALIGHT: 'Ultralight', LIGHT: 'Light', BOOK: 'Book', NORMAL: 'Regular', MEDIUM: 'Medium',
  SEMIBOLD: 'Semibold', BOLD: 'Bold', ULTRABOLD: 'Extra bold', HEAVY: 'Heavy',
};
const SLANT_LABELS: Record<string, string> = { NORMAL: 'Upright', ITALIC: 'Italic', OBLIQUE: 'Oblique' };

const slug = (s: string) => s.replace(/[“”…×]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();

/** ParamDef for a knob, so it renders (and links to globals) exactly like a template param. */
function knobDef(k: Knob, label: string, idHint: string): ParamDef {
  const id = idHint;
  switch (k.kind) {
    case 'font': {
      const v = String(k.value ?? '');
      const opts = ['', ...FONTS];
      if (v && !opts.includes(v)) opts.push(v);
      return { id, label, type: 'select', default: '', options: opts, labels: { '': 'Default' } };
    }
    case 'weight':
      return { id, label, type: 'select', default: 'NORMAL', options: k.options || [], labels: WEIGHT_LABELS };
    case 'slant':
      return { id, label, type: 'select', default: 'NORMAL', options: k.options || [], labels: SLANT_LABELS };
    case 'font_size':
      return { id, label, type: 'number', default: 48, min: 1, step: 1 };
    case 'number':
      return { id, label, type: 'number', default: 0, min: k.min ?? null, max: k.max ?? null, step: k.step ?? 0.1 };
    case 'color':
      return { id, label, type: 'color', default: '#FFFFFF' };
    case 'bool':
      return { id, label, type: 'bool', default: false };
    case 'latex':
      return { id, label, type: 'latex', default: '' };
    default:
      return { id, label, type: 'text', default: '' };
  }
}

/**
 * Field hooks that rewrite the clip's code. A change always starts from the code (and knob spans)
 * as they were when the edit began, so a drag never applies spans to code they don't match.
 */
function useKnobHooks(clipId: string) {
  const snap = useRef<{ code: string; knobs: Knob[]; last: string } | null>(null);
  const st = useStore.getState;
  const take = () => {
    const code = getClip(clipId)?.code || '';
    const knobs = knobsFor(code);
    snap.current = knobs ? { code, knobs, last: code } : null;
  };
  return (knobId: string, pick?: (k: Knob) => KnobEdit[] | undefined): FieldHooks => ({
    onBegin: () => {
      st().checkpoint();
      take();
    },
    onChange: (v) => {
      const cur = getClip(clipId)?.code || '';
      if (!snap.current || (cur !== snap.current.code && cur !== snap.current.last)) take();
      const s = snap.current;
      if (!s) return; // knobs for this code not loaded yet
      const k = s.knobs.find((x) => x.id === knobId);
      if (!k) return;
      const edits = pick ? pick(k) : k.edits;
      if (!edits?.length) return;
      const next = setKnob(s.code, s.knobs, k, v, edits);
      s.last = next;
      st().commit((p) => {
        const c = p.clips.find((c) => c.id === clipId);
        if (c) c.code = next;
      }, { transient: true });
    },
  });
}

function KnobField({ clip, k, label, hooksFor, idHint }: { clip: Clip; k: Knob; label: string; hooksFor: ReturnType<typeof useKnobHooks>; idHint: string }) {
  const assets = useStore((s) => s.project.assets);
  const def = knobDef(k, label, idHint);
  const value = k.linked ? { $g: k.linked } : k.value ?? def.default;
  const tip = [k.where && `Used by ${k.where}`, k.name && `Sets ${k.name} in the code`, k.note, k.default && 'Not set in the code yet — ManimGL default'].filter(Boolean).join(' · ');
  return (
    <div className={`knob ${k.default ? 'is-default' : ''}`} title={tip} data-testid={`knob-${idHint}`} data-clip={clip.id}>
      <LinkableParam def={def} value={value} assets={assets} hooks={hooksFor(k.id)} />
    </div>
  );
}

const GROUPS: { id: Knob['group']; title: string; icon: any }[] = [
  { id: 'text', title: 'Text', icon: <Type size={11} /> },
  { id: 'color', title: 'Colors', icon: <Palette size={11} /> },
  { id: 'shape', title: 'Shape', icon: <Shapes size={11} /> },
  { id: 'value', title: 'Values in the code', icon: <SlidersHorizontal size={11} /> },
];

function labelFor(k: Knob, all: Knob[]): { label: string; id: string } {
  const sameKind = all.filter((x) => x.kind === k.kind);
  const who = k.where ? k.where : '';
  switch (k.kind) {
    case 'string':
    case 'latex':
      return { label: who ? `${k.label} · ${who}` : k.label, id: `${k.kind === 'latex' ? 'latex' : 'text'}-${slug(who) || sameKind.indexOf(k)}` };
    case 'font':
    case 'font_size':
    case 'weight':
    case 'slant': {
      const base = { font: 'Font', font_size: 'Font size', weight: 'Weight', slant: 'Style' }[k.kind];
      const many = sameKind.length > 1;
      return { label: many && who ? `${base} · ${who}` : base, id: many ? `${k.kind}-${slug(who) || sameKind.indexOf(k)}` : k.kind };
    }
    case 'color':
      return { label: who || 'Color', id: `${slug(who) || 'c' + sameKind.indexOf(k)}_color` };
    case 'number':
      if (k.group === 'value') return { label: k.note ? `${k.label} · ${k.note}` : k.label, id: k.label };
      return { label: sameKind.filter((x) => x.label === k.label).length > 1 && who ? `${k.label} · ${who}` : k.label, id: `${slug(k.label)}${who ? '-' + slug(who) : ''}` };
    default:
      return { label: k.label, id: slug(k.label) || k.id };
  }
}

export default function CodeKnobs({ clip, onReset }: { clip: Clip; onReset?: () => void }) {
  const { knobs, error, ready } = useCodeKnobs(clip.id, clip.code);
  const hooksFor = useKnobHooks(clip.id);
  const groups = GROUPS.map((g) => ({ ...g, knobs: knobs.filter((k) => k.group === g.id) })).filter((g) => g.knobs.length);
  return (
    <div className="code-knobs" data-testid="code-knobs" data-ready={ready ? '1' : '0'}>
      <div className="knobs-head">
        <span className="muted small"><Code2 size={11} /> Custom code — these fields edit it for you</span>
        <span className="spacer" />
        <button className="btn small ghost" onClick={() => editClipCode(clip.id)}>Edit code</button>
        {onReset && <button className="btn small ghost" onClick={onReset} title="Throw the custom code away and go back to the template's parameters">Reset</button>}
      </div>
      {error && (
        <div className="hint warn"><AlertTriangle size={11} /> The code doesn't parse ({error}), so the fields can't read it. Fix it in the code editor.</div>
      )}
      {!error && ready && !knobs.length && <div className="hint">Nothing standard to tune in this code (no fonts, sizes, colours or constants written as plain values).</div>}
      <fieldset disabled={!ready} className="knob-groups">
        {groups.map((g) => (
          <div key={g.id} className={`knob-group g-${g.id}`} data-group={g.id}>
            <div className="knob-group-title">{g.icon} {g.title}</div>
            {g.knobs.map((k) => {
              const { label, id } = labelFor(k, knobs);
              return <KnobField key={k.id} clip={clip} k={k} label={label} idHint={id} hooksFor={hooksFor} />;
            })}
          </div>
        ))}
      </fieldset>
    </div>
  );
}

/** Style of one part (Parts section): the knobs whose use belongs to the part's variable. */
export function PartStyle({ clip, label }: { clip: Clip; label: string | null | undefined }) {
  const { knobs, ready } = useCodeKnobs(clip.id, clip.code);
  const hooksFor = useKnobHooks(clip.id);
  if (!clip.code || !label) return null;
  const mine = partKnobs(knobs, label);
  if (!mine.length) return null;
  const order: Record<string, number> = { string: 0, latex: 0, font: 1, font_size: 2, color: 3 };
  mine.sort((a, b) => order[a.knob.kind] - order[b.knob.kind]);
  return (
    <fieldset className="part-style" disabled={!ready} data-testid="part-style">
      <div className="knob-group-title"><Type size={11} /> Style of “{label}”</div>
      {mine.map(({ knob, occ }) => {
        const shared = knob.occ.length > 1 || (occ.own && knob.name);
        const lbl = knob.kind === 'color' ? 'Color' : knob.kind === 'font_size' ? 'Font size' : knob.kind === 'font' ? 'Font' : knob.label;
        const def = knobDef(knob, lbl, `part-${knob.kind}`);
        const pick = (k: Knob) => {
          const o = k.occ.find((x) => x.ctx === label);
          return o ? o.own || o.edits : undefined;
        };
        const hooks = hooksFor(knob.id, pick);
        return (
          <div key={knob.id} className="knob" title={shared ? `Shared with ${knob.where}${knob.name ? ` (${knob.name})` : ''} — changing it here changes only “${label}”` : undefined} data-testid={`part-knob-${knob.kind}`}>
            <PartField def={def} value={knob.linked && !occ.own ? { $g: knob.linked } : knob.value ?? def.default} hooks={hooks} />
          </div>
        );
      })}
    </fieldset>
  );
}

function PartField({ def, value, hooks }: { def: ParamDef; value: any; hooks: FieldHooks }) {
  const assets = useStore((s) => s.project.assets);
  return <LinkableParam def={def} value={value} assets={assets} hooks={hooks} />;
}
