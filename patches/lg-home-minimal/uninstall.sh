#!/bin/sh
set -eu

NAME='LG Home Minimal'
HOME_LIB='/usr/palm/applications/com.webos.app.home/lib/libapp.so'
STATE_DIR='/var/lib/webosbrew/lg-home-minimal'
BOOT_HOOK='/var/lib/webosbrew/init.d/lg-home-minimal'
STOCK_SHA='42d2408ccdca5f5b57367a90acc5ad654b02e0056c7638c19a37a4f857a907ff'

say() { printf '%s\n' "$*"; }
sha() { sha256sum "$1" | awk '{print $1}'; }

if [ "$(id -u)" != '0' ]; then
    say 'ERROR: run this uninstaller as root.'
    exit 1
fi

rm -f "$BOOT_HOOK"

PIDS=$(ps -ef | awk '/\/usr\/bin\/flutter-client -i com\.webos\.app\.home/ && !/awk/ {print $2}')
for PID in $PIDS; do kill -TERM "$PID" 2>/dev/null || true; done
sleep 1
for PID in $PIDS; do [ -d "/proc/$PID" ] && kill -KILL "$PID" 2>/dev/null || true; done

while grep -Fq " $HOME_LIB " /proc/mounts; do
    umount "$HOME_LIB" 2>/dev/null || umount -l "$HOME_LIB" 2>/dev/null || break
done

if [ -f "$HOME_LIB" ]; then
    CURRENT=$(sha "$HOME_LIB")
    if [ "$CURRENT" = "$STOCK_SHA" ]; then
        say 'Stock LG Home library restored.'
    else
        say "WARNING: underlying Home library SHA is not the known stock build: $CURRENT"
    fi
fi

rm -rf "$STATE_DIR"

# Kill any Home process that raced the unmount so the next process loads stock.
PIDS=$(ps -ef | awk '/\/usr\/bin\/flutter-client -i com\.webos\.app\.home/ && !/awk/ {print $2}')
for PID in $PIDS; do kill -TERM "$PID" 2>/dev/null || true; done

say "$NAME removed."
