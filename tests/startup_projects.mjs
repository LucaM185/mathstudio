// Projects browser opens on launch; top bar has no brand / New / Open; name sits left.   node tests/startup_projects.mjs
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out'); fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-start-'));
const fails = []; const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };
const run = async (extra) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
  Object.assign(env, { MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_HIDDEN: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'),
    MATHSTUDIO_PROJECTS_DIR: path.join(TMP, 'P'), MATHSTUDIO_RECENTS: path.join(TMP, 'r.json') }, extra);
  const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1600, height: 950 });
  await win.waitForSelector('.topbar', { timeout: 60000 });
  await win.waitForTimeout(1500);
  return { app, win };
};
{
  const { app, win } = await run({ MATHSTUDIO_STARTUP_PROJECTS: '1' });
  check(await win.evaluate(() => window.__ms.store.getState().projectsOpen), 'projects popup open at launch');
  check(!!(await win.$('[data-testid=projects-new]')), 'popup shows New project');
  await win.screenshot({ path: path.join(OUT, 'startup_projects.png') });
  await win.keyboard.press('Escape'); await win.waitForTimeout(300);
  check(!(await win.evaluate(() => window.__ms.store.getState().projectsOpen)), 'Escape closes it');
  const tb = await win.$eval('.topbar', (t) => ({ text: t.innerText, brand: !!t.querySelector('.brand, .logo'),
    btn: t.querySelector('[data-testid=projects-btn]').getBoundingClientRect().left, name: t.querySelector('.project-name').getBoundingClientRect().left,
    align: getComputedStyle(t.querySelector('.project-name')).textAlign }));
  check(!tb.brand && !/MathStudio/.test(tb.text), 'no logo / MathStudio brand');
  check(!/\bNew\b|\bOpen\b/.test(tb.text), 'no New / Open buttons in top bar');
  check(tb.btn < 140 && tb.name < 300 && tb.align === 'left', `projects+name on the left (btn ${tb.btn}, name ${tb.name}, ${tb.align})`);
  await win.screenshot({ path: path.join(OUT, 'startup_topbar.png'), clip: { x: 0, y: 0, width: 1600, height: 60 } });
  await app.close();
}
{
  const { app, win } = await run({});
  check(!(await win.evaluate(() => window.__ms.store.getState().projectsOpen)), 'test env (NO_AUTOSAVE) keeps popup closed');
  await app.close();
}
console.log(fails.length ? `FAILED ${fails.length}` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
