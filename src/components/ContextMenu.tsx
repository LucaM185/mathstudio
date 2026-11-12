import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  label?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  danger?: boolean;
  sep?: boolean;
  submenu?: MenuItem[];
}

export default function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [open, setOpen] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);

  // Parents pass a fresh onClose every render. Re-subscribing on each one would drop Escape: the
  // app's own Escape handler re-renders the parent first, and a listener swapped mid-dispatch never runs.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onClose = () => onCloseRef.current();
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // deferred so the click that opened the menu doesn't close it; the timer must be cleared too,
    // or a re-run before it fires leaks a listener that later closes newer menus on mousedown
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0);
    window.addEventListener('keydown', esc);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, []);

  return (
    <div className="ctx-menu" ref={ref} style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <div
            key={i}
            className={`ctx-item ${it.disabled ? 'disabled' : ''} ${it.danger ? 'danger' : ''}`}
            onMouseEnter={() => setOpen(it.submenu ? i : null)}
            onClick={() => {
              if (it.disabled || it.submenu) return;
              it.action?.();
              onClose();
            }}
          >
            <span className="ctx-label"><span className="ctx-icon">{it.icon}</span>{it.label}</span>
            {it.shortcut && <span className="sc">{it.shortcut}</span>}
            {it.submenu && <span className="sc">▸</span>}
            {it.submenu && open === i && (
              <div className="ctx-menu sub">
                {it.submenu.map((s, j) => (
                  <div
                    key={j}
                    className="ctx-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      s.action?.();
                      onClose();
                    }}
                  >
                    <span className="ctx-label"><span className="ctx-icon">{s.icon}</span>{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}
