// Preview render quality (Settings tab). ManimGL renders every preview frame with OpenGL; on a
// machine without a usable GPU driver that is Mesa's llvmpipe on the CPU, where cost grows with
// the pixel count — so the presets cap the preview resolution. Exports always use the export
// dialog's resolution.

export type RenderQuality = 'auto' | 'high' | 'balanced' | 'low';
export type FixedQuality = Exclude<RenderQuality, 'auto'>;

export interface GlInfo {
  renderer: string;
  vendor: string;
  version: string;
  /** true = software rasterizer (llvmpipe, SwiftShader…), null = unknown */
  software: boolean | null;
  error?: string;
}

/** max preview width in pixels: when idle, and while playing / dragging */
export const QUALITY_PRESETS: Record<FixedQuality, { idle: number; moving: number; label: string; note: string }> = {
  high: { idle: 1920, moving: 1280, label: 'High', note: 'Sharp preview up to 1920 px. Needs a GPU.' },
  balanced: { idle: 1280, moving: 832, label: 'Balanced', note: 'Up to 1280 px, lighter while playing.' },
  low: { idle: 960, moving: 640, label: 'Low', note: 'Up to 960 px — for CPU / software rendering.' },
};

export const QUALITY_ORDER: RenderQuality[] = ['auto', 'high', 'balanced', 'low'];

export function effectiveQuality(q: RenderQuality, gl: GlInfo | null): FixedQuality {
  if (q !== 'auto') return q;
  return gl?.software ? 'low' : 'high';
}

export function previewCap(q: RenderQuality, gl: GlInfo | null, moving: boolean) {
  const p = QUALITY_PRESETS[effectiveQuality(q, gl)];
  return moving ? p.moving : p.idle;
}
