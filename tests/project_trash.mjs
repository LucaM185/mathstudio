// MathStudio Trash: deleting a project moves it to <state>/project-trash (Undo toast, restorable for
// 30 days, likes + thumbnail kept); "Delete now" / "Empty Trash" / expiry hand it to the system Trash.
//   node tests/project_trash.mjs
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out'); fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-trash-'));
const DIR = path.join(TMP, 'Projects'); fs.mkdirSync(DIR);
const OTHER = path.join(TMP, 'elsewhere'); fs.mkdirSync(OTHER);
const STATE = path.join(TMP, 'state'); fs.mkdirSync(STATE);
const RECENTS = path.join(STATE, 'recent-projects.json');
const TRASH = path.join(STATE, 'project-trash');
const THUMBS = path.join(STATE, 'project-thumbs'); fs.mkdirSync(THUMBS);
const fails = []; const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };

const mini = (name, extra = {}) => ({ version: 1, settings: { name, duration: 6, fps: 30, background: '#1e1e1e', resolution: [1920, 1080] }, tracks: [{ id: 't1', name: 'Track 1' }], clips: [], assets: [], ...extra });
const P = (n, d = DIR) => path.join(d, `${n}.mstudio`);
['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].forEach((n, i) => { fs.writeFileSync(P(n), JSON.stringify(mini(n, { marker: n }))); const t = (Date.now() - (i + 1) * 60e3) / 1000; fs.utimesSync(P(n), t, t); });
fs.writeFileSync(P('Outside', OTHER), JSON.stringify(mini('Outside')));
fs.writeFileSync(RECENTS, JSON.stringify([{ path: P('Outside', OTHER), opened: Date.now() - 3600e3 }]));
fs.writeFileSync(path.join(STATE, 'favorite-projects.json'), JSON.stringify([P('Alpha')]));
const thumbOf = (p) => path.join(THUMBS, crypto.createHash('sha1').update(path.resolve(p)).digest('hex') + '.json');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
fs.writeFileSync(thumbOf(P('Alpha')), JSON.stringify({ mtime: fs.statSync(P('Alpha')).mtimeMs, png: PNG }));

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, {
  MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_HIDDEN: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'), MATHSTUDIO_STARTUP_PROJECTS: '0',
  MATHSTUDIO_PROJECTS_DIR: DIR, MATHSTUDIO_RECENTS: RECENTS, MATHSTUDIO_TEST_CONFIRM: '0', MATHSTUDIO_TEST_TRASH_UNLINK: '1',
});
const errors = [];
const launch = async () => {
  const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(e.message));
  await win.setViewportSize({ width: 1600, height: 950 });
  await win.waitForSelector('.lib-card', { timeout: 90000 });
  return { app, win };
};
let { app, win } = await launch();
const names = () => win.$$eval('[data-testid=project-card][data-path]', (els) => els.map((e) => e.querySelector('.proj-name').textContent));
const tnames = () => win.$$eval('[data-testid=trash-card]', (els) => els.map((e) => e.querySelector('.proj-name').textContent));
const cardSel = (n) => `[data-testid=project-card][data-path$="/${n}.mstudio"]`;
const tcard = (n) => `[data-testid=trash-card]:has(.proj-name:text-is("${n}"))`;
const slots = () => { try { return fs.readdirSync(TRASH).filter((d) => !d.startsWith('.')); } catch (e) { return []; } };
const inTrash = (n) => slots().some((id) => fs.existsSync(path.join(TRASH, id, `${n}.mstudio`)));
const favs = () => JSON.parse(fs.readFileSync(path.join(STATE, 'favorite-projects.json'), 'utf8')).map((p) => path.basename(p, '.mstudio'));
const openPopup = async () => { await win.click('[data-testid=projects-btn]'); await win.waitForSelector('[data-testid=project-card][data-path]'); };
const trashBtn = () => win.textContent('[data-testid=projects-trash]');
const confirms = () => app.evaluate(() => (global.__msConfirms || []).length);

console.log('▸ delete is instant, recoverable, undoable');
await openPopup();
check((await trashBtn()).trim() === 'Trash', `Trash button, empty (${await trashBtn()})`);
const c0 = await confirms();
await win.click(cardSel('Alpha'), { button: 'right' });
await win.click('.ctx-item:has-text("Move to Trash")');
await win.waitForFunction(() => !document.querySelector('[data-path$="/Alpha.mstudio"]'), null, { timeout: 4000 }).catch(() => {});
check(await confirms() === c0, 'no confirmation needed (it can be undone)');
check(!fs.existsSync(P('Alpha')) && inTrash('Alpha'), 'file moved into the MathStudio Trash, not erased');
check(JSON.parse(fs.readFileSync(path.join(TRASH, slots()[0], 'Alpha.mstudio'), 'utf8')).marker === 'Alpha', 'contents intact in the Trash');
check(fs.existsSync(path.join(TRASH, slots()[0], 'thumb.json')) && !fs.existsSync(thumbOf(P('Alpha'))), 'thumbnail travels with it');
check(!favs().includes('Alpha'), 'like parked with it');
check((await trashBtn()).includes('1'), `Trash button counts it (${(await trashBtn()).trim()})`);
const toast = await win.textContent('[data-testid=toast]');
check(toast.includes('Moved Alpha to the Trash') && toast.includes('Undo'), `toast with Undo (${toast})`);
await win.click('[data-testid=toast-action]');
await win.waitForSelector(cardSel('Alpha'), { timeout: 4000 }).catch(() => {});
check(fs.existsSync(P('Alpha')) && !inTrash('Alpha') && slots().length === 0, 'Undo puts the file back where it was');
check(favs().includes('Alpha') && fs.existsSync(thumbOf(P('Alpha'))), 'Undo restores the like and thumbnail');
check(await win.$eval(cardSel('Alpha'), (e) => !!e.dataset.liked), 'card is liked again');

console.log('▸ ⌘⌫ deletes the highlighted card (never the open project)');
await win.click('.proj-scroll', { position: { x: 5, y: 5 } }).catch(() => {});
await win.hover(cardSel('Bravo'));
await win.keyboard.press('Meta+Backspace');
await win.waitForFunction(() => !document.querySelector('[data-path$="/Bravo.mstudio"]'), null, { timeout: 4000 }).catch(() => {});
check(!fs.existsSync(P('Bravo')) && inTrash('Bravo'), '⌘⌫ moved Bravo to the Trash');
await win.focus('[data-testid=projects-search]');
await win.keyboard.type('xy'); await win.keyboard.press('Meta+Backspace');
check(fs.existsSync(P('Charlie')) && fs.existsSync(P('Delta')), '⌘⌫ inside the search field only edits the text');
await win.fill('[data-testid=projects-search]', '');
await win.click(cardSel('Charlie')); // switch → Charlie is the open project
await win.waitForFunction(() => window.__ms.store.getState().filePath?.endsWith('/Charlie.mstudio'), null, { timeout: 5000 });
await openPopup();
await win.hover(cardSel('Charlie'));
await win.keyboard.press('Meta+Backspace');
await win.waitForTimeout(400);
check(fs.existsSync(P('Charlie')), 'the open project is not deleted');
// delete the outside project and then its folder: restore must still find a home
await win.click(cardSel('Outside'), { button: 'right' });
await win.click('.ctx-item:has-text("Move to Trash")');
await win.waitForTimeout(400);
check(!fs.existsSync(P('Outside', OTHER)) && inTrash('Outside'), 'project outside the folder trashed');
check(await win.evaluate((p) => !window.__ms.sessions.useStrip.getState().order.includes(p), P('Outside', OTHER)), 'trashed project leaves the top tab strip');
fs.rmSync(OTHER, { recursive: true, force: true });
await win.click(cardSel('Delta'), { button: 'right' });
await win.click('.ctx-item:has-text("Move to Trash")');
await win.waitForTimeout(400);

console.log('▸ Trash view');
await win.click('[data-testid=projects-trash]');
await win.waitForSelector('[data-testid=trash-card]');
check((await tnames()).join() === 'Delta,Outside,Bravo', `newest first (${await tnames()})`);
const meta = await win.textContent(tcard('Delta'));
check(/Deleted just now · 30 days left/.test(meta), `shows when + days left (${meta.replace(/\s+/g, ' ')})`);
check((await win.textContent('[data-testid=trash-note]')).includes('30 days'), 'explains the 30-day rule');
await win.fill('[data-testid=projects-search]', 'brav');
check((await tnames()).join() === 'Bravo', 'search filters the Trash');
await win.fill('[data-testid=projects-search]', '');
await win.screenshot({ path: path.join(OUT, 'trash-1-view.png') });
// restore with a name clash: a new "Bravo" exists now
fs.writeFileSync(P('Bravo'), JSON.stringify(mini('Bravo', { marker: 'new' })));
await win.hover(tcard('Bravo'));
await win.click(`${tcard('Bravo')} [data-testid=trash-restore]`);
await win.waitForTimeout(500);
check(fs.existsSync(P('Bravo 2')) && JSON.parse(fs.readFileSync(P('Bravo 2'), 'utf8')).marker === 'Bravo', 'name taken → restored as “Bravo 2”, nothing overwritten');
check(JSON.parse(fs.readFileSync(P('Bravo'), 'utf8')).marker === 'new', 'the newer Bravo is untouched');
check((await win.$$eval('[data-testid=toast]', (t) => t.map((x) => x.textContent).join('|'))).includes('Restored as'), 'toast says where it went');
// restore when the original folder is gone → projects folder
await win.dblclick(tcard('Outside'));
await win.waitForTimeout(500);
check(fs.existsSync(P('Outside')), 'original folder gone → restored into the projects folder');
check((await tnames()).join() === 'Delta', `left in the Trash: ${await tnames()}`);

console.log('▸ Delete now → system Trash (confirmed)');
const c1 = await confirms();
await win.hover(tcard('Delta'));
await win.click(`${tcard('Delta')} [data-testid=trash-delete]`);
await win.waitForTimeout(500);
check(await confirms() === c1 + 1, 'Delete now asks first');
check(slots().length === 0 && !fs.existsSync(P('Delta')), 'Delta handed on (test mode unlinks instead of the macOS Trash)');
check((await win.textContent('.proj-empty')).includes('The Trash is empty'), 'empty state');
check(await win.$eval('[data-testid=trash-empty]', (e) => e.disabled), 'Empty Trash disabled when empty');
await win.keyboard.press('Escape');
check(await win.$('[data-testid=projects-new]') && await win.evaluate(() => !!document.querySelector('[data-testid=projects-popup]')), 'Esc goes back to the projects, popup stays');
check((await names()).includes('Bravo 2') && (await names()).includes('Outside'), 'restored projects listed');

console.log('▸ Empty Trash + 30-day expiry');
for (const n of ['Echo', 'Bravo 2']) { await win.click(cardSel(n), { button: 'right' }); await win.click('.ctx-item:has-text("Move to Trash")'); await win.waitForTimeout(350); }
await win.click('[data-testid=projects-trash]');
await win.waitForSelector('[data-testid=trash-card]');
await win.click('[data-testid=trash-empty]');
await win.waitForTimeout(500);
check(slots().length === 0 && !(await win.$('[data-testid=trash-card]')), 'Empty Trash hands everything on');
await win.keyboard.press('Escape');
await win.click(cardSel('Outside'), { button: 'right' }); await win.click('.ctx-item:has-text("Move to Trash")'); await win.waitForTimeout(350);
await win.click(cardSel('Bravo'), { button: 'right' }); await win.click('.ctx-item:has-text("Move to Trash")'); await win.waitForTimeout(350);
await win.keyboard.press('Escape');
await app.close();
// age Outside past 30 days, Bravo to 28 days
for (const id of slots()) {
  const m = path.join(TRASH, id, 'meta.json'); const j = JSON.parse(fs.readFileSync(m, 'utf8'));
  j.deletedAt = Date.now() - (fs.existsSync(path.join(TRASH, id, 'Outside.mstudio')) ? 31 : 28.5) * 86400e3;
  fs.writeFileSync(m, JSON.stringify(j));
}
({ app, win } = await launch());
await openPopup();
await win.click('[data-testid=projects-trash]');
await win.waitForSelector('[data-testid=trash-card]');
check((await tnames()).join() === 'Bravo', `expired project moved on, recent one kept (${await tnames()})`);
check(!inTrash('Outside') && inTrash('Bravo'), 'on disk too');
const m2 = await win.textContent(tcard('Bravo'));
check(/2 days left/.test(m2) && await win.$eval(`${tcard('Bravo')} .warn`, () => true).catch(() => false), `nearly expired is highlighted (${m2.replace(/\s+/g, ' ')})`);
await win.screenshot({ path: path.join(OUT, 'trash-2-expiring.png') });
await win.keyboard.press('Enter');
await win.waitForTimeout(500);
check(fs.existsSync(P('Bravo')) && slots().length === 0, 'Enter restores the highlighted project');

check(!errors.length, `no page errors ${errors.join(' | ')}`);
await app.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(fails.length ? `FAILED ${fails.length}` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
