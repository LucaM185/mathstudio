#!/bin/bash
# Build MathStudio.app for macOS (Apple Silicon) with a bundled standalone Python holding ManimGL & co
# (the same versions as engine/.venv), ffmpeg and the search model, signed with the Developer ID
# certificate in the keychain.
#   packaging/mac/build.sh             → release/mac-arm64/MathStudio.app
#   packaging/mac/build.sh --install   … and replace /Applications/MathStudio.app with it
# LaTeX is not bundled: the app uses MacTeX from /Library/TeX/texbin if it is installed.
# The non-commercial library content (gitignored) is included only for this machine's own install;
# MS_PUBLIC=1 leaves it out — required for anything that gets distributed.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
STAGE="$ROOT/build-res-mac"
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
[ -x engine/.venv/bin/python ] || { echo "engine/.venv missing — run ./setup.sh first"; exit 1; }

echo "▸ staging Python"
rm -rf "$STAGE" && mkdir -p "$STAGE"
PYV="$(engine/.venv/bin/python -c 'import platform; print(platform.python_version())')"
"$UV" python install "$PYV" --install-dir "$STAGE/.uvpy" >/dev/null
cp -a "$(ls -d "$STAGE"/.uvpy/cpython-"$PYV"-macos-aarch64-none)" "$STAGE/python"
rm -rf "$STAGE/.uvpy"
PY="$STAGE/python/bin/python3"
rm -f "$STAGE"/python/lib/python3.*/EXTERNALLY-MANAGED
"$UV" pip freeze --python engine/.venv/bin/python > "$STAGE/requirements.txt"
UV_LINK_MODE=copy "$UV" pip install --quiet --python "$PY" --break-system-packages --no-build -r "$STAGE/requirements.txt"
rm "$STAGE/requirements.txt"

echo "▸ ffmpeg"
"$UV" pip install --quiet --target "$STAGE/ffm" imageio-ffmpeg==0.6.0
cp "$STAGE"/ffm/imageio_ffmpeg/binaries/ffmpeg-macos* "$STAGE/python/bin/ffmpeg"
chmod +x "$STAGE/python/bin/ffmpeg" && rm -rf "$STAGE/ffm"
"$STAGE/python/bin/ffmpeg" -version | head -1

echo "▸ search model"
HF_HUB_DISABLE_TELEMETRY=1 "$PY" -c "from huggingface_hub import snapshot_download as d; \
d('BAAI/bge-small-en-v1.5', allow_patterns=['onnx/model.onnx','tokenizer.json','config.json'], local_dir='$STAGE/models/bge-small-en-v1.5')" >/dev/null
rm -rf "$STAGE/models/bge-small-en-v1.5/.cache"

echo "▸ engine"
EXCL=(--exclude .venv --exclude tests --exclude data --exclude videos --exclude imported_frames --exclude __pycache__ --exclude '*.pyc' --exclude .DS_Store)
if [ "${MS_PUBLIC:-}" = 1 ]; then
  EXCL+=(--exclude mathstudio_library/non-commercial --exclude mathstudio_library/manim-assets/manimgl/3b1b-videos --exclude mathstudio_imports_nc.json)
fi
rsync -a "${EXCL[@]}" engine/ "$STAGE/engine/"

echo "▸ trimming + precompiling"
# not needed at runtime; static archives / headers also trip up code signing
rm -rf "$STAGE"/python/lib/python3.*/{test,idlelib,ensurepip} "$STAGE"/python/lib/python3.*/config-* \
       "$STAGE/python/include" "$STAGE/python/share" "$STAGE"/python/lib/pkgconfig
find "$STAGE/python" -name '__pycache__' -prune -exec rm -rf {} +
find "$STAGE/python" -name '*.dSYM' -prune -exec rm -rf {} +
rm -rf "$STAGE"/python/lib/python3.*/site-packages/PyObjCTest
find "$STAGE/python" \( -name '*.a' -o -name '*.pyc' \) -delete
# the app runs Python with PYTHONDONTWRITEBYTECODE (never write into the signed bundle)
"$PY" -m compileall -q -j0 --invalidation-mode unchecked-hash "$STAGE"/python/lib "$STAGE/engine" >/dev/null || true
"$PY" -c "import sys; sys.path.insert(0, '$STAGE/engine'); import manimlib, manimpango, moderngl, onnxruntime, tokenizers, numpy, scipy, PIL, code_knobs, search; print('  imports ok')"

echo "▸ signing native code"
# electron-builder's signer treats every non-text file as code (tens of thousands of .pyc, fonts…)
# and timestamps each one: sign only the real Mach-O binaries here, in parallel, and let it skip
# the Python tree (signIgnore in electron-builder.yml). Same identity, hardened runtime and
# entitlements as the app, so the bundle stays notarizable.
IDENTITY="${MS_SIGN_ID:-$(security find-identity -v -p codesigning | awk -F'"' '/Developer ID Application/ {print $2; exit}')}"
[ -n "$IDENTITY" ] || { echo "no 'Developer ID Application' certificate in the keychain (set MS_SIGN_ID)"; exit 1; }
ENT="$ROOT/packaging/mac/entitlements.plist"
find "$STAGE/python" -type f \( -name '*.so' -o -name '*.dylib' -o -perm -u+x \) -print0 \
  | xargs -0 file --no-pad -N | grep -v '(for architecture' | awk -F': ' '/Mach-O/ {print $1}' > "$STAGE/macho.txt"
echo "  $(wc -l < "$STAGE/macho.txt" | tr -d ' ') binaries → $IDENTITY"
tr '\n' '\0' < "$STAGE/macho.txt" | xargs -0 -P 8 -n 16 \
  codesign --force --timestamp --options runtime --entitlements "$ENT" --sign "$IDENTITY" 2>&1 | grep -v ': replacing existing signature' || true
rm "$STAGE/macho.txt"
"$PY" -c "import numpy, scipy.linalg, cv2, onnxruntime, moderngl" && echo "  signed python ok"

echo "▸ UI + app"
npx vite build >/dev/null
rm -rf release/mac-arm64
CSC_NAME="${IDENTITY#Developer ID Application: }" npx electron-builder --config packaging/mac/electron-builder.yml --mac dir --arm64 --publish never
APP="release/mac-arm64/MathStudio.app"
codesign --verify --deep --strict "$APP" && echo "  signature ok: $(codesign -dvv "$APP" 2>&1 | grep '^Authority=' | head -1)"
du -sh "$APP"

if [ "${1:-}" = "--install" ]; then
  echo "▸ installing to /Applications"
  osascript -e 'tell application "MathStudio" to quit' >/dev/null 2>&1 || true
  rm -rf /Applications/MathStudio.app
  ditto "$APP" /Applications/MathStudio.app
  echo "✓ /Applications/MathStudio.app"
fi
