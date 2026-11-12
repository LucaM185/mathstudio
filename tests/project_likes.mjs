// Liking projects in the Projects popup: heart on the card, liked first, "Liked" filter, L key,
// context menu, persisted across relaunch, follows rename, dropped on trash.   node tests/project_likes.mjs
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out'); fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-likes-'));
const DIR = path.join(TMP, 'Projects'); fs.mkdirSync(DIR);
const RECENTS = path.join(TMP, 'state', 'recent-projects.json');
const FAVS = path.join(TMP, 'state', 'favorite-projects.json');
const fails = []; const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };

const mini = (name) => ({ version: 1, settings: { name, duration: 6, fps: 30, background: '#1e1e1e', resolution: [1920, 1080] }, tracks: [{ id: 't1', name: 'Track 1' }], clips: [], assets: [] });
const names = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
names.forEach((n, i) => { const p = path.join(DIR, `${n}.mstudio`); fs.writeFileSync(p, JSON.stringify(mini(n))); const t = (Date.now() - (i + 1) * 60e3) / 1000; fs.utimesSync(p, t, t); });

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, {
  MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_HIDDEN: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'), MATHSTUDIO_STARTUP_PROJECTS: '0',
  MATHSTUDIO_PROJECTS_DIR: DIR, MATHSTUDIO_RECENTS: RECENTS, MATHSTUDIO_TEST_CONFIRM: '0', MATHSTUDIO_TEST_TRASH_UNLINK: '1',
});
const launch = async () => {
  const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(e.message));
  await win.setViewportSize({ width: 1600, height: 950 });
  await win.waitForSelector('.lib-card', { timeout: 90000 });
  return { app, win };
};
const errors = [];
let { app, win } = await launch();
const cards = () => win.$$eval('[data-testid=project-card]', (els) => els.map((e) => ({ name: e.querySelector('.proj-name')?.textContent || e.querySelector('input')?.value, liked: !!e.dataset.liked, current: !!e.dataset.current })));
const order = async () => (await cards()).filter((c) => !c.current).map((c) => c.name + (c.liked ? '♥' : '')).join(',');
const openPopup = async () => { await win.click('[data-testid=projects-btn]'); await win.waitForSelector('[data-testid=project-card][data-path]'); };
const cardSel = (n) => `[data-testid=project-card][data-path$="/${n}.mstudio"]`;
const favs = () => { try { return JSON.parse(fs.readFileSync(FAVS, 'utf8')).map((p) => path.basename(p, '.mstudio')); } catch (e) { return []; } };

console.log('▸ heart on the card');
await openPopup();
check(await order() === 'Alpha,Bravo,Charlie,Delta', `initial order (${await order()})`);
check(await win.$eval(`${cardSel('Charlie')} [data-testid=project-like]`, (e) => getComputedStyle(e).opacity === '0'), 'heart hidden until hover');
await win.hover(cardSel('Charlie'));
await win.waitForTimeout(200);
check(await win.$eval(`${cardSel('Charlie')} [data-testid=project-like]`, (e) => getComputedStyle(e).opacity === '1'), 'heart shows on hover');
await win.click(`${cardSel('Charlie')} [data-testid=project-like]`);
await win.waitForTimeout(250);
check(await win.evaluate(() => !!document.querySelector('[data-testid=projects-popup]')) && !(await win.evaluate(() => window.__ms.store.getState().filePath)), 'clicking the heart does not open the project');
check(await order() === 'Charlie♥,Alpha,Bravo,Delta', `liked project moves first (${await order()})`);
check(favs().join() === 'Charlie', `saved to favorite-projects.json (${favs()})`);
await win.mouse.move(5, 5);
await win.waitForTimeout(200);
check(await win.$eval(`${cardSel('Charlie')} [data-testid=project-like]`, (e) => getComputedStyle(e).opacity === '1' && e.getAttribute('aria-pressed') === 'true'), 'liked heart stays visible');

console.log('▸ context menu + L key');
await win.click(cardSel('Delta'), { button: 'right' });
await win.click('.ctx-menu >> text="Like"');
await win.waitForTimeout(250);
check(await order() === 'Charlie♥,Delta♥,Alpha,Bravo', `context menu Like (${await order()})`);
await win.click('.proj-scroll', { position: { x: 5, y: 5 } }).catch(() => {});
await win.hover(cardSel('Charlie'));
await win.keyboard.press('l');
await win.waitForTimeout(250);
check(await order() === 'Delta♥,Alpha,Bravo,Charlie', `L unlikes the highlighted card (${await order()})`);
await win.focus('[data-testid=projects-search]');
await win.keyboard.type('l');
check(await win.inputValue('[data-testid=projects-search]') === 'l' && await order() === 'Delta♥,Alpha,Bravo,Charlie', 'typing L in search just searches');
await win.fill('[data-testid=projects-search]', '');
await win.click('.seg button:has-text("Name")');
check(await order() === 'Delta♥,Alpha,Bravo,Charlie', `liked first in Name sort too (${await order()})`);

console.log('▸ Liked filter');
await win.click('[data-testid=projects-liked-filter]');
await win.waitForTimeout(150);
check(await order() === 'Delta♥', `filter shows only liked (${await order()})`);
check((await win.textContent('[data-testid=projects-liked-filter]')).includes('1'), 'filter shows the count');
await win.screenshot({ path: path.join(OUT, 'likes-1-filter.png') });
await win.click(`${cardSel('Delta')} [data-testid=project-like]`);
await win.waitForTimeout(200);
check((await win.textContent('.proj-empty')).includes('No liked projects'), 'empty state when nothing liked');
await win.click('[data-testid=projects-liked-filter]');
await win.click(`${cardSel('Bravo')} [data-testid=project-like]`);
await win.click(`${cardSel('Alpha')} [data-testid=project-like]`);
await win.waitForTimeout(300);
check(await order() === 'Alpha♥,Bravo♥,Charlie,Delta', `${await order()}`);

console.log('▸ rename keeps the like, trash drops it');
await win.dblclick(`${cardSel('Bravo')} .proj-name`);
await win.fill('[data-testid=project-rename]', 'Bravissimo');
await win.keyboard.press('Enter');
await win.waitForSelector(cardSel('Bravissimo'));
await win.waitForTimeout(300);
check(await order() === 'Alpha♥,Bravissimo♥,Charlie,Delta', `renamed card still liked (${await order()})`);
check(favs().sort().join() === 'Alpha,Bravissimo', `favorites file follows the rename (${favs()})`);
await win.click(cardSel('Alpha'), { button: 'right' });
await win.click('.ctx-item:has-text("Move to Trash")');
await win.waitForTimeout(600);
check(favs().join() === 'Bravissimo', `trash removes the like (${favs()})`);
await win.screenshot({ path: path.join(OUT, 'likes-2-grid.png') });
await win.keyboard.press('Escape');

console.log('▸ persists across relaunch');
await app.close();
({ app, win } = await launch());
await openPopup();
check(await order() === 'Bravissimo♥,Charlie,Delta', `liked after relaunch (${await order()})`);

check(!errors.length, `no page errors ${errors.join(' | ')}`);
await app.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(fails.length ? `FAILED ${fails.length}` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
