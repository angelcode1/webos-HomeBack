#!/usr/bin/env bash

set -euo pipefail

VERSION="$(node -p "require('./package.json').version")"
APP_ID="$(node -p "require('./package.json').id")"
UPSTREAM_BASE="a67385151486347394c6ac6e8af8da61e6c72685"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
    echo "ERROR: working tree is not clean."
    echo "Commit HomeBack $VERSION before creating the release archive."
    git status --short
    exit 1
fi

OUT="${HOME}/Downloads/HomeBack-releases/${VERSION}"

mkdir -p "$OUT"

echo '[1/8] Checking public-release provenance gate...'
corepack yarn verify:publication

echo '[2/8] Verifying source, tests, types and lint...'
corepack yarn check:full

echo '[3/8] Building...'
rm -rf dist
corepack yarn build

IPK="dist/${APP_ID}_${VERSION}_all.ipk"

test -f "$IPK"

echo '[4/8] Copying IPK...'
cp "$IPK" "$OUT/"

echo '[5/8] Creating clean source ZIP from committed tree...'

git archive \
    --format=zip \
    --prefix="HomeBack-${VERSION}/" \
    --output="$OUT/HomeBack-${VERSION}-source.zip" \
    HEAD

echo '[6/8] Creating full Git bundle...'

git bundle create \
    "$OUT/HomeBack-${VERSION}.bundle" \
    --all

echo '[7/8] Creating patch from original upstream baseline...'

git diff \
    "$UPSTREAM_BASE..HEAD" \
    > "$OUT/HomeBack-${VERSION}-webos10-c5.patch"

echo '[8/8] Recording metadata and checksums...'

{
    echo "HomeBack C5/webOS10 release"
    echo "Version: $VERSION"
    echo "Commit: $(git rev-parse HEAD)"
    echo "Branch: $(git branch --show-current)"
    echo "Upstream base: $UPSTREAM_BASE"
    echo "Created UTC: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
} > "$OUT/RELEASE.txt"

(
    cd "$OUT"
    shasum -a 256 \
        "${APP_ID}_${VERSION}_all.ipk" \
        "HomeBack-${VERSION}-source.zip" \
        "HomeBack-${VERSION}.bundle" \
        "HomeBack-${VERSION}-webos10-c5.patch" \
        > SHA256SUMS.txt
)

echo
echo 'Release created:'
echo "$OUT"
echo

ls -lh "$OUT"

echo
cat "$OUT/SHA256SUMS.txt"
