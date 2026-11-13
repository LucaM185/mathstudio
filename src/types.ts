import type { RenderQuality } from './quality';

export type ParamType = 'number' | 'int' | 'color' | 'text' | 'latex' | 'expr' | 'bool' | 'select' | 'asset';

export interface ParamDef {
  id: string;
  label: string;
  type: ParamType;
  default: any;
  min?: number | null;
  max?: number | null;
  step?: number;
  options?: string[];
  /** display names for select options */
  labels?: Record<string, string>;
  multiline?: boolean;
  hint?: string;
  accept?: string;
}

export interface LibraryItem {
  id: string;
  name: string;
  category: string;
  enter?: string;
  dynamic?: boolean;
  hidden?: boolean;
  desc?: string;
  tags?: string[];
  params: ParamDef[];
  code: string;
  /** imported (mathstudio library) items: the file it came from, its licence, non-commercial flag */
  category_source?: string;
  rel?: string;
  kind?: string;
  source?: string;
  license?: string;
  nc?: boolean;
  fn?: string;
  /** imported items: the definition written at the top of the scene */
  prelude?: string;
  /** "My mobjects": made from a whole project (engine/library_user.py) */
  user?: boolean;
  visibility?: 'public' | 'private';
  author?: string;
  mode?: 'animated' | 'still';
  duration?: number;
  source_path?: string | null;
  source_name?: string;
  created?: number;
  updated?: number;
  warnings?: string[];
}

export interface AnimOption {
  id: string;
  label: string;
}

export interface LibraryData {
  items: LibraryItem[];
  import_failures?: { rel: string; error: string }[];
  categories: string[];
  animations: { enter: AnimOption[]; exit: AnimOption[]; effects: AnimOption[]; rates: string[] };
  frame: [number, number];
}

export interface Transform {
  x: number;
  y: number;
  /** depth (towards the viewer in the default view); only matters with a tilted 3D camera */
  z: number;
  scale: number;
  /** degrees, counter-clockwise in the clip's own plane (about z) */
  rotation: number;
  /** 3D orientation (degrees), applied after `rotation`: tip about x, then turn about y.
   *  rx = -90 lays flat content on the XZ floor (readable from the Top view). */
  rx?: number;
  ry?: number;
  opacity: number;
}

export interface Keyframe extends Transform {
  id: string;
  t: number; // relative to clip start
  ease?: string;
}

export interface AnimSpec {
  type: string;
  duration: number;
  rate?: string;
  target?: string | null;
}

export interface Effect {
  id: string;
  type: string;
  at: number; // relative to clip start
  duration: number;
  rate?: string;
}

/**
 * Timing of one submobject of a group clip (VGroup, Group, Tex / Text glyphs, Axes...). Keyed in
 * Clip.parts by its path: child indices from the clip's mobject, e.g. "2" or "1.0". Missing fields
 * fall back to the nearest overridden ancestor part, then to the clip itself.
 */
export interface PartSpec {
  /** seconds from the clip start at which the part appears */
  at?: number;
  /** seconds from the clip start at which it is gone */
  until?: number;
  enter?: AnimSpec;
  exit?: AnimSpec;
  /** moved by (dx, dy) from where the clip's code puts it, in the clip's own (unscaled, unrotated)
   * units; a part inside a moved group moves with it */
  dx?: number;
  dy?: number;
}

/** Structure of a clip's mobject as the engine reports it (POST /clip-parts). */
export interface PartNode {
  path: string;
  /** ManimGL class ("VGroup", "Square", "glyph"...) */
  type: string;
  /** the variable it was bound to in the clip's code, or the glyph / string it draws */
  label: string | null;
  /** number of submobjects */
  n: number;
  /** box in the clip's own (unscaled, centred) coordinates */
  bbox: [number, number, number, number];
  children?: PartNode[];
  truncated?: boolean;
}

export interface Clip {
  id: string;
  name: string;
  item: string;
  track: string;
  start: number;
  duration: number;
  params: Record<string, any>;
  code?: string | null;
  dynamic?: boolean;
  /** pinned to the screen: ignores the camera (titles and labels over a 3D scene) */
  fixed?: boolean;
  transform: Transform;
  /** x / y that follow an expression over number globals (e.g. "TOP_Y - 2*ROW_GAP") */
  layout?: { x?: string; y?: string };
  keys: Keyframe[];
  enter: AnimSpec;
  exit: AnimSpec;
  effects: Effect[];
  /** per-part timing of a group's submobjects, by path (see PartSpec) */
  parts?: Record<string, PartSpec>;
}

export interface Track {
  id: string;
  name: string;
  hidden?: boolean;
  locked?: boolean;
}

export interface Asset {
  id: string;
  name: string; // file name inside the engine asset store
  label: string;
  kind: 'image' | 'svg';
  width?: number | null;
  height?: number | null;
}

export interface CameraKey {
  id: string;
  t: number; // absolute scene time
  x: number;
  y: number;
  /** centre of view z (3D) */
  z?: number;
  zoom: number;
  /** ManimGL Euler angles in degrees (frame.reorient): theta turns around z, phi tilts, gamma rolls */
  theta?: number;
  phi?: number;
  gamma?: number;
  ease?: string;
}

export interface CamView { x: number; y: number; z: number; zoom: number; theta: number; phi: number; gamma: number }

export interface Settings {
  camera?: CameraKey[];
  name: string;
  duration: number;
  fps: number;
  background: string;
  resolution: [number, number];
}

export type GlobalType = 'number' | 'color' | 'font' | 'text' | 'bool';

/** A project-wide constant (font, size, spacing, colour…) written at the top of scene.py. */
export interface GlobalVar {
  id: string;
  /** Python identifier used in code, e.g. FONT_SIZE */
  name: string;
  type: GlobalType;
  value: any;
  /** what it controls (shown as a tooltip; the agent writes these) */
  note?: string;
}

export interface Project {
  version: 1;
  settings: Settings;
  tracks: Track[];
  clips: Clip[];
  assets: Asset[];
  /** agent-editable copies of imported definitions, keyed by fn (see engine codegen.effective_imports) */
  imports?: { fn: string; code: string }[];
  /** shared constants, editable in the Globals panel; clip code reads them by name */
  globals?: GlobalVar[];
}

export interface ClipInfo {
  bbox: [number, number, number, number] | null;
  zr?: [number, number] | null;
  w: number;
  h: number;
  d?: number;
  x: number;
  y: number;
  z?: number;
  fixed?: boolean;
  rotation: number;
  rx?: number;
  ry?: number;
  scale: number;
  phase: string;
  /** set when invisible parts (layout frames) make the full box bigger than what is drawn:
   * w/h/bbox then describe the drawn content, (ox, oy) is its centre relative to the clip position
   * in unscaled, unrotated base units, and full / full_bbox the whole mobject */
  ox?: number;
  oy?: number;
  full?: [number, number];
  full_bbox?: [number, number, number, number] | null;
}

export interface FrameMeta {
  t: number;
  w: number;
  h: number;
  frame: [number, number];
  clips: Record<string, ClipInfo>;
  camera?: CamView;
  view?: CamView;
  errors: Record<string, string>;
  /** problems with project globals (bad or reserved names), by global name */
  global_errors?: Record<string, string>;
  ms: number;
  seq: number;
}

export interface AiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | any[] | null;
  tool_calls?: AiToolCall[];
  tool_call_id?: string;
  reasoning_details?: any[];
}

export interface AiChatResult {
  message?: AiMessage;
  finish?: string | null;
  usage?: { prompt_tokens: number; completion_tokens: number; cost?: number } | null;
  error?: string;
  code?: string;
  aborted?: boolean;
  partial?: AiMessage;
}

export interface ProjectEntry {
  path: string;
  /** file name without extension */
  name: string;
  /** project name stored inside the file */
  title?: string;
  /** last time it was opened / saved in MathStudio (ms), 0 if only found in the projects folder */
  opened: number;
  exists: boolean;
  inFolder: boolean;
  /** cached thumbnail is from an older version of the file */
  thumbStale?: boolean;
  mtime?: number;
  size?: number;
  duration?: number;
  clips?: number;
  background?: string;
  thumb?: string;
  error?: string;
  /** macOS privacy protection refused access to the file (fix in System Settings) */
  blocked?: boolean;
  /** liked by the user: heart on the card, listed first */
  favorite?: boolean;
  /** versions saved with ⌘S (see Projects → ⋯ → See history) */
  versions?: number;
}

/** A project in the MathStudio Trash (restorable until `expires`). */
/** One ⌘S version of a project (a commit in its history). */
export interface ProjectVersion {
  id: string;
  parent: string | null;
  time: number;
  hash: string;
  /** automatic summary of what changed since the previous version */
  message: string;
  /** the user's own name for it, shown instead of the message */
  label?: string;
  stats?: { added: number; edited: number; removed: number };
  name: string;
  clips: number;
  duration: number;
  background: string;
  /** 1-based, oldest = 1 (list only) */
  version?: number;
  poster?: string;
  hasGif?: boolean;
  /** the file on disk is exactly this version */
  current?: boolean;
}

export interface TrashedProject extends ProjectEntry {
  id: string;
  /** where it lived before it was deleted (restore puts it back there) */
  original: string;
  deletedAt: number;
  expires: number;
}

export type AiStreamEvent =
  | { reqId: string; type: 'text'; text: string }
  | { reqId: string; type: 'reasoning'; text: string }
  | { reqId: string; type: 'tool'; index: number; name: string; chars: number };

export interface AppSettings {
  quality: RenderQuality;
  /** the OpenRouter key in use: typed in Settings, from the environment, or from a .env file */
  key: { set: boolean; source: 'settings' | 'environment' | 'env-file' | null; masked: string };
  model: string;
  file: string;
}

/** Self-update status from the main process (electron/main.cjs "updates"). */
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error';
  /** install = AppImage replaces itself; notify = only a link to the download page; source = running from a checkout */
  mode: 'install' | 'notify' | 'source';
  current: string;
  version?: string;
  notes?: string;
  date?: string | null;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  error?: string;
  /** set when a background check (not the button) found the update */
  silent?: boolean;
  page: string | null;
  autoCheck: boolean;
  lastCheck: string | null;
}

declare global {
  interface Window {
    studio: {
      enginePort: () => Promise<number | { error: string }>;
      onEnginePort: (cb: (p: number) => void) => void;
      onEngineStatus: (cb: (s: string) => void) => void;
      onMenu: (cb: (cmd: string) => void) => void;
      onClosing: (cb: () => void | Promise<void>) => void;
      openProject: () => Promise<{ path: string; data: Project } | null>;
      readProject: (p: string) => Promise<{ path: string; data: Project }>;
      saveProject: (path: string | null, data: Project, saveAs?: boolean) => Promise<string | null>;
      autosaveProject: (path: string | null, data: Project) => Promise<{ path?: string; error?: string; disabled?: boolean }>;
      autosaveEnabled: () => Promise<boolean>;
      projects: {
        list: () => Promise<{ dir: string; projects: ProjectEntry[] }>;
        saveThumb: (path: string, png: string) => Promise<boolean>;
        forget: (path: string) => Promise<boolean>;
        favorite: (path: string, on: boolean) => Promise<boolean>;
        trash: (path: string) => Promise<{ ok?: boolean; id?: string; error?: string }>;
        trashList: () => Promise<{ days: number; items: TrashedProject[] }>;
        restore: (id: string) => Promise<{ path?: string; error?: string }>;
        /** one id = "Delete now", none = "Empty Trash"; both go on to the macOS Trash */
        purge: (id?: string) => Promise<{ ok?: boolean; count?: number; error?: string }>;
        duplicate: (path: string) => Promise<{ path?: string; error?: string }>;
        rename: (path: string, name: string) => Promise<{ path?: string; error?: string }>;
        dir: () => Promise<string>;
        peek: (path: string) => Promise<{ data?: Project; error?: string }>;
      };
      history: {
        /** record a version of the (just written) file; `message` replaces the automatic summary, `note` is appended to it */
        commit: (path: string, opts?: { message?: string; note?: string }) => Promise<{ hid?: string; commit?: ProjectVersion; version?: number; unchanged?: boolean; error?: string }>;
        list: (path: string) => Promise<{ hid: string | null; commits: ProjectVersion[]; changedSinceLast?: boolean; error?: string }>;
        gif: (hid: string, id: string) => Promise<string | null>;
        attach: (hid: string, id: string, gif: string, png: string) => Promise<boolean>;
        read: (hid: string, id: string) => Promise<{ data?: Project; error?: string }>;
        label: (hid: string, id: string, label: string) => Promise<{ ok?: boolean; error?: string }>;
        checkout: (hid: string, id: string, path: string) => Promise<{ path?: string; error?: string }>;
      };
      account: () => Promise<{ plan: 'free' | 'pro'; name: string }>;
      autosaveWrite: (data: any) => Promise<boolean>;
      autosaveRead: () => Promise<any>;
      startupProjects?: () => Promise<boolean>;
      chooseMedia: () => Promise<string[]>;
      chooseExportPath: (name: string, format: string) => Promise<string | null>;
      chooseDir: () => Promise<string | null>;
      reveal: (p: string) => Promise<void>;
      openPrivacySettings: () => Promise<void>;
      openPath: (p: string) => Promise<void>;
      setTitle: (t: string) => Promise<void>;
      confirm: (message: string, detail?: string, buttons?: string[]) => Promise<number>;
      pathForFile: (f: File) => string;
      checkpoint: {
        create: (data: Project, message: string) => Promise<{ hash?: string; error?: string }>;
        read: (hash: string) => Promise<{ data?: Project; error?: string }>;
        dir: () => Promise<string>;
      };
      settings?: {
        get: () => Promise<AppSettings>;
        set: (patch: { quality?: RenderQuality; openrouterKey?: string | null }) => Promise<AppSettings & { error?: string }>;
        testKey: (key?: string) => Promise<{ ok: boolean; error?: string; label?: string; usage?: number; limit?: number | null; freeTier?: boolean }>;
      };
      updates?: {
        get: () => Promise<UpdateStatus>;
        check: () => Promise<UpdateStatus>;
        download: () => Promise<UpdateStatus & { error?: string }>;
        install: () => Promise<{ ok?: boolean; error?: string }>;
        setAuto: (on: boolean) => Promise<UpdateStatus>;
        openPage: () => Promise<void>;
        onState: (cb: (s: UpdateStatus) => void) => () => void;
      };
      openExternal?: (url: string) => Promise<void>;
      ai: {
        status: () => Promise<{ configured: boolean; model: string }>;
        chat: (reqId: string, body: any) => Promise<AiChatResult>;
        abort: (reqId: string) => Promise<boolean>;
        onEvent: (cb: (ev: AiStreamEvent) => void) => () => void;
      };
      platform: string;
    };
  }
}
