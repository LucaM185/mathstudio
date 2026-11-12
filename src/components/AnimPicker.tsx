import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { AnimIcon } from '../icons';
import { base } from '../engine';
import { useStore } from '../store';
import { clone } from '../ops';
import { partTiming, partWindows, setPart } from '../parts';
import type { AnimOption, Project } from '../types';

export function animThumbUrl(kind: 'enter' | 'exit' | 'effect', id: string) {
  return `${base()}/anim-thumb/${kind}/${id}.gif`;
}

const short = (l: string) => l.replace(' (no animation)', '').replace('…', '');

type Kind = 'enter' | 'exit' | 'effect';

/**
 * A scratch copy of the project with `type` applied to one part of a clip, plus the
 * scene-time window that shows that animation (with a little context either side).
 */
export function buildAnimPreview(project: Project, clipId: string, kind: Kind, effId: string | undefined, type: string, label: string, part?: string) {
  const p = clone(project);
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return null;
  const end = c.start + c.duration;
  let t0: number;
  let t1: number;
  if (part !== undefined && kind !== 'effect') {
    // one part of a group: loop around that part's enter / exit
    const tm0 = partTiming(c, part);
    const cur = kind === 'enter' ? tm0.enter : tm0.exit;
    setPart(c, part, { [kind]: { ...cur, type, duration: cur.duration || 0.5 } });
    const tm = partTiming(c, part);
    const [ed, xd] = partWindows(tm);
    if (kind === 'enter') {
      t0 = c.start + tm.at - 0.25;
      t1 = c.start + tm.at + Math.max(ed, 0.4) + 0.5;
    } else {
      t0 = c.start + tm.until - Math.max(xd, 0.4) - 0.5;
      t1 = c.start + tm.until + 0.3;
    }
  } else if (kind === 'enter') {
    c.enter = { ...c.enter, type, duration: c.enter.duration || 1 };
    const d = Math.min(c.enter.duration, c.duration);
    t0 = c.start - 0.25;
    t1 = c.start + Math.max(d, 0.4) + 0.5;
  } else if (kind === 'exit') {
    c.exit = { ...c.exit, type, duration: c.exit.duration || 1 };
    const d = Math.min(c.exit.duration, c.duration);
    t0 = end - Math.max(d, 0.4) - 0.5;
    t1 = end + 0.3;
  } else {
    const e = c.effects.find((x) => x.id === effId);
    if (!e) return null;
    e.type = type;
    t0 = c.start + e.at - 0.3;
    t1 = c.start + e.at + e.duration + 0.4;
  }
  const dur = p.settings.duration;
  t0 = Math.max(0, Math.max(c.start - 0.25, t0));
  t1 = Math.min(dur, Math.min(end + 0.3, t1));
  if (t1 - t0 < 0.1) t1 = Math.min(dur, t0 + 0.1);
  return { project: p, t0, t1, label };
}

export type AnchorRect = { left: number; right: number; top: number; bottom: number };

const POP_W = 360;

/** The animation chooser popup (GIF preview + tile grid), positioned next to an anchor rect. */
export function AnimPopover({
  kind,
  value,
  options,
  anchor,
  align = 'right',
  onChange,
  onClose,
  ignore,
  testid,
  title,
  clipId,
  effId,
  part,
}: {
  kind: 'enter' | 'exit' | 'effect';
  value: string;
  options: AnimOption[];
  anchor: AnchorRect;
  /** preview on one part of a group clip (path, see Clip.parts) */
  part?: string;
  /** when set, the candidate animation plays on this clip in the main viewer instead of a GIF box */
  clipId?: string;
  effId?: string;
  /** which anchor edge the popup lines up with */
  align?: 'left' | 'right';
  onChange: (id: string) => void;
  onClose: () => void;
  /** pointer-downs inside this element don't count as "outside" (the owner handles them) */
  ignore?: () => Element | null | undefined;
  testid?: string;
  title?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const previewIdRef = useRef(value);
  previewIdRef.current = hover ?? value;
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const ignoreRef = useRef(ignore);
  ignoreRef.current = ignore;

  useLayoutEffect(() => {
    const h = pop.current?.offsetHeight || 420;
    const x = Math.max(8, Math.min(window.innerWidth - POP_W - 8, align === 'left' ? anchor.left : anchor.right - POP_W));
    let y: number;
    if (anchor.bottom + 4 + h <= window.innerHeight - 8) y = anchor.bottom + 4; // below
    else if (anchor.top - 4 - h >= 8) y = anchor.top - 4 - h; // above
    else y = Math.max(8, window.innerHeight - h - 8);
    setPos({ x, y });
  }, [anchor.left, anchor.right, anchor.top, anchor.bottom, align]);

  useEffect(() => {
    // pointerdown (capture) rather than mousedown: the timeline preventDefaults pointerdown,
    // which suppresses the compatibility mouse events
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || ignoreRef.current?.()?.contains(t)) return;
      closeRef.current();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', esc, true);
    window.addEventListener('blur', closeRef.current);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', esc, true);
      window.removeEventListener('blur', closeRef.current);
    };
  }, []);

  const previewId = hover ?? value;
  const live = !!clipId;

  // play the hovered (or current) animation on the real object in the main viewer
  const previewLabel = short(options.find((o) => o.id === previewId)?.label || previewId || '');
  useEffect(() => {
    if (!clipId) return;
    const st = useStore.getState();
    const ap = buildAnimPreview(st.project, clipId, kind, effId, previewId, previewLabel, part);
    useStore.setState({ animPreview: ap, ...(st.playing ? { playing: false } : {}) });
  }, [clipId, effId, kind, previewId, previewLabel, part]);
  useEffect(() => {
    if (!clipId) return;
    // keep the scratch project in sync if the real one changes while open (e.g. duration edits)
    const unsub = useStore.subscribe((s, prev) => {
      if (s.project === prev.project || !s.animPreview) return;
      const ap = buildAnimPreview(s.project, clipId, kind, effId, previewIdRef.current, s.animPreview.label, part);
      useStore.setState({ animPreview: ap });
    });
    return () => {
      unsub();
      useStore.setState({ animPreview: null });
    };
  }, [clipId, effId, kind, part]);

  return createPortal(
    <div
      className="anim-pop"
      ref={pop}
      style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      data-testid={testid ? `${testid}-pop` : undefined}
    >
      {title && <div className="anim-pop-title">{title}</div>}
      {live ? (
        <div className="anim-pop-hint">Hover to preview in the viewer</div>
      ) : (
      <div className="anim-preview">
        {previewId && previewId !== 'none' ? (
          <img key={previewId} src={animThumbUrl(kind, previewId)} alt="" />
        ) : (
          <div className="anim-preview-none">No animation — the object simply {kind === 'exit' ? 'disappears' : 'appears'}</div>
        )}
        <span className="anim-preview-label">{previewLabel}</span>
      </div>
      )}
      <div className="anim-grid">
        {options.map((o) => (
          <button
            key={o.id}
            className={`anim-tile ${o.id === value ? 'on' : ''}`}
            data-anim={o.id}
            onMouseEnter={() => setHover(o.id)}
            onMouseLeave={() => setHover(null)}
            onClick={() => {
              onChange(o.id);
              onClose();
            }}
          >
            <AnimIcon id={o.id} size={18} />
            <span>{short(o.label)}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export default function AnimPicker({
  kind,
  value,
  options,
  onChange,
  testid,
  clipId,
  effId,
  part,
}: {
  kind: 'enter' | 'exit' | 'effect';
  value: string;
  options: AnimOption[];
  onChange: (id: string) => void;
  testid?: string;
  clipId?: string;
  effId?: string;
  part?: string;
}) {
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const cur = options.find((o) => o.id === value);

  return (
    <>
      <button
        ref={btn}
        className={`anim-btn ${value === 'none' ? 'is-none' : ''}`}
        onClick={() => setAnchor(anchor ? null : btn.current!.getBoundingClientRect())}
        data-testid={testid}
        title="Choose animation"
      >
        <span className="anim-ico"><AnimIcon id={value} size={15} /></span>
        <span className="anim-lbl">{short(cur?.label || value)}</span>
        <ChevronDown size={14} className="muted" />
      </button>
      {anchor && (
        <AnimPopover kind={kind} value={value} options={options} anchor={anchor} onChange={onChange} onClose={() => setAnchor(null)} ignore={() => btn.current} testid={testid} clipId={clipId} effId={effId} part={part} />
      )}
    </>
  );
}
