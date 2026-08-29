# Overlay input probe — disposable hardware experiment

> **Do not merge this branch into `main`.** This branch starts from main commit `055c022b58b8f7ad1ec4a296538a5b5d66d15fd6` and intentionally cherry-picks nothing from `experiment/preview-input-probe`.

## Purpose

The floating-surface experiment established that `defaultWindowType: "floating"` plus `webOSSystem.activate()` owns compositor input focus on the tested LG C5, and that `webOSSystem.window.setFocus(false)` does not restore usable input to the underlying YouTube card while the floating surface remains visible.

That does **not** establish the behaviour of `defaultWindowType: "overlay"`.

This branch asks one narrow question:

> Can a webOS `overlay` web app remain visibly rendered above the current application while normal D-pad/OK input continues to reach the underlying application?

## Deliberate differences from the floating probe

This is a fresh experiment, not an evolution of the old probe:

- `defaultWindowType` is `overlay`.
- `App` is a dedicated probe instead of Ribbon.
- The probe does **not** call `webOSSystem.activate()`.
- It does **not** call `webOSSystem.window.setFocus()`.
- It does **not** use `LifecycleManagerService`, `RibbonService`, or `KeyboardService`.
- It does **not** add or parse a probe intent.
- It does **not** alter production relaunch routing.
- Input listeners only observe and log; they do not call `preventDefault`, `stopPropagation`, or `stopImmediatePropagation`.
- The probe calls `webOSSystem.hide()` after 20 seconds as an experiment-only safety escape.

The branch therefore measures the default overlay window behaviour rather than `overlay + activate()` behaviour.

## Build

Do not bump the package version and do not run the release workflow.

```sh
corepack yarn install --immutable
corepack yarn check:full
rm -rf dist
corepack yarn build
```

## Logging

On the tested production TV, use PmLog rather than `journalctl`:

```sh
PmLogCtl set WAM debug
PmLogCtl set wam.jsconsole debug
PmLogCtl set wam.log debug

LOG="/tmp/homeback-overlay-probe-$(date +%s).log"
echo "$LOG"
tail -F /var/log/messages /var/log/legacy-log | tee "$LOG"
```

Probe logs use:

```text
[HomeBackOverlayProbe]
```

After the run:

```sh
grep -a 'HomeBackOverlayProbe' "$LOG"

grep -a -E \
'Focused surface|QPA_KEY_INPUT|HomeBackOverlayProbe.*(focus|blur|key|wheel|pointer)' \
"$LOG"
```

## Foreground-surface subscriber

Leave this running in another SSH session:

```sh
luna-send -i -f \
  luna://com.webos.service.applicationmanager/getForegroundAppInfo \
  '{"subscribe":true,"extraInfo":true}'
```

Record whether YouTube remains a CARD and HomeBack appears as an OVERLAY while the probe is visible.

## Test procedure

Because the HomeBack root helper intercepts short HOME, selecting YouTube can itself launch HomeBack. The cleanest workflow is to schedule the close/relaunch from the TV shell and then use the delay to navigate to YouTube.

From the TV SSH shell:

```sh
(
  sleep 12
  luna-send -n 1 -f \
    luna://com.webos.service.applicationManager/closeByAppId \
    '{"id":"com.homebrew.homeback"}'
  sleep 2
  echo "overlay-probe-trigger $(date '+%Y-%m-%dT%H:%M:%S%z')"
  luna-send -n 1 -f \
    luna://com.webos.service.applicationmanager/launch \
    '{"id":"com.homebrew.homeback"}'
) &
```

Immediately use HOME to select YouTube before the 12-second delay expires. The scheduled close removes any HomeBack instance launched by the HOME interception, then the second launch starts the dedicated overlay probe over YouTube.

Before the overlay appears, verify YouTube responds to Left/Right/Up/Down and OK.

When the probe appears, wait about one second and test, in order:

1. Left
2. Right
3. Up
4. Down
5. OK
6. Magic Remote pointer movement
7. Wheel
8. short Back last

For each action record:

```text
HomeBack counter changed? yes/no
YouTube responded? yes/no
```

The probe automatically hides after 20 seconds. Emergency SSH close:

```sh
luna-send -n 1 -f \
  luna://com.webos.service.applicationManager/closeByAppId \
  '{"id":"com.homebrew.homeback"}'
```

## Interpretation

### Passive overlay is viable

All of the following should be true:

- HomeBack remains visibly mapped as an overlay.
- YouTube remains the underlying card.
- D-pad/OK continue to operate YouTube.
- LSM does not route those keys to HomeBack as the focused application surface.
- HomeBack key counters remain zero or only receive non-exclusive/global events.

### Overlay still owns application input

If HomeBack remains visible but LSM names it as the focused surface, HomeBack key counters increment, and YouTube does not respond, then the overlay window type does not solve passive rich-preview input routing on this TV.

### Overlay is system-special

If HOME/system behaviour automatically closes the overlay, or only pointer/global events have special routing, record that separately. It may still be useful for narrowly scoped UI even if it is not a general passive camera-preview surface.

## Scope

Whatever the result, do not carry this probe implementation into production. Production preview/notification architecture must start separately from `main`. The result of this experiment changes only the input/rendering contract.
