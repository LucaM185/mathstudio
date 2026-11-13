// Settings tab: OpenRouter key (save / validate / test / remove) and preview quality (persisted,
// caps the preview resolution).   node tests/settings.mjs   (free: the key check is mocked)
// MS_APP=/path/to/packaged/binary runs the same checks against a packaged build.
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.MS_OUT || path.join(ROOT, 'tests', 'out'); fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-settings-'));
const SETTINGS = path.join(TMP, 'settings.json');
const GOOD = 'sk-or-v1-test-0123456789abcdef';
const fails = []; const check = (c, m) => { console.log(c ? '   ✓' : '   ✗', m); if (!c) fails.push(m); };
// screenshots are for looking at, not checks: on a slow software-GL box (CI) one can time out
const shot = (win, name) => win.screenshot({ path: path.join(OUT, name), timeout: 15000 })
  .catch((e) => console.log(`   (screenshot ${name} skipped: ${e.message.split('\n')[0]})`));

const launch = async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE' && k !== 'DEBUG' && !k.startsWith('OPENROUTER')));
  Object.assign(env, { MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_HIDDEN: '1', MATHSTUDIO_DATA: path.join(TMP, 'data'),
    MATHSTUDIO_PROJECTS_DIR: path.join(TMP, 'P'), MATHSTUDIO_RECENTS: path.join(TMP, 'r.json'), MATHSTUDIO_SETTINGS: SETTINGS,
    MATHSTUDIO_TEST_KEYCHECK: GOOD, MATHSTUDIO_STARTUP_PROJECTS: '0' });
  const opts = process.env.MS_APP ? { executablePath: process.env.MS_APP, args: process.env.MS_NO_SANDBOX ? ['--no-sandbox'] : [], env } : { args: [ROOT], env, cwd: ROOT };
  const app = await electron.launch(opts);
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('   pageerror:', e.message));
  await win.setViewportSize({ width: 2400, height: 1300 });
  await win.waitForSelector('.topbar', { timeout: 120000 });
  await win.waitForFunction(() => window.__ms.store.getState().engineStatus === 'ready', null, { timeout: 180000 });
  return { app, win };
};
const S = (win, f) => win.evaluate(f);
const frameW = async (win) => {
  // a fresh idle frame for the current settings
  await win.waitForTimeout(300);
  await win.waitForFunction(() => !!window.__ms.store.getState().meta, null, { timeout: 60000 });
  await win.waitForTimeout(1500);
  return S(win, () => window.__ms.store.getState().meta.w);
};

{
  const { app, win } = await launch();
  await win.click('[data-testid=right-tab-settings]');
  await win.waitForSelector('[data-testid=settings-panel]');
  check(await S(win, () => window.__ms.store.getState().rightTab === 'settings'), 'Settings tab opens');
  await win.waitForFunction(() => !!window.__ms.store.getState().gl, null, { timeout: 30000 });
  const gl = await S(win, () => window.__ms.store.getState().gl);
  check(!!gl.renderer, `engine reports its GL renderer (${gl.renderer}, software=${gl.software})`);
  await win.waitForTimeout(400);
  check(/GPU rendering|Software rendering/.test(await win.textContent('[data-testid=settings-gl]')), 'renderer shown in the panel');
  const ks0 = await win.textContent('[data-testid=settings-key-state]');
  console.log('     initial key state:', ks0.trim());

  // invalid key is refused
  await win.fill('[data-testid=settings-key-input]', 'not a key');
  await win.click('[data-testid=settings-key-save]');
  await win.waitForSelector('[data-testid=settings-key-error]');
  check(!fs.existsSync(SETTINGS) || !JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).openrouterKey, 'key with spaces rejected, nothing stored');

  // save a key → stored, masked, used by the agent, test passes
  await win.fill('[data-testid=settings-key-input]', GOOD);
  await win.click('[data-testid=settings-key-save]');
  await win.waitForFunction(() => /saved in Settings/.test(document.querySelector('[data-testid=settings-key-state]')?.textContent || ''));
  const stored = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  check(stored.openrouterKey === GOOD, 'key written to settings.json');
  check((fs.statSync(SETTINGS).mode & 0o077) === 0, 'settings.json is owner-only (0600)');
  const shown = await win.textContent('[data-testid=settings-key-state]');
  check(!shown.includes(GOOD) && shown.includes('sk-or-') && shown.includes('cdef'), `key shown masked (${shown.trim()})`);
  check(await win.inputValue('[data-testid=settings-key-input]') === '', 'input cleared after save');
  await win.waitForSelector('[data-testid=settings-key-test-result]');
  check(/Key works/.test(await win.textContent('[data-testid=settings-key-test-result]')), 'saving runs the key test → ok');
  check((await S(win, () => window.studio.ai.status())).configured, 'agent sees the key (ai:status configured)');
  // testing a different, wrong key in the box
  await win.fill('[data-testid=settings-key-input]', 'sk-or-v1-wrong-key-123456');
  await win.click('[data-testid=settings-key-test]');
  await win.waitForFunction(() => /rejected/.test(document.querySelector('[data-testid=settings-key-test-result]')?.textContent || ''));
  check(true, 'testing a wrong key reports it rejected');
  await win.fill('[data-testid=settings-key-input]', '');
  await shot(win, 'settings_key.png');

  // quality: Low caps the preview, persisted
  const wHigh = await (async () => { await win.click('[data-testid=settings-quality-high]'); return frameW(win); })();
  await win.click('[data-testid=settings-quality-low]');
  const wLow = await frameW(win);
  check(wLow <= 960, `Low caps the idle preview at 960 px (got ${wLow})`);
  check(wHigh > wLow, `High renders larger than Low (${wHigh} > ${wLow})`);
  check(JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).quality === 'low', 'quality saved to settings.json');
  check(/960 px wide when still/.test(await win.textContent('[data-testid=settings-quality-now]')), 'panel states the active caps');
  await shot(win, 'settings_quality.png');
  // narrow right column: tabs still fit
  await win.setViewportSize({ width: 1280, height: 800 });
  await win.waitForTimeout(400);
  const tabs = await win.$eval('.right-tabs', (el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  check(tabs.sw <= tabs.cw + 1, `right tabs fit without overflow (${tabs.sw} ≤ ${tabs.cw})`);
  await shot(win, 'settings_narrow.png');
  await app.close();
}
{
  const { app, win } = await launch();
  check(await S(win, () => window.__ms.store.getState().renderQuality) === 'low', 'quality restored on relaunch');
  await win.click('[data-testid=right-tab-settings]');
  await win.waitForSelector('[data-testid=settings-key-remove]');
  await win.click('[data-testid=settings-key-remove]');
  await win.waitForFunction(() => !/saved in Settings/.test(document.querySelector('[data-testid=settings-key-state]')?.textContent || ''));
  check(!('openrouterKey' in JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))), 'Remove deletes the stored key');
  await win.click('[data-testid=settings-quality-auto]');
  await win.waitForTimeout(300);
  check(JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).quality === 'auto', 'back to Auto');
  await app.close();
}
console.log(fails.length ? `FAILED ${fails.length}` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
