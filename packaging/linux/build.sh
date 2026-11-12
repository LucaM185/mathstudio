#!/bin/bash
# Build MathStudio for Linux x86_64 → release/MathStudio-x86_64.AppImage + release/MathStudio-amd64.deb
# + release/latest-linux.yml (update info; all three are uploaded to a GitHub Release by CI).
# Needs Docker (works on Apple Silicon through emulation; the first build takes a while).
#   packaging/linux/build.sh          build
#   packaging/linux/build.sh --test   build, then install the .deb + run the AppImage in clean Ubuntu containers
# MS_RELEASE=<dir> writes somewhere else than release/; MS_BUILDX_ARGS adds buildx flags (CI cache).
set -euo pipefail
cd "$(dirname "$0")/../.."
REL="${MS_RELEASE:-release}"
mkdir -p "$REL"
# shellcheck disable=SC2086
docker buildx build --platform linux/amd64 -f packaging/linux/Dockerfile --target artifacts ${MS_BUILDX_ARGS:-} --output "type=local,dest=$REL" .
ls -lh "$REL"/MathStudio-x86_64.AppImage "$REL"/MathStudio-amd64.deb "$REL"/latest-linux.yml
if [ "${1:-}" = "--test" ]; then packaging/linux/test.sh; fi
