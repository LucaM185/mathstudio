// Gallery check in the real app: the mathstudio library's gallery cards are ManimGL classes with
// rendered thumbnails (not pictures), and the animated ones play on hover.
//   node tests/gallery_ui.mjs        (screenshots go to tests/out/gallery-*.png)
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.E2E_OUT || path.join(ROOT, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-gallery-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { MATHSTUDIO_NO_AUTOSAVE: '1', MATHSTUDIO_DATA: path.join(TMP, 'data') });

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); console.log(cond ? '   ✓' : '   ✗', msg); };

const app = await electron.launch({ args: [ROOT], env, cwd: ROOT });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.lib-card', { timeout: 90000 });

const items = await win.evaluate(() => window.__ms.store.getState().library.items.filter((i) => i.category === 'Imported'));
const gallery = items.filter((i) => /^(non-commercial\/gallery|element-gallery)\/mobjects\//.test(i.rel || ''));
check(gallery.length === 194, `194 gallery classes in the library (${gallery.length})`);
check(!items.some((i) => /gallery\/images\/|element-gallery\/(images|media)\//.test(i.rel || '')), 'no picture items left');
check(gallery.every((i) => i.kind === 'class'), 'every gallery card is a class');
check(gallery.filter((i) => i.dynamic).length === 10, `10 animated gallery classes (${gallery.filter((i) => i.dynamic).length})`);

const search = win.locator('.library .search input');
async function showQuery(q, name) {
  await search.fill(q);
  await win.waitForTimeout(300);
  // wait for every visible thumbnail to load
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    const pending = await win.evaluate(() => [...document.querySelectorAll('.lib-card img')].filter((i) => !i.complete || !i.naturalWidth).length);
    if (!pending) break;
    await win.waitForTimeout(500);
  }
  // cards are lazy: only those near the viewport have an <img>
  const r = await win.evaluate(() => {
    const imgs = [...document.querySelectorAll('.lib-card img')];
    return { shown: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, fallback: document.querySelectorAll('.lib-card .lib-thumb-fallback').length };
  });
  check(r.shown > 0 && r.loaded === r.shown && r.fallback === 0, `"${q}": ${r.loaded}/${r.shown} visible thumbnails rendered, ${r.fallback} failed`);
  await win.screenshot({ path: path.join(OUT, `gallery-${name}.png`) });
}
await showQuery('BrickRow', 'brickrow');
await showQuery('coin', 'coin');
await showQuery('pendulum', 'pendulum');   // matches docstrings too
await showQuery('Element', 'elements');

// hover an animated card: its GIF plays
await search.fill('Lorenz');
await win.waitForTimeout(500);
const card = win.locator('.lib-card').first();
await card.scrollIntoViewIfNeeded();
const b = await card.locator('.lib-thumb').boundingBox();
await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
let gif = null;
for (let k = 0; k < 360 && !(gif && /\.gif|^blob:/.test(gif.src) && gif.w > 0); k++) {
  await win.mouse.move(b.x + b.width / 2 + (k % 2), b.y + b.height / 2);
  await win.waitForTimeout(500);
  gif = await card.evaluate((c) => { const i = c.querySelector('img'); return { src: i.src, w: i.naturalWidth }; });
}
// GIFs are prefetched as blob: URLs (see useGif in Library.tsx)
check(/\.gif|^blob:/.test(gif.src) && gif.w > 0, 'hovering an animated gallery card plays its GIF');
check(await card.locator('.lib-badge[title="Animated"]').count() === 1, 'animated badge shown');

// add one to the project: it renders without errors
await card.dblclick();
await win.waitForTimeout(2500);
const st = await win.evaluate(() => { const s = window.__ms.store.getState(); return { clips: s.project.clips.length, errors: s.meta?.errors }; });
check(st.clips === 1 && Object.keys(st.errors || {}).length === 0, `added to the project and rendered (${JSON.stringify(st.errors)})`);
await win.screenshot({ path: path.join(OUT, 'gallery-added.png') });

check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await app.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall gallery UI checks passed');
process.exit(fails.length ? 1 : 0);
