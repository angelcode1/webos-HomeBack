# LG C5 stock Home layout patch v14

This patch captures the final validated stock-Home layout used on the LG C5 test TV.

## Result

- keeps LG's stock Hero/banner sizing
- hides the Recommended shelf
- hides the QCard/Edit row
- keeps the app launcher visible
- positions the app launcher as low as practical while keeping the full tile visible

The final runtime binary was visually accepted on hardware.

## Hashes

Known v9b input:

```text
05517870a32d99e6acc37ecd3ed57fb12c502ef987a3ad7854dc60e0c3a8e6ba
```

Final v14 output:

```text
d3ac9759a0e693392b602cf49c28ba200c994f9054685a4509473abcd494b981
```

Expected file size:

```text
8,782,428 bytes
```

## Build

LG's proprietary `libapp.so` is intentionally not stored in this repository.

Build the exact validated v14 binary from the known v9b base:

```bash
python3 build-v14.py /path/to/libapp-homeui-fullbleed-raised-v9b.so
```

The script writes:

```text
libapp-homeui-stockhero-bottomrail-v14-x5.so
```

and refuses to patch an input whose SHA-256 does not exactly match the known v9b base.

## Runtime test

```sh
HOME_LIB=/usr/palm/applications/com.webos.app.home/lib/libapp.so
PATCH=/tmp/usb/sda/sda1/libapp-homeui-stockhero-bottomrail-v14-x5.so

sha256sum "$PATCH"

PIDS=$(
    ps -ef |
    awk '/\/usr\/bin\/flutter-client -i com\.webos\.app\.home/ &&
         !/awk/ {print $2}'
)

for PID in $PIDS; do
    kill -TERM "$PID" 2>/dev/null || true
done

sleep 0.5

for PID in $PIDS; do
    [ -d "/proc/$PID" ] && kill -KILL "$PID" 2>/dev/null || true
done

umount "$HOME_LIB" 2>/dev/null || umount -l "$HOME_LIB" 2>/dev/null || true
mount -o bind "$PATCH" "$HOME_LIB"

sha256sum "$HOME_LIB"
```

The live SHA-256 must be:

```text
d3ac9759a0e693392b602cf49c28ba200c994f9054685a4509473abcd494b981
```

Then start Home with a fresh process.

## Patch structure

v14 starts from the known v9b base and:

1. preserves the whole-widget `SizedBox.shrink()` patches for the QCard/Edit and Recommended rows;
2. restores the Hero dimension call at `0x620e10` to its original callee `0x621e9c`;
3. reuses the obsolete v9b Hero trampoline area for the independent launcher-position helper;
4. applies the validated `x5` launcher-path adjustment to `0x629418`, `0x62949c`, and `0x62957c`.

`build-v14.py` contains exact guards and verifies the final output hash.
