#!/usr/bin/env bash
# The one way to ship a release:   npm run release [patch|minor|major]   (default: patch)
#   1. checks: on main, clean tree, in sync with origin, typecheck passes
#   2. bumps package.json, commits "Release X.Y.Z", tags vX.Y.Z, pushes → GitHub Actions
#      (.github/workflows/release.yml) builds + tests the Linux packages and publishes the Release
#   3. builds the signed Mac app and installs it in /Applications (skip with --no-mac)
# Flags: --no-mac   skip the local Mac build     --dry   run the checks only, change nothing
set -euo pipefail
cd "$(dirname "$0")/.."

BUMP=patch; MAC=1; DRY=0
for a in "$@"; do
  case "$a" in
    patch|minor|major) BUMP=$a ;;
    --no-mac) MAC=0 ;;
    --dry) DRY=1 ;;
    *) echo "usage: npm run release [patch|minor|major] [--no-mac] [--dry]"; exit 2 ;;
  esac
done

[ "$(git branch --show-current)" = main ] || { echo "✗ not on main"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "✗ working tree not clean — commit or stash first"; git status --short; exit 1; }
git fetch -q origin
[ -z "$(git rev-list HEAD..origin/main)" ] || { echo "✗ origin/main has commits you don't have — pull first"; exit 1; }
[ -z "$(git rev-list origin/main..HEAD)" ] || git push -q origin main   # unpushed commits ride along
npm run -s typecheck
echo "✓ checks passed"
[ "$DRY" = 1 ] && exit 0

npm version "$BUMP" -m "Release %s"     # bumps, commits, tags vX.Y.Z
git push --follow-tags
V=$(node -p "require('./package.json').version")
echo "✓ pushed v$V — Linux build/publish: https://github.com/LucaM185/mathstudio/actions"

if [ "$MAC" = 1 ] && [ "$(uname)" = Darwin ]; then
  packaging/mac/build.sh --install
  echo "✓ Mac app v$V installed in /Applications"
fi
