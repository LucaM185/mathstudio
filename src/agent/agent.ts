// The agent loop: chat state, streaming, tool execution, and one undo step per turn.
//
// Every open project has its own chat and its own run. A run is bound to its project through a
// DocHandle captured when the message is sent, so the user can switch to another project (and
// start another agent there) while it keeps working — each agent only ever edits its own project.
import { create } from 'zustand';
import { sessionDroppers, sessionKeepers, useStore } from '../store';
import type { AiMessage, Project } from '../types';
import { buildSystemPrompt } from './prompt';
import { TOOL_DEFS, editorState, runTool } from './tools';
import { normalizeProject } from '../ops';
import { activateSession, activeSid, docHandle, pinStripWhile, type DocHandle } from '../sessions';
import { flushSave } from '../autosave';
import { refreshProjectThumb } from '../actions';

const MAX_STEPS = 40;
const S = () => useStore.getState();

export type ChatItem =
  | {
      id: string;
      kind: 'user';
      text: string;
      /** git commit of the project made right before this message was sent */
      checkpoint?: string;
      checkpointError?: string;
      /** same state in memory, used if git is unavailable */
      snapshot?: Project;
      /** length of `history` before this message, to rewind the conversation */
      historyLen: number;
    }
  | { id: string; kind: 'assistant'; text: string; streaming?: boolean }
  | { id: string; kind: 'tool'; name: string; status: 'pending' | 'running' | 'ok' | 'error'; summary: string; args?: any; result?: string; images?: { t: number; url: string }[] }
  | { id: string; kind: 'error'; text: string; retry?: boolean }
  | { id: string; kind: 'done'; changed: boolean; before?: Project; after?: Project; cost?: number; steps: number };

export interface ChatState {
  items: ChatItem[];
  history: AiMessage[];
  running: boolean;
  phase: 'idle' | 'thinking' | 'writing' | 'tools';
  cost: number;
  draft: string;
  /** the agent finished while the user was looking at another project */
  unseen: null | 'done' | 'error';
}

const EMPTY: ChatState = { items: [], history: [], running: false, phase: 'idle', cost: 0, draft: '', unseen: null };

interface AgentsState {
  /** chats by session id */
  chats: Record<string, ChatState>;
  status: { configured: boolean; model: string } | null;
}

export const useAgents = create<AgentsState>(() => ({ chats: {}, status: null }));

export const chatOf = (sid: string): ChatState => useAgents.getState().chats[sid] ?? EMPTY;
function setChat(sid: string, patch: Partial<ChatState>) {
  const chats = useAgents.getState().chats;
  useAgents.setState({ chats: { ...chats, [sid]: { ...(chats[sid] ?? EMPTY), ...patch } } });
}

/** Chat of one project, reactive. */
export function useChat<T>(sid: string, sel: (c: ChatState) => T): T {
  return useAgents((s) => sel(s.chats[sid] ?? EMPTY));
}

type Facade = ChatState & { status: AgentsState['status'] };
function useAgentHook<T>(sel: (s: Facade) => T): T {
  const sid = useStore((s) => s.sessionId);
  return useAgents((s) => sel({ ...(s.chats[sid] ?? EMPTY), status: s.status }));
}
/** The chat of the project on screen (hook + getState/setState, as before projects had their own chats). */
export const useAgent = Object.assign(useAgentHook, {
  getState: (): Facade => ({ ...chatOf(activeSid()), status: useAgents.getState().status }),
  setState: (patch: Partial<Facade>) => {
    const { status, ...rest } = patch;
    if (status !== undefined) useAgents.setState({ status });
    if (Object.keys(rest).length) setChat(activeSid(), rest);
  },
});

const iid = () => Math.random().toString(36).slice(2, 10);

function patchItem(sid: string, id: string, patch: Partial<ChatItem>) {
  setChat(sid, { items: chatOf(sid).items.map((it) => (it.id === id ? ({ ...it, ...patch } as ChatItem) : it)) });
}
function pushItem(sid: string, it: ChatItem) {
  setChat(sid, { items: [...chatOf(sid).items, it] });
}

// ------------------------------------------------------------------ runs (one per project)
interface Run {
  sid: string;
  doc: DocHandle;
  currentReq: string | null;
  streamText: string | null; // assistant item receiving text deltas
  pendingTools: Record<number, string>; // tool-call index -> chat item id
  aborted: boolean;
  turnBefore: Project | null;
  turnPrompt: string;
  turnCost: number;
  turnSteps: number;
}
const runs = new Map<string, Run>();
const reqOwner = new Map<string, string>(); // request id -> session id

function runFor(sid: string): Run {
  let r = runs.get(sid);
  if (!r) {
    r = { sid, doc: docHandle(sid), currentReq: null, streamText: null, pendingTools: {}, aborted: false, turnBefore: null, turnPrompt: '', turnCost: 0, turnSteps: 0 };
    runs.set(sid, r);
  }
  return r;
}

// a project with a chat stays open when the user switches away, and on the strip while it works
sessionKeepers.push((sid) => chatOf(sid).items.length > 0 || chatOf(sid).running);
sessionDroppers.push((sid) => {
  stop(sid);
  runs.delete(sid);
  const { [sid]: _gone, ...rest } = useAgents.getState().chats;
  useAgents.setState({ chats: rest });
});
pinStripWhile((sid) => chatOf(sid).running);

// looking at a project marks its agent's news as seen
useStore.subscribe((s, prev) => {
  if (s.sessionId !== prev.sessionId && chatOf(s.sessionId).unseen) setChat(s.sessionId, { unseen: null });
});

// ------------------------------------------------------------------ streaming events
let listening = false;
function listen() {
  if (listening || !window.studio?.ai) return;
  listening = true;
  window.studio.ai.onEvent((ev) => {
    const sid = reqOwner.get(ev.reqId);
    const run = sid ? runs.get(sid) : undefined;
    if (!run || ev.reqId !== run.currentReq) return;
    if (ev.type === 'text') {
      if (!run.streamText) {
        run.streamText = iid();
        pushItem(run.sid, { id: run.streamText, kind: 'assistant', text: ev.text, streaming: true });
      } else {
        const it = chatOf(run.sid).items.find((x) => x.id === run.streamText);
        if (it && it.kind === 'assistant') patchItem(run.sid, run.streamText, { text: it.text + ev.text });
      }
      if (chatOf(run.sid).phase !== 'writing') setChat(run.sid, { phase: 'writing' });
    } else if (ev.type === 'tool') {
      if (run.streamText) {
        patchItem(run.sid, run.streamText, { streaming: false });
        run.streamText = null;
      }
      const label = ev.name ? `Preparing ${ev.name.replace(/_/g, ' ')}…` : 'Preparing a tool call…';
      if (run.pendingTools[ev.index] === undefined) {
        const id = iid();
        run.pendingTools[ev.index] = id;
        pushItem(run.sid, { id, kind: 'tool', name: ev.name, status: 'pending', summary: label });
      } else if (ev.name) {
        patchItem(run.sid, run.pendingTools[ev.index], { name: ev.name, summary: label } as any);
      }
      if (chatOf(run.sid).phase !== 'tools') setChat(run.sid, { phase: 'tools' });
    }
  });
}

export async function refreshStatus() {
  listen();
  if (!window.studio?.ai) return;
  try {
    useAgents.setState({ status: await window.studio.ai.status() });
  } catch {
    useAgents.setState({ status: { configured: false, model: '' } });
  }
}

// ------------------------------------------------------------------ request building
let systemCache: { lib: any; text: string } | null = null;
function systemPrompt() {
  const lib = S().library!;
  if (!systemCache || systemCache.lib !== lib) systemCache = { lib, text: buildSystemPrompt(lib) };
  return systemCache.text;
}

/** Messages for the API: system + history, with prompt-cache breakpoints on the stable prefix. */
function requestMessages(sid: string): any[] {
  const hist = chatOf(sid).history;
  const msgs: any[] = [{ role: 'system', content: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }] }];
  // breakpoint on the latest user message, so later tool rounds of this turn reuse it
  let lastUser = -1;
  hist.forEach((m, i) => { if (m.role === 'user') lastUser = i; });
  hist.forEach((m, i) => {
    if (i === lastUser) {
      const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : [...(m.content as any[])];
      const last = parts.length - 1;
      parts[last] = { ...parts[last], cache_control: { type: 'ephemeral' } };
      msgs.push({ ...m, content: parts });
    } else msgs.push(m);
  });
  return msgs;
}

// ------------------------------------------------------------------ git checkpoints
function commitMessage(d: DocHandle, prefix: string, prompt: string) {
  const first = prompt.split('\n')[0].trim();
  const subject = first.length > 64 ? `${first.slice(0, 63)}…` : first;
  const { project, filePath } = d.get();
  return `${prefix}: ${subject}\n\n${prompt}\n\nProject: ${project.settings.name}${filePath ? ` (${filePath})` : ''}`;
}

async function checkpoint(project: Project, message: string) {
  if (!window.studio?.checkpoint) return { error: 'checkpoints unavailable' };
  try {
    return await window.studio.checkpoint.create(project, message);
  } catch (e: any) {
    return { error: String(e?.message || e) };
  }
}

/** Commit the project before a message goes to the agent and remember the hash on the message. */
function checkpointBefore(run: Run, itemId: string, project: Project, prompt: string) {
  checkpoint(project, commitMessage(run.doc, 'Before', prompt)).then((r) => {
    patchItem(run.sid, itemId, r.hash ? { checkpoint: r.hash } : { checkpointError: r.error || 'commit failed' } as any);
  });
}

/** Send a message to the agent of a project (by default the one on screen). */
export async function send(text: string, sid = activeSid()) {
  text = text.trim();
  if (!text || chatOf(sid).running) return;
  if (!S().library) return;
  const run = runFor(sid);
  if (!run.doc.alive()) return;
  const before = run.doc.get().project;
  const id = iid();
  pushItem(sid, { id, kind: 'user', text, snapshot: before, historyLen: chatOf(sid).history.length });
  checkpointBefore(run, id, before, text);
  setChat(sid, { history: [...chatOf(sid).history, { role: 'user', content: `${text}\n\n${editorState(run.doc)}` }], draft: '', unseen: null });
  run.turnBefore = before;
  run.turnPrompt = text;
  run.turnCost = 0;
  run.turnSteps = 0;
  await loop(run);
}

/** Retry after an error: the history already ends with the user's (or the tools') message. */
export async function retry(sid = activeSid()) {
  if (chatOf(sid).running) return;
  const run = runFor(sid);
  setChat(sid, { items: chatOf(sid).items.filter((it) => !(it.kind === 'error' && it.retry)) });
  run.turnBefore = run.doc.get().project;
  run.turnCost = 0;
  run.turnSteps = 0;
  await loop(run);
}

export function stop(sid = activeSid()) {
  const run = runs.get(sid);
  if (!run || !chatOf(sid).running) return;
  run.aborted = true;
  if (run.currentReq) window.studio.ai.abort(run.currentReq);
}

export function newChat(sid = activeSid()) {
  if (chatOf(sid).running) return;
  setChat(sid, { items: [], history: [], cost: 0, phase: 'idle', unseen: null });
}

async function loop(run: Run) {
  listen();
  const { sid } = run;
  run.aborted = false;
  setChat(sid, { running: true, phase: 'thinking' });
  try {
    for (; run.turnSteps < MAX_STEPS; run.turnSteps++) {
      if (run.aborted) break;
      if (!run.doc.alive()) break;
      const reqId = iid();
      run.currentReq = reqId;
      reqOwner.set(reqId, sid);
      run.streamText = null;
      run.pendingTools = {};
      setChat(sid, { phase: 'thinking' });
      const res = await window.studio.ai.chat(reqId, {
        messages: requestMessages(sid),
        tools: TOOL_DEFS,
        max_tokens: 16000,
        reasoning: { effort: 'medium' },
      });
      reqOwner.delete(reqId);
      run.currentReq = null;
      if (run.streamText) patchItem(sid, run.streamText, { streaming: false });
      if (res.usage?.cost) {
        run.turnCost += res.usage.cost;
        setChat(sid, { cost: chatOf(sid).cost + res.usage.cost });
      }
      const dropPending = () => {
        const ids = new Set(Object.values(run.pendingTools));
        setChat(sid, { items: chatOf(sid).items.filter((it) => !ids.has(it.id)) });
      };
      if (res.aborted || run.aborted) {
        dropPending();
        const partial = res.partial?.content;
        if (typeof partial === 'string' && partial.trim()) setChat(sid, { history: [...chatOf(sid).history, { role: 'assistant', content: partial }] });
        pushItem(sid, { id: iid(), kind: 'error', text: 'Stopped.' });
        break;
      }
      if (res.error || !res.message) {
        dropPending();
        if (res.code === 'nokey') useAgents.setState({ status: { configured: false, model: useAgents.getState().status?.model || '' } });
        pushItem(sid, { id: iid(), kind: 'error', text: res.error || 'No response from the model.', retry: res.code !== 'nokey' });
        break;
      }
      const msg = res.message;
      const calls = msg.tool_calls || [];
      setChat(sid, { history: [...chatOf(sid).history, { ...msg, content: msg.content || '' }] });
      if (!calls.length) {
        if (res.finish === 'length') pushItem(sid, { id: iid(), kind: 'error', text: 'The reply hit the length limit.', retry: false });
        break;
      }

      // run the tools in order
      setChat(sid, { phase: 'tools' });
      const toolMsgs: AiMessage[] = [];
      const images: { t: number; url: string }[] = [];
      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        let itemId = run.pendingTools[i];
        if (!itemId) {
          itemId = iid();
          pushItem(sid, { id: itemId, kind: 'tool', name: call.function.name, status: 'running', summary: call.function.name });
        } else patchItem(sid, itemId, { status: 'running', name: call.function.name } as any);
        const r = await runTool(run.doc, call.function.name, call.function.arguments);
        patchItem(sid, itemId, { status: r.ok ? 'ok' : 'error', summary: r.summary, args: r.args, result: r.text, images: r.images } as any);
        toolMsgs.push({ role: 'tool', tool_call_id: call.id, content: r.text });
        if (r.images) images.push(...r.images);
      }
      const extra: AiMessage[] = images.length
        ? [{
            role: 'user',
            content: [
              { type: 'text', text: `Rendered preview (${images.map((im) => `t=${Math.round(im.t * 100) / 100}s`).join(', ')}):` },
              ...images.map((im) => ({ type: 'image_url', image_url: { url: im.url } })),
            ],
          }]
        : [];
      setChat(sid, { history: [...chatOf(sid).history, ...toolMsgs, ...extra] });
    }
    if (run.turnSteps >= MAX_STEPS) pushItem(sid, { id: iid(), kind: 'error', text: `Stopped after ${MAX_STEPS} steps. Send a message to continue.` });
  } catch (e: any) {
    pushItem(sid, { id: iid(), kind: 'error', text: `Agent error: ${e?.message || e}`, retry: true });
  } finally {
    if (run.currentReq) reqOwner.delete(run.currentReq);
    run.currentReq = null;
    finishTurn(run);
    setChat(sid, { running: false, phase: 'idle' });
  }
}

/** Turn every change the agent made during the turn into a single undo step (in its own project). */
function finishTurn(run: Run) {
  const d = run.doc;
  const before = run.turnBefore;
  run.turnBefore = null;
  if (!d.alive()) return;
  const after = d.get().project;
  const changed = !!before && before !== after;
  if (changed) {
    d.set({ past: [...d.get().past, before!].slice(-200), future: [] });
    // record what the agent did too, so `git log -p` shows every turn
    checkpoint(after, commitMessage(d, 'Agent', run.turnPrompt || 'retry'));
  }
  const items = chatOf(run.sid).items;
  const last = items[items.length - 1];
  const failed = last?.kind === 'error' && last.text !== 'Stopped.';
  if (!(last?.kind === 'error' && last.retry && !changed)) {
    pushItem(run.sid, { id: iid(), kind: 'done', changed, before: changed ? before! : undefined, after: changed ? after : undefined, cost: run.turnCost, steps: run.turnSteps });
  }
  if (!d.active()) notifyBackground(run, failed, changed);
  // keep the project's thumbnail (strip, projects browser) in step with what the agent made
  if (changed) {
    flushSave(false, run.sid).then(() => {
      const { filePath, project } = d.get();
      if (filePath && project.clips.length) refreshProjectThumb(filePath, project);
    });
  }
}

/** The agent of a project the user isn't looking at finished: badge it and offer to jump there. */
function notifyBackground(run: Run, failed: boolean, changed: boolean) {
  if (run.aborted) return; // stopped on purpose
  setChat(run.sid, { unseen: failed ? 'error' : 'done' });
  const name = run.doc.get().project.settings.name;
  const text = failed ? `Agent hit a problem in “${name}”` : changed ? `Agent finished “${name}”` : `Agent replied in “${name}”`;
  S().toast(text, failed ? 'error' : 'success', { label: 'Show', run: () => activateSession(run.sid) && useStore.setState({ rightTab: 'agent' }) });
}

/** Undo the agent's turn if nothing happened on top of it since. */
export function canUndoTurn(it: ChatItem) {
  if (it.kind !== 'done' || !it.changed) return false;
  const st = S();
  return st.project === it.after && st.past[st.past.length - 1] === it.before;
}
export function undoTurn(it: ChatItem) {
  if (canUndoTurn(it)) S().undo();
}

/**
 * Go back to right before a message: restore the project from that message's git checkpoint and
 * rewind the conversation (the message goes back into the input box). The state being left is
 * committed first and pushed as one undo step, so the restore itself can be undone with ⌘Z.
 */
export async function rewindTo(itemId: string, sid = activeSid()): Promise<boolean> {
  if (chatOf(sid).running) return false;
  const it = chatOf(sid).items.find((x) => x.id === itemId);
  if (!it || it.kind !== 'user') return false;
  const d = runFor(sid).doc;

  let target: Project | undefined;
  let source = 'git';
  if (it.checkpoint && window.studio?.checkpoint) {
    const r = await window.studio.checkpoint.read(it.checkpoint);
    if (r.data) {
      // keep the in-memory object when identical: other references (undo history) stay valid
      target = it.snapshot && JSON.stringify(r.data) === JSON.stringify(it.snapshot) ? it.snapshot : normalizeProject(r.data);
    }
  }
  if (!target && it.snapshot) {
    target = it.snapshot;
    source = 'memory';
  }
  if (!target) {
    S().toast('This checkpoint could not be read.', 'error');
    return false;
  }
  if (chatOf(sid).running || !d.alive()) return false; // a new turn started while reading

  const cur = d.get().project;
  if (cur !== target) {
    checkpoint(cur, commitMessage(d, 'Before restore', it.text));
    const ids = new Set(target.clips.map((c) => c.id));
    d.set({
      project: target,
      past: [...d.get().past, cur].slice(-200),
      future: [],
      dirty: true,
      selection: d.get().selection.filter((id) => ids.has(id)),
      selectedKey: null,
    });
    if (d.active()) useStore.setState({ animPreview: null });
    d.setTime(d.get().time);
  }
  const items = chatOf(sid).items;
  const idx = items.findIndex((x) => x.id === itemId);
  setChat(sid, { items: items.slice(0, idx), history: chatOf(sid).history.slice(0, it.historyLen), draft: it.text, phase: 'idle' });
  S().toast(cur !== target ? `Restored the project to before this message${source === 'memory' ? '' : ` (${it.checkpoint!.slice(0, 7)})`} · ⌘Z undoes` : 'Rewound the chat (the project was unchanged)', 'success');
  window.dispatchEvent(new Event('agent:focus'));
  return true;
}
