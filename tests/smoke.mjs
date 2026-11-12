import { _electron as electron } from 'playwright';
const out = process.argv[2] || '/tmp';
const app = await electron.launch({
  args: ['.'],
  env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')), MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_DATA: process.env.MS_DATA || '', MATHSTUDIO_HIDDEN: '' },
});
const win = await app.firstWindow();
win.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
win.on('pageerror', (e) => console.log('pageerror:', e.message));
await win.setViewportSize?.({ width: 1680, height: 1020 }).catch(() => {});
await win.waitForSelector('.lib-card', { timeout: 60000 });
await win.waitForTimeout(2500);
await win.screenshot({ path: `${out}/smoke1.png` });
await app.close();
console.log('ok');
