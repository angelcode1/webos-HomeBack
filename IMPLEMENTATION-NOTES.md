# HomeBack 0.4.14 implementation notes

## App discovery

`AppManagerProvider` is the source of installed launch points and subscribes to
`luna://com.webos.service.applicationManager/listLaunchPoints`. InputManager
entries retain the separate `@input:` namespace and SAM HDMI/input launch
points are filtered to avoid duplicates. App icons are hydrated through the
helper `/readIcon` endpoint.

## Automatic ACG and helper bootstrap

On first launch HomeBack tries `/bootstrap`. If the helper is not root, the app
asks Homebrew Channel to elevate `com.homebrew.homeback.service`, then asks the
already-running helper to exit through `/restartService`. This restart is
important: changing LS2 service/role files does not change the uid or jail of a
process that is already running. The retry loop then causes LS2 to activate a
fresh helper using the elevated configuration.

This sequence was verified on the target TV: the stale helper was PID 23996,
uid 6479, with its executable under `/var/palm/jail/com.homebrew.homeback.service`.
After that process was terminated and LS2 reactivated the service using the
Homebrew Channel wrapper, the new helper was uid/gid 0 with `/usr/bin/node`,
`/bootstrap` succeeded, and `/remote/status` reported `started: true`.

0.4.13 keeps the 0.4.10 removal of the experimental `run-js-service -r` service-file rewriting from
0.4.8. The tested stock launcher already defaults `user=root`, while Homebrew
Channel's wrapper disables `thirdparty_jail`. The proven defect was stale-process
lifetime after elevation, not the absence of `-r`.

When the automatic client-permission file changes, HomeBack cold-restarts the
frontend once so `PalmServiceBridge` starts with the new LS2 permissions.

## palmbus startup keepalive

The original AltHome 0.3.8 empty 10-second timer is intentionally retained. On
the TV, removing it allowed the dynamic JS service to exit before Luna delivered
the activation request. Do not remove it as dead code.

## Nested LS2 routing

`palmbus.Message.category()` and `.method()` are separate components. HomeBack
normalizes and rejoins them with one slash, so `/remote` + `status` resolves to
`/remote/status` while the privileged helper remains available
correctly.

## Remote hook

The low-level payload is the supplied unofficial community native build derived from the LG Input Hook lineage; see `THIRD_PARTY_NOTICES.md` and `packages/service/vendor/inputhook/NOTICE.md` for the known provenance/licensing boundary.
HomeBack keeps immediate `replace`/`ignore`/`exec`/`launch` mappings compatible
with it. Timed mappings are written as native `ignore` entries and HomeBack uses
the hook logs to distinguish press/release and implement short/long actions.

The default HOME key is 773:

```text
release before 650 ms -> HomeBack short action
still held at 650 ms   -> stock com.webos.app.home
release after long     -> no short action
```

## HOME toggle simplification

The 0.4.6 generic "unhandled key dismisses tray" behavior has been removed.
On this TV that policy could see a directional remote press through a secondary
DOM key representation and dismiss HomeBack while tile move/edit mode was
active. Volume also behaved inconsistently with that approach.

The policy is now deliberately minimal:

```text
HOME short, hidden  -> show tray
HOME short, visible -> hide tray
HOME long           -> stock LG Home
```

Arrow, OK/Enter and Back continue to operate HomeBack while it is visible.
Other remote keys pass through without changing tray visibility. The existing
`homeback:show` intent string is preserved so already-created
`remote-buttons.json` files continue to work without migration; lifecycle code
routes that default HOME relaunch intent to RibbonService's existing visibility toggle.

## Existing LG Input Hook migration

If standalone LG Input Hook is detected, HomeBack imports existing simple
keybinds on first configuration creation and tails existing hook logs rather
than immediately double-injecting current target PIDs. After standalone Input
Hook is removed and the TV is rebooted, HomeBack can own injection itself.
## Launcher/default-config/UI changes

- `packages/app/manifests/appinfo.json` now sets `visible: true`. The stock Home
  launcher therefore gets HomeBack's normal launch point, using the already
  bundled 80x80 and 130x130 PNG icons for first launch. `AppManagerProvider`
  filters HomeBack's own launch point so making it visible does not create a
  recursive HomeBack tile inside the HomeBack ribbon.
- The fresh-install remote default is the proven multi-key mapping supplied by
  the tester. Existing `/home/root/.config/homeback/remote-buttons.json` files
  are not overwritten.
- Add apps uses a dedicated compact width/icon class; normal app tiles
  remain 118px wide and colour-key tiles remain 60% width.
- `REMOTE-BUTTONS.md` is an end-user GitHub guide for customizing mappings,
  finding keycodes, status checks, backups, and recovery.


## 0.4.11 boot-autostart reliability

The target TV proved that HomeBack could own the bundled Input Hook after the
standalone service was disabled, but immediately after reboot the helper was root
while `/remote/status` still reported `started: false`. The previous init hook
retried synchronously for only about 20 seconds.

0.4.11 replaces that with a detached worker launched from
`/var/lib/webosbrew/init.d/homeback`. `run-parts` can therefore return immediately
and Homebrew Channel can finish startup. The worker retries `/remote/start` for up
to 120 seconds, rescans LS2 between failed attempts, and writes diagnostics to
`/tmp/homeback-autostart.log`. A successful `/remote/start` keeps the helper alive
through RemoteInputManager's timers and process monitoring.

The fresh-install six-button default is now, in physical button order:

```text
Netflix      -> short YouTube / long USB-C 1
Prime Video  -> short HDMI 1  / long USB-C 2
Disney+      -> short HDMI 2  / long Red
Stan         -> short HDMI 3  / long Green
LG Channels  -> short HDMI 4  / long Yellow
Alexa        -> short CDP-30  / long Blue
```

Existing user `remote-buttons.json` files remain untouched.

## 0.4.12 USB-C IDs and stock-launcher icon

The tested long-press USB-C actions use the webOS launch IDs
`com.webos.app.usbc1` and `com.webos.app.usbc2`. The fresh-install default,
end-user documentation, and source verifier now use those exact IDs.

The stock LG Home tile no longer uses the original ribbon artwork. `icon.svg`
is a hand-authored HomeBack mark made from a simple home and counter-clockwise
return arrow, and the packaged `icon80.png`/`icon130.png` are rasterized from
that SVG so `appinfo.json` continues to use the launcher-safe PNG sizes.


## 0.4.13 reboot ownership/autostart fix and launcher palette

The target-TV reboot trace showed `/var/lib/webosbrew/init.d/homeback` did run,
but its first `/remote/start` response was `returnValue: true` while
`legacyInputHookDetected: true`, `injected: []`, and legacy target PIDs were
present. 0.4.12 incorrectly treated that transport-level Luna success as a
completed HomeBack startup. A later helper activation then reported
`legacyInputHookDetected: false`, `started: false`, proving the one-shot boot
state was not sufficient.

0.4.13 fixes that path at three layers:

- The detached init worker only records success when `started` is true, legacy
  mode is false, and the returned `injected` array contains a HomeBack-owned
  target. It continues retrying otherwise.
- `RemoteInputManager` re-evaluates the standalone marker during every process
  scan. If it began in legacy compatibility mode and that transient condition
  disappears, it detaches the legacy log cursors and immediately injects the
  bundled HomeBack payload. Repeated `/remote/start` calls now force a
  reconciliation rather than returning early forever. Startup and scans are
  promise-serialized to avoid duplicate timers/injections from concurrent boot
  requests.
- Every newly activated **root** HomeBack helper self-starts remote input after
  all LS2 methods are registered. A jailed pre-elevation helper skips this path.
  This restores remote interception automatically if LS2 later recreates the
  service process and its previous in-memory `RemoteInputManager` is lost.

The stock launcher icon remains a hand-authored SVG (no generated artwork). The
0.4.13 palette is exactly `#A50034` (background/launcher colour), `#FF0844`
(return arrow), `#6B6B6B` (door/arrow separation), and `#FFFFFF` (home). The
80x80 and 130x130 PNG launch assets are deterministic rasterizations of the SVG.

## 0.4.14 helper-recreation adoption and verified boot ownership

The clean HomeBack-only reboot test proved that 0.4.13's post-injection
verification fixed optimistic ownership reporting, but also exposed the final
restart case: if LS2 recreated the HomeBack Node helper while `micomservice` or
`lginput2` kept running, the new JavaScript process started with an empty target
map even though its previously injected `libinputhookpp.so` remained resident in
those native processes. Re-running `ezinject` in that state risks loading the
hook twice.

0.4.14 makes native process state authoritative:

- Before a target is injected, HomeBack reads `/proc/<pid>/maps` and looks for
  `libinputhookpp.so`.
- A mapping belonging to `com.homebrew.homeback.service` is adopted rather than
  injected again. The deterministic HomeBack event log is reattached at its
  current EOF so key events accumulated while the helper was down are not
  replayed as fresh actions.
- A second maps check runs immediately before `ezinject`, closing the race
  between process discovery and injection.
- A foreign mapped hook is placed in `blockedHooks`; HomeBack refuses to inject
  that PID. Standalone Input Hook paths also surface as legacy PIDs even if its
  marker/package vanished after the native library was already resident.
- Standalone detection now also consults the native mapping path, so removing the
  package/marker before reboot cannot trick HomeBack into injecting a process
  that still contains the standalone library.
- Newly created HomeBack `/tmp` hook logs use `O_NOFOLLOW`, and adopted logs must
  be regular non-symlink files before the root helper will tail them.
- Newly injected targets are still reported active only after the existing
  post-`ezinject` `/proc/<pid>/maps` verification succeeds.
- `/remote/status` exposes `source: "injected" | "adopted"` for active targets
  and `nativeOwnershipVerified`. The boot worker requires
  `nativeOwnershipVerified:true`, rather than inferring success from a non-empty
  in-memory array.
- If an already-loaded HomeBack hook has lost its event-log pathname, HomeBack
  deliberately refuses reinjection and reports `homeback-log-missing`; this is
  safer than creating a second hook instance whose callbacks could double-fire.

The app package's `shared/api/env.d.ts` declaration is also restored in 0.4.14.
Its accidental deletion in the refactor did not prevent Babel/Webpack output,
but it broke the project's TypeScript/release gate because `__DEV__` and the
compile-time `process.env.APP_ID` / `SERVICE_ID` globals became undeclared.

The stock launcher icon now uses the supplied refined white home glyph while
restoring the previous counter-clockwise **reverse-Amazon-smile** arrow geometry.
The 80 px and 130 px PNG launcher assets are regenerated from the same SVG.

### Device regression check for adoption

After HomeBack owns the hooks, record the `micomservice`/`lginput2` PIDs and run
`/remote/status`. Restart only the HomeBack helper, wait for LS2 to recreate it,
and query status again. The target PIDs should be unchanged and each surviving
hook should return with `source:"adopted"`, `nativeOwnershipVerified:true`, no
standalone service/marker, and no second native injection into those processes.


## 0.4.14 second review: bounded retries, shared process snapshot, and lint coverage

The next build review confirmed that adoption itself was correct but exposed three
long-running lifecycle issues: blocked PIDs were never reconsidered, permanent
injection failures retried forever, and each process-scan interval walked `/proc`
multiple times. It also found that removing `airbnb-typescript/base` had silently
caused `eslint .` to stop discovering most `.ts/.tsx` files.

The service now creates a single target snapshot per scan. Each target record contains
its PID, process name, whether `/proc/<pid>/maps` was readable, and the mapped input-hook
path when one exists. Legacy detection and target reconciliation share this snapshot.
Injection still performs one deliberate second maps inspection immediately before
`ezinject`; that extra read is a safety preflight, not a duplicate discovery walk.

A failed maps read is never represented as "no mapped library". HomeBack blocks that
PID with `proc-maps-unreadable` and periodically probes it again. This closes the unsafe
case where a transient `/proc` error could otherwise be misread as an unhooked process
and lead to a duplicate injection.

Blocked PIDs are reconsidered every ten seconds. `homeback-log-missing` can therefore
recover after a transient filesystem error, while a genuinely missing log remains
blocked and surfaces an explicit restart/reboot remedy. Foreign hooks are similarly
re-probed without adding scan-wide `/proc` walks.

Injection failure is now a bounded state machine. A PID gets at most three consecutive
automatic attempts: the first two are delayed by 5 and 10 seconds, and the third moves
the PID to `blockedHooks` with `reason:"injection-failed"`. No further automatic
`ezinject` process is spawned for that live PID. Low-frequency mapping probes continue,
which means a valid HomeBack mapping introduced by a recovery action can be adopted
without restarting the Node helper.

Verified boot ownership is evaluated only across observed essential targets:
`lginput2` and `micomservice`. Compatibility targets remain monitored and any conflict
is still reported, but a foreign hook on `tvservice`, `RELEASE`, or `testapp` no longer
forces the boot worker to time out when HomeBack fully owns the essential input path.

ESLint discovery is now explicit in every workspace (`--ext .ts,.tsx,.js`) and the
utils workspace has its own parser/project config. The lint policy no longer relies on
the archived `eslint-config-airbnb-typescript` package or on JS-only Airbnb rules to
understand TypeScript. This keeps the release gate meaningful while retaining the
current TypeScript-ESLint 8 toolchain.
