# Preview input probe — disposable hardware experiment

> **Do not merge this experiment into `main`.** It exists only to measure LG webOS compositor/input behaviour before the production preview architecture is implemented.

## What this branch tests

Launching HomeBack with `intent: homeback:probe` bypasses the normal Ribbon UI and shows a fixed diagnostic box for 30 seconds. The probe:

- uses a probe-only intent so it cannot collide with the future production `homeback:preview` contract;
- activates HomeBack's existing floating webOS surface;
- does **not** subscribe `KeyboardService` for a cold probe;
- if triggered while the Ribbon is already visible, first hides the Ribbon and waits for its existing committed-hide transition before starting the probe, so Ribbon-owned keyboard/auto-hide state cannot contaminate the measurement;
- retains that in-flight Ribbon quiesce so a replacement trigger cannot race ahead of the old 500 ms visibility commit;
- installs logging-only capture listeners at `window` level that never call `preventDefault`, `stopPropagation`, or `stopImmediatePropagation`;
- uses a passive capture listener for `wheel`;
- counts key, wheel, mouse, pointer, focus, blur, click, and visibility events;
- writes probe events with `console.warn` so WAM logging is less likely to discard them at default verbosity;
- logs wall-clock/performance-navigation timing and a post-mount paint snapshot for cold-start latency measurement;
- hides/suspends the HomeBack surface after 30 seconds using the existing lifecycle manager;
- resets the 30-second probe when another `homeback:probe` relaunch arrives.

The purpose is to distinguish browser event handling from compositor-level focus/input routing.

## Build

Do not bump `package.json` and do not run the release workflow for this experiment.

```sh
corepack yarn install --immutable
corepack yarn check:full
rm -rf dist
corepack yarn build
```

The IPK remains the normal versioned test package under `dist/`.

## Capture logs before triggering

Start a broad journal capture on the TV **before** launching the probe so the record survives if Back or another system action terminates/hides HomeBack:

```sh
LOG="/tmp/homeback-preview-probe-$(date +%s).log"
journalctl -f -o short-precise | tee "$LOG"
```

The probe prefixes its messages with:

```text
[HomeBackPreviewProbe]
```

Do not assume a WAM/pmlog facility filter until it has been confirmed on the target TV/webOS version. After one run, inspect the broad capture and, if the prefix is present, use it for a narrower follow-up view, for example:

```sh
grep 'HomeBackPreviewProbe' "$LOG"
```

If this webOS build does not forward browser console output into `journalctl`, keep the on-screen counters as the primary browser-event record and note that limitation with the test result.

## Trigger the probe

For a cold-start timing run, print a shell timestamp immediately before the launch command. The probe start log contains `epochMs`, `performanceNowMs`, `timeOriginMs`, `navigationStartMs`, and a later `post-mount-frame` entry with browser paint timing when available.

```sh
echo "probe-trigger $(date '+%Y-%m-%dT%H:%M:%S%z')"
luna-send -n 1 -f \
  luna://com.webos.service.applicationmanager/launch \
  '{"id":"com.homebrew.homeback","params":{"intent":"homeback:probe"}}'
```

Equivalent Home Assistant action:

```yaml
action: webostv.command
target:
  entity_id: media_player.living_room_tv
data:
  command: system.launcher/launch
  payload:
    id: com.homebrew.homeback
    params:
      intent: homeback:probe
```

For the latency result, distinguish the external launch-command timestamp from the browser-relative values. `performance.now()` / paint-entry times are relative to the webview navigation timeline; `epochMs` lets them be correlated with the SSH/journal record. A warm relaunch is not a substitute for the cold-launch measurement.

## Abort / lockout recovery

If the floating surface captures application input, a run can make normal navigation appear dead for up to 30 seconds. Do not rely on the remote as the only escape path.

From SSH, force HomeBack back to its normal Ribbon route:

```sh
luna-send -n 1 -f \
  luna://com.webos.service.applicationmanager/launch \
  '{"id":"com.homebrew.homeback","params":{"intent":"homeback:show"}}'
```

This unmounts the probe and clears its timers. It intentionally leaves the normal HomeBack Ribbon open; dismiss it normally afterwards.

## Observe SAM/LSM foreground surfaces

Run this over SSH before triggering the probe and leave it subscribed:

```sh
luna-send -i -f \
  luna://com.webos.service.applicationmanager/getForegroundAppInfo \
  '{"subscribe":true,"extraInfo":true}'
```

Record the foreground array before activation, while the probe is visible, and after its timeout.

`getForegroundAppInfo` is evidence of foreground surface state; it is not by itself proof of input focus. The capture-phase/non-consuming event counters and the underlying application's response are the input-routing evidence.

## Record the TV version before Ribbon-visible lifecycle checks

Before lifecycle checks that start the probe from an already-visible Ribbon, record the TV identity/version:

```sh
luna-send -n 1 -f \
  luna://com.webos.service.tv.systemproperty/getSystemInfo \
  '{"keys":["sdkVersion","firmwareVersion","modelName"]}'
```

This matters because the current production `commitHidden()` uses `applicationManager/suspense` on webOS below 7.3 and also while `sdkVersion` is unresolved/unparseable. The Ribbon-visible experiment path deliberately waits for that existing committed-hide operation and then activates the probe. On those systems this can therefore become `suspense` followed very quickly by `activate`, a sequence normal HomeBack does not otherwise perform.

The **cold probe is unaffected** by this ambiguity. Run the source/input matrix first. Run Ribbon-visible lifecycle check 4 last, with the SSH abort command ready. If the recorded SDK is below 7.3, or the probe start log shows `sdkVersion=null`, treat any anomaly in that Ribbon-visible check as suspect until separately reproduced; do not promote it to a compositor/input conclusion.

## Control pass — required before every probe run

Before launching the probe over a source, exercise the exact keys/actions that will be tested and record which ones the underlying source normally handles. Do not score an action as "blocked by HomeBack" unless the same action demonstrably worked immediately before the probe.

Examples:

- verify D-pad and OK move/select in YouTube before testing them under the probe;
- verify Play/Pause actually affects the current app/source before using it as evidence;
- verify Channel +/- changes channels in Live TV;
- record actions that the current source simply ignores as **N/A**, not pass/fail.

## Hardware matrix

Run the probe over at least YouTube, Live TV, and HDMI; add Netflix/Plex if convenient.

For each source, record the control-pass result, whether the underlying application responds during the probe, and whether HomeBack's counters increment for:

- D-pad Left/Right/Up/Down
- OK/Enter
- short Back
- long Back
- Play/Pause
- Magic Remote pointer movement
- wheel/scroll
- click/pointer activation
- Channel +/- on Live TV
- Volume +/- and Mute as controls only; these may be routed below normal app input handling
- short HOME while the probe is active

Possible results must distinguish:

1. HomeBack logs the key and the underlying app also responds.
2. HomeBack logs the key but the underlying app does not respond.
3. HomeBack does not log the key and the underlying app responds.
4. Neither HomeBack nor the underlying app receives/responds.
5. Back or another system key causes HomeBack/platform exit or other system-level behaviour.

Test short and long Back separately. `disableBackHistoryAPI: true` means Back behaviour must be measured rather than inferred from browser history semantics.

## Lifecycle checks

Also verify:

1. Existing video/audio continues while the probe appears.
2. After the 30-second timeout, underlying navigation returns immediately and HomeBack is no longer foreground.
3. Triggering a second `homeback:probe` while one is active replaces/resets the probe without an obvious compositor/focus flash.
4. Triggering the probe while the Ribbon is already visible first quiesces the Ribbon, then produces a stable 30-second probe rather than disappearing after the old 500 ms hide commit.
5. Pressing short HOME during the probe records the resulting `webOSRelaunch` behaviour and returns to the normal Ribbon route without a stale probe timer firing later.
6. After the probe times out, HomeBack can still be reopened normally.

For lifecycle checks 4–6, keep both the SAM/LSM subscription and journal capture running; screen observation alone is insufficient. Apply the SDK-version caveat above to check 4.

## Known branch-only bookkeeping drift

The probe timeout calls `lifecycleManagerService.commitHidden()` directly. That correctly asks webOS to hide/suspend the experimental surface, but it bypasses RibbonService's private `hiddenCommitted` bookkeeping, so RibbonService can believe the surface is not committed hidden even though the compositor has been told to hide it.

This is intentionally **not fixed in the disposable probe**. Nothing in the cold input measurement relies on RibbonService's committed state after timeout, and changing the ownership model here would prematurely implement the production refactor. Record it as concrete evidence for Phase 1: compositor commits and their bookkeeping must have one owner (`SurfaceService`) rather than being split between feature code and lifecycle code.

## Interpretation

Do **not** add a fourth `KeyboardOwner` based on this branch. The production input contract remains intentionally undecided until the TV results show whether a preview-only floating surface can be passive.
