import { useStore } from '../store';

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind || 'info'} ${t.action ? 'has-action' : ''}`} data-testid="toast">
          <span>{t.text}</span>
          {t.action && (
            <button
              className="toast-action"
              data-testid="toast-action"
              onClick={() => {
                t.action!.run();
                useStore.setState({ toasts: useStore.getState().toasts.filter((x) => x.id !== t.id) });
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
