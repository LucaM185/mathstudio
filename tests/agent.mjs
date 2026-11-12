// Live test of the AI agent (calls OpenRouter — costs a few cents).
//   node tests/agent.mjs ["prompt 1" "prompt 2" ...]
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.E2E_OUT || path.join(ROOT, 'tests', 'out', 'agent');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-agent-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_DATA: process.env.MS_DATA || path.join(TMP, 'data'), MATHSTUDIO_TEST_CONFIRM: '0' });

const prompts = process.argv.slice(2).length ? process.argv.slice(2) : [
  'Plot sin(x) on axes and trace a glowing dot along the curve',
  'Add a title "The sine wave" at the top that writes in, and make the curve yellow',
];

const fails = [];
const check = (cond, msg) => { (cond ? console.log('   ✓', msg) : (fails.push(msg), console.log('   ✗', msg))); };

const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
// 422s come from timeline thumbnails of clips whose code is momentarily broken
win.on('console', (m) => m.type() === 'error' && !/status of 422/.test(m.text()) && errors.push(m.text()));
await win.waitForSelector('.lib-card', { timeout: 90000 });

await win.click('[data-testid=right-tab-agent]');
await win.waitForSelector('[data-testid=agent-panel]');
await win.waitForTimeout(400);
await win.screenshot({ path: path.join(OUT, '00-empty.png') });
const status = await win.evaluate(() => window.__ms.agent.useAgent.getState().status);
check(status?.configured, `key configured (model ${status?.model})`);

let i = 0;
for (const prompt of prompts) {
  i++;
  console.log(`\n▶ ${prompt}`);
  await win.fill('[data-testid=agent-input]', prompt);
  await win.keyboard.press('Enter');
  const t0 = Date.now();
  await win.waitForFunction(() => window.__ms.agent.useAgent.getState().running, null, { timeout: 10000 });
  let n = 0;
  while (await win.evaluate(() => window.__ms.agent.useAgent.getState().running)) {
    if (Date.now() - t0 > 300000) { fails.push('timeout'); break; }
    await win.waitForTimeout(1500);
    if (++n === 4) await win.screenshot({ path: path.join(OUT, `${i}-a-working.png`) });
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(OUT, `${i}-b-done.png`) });
  const r = await win.evaluate(() => {
    const a = window.__ms.agent.useAgent.getState();
    const s = window.__ms.store.getState();
    return {
      items: a.items.map((it) => ({ kind: it.kind, text: it.text, name: it.name, status: it.status, summary: it.summary, result: it.kind === 'tool' ? String(it.result || '').slice(0, 600) : undefined, steps: it.steps, cost: it.cost })),
      cost: a.cost,
      clips: s.project.clips.map((c) => ({ id: c.id, name: c.name, item: c.item, start: c.start, duration: c.duration, code: c.code })),
      errors: s.meta?.errors || {},
      past: s.past.length,
    };
  });
  for (const it of r.items) {
    if (it.kind === 'tool') console.log(`   [${it.status}] ${it.summary}${it.status === 'error' ? '  → ' + it.result : ''}`);
    else if (it.kind === 'assistant') console.log(`   💬 ${it.text.replace(/\n/g, ' ⏎ ').slice(0, 400)}`);
    else if (it.kind === 'error') console.log(`   ⚠ ${it.text}`);
    else if (it.kind === 'done') console.log(`   — done: ${it.steps} steps, $${(it.cost || 0).toFixed(4)}`);
    else if (it.kind === 'user') console.log(`   👤 ${it.text}`);
  }
  console.log(`   clips: ${r.clips.map((c) => `${c.name}[${c.item}] ${c.start}-${(c.start + c.duration).toFixed(2)}`).join(' | ')}`);
  console.log(`   ${secs}s, chat cost $${r.cost.toFixed(4)}`);
  check(r.items.some((it) => it.kind === 'assistant' && it.text?.trim()), 'agent replied');
  check(!r.items.some((it) => it.kind === 'error' && it.text !== 'Stopped.'), 'no agent errors');
  check(r.clips.length > 0, 'project has clips');
  check(Object.keys(r.errors).length === 0, `no render errors ${JSON.stringify(r.errors).slice(0, 300)}`);
  fs.writeFileSync(path.join(OUT, `${i}-state.json`), JSON.stringify(r, null, 2));
}

// undo the last turn as one step
const before = await win.evaluate(() => window.__ms.store.getState().project.clips.length);
const undoBtn = win.locator('[data-testid=agent-undo]').last();
const visible = await undoBtn.isVisible().catch(() => false);
check(visible, 'undo button visible on the last turn');
if (visible) {
  await undoBtn.click();
  await win.waitForTimeout(300);
  const after = await win.evaluate(() => { const s = window.__ms.store.getState(); return { future: s.future.length, clips: s.project.clips.length }; });
  check(after.future === 1, `one undo step reverted the turn (clips ${before} → ${after.clips})`);
  await win.evaluate(() => window.__ms.store.getState().redo());
}
await win.click('[data-testid=right-tab-inspector]');
await win.waitForTimeout(300);
check((await win.locator('.inspector').count()) > 0, 'inspector tab still works');

check(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
await app.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
