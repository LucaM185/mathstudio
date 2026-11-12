// Quick project switching + parallel agents. The model is a scripted mock in the main process
// (free, deterministic, slow on purpose) so we can jump between projects while agents work.
//   node tests/parallel_agents.mjs        (after `vite build`)
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out', 'parallel'); fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-par-'));
const DIR = path.join(TMP, 'Projects'); fs.mkdirSync(DIR);
const RECENTS = path.join(TMP, 'state', 'recent-projects.json');
const fails = []; const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };

const mini = (name, bg) => ({ version: 1, settings: { name, duration: 6, fps: 30, background: bg, resolution: [1920, 1080] }, tracks: [{ id: 't1', name: 'Track 1' }], clips: [], assets: [] });
const P = { Alpha: path.join(DIR, 'Alpha.mstudio'), Beta: path.join(DIR, 'Beta.mstudio'), Gamma: path.join(DIR, 'Gamma.mstudio') };
fs.writeFileSync(P.Alpha, JSON.stringify(mini('Alpha', '#1e1e1e')));
fs.writeFileSync(P.Beta, JSON.stringify(mini('Beta', '#10202a')));
fs.writeFileSync(P.Gamma, JSON.stringify(mini('Gamma', '#2a1020')));
fs.mkdirSync(path.dirname(RECENTS), { recursive: true });
fs.writeFileSync(RECENTS, JSON.stringify([
  { path: P.Alpha, opened: Date.now() - 1000 },
  { path: P.Beta, opened: Date.now() - 2000 },
  { path: P.Gamma, opened: Date.now() - 3000 },
]));

/**
 * Mock model. "tag X: add N item" → N rounds of add_clips (one clip named X-i each, ~STEP ms per
 * round), then a render_preview, then a text reply. Each project's agent sends its own history, so
 * if two agents got mixed up the clip names/counts would show it.
 */
function installMock({ ipcMain }) {
  const STEP = 700;
  const textOf = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n'));
  global.__mockCalls = [];
  ipcMain.removeHandler('ai:status');
  ipcMain.removeHandler('ai:chat');
  ipcMain.handle('ai:status', async () => ({ configured: true, model: 'mock/scripted' }));
  ipcMain.handle('ai:chat', async (e, { reqId, body }) => {
    const msgs = body.messages;
    let ui = msgs.length - 1;
    while (ui >= 0 && !(msgs[ui].role === 'user' && /tag \w+:/.test(textOf(msgs[ui])))) ui--;
    const m = ui >= 0 && textOf(msgs[ui]).match(/tag (\w+): add (\d+) (\w+)/);
    if (!m) return { message: { role: 'assistant', content: 'ok' }, finish: 'stop', usage: { cost: 0 } };
    const [, tag, nStr, item] = m;
    const n = Number(nStr);
    const done = msgs.slice(ui).filter((x) => x.role === 'tool').length;
    global.__mockCalls.push({ tag, done, at: Date.now() });
    e.sender.send('ai:event', { reqId, type: 'text', text: `Working on ${tag}… ` });
    await new Promise((r) => setTimeout(r, STEP));
    const call = (name, args) => ({ message: { role: 'assistant', content: `Working on ${tag}… `, tool_calls: [{ id: `call_${tag}_${done}_${Date.now()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish: 'tool_calls', usage: { cost: 0.001 } });
    if (done < n) return call('add_clips', { clips: [{ item, name: `${tag}-${done + 1}`, start: done, duration: 2, x: -4 + done * 2.5 }] });
    if (done === n) return call('render_preview', { times: [0.5] });
    e.sender.send('ai:event', { reqId, type: 'text', text: `Done with ${tag}.` });
    return { message: { role: 'assistant', content: `Working on ${tag}… Done with ${tag}.` }, finish: 'stop', usage: { cost: 0.001 } };
  });
}

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, {
  MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_HIDDEN: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'),
  MATHSTUDIO_PROJECTS_DIR: DIR, MATHSTUDIO_RECENTS: RECENTS, MATHSTUDIO_TEST_CONFIRM: '0',
  MATHSTUDIO_CHECKPOINTS: path.join(TMP, 'cp'),
});
const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
await app.evaluate(installMock);
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
win.on('console', (m) => m.type() === 'error' && !/status of 422/.test(m.text()) && errors.push(m.text()));
await win.setViewportSize({ width: 1600, height: 950 });
await win.waitForSelector('.lib-card', { timeout: 90000 });
await win.evaluate(() => window.__ms.agent.refreshStatus());

const shot = (n) => win.screenshot({ path: path.join(OUT, `${n}.png`) });
const cur = () => win.evaluate(() => { const s = window.__ms.store.getState(); return { sid: s.sessionId, name: s.project.settings.name, path: s.filePath, clips: s.project.clips.map((c) => c.name), past: s.past.length }; });
const pills = () => win.$$eval('[data-testid=strip-pill]', (els) => els.map((e) => ({ id: e.dataset.id, name: e.dataset.name, current: !!e.dataset.current, running: !!e.dataset.running, unseen: e.dataset.unseen || null })));
const pill = (name) => `[data-testid=strip-pill][data-name="${name}"]`;
/** every open project, by name: clip names, undo depth, chat */
const world = () => win.evaluate(() => {
  const ms = window.__ms;
  const out = {};
  const st = ms.store.getState();
  const add = (sid, d) => {
    const c = ms.agent.chatOf(sid);
    out[d.project.settings.name] = {
      sid, path: d.filePath, dirty: d.dirty, clips: d.project.clips.map((c) => c.name), past: d.past.length,
      running: c.running, unseen: c.unseen, users: c.items.filter((i) => i.kind === 'user').map((i) => i.text),
      tools: c.items.filter((i) => i.kind === 'tool').map((i) => `${i.status}:${i.summary}`),
      replies: c.items.filter((i) => i.kind === 'assistant').map((i) => i.text),
      done: c.items.filter((i) => i.kind === 'done').length,
    };
  };
  add(st.sessionId, st);
  for (const [sid, d] of Object.entries(ms.bg.getState().docs)) add(sid, d);
  return out;
});
async function send(text) {
  await win.click('[data-testid=right-tab-agent]');
  await win.fill('[data-testid=agent-input]', text);
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => window.__ms.agent.useAgent.getState().running, null, { timeout: 5000 });
}
const anyRunning = () => win.evaluate(() => Object.values(window.__ms.agent.useAgents.getState().chats).some((c) => c.running));

try {
  console.log('▸ the strip shows recent projects');
  await win.waitForSelector(pill('Alpha'), { timeout: 8000 });
  let ps = await pills();
  check(['Alpha', 'Beta', 'Gamma'].every((n) => ps.some((p) => p.name === n)), `recent projects on the strip: ${ps.map((p) => p.name).join(', ')}`);
  // Chrome-style tabs: right after the Projects button, hanging from the bar's bottom edge
  const lay = await win.evaluate(() => {
    const btn = document.querySelector('[data-testid=projects-btn]').getBoundingClientRect();
    const tabs = [...document.querySelectorAll('[data-testid=strip-pill]')].map((e) => e.getBoundingClientRect());
    const bar = document.querySelector('.topbar').getBoundingClientRect();
    const plus = document.querySelector('[data-testid=strip-new]')?.getBoundingClientRect();
    const exp = document.querySelector('[data-testid=export-btn]').getBoundingClientRect();
    return { gap: tabs[0].left - btn.right, bottom: Math.max(...tabs.map((t) => t.bottom)) - bar.bottom, plus: plus && plus.left >= tabs[tabs.length - 1].right - 1, right: exp.right - bar.right };
  });
  check(lay.gap >= 0 && lay.gap < 40 && Math.abs(lay.bottom) <= 1 && lay.plus && lay.right > -20, `tabs follow Projects and sit on the bar's bottom edge, + after them, Export at the right (${JSON.stringify(lay)})`);
  await shot('01-strip');

  console.log('▸ switch to Alpha with one click, start an agent');
  await win.click(pill('Alpha'));
  await win.waitForFunction((p) => window.__ms.store.getState().filePath === p, P.Alpha, { timeout: 5000 });
  check((await cur()).name === 'Alpha', 'Alpha is on screen');
  ps = await pills();
  check(!ps.some((p) => p.name === 'Untitled'), 'the empty Untitled project left the strip');
  check(ps.find((p) => p.current)?.name === 'Alpha', 'Alpha pill is the current one');
  await send('tag A: add 3 circle');
  const alphaSid = (await cur()).sid;

  console.log('▸ jump to Beta while Alpha\'s agent works');
  await win.waitForTimeout(400);
  const t0 = Date.now();
  await win.click(pill('Beta'));
  await win.waitForFunction((p) => window.__ms.store.getState().filePath === p, P.Beta, { timeout: 5000 });
  check(Date.now() - t0 < 1500, `switch is quick (${Date.now() - t0} ms)`);
  let w = await world();
  check(w.Alpha?.running === true, 'Alpha\'s agent is still running in the background');
  check(w.Beta.clips.length === 0, 'Beta is untouched');
  check(await win.evaluate(() => !window.__ms.agent.useAgent.getState().running), 'the agent panel shows Beta\'s (idle) chat');
  check(await win.$eval('[data-testid=agent-panel]', (e) => !e.textContent.includes('tag A')), 'Alpha\'s messages are not in Beta\'s chat');
  ps = await pills();
  check(ps.find((p) => p.name === 'Alpha')?.running, 'Alpha pill shows the agent working');
  await win.hover(pill('Alpha'));
  await win.waitForSelector('[data-testid=strip-card]', { timeout: 3000 });
  const card = await win.$eval('[data-testid=strip-card]', (e) => e.textContent);
  check(/AI working/.test(card), `hover card shows live agent activity ("${card.slice(0, 90)}")`);
  await shot('02-hover-running');
  await win.mouse.move(800, 500);

  console.log('▸ start a second agent in Beta (parallel)');
  await send('tag B: add 2 square');
  w = await world();
  check(w.Alpha.running && w.Beta.running, 'both agents running at the same time');
  await shot('03-two-running');

  console.log('▸ hop around while both work: Gamma, ⌘1, ⌃Tab');
  await win.click(pill('Gamma'));
  await win.waitForFunction((p) => window.__ms.store.getState().filePath === p, P.Gamma, { timeout: 5000 });
  await win.waitForTimeout(500);
  // the agent box has focus: shortcuts must still work
  await win.click('[data-testid=right-tab-agent]');
  await win.focus('[data-testid=agent-input]');
  const order = await win.evaluate(() => window.__ms.sessions.useStrip.getState().order);
  const firstName = (await pills())[0].name;
  await win.keyboard.press('Meta+1');
  await win.waitForFunction((n) => window.__ms.store.getState().project.settings.name === n, firstName, { timeout: 3000 }).catch(() => {});
  check((await cur()).name === firstName, `⌘1 (typing in the agent box) switches to the first pill: ${firstName}`);
  const before = (await cur()).name;
  await win.keyboard.press('Control+Tab');
  await win.waitForTimeout(150);
  check((await cur()).name === 'Gamma' && before !== 'Gamma', `⌃Tab goes back to the previous project (${before} → ${(await cur()).name})`);
  await win.keyboard.press('Control+Tab');
  await win.waitForTimeout(150);
  check((await cur()).name === before, '⌃Tab again toggles back');
  // rapid-fire switching while tools land
  for (let i = 0; i < 12; i++) {
    await win.click(pill(['Alpha', 'Beta', 'Gamma'][i % 3]));
    await win.waitForTimeout(90 + (i % 4) * 60);
  }
  await win.click(pill('Gamma'));
  check(order.length >= 3, 'strip order kept');

  console.log('▸ wait for both agents');
  const deadline = Date.now() + 40000;
  while ((await anyRunning()) && Date.now() < deadline) await win.waitForTimeout(250);
  check(!(await anyRunning()), 'both agents finished');
  w = await world();
  console.log('     Alpha:', JSON.stringify(w.Alpha.clips), 'Beta:', JSON.stringify(w.Beta.clips), 'Gamma:', JSON.stringify(w.Gamma?.clips));
  check(JSON.stringify(w.Alpha.clips) === JSON.stringify(['A-1', 'A-2', 'A-3']), 'Alpha has exactly its agent\'s 3 clips');
  check(JSON.stringify(w.Beta.clips) === JSON.stringify(['B-1', 'B-2']), 'Beta has exactly its agent\'s 2 clips');
  check((w.Gamma?.clips || []).length === 0, 'Gamma (looked at during the runs) is untouched');
  check(w.Alpha.users.length === 1 && w.Alpha.users[0].includes('tag A') && w.Beta.users.length === 1 && w.Beta.users[0].includes('tag B'), 'each chat holds only its own messages');
  check(w.Alpha.tools.length === 4 && w.Alpha.tools.every((t) => t.startsWith('ok:')), `Alpha's tool calls all succeeded (${w.Alpha.tools.join(' | ')})`);
  check(w.Beta.tools.length === 3 && w.Beta.tools.every((t) => t.startsWith('ok:')), `Beta's tool calls all succeeded (${w.Beta.tools.join(' | ')})`);
  check(w.Alpha.replies.at(-1)?.includes('Done with A') && w.Beta.replies.at(-1)?.includes('Done with B'), 'each agent finished its own reply');
  check(!w.Alpha.replies.join().includes(' B') && !w.Beta.replies.join().includes(' A…'), 'no streamed text leaked between chats');
  check(w.Alpha.past === 1 && w.Beta.past === 1, `each agent turn is one undo step in its own project (Alpha ${w.Alpha.past}, Beta ${w.Beta.past})`);
  const calls = await app.evaluate(() => global.__mockCalls);
  const aCalls = calls.filter((c) => c.tag === 'A'); const bCalls = calls.filter((c) => c.tag === 'B');
  const overlap = aCalls.some((a) => bCalls.some((b) => Math.abs(a.at - b.at) < 700));
  check(overlap, 'the two agents really ran in parallel (interleaved model calls)');

  await shot('04-both-done');

  console.log('▸ autosave wrote each project to its own file');
  await win.waitForTimeout(1500);
  const disk = (p) => JSON.parse(fs.readFileSync(p, 'utf8')).clips.map((c) => c.name);
  check(JSON.stringify(disk(P.Alpha)) === JSON.stringify(['A-1', 'A-2', 'A-3']), `Alpha.mstudio on disk: ${JSON.stringify(disk(P.Alpha))}`);
  check(JSON.stringify(disk(P.Beta)) === JSON.stringify(['B-1', 'B-2']), `Beta.mstudio on disk: ${JSON.stringify(disk(P.Beta))}`);
  check(disk(P.Gamma).length === 0, 'Gamma.mstudio untouched');
  w = await world();
  check(!w.Alpha.dirty && !w.Beta.dirty, 'background projects are saved (not dirty)');

  console.log('▸ open Alpha: chat, undo and badge come back');
  await win.click(pill('Alpha'));
  await win.waitForFunction((p) => window.__ms.store.getState().filePath === p, P.Alpha);
  check((await pills()).find((p) => p.name === 'Alpha')?.unseen == null, 'badge cleared once looked at');
  const panelText = await win.$eval('[data-testid=agent-panel]', (e) => e.textContent);
  check(panelText.includes('tag A: add 3 circle') && panelText.includes('Done with A'), 'Alpha\'s conversation is back in the panel');
  check(await win.$$eval('[data-testid=agent-undo]', (els) => els.length) === 1, 'the turn\'s Undo button is available');
  await win.click('[data-testid=agent-undo]');
  check((await cur()).clips.length === 0, 'undo removes Alpha\'s agent work…');
  w = await world();
  check(w.Beta.clips.length === 2, '…and leaves Beta alone');
  await win.evaluate(() => window.__ms.store.getState().redo());
  check((await cur()).clips.length === 3, 'redo brings it back');
  await shot('05-alpha-back');

  console.log('▸ a background agent that finishes pops a toast with "Show"');
  // earlier turns' "Agent finished" toasts may still be up (they last 8 s): start from a clean slate
  await win.evaluate(() => window.__ms.store.setState({ toasts: [] }));
  await send('tag C: add 1 circle');
  await win.click(pill('Gamma'));
  await win.waitForSelector('[data-testid=toast]:has([data-testid=toast-action]):has-text("Alpha")', { timeout: 15000 });
  const toast = await win.$eval('[data-testid=toast]:has([data-testid=toast-action])', (e) => e.textContent);
  check(/Agent finished “Alpha”/.test(toast), `toast: ${toast}`);
  ps = await pills();
  check(ps.find((p) => p.name === 'Alpha')?.unseen === 'done', `Alpha pill has the finished-while-away badge (${ps.map((p) => `${p.name}:${p.unseen}`).join(' ')})`);
  await shot('06-toast');
  await win.click('[data-testid=toast-action]');
  await win.waitForFunction((p) => window.__ms.store.getState().filePath === p, P.Alpha, { timeout: 3000 }).catch(() => {});
  check((await cur()).name === 'Alpha', '"Show" jumps to the project');
  check(await win.evaluate(() => window.__ms.store.getState().rightTab) === 'agent', '…with the agent panel open');
  check(JSON.stringify((await cur()).clips) === JSON.stringify(['A-1', 'A-2', 'A-3', 'C-1']), `second turn landed in Alpha only ${JSON.stringify((await cur()).clips)}`);

  console.log('▸ projects browser knows about the agents');
  await send('tag D: add 2 circle');
  await win.click(pill('Beta'));
  await win.click('[data-testid=projects-btn]');
  await win.waitForSelector('[data-testid=project-card]');
  check(await win.$(`[data-testid=project-card][data-path$="/Alpha.mstudio"] [data-testid=project-ai-badge]`) !== null, 'Alpha card shows "AI working"');
  await shot('07-projects-ai');
  // switching from the browser to an open project keeps its run going
  await win.click(`[data-testid=project-card][data-path$="/Alpha.mstudio"]`);
  await win.waitForFunction((p) => window.__ms.store.getState().filePath === p, P.Alpha, { timeout: 5000 });
  check(await win.evaluate(() => window.__ms.agent.useAgent.getState().running), 'opening Alpha from the browser reattaches to its running agent');
  while (await anyRunning()) await win.waitForTimeout(200);
  check(JSON.stringify((await cur()).clips) === JSON.stringify(['A-1', 'A-2', 'A-3', 'C-1', 'D-1', 'D-2']), `third turn done in Alpha ${JSON.stringify((await cur()).clips)}`);

  console.log('▸ stop works per project');
  await send('tag E: add 5 circle');
  await win.click(pill('Beta'));
  await send('tag F: add 5 square');
  await win.click('[data-testid=agent-stop]');
  await win.waitForFunction(() => !window.__ms.agent.useAgent.getState().running, null, { timeout: 5000 });
  w = await world();
  check(w.Alpha.running && !w.Beta.running, 'stopping Beta\'s agent leaves Alpha\'s running');
  while (await anyRunning()) await win.waitForTimeout(200);
  w = await world();
  check(w.Alpha.clips.filter((c) => c.startsWith('E-')).length === 5, 'Alpha\'s agent completed all 5 steps');

  console.log('▸ new project + close a pill');
  await win.evaluate(() => window.__ms.actions.newProjectAction());
  await win.waitForTimeout(300);
  ps = await pills();
  check(ps.find((p) => p.current)?.name === 'Untitled' && ps.some((p) => p.name === 'Alpha'), 'new project is current; Alpha stays on the strip');
  await win.hover(pill('Gamma'));
  await win.click(`${pill('Gamma')} [data-testid=strip-close]`);
  await win.waitForTimeout(200);
  check(!(await pills()).some((p) => p.name === 'Gamma'), 'closing a pill removes it');
  // the strip re-reads the recent-projects list when the Projects popup closes: Gamma must stay gone
  await win.evaluate(() => window.__ms.store.setState({ projectsOpen: true }));
  await win.waitForTimeout(200);
  await win.evaluate(() => window.__ms.store.setState({ projectsOpen: false }));
  await win.waitForTimeout(800);
  check(!(await pills()).some((p) => p.name === 'Gamma'), `a closed pill stays closed after the strip refreshes: ${(await pills()).map((p) => p.name).join(', ')}`);
  const dis = await win.evaluate(() => localStorage.getItem('ms.strip.dismissed'));
  check(!!dis && dis.includes('Gamma.mstudio'), 'the closed file is remembered across launches');
  // opening it again puts it back
  await win.evaluate((p) => window.__ms.actions.switchToProject(p, { quiet: true }), P.Gamma);
  await win.waitForTimeout(500);
  check((await pills()).some((p) => p.name === 'Gamma' && p.current), 'reopening a closed project brings its pill back');
  check(!(await win.evaluate(() => localStorage.getItem('ms.strip.dismissed') || '')).includes('Gamma.mstudio'), 'reopening forgets the dismissal');
  await shot('08-final');

  console.log('▸ Chrome-style tabs: + opens a new tab at the end, closing the tab on screen shows its neighbour');
  const nTabs = (await pills()).length;
  await win.click('[data-testid=strip-new]');
  await win.waitForTimeout(400);
  ps = await pills();
  check(ps.length === nTabs + 1 && ps[ps.length - 1].current && ps[ps.length - 1].name === 'Untitled', `+ adds a current tab on the right: ${ps.map((p) => p.name + (p.current ? '*' : '')).join(', ')}`);
  await win.fill('[data-testid=strip-pill][data-current] input.project-name', 'Delta');
  await win.waitForTimeout(100);
  check((await win.evaluate(() => window.__ms.store.getState().project.settings.name)) === 'Delta', 'renaming happens in the tab on screen');
  const left = ps[ps.length - 2].name;
  await win.click('[data-testid=strip-pill][data-current] [data-testid=strip-close]');
  await win.waitForTimeout(500);
  ps = await pills();
  check(!ps.some((p) => p.name === 'Delta') && ps.find((p) => p.current)?.name === left, `closing the tab on screen switches to its neighbour (${left}): ${ps.map((p) => p.name + (p.current ? '*' : '')).join(', ')}`);
  await shot('09-tabs');

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  console.error(e);
  fails.push(String(e));
  await shot('error').catch(() => {});
} finally {
  await app.close();
}
console.log(fails.length ? `\n✗ ${fails.length} failed:\n - ${fails.join('\n - ')}` : '\n✓ all parallel-agent checks passed');
process.exit(fails.length ? 1 : 0);
