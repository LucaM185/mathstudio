// Projects browser: top-bar button → popup listing recents + projects folder; switch, search,
// keyboard, rename, duplicate, trash, forget, autosave (no save prompts).   node tests/projects.mjs
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out'); fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-proj-'));
const DIR = path.join(TMP, 'Projects'); fs.mkdirSync(DIR);
const OTHER = path.join(TMP, 'elsewhere'); fs.mkdirSync(OTHER);
const RECENTS = path.join(TMP, 'state', 'recent-projects.json');
const fails = []; const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };

const mini = (name, clips = []) => ({ version: 1, settings: { name, duration: 6, fps: 30, background: '#1e1e1e', resolution: [1920, 1080] }, tracks: [{ id: 't1', name: 'Track 1' }], clips, assets: [] });
fs.writeFileSync(path.join(DIR, 'Empty one.mstudio'), JSON.stringify(mini('Empty one')));
fs.writeFileSync(path.join(DIR, 'Broken.mstudio'), '{ not json');
fs.writeFileSync(path.join(OTHER, 'Outside.mstudio'), JSON.stringify(mini('Outside')));
fs.mkdirSync(path.dirname(RECENTS), { recursive: true });
fs.writeFileSync(RECENTS, JSON.stringify([
  { path: path.join(OTHER, 'Outside.mstudio'), opened: Date.now() - 3600e3 },
  { path: path.join(TMP, 'gone', 'Gone.mstudio'), opened: Date.now() - 7200e3 },
]));

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, {
  MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_HIDDEN: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'),
  MATHSTUDIO_PROJECTS_DIR: DIR, MATHSTUDIO_RECENTS: RECENTS, MATHSTUDIO_TEST_CONFIRM: '0', MATHSTUDIO_TEST_TRASH_UNLINK: '1',
  MATHSTUDIO_TEST_SAVE_PATH: path.join(DIR, 'Pythagoras.mstudio'),
});
const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.setViewportSize({ width: 1600, height: 950 });
await win.waitForSelector('.lib-card', { timeout: 90000 });
const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
const st = () => win.evaluate(() => { const s = window.__ms.store.getState(); return { filePath: s.filePath, name: s.project.settings.name, clips: s.project.clips.length, dirty: s.dirty, playing: s.playing, open: s.projectsOpen }; });
const isOpen = () => win.evaluate(() => !!document.querySelector('[data-testid=projects-popup]'));
const cards = () => win.$$eval('[data-testid=project-card]', (els) => els.map((e) => ({ name: e.querySelector('.proj-name, .proj-rename')?.textContent || e.querySelector('input')?.value, path: e.dataset.path, current: !!e.dataset.current, thumb: !!e.querySelector('img'), text: e.textContent })));
const openPopup = async () => { await win.click('[data-testid=projects-btn]'); await win.waitForSelector('[data-testid=project-card]'); };
const cardSel = (name) => `[data-testid=project-card][data-path$="/${name}.mstudio"]`;

console.log('▸ save an example project into the projects folder');
await win.click('[data-testid="load-example"]'); await win.waitForTimeout(1500);
await menu('save');
await win.waitForFunction(() => !!window.__ms.store.getState().filePath, null, { timeout: 5000 });
check(fs.existsSync(path.join(DIR, 'Pythagoras.mstudio')), 'saved Pythagoras.mstudio');
const box = await win.$eval('[data-testid=projects-btn]', (e) => { const r = e.getBoundingClientRect(); const n = document.querySelector('.project-name').getBoundingClientRect(); return { right: r.right, nameLeft: n.left, h: r.height }; });
check(box.right <= box.nameLeft && box.nameLeft - box.right < 80, `Projects button sits just left of the tab holding the project name (${box.right.toFixed(0)} → ${box.nameLeft.toFixed(0)})`);

console.log('▸ popup lists recents + folder');
await openPopup();
check(await win.evaluate(() => { const r = document.querySelector('[data-testid=projects-popup]').getBoundingClientRect(); return Math.abs(r.x - innerWidth * 0.08) < 2 && Math.abs(r.y - innerHeight * 0.08) < 2; }), 'same 8% modal frame as the Code popup');
let cs = await cards();
const names = cs.map((c) => c.name);
check(cs.length === 5, `5 cards (${names.join(', ')})`);
check(cs[0].name === 'Pythagoras' && cs[0].current, 'open project first, marked Open');
check(names.includes('Outside') && names.includes('Gone') && names.includes('Empty one') && names.includes('Broken'), 'recents outside the folder + folder files listed');
check(cs.find((c) => c.name === 'Gone').text.includes('Missing'), 'missing file flagged');
check(cs.find((c) => c.name === 'Broken').text.includes('Unreadable'), 'broken file flagged');
check(cs.find((c) => c.name === 'Pythagoras').text.includes('8 clips'), 'clip count shown');
await win.waitForFunction(() => [...document.querySelectorAll('[data-testid=project-card]')].filter((e) => e.querySelector('img')).length >= 1, null, { timeout: 20000 }).catch(() => {});
cs = await cards();
check(cs.find((c) => c.name === 'Pythagoras').thumb && cs.find((c) => c.name === 'Empty one').text.includes('Empty'), `thumbnails rendered, empty projects labelled (${cs.filter((c) => c.thumb).map((c) => c.name).join(', ')})`);
await win.waitForTimeout(400);
await win.screenshot({ path: path.join(OUT, 'projects-1-popup.png') });
check(fs.readdirSync(path.join(TMP, 'state', 'project-thumbs')).length >= 1, 'thumbnails cached on disk');

console.log('▸ editor shortcuts blocked behind the popup');
await win.click('.proj-scroll', { position: { x: 5, y: 5 } }).catch(() => {});
await win.keyboard.press('Space');
check(!(await st()).playing, 'Space does not start playback');

console.log('▸ search + Enter switches');
await win.fill('[data-testid=projects-search]', 'empty');
cs = await cards();
check(cs.length === 1 && cs[0].name === 'Empty one', 'search filters to one card');
await win.keyboard.press('Enter');
await win.waitForFunction(() => window.__ms.store.getState().filePath?.endsWith('Empty one.mstudio'), null, { timeout: 5000 }).catch(() => {});
let s = await st();
check(s.filePath?.endsWith('Empty one.mstudio') && s.clips === 0 && !s.open, 'Enter opened “Empty one” and closed the popup');
const rec = JSON.parse(fs.readFileSync(RECENTS, 'utf8'));
check(rec[0].path.endsWith('Empty one.mstudio'), 'recents updated on switch');

console.log('▸ autosave: new projects get a file, renames follow, switching never asks');
const confirms = () => app.evaluate(() => global.__msConfirms || []);
await win.click('[data-testid="load-example"]');
await win.waitForFunction(() => window.__ms.store.getState().filePath?.endsWith('Pythagoras 2.mstudio'), null, { timeout: 5000 }).catch(() => {});
s = await st();
check(fs.existsSync(path.join(DIR, 'Pythagoras 2.mstudio')) && !s.dirty, `second example autosaved as “Pythagoras 2” without a dialog (${s.filePath})`);
await win.fill('.project-name', 'Triangles');
await win.waitForFunction(() => window.__ms.store.getState().filePath?.endsWith('Triangles.mstudio'), null, { timeout: 5000 }).catch(() => {});
check(fs.existsSync(path.join(DIR, 'Triangles.mstudio')) && !fs.existsSync(path.join(DIR, 'Pythagoras 2.mstudio')), 'renaming the project in the top bar renames its file');
check(JSON.parse(fs.readFileSync(path.join(DIR, 'Triangles.mstudio'), 'utf8')).settings.name === 'Triangles', 'name inside the file follows');
await menu('projects'); await win.waitForSelector('[data-testid=project-card]');
check(await isOpen(), '⌘P (menu) opens the popup');
cs = await cards();
check(cs[0].name === 'Triangles' && cs[0].current && !cs.some((c) => /not saved|●/.test(c.text)), 'open project is a file card, no unsaved markers');
await win.keyboard.press('Escape');
// edit Empty one and switch away straight away (before the autosave delay): written, no prompt
await openPopup(); await win.click(cardSel('Empty one'));
await win.waitForFunction(() => window.__ms.store.getState().filePath?.endsWith('Empty one.mstudio'));
await win.evaluate(() => window.__ms.store.getState().commit((p) => { p.settings.duration = 9; }));
await openPopup();
await win.click(cardSel('Pythagoras'));
await win.waitForFunction(() => window.__ms.store.getState().filePath?.endsWith('Pythagoras.mstudio'), null, { timeout: 5000 }).catch(() => {});
s = await st();
check(s.filePath?.endsWith('Pythagoras.mstudio') && s.clips === 8, 'switched to Pythagoras');
check(JSON.parse(fs.readFileSync(path.join(DIR, 'Empty one.mstudio'), 'utf8')).settings.duration === 9, 'Empty one was written before switching');
check(!(await confirms()).length, `no confirmation dialogs (${(await confirms()).join(' | ')})`);
// a plain edit lands on disk by itself
await win.evaluate(() => window.__ms.store.getState().commit((p) => { p.settings.background = '#202830'; }));
await win.waitForFunction(() => !window.__ms.store.getState().dirty, null, { timeout: 5000 }).catch(() => {});
check(JSON.parse(fs.readFileSync(path.join(DIR, 'Pythagoras.mstudio'), 'utf8')).settings.background === '#202830', 'edits are written to the file automatically');
check(!fs.readdirSync(DIR).some((f) => f.endsWith('.tmp')), 'no temp files left behind');

console.log('▸ rename / duplicate / trash / forget');
await openPopup();
await win.click(`${cardSel('Empty one')} .proj-name`, { button: 'right' });
await win.click('.ctx-item:has-text("Rename")');
await win.fill('[data-testid=project-rename]', 'Renamed');
await win.keyboard.press('Enter');
await win.waitForSelector(cardSel('Renamed'), { timeout: 4000 }).catch(() => {});
check(fs.existsSync(path.join(DIR, 'Renamed.mstudio')) && !fs.existsSync(path.join(DIR, 'Empty one.mstudio')), 'rename moved the file');
check(JSON.parse(fs.readFileSync(path.join(DIR, 'Renamed.mstudio'), 'utf8')).settings.name === 'Renamed', 'rename updated the name inside');
check(await isOpen(), 'popup stays open after rename');

await win.hover(cardSel('Pythagoras'));
await win.click(`${cardSel('Pythagoras')} [data-testid=project-more]`);
await win.click('.ctx-item:has-text("Duplicate")');
await win.waitForSelector(cardSel('Pythagoras copy'), { timeout: 4000 }).catch(async () => {
  await win.screenshot({ path: path.join(OUT, 'projects-dup-fail.png') });
  console.log('     toasts:', await win.$$eval('.toast', (e) => e.map((x) => x.textContent)), fs.readdirSync(DIR));
});
check(fs.existsSync(path.join(DIR, 'Pythagoras copy.mstudio')), 'duplicate created “Pythagoras copy”');
check((await st()).filePath.endsWith('Pythagoras.mstudio'), 'duplicate does not switch');

await win.click(`${cardSel('Pythagoras copy')} .proj-name`, { button: 'right' });
await win.click('.ctx-item:has-text("Move to Trash")');
await win.waitForFunction((p) => !document.querySelector(`[data-path="${p}"]`), path.join(DIR, 'Pythagoras copy.mstudio'), { timeout: 4000 }).catch(() => {});
check(!fs.existsSync(path.join(DIR, 'Pythagoras copy.mstudio')), 'trash removed the copy');
await win.click(`${cardSel('Pythagoras')} .proj-name`, { button: 'right' });
check(await win.$eval('.ctx-item:has-text("Move to Trash")', (e) => e.classList.contains('disabled')), 'cannot trash the open project');
await win.keyboard.press('Escape');
check(await isOpen() && !(await win.$('.ctx-menu')), 'Esc closes the menu first, popup stays');

await win.click(`${cardSel('Gone')} .proj-name`, { button: 'right' });
await win.click('.ctx-item:has-text("Remove from Recents")');
await win.waitForFunction(() => ![...document.querySelectorAll('.proj-name')].some((e) => e.textContent === 'Gone'), null, { timeout: 4000 }).catch(() => {});
check(!(await cards()).some((c) => c.name === 'Gone'), 'missing project forgotten');

console.log('▸ rename the open project');
await win.dblclick(`${cardSel('Pythagoras')} .proj-name`);
await win.fill('[data-testid=project-rename]', 'Pythagoras v2');
await win.keyboard.press('Enter');
await win.waitForFunction(() => window.__ms.store.getState().filePath?.endsWith('Pythagoras v2.mstudio'), null, { timeout: 4000 }).catch(() => {});
s = await st();
check(s.filePath?.endsWith('Pythagoras v2.mstudio') && s.name === 'Pythagoras v2' && !s.dirty, 'open project follows its rename, stays clean');
check(await win.$eval(cardSel('Pythagoras v2'), (e) => !!e.querySelector('img')), 'thumbnail carried over the rename');

console.log('▸ arrows + sort + close');
await win.click('.seg button:has-text("Name")');
cs = await cards();
check(cs[0].current && cs.slice(1).map((c) => c.name).join() === ['Broken', 'Outside', 'Renamed', 'Triangles'].join(), `name sort (${cs.map((c) => c.name).join(', ')})`);
await win.focus('[data-testid=projects-search]');
await win.keyboard.press('ArrowDown');
await win.waitForTimeout(100);
const kb = await win.$eval('.proj-card.kb', (e) => e.querySelector('.proj-name').textContent);
check(kb !== 'Pythagoras v2', `ArrowDown moves the highlight (${kb})`);
await win.screenshot({ path: path.join(OUT, 'projects-2-sorted.png') });
await win.keyboard.press('Escape'); check(!(await isOpen()), 'Esc closes');
await openPopup(); await win.mouse.click(10, 500); check(!(await isOpen()), 'backdrop click closes');
await openPopup(); await win.click('[data-testid=projects-close]'); check(!(await isOpen()), 'X closes');

console.log('▸ new project');
await openPopup(); await win.click('[data-testid=projects-new]');
s = await st();
check(s.filePath === null && s.clips === 0 && !s.open, 'New project starts an empty untitled project');
await win.waitForTimeout(1200);
check(!fs.existsSync(path.join(DIR, 'Untitled.mstudio')), 'an empty new project does not litter the folder');
await win.screenshot({ path: path.join(OUT, 'projects-3-topbar.png'), clip: { x: 0, y: 0, width: 1600, height: 60 } });
await win.click('[data-testid="load-example"]');
await win.waitForFunction(() => window.__ms.store.getState().filePath?.endsWith('/Pythagoras.mstudio'), null, { timeout: 5000 }).catch(() => {});
check((await st()).filePath?.endsWith('/Pythagoras.mstudio'), 'example gets the freed-up name “Pythagoras”');
await openPopup();
cs = await cards();
check(cs[0].current && cs[0].name === 'Pythagoras' && cs.filter((c) => c.current).length === 1, 'new file appears as the open card');
await win.waitForTimeout(400);
await win.screenshot({ path: path.join(OUT, 'projects-4-autosaved.png') });
await win.keyboard.press('Escape');

console.log('▸ quitting writes the last edit');
await win.evaluate(() => window.__ms.store.getState().commit((p) => { p.settings.duration = 21; }));
check(!errors.length, `no page errors ${errors.join(' | ')}`);
await app.close();
check(JSON.parse(fs.readFileSync(path.join(DIR, 'Pythagoras.mstudio'), 'utf8')).settings.duration === 21, 'edit made right before quitting was saved');
fs.rmSync(TMP, { recursive: true, force: true });
console.log(fails.length ? `FAILED ${fails.length}` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
