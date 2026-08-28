#!/usr/bin/env bash
set -euo pipefail

: "${TV:?Set TV explicitly, e.g. TV=root@192.168.1.50}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
APP_ID="$(node -p "require('./package.json').id")"
VERSION="$(node -p "require('./package.json').version")"

printf '\n========================================\n HomeBack %s\n TV: %s\n========================================\n\n' "$VERSION" "$TV"

echo '[1/8] Checking source tree...'
node scripts/verify-optimized-source.cjs
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git diff --check
fi

echo '[2/8] Testing, typechecking and linting...'
corepack yarn check:full

echo '[3/8] Building production IPK...'
rm -rf dist
corepack yarn build
IPK="dist/${APP_ID}_${VERSION}_all.ipk"
[[ -f "$IPK" ]] || { echo "ERROR: missing $IPK"; find dist -name '*.ipk' -print || true; exit 1; }

REMOTE_IPK="/tmp/${APP_ID}_${VERSION}_all.ipk"

echo '[4/8] Closing any running HomeBack instance...'
ssh "$TV" sh -s -- "$APP_ID" <<'REMOTE'
set -eu
APP_ID="$1"
PAYLOAD="$(printf '{"id":"%s"}' "$APP_ID")"
luna-send -n 1 -f luna://com.webos.service.applicationManager/closeByAppId "$PAYLOAD" >/dev/null 2>&1 || true
REMOTE

echo '[5/8] Copying package...'
scp "$IPK" "${TV}:${REMOTE_IPK}"

echo '[6/8] Installing...'
set +e
ssh "$TV" sh -s -- "$REMOTE_IPK" "$APP_ID" <<'REMOTE'
set -eu
IPK="$1"
APP_ID="$2"
sha256sum "$IPK"
PAYLOAD="$(printf '{"id":"%s","ipkUrl":"%s","subscribe":true}' "$APP_ID" "$IPK")"
timeout 45 luna-send-pub -i -f luna://com.webos.appInstallService/dev/install "$PAYLOAD"
REMOTE
INSTALL_RC=$?
set -e
if [[ $INSTALL_RC -ne 0 && $INSTALL_RC -ne 124 ]]; then
  echo "ERROR: install command failed with exit $INSTALL_RC"
  exit "$INSTALL_RC"
fi
if [[ $INSTALL_RC -eq 124 ]]; then
  echo 'Installer subscription timed out; verifying installation state instead of assuming success.'
fi

echo '[7/8] Verifying installed version...'
ssh "$TV" sh -s -- "$APP_ID" "$VERSION" <<'REMOTE'
set -eu
APP_ID="$1"
VERSION="$2"
STATUS_PAYLOAD="$(printf '{"appId":"%s"}' "$APP_ID")"
STATUS="$(luna-send -n 1 -f luna://com.webos.applicationManager/getAppLoadStatus "$STATUS_PAYLOAD")"
printf '%s\n' "$STATUS"
printf '%s\n' "$STATUS" | grep -Eq '"exist"[[:space:]]*:[[:space:]]*true' || {
  echo 'ERROR: application manager does not report the app as installed.'
  exit 1
}

APPINFO="/media/developer/apps/usr/palm/applications/${APP_ID}/appinfo.json"
if [[ -f "$APPINFO" ]]; then
  grep -Eq '"version"[[:space:]]*:[[:space:]]*"'"$VERSION"'"' "$APPINFO" || {
    echo "ERROR: installed appinfo.json is not version $VERSION"
    cat "$APPINFO"
    exit 1
  }
  echo "Verified installed HomeBack version $VERSION"
else
  echo "WARNING: $APPINFO was not found; install existence was verified but filesystem version could not be checked."
fi
REMOTE

echo '[8/8] Scanning services and launching fresh process...'
ssh "$TV" sh -s -- "$APP_ID" <<'REMOTE'
set -eu
APP_ID="$1"
ls-control scan-services
PAYLOAD="$(printf '{"id":"%s"}' "$APP_ID")"
luna-send -n 1 -f luna://com.webos.applicationManager/launch "$PAYLOAD"
REMOTE

echo
echo "HomeBack $VERSION deployed to $TV"
