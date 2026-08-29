# Preview input probe — disposable hardware experiment

> **Do not merge this experiment into `main`.** It exists only to measure LG webOS compositor/input behaviour before the production preview architecture is implemented.

## What this branch tests

Launching HomeBack with `intent: homeback:probe` bypasses the normal Ribbon UI and shows a fixed diagnostic box for 30 seconds. The probe:

- uses a probe-only intent so it cannot collide with the future production `homeback:preview` contract;
- activates HomeBack's existing floating webOS surface;
- does **not** subscribe `KeyboardService`;
- if triggered while the Ribbon is already visible, first hides the Ribbon and waits for its existing committed-hide transition before starting the probe;
- retains that in-flight Ribbon quiesce so a replacement trigger cannot race ahead of the old 500 ms visibility commit;
- installs logging-only capture listeners at `window` level that never call `preventDefault`, `stopPropagation`, or `stopImmediatePropagation`;
- uses a passive capture listener for `wheel`;
- counts key, wheel, mouse, pointer, focus, blur, click, and visibility events;
- writes probe events with `console.warn`;
- logs wall-clock/performance-navigation timing and a post-mount paint snapshot;
- hides/suspends the HomeBack surface after 30 seconds using the existing lifecycle manager;
- resets the 30-second probe when another `homeback:probe` relaunch arrives.

An optional experiment-only parameter, `releaseFocus: true`, keeps the same probe and surface activation but asks `webOSSystem.window.setFocus(false)` after the floating surface receives focus. It exists solely to determine whether webOS can leave the floating surface mapped while returning input focus to the underlying card.

## Confirmed C5 baseline

On an LG OLED42C5PSA running firmware 33.00.71 / SDK 10.0.0, the ordinary activated probe (`releaseFocus` absent/false) established these facts:

- YouTube remained a `_WEBOS_WINDOW_TYPE_CARD` while HomeBack was simultaneously mapped as `_WEBOS_WINDOW_TYPE_FLOATING`.
- LSM explicitly reported the HomeBack floating surface as the **focused surface** for D-pad, OK/Enter, Back and cursor-state key events.
- HomeBack's logging-only JavaScript received those keys with `defaultPrevented=false`.
- Magic Remote pointer movement and wheel events reached HomeBack.
- Short Back reached HomeBack and did not automatically terminate it.

Therefore `webOSSystem.activate()` plus "no JavaScript input consumption" is **not passive input routing** on this TV. The remaining question is whether an explicit window-focus release can keep the floating surface visible while returning input to the underlying card.

## Build

Do not bump `package.json` and do not run the release workflow for this experiment.

```sh
corepack yarn install --immutable
corepack yarn check:full
rm -rf dist
corepack yarn build
```

The IPK remains the normal versioned test package under `dist/`.

## Capture logs

Production LG firmware may not provide persistent systemd journal files. On the tested C5, `/var/log/messages` and `/var/log/legacy-log` are available through PmLogDaemon.

Enable development logs and the relevant WAM contexts:

```sh
luna-send -n 1 -f \
  luna://com.webos.service.config/setConfigs \
  '{"configs":{"system.collectDevLogs":true}}'

PmLogCtl set WAM debug
PmLogCtl set wam.jsconsole debug
PmLogCtl set wam.log debug
PmLogCtl show | grep -iE 'WAM|wam\.jsconsole|wam\.log'
```

Start a capture before triggering the probe:

```sh
LOG="/tmp/homeback-probe-$(date +%s).log"
echo "$LOG"
tail -F /var/log/messages /var/log/legacy-log | tee "$LOG"
```

The probe prefixes its messages with:

```text
[HomeBackPreviewProbe]
```

After a run:

```sh
grep -a 'HomeBackPreviewProbe' "$LOG"
```

If another TV does have journald storage, `journalctl` can still be used, but do not assume it exists.

## Observe SAM/LSM foreground surfaces

Run this over SSH before triggering and leave it subscribed:

```sh
luna-send -i -f \
  luna://com.webos.service.applicationmanager/getForegroundAppInfo \
  '{"subscribe":true,"extraInfo":true}'
```

Record the foreground array before activation, while the probe is visible, and after its timeout. `getForegroundAppInfo` proves surface state, while LSM focus lines plus browser-event counters establish input routing.

With WAM/LSM debug logging enabled, lines of particular interest are:

```text
WebOSSurfaceItem::keyPressEvent, Focused surface ...
QPA_KEY_INPUT ... consumed=...
[HomeBackPreviewProbe] keydown ... defaultPrevented=...
[HomeBackPreviewProbe] focus
[HomeBackPreviewProbe] blur
[HomeBackPreviewProbe] focus-release ...
```

## Trigger the ordinary activated probe

For a genuine cold timing run, first put the desired underlying source on screen, then close HomeBack over SSH:

```sh
luna-send -n 1 -f \
  luna://com.webos.service.applicationManager/closeByAppId \
  '{"id":"com.homebrew.homeback"}'
```

**Do not press HOME between this close and the probe launch.** HomeBack's root helper intercepts short HOME and launches `homeback:show`, which makes the subsequent probe a warm relaunch rather than a cold launch.

Then trigger directly from SSH:

```sh
echo "probe-trigger $(date '+%Y-%m-%dT%H:%M:%S%z')"
luna-send -n 1 -f \
  luna://com.webos.service.applicationmanager/launch \
  '{"id":"com.homebrew.homeback","params":{"intent":"homeback:probe"}}'
```

The probe start log contains `epochMs`, `performanceNowMs`, `timeOriginMs`, `navigationStartMs`, and a later `post-mount-frame` entry. A warm relaunch is useful for resident-path timing but must not be reported as cold-start latency.

## Focus-release follow-up — run next

The ordinary C5 test already showed that an activated floating HomeBack surface owns compositor keyboard focus. The next test isolates whether webOS can release that focus without unmapping the surface.

With YouTube already playing, use:

```sh
luna-send -n 1 -f \
  luna://com.webos.service.applicationManager/closeByAppId \
  '{"id":"com.homebrew.homeback"}'

sleep 2

echo "focus-release-probe $(date '+%Y-%m-%dT%H:%M:%S%z')"
luna-send -n 1 -f \
  luna://com.webos.service.applicationmanager/launch \
  '{"id":"com.homebrew.homeback","params":{"intent":"homeback:probe","releaseFocus":true}}'
```

Do not press HOME between the close and launch.

Expected diagnostic logs include:

```text
[HomeBackPreviewProbe] start ... releaseFocus=true ...
[HomeBackPreviewProbe] focus
[HomeBackPreviewProbe] focus-release request ...
[HomeBackPreviewProbe] blur
[HomeBackPreviewProbe] focus-release result focused=false ...
```

The decisive observations are:

1. Does HomeBack remain in `foregroundAppInfo` as `_WEBOS_WINDOW_TYPE_FLOATING` after `focus-release`?
2. Does LSM still say `surfaceItem_com.homebrew.homeback...` is the focused surface when Left/Right/OK is pressed?
3. Do HomeBack's key counters still increment?
4. Does the underlying YouTube UI respond to Left/Right/OK?
5. Do pointer and wheel events remain with HomeBack or return to YouTube?

Interpretation:

- **Surface remains + LSM focus/keys return underneath:** a truly passive preview remains viable.
- **Surface remains + LSM still targets HomeBack:** passive preview is not viable with this API; production preview must be interactive/focus-owning or use a different platform surface mechanism.
- **Focus release unmaps/minimizes the surface:** `setFocus(false)` cannot provide the desired passive overlay contract.
- **`setFocus(false)` throws or has no observable effect:** treat it as unavailable/ineffective on this firmware and use the activated-probe result.

## Abort / lockout recovery

If the floating surface captures application input, do not rely on the remote as the only escape path. From SSH:

```sh
luna-send -n 1 -f \
  luna://com.webos.service.applicationmanager/launch \
  '{"id":"com.homebrew.homeback","params":{"intent":"homeback:show"}}'
```

This unmounts the probe and clears its timers. It intentionally leaves the normal HomeBack Ribbon open.

## Record the TV version before Ribbon-visible lifecycle checks

```sh
luna-send -n 1 -f \
  luna://com.webos.service.tv.systemproperty/getSystemInfo \
  '{"keys":["sdkVersion","firmwareVersion","modelName"]}'
```

The current production `commitHidden()` uses `applicationManager/suspense` on webOS below 7.3 and while `sdkVersion` is unresolved/unparseable. The tested C5 reports SDK 10.0.0, so that old-platform caveat does not apply there. On older/unknown firmware, run the Ribbon-visible lifecycle check last and treat anomalies in its `suspense -> activate` sequence separately from the cold input result.

## Control pass — required before every probe run

Before launching the probe over a source, exercise the exact actions that will be tested and record which ones the underlying source normally handles. Do not score an action as blocked unless it demonstrably worked immediately before the probe. Record actions the source itself ignores as **N/A**.

## Hardware matrix

Run over at least YouTube, Live TV and HDMI; add Netflix/Plex if convenient. For each source test D-pad, OK, short Back, long Back, Play/Pause where meaningful, Magic Remote pointer movement, wheel/scroll, click, Channel +/- on Live TV, and short HOME. Volume/Mute are controls only because they may route below ordinary application input handling.

For each input distinguish:

1. HomeBack receives it and the underlying app also responds.
2. HomeBack receives it and the underlying app does not respond.
3. HomeBack does not receive it and the underlying app responds.
4. Neither receives/responds.
5. The platform performs system-level Back/HOME behaviour.

Test short and long Back separately. `disableBackHistoryAPI: true` means Back behaviour must be measured rather than inferred from browser history semantics.

## Lifecycle checks

Also verify:

1. Existing video/audio continues while the probe appears.
2. After the 30-second timeout, underlying navigation returns immediately and HomeBack is no longer foreground.
3. Triggering a second `homeback:probe` while one is active replaces/resets the probe without an obvious compositor/focus flash.
4. Triggering from an already-visible Ribbon first quiesces the Ribbon, then produces a stable probe.
5. Short HOME during the probe records the resulting `webOSRelaunch` and returns to the Ribbon without a stale timeout firing later.
6. After timeout, HomeBack can still be reopened normally.

## Known branch-only bookkeeping drift

The probe timeout calls `lifecycleManagerService.commitHidden()` directly. That correctly asks webOS to hide the experimental surface but bypasses RibbonService's private `hiddenCommitted` bookkeeping. This is intentionally not fixed here: it is concrete evidence that production compositor commits and committed-state bookkeeping need one owner (`SurfaceService`).

## Interpretation

Do **not** add a fourth `KeyboardOwner` based on this branch. The ordinary activated probe has proven that activation itself gives HomeBack compositor focus on the tested C5. Complete the `releaseFocus: true` test before locking the production input contract.
