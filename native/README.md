# Source-built C5 input hook

HomeBack no longer needs to carry unreviewable ELF executables in Git.
`native/source-lock.json` pins the public ARM32 upstream commits and SDK checksum.
`native/build-native.sh` cross-compiles `ezinject` and `inputhookpp` and
produces `native-artifacts/{ezinject,libinputhookpp.so,SHA256SUMS,SOURCE-LOCK.txt,...}`.
The CI and guarded manual release workflows stage that output into
`packages/service/vendor/inputhook/` **in their ephemeral workspaces** before webpack.

The source patch is deliberately pinned and fail-closed. It serializes LG
keybind-table modifications, avoids writing to callers' event buffers,
validates write size, quotes Luna JSON safely, and detects same-second atomic
config file replacement using inode, size and nanosecond modification time.

## Native structured-event protocol

For timed HomeBack actions the JSON-native action is `timed_ignore`; simple
native `ignore` continues to operate independently. A native `timed_ignore`
accepts suppression **only** if all the following succeed:

- The HomeBack event-loop lease `/tmp/homeback-remote-ipc/lease` is a regular
  file and its modification timestamp is 0–1.5 seconds old.
- A nonblocking AF_UNIX stream connect to
  `/tmp/homeback-remote-ipc/events.sock` succeeds immediately.
- The complete newline-delimited ASCII frame `<keycode> <state>\n` is sent
  without blocking, using `MSG_DONTWAIT | MSG_NOSIGNAL`.

Otherwise the native hook returns PASS. No waiting or retry loop runs in LG's
input thread. Node's `NativeRemoteChannel` owns the socket, validates each
frame, uses a root-only runtime directory and updates the tmpfs lease only
while the service has verified ownership and healthy diagnostic log readers.
Native events directly drive the existing short/long press state machine.
The original diagnostic log output is retained, but it does not drive the
state machine when HomeBack owns the new native hook.

This deliberately fails open if HomeBack is killed, its event loop wedges,
the event socket disconnects, or the socket backlog overflows. A dropped
press/release may forfeit a mapped action; it must never trap the remote.
The stale-press watchdog in the TypeScript state machine remains as a second
line of protection.

**Migration caveat:** 0.7.1's already-loaded hook does not understand the
new `timed_ignore` action. On installing a successor native build, **reboot
before comparing behavior**, then verify the newly loaded library in
`/proc/<pid>/maps`. Do not hot-swap libraries in a live input process.

## Validation

`python3 -m unittest discover -s native -p 'test_*.py' -v` checks the exact
source-anchor patch, event and fail-open contracts. `yarn check:full` runs
HomeBack's TypeScript and input-state tests including the IPC listener.
Native candidate CI cross-builds and checks ARM ELF identity plus checksums.
The HomeBack validation job independently cross-builds then compiles the IPKs.

A successful crossbuild is **not** device acceptance. On the rooted C5 test:
short and long Home (773), Netflix (1037), Prime (1038), Disney+ (1042),
LG Channels (1043), Alexa (1086), Stan (1111); logging/ownership after reboot;
absence of duplicate actions; and fail-open if service is unavailable. Confirm
the physical remote works even when HomeBack cannot consume its action.
Preserve the 0.7.1 IPK/config as the rollback option.

## Glasshouse review

Reviewed https://github.com/rorygallagher2024/glasshouse (MIT), especially
`docs/development/tv-specs/c5.md`, `server/lib/logs.js`,
`server/lib/syslog.js`, `server/lib/remotebuttons.js`,
`server/lib/remotebuttons.py` and the watchdog in `server/tvwebctl`.

Relevant lessons:
- It documents an LG C5 with AArch64 kernel and **ELF32 ARM userspace**.
  Our crossbuild target is therefore sensible; the target daemons must still
  be inspected on the particular TV.
- Its logs reader bounds reads, tracks inode/offset and preserves complete
  lines. Our open-descriptor tailer already avoids pathname-race reopening,
  caps individual reads and rotates its own logs; retain it for diagnostics.
- Its remote-colour worker uses nonblocking `select` on discovered
  `/dev/input/event*` and an `inputcommon` fallback. This does **not** prove
  that Home key 773 is present or consistently mapped on evdev, so we do not
  replace our known-good LG-specific input hook with it.
- It separates event processing into a worker to avoid occupying Node's
  event-loop threadpool. HomeBack uses a local event socket instead of
  polling log text; this avoids adding a Python dependency.
- Its watchdog uses a time-bounded heartbeat and distinguishes standby from
  dead services. HomeBack uses a much shorter heartbeat **only to fail open
  remote suppression**, not to restart LG processes.
- Log redaction and bounded exports are useful future diagnostic hygiene;
  do not forward confidential TV logs to an external syslog endpoint by
  default.

These findings are design references, not copied Glasshouse code.

## Licensing and publication gate

`sundermann/inputhookpp` is GPL-3.0, while HomeBack declares GPL-2.0-only
(from AltHome). Packaging separately built modules inside one IPK does not
itself resolve the legal compatibility question. The separate native
executables, the corresponding source commits, the changed-source patch,
the inputhookpp GPL text and the ezinject COPYING notice must accompany
any distributed test. An authoritative compatibility review is still
needed before claiming redistribution clearance for a stable catalog release.

The old untraceable community binary build remains available only from
prior historical commits/tags, not from the current source tree.
