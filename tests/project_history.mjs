// Version history: ⌘S records a version (git-like commit + small GIF); Projects → ⋯ → See history
// lists them, plays the GIF on hover, restores (undoable) or opens a copy; ids survive autosave,
// rename, duplicate (forked).   node tests/project_history.mjs
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out'); fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-history-'));
const DIR = path.join(TMP, 'Projects'); fs.mkdirSync(DIR);
const RECENTS = path.join(TMP, 'state', 'recent-projects.json');
const HIST = path.join(TMP, 'state', 'project-history');
const fails = []; const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };

// a project with no versions yet, for the empty state
fs.writeFileSync(path.join(DIR, 'Plain.mstudio'), JSON.stringify({ version: 1, settings: { name: 'Plain', duration: 4, fps: 30, background: '#1e1e1e', resolution: [1920, 1080] }, tracks: [{ id: 't1', name: 'Track 1' }], clips: [], assets: [] }));

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, {
  MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_HIDDEN: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'), MATHSTUDIO_STARTUP_PROJECTS: '0',
  MATHSTUDIO_PROJECTS_DIR: DIR, MATHSTUDIO_RECENTS: RECENTS, MATHSTUDIO_TEST_CONFIRM: '0', MATHSTUDIO_TEST_TRASH_UNLINK: '1',
});
const errors = [];
const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
const win = await app.firstWindow();
win.on('pageerror', (e) => errors.push(e.message));
await win.setViewportSize({ width: 1500, height: 950 });
await win.waitForSelector('.lib-card', { timeout: 90000 });
await win.waitForFunction(() => window.__ms.store.getState().engineStatus === 'ready', null, { timeout: 90000 });

const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
const st = (fn, arg) => win.evaluate(fn, arg);
const lastToast = () => win.evaluate(() => { const t = window.__ms.store.getState().toasts; return t.length ? t[t.length - 1].text : ''; });
const file = () => st(() => window.__ms.store.getState().filePath);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const log = (hid) => { try { return readJson(path.join(HIST, hid, 'log.json')).commits; } catch (e) { return []; } };
const waitFor = async (fn, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await win.waitForTimeout(150); } return false; };
const save = async () => {
  const n = await st(() => window.__ms.store.getState().toasts.length);
  await menu('save');
  await waitFor(async () => (await lastToast()).startsWith('Saved') && (await st(() => window.__ms.store.getState().toasts.length)) !== n, 15000);
  return lastToast();
};
const clipNames = () => st(() => window.__ms.store.getState().project.clips.map((c) => c.name).sort().join(','));

console.log('▸ ⌘S records versions');
await st(() => {
  const s = window.__ms.store.getState();
  s.commit((p) => { p.settings.name = 'Alpha'; });
  window.__ms.actions.addItem('circle', { name: 'Ball' });
});
let t = await save();
const P = await file();
check(P === path.join(DIR, 'Alpha.mstudio'), `the project got its file (${P})`);
check(/^Saved v1 · First version · 1 clip/.test(t), `toast names the version (${t})`);
const hid = readJson(P).historyId;
check(/^h[0-9a-z]+$/.test(hid || ''), `file carries a history id (${hid})`);
check(log(hid).length === 1, 'one commit in the log');
check(await waitFor(() => fs.existsSync(path.join(HIST, hid, log(hid)[0].id + '.gif'))), 'GIF preview drawn for v1');
const gifSize = fs.statSync(path.join(HIST, hid, log(hid)[0].id + '.gif')).size;
check(gifSize > 1000 && gifSize < 600e3, `GIF is small (${gifSize} B)`);
check(fs.readFileSync(path.join(HIST, hid, log(hid)[0].id + '.gif')).subarray(0, 6).toString() === 'GIF89a', 'it is a real GIF');

t = await save();
check(t === 'Saved · no changes since v1', `saving again without changes adds nothing (${t})`);
check(log(hid).length === 1, 'still one commit');

await st(() => {
  const s = window.__ms.store.getState();
  window.__ms.actions.addItem('square', { name: 'Box', time: 0.5 });
  s.commit((p) => { const c = p.clips.find((x) => x.name === 'Ball'); c.transform.x = -3; });
});
// autosave writes the file meanwhile; the history id must survive it
await win.waitForTimeout(1200);
check(readJson(P).historyId === hid && readJson(P).clips.length === 2, 'autosave keeps the history id');
t = await save();
check(/^Saved v2 · Added Box · Edited Ball/.test(t), `v2 summary (${t})`);
check(JSON.stringify(log(hid)[1].stats) === JSON.stringify({ added: 1, edited: 1, removed: 0 }), 'v2 diffstat');
check(log(hid)[1].parent === log(hid)[0].id, 'v2 parent is v1');

await st(() => window.__ms.store.getState().commit((p) => { p.clips = p.clips.filter((c) => c.name !== 'Ball'); }));
t = await save();
check(/^Saved v3 · Removed Ball/.test(t), `v3 summary (${t})`);
check(await clipNames() === 'Box', 'v3 = just Box');

console.log('▸ history view');
await win.click('[data-testid=projects-btn]');
await win.waitForSelector(`[data-testid=project-card][data-path="${P}"]`);
check((await win.textContent(`[data-testid=project-card][data-path="${P}"] [data-testid=project-versions]`)).includes('v3'), 'card shows the version count');
await win.click(`[data-testid=project-card][data-path="${P}"] [data-testid=project-more]`);
await win.click('.ctx-menu >> text=/See history/');
await win.waitForSelector('[data-testid=history-row]');
const rows = () => win.$$eval('[data-testid=history-row]', (els) => els.map((e) => `v${e.dataset.version}${e.dataset.current ? '*' : ''}`).join(','));
check(await rows() === 'v3*,v2,v1', `newest first, current marked (${await rows()})`);
check((await win.textContent('[data-testid=history-state]')).includes('Up to date with v3'), 'state line: up to date');
check(await waitFor(async () => (await win.$$('[data-testid=history-poster]')).length >= 2), 'posters shown');
await win.hover('[data-testid=history-row][data-version="2"]');
check(await waitFor(async () => !!(await win.$('[data-testid=history-row][data-version="2"] [data-testid=history-gif]'))), 'hovering a version plays its GIF');
await win.waitForTimeout(250);
check(await win.$eval('[data-testid=history-row][data-version="2"] [data-testid=history-restore]', (e) => getComputedStyle(e.parentElement).opacity === '1'), 'actions show on hover');
check(await win.$eval('[data-testid=history-row][data-version="3"] [data-testid=history-restore]', (e) => e.disabled), 'current version cannot be restored onto itself');
await win.screenshot({ path: path.join(OUT, 'history-1-list.png') });

// name a version
await win.dblclick('[data-testid=history-row][data-version="1"] [data-testid=history-message]');
await win.fill('[data-testid=history-label-input]', 'Baseline');
await win.keyboard.press('Enter');
await waitFor(async () => (await win.textContent('[data-testid=history-row][data-version="1"]')).includes('Baseline'));
check(log(hid)[0].label === 'Baseline', 'version label stored');
await win.fill('[data-testid=history-search]', 'baseline');
check(await rows() === 'v1', `search finds by label (${await rows()})`);
await win.fill('[data-testid=history-search]', '');

// keyboard
await win.keyboard.press('Escape');
check(!!(await win.$('[data-testid=projects-grid]')) && !(await win.$('[data-testid=history-list]')), 'Esc goes back to the projects');
await win.hover(`[data-testid=project-card][data-path$="/Plain.mstudio"]`);
await win.click('.proj-toolbar', { position: { x: 900, y: 10 } }).catch(() => {});
await win.hover(`[data-testid=project-card][data-path$="/Plain.mstudio"]`);
await win.keyboard.press('h');
check(await waitFor(async () => !!(await win.$('[data-testid=history-empty]'))), 'H opens history; a project without versions shows the empty state');
await win.screenshot({ path: path.join(OUT, 'history-2-empty.png') });
await win.keyboard.press('Escape');

console.log('▸ restore (undoable)');
await win.click(`[data-testid=project-card][data-path="${P}"] [data-testid=project-more]`);
await win.click('.ctx-menu >> text=/See history/');
await win.waitForSelector('[data-testid=history-row][data-version="1"]');
await win.hover('[data-testid=history-row][data-version="1"]');
await win.click('[data-testid=history-row][data-version="1"] [data-testid=history-restore]');
check(await waitFor(async () => !(await win.$('[data-testid=projects-popup]'))), 'popup closes after restoring');
check(await clipNames() === 'Ball', `project is back to v1 (${await clipNames()})`);
check(await st(() => window.__ms.store.getState().project.settings.name) === 'Alpha', 'name kept');
await waitFor(async () => log(hid).length === 4);
check(log(hid).length === 4 && log(hid)[3].message === 'Restored v1 “Baseline”', `restore recorded as v4 (${log(hid).map((c) => c.message).join(' | ')})`);
check(readJson(P).clips.length === 1, 'file holds v1 content');
await st(() => window.__ms.store.getState().undo());
check(await clipNames() === 'Box', `⌘Z undoes the restore (${await clipNames()})`);
await win.waitForTimeout(1200);

console.log('▸ changes since last version → restore records them first');
await win.click('[data-testid=projects-btn]');
await win.click(`[data-testid=project-card][data-path="${P}"] [data-testid=project-more]`);
await win.click('.ctx-menu >> text=/See history/');
await win.waitForSelector('[data-testid=history-row]');
check((await win.textContent('[data-testid=history-state]')).includes('Changed since v4'), 'state line: changed since the last version');
check(await rows() === 'v4,v3*,v2,v1', `file content matches v3 again (${await rows()})`);
await win.keyboard.press('Escape');

console.log('▸ open as copy (forked history)');
await win.click(`[data-testid=project-card][data-path="${P}"] [data-testid=project-more]`);
await win.click('.ctx-menu >> text=/See history/');
await win.waitForSelector('[data-testid=history-row][data-version="2"]');
await win.hover('[data-testid=history-row][data-version="2"]');
await win.click('[data-testid=history-row][data-version="2"] [data-testid=history-copy]');
check(await waitFor(async () => (await file()) === path.join(DIR, 'Alpha v2.mstudio')), `copy opened (${await file()})`);
check(await clipNames() === 'Ball,Box', `copy holds v2 (${await clipNames()})`);
const hid2 = readJson(path.join(DIR, 'Alpha v2.mstudio')).historyId;
check(hid2 && hid2 !== hid && log(hid2).length === 2, `copy has its own history with v1–v2 (${log(hid2).length})`);
check(fs.existsSync(path.join(HIST, hid2, log(hid2)[1].id + '.gif')), 'forked versions keep their GIFs');

console.log('▸ rename + duplicate');
const r = await st(async () => {
  const from = window.__ms.store.getState().filePath;
  const out = await window.studio.projects.rename(from, 'Beta');
  if (out.path) window.__ms.sessions.renamedFile(from, out.path, 'Beta');
  return out;
});
check(readJson(r.path).historyId === hid2, 'rename keeps the history');
const d = await st(async (p) => window.studio.projects.duplicate(p), P);
const hid3 = readJson(d.path).historyId;
check(hid3 && hid3 !== hid && log(hid3).length === log(hid).length, `duplicate forks the history (${log(hid3).length} versions)`);
const listed = await st(async () => (await window.studio.projects.list()).projects.map((p) => `${p.name}:${p.versions || 0}`).sort().join(','));
check(listed.includes('Alpha:4') && listed.includes('Plain:0'), `projects list reports versions (${listed})`);

check(!errors.length, `no page errors (${errors.join(' | ')})`);
await app.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
