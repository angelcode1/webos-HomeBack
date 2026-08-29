# Overlay input probe — disposable hardware experiment

> **Do not merge this branch into `main`.** This branch starts from main commit `055c022b58b8f7ad1ec4a296538a5b5d66d15fd6` and intentionally cherry-picks nothing from `experiment/preview-input-probe`.

## Result — measured on hardware

**Passive input routing is falsified for this overlay mechanism on the tested TV.**

The experiment confirmed all of the following:

- YouTube remained present as `_WEBOS_WINDOW_TYPE_CARD` while HomeBack was simultaneously present as `_WEBOS_WINDOW_TYPE_OVERLAY`.
- Before the HomeBack overlay appeared, YouTube responded normally to D-pad input.
- While the HomeBack overlay was visible, YouTube did not respond to D-pad input.
- LSM explicitly identified `surfaceItem_com.homebrew.homeback_WEBOS_WINDOW_TYPE_OVERLAY` as the focused surface for D-pad keys.
- HomeBack received ArrowLeft/ArrowRight/ArrowUp/ArrowDown DOM key events even though the probe never called `webOSSystem.activate()` and never consumed the events in JavaScript.
- Magic Remote pointer and wheel events also reached HomeBack.
- Short Back was routed to HomeBack as `BrowserBack`; the probe did not close from that key and remained alive until its 20-second safety timeout.
- The 20-second safety timeout called `webOSSystem.hide()`, after which WAM removed HomeBack focus and the probe logged `blur`.

This is a stronger negative result than the earlier floating probe for the narrow passive-input question: changing the manifest from `floating` to `overlay` does not preserve underlying application keyboard control, even when HomeBack does **not** explicitly call `activate()`.

Do not infer more than was measured. In particular, this experiment does not claim that every webOS system overlay type or native System UI primitive behaves this way. The native notification path (`com.webos.notification/createAlert`) is a separate mechanism and was validated independently.

**Experiment status: complete. Freeze this branch as the measurement record. Do not evolve this implementation into production code.**

## Purpose

The floating-surface experiment established that `defaultWindowType: "floating"` plus `webOSSystem.activate()` owns compositor input focus on the tested LG C5, and that `webOSSystem.window.setFocus(false)` does not restore usable input to the underlying YouTube card while the floating surface remains visible.

That did **not** establish the behaviour of `defaultWindowType: "overlay"`, so this branch asked one narrow question:

> Can a webOS `overlay` web app remain visibly rendered above the current application while normal D-pad/OK input continues to reach the underlying application?

The measured answer is **no** for this mechanism on the tested TV.

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

The branch therefore measured the default overlay window behaviour rather than `overlay + activate()` behaviour.

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

The hardware run used:

```sh
luna-send -i -f \
  luna://com.webos.service.applicationmanager/getForegroundAppInfo \
  '{"subscribe":true,"extraInfo":true}'
```

It confirmed that YouTube remained a CARD and HomeBack appeared concurrently as an OVERLAY while the probe was visible.

## Test procedure used

Because the HomeBack root helper intercepts short HOME, selecting YouTube can itself launch HomeBack. The test scheduled a close/relaunch from the TV shell and used the delay to navigate to YouTube.

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

HOME was then used to select YouTube before the 12-second delay expired. The scheduled close removed any HomeBack instance launched by the HOME interception, then the second launch started the dedicated overlay probe over YouTube.

YouTube D-pad response was verified before the overlay appeared. D-pad input was then tested again while the overlay was visible, followed by Magic Remote pointer/wheel and short Back.

The probe automatically hid after 20 seconds.

## Interpretation

### Observed: overlay owns application input

The measured run matched this case:

- HomeBack remained visibly mapped as an overlay.
- YouTube remained the underlying card.
- LSM named HomeBack's OVERLAY surface as the focused surface.
- HomeBack key counters/logs incremented.
- YouTube did not respond to D-pad input while the overlay was visible.

Therefore `defaultWindowType: "overlay"` does not solve passive rich-preview input routing on the tested TV.

### What remains valid

This negative result does **not** invalidate native notifications. `com.webos.notification/createAlert` uses System UI rather than a HomeBack web-app surface and was independently shown to render an icon and buttons and to invoke an application-manager launch action from a button.

## Scope

Do not carry this probe implementation into production. Production preview/notification architecture must start separately from `main`. The result of this experiment changes only the input/rendering contract.
