#!/bin/bash
# A real self-update: build the same app as version 99.0.0 (Dockerfile target artifacts-next, reuses
# the build cache), then in the clean Ubuntu test container let the AppImage from build.sh find it on
# a local server, download it differentially, replace itself and relaunch (tests/linux_update.mjs).
# Run after build.sh + test.sh (it reuses their test image). MS_RELEASE as in build.sh.
set -uo pipefail
cd "$(dirname "$0")/../.."
REL="${MS_RELEASE:-release}"
NEXT="$REL-next"
IMAGE="mathstudio-linux-test${MS_RELEASE:+-$(basename "$REL")}"
OUT="$PWD/$REL/test-out"; mkdir -p "$OUT" "$NEXT"; chmod 777 "$OUT"
# shellcheck disable=SC2086
docker buildx build --platform linux/amd64 -f packaging/linux/Dockerfile --target artifacts-next ${MS_BUILDX_ARGS:-} \
  --output "type=local,dest=$NEXT" . || exit 1
ls -lh "$NEXT"
upd() { docker run --rm --platform linux/amd64 --shm-size=1g -v "$OUT:/out" -v "$PWD/$NEXT:/srv:ro" -e MS_OUT=/out -e DEBUG="${MS_PW_DEBUG-pw:browser}" "$IMAGE" \
  timeout -s ABRT -k 30 "${MS_STEP_TIMEOUT:-1500}" bash -lc 'cd /t && MS_APP=$(ls /t/*.AppImage) MS_NEXT=/srv xvfb-run -a -s "-screen 0 1920x1080x24" node tests/linux_update.mjs'; }
# one retry, as in test.sh (each run is a fresh container)
upd || { echo "   ↻ failed once, retrying"; upd; }
