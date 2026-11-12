import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap } from '@codemirror/view';
import { editClipCode, useStore, itemById } from '../store';
import { fetchClipSource } from '../engine';
import { addKeyAt, CAMERA_ID, cameraAt, selectedMorph, CATEGORY_COLORS, isFlat, joinMorphTrack, keyAt, resolveOverlap, round, setCameraAt, setTransformAt, transformAt } from '../ops';
import { fitNav, lookPreset } from '../nav';
import { VIEW_PRESETS } from '../view3d';
import type { Clip, Project, Transform } from '../types';
import { evalLayout, layoutProblems } from '../globals';
import { ColorField, NumberField, SelectField, TextField, type FieldHooks } from './fields';
import LinkableParam from './LinkableParam';
import CodeKnobs, { PartStyle } from './CodeKnobs';
import { deleteSelection, duplicateSelection, removeTransform } from '../actions';
import AnimPicker from './AnimPicker';
import { exitWindow, isMorph, useClipThumb } from '../clipThumbs';
import { findNode, hasOffset, isGroupTree, movePart, openKey, partName, partTiming, resetPart, setPart, staggerParts, timedParts, useClipParts } from '../parts';
import { AnimIcon, CategoryIcon } from '../icons';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical,
  ChevronLeft, ChevronRight, Clapperboard, Diamond, ListTree, LogIn, LogOut, Move, RotateCcw, SlidersHorizontal, Sparkles,
  Trash2, Video, X, AlertTriangle, Copy, Link2, Unlink, Shuffle, ArrowRight,
} from 'lucide-react';

const FW = 14.222222222222221;
const FH = 8;

function useClipEdit(id: string) {
  const st = useStore.getState;
  return {
    begin: () => st().checkpoint(),
    edit: (fn: (c: Clip, p: Project) => void) =>
      st().commit((p) => {
        const c = p.clips.find((c) => c.id === id);
        if (c) fn(c, p);
      }, { transient: true }),
  };
}

function Section({ title, children, right, icon, id, signal = 0, mark, defaultOpen = false }: {
  title: string; children: any; right?: any; icon?: any; id?: string;
  /** start expanded (the camera's view and waypoints are what you came for) */
  defaultOpen?: boolean;
  /** non-zero and changing: open this section and scroll it into view */
  signal?: number;
  /** effect id to scroll to once the section is open */
  mark?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (signal) setOpen(true);
  }, [signal]);
  useEffect(() => {
    if (!signal || !open) return;
    const target = (mark && ref.current?.querySelector(`[data-effect="${mark}"]`)) || ref.current;
    target?.scrollIntoView({ block: 'nearest' });
  }, [signal, open, mark]);
  return (
    <section className="ins-section" ref={ref} data-section={id}>
      <h5 onClick={() => setOpen(!open)}>
        <span className={`chev ${open ? 'open' : ''}`}>›</span> {icon} {title}
        <span className="spacer" />
        <span onClick={(e) => e.stopPropagation()}>{right}</span>
      </h5>
      {open && <div className="ins-body">{children}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------- scene settings
function SceneSettings() {
  const settings = useStore((s) => s.project.settings);
  const clips = useStore((s) => s.project.clips.length);
  const st = useStore.getState;
  const set = (k: keyof Project['settings']): FieldHooks => ({
    onBegin: () => st().checkpoint(),
    onChange: (v) => st().commit((p) => { (p.settings as any)[k] = v; }, { transient: true }),
  });
  return (
    <div className="ins-scroll">
      <div className="ins-title">
        <div className="ins-icon" style={{ background: '#2a2d35' }}><Clapperboard size={18} /></div>
        <div>
          <div className="ins-name static">Scene</div>
          <div className="muted small">{clips} clip{clips === 1 ? '' : 's'} · nothing selected</div>
        </div>
      </div>
      <Section icon={<Clapperboard size={13} />} title="Scene">
        <TextField label="Name" value={settings.name} {...set('name')} />
        <ColorField label="Background" value={settings.background} {...set('background')} />
        <NumberField label="Duration" value={settings.duration} step={0.5} min={0.5} suffix="s" {...set('duration')} />
        <SelectField label="Frame rate" value={String(settings.fps)} options={['15', '24', '25', '30', '50', '60']} onBegin={() => st().checkpoint()} onChange={(v) => st().commit((p) => { p.settings.fps = Number(v); }, { transient: true })} />
      </Section>
      <Section icon={<Sparkles size={13} />} title="Getting started">
        <ul className="tips">
          <li><b>Drag</b> a mobject from the library onto the preview to place it, or onto the timeline to place it in time.</li>
          <li><b>Drag objects in the preview</b> to move them. Pick an object or the camera by its centre <b>+</b> and it snaps onto other centres. Corners scale, the top dot rotates. <kbd>⇧</kbd> constrains, <kbd>⌘</kbd> disables snapping.</li>
          <li>The <b>timeline’s vertical order is z-order</b>: the top track is drawn in front. Drag a track’s ⠿ grip to reorder.</li>
          <li>Drag the shaded <b>enter / exit</b> regions of a clip to change animation length.</li>
          <li><kbd>K</kbd> adds a keyframe at the playhead — then drag the object at other times to animate it.</li>
          <li><kbd>A</kbd> select tool · <kbd>B</kbd> blade tool (click a clip to cut, <kbd>⇧</kbd> all) · <kbd>⌘B</kbd> blade at playhead</li>
          <li><kbd>Space</kbd> play · <kbd>⌘D</kbd> duplicate · <kbd>⌫</kbd> delete · <kbd>←/→</kbd> step</li>
          <li>Drop images or SVGs from Finder anywhere.</li>
        </ul>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------- transform
function TransformSection({ clip }: { clip: Clip }) {
  const time = useStore((s) => s.time);
  const fps = useStore((s) => s.project.settings.fps);
  const { begin, edit } = useClipEdit(clip.id);
  const u = time - clip.start;
  const inside = u >= 0 && u <= clip.duration;
  const tr = transformAt(clip, Math.min(Math.max(u, 0), clip.duration));
  const onKey = keyAt(clip, u, fps);
  const hasKeys = clip.keys.length > 0;
  const field = (k: keyof Transform): FieldHooks => ({
    onBegin: begin,
    onChange: (v) => edit((c) => setTransformAt(c, Math.min(Math.max(u, 0), c.duration), { [k]: v }, fps)),
  });
  const keysSorted = [...clip.keys].sort((a, b) => a.t - b.t);
  const prev = [...keysSorted].reverse().find((k) => k.t < u - 1e-4);
  const next = keysSorted.find((k) => k.t > u + 1e-4);
  const setTime = useStore.getState().setTime;

  return (
    <Section
      icon={<Move size={13} />}
      title="Transform"
      right={
        <div className="kf-controls">
          <button className="mini" disabled={!prev} title="Previous keyframe" onClick={() => prev && setTime(clip.start + prev.t)}><ChevronLeft size={14} /></button>
          <button
            className={`kf-btn ${onKey ? 'on' : hasKeys ? 'half' : ''}`}
            title={onKey ? 'Remove keyframe at playhead' : 'Add keyframe at playhead (K)'}
            disabled={!inside}
            data-testid="kf-toggle"
            onClick={() => {
              begin();
              edit((c) => {
                const k = keyAt(c, u, fps);
                if (k) c.keys = c.keys.filter((x) => x.id !== k.id);
                else addKeyAt(c, u, fps);
              });
            }}
          >
            <Diamond size={12} fill={onKey ? 'currentColor' : 'none'} />
          </button>
          <button className="mini" disabled={!next} title="Next keyframe" onClick={() => next && setTime(clip.start + next.t)}><ChevronRight size={14} /></button>
        </div>
      }
    >
      {hasKeys && (
        <div className={`kf-note ${onKey ? 'on' : ''}`}>
          {onKey ? '◆ Editing the keyframe at the playhead' : inside ? '◇ Editing here creates a keyframe' : 'Playhead is outside this clip'}
        </div>
      )}
      <div className="grid2">
        <NumberField label="X" value={tr.x} step={0.05} {...field('x')} testid="tr-x" />
        <NumberField label="Y" value={tr.y} step={0.05} {...field('y')} testid="tr-y" />
        <NumberField label="Scale" value={tr.scale} step={0.05} min={0.01} {...field('scale')} testid="tr-scale" />
        <NumberField label="Rotation" value={tr.rotation} step={1} suffix="°" {...field('rotation')} />
      </div>
      {!hasKeys && <LayoutBinding clip={clip} />}
      <div className="grid2">
        <NumberField label="Z" value={tr.z || 0} step={0.05} {...field('z')} testid="tr-z" />
        <NumberField label="Opacity" value={tr.opacity} step={0.05} min={0} max={1} {...field('opacity')} />
      </div>
      <div className="grid2" title="3D orientation, applied after Rotation: tip about the x axis, then turn about the y axis. Rot X −90° lays it flat on the floor, readable from the Top view.">
        <NumberField label="Rot X" value={tr.rx || 0} step={1} suffix="°" {...field('rx')} testid="tr-rx" />
        <NumberField label="Rot Y" value={tr.ry || 0} step={1} suffix="°" {...field('ry')} testid="tr-ry" />
      </div>
      <label className="dyn-toggle pin-toggle" title="Draw it on top of the video in screen space, ignoring camera moves — for titles and labels over a 3D scene">
        <input type="checkbox" data-testid="pin-toggle" checked={!!clip.fixed} onChange={(e) => { begin(); edit((c) => { if (e.target.checked) c.fixed = true; else delete c.fixed; }); }} />
        Pin to screen <span className="muted">— ignores the camera (titles over 3D)</span>
      </label>
      <div className="align-row">
        <span className="muted small">Align</span>
        {([
          [<AlignStartVertical size={14} />, 'Left edge', { x: -FW / 2 + 1.5 }],
          [<AlignCenterVertical size={14} />, 'Center horizontally', { x: 0 }],
          [<AlignEndVertical size={14} />, 'Right edge', { x: FW / 2 - 1.5 }],
          [<AlignStartHorizontal size={14} />, 'Top edge', { y: FH / 2 - 1 }],
          [<AlignCenterHorizontal size={14} />, 'Center vertically', { y: 0 }],
          [<AlignEndHorizontal size={14} />, 'Bottom edge', { y: -FH / 2 + 1 }],
        ] as [any, string, Partial<Transform>][]).map(([icon, title, patch]) => (
          <button key={title} className="mini" title={title} onClick={() => { begin(); edit((c) => setTransformAt(c, Math.min(Math.max(u, 0), c.duration), patch, fps)); }}>{icon}</button>
        ))}
        <div className="spacer" />
        <button className="mini text" title="Reset scale, rotation (all axes) and opacity" onClick={() => { begin(); edit((c) => setTransformAt(c, Math.min(Math.max(u, 0), c.duration), { scale: 1, rotation: 0, rx: 0, ry: 0, opacity: 1 }, fps)); }}><RotateCcw size={12} /> Reset</button>
      </div>
      {hasKeys && (
        <div className="kf-list">
          {keysSorted.map((k, i) => (
            <div key={k.id} className={`kf-row ${onKey?.id === k.id ? 'on' : ''}`} onClick={() => setTime(clip.start + k.t)}>
              <span className="kf-dia"><Diamond size={10} fill="currentColor" /></span>
              <span className="mono">{(clip.start + k.t).toFixed(2)}s</span>
              <span className="muted small">({k.x.toFixed(1)}, {k.y.toFixed(1)}) ×{k.scale.toFixed(2)}</span>
              <div className="spacer" />
              {i > 0 && (
                <select value={k.ease || 'smooth'} onClick={(e) => e.stopPropagation()} onChange={(e) => { begin(); edit((c) => { const kk = c.keys.find((x) => x.id === k.id); if (kk) kk.ease = e.target.value; }); }} title="Easing into this keyframe">
                  {['smooth', 'linear', 'rush_into', 'rush_from', 'double_smooth'].map((r) => <option key={r}>{r}</option>)}
                </select>
              )}
              <button className="mini" onClick={(e) => { e.stopPropagation(); begin(); edit((c) => { c.keys = c.keys.filter((x) => x.id !== k.id); if (c.keys.length === 0) c.transform = { ...c.transform, ...{ x: k.x, y: k.y, scale: k.scale, rotation: k.rotation, opacity: k.opacity } }; }); }} title="Delete keyframe"><X size={13} /></button>
            </div>
          ))}
          <button className="btn small ghost" onClick={() => { begin(); edit((c) => { const cur = transformAt(c, Math.min(Math.max(u, 0), c.duration)); c.keys = []; c.transform = cur; }); }}>Remove all keyframes</button>
        </div>
      )}
    </Section>
  );
}

type Focus = { section: string; effectId?: string; n: number } | null;

// ---------------------------------------------------------------------------- properties tab
function PropsTab({ clip, focus }: { clip: Clip; focus: Focus }) {
  const item = itemById(clip.item);
  const assets = useStore((s) => s.project.assets);
  const { begin, edit } = useClipEdit(clip.id);
  const firstRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const f = () => {
      const el = firstRef.current?.querySelector('input:not([type=color]), textarea') as HTMLInputElement | null;
      el?.focus();
      el?.select?.();
    };
    window.addEventListener('focus-first-param', f);
    return () => window.removeEventListener('focus-first-param', f);
  }, []);

  return (
    <>
      <Section id="params" signal={focus?.section === 'params' ? focus.n : 0} icon={<SlidersHorizontal size={13} />} title="Parameters">
        {clip.code ? (
          <CodeKnobs clip={clip} onReset={item && item.params.length > 0 ? () => { begin(); edit((c) => { c.code = null; }); } : undefined} />
        ) : item && item.params.length ? (
          <div ref={firstRef}>
            {item.params.map((p) => (
              <LinkableParam
                key={p.id}
                def={p}
                value={clip.params[p.id]}
                assets={assets}
                hooks={{ onBegin: begin, onChange: (v) => edit((c) => { c.params = { ...c.params, [p.id]: v }; }) }}
              />
            ))}
          </div>
        ) : (
          <div className="detached">
            <p>No parameters — edit the code directly.</p>
            <button className="btn small" onClick={() => editClipCode(clip.id)}>Edit code</button>
          </div>
        )}
      </Section>
      <TransformSection clip={clip} />
    </>
  );
}

// ---------------------------------------------------------------------------- position bound to globals
function LayoutExpr({ clip, axis }: { clip: Clip; axis: 'x' | 'y' }) {
  const globals = useStore((s) => s.project.globals);
  const expr = clip.layout?.[axis] ?? '';
  const [text, setText] = useState(expr);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setText(expr); setErr(null); }, [expr]);
  const { begin, edit } = useClipEdit(clip.id);
  const commit = () => {
    if (text === expr) return;
    if (evalLayout(text, globals) === null) {
      const unknown = layoutProblems(text, globals);
      setErr(unknown.length ? `unknown: ${unknown.join(', ')}` : 'invalid expression');
      return;
    }
    setErr(null);
    begin();
    edit((c) => { c.layout = { ...(c.layout || {}), [axis]: text.trim() }; });
  };
  return (
    <div className={`layout-row ${err ? 'err' : ''}`} title="Follows the globals; drag the clip to place it by hand instead">
      <Link2 size={11} />
      <span className="ax">{axis.toUpperCase()} =</span>
      <input
        value={text}
        spellCheck={false}
        data-testid={`layout-${axis}`}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <button className="mini" title="Unbind (keep the current position)" data-testid={`layout-unbind-${axis}`} onClick={() => { begin(); edit((c) => { if (c.layout) { delete c.layout[axis]; if (c.layout.x == null && c.layout.y == null) delete c.layout; } }); }}>
        <Unlink size={11} />
      </button>
      {err && <div className="layout-err">{err}</div>}
    </div>
  );
}

/** X / Y that follow expressions over number globals, so spacing globals move separate elements. */
function LayoutBinding({ clip }: { clip: Clip }) {
  const hasNumberGlobals = useStore((s) => (s.project.globals || []).some((g) => g.type === 'number'));
  const { begin, edit } = useClipEdit(clip.id);
  const bound = clip.layout && (clip.layout.x != null || clip.layout.y != null);
  if (!bound && !hasNumberGlobals) return null;
  return (
    <div className="layout-bind">
      {clip.layout?.x != null && <LayoutExpr clip={clip} axis="x" />}
      {clip.layout?.y != null && <LayoutExpr clip={clip} axis="y" />}
      {hasNumberGlobals && (clip.layout?.x == null || clip.layout?.y == null) && (
        <button
          className="btn small ghost layout-add"
          data-testid="layout-bind"
          title="Make the position an expression over globals, e.g. TOP_Y - 2*ROW_GAP"
          onClick={() => {
            begin();
            edit((c) => {
              const l = { ...(c.layout || {}) };
              if (l.x == null) l.x = String(round(c.transform.x, 3));
              if (l.y == null) l.y = String(round(c.transform.y, 3));
              c.layout = l;
            });
          }}
        >
          <Link2 size={11} /> Bind position to globals
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- animation tab
function AnimTab({ clip, focus }: { clip: Clip; focus: Focus }) {
  const library = useStore((s) => s.library)!;
  const project = useStore((s) => s.project);
  const { begin, edit } = useClipEdit(clip.id);
  const anims = library.animations;
  const labels = (list: { id: string; label: string }[]) => Object.fromEntries(list.map((a) => [a.id, a.label]));
  const rates = anims.rates;
  const isTransform = clip.exit.type === 'TransformInto' || clip.exit.type === 'TransformMatching';
  const others = project.clips.filter((c) => c.id !== clip.id);
  const target = clip.exit.target ? project.clips.find((c) => c.id === clip.exit.target) : null;
  const end = clip.start + clip.duration;

  const linkTarget = (tid: string) => {
    begin();
    useStore.getState().commit((p) => {
      const c = p.clips.find((c) => c.id === clip.id)!;
      const t = p.clips.find((c) => c.id === tid);
      c.exit = { ...c.exit, target: tid || null };
      if (t) {
        // the target appears exactly when the morph finishes
        t.start = round(c.start + c.duration, 3);
        t.enter = { ...t.enter, type: 'none' };
        // …and continues on the same track, so the timeline shows one object changing shape
        joinMorphTrack(p, c, t);
        resolveOverlap(p, t.id);
      }
    }, { transient: true });
  };

  const name = (id: string, list: { id: string; label: string }[]) => labels(list)[id] || id;
  // Type, start, length, track and effect placement are all edited on the timeline clip itself.
  // This tab only holds what the timeline can't do: easing, morph targets, effect length / removal,
  // and adding an enter / exit animation when there is none (the clip has no zone to click then).
  return (
    <>
      <Section id="enter" signal={focus?.section === 'enter' ? focus.n : 0} icon={<LogIn size={13} />} title="Enter animation" right={clip.enter.type !== 'none' && <span className="anim-name"><AnimIcon id={clip.enter.type} size={12} /> {name(clip.enter.type, anims.enter)}</span>}>
        {clip.enter.type === 'none' ? (
          <AnimPicker kind="enter" value={clip.enter.type} options={anims.enter} testid="enter-picker" clipId={clip.id} onChange={(v) => { begin(); edit((c) => { c.enter = { ...c.enter, type: v, duration: c.enter.duration || 1 }; }); }} />
        ) : (
          <SelectField label="Easing" value={clip.enter.rate || 'smooth'} options={rates} onBegin={begin} onChange={(v) => edit((c) => { c.enter = { ...c.enter, rate: v }; })} />
        )}
      </Section>
      <Section id="exit" signal={focus?.section === 'exit' ? focus.n : 0} icon={<LogOut size={13} />} title="Exit animation" right={clip.exit.type !== 'none' && <span className="anim-name"><AnimIcon id={clip.exit.type} size={12} /> {name(clip.exit.type, anims.exit)}</span>}>
        {clip.exit.type === 'none' ? (
          <AnimPicker kind="exit" value={clip.exit.type} options={anims.exit} testid="exit-picker" clipId={clip.id} onChange={(v) => { begin(); edit((c) => { c.exit = { ...c.exit, type: v, duration: c.exit.duration || 1 }; }); }} />
        ) : (
          <SelectField label="Easing" value={clip.exit.rate || 'smooth'} options={rates} onBegin={begin} onChange={(v) => edit((c) => { c.exit = { ...c.exit, rate: v }; })} />
        )}
        {isTransform && (
          <>
            <SelectField
              label="Into"
              value={clip.exit.target || ''}
              options={['', ...others.map((c) => c.id)]}
              labels={{ '': '— choose a clip —', ...Object.fromEntries(others.map((c) => [c.id, c.name])) }}
              onBegin={() => {}}
              onChange={linkTarget}
            />
            {!target && <div className="hint warn">Pick the clip this one morphs into. It will be moved to start at {end.toFixed(2)}s.</div>}
            {target && Math.abs(target.start - end) > 0.02 && (
              <div className="hint warn">
                “{target.name}” starts at {target.start.toFixed(2)}s, not when this clip ends.{' '}
                <a onClick={() => linkTarget(target.id)}>Fix</a>
              </div>
            )}
            {clip.exit.type === 'TransformMatching' && <div className="hint">Matches identical glyphs between two Tex / Text objects (great for equation steps).</div>}
          </>
        )}
      </Section>
      <PartsSection clip={clip} focus={focus} />
      {clip.effects.length > 0 && (
        <Section id="effects" signal={focus?.section === 'effects' ? focus.n : 0} mark={focus?.section === 'effects' ? focus.effectId : undefined} icon={<Sparkles size={13} />} title="Effects">
          {clip.effects.map((ef) => (
            <div key={ef.id} className={`effect-row ${focus?.effectId === ef.id ? 'on' : ''}`} data-effect={ef.id}>
              <AnimPicker
                kind="effect"
                value={ef.type}
                options={anims.effects}
                testid={`effect-type-${ef.id}`}
                clipId={clip.id}
                effId={ef.id}
                onChange={(v) => { begin(); edit((c) => { const x = c.effects.find((x) => x.id === ef.id); if (x) x.type = v; }); }}
              />
              <NumberField label="for" value={ef.duration} step={0.1} min={0.1} suffix="s" onBegin={begin} onChange={(v) => edit((c) => { const x = c.effects.find((x) => x.id === ef.id); if (x) x.duration = v; })} />
              <button className="mini" title="Remove effect" onClick={() => { begin(); edit((c) => { c.effects = c.effects.filter((x) => x.id !== ef.id); }); }}><X size={13} /></button>
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

/** Group clips: timing of the selected part (submobject), stagger, reset. Rows on the timeline do the dragging. */
function PartsSection({ clip, focus }: { clip: Clip; focus: Focus }) {
  const tree = useClipParts(clip);
  const library = useStore((s) => s.library)!;
  const sel = useStore((s) => (s.selectedPart?.clip === clip.id ? s.selectedPart.path : null));
  const open = useStore((s) => s.partsOpen.includes(clip.id));
  const { begin, edit } = useClipEdit(clip.id);
  if (!isGroupTree(tree) && !clip.parts) return null;
  const anims = library.animations;
  const node = sel !== null ? findNode(tree, sel) : null;
  const tm = sel !== null ? partTiming(clip, sel) : null;
  const own = timedParts(clip);
  const nMoved = Object.values(clip.parts || {}).filter(hasOffset).length;
  const nKids = tree?.children?.length ?? 0;
  const commitPart = (patch: Parameters<typeof setPart>[2]) => { begin(); edit((c) => setPart(c, sel!, patch)); };
  const showRows = () => !open && useStore.setState({ partsOpen: [...useStore.getState().partsOpen, openKey(clip.id, '')] });
  return (
    <Section id="parts" signal={focus?.section === 'parts' ? focus.n : 0} icon={<ListTree size={13} />} title="Parts" right={<span className="muted small">{nKids} parts{own.length ? ` · ${own.length} timed` : ''}{nMoved ? ` · ${nMoved} moved` : ''}</span>}>
      <div className="hint">Each part of this group can appear, animate, leave and be moved on its own. Show the parts on the timeline and drag their bars, or stagger them. Double-click the clip in the viewer to pick a part and drag it.</div>
      <div className="row-btns">
        <button className="btn small" data-testid="parts-show" onClick={() => useStore.setState({ partsOpen: open ? useStore.getState().partsOpen.filter((k) => k !== clip.id && !k.startsWith(clip.id + '|')) : [...useStore.getState().partsOpen, clip.id] })}>
          <ListTree size={13} /> {open ? 'Hide on timeline' : 'Show on timeline'}
        </button>
        <button className="btn small" disabled={!own.length && !nMoved} title="Every part follows the clip again and goes back where its code puts it" onClick={() => { begin(); edit((c) => resetPart(c, '', true, 'all')); }}><RotateCcw size={13} /> Reset all</button>
      </div>
      <div className="parts-stagger">
        <span className="muted small">Stagger {sel !== null && node?.children?.length ? `“${partName(node)}”` : 'parts'}</span>
        {[0.1, 0.25, 0.5, 1].map((step) => (
          <button key={step} className="btn small" data-testid={`stagger-${step}`} disabled={!tree} onClick={() => { begin(); edit((c) => staggerParts(c, tree!, sel !== null && node?.children?.length ? sel : '', step)); showRows(); }}>{step}s</button>
        ))}
      </div>
      {sel !== null && tm && (
        <div className="part-edit" data-testid="part-edit">
          <div className="part-edit-title">
            <b>{node ? partName(node) : `part ${sel}`}</b> <span className="muted small">{node?.type}{tm.own ? '' : tm.custom ? ' · timing from its group' : ' · follows the clip'}</span>
          </div>
          <NumberField label="Appears" value={round(clip.start + tm.at, 3)} step={0.05} min={clip.start} max={clip.start + tm.until} suffix="s" testid="part-at" onBegin={begin} onChange={(v) => edit((c) => setPart(c, sel, { at: round(v - c.start, 3) }))} />
          <NumberField label="Leaves" value={round(clip.start + tm.until, 3)} step={0.05} min={clip.start + tm.at} max={clip.start + clip.duration} suffix="s" testid="part-until" onBegin={begin} onChange={(v) => edit((c) => setPart(c, sel, { until: v >= c.start + c.duration - 1e-6 ? null : round(v - c.start, 3) }))} />
          <div className="part-anim-row">
            <span className="muted small">Enter</span>
            <AnimPicker kind="enter" value={tm.enter.type} options={anims.enter} testid="part-enter-picker" clipId={clip.id} part={sel} onChange={(v) => commitPart({ enter: { ...tm.enter, type: v, duration: tm.enter.duration || 0.5 } })} />
          </div>
          {tm.enter.type !== 'none' && (
            <NumberField label="for" value={tm.enter.duration} step={0.05} min={0.05} suffix="s" onBegin={begin} onChange={(v) => edit((c) => setPart(c, sel, { enter: { ...tm.enter, duration: v } }))} />
          )}
          <div className="part-anim-row">
            <span className="muted small">Exit</span>
            <AnimPicker kind="exit" value={tm.exit.type} options={anims.exit.filter((a) => a.id !== 'TransformInto' && a.id !== 'TransformMatching')} testid="part-exit-picker" clipId={clip.id} part={sel} onChange={(v) => commitPart({ exit: { ...tm.exit, type: v, duration: tm.exit.duration || 0.5 } })} />
          </div>
          {tm.exit.type !== 'none' && (
            <NumberField label="for" value={tm.exit.duration} step={0.05} min={0.05} suffix="s" onBegin={begin} onChange={(v) => edit((c) => setPart(c, sel, { exit: { ...tm.exit, duration: v } }))} />
          )}
          <PartStyle clip={clip} label={node?.label} />
          <div className="grid2" title="How far this part is moved from where the clip's code puts it (in the clip's own units). Drag the part in the viewer to move it.">
            <NumberField label="Move X" value={round(clip.parts?.[sel]?.dx || 0, 3)} step={0.05} testid="part-dx" onBegin={begin} onChange={(v) => edit((c) => movePart(c, sel, v, c.parts?.[sel]?.dy || 0))} />
            <NumberField label="Move Y" value={round(clip.parts?.[sel]?.dy || 0, 3)} step={0.05} testid="part-dy" onBegin={begin} onChange={(v) => edit((c) => movePart(c, sel, c.parts?.[sel]?.dx || 0, v))} />
          </div>
          <div className="row-btns">
            <button className="btn small" disabled={!tm.own} onClick={() => { begin(); edit((c) => resetPart(c, sel)); }}><RotateCcw size={13} /> Follow the clip</button>
            <button className="btn small" data-testid="part-put-back" disabled={!hasOffset(clip.parts?.[sel])} onClick={() => { begin(); edit((c) => resetPart(c, sel, false, 'position')); }}><Move size={13} /> Put back</button>
          </div>
        </div>
      )}
      {sel === null && <div className="hint">Click a part's bar on the timeline, or double-click it in the viewer, to edit its timing and position here.</div>}
    </Section>
  );
}

// ---------------------------------------------------------------------------- code tab
export function CodeTab({ clip }: { clip: Clip }) {
  const [code, setCode] = useState('');
  const [dynamic, setDynamic] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { begin, edit } = useClipEdit(clip.id);
  const error = useStore((s) => s.meta?.errors?.[clip.id]);
  const item = itemById(clip.item);
  const timer = useRef<any>(null);
  const began = useRef(false);
  const sig = JSON.stringify([clip.item, clip.params, clip.code, (clip as any).dynamic]);

  useEffect(() => {
    if (dirty) return;
    fetchClipSource(clip).then((r) => {
      setCode(r.code);
      setDynamic(r.dynamic);
    });
  }, [sig]);

  const apply = (text: string) => {
    if (!began.current) {
      begin();
      began.current = true;
    }
    edit((c) => {
      c.code = text;
      (c as any).dynamic = dynamic;
    });
    setDirty(false);
  };

  const onChange = (v: string) => {
    setCode(v);
    setDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(v), 700);
  };

  const ext = useMemo(
    () => [
      python(),
      keymap.of([{ key: 'Mod-Enter', run: (v) => { clearTimeout(timer.current); apply(v.state.doc.toString()); return true; } }]),
    ],
    [clip.id, dynamic],
  );

  return (
    <div className="code-tab">
      <div className="code-tab-head">
        <span className="mono small">def make_{clip.name.toLowerCase().replace(/\W+/g, '_')}({dynamic ? 't, a' : ''}):</span>
        <div className="spacer" />
        {clip.code && item && item.params.length > 0 && (
          <button className="btn small ghost" onClick={() => { begin(); edit((c) => { c.code = null; delete (c as any).dynamic; }); began.current = false; }}>Reset to template</button>
        )}
      </div>
      <div className="code-editor" data-testid="clip-code">
        <CodeMirror value={code} theme={oneDark} extensions={ext} onChange={onChange} basicSetup={{ foldGutter: false }} height="100%" onBlur={() => { began.current = false; }} />
      </div>
      <label className="dyn-toggle">
        <input
          type="checkbox"
          checked={dynamic}
          onChange={(e) => {
            setDynamic(e.target.checked);
            begin();
            edit((c) => { (c as any).dynamic = e.target.checked; c.code = c.code || code; });
          }}
        />
        Rebuild every frame — the code can use <code>t</code> (seconds since the clip started) and <code>a</code> (0 → 1 over the clip)
      </label>
      {error ? <pre className="code-error">{error}</pre> : <div className="muted small">Edits apply automatically (⌘↩ to apply now). Any ManimGL code works — return a mobject.</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------- camera
function CameraInspector() {
  const project = useStore((s) => s.project);
  const camFullView = useStore((s) => s.camFullView);
  const time = useStore((s) => s.time);
  const st = useStore.getState;
  const fps = project.settings.fps;
  const cam = cameraAt(project, time);
  const keys = [...(project.settings.camera || [])].sort((a, b) => a.t - b.t);
  const onKey = keys.find((k) => Math.abs(k.t - time) <= 0.5 / fps);
  const field = (k: 'x' | 'y' | 'z' | 'zoom' | 'theta' | 'phi' | 'gamma'): FieldHooks => ({
    onBegin: () => st().checkpoint(),
    onChange: (v) => st().commit((p) => setCameraAt(p, st().time, { [k]: v }, fps), { transient: true }),
  });
  const commit = (fn: (p: Project) => void) => st().commit(fn);
  return (
    <aside className="panel inspector" data-testid="camera-inspector">
      <div className="panel-head"><span>Inspector</span></div>
      <div className="ins-title">
        <div className="ins-icon" style={{ background: '#3d7ff0' }}><Video size={18} /></div>
        <div>
          <div className="ins-name static">Camera</div>
          <div className="muted small">{keys.length ? `${keys.length} keyframe${keys.length > 1 ? 's' : ''}` : 'static (default view)'}</div>
        </div>
      </div>
      <div className="ins-scroll">
        <Section
          icon={<Video size={13} />}
          title="View"
          id="cam-view"
          defaultOpen
          right={
            <div className="kf-controls">
              <button className={`kf-btn ${onKey ? 'on' : keys.length ? 'half' : ''}`} title={onKey ? 'Remove camera key' : 'Add camera key at playhead (K)'} onClick={() => commit((p) => {
                if (onKey) p.settings.camera = (p.settings.camera || []).filter((k) => k.id !== onKey.id);
                else setCameraAt(p, time, {}, fps);
              })}>
                <Diamond size={12} fill={onKey ? 'currentColor' : 'none'} />
              </button>
            </div>
          }
        >
          <div className="kf-note">{onKey ? '◆ Editing the camera key at the playhead' : 'Editing creates a camera keyframe at the playhead'}</div>
          <div className="grid2">
            <NumberField label="X" value={cam.x} step={0.1} {...field('x')} />
            <NumberField label="Y" value={cam.y} step={0.1} {...field('y')} />
            <NumberField label="Z" value={cam.z} step={0.1} {...field('z')} />
            <NumberField label="Zoom" value={cam.zoom} step={0.05} min={0.05} suffix="×" {...field('zoom')} testid="cam-zoom" />
          </div>
          <div className="sub-head">Orientation <span className="muted small">(degrees, like frame.reorient)</span></div>
          <div className="grid2 grid3">
            <NumberField label="Orbit θ" value={cam.theta} step={1} suffix="°" {...field('theta')} testid="cam-theta" />
            <NumberField label="Tilt φ" value={cam.phi} step={1} suffix="°" {...field('phi')} testid="cam-phi" />
            <NumberField label="Roll γ" value={cam.gamma} step={1} suffix="°" {...field('gamma')} />
          </div>
          <div className="view-presets">
            {(['top', 'front', 'right', 'iso'] as const).map((k) => (
              <button key={k} className="btn small ghost" data-testid={`cam-preset-${k}`} title={`${VIEW_PRESETS[k].label}${VIEW_PRESETS[k].key ? ` (${VIEW_PRESETS[k].key})` : ''}`} onClick={() => lookPreset(k, 'camera')}>
                {k === 'iso' ? '3D' : VIEW_PRESETS[k].label}
              </button>
            ))}
            <button className="btn small ghost" title="Zoom the camera to fit" onClick={() => fitNav('camera')}>Fit</button>
          </div>
          <div className="row-btns" style={{ padding: 0 }}>
            <button className="btn small" onClick={() => commit((p) => setCameraAt(p, time, { x: 0, y: 0, z: 0, zoom: 1, theta: 0, phi: 0, gamma: 0 }, fps))}>Reset view here</button>
            <button className="btn small ghost" disabled={!keys.length} onClick={() => commit((p) => { p.settings.camera = []; })}>Remove all keys</button>
          </div>
          <div className="seg cam-seg">
            <button className={camFullView && isFlat(cam) ? 'on' : ''} disabled={!isFlat(cam)} title={isFlat(cam) ? '' : 'The full-scene crop view is for flat (2D) cameras'} onClick={() => useStore.setState({ camFullView: true, editorView: null })}>Full scene</button>
            <button className={!camFullView || !isFlat(cam) ? 'on' : ''} onClick={() => useStore.setState({ camFullView: false, editorView: null })}>Camera view</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {!isFlat(cam)
              ? 'Looking through the 3D camera: right-drag (or ⌥-drag) to orbit, ⇧+right-drag to pan, drag to pan, scroll to zoom to the pointer. Click the view cube to look from a side.'
              : camFullView
              ? 'The preview shows the whole scene; the blue box is what the camera sees. Drag it to move, drag a corner to resize (⌥ resizes from the centre), drag outside it to draw a new crop, scroll to zoom. Press C to look through the camera.'
              : 'Looking through the camera: drag to pan, scroll to zoom. Press C to go back to the full scene.'}
          </p>
        </Section>
        {keys.length > 0 && (
          <Section icon={<Diamond size={13} />} title="Waypoints" id="cam-keys" defaultOpen>
            <div className="kf-list">
              {keys.map((k, i) => (
                <div key={k.id} className={`kf-row ${onKey?.id === k.id ? 'on' : ''}`} onClick={() => st().setTime(k.t)}>
                  <span className="kf-dia" style={{ color: 'var(--accent)' }}><Diamond size={10} fill="currentColor" /></span>
                  <span className="mono">{k.t.toFixed(2)}s</span>
                  <span className="muted small">({k.x.toFixed(1)}, {k.y.toFixed(1)}{k.z ? `, ${k.z.toFixed(1)}` : ''}) ×{k.zoom.toFixed(2)}{k.theta || k.phi || k.gamma ? ` · ${(k.theta || 0).toFixed(0)}°/${(k.phi || 0).toFixed(0)}°` : ''}</span>
                  <div className="spacer" />
                  {i > 0 && (
                    <select value={k.ease || 'smooth'} onClick={(e) => e.stopPropagation()} onChange={(e) => commit((p) => { const kk = p.settings.camera?.find((x) => x.id === k.id); if (kk) kk.ease = e.target.value; })}>
                      {['smooth', 'linear', 'rush_into', 'rush_from', 'double_smooth'].map((r) => <option key={r}>{r}</option>)}
                    </select>
                  )}
                  <button className="mini" onClick={(e) => { e.stopPropagation(); commit((p) => { p.settings.camera = (p.settings.camera || []).filter((x) => x.id !== k.id); }); }}><X size={13} /></button>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------- inspector
export default function Inspector() {
  const selection = useStore((s) => s.selection);
  const clips = useStore((s) => s.project.clips);
  const errors = useStore((s) => s.meta?.errors) || {};
  const clip = selection.length === 1 ? clips.find((c) => c.id === selection[0]) : undefined;
  if (selection.length === 1 && selection[0] === CAMERA_ID) return <CameraInspector />;
  const morphOf = selectedMorph(selection);
  const morphClip = morphOf ? clips.find((c) => c.id === morphOf) : undefined;
  if (morphClip && isMorph(morphClip)) return <TransformInspector clip={morphClip} />;

  if (selection.length > 1) {
    const sel = clips.filter((c) => selection.includes(c.id));
    return (
      <aside className="panel inspector">
        <div className="panel-head"><span>Inspector</span></div>
        <div className="ins-scroll">
          <div className="ins-title">
            <div className="ins-icon">{sel.length}</div>
            <div className="ins-name static">{sel.length} clips selected</div>
          </div>
          <div className="multi-list">
            {sel.map((c) => <div key={c.id} onClick={() => useStore.setState({ selection: [c.id] })}>{c.name}</div>)}
          </div>
          <div className="row-btns">
            <button className="btn small" onClick={duplicateSelection}><Copy size={13} /> Duplicate</button>
            <button className="btn small danger" onClick={deleteSelection}><Trash2 size={13} /> Delete</button>
          </div>
          <p className="muted small">Drag them together in the preview or the timeline.</p>
        </div>
      </aside>
    );
  }

  if (!clip) {
    return (
      <aside className="panel inspector">
        <div className="panel-head"><span>Inspector</span></div>
        <SceneSettings />
      </aside>
    );
  }

  return <ClipInspector clip={clip} error={errors[clip.id]} />;
}

/** The transform clip between two states (clip.exit morphs it into clip.exit.target). */
function TransformInspector({ clip }: { clip: Clip }) {
  const library = useStore((s) => s.library);
  const clips = useStore((s) => s.project.clips);
  const target = clips.find((c) => c.id === clip.exit.target);
  const { begin, edit } = useClipEdit(clip.id);
  const anims = library?.animations;
  const kinds = (anims?.exit || []).filter((a) => a.id === 'TransformInto' || a.id === 'TransformMatching');
  const [t0] = exitWindow(clip);
  const start = clip.start + t0;
  const end = clip.start + clip.duration;
  const ed = clip.enter.type !== 'none' ? clip.enter.duration : 0;
  const thumbA = useClipThumb(clip);
  const thumbB = useClipThumb(target);
  const pick = (id: string) => useStore.setState({ selection: [id] });
  return (
    <aside className="panel inspector" data-testid="transform-inspector">
      <div className="panel-head"><span>Inspector</span></div>
      <div className="ins-title">
        <div className="ins-thumb tclip-thumb" title="Transform"><Shuffle size={20} /></div>
        <div className="grow">
          <div className="ins-name static">Transform</div>
          <div className="muted small ins-sub">{clip.name} <ArrowRight size={10} /> {target?.name ?? '?'} · {start.toFixed(2)}s → {end.toFixed(2)}s</div>
        </div>
      </div>
      <div className="ins-scroll" key={clip.id}>
        <div className="morph-states">
          <button className="morph-state" data-testid="morph-from" onClick={() => pick(clip.id)} title={`Select “${clip.name}” (before the transform)`}>
            {thumbA.url ? <img src={thumbA.url} alt="" /> : <span />}
            <span className="nm">{clip.name}</span>
          </button>
          <ArrowRight size={16} className="muted" />
          {target && (
            <button className="morph-state" data-testid="morph-to" onClick={() => pick(target.id)} title={`Select “${target.name}” (after the transform) — move or restyle it to change what the transform becomes`}>
              {thumbB.url ? <img src={thumbB.url} alt="" /> : <span />}
              <span className="nm">{target.name}</span>
            </button>
          )}
        </div>
        <div className="ins-body">
          {kinds.length > 1 && (
            <SelectField
              label="Kind"
              value={clip.exit.type}
              options={kinds.map((k) => k.id)}
              labels={Object.fromEntries(kinds.map((k) => [k.id, k.label]))}
              onBegin={begin}
              onChange={(v) => edit((c) => { c.exit = { ...c.exit, type: v }; })}
            />
          )}
          <NumberField
            label="Length"
            testid="morph-length"
            value={round(end - start, 2)}
            step={0.1}
            min={0.1}
            max={round(clip.duration - ed, 2)}
            suffix="s"
            onBegin={begin}
            onChange={(v) => edit((c) => { c.exit = { ...c.exit, duration: round(Math.max(0.1, Math.min(c.duration - ed, v)), 2) }; })}
          />
          <SelectField label="Easing" value={clip.exit.rate || 'smooth'} options={anims?.rates || ['smooth']} onBegin={begin} onChange={(v) => edit((c) => { c.exit = { ...c.exit, rate: v }; })} />
          {clip.exit.type === 'TransformMatching' && <div className="hint">Matches identical glyphs between two Tex / Text objects (great for equation steps).</div>}
          <p className="muted small">Ends where “{target?.name}” starts. Drag the transform's edges on the timeline to change when it starts or ends.</p>
          <div className="row-btns">
            <button className="btn small danger" data-testid="remove-transform" onClick={() => removeTransform(clip.id)}><Trash2 size={13} /> Remove transform</button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function ClipInspector({ clip, error }: { clip: Clip; error?: string }) {
  const item = itemById(clip.item);
  const color = CATEGORY_COLORS[item?.category || 'Custom'];
  const thumb = useClipThumb(clip);
  const focus = useStore((s) => (s.inspectorFocus?.clip === clip.id ? s.inspectorFocus : null));
  return (
    <aside className="panel inspector" data-testid="inspector">
      <div className="panel-head"><span>Inspector</span></div>
      <div className="ins-title">
        <div className="ins-thumb" style={{ borderColor: color }} title={item?.name}>
          {thumb.url ? <img src={thumb.url} alt="" /> : <span style={{ color }}><CategoryIcon category={item?.category || 'Custom'} size={20} /></span>}
        </div>
        <div className="grow">
          <input
            className="ins-name"
            value={clip.name}
            data-testid="clip-name"
            onFocus={() => useStore.getState().checkpoint()}
            onChange={(e) => useStore.getState().commit((p) => { const c = p.clips.find((c) => c.id === clip.id); if (c) c.name = e.target.value; }, { transient: true })}
          />
          <div className="muted small ins-sub"><CategoryIcon category={item?.category || 'Custom'} size={11} /> {item?.name}{item?.dynamic || clip.dynamic ? ' · animated' : ''}{clip.code ? ' · custom code' : ''}</div>
        </div>
      </div>
      {error && <div className="ins-error" onClick={() => editClipCode(clip.id)}><AlertTriangle size={12} /> {error}</div>}
      <div className="ins-scroll" key={clip.id}>
        <PropsTab clip={clip} focus={focus} />
        <AnimTab clip={clip} focus={focus} />
      </div>
    </aside>
  );
}
