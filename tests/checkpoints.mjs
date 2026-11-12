// Agent git checkpoints + back button. The OpenRouter call is replaced by a scripted mock in the
// main process, so this test is free and deterministic.
//   node tests/checkpoints.mjs
import { _electron as electron } from 'playwright';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.E2E_OUT || path.join(ROOT, 'tests', 'out', 'checkpoints');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-cp-'));

const fails = [];
const check = (cond, msg) => { (cond ? console.log('   ✓', msg) : (fails.push(msg), console.log('   ✗', msg))); };

/** Mock model: a message mentioning a library item adds it, then the model replies in text. */
function installMock({ ipcMain }) {
  ipcMain.removeHandler('ai:status');
  ipcMain.removeHandler('ai:chat');
  ipcMain.handle('ai:status', async () => ({ configured: true, model: 'mock/scripted' }));
  ipcMain.handle('ai:chat', async (_e, { body }) => {
    const last = body.messages[body.messages.length - 1];
    const text = typeof last.content === 'string' ? last.content : (last.content.find((p) => p.type === 'text') || {}).text || '';
    if (/slow/.test(text)) await new Promise((r) => setTimeout(r, 2500));
    const m = last.role === 'user' && text.match(/add an? (\w+)/);
    if (m) {
      return {
        message: { role: 'assistant', content: '', tool_calls: [{ id: `call_${Date.now()}`, type: 'function', function: { name: 'add_clips', arguments: JSON.stringify({ clips: [{ item: m[1], start: 0, duration: 3 }] }) } }] },
        finish: 'tool_calls',
        usage: { cost: 0 },
      };
    }
    return { message: { role: 'assistant', content: 'Done.' }, finish: 'stop', usage: { cost: 0 } };
  });
}

async function launch(checkpointDir) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
  Object.assign(env, { MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_HIDDEN: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'), MATHSTUDIO_TEST_CONFIRM: '0', MATHSTUDIO_CHECKPOINTS: checkpointDir });
  const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
  await app.evaluate(installMock);
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => m.type() === 'error' && !/status of 422/.test(m.text()) && errors.push(m.text()));
  await win.setViewportSize({ width: 1600, height: 950 });
  await win.waitForSelector('.lib-card', { timeout: 90000 });
  await win.click('[data-testid=right-tab-agent]');
  await win.waitForSelector('[data-testid=agent-panel]');
  await win.evaluate(() => window.__ms.agent.refreshStatus());
  return { app, win, errors };
}

const state = (win) => win.evaluate(() => {
  const a = window.__ms.agent.useAgent.getState();
  const s = window.__ms.store.getState();
  return {
    items: a.items.map((it) => ({ kind: it.kind, text: it.text, checkpoint: it.checkpoint, checkpointError: it.checkpointError })),
    history: a.history.length,
    draft: a.draft,
    running: a.running,
    clips: s.project.clips.map((c) => c.item),
    past: s.past.length,
  };
});

async function sendMsg(win, text) {
  await win.fill('[data-testid=agent-input]', text);
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => window.__ms.agent.useAgent.getState().running, null, { timeout: 5000 }).catch(() => {});
  await win.waitForFunction(() => !window.__ms.agent.useAgent.getState().running, null, { timeout: 30000 });
  // the checkpoint hash arrives asynchronously
  await win.waitForFunction(() => window.__ms.agent.useAgent.getState().items.filter((i) => i.kind === 'user').every((i) => i.checkpoint || i.checkpointError), null, { timeout: 5000 });
}

const gitLog = (dir) => execFileSync('git', ['log', '--format=%s'], { cwd: dir, encoding: 'utf8' }).trim().split('\n');
const gitShow = (dir, rev) => JSON.parse(execFileSync('git', ['show', `${rev}:project.mstudio`], { cwd: dir, encoding: 'utf8' }));

// ================================================================== 1. git checkpoints
{
  console.log('\n▶ checkpoints with git');
  const CP = path.join(TMP, 'checkpoints');
  const { app, win, errors } = await launch(CP);

  await sendMsg(win, 'add a circle');
  await sendMsg(win, 'add a square');
  let s = await state(win);
  check(JSON.stringify(s.clips) === '["circle","square"]', `agent added two clips (${s.clips})`);
  const users = s.items.filter((i) => i.kind === 'user');
  check(users.length === 2 && users.every((u) => /^[0-9a-f]{40}$/.test(u.checkpoint || '')), 'each message has a git commit');
  await win.waitForTimeout(300); // the post-turn "Agent:" commit is written asynchronously
  const log = gitLog(CP);
  check(JSON.stringify(log) === JSON.stringify(['Agent: add a square', 'Before: add a square', 'Agent: add a circle', 'Before: add a circle']), `git log: ${log.join(' | ')}`);
  check(gitShow(CP, users[0].checkpoint).clips.length === 0, 'first checkpoint = empty project');
  check(gitShow(CP, users[1].checkpoint).clips.map((c) => c.item).join() === 'circle', 'second checkpoint = circle only');
  await win.screenshot({ path: path.join(OUT, '1-chat.png') });

  // back on the 2nd message
  const backs = await win.$$('[data-testid=agent-back]');
  check(backs.length === 2, 'a back button per message');
  await backs[1].hover();
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '2-hover.png') });
  await backs[1].click();
  await win.waitForSelector('[data-testid=agent-back-confirm]');
  await win.screenshot({ path: path.join(OUT, '3-confirm.png') });
  await win.click('[data-testid=agent-back-go]');
  await win.waitForFunction(() => window.__ms.store.getState().project.clips.length === 1, null, { timeout: 5000 }).catch(() => {});
  await win.waitForTimeout(300);
  s = await state(win);
  check(s.clips.join() === 'circle', `project restored to before message 2 (${s.clips})`);
  check(s.items.filter((i) => i.kind === 'user').length === 1, 'chat rewound to message 1');
  check(s.items[s.items.length - 1].kind === 'done', 'message 1 turn kept intact');
  check(s.draft === 'add a square', 'message text back in the input');
  check(await win.evaluate(() => document.activeElement?.dataset?.testid) === 'agent-input', 'input focused');
  await win.screenshot({ path: path.join(OUT, '4-restored.png') });
  await win.waitForTimeout(200);
  check(gitLog(CP)[0] === 'Before restore: add a square', 'state before restore committed');
  check(gitShow(CP, 'HEAD').clips.length === 2, 'that commit holds both clips');

  // ⌘Z undoes the restore, redo re-applies it
  await win.evaluate(() => window.__ms.store.getState().undo());
  s = await state(win);
  check(s.clips.join() === 'circle,square', 'undo brings the agent changes back');
  await win.evaluate(() => window.__ms.store.getState().redo());
  s = await state(win);
  check(s.clips.join() === 'circle', 'redo restores again');

  // the agent's conversation history continues consistently after a rewind
  await win.fill('[data-testid=agent-input]', '');
  await sendMsg(win, 'add a triangle');
  s = await state(win);
  check(s.clips.join() === 'circle,triangle', `new branch after rewind (${s.clips})`);
  const hist = await win.evaluate(() => window.__ms.agent.useAgent.getState().history.filter((m) => m.role === 'user' && typeof m.content === 'string').map((m) => m.content.split('\n')[0]));
  check(JSON.stringify(hist) === '["add a circle","add a triangle"]', `model history has no trace of the rewound message (${hist})`);

  // back disabled while the agent runs
  await win.fill('[data-testid=agent-input]', 'slow add a star');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => window.__ms.agent.useAgent.getState().running, null, { timeout: 5000 });
  const disabled = await win.$$eval('[data-testid=agent-back]', (bs) => bs.every((b) => b.disabled));
  check(disabled, 'back buttons disabled while the agent works');
  await win.waitForFunction(() => !window.__ms.agent.useAgent.getState().running, null, { timeout: 30000 });

  // back on the very first message: empty project, empty chat
  await win.waitForTimeout(200);
  await (await win.$$('[data-testid=agent-back]'))[0].click();
  await win.click('[data-testid=agent-back-go]');
  await win.waitForTimeout(400);
  s = await state(win);
  check(s.clips.length === 0 && s.items.length === 0 && s.history === 0, 'back to the first message: empty project and chat');
  check(s.draft === 'add a circle', 'first message back in the input');
  await win.screenshot({ path: path.join(OUT, '5-first.png') });

  // cancel does nothing
  await win.fill('[data-testid=agent-input]', '');
  await sendMsg(win, 'add a circle');
  await (await win.$$('[data-testid=agent-back]'))[0].click();
  await win.click('[data-testid=agent-back-confirm] button:has-text("Cancel")');
  s = await state(win);
  check(s.clips.length === 1 && !(await win.$('[data-testid=agent-back-confirm]')), 'cancel keeps everything');

  check(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await app.close();
}

// ================================================================== 2. git unavailable → in-memory fallback
{
  console.log('\n▶ fallback when the checkpoint repo cannot be created');
  const blocker = path.join(TMP, 'not-a-dir');
  fs.writeFileSync(blocker, 'x');
  const { app, win, errors } = await launch(path.join(blocker, 'checkpoints'));
  await sendMsg(win, 'add a circle');
  let s = await state(win);
  const u = s.items.find((i) => i.kind === 'user');
  check(!u.checkpoint && !!u.checkpointError, `commit failed gracefully (${String(u.checkpointError).slice(0, 80)})`);
  check(s.clips.join() === 'circle', 'agent still works');
  await win.click('[data-testid=agent-back]');
  await win.click('[data-testid=agent-back-go]');
  await win.waitForTimeout(400);
  s = await state(win);
  check(s.clips.length === 0 && s.draft === 'add a circle', 'restored from the in-memory copy');
  check(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await app.close();
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
