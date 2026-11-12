#!/bin/bash
# Double-click to launch MathStudio
cd "$(dirname "$0")"
unset ELECTRON_RUN_AS_NODE
[ -x engine/.venv/bin/python ] || ./setup.sh
# Rebuild the UI bundle whenever any source file is newer than the last build
if [ ! -f dist/index.html ] || [ -n "$(find src index.html vite.config.ts package.json -type f -newer dist/index.html 2>/dev/null | head -1)" ]; then
  echo "Sources changed — rebuilding UI…"
  npx vite build || exit 1
fi
exec ./node_modules/.bin/electron . "$@"
