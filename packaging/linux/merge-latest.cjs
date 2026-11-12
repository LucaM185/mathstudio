// electron-builder runs once per target here (Dockerfile: packaging both at once can run out of
// memory under emulation), and each run writes its own latest-linux.yml. Merge them so the one
// published file lists the AppImage first (what AppImage installs download) and the .deb too.
//   node packaging/linux/merge-latest.cjs <appimage.yml> <deb.yml> <out.yml>
const fs = require('fs');
const yaml = require('js-yaml');

const [a, b, out] = process.argv.slice(2);
const load = (p) => (p && fs.existsSync(p) ? yaml.load(fs.readFileSync(p, 'utf8')) : null);
const app = load(a);
const deb = load(b);
if (!app) throw new Error(`no AppImage update info at ${a}`);
if (deb && deb.version !== app.version) throw new Error(`version mismatch: ${app.version} vs ${deb.version}`);
const files = [...(app.files || [])];
for (const f of (deb && deb.files) || []) if (!files.some((x) => x.url === f.url)) files.push(f);
if (!files.some((f) => /\.AppImage$/.test(f.url))) throw new Error('AppImage missing from latest-linux.yml');
const merged = { ...app, files };
fs.writeFileSync(out, yaml.dump(merged, { lineWidth: 8000 }));
console.log(`latest-linux.yml ${merged.version}: ${files.map((f) => `${f.url} (${(f.size / 1e6).toFixed(0)} MB)`).join(', ')}`);
