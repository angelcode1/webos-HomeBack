# HomeBack 0.4.14 optimized build

HomeBack 0.4.14 uses application ID `com.homebrew.homeback` and service ID
`com.homebrew.homeback.service`.

## Build on macOS/Linux

Requirements: Node.js 22+, Corepack, and network access to the package registry.
All direct dependency versions are pinned. This archive does not contain a generated
`yarn.lock`, so the **first** install must be mutable; subsequent installs can use
`--immutable`.

```bash
corepack enable
corepack prepare yarn@4.12.0 --activate
corepack yarn install
corepack yarn check:full
rm -rf dist
corepack yarn build
```

After that first successful resolution, retain the generated `yarn.lock` in your
build/release checkout and use:

```bash
corepack yarn install --immutable
```

Expected package:

```bash
ls -lh dist/com.homebrew.homeback_0.4.14_all.ipk
```

Deploy:

```bash
TV=root@YOUR_TV_IP ./scripts/deploy-tv.sh
```

Production builds do not emit the frontend source map. `check:full` runs the
source invariants, unit tests, TypeScript checks, and ESLint before deployment.

No manual Luna ACG or service-file edits are intended. First launch asks
Homebrew Channel to elevate the helper. If a jailed helper was already running,
HomeBack asks that stale process to exit, then retries bootstrap so LS2 starts a
fresh elevated helper. The bootstrap reconciles the HomeBack-owned ACG permission
set and installs a detached boot retry worker. Remote input then self-starts and
reconciles after helper/LS2 restarts.

## HOME behavior

```text
short HOME, tray hidden  -> show tray
short HOME, tray visible -> hide tray
long HOME                -> stock LG Home
```

Unrelated remote keys do not auto-dismiss the tray.

## Remote mapping file

After the first launch:

```text
/home/root/.config/homeback/remote-buttons.json
```

is the supported editable policy file. See `REMOTE-BUTTONS.md`.

## Reboot remote startup and first-run setup

The generated Homebrew init script starts **remote input only**. It deliberately does not
launch or warm the floating HomeBack UI during boot: live-device testing showed that SAM can
accept an early UI launch before the surface stack is ready, leaving a hidden instance that
will not reliably resurface on later HOME presses.

The first successful bootstrap writes `homeback.setupComplete.v1` to application localStorage
**before** a one-time app restart can be requested. The setup screen can therefore appear on
the initial install when required, but normal reboots render HomeBack immediately on the first
real launch. `/tmp/homeback-autostart.log` records remote-worker `/proc/uptime` timestamps.


## Public release provenance gate

Normal development builds and TV deployment are unaffected by the native-payload provenance notice.
`./scripts/release.sh`, however, intentionally refuses to create public release artifacts until the
maintainer has confirmed redistribution rights for the exact bundled `ezinject` and
`libinputhookpp.so` files described in `THIRD_PARTY_NOTICES.md`.

After that confirmation, run:

```bash
HOMEBACK_NATIVE_REDISTRIBUTION_CONFIRMED=1 ./scripts/release.sh
```

The environment variable is an explicit maintainer acknowledgement; it is not itself a license grant.
