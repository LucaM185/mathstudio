// Client for the python render engine
import type { FrameMeta, LibraryData, LibraryItem, Project } from './types';
import { useStore } from './store';
import type { GlInfo } from './quality';

export function base() {
  const port = useStore.getState().port;
  return `http://127.0.0.1:${port}`;
}

export async function fetchHealth(): Promise<{ ok: boolean; gl?: GlInfo }> {
  const r = await fetch(`${base()}/health`);
  return r.json();
}

export async function fetchLibrary(): Promise<LibraryData> {
  const r = await fetch(`${base()}/library`);
  return r.json();
}

export interface SearchHit { id: string; score: number; tier: 'match' | 'related' }
export interface SearchResponse {
  results: SearchHit[];
  semantic: boolean;
  /** semantic model state: idle | loading | downloading | ready | unavailable */
  status: string;
  related: string | null;
}

export async function searchLibrary(q: string, signal?: AbortSignal): Promise<SearchResponse> {
  const r = await fetch(`${base()}/search?q=${encodeURIComponent(q)}`, { signal });
  if (!r.ok) throw new Error(`search failed: ${r.status}`);
  return r.json();
}

export function thumbUrl(item: string, animated = false) {
  return `${base()}/thumb/${item}.${animated ? 'gif' : 'png'}`;
}

export function fileUrl(name: string) {
  return `${base()}/file?path=${encodeURIComponent(name)}`;
}

export async function fetchCode(project: Project): Promise<string> {
  const r = await fetch(`${base()}/code`, { method: 'POST', body: JSON.stringify({ project }) });
  const j = await r.json();
  return j.code;
}

export async function fetchClipSource(clip: any, template = false): Promise<{ code: string; dynamic: boolean }> {
  const r = await fetch(`${base()}/clip-source`, { method: 'POST', body: JSON.stringify({ clip, template }) });
  return r.json();
}

export async function importAsset(path: string): Promise<{ name: string; kind: 'image' | 'svg'; width?: number; height?: number }> {
  const r = await fetch(`${base()}/import-asset`, { method: 'POST', body: JSON.stringify({ path }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}

export async function startExport(body: any): Promise<string> {
  const r = await fetch(`${base()}/export`, { method: 'POST', body: JSON.stringify(body) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.job;
}

export async function exportStatus(job: string) {
  const r = await fetch(`${base()}/export/${job}`);
  return r.json();
}

export async function cancelExport(job: string) {
  await fetch(`${base()}/export/${job}/cancel`, { method: 'POST' });
}

export async function exportCode(project: Project, out: string) {
  const r = await fetch(`${base()}/export-code`, { method: 'POST', body: JSON.stringify({ project, out }) });
  return r.json();
}

/**
 * Latest-wins frame fetcher. Up to MAX_IN_FLIGHT requests run at once so the engine already has
 * the next frame queued while the app reads, draws and re-renders the previous one (one at a time
 * left the engine idle ~15 ms out of every ~40 ms frame). Newer requests replace each other while
 * the pipe is full, and a response older than the frame on screen is dropped, so the preview
 * always converges on the latest state.
 */
const MAX_IN_FLIGHT = 2;

export class FrameFetcher {
  private inFlight = 0;
  private pending: { project: Project; t: number; w: number; h: number; view?: { x: number; y: number; zoom: number } | null } | null = null;
  private seq = 0;
  private shown = 0;
  constructor(private onFrame: (data: Uint8ClampedArray, meta: FrameMeta, project: Project) => void, private onError: (e: any) => void) {}

  request(project: Project, t: number, w: number, h: number, view?: { x: number; y: number; zoom: number } | null) {
    this.pending = { project, t, w, h, view };
    if (this.inFlight < MAX_IN_FLIGHT) this.pump();
  }

  get isBusy() {
    return this.inFlight > 0;
  }

  private async pump() {
    if (!this.pending || this.inFlight >= MAX_IN_FLIGHT) return;
    const job = this.pending;
    this.pending = null;
    this.inFlight++;
    const seq = ++this.seq;
    try {
      const r = await fetch(`${base()}/frame`, {
        method: 'POST',
        // the engine keeps one preview state per open project
        body: JSON.stringify({ project: job.project, t: job.t, w: job.w, h: job.h, view: job.view || undefined, seq, state: useStore.getState().sessionId }),
      });
      if (!r.ok) throw new Error(`engine returned ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const meta: FrameMeta = JSON.parse(decodeURIComponent(r.headers.get('X-Meta') || '{}'));
      const buf = await r.arrayBuffer();
      if (seq > this.shown) {
        this.shown = seq;
        this.onFrame(new Uint8ClampedArray(buf), meta, job.project);
      }
    } catch (e) {
      if (seq > this.shown) this.onError(e);
    } finally {
      this.inFlight--;
      if (this.pending) this.pump();
    }
  }
}

/** One-off frame render (used by the AI agent). Returns the meta and, if asked, a PNG data URL. */
export async function renderFrame(project: Project, t: number, w: number, h: number, png = true, state?: string): Promise<{ meta: FrameMeta; png?: string }> {
  const r = await fetch(`${base()}/frame`, { method: 'POST', body: JSON.stringify({ project, t, w, h, state }) });
  if (!r.ok) throw new Error(`engine returned ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const meta: FrameMeta = JSON.parse(decodeURIComponent(r.headers.get('X-Meta') || '{}'));
  const buf = await r.arrayBuffer();
  if (!png) return { meta };
  const canvas = new OffscreenCanvas(meta.w, meta.h);
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(buf), meta.w, meta.h), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const url = await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
  return { meta, png: url };
}

// ------------------------------------------------------------------ "My mobjects" (made from projects)
export interface MakeMobjectRequest {
  project: Project;
  name: string;
  desc?: string;
  visibility: 'public' | 'private';
  mode: 'animated' | 'still';
  at?: number;
  thumb_t?: number;
  /** id of an earlier mobject made from this project, to replace */
  replace?: string | null;
  source_path?: string | null;
}

async function postJson(path: string, body: any) {
  const r = await fetch(`${base()}${path}`, { method: 'POST', body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `engine returned ${r.status}` }));
  if (j.error) throw new Error(j.error);
  return j;
}

/** Turn a whole project into a library mobject. The engine forces it public on the Free plan. */
export async function makeMobject(req: MakeMobjectRequest): Promise<LibraryItem> {
  return (await postJson('/user-mobjects', req)).item;
}

export async function updateMobject(id: string, patch: { name?: string; desc?: string; visibility?: 'public' | 'private' }): Promise<LibraryItem> {
  return (await postJson('/user-mobjects/update', { id, ...patch })).item;
}

export async function deleteMobject(id: string): Promise<boolean> {
  return (await postJson('/user-mobjects/delete', { id })).ok;
}

/** Fetch the library again (after making / changing / deleting one of the user's mobjects). */
export async function reloadLibrary() {
  const lib = await fetchLibrary();
  useStore.setState({ library: lib });
  return lib;
}

/** A small looping GIF (+ PNG poster) of a whole project: the preview of a saved version. */
export async function projectGif(project: Project, posterT?: number): Promise<{ gif: string; png: string }> {
  return postJson('/project-gif', { project, w: 288, h: 162, frames: 18, poster_t: posterT });
}
