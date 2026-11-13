// electron-builder afterPack (Linux): put a small launcher in front of the Electron binary.
//
// Chromium sets up its sandbox before any of our JavaScript runs, so `--no-sandbox` only helps when
// it is on the real command line (app.commandLine.appendSwitch in main.cjs is too late). Where the
// sandbox cannot work, Electron aborts at launch:
//   - an AppImage can't ship the setuid chrome-sandbox ("SUID sandbox helper ... not configured")
//   - Ubuntu 24.04+ (AppArmor restricts unprivileged user namespaces), containers, some hardened
//     kernels: "Failed to move to new namespace" / zygote check failed
// So `mathstudio` becomes this script and the Electron binary `mathstudio-bin`; the script keeps
// the sandbox whenever the kernel lets an unprivileged user create the namespaces Chromium needs.
// The windows already run with webPreferences.sandbox=false and only load the app's own files.
const fs = require('fs');
const path = require('path');

const launcher = (bin) => `#!/bin/sh
# MathStudio launcher (packaging/linux/after-pack.cjs): adds --no-sandbox where Chromium's sandbox
# can't start (AppImage, Ubuntu 24.04+ user-namespace restriction, containers), then runs Electron.
HERE="$(dirname "$(readlink -f "$0")")"
sandbox_ok() {
  [ -z "$APPIMAGE" ] || return 1
  command -v unshare >/dev/null 2>&1 || return 1
  unshare --user --map-root-user --net --pid --fork true >/dev/null 2>&1
}
case " $* " in
  *" --no-sandbox "*) ;;
  *) [ "$MATHSTUDIO_SANDBOX" = "1" ] || sandbox_ok || set -- --no-sandbox "$@" ;;
esac
exec "$HERE/${bin}" "$@"
`;

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'linux') return;
  const exe = ctx.packager.executableName;
  const real = path.join(ctx.appOutDir, exe);
  const bin = `${exe}-bin`;
  if (fs.existsSync(path.join(ctx.appOutDir, bin))) return; // already wrapped (rerun)
  fs.renameSync(real, path.join(ctx.appOutDir, bin));
  fs.writeFileSync(real, launcher(bin), { mode: 0o755 });
  console.log(`  • afterPack: ${exe} → launcher script, Electron binary → ${bin}`);
};
