#!/bin/bash
# Install the built .deb in a clean Ubuntu 24.04 x86_64 container and drive the real app under Xvfb;
# then run the AppImage the same way. Screenshots → release/test-out/.
set -uo pipefail
cd "$(dirname "$0")/../.."
REL="${MS_RELEASE:-release}"   # where build.sh put the packages
IMAGE="mathstudio-linux-test${MS_RELEASE:+-$(basename "$REL")}"
OUT="$PWD/$REL/test-out"; mkdir -p "$OUT"; chmod 777 "$OUT"
docker buildx build --platform linux/amd64 -f packaging/linux/Dockerfile.test --build-arg "REL=$REL" -t "$IMAGE" --load . || exit 1
# every step gets a time limit (MS_STEP_TIMEOUT, seconds): on expiry SIGABRT makes Python's
# faulthandler print where every thread is stuck, instead of the CI job silently hanging for hours
T="${MS_STEP_TIMEOUT:-1500}"
# DEBUG=pw:browser: Playwright prints the app's own stdout/stderr, so a launch failure shows why
# (the tests keep DEBUG itself out of the app's env: the AppImage's AppRun would trace with set -x)
# (MS_PW_DEBUG= to silence it)
run() { docker run --rm --platform linux/amd64 --shm-size=1g -v "$OUT:/out" -e MS_OUT=/out -e DEBUG="${MS_PW_DEBUG-pw:browser}" -e PYTHONUNBUFFERED=1 -e PYTHONFAULTHANDLER=1 "$IMAGE" timeout -s ABRT -k 30 "$T" bash -lc "$1"; }
fail=0
echo "== engine tests with the bundled Python (.deb install)"
run 'cp -r /opt/MathStudio/resources/engine /tmp/eng && cp -r /t/engine-tests /tmp/eng/tests && cd /tmp/eng && xvfb-run -a -s "-screen 0 1920x1080x24" /opt/MathStudio/resources/python/bin/python3 -W ignore tests/test_engine.py --export' || fail=1
echo "== .deb: Linux smoke test"
run 'cd /t && MS_TAG=deb MS_APP=/opt/MathStudio/mathstudio xvfb-run -a -s "-screen 0 1920x1080x24" node tests/linux_smoke.mjs' || fail=1
echo "== .deb: Settings tab test"
run 'cd /t && MS_APP=/opt/MathStudio/mathstudio xvfb-run -a -s "-screen 0 2560x1440x24" node tests/settings.mjs' || fail=1
echo "== AppImage: Linux smoke test"
run 'cd /t && APPIMAGE_EXTRACT_AND_RUN=1 MS_TAG=appimage MS_APP=$(ls /t/*.AppImage) xvfb-run -a -s "-screen 0 1920x1080x24" node tests/linux_smoke.mjs' || fail=1
[ $fail = 0 ] && echo "LINUX TESTS PASS" || echo "LINUX TESTS FAILED"
exit $fail
