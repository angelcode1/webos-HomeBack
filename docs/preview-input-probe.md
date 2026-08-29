# Preview input probe — disposable hardware experiment

> **Do not merge this experiment into `main`.** It exists only to measure LG webOS compositor/input behaviour before the production preview architecture is implemented.

## What this branch tests

Launching HomeBack with `intent: homeback:preview` bypasses the normal Ribbon UI and shows a fixed diagnostic box for 30 seconds. The probe:

- activates HomeBack's existing floating webOS surface;
- does **not** subscribe `KeyboardService`;
- installs logging-only DOM listeners that never call `preventDefault`, `stopPropagation`, or `stopImmediatePropagation`;
- counts key, wheel, mouse, pointer, focus, blur, click, and visibility events;
- hides/suspends the HomeBack surface after 30 seconds using the existing lifecycle manager;
- resets the 30-second probe when another `homeback:preview` relaunch arrives.

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

## Trigger the probe

From an SSH shell on the TV:

```sh
luna-send -n 1 -f \
  luna://com.webos.service.applicationmanager/launch \
  '{"id":"com.homebrew.homeback","params":{"intent":"homeback:preview"}}'
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
      intent: homeback:preview
```

## Observe SAM/LSM foreground surfaces

Run this over SSH before triggering the preview and leave it subscribed:

```sh
luna-send -i -f \
  luna://com.webos.service.applicationmanager/getForegroundAppInfo \
  '{"subscribe":true,"extraInfo":true}'
```

Record the foreground array before activation, while the probe is visible, and after its timeout.

`getForegroundAppInfo` is evidence of foreground surface state; it is not by itself proof of input focus. The on-screen/non-consuming event counters and the underlying application's response are the input-routing evidence.

## Hardware matrix

Run the probe over at least YouTube, Live TV, and HDMI; add Netflix/Plex if convenient.

For each source, record whether the underlying application responds and whether HomeBack's counters increment for:

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
5. Back or another system key causes HomeBack/platform exit behaviour.

Test short and long Back separately.

## Lifecycle checks

Also verify:

1. Existing video/audio continues while the probe appears.
2. After the 30-second timeout, underlying navigation returns immediately and HomeBack is no longer foreground.
3. Triggering a second preview while one is active replaces/resets the probe without an obvious compositor/focus flash.
4. Pressing short HOME during the probe records the resulting `webOSRelaunch` behaviour and whether the Ribbon appears, the preview remains, or the surface is hidden.
5. After the probe times out, HomeBack can still be reopened normally.

## Interpretation

Do **not** add a fourth `KeyboardOwner` based on this branch. The production input contract remains intentionally undecided until the TV results show whether a preview-only floating surface can be passive.
