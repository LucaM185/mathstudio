// Projects popup → ⋯ → "Make into mobject…": a whole project becomes a reusable library mobject.
// Free plan: always public (Private locked). Pro plan: private allowed.    node tests/project_mobject.mjs
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out'); fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-pm-'));
const DIR = path.join(TMP, 'Projects'); fs.mkdirSync(DIR);
const fails = []; const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };

const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE' && k !== 'MATHSTUDIO_PLAN'));
Object.assign(baseEnv, {
  MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_HIDDEN: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'), MATHSTUDIO_STARTUP_PROJECTS: '0',
  MATHSTUDIO_PROJECTS_DIR: DIR, MATHSTUDIO_RECENTS: path.join(TMP, 'state', 'recent-projects.json'), MATHSTUDIO_TEST_CONFIRM: '0',
  MATHSTUDIO_TEST_SAVE_PATH: path.join(DIR, 'Pythagoras.mstudio'),
});

async function launch(extra = {}) {
  const app = await electron.launch({ args: [ROOT], env: { ...baseEnv, ...extra }, cwd: ROOT });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.setViewportSize({ width: 1600, height: 950 });
  await win.waitForSelector('.lib-card', { timeout: 90000 });
  const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
  return { app, win, errors, menu };
}
const cardSel = (name) => `[data-testid=project-card][data-path$="/${name}.mstudio"]`;
const userCards = (win) => win.$$eval('.library section', (secs) => {
  const s = secs.find((x) => x.querySelector('h4')?.textContent.includes('My mobjects'));
  return s ? [...s.querySelectorAll('.lib-card')].map((c) => ({ id: c.dataset.item, text: c.textContent, vis: c.querySelector('[data-testid=mobject-visibility]')?.className || '', img: !!c.querySelector('img') })) : null;
});

// ───────────────────────────────────────────── Free plan
console.log('▸ free plan');
let { app, win, errors, menu } = await launch();
await win.click('[data-testid="load-example"]'); await win.waitForTimeout(1200);
await menu('save');
await win.waitForFunction(() => !!window.__ms.store.getState().filePath, null, { timeout: 5000 });
check(await userCards(win) === null, 'no “My mobjects” section before making one');

await win.click('[data-testid=projects-btn]'); await win.waitForSelector(cardSel('Pythagoras'));
await win.hover(cardSel('Pythagoras'));
await win.click(`${cardSel('Pythagoras')} [data-testid=project-more]`);
const label = await win.$eval('.ctx-item:has-text("mobject")', (e) => e.textContent);
check(/Make into mobject/.test(label), `⋯ menu has “${label.trim()}”`);
await win.click('.ctx-item:has-text("Make into mobject")');
await win.waitForSelector('[data-testid=mobject-dialog]');
check(await win.$eval('[data-testid=mobject-name]', (e) => e.value) === 'Pythagoras', 'name defaults to the project name');
check(await win.$eval('[data-testid=mobject-private]', (e) => e.disabled), 'Private is locked on the Free plan');
check(await win.$eval('[data-testid=mobject-public]', (e) => e.classList.contains('on')), 'Public is selected');
check(!!(await win.$('[data-testid=mobject-free-note]')), 'free-plan note shown');
check(await win.$eval('[data-testid=mobject-animated]', (e) => e.classList.contains('on')), 'animated project → Animated by default');
await win.click('[data-testid=mobject-private]', { force: true });
check(await win.$eval('[data-testid=mobject-public]', (e) => e.classList.contains('on')), 'clicking Private does nothing');
await win.keyboard.press('Space');
check(!(await win.evaluate(() => window.__ms.store.getState().playing)), 'editor shortcuts blocked behind the dialog');
await win.waitForTimeout(700);
await win.screenshot({ path: path.join(OUT, 'pm-1-dialog-free.png') });
// Escape closes only the dialog
await win.keyboard.press('Escape');
check(!(await win.$('[data-testid=mobject-dialog]')) && !!(await win.$('[data-testid=projects-popup]')), 'Esc closes the dialog, not the popup');

// make it, forcing a private request through the engine API too
await win.click(`${cardSel('Pythagoras')} [data-testid=project-more]`);
await win.click('.ctx-item:has-text("Make into mobject")');
await win.waitForSelector('[data-testid=mobject-dialog]');
await win.fill('[data-testid=mobject-desc]', 'right triangle proof');
await win.click('[data-testid=mobject-create]');
await win.waitForSelector('[data-testid=mobject-dialog]', { state: 'detached', timeout: 60000 }).catch(() => {});
const err = await win.$eval('[data-testid=mobject-error]', (e) => e.textContent).catch(() => null);
check(!err, `created without error ${err || ''}`);
await win.waitForTimeout(300);
const toast = await win.$$eval('.toast', (e) => e.map((x) => x.textContent).join(' | '));
check(/Pythagoras.*My mobjects.*public/.test(toast), `toast: ${toast}`);
check(!!(await win.$(`${cardSel('Pythagoras')} [data-testid=project-mobject-badge]`)), 'project card shows a Mobject badge');
await win.screenshot({ path: path.join(OUT, 'pm-2-popup-after.png') });
await win.click(`${cardSel('Pythagoras')} [data-testid=project-more]`);
check(!!(await win.$('.ctx-item:has-text("Update mobject")')), 'menu now offers “Update mobject…”');
await win.keyboard.press('Escape');
await win.keyboard.press('Escape');

let uc = await userCards(win);
check(uc && uc.length === 1 && uc[0].text.includes('Pythagoras') && uc[0].vis.includes('public'), `library “My mobjects”: ${JSON.stringify(uc)}`);
const id = uc[0].id;
const forced = await win.evaluate(async (p) => {
  const r = await fetch(`http://127.0.0.1:${window.__ms.store.getState().port}/user-mobjects`, { method: 'POST', body: JSON.stringify({ project: window.__ms.store.getState().project, name: 'Sneaky', visibility: 'private' }) });
  return (await r.json()).item?.visibility;
}, null);
check(forced === 'public', `engine forces public on Free even when asked for private (${forced})`);

console.log('▸ use it in another project');
await menu('new'); await win.waitForTimeout(600);
await win.waitForFunction(() => document.querySelector('.library') && [...document.querySelectorAll('.library h4')].some((h) => h.textContent.includes('My mobjects')), null, { timeout: 5000 });
await win.dblclick(`.lib-card[data-item="${id}"]`);
await win.evaluate(() => window.__ms.store.getState().setTime(3));
await win.waitForFunction((i) => { const s = window.__ms.store.getState(); const c = s.project.clips.find((c) => c.item === i); return c && s.meta?.clips?.[c.id]; }, id, { timeout: 30000 }).catch(() => {});
const placed = await win.evaluate((i) => { const s = window.__ms.store.getState(); const c = s.project.clips.find((c) => c.item === i); return { c: !!c, params: c?.params, info: c && s.meta?.clips?.[c.id], err: c && s.meta?.errors?.[c.id] }; }, id);
check(placed.c && placed.params && 'speed' in placed.params && 'loop' in placed.params, `clip added with speed/loop params ${JSON.stringify(placed.params)}`);
check(placed.info && placed.info.w > 1 && !placed.err, `renders in the new project (w ${placed.info?.w?.toFixed(2)}) ${placed.err || ''}`);
const ink = await win.evaluate(() => { const c = document.querySelector('.preview canvas, canvas'); if (!c) return 0; const g = c.getContext('2d'); if (!g) return 1; const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 200) n++; return n / (d.length / 16); });
check(ink > 0.002, `preview shows the mobject (ink ${ink.toFixed(4)})`);
const code = await win.evaluate(async () => { const s = window.__ms.store.getState(); const r = await fetch(`http://127.0.0.1:${s.port}/code`, { method: 'POST', body: JSON.stringify({ project: s.project }) }); return (await r.json()).code; });
check(/def PM_Pythagoras_\w+\(t=0\.0/.test(code) && code.includes('project_mobject('), 'exported scene.py contains the project definition');
await win.screenshot({ path: path.join(OUT, 'pm-3-in-new-project.png') });

console.log('▸ library card menu');
await win.click(`.lib-card[data-item="${id}"]`, { button: 'right' });
const mi = await win.$$eval('.ctx-item', (els) => els.map((e) => ({ t: e.textContent.trim(), d: e.classList.contains('disabled') })));
check(mi.some((m) => m.t.includes('Make private (Pro)') && m.d), `“Make private (Pro)” disabled on Free (${mi.map((m) => m.t).join(', ')})`);
await win.screenshot({ path: path.join(OUT, 'pm-4-card-menu.png') });
await win.keyboard.press('Escape');
check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await app.close();

// ───────────────────────────────────────────── Pro plan, same data dir
console.log('▸ pro plan');
({ app, win, errors, menu } = await launch({ MATHSTUDIO_PLAN: 'pro' }));
uc = await userCards(win);
check(uc && uc.length === 2, `mobjects persist across launches (${uc?.length})`);
await win.waitForFunction(() => document.querySelectorAll('.library .lib-card img').length > 3, null, { timeout: 30000 }).catch(() => {});
await win.click('[data-testid=projects-btn]'); await win.waitForSelector(cardSel('Pythagoras'));
await win.hover(cardSel('Pythagoras'));
await win.click(`${cardSel('Pythagoras')} [data-testid=project-more]`);
await win.click('.ctx-item:has-text("Update mobject")');
await win.waitForSelector('[data-testid=mobject-dialog]');
check(!(await win.$eval('[data-testid=mobject-private]', (e) => e.disabled)) && !(await win.$('[data-testid=mobject-free-note]')), 'Pro: Private available, no free note');
check(await win.$eval('[data-testid=mobject-replace]', (e) => e.checked), 'offers to replace the earlier mobject');
await win.click('[data-testid=mobject-private]');
await win.click('[data-testid=mobject-still]');
await win.waitForTimeout(800);
await win.screenshot({ path: path.join(OUT, 'pm-5-dialog-pro.png') });
await win.click('[data-testid=mobject-create]');
await win.waitForSelector('[data-testid=mobject-dialog]', { state: 'detached', timeout: 60000 }).catch(() => {});
await win.keyboard.press('Escape');
await win.waitForTimeout(400);
uc = await userCards(win);
const upd = uc?.find((c) => c.id === id);
check(uc?.length === 2 && upd && upd.vis.includes('private'), `updated in place, now private ${JSON.stringify(upd)}`);
const it = await win.evaluate((i) => window.__ms.store.getState().library.items.find((x) => x.id === i), id);
check(it && it.mode === 'still' && !it.dynamic, 'now a still mobject');
await win.click(`.lib-card[data-item="${id}"]`, { button: 'right' });
await win.click('.ctx-item:has-text("Make public")');
await win.waitForTimeout(500);
uc = await userCards(win);
check(uc.find((c) => c.id === id)?.vis.includes('public'), 'Pro: switch back to public from the card menu');
await win.click(`.lib-card[data-item="${id}"]`, { button: 'right' });
await win.click('.ctx-item:has-text("Delete mobject")');
await win.waitForTimeout(500);
uc = await userCards(win);
check(uc && uc.length === 1 && !uc.some((c) => c.id === id), 'delete from the card menu');
await win.screenshot({ path: path.join(OUT, 'pm-6-library.png') });
check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await app.close();

fs.rmSync(TMP, { recursive: true, force: true });
console.log(fails.length ? `\n✗ ${fails.length} failed:\n  - ${fails.join('\n  - ')}` : '\n✓ all project-mobject UI checks passed');
process.exit(fails.length ? 1 : 0);
