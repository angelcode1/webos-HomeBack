# LG Home Minimal

A persistent stock-Home layout patch for the validated LG C5/webOS 25 build.

It keeps LG's Home launcher and stock banner behavior, but removes the two unused content rows and moves the app rail down to the accepted hardware-tested position while keeping the full selected tile visible.

## What it changes

- hides the **Recommended** shelf
- hides the **QCard/Edit** row
- keeps the normal LG Hero/banner behavior used by the accepted v14 build
- keeps the app launcher visible and moves it to the validated lower `x5` position
- does **not** replace or modify the firmware `libapp.so` on disk

The patch is installed as an internal persistent copy and bind-mounted over LG Home at runtime.

## Supported stock build

The installer is deliberately fail-closed. It only patches this exact stock Home library:

```text
/usr/palm/applications/com.webos.app.home/lib/libapp.so
SHA256 42d2408ccdca5f5b57367a90acc5ad654b02e0056c7638c19a37a4f857a907ff
size   8782428 bytes
```

The accepted patched output is:

```text
SHA256 d3ac9759a0e693392b602cf49c28ba200c994f9054685a4509473abcd494b981
```

If LG updates Home and the underlying stock SHA changes, the boot hook refuses to mount the old patch.

## Fresh install — no USB required

From your computer:

```bash
scp patches/lg-home-minimal/install.sh root@TV_IP:/tmp/lg-home-minimal-install.sh
ssh root@TV_IP 'sh /tmp/lg-home-minimal-install.sh'
```

The installer:

1. stops the running Home Flutter process;
2. removes any old USB/test bind layers from `libapp.so`;
3. verifies the underlying stock LG library;
4. creates the known-good patched copy;
5. stores it persistently at:

   ```text
   /var/lib/webosbrew/lg-home-minimal/libapp-lg-home-minimal.so
   ```

6. installs the Homebrew boot hook:

   ```text
   /var/lib/webosbrew/init.d/lg-home-minimal
   ```

7. bind-mounts the persistent internal copy immediately and restarts Home.

After that, the USB drive is not needed.

## Verify

```sh
sha256sum /usr/palm/applications/com.webos.app.home/lib/libapp.so
mount | grep '/usr/palm/applications/com.webos.app.home/lib/libapp.so'
cat /var/lib/webosbrew/lg-home-minimal/VERSION
```

Expected live SHA:

```text
d3ac9759a0e693392b602cf49c28ba200c994f9054685a4509473abcd494b981
```

## Uninstall

```bash
scp patches/lg-home-minimal/uninstall.sh root@TV_IP:/tmp/lg-home-minimal-uninstall.sh
ssh root@TV_IP 'sh /tmp/lg-home-minimal-uninstall.sh'
```

This removes the boot hook and persistent patched copy, unmounts the bind, and restarts Home against the underlying stock LG library.

## Implementation notes

`install.sh` is shell-only so it can run directly on the rooted TV without Python or a USB filesystem. It uses `dd` to patch a verified copy of the stock binary and verifies the exact final SHA before it installs or mounts anything.

The persistent location and boot mechanism use Homebrew Channel's `/var/lib/webosbrew` storage and `init.d` mechanism, the same persistent boot-hook mechanism used elsewhere by HomeBack.
