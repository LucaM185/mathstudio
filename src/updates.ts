// Self-update status, mirrored from the main process (electron/main.cjs "updates"). A background
// check that finds a new version shows one toast per version and a dot on the Settings tab.
import { create } from 'zustand';
import { useStore } from './store';
import type { UpdateStatus } from './types';

export const useUpdate = create<{ status: UpdateStatus | null }>(() => ({ status: null }));

let started = false;
let toasted = '';

function apply(s: UpdateStatus) {
  useUpdate.setState({ status: s });
  if (s.state === 'available' && s.silent && s.version && toasted !== s.version) {
    toasted = s.version;
    useStore.getState().toast(`MathStudio ${s.version} is available`, 'info', {
      label: 'View',
      run: () => useStore.setState({ rightTab: 'settings' }),
    });
  }
}

export function initUpdates() {
  const api = window.studio.updates;
  if (!api || started) return;
  started = true;
  api.onState(apply);
  api.get().then(apply).catch(() => {});
}

/** worth a dot on the Settings tab */
export const hasUpdate = (s: UpdateStatus | null) => !!s && (s.state === 'available' || s.state === 'ready' || s.state === 'downloading');

export function formatBytes(n?: number) {
  if (!n && n !== 0) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 100 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function timeAgo(iso: string | null) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
