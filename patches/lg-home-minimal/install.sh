#!/bin/sh
set -eu

NAME='LG Home Minimal'
VERSION='v14-x5'
HOME_LIB='/usr/palm/applications/com.webos.app.home/lib/libapp.so'
STATE_DIR='/var/lib/webosbrew/lg-home-minimal'
PATCH="$STATE_DIR/libapp-lg-home-minimal.so"
INIT_DIR='/var/lib/webosbrew/init.d'
BOOT_HOOK="$INIT_DIR/lg-home-minimal"
STOCK_SHA='42d2408ccdca5f5b57367a90acc5ad654b02e0056c7638c19a37a4f857a907ff'
PATCH_SHA='d3ac9759a0e693392b602cf49c28ba200c994f9054685a4509473abcd494b981'
EXPECTED_SIZE='8782428'

say() { printf '%s\n' "$*"; }
sha() { sha256sum "$1" | awk '{print $1}'; }

if [ "$(id -u)" != '0' ]; then
    say 'ERROR: run this installer as root.'
    exit 1
fi

for cmd in sha256sum dd mount umount awk ps kill grep cp mv mkdir chmod wc; do
    command -v "$cmd" >/dev/null 2>&1 || {
        say "ERROR: required command is missing: $cmd"
        exit 1
    }
done

[ -f "$HOME_LIB" ] || {
    say "ERROR: stock Home library not found: $HOME_LIB"
    exit 1
}

mkdir -p "$STATE_DIR" "$INIT_DIR"
TMP="$STATE_DIR/.libapp-lg-home-minimal.so.tmp.$$"
trap 'rm -f "$TMP"' EXIT HUP INT TERM

say "Installing $NAME $VERSION"
say 'Stopping Home before exposing the stock library...'
PIDS=$(ps -ef | awk '/\/usr\/bin\/flutter-client -i com\.webos\.app\.home/ && !/awk/ {print $2}')
for PID in $PIDS; do kill -TERM "$PID" 2>/dev/null || true; done
sleep 1
for PID in $PIDS; do [ -d "/proc/$PID" ] && kill -KILL "$PID" 2>/dev/null || true; done

# Remove any old test/USB/persistent bind layers so the immutable firmware file is visible.
while grep -Fq " $HOME_LIB " /proc/mounts; do
    umount "$HOME_LIB" 2>/dev/null || umount -l "$HOME_LIB" 2>/dev/null || {
        say "ERROR: could not remove existing bind from $HOME_LIB"
        exit 1
    }
done

LIVE_STOCK_SHA=$(sha "$HOME_LIB")
if [ "$LIVE_STOCK_SHA" != "$STOCK_SHA" ]; then
    say 'ERROR: unsupported stock Home library.'
    say "Expected: $STOCK_SHA"
    say "Found:    $LIVE_STOCK_SHA"
    say 'Nothing was installed or mounted.'
    exit 1
fi

SIZE=$(wc -c < "$HOME_LIB" | tr -d '[:space:]')
if [ "$SIZE" != "$EXPECTED_SIZE" ]; then
    say "ERROR: unexpected stock library size: $SIZE"
    exit 1
fi

cp "$HOME_LIB" "$TMP"

patch_bytes() {
    offset="$1"
    bytes="$2"
    printf '%b' "$bytes" | dd of="$TMP" bs=1 seek="$offset" conv=notrunc 2>/dev/null
}

# Hide QCard/Edit and RecommendedShelf as whole widgets.
SHRINK='\011\012\205\342\363\001\220\345\036\377\057\341'
patch_bytes $((0x64C818)) "$SHRINK"
patch_bytes $((0x6CD958)) "$SHRINK"

# Accepted v14 Hero/overlay behavior.
patch_bytes $((0x620F40)) '\100\013\060\356'
patch_bytes $((0x62100C)) '\100\013\060\356'
patch_bytes $((0x621180)) '\000'
patch_bytes $((0x621680)) '\047\000\000\352'

# Independent x5 app-rail positioning helper and three call sites.
patch_bytes $((0x37EC90)) '\100\033\260\356\000\013\060\356\000\013\060\356\001\013\060\356\044\000\232\345\036\377\057\341'
patch_bytes $((0x629418)) '\034\126\365\353'
patch_bytes $((0x62949C)) '\373\125\365\353'
patch_bytes $((0x62957C)) '\303\125\365\353'

BUILT_SHA=$(sha "$TMP")
if [ "$BUILT_SHA" != "$PATCH_SHA" ]; then
    say 'ERROR: patched output failed the known-good SHA-256 check.'
    say "Expected: $PATCH_SHA"
    say "Built:    $BUILT_SHA"
    say 'Nothing was installed or mounted.'
    exit 1
fi

chmod 0644 "$TMP"
mv -f "$TMP" "$PATCH"
trap - EXIT HUP INT TERM

cat > "$BOOT_HOOK" <<'BOOT'
#!/bin/sh
HOME_LIB='/usr/palm/applications/com.webos.app.home/lib/libapp.so'
PATCH='/var/lib/webosbrew/lg-home-minimal/libapp-lg-home-minimal.so'
STOCK_SHA='42d2408ccdca5f5b57367a90acc5ad654b02e0056c7638c19a37a4f857a907ff'
PATCH_SHA='d3ac9759a0e693392b602cf49c28ba200c994f9054685a4509473abcd494b981'
LOG='/tmp/lg-home-minimal.log'
sha() { sha256sum "$1" | awk '{print $1}'; }

{
    echo "LG Home Minimal boot apply: uptime=$(cut -d' ' -f1 /proc/uptime 2>/dev/null || echo unknown)"

    [ -f "$PATCH" ] || { echo "patch missing: $PATCH"; exit 0; }
    [ "$(sha "$PATCH")" = "$PATCH_SHA" ] || { echo 'patch SHA mismatch; refusing to mount'; exit 0; }

    # Always reveal the firmware file first. This prevents stacked binds and
    # automatically disables the patch after an unsupported firmware update.
    while grep -Fq " $HOME_LIB " /proc/mounts; do
        umount "$HOME_LIB" 2>/dev/null || umount -l "$HOME_LIB" 2>/dev/null || break
    done

    [ -f "$HOME_LIB" ] || { echo "Home library missing: $HOME_LIB"; exit 0; }
    current=$(sha "$HOME_LIB")
    if [ "$current" != "$STOCK_SHA" ]; then
        echo "unsupported stock SHA: $current"
        exit 0
    fi

    mount -o bind "$PATCH" "$HOME_LIB" || { echo 'bind mount failed'; exit 1; }
    live=$(sha "$HOME_LIB")
    [ "$live" = "$PATCH_SHA" ] || { echo "live SHA mismatch after mount: $live"; exit 1; }
    echo "mounted LG Home Minimal: $live"

    # If Home already started, force one fresh process so it loads the mounted binary.
    PIDS=$(ps -ef | awk '/\/usr\/bin\/flutter-client -i com\.webos\.app\.home/ && !/awk/ {print $2}')
    for PID in $PIDS; do kill -TERM "$PID" 2>/dev/null || true; done
    exit 0
} >>"$LOG" 2>&1
BOOT
chmod 0755 "$BOOT_HOOK"

cat > "$STATE_DIR/VERSION" <<EOF
name=$NAME
version=$VERSION
stock_sha256=$STOCK_SHA
patch_sha256=$PATCH_SHA
EOF

say "Persistent patch: $PATCH"
say "Boot hook:        $BOOT_HOOK"
say 'Applying persistent bind now...'
"$BOOT_HOOK"
sleep 1

LIVE_SHA=$(sha "$HOME_LIB")
if [ "$LIVE_SHA" != "$PATCH_SHA" ]; then
    say 'ERROR: install completed but live bind is not active.'
    say "Live SHA: $LIVE_SHA"
    exit 1
fi

say "$NAME installed successfully."
say "Live SHA256: $LIVE_SHA"
say 'USB storage is no longer required.'
