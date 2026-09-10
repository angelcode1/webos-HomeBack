# HomeBack

HomeBack is a fast replacement Home launcher for **rooted LG TVs running webOS 6+**. It provides a compact app ribbon, a scrollable app drawer, quick access to Inputs, a numeric keypad with remote colour keys, configurable short/long-press remote-button mappings, and optional Home Assistant camera notifications with an on-demand native PiP camera viewer.

HomeBack is designed to feel like part of the TV rather than a separate launcher app:

- **HOME tap** — show or hide the HomeBack ribbon
- **HOME hold** — open the stock LG Home screen
- **App drawer** — browse installed apps with the D-pad or Magic Remote wheel
- **Inputs tile** — open the LG input picker
- **Keypad tile** — send 0–9 and R/G/Y/B as physical remote key presses
- **Cameras tile** — appears while a recent camera event is available; opens that camera in native LG PiP
- **Custom remote mappings** — launch apps, replace keys, ignore keys, run short/long actions, or execute commands

HomeBack includes its own remote-input service, so you **should not run the standalone LG Input Hook app at the same time**.

> **Requirements:** a rooted LG webOS TV with the webOS Homebrew Channel installed. HomeBack uses Homebrew's root capabilities and boot hooks. It is intended for webOS 6+.

## Installation

The normal HomeBack launcher/remapper uses one package:

```text
com.homebrew.homeback_<version>_all.ipk
```

### Home Assistant camera support requires the Camera IPK

If you want to use **Home Assistant camera notifications and the Cameras PiP viewer**, install the matching camera companion package from the **same HomeBack release** as well:

```text
com.homebrew.homeback.camera_<version>_all.ipk
```

Install **both IPKs** for the supported Home Assistant camera workflow. The camera package is optional only if you do not use Home Assistant camera features; the launcher, app drawer, keypad and remote remapper work without it.

The camera companion is intentionally a separate webOS CARD application because LG's native Multi View/Picture-in-Picture controller needs a real second application surface. It is hidden from the normal launcher and is opened by HomeBack when you select **Cameras**.

After installing or updating both packages, launch the main HomeBack app once so its bootstrap can reconcile the required Luna permissions.

## First launch

Install and launch HomeBack once from the stock LG launcher or Homebrew Channel. On the first successful setup HomeBack installs the permissions and boot hook it needs, then remembers that setup is complete.

After that:

1. Rebooting the TV starts only HomeBack's remote-input helper in the background.
2. Press **HOME** to open HomeBack.
3. Hold **HOME** for about 650 ms to open the normal LG Home screen.

The "Setting up HomeBack…" screen is intended for first-time setup only and should not reappear after an ordinary reboot.

## Using the ribbon

The normal built-in utility tiles are:

**Inputs → Keypad → Add apps**

When a fresh camera event is available, **Cameras** is inserted before **Add apps**. Recent Cameras is volatile in-memory state: a HomeBack service/system restart clears it, and camera entries expire rather than being kept as a permanent camera directory.

- **Inputs** opens the TV input picker.
- **Keypad** opens a compact pad above the HomeBack tray. Each digit is sent immediately as the corresponding physical remote number key. A four-button **R / G / Y / B** row sends the matching LG colour-key IDs. Press **Back** to dismiss the keypad.
- **Cameras**, when present, yields HomeBack's floating ribbon and explicitly opens the newest recent camera event in the native LG PiP/Multi View system using the separate Camera IPK.
- **Add apps** opens the app drawer so you can add or reorder apps on the ribbon.

The ribbon auto-hides after about three seconds of inactivity during normal browsing. D-pad, wheel and pointer activity reset the timer. Editing, the app drawer and the numeric keypad pause auto-hide while they are active.

## Home Assistant camera notifications

HomeBack deliberately separates **notification** from **viewing the camera**.

1. Home Assistant sends a camera event to HomeBack.
2. webOS shows a passive native notification and HomeBack records the newest camera media URL.
3. HomeBack does **not** automatically force Multi View/PiP over the app you are watching.
4. If you want to view the camera, press **HOME → Cameras**.
5. HomeBack yields its ribbon and explicitly launches the Camera companion as native LG PiP.
6. Use LG's normal PiP controls while it is open; close it with **Back** or the PiP **X/Close** control to return to the underlying app.

This manual flow is intentional. Hardware testing on an LG C5 showed that automatically opening native Multi View can temporarily interrupt the foreground video and hand D-pad focus to LG's PiP controls. Requiring an explicit Cameras click makes that focus transfer expected rather than disruptive.

### Camera PiP size and position

On the tested C5 the stock PiP sub-window measured about **576×324 logical pixels**. HomeBack requests a top-right camera window at approximately **70% of that size**, preserving 16:9:

```text
403 × 227
```

The preferred logical target is approximately `x=1445, y=72` on the tested 1920×1080 layout. This is a **best-effort firmware request**. If a TV rejects custom PiP coordinates, HomeBack keeps the otherwise-valid native PiP at LG's default size/position rather than failing the camera viewer.

### Media behavior

A recent camera event may provide:

- `imageUrl` — still image or image-compatible stream such as MJPEG
- `streamUrl` — optional preferred live-media URL

When `streamUrl` is a recognised browser-video URL such as HLS (`.m3u8`), MP4, M4V or WebM, the Camera companion uses a `<video>` element. Image-compatible streams and ordinary images are rendered with `<img>`. If a preferred video fails and a separate `imageUrl` is available, the still image remains the fallback.

Actual codec/container support is still determined by the LG webOS browser/media stack and the camera source. Home Assistant proxy URLs may need warm-up depending on the camera integration.

### Hardware validation scope

The camera transport, recent-camera state and native PiP work were developed on an **LG OLED42C5PSA.AAUQLJD** running **webOS SDK 10.0.0** and **firmware 33.00.71**. Other LG models/firmware may expose different Multi View restrictions or geometry behavior. HomeBack targets webOS 6+, but older firmware has not received the same camera-PiP hardware coverage.

For historical camera/HTTP validation notes, see [`docs/history/HTTP-PREVIEW-VALIDATION.md`](./docs/history/HTTP-PREVIEW-VALIDATION.md).

## Enable the authenticated Home Assistant HTTP transport

HomeBack's HTTP listener is disabled by default. It uses plain HTTP with bearer authentication and is intended for a **trusted LAN only**. Do not port-forward it to the Internet or use it across an untrusted network where the bearer token could be observed.

A recommended configuration, with Home Assistant at `192.168.1.10`, is:

```json
{
  "http": {
    "enabled": true,
    "port": 9876,
    "allowedSources": ["192.168.1.10"]
  }
}
```

The file is:

```text
/home/root/.config/homeback/http.json
```

`allowedSources: []` accepts authenticated clients from RFC1918 IPv4 private ranges. Pin the actual Home Assistant IP when practical. IPv4 CIDR entries such as `192.168.1.0/24` are also supported when a bounded subnet is intentional.

Restart the service after changing the configuration:

```sh
luna-send -n 1 -f \
  luna://com.homebrew.homeback.service/restartService \
  '{}'
```

Reconnect if required, then verify:

```sh
luna-send -n 1 -f \
  luna://com.homebrew.homeback.service/remote/status \
  '{}'
```

A healthy enabled listener reports values equivalent to:

```text
httpConfigLoaded: true
httpEnabled: true
httpListening: true
httpPort: 9876
httpFailureReason: null
```

After the listener has successfully bound, retrieve its token over the trusted root shell:

```sh
cat /home/root/.config/homeback/api-token
```

The token file is root-only (`0600`). Store it as a Home Assistant secret; do not expose it in automation YAML, screenshots or issue reports.

## Home Assistant `rest_command`

Put the full Authorization header value in `secrets.yaml`:

```yaml
homeback_token: "Bearer REPLACE_WITH_THE_64_HEX_TOKEN"
```

Then add this to `configuration.yaml`, replacing the TV IP:

```yaml
rest_command:
  homeback_status:
    url: "http://192.168.1.50:9876/status"
    method: GET
    headers:
      Authorization: !secret homeback_token

  homeback_preview:
    url: "http://192.168.1.50:9876/notification/createPreviewToast"
    method: POST
    content_type: "application/json"
    headers:
      Authorization: !secret homeback_token
    timeout: 6
    payload: >-
      {"cameraId": {{ camera_id | tojson }},
       "title": {{ title | tojson }},
       "message": {{ message | tojson }},
       "preview": {
         "title": {{ title | tojson }},
         "message": {{ message | tojson }},
         "imageUrl": {{ image_url | tojson }},
         "streamUrl": {{ (stream_url | default(none)) | tojson }},
         "durationMs": {{ (duration_ms | default(8000) | int) | tojson }}
       }}
```

Every interpolated JSON value is serialized with Jinja `| tojson`. Do not hand-quote camera names, messages or signed URLs.

`durationMs` remains part of the existing event/legacy Preview payload, but the **manual native PiP viewer does not auto-close on this duration**. The user closes native PiP with LG's controls.

## Recommended HA recipe — snapshot plus optional live stream

For a reliable fallback, create a fresh snapshot under `/config/www/homeback` and send that URL as `image_url`. Home Assistant serves `/config/www` at `/local/`.

Create the directory once:

```sh
mkdir -p /config/www/homeback
```

If `/config/www` did not exist when Home Assistant started, restart Home Assistant once after creating it so `/local/` is available.

Example automation:

```yaml
automation:
  - alias: "Front door to HomeBack"
    triggers:
      - trigger: state
        entity_id: binary_sensor.front_door_person
        to: "on"
    actions:
      - action: camera.snapshot
        target:
          entity_id: camera.front_door
        data:
          filename: /config/www/homeback/front_door.jpg

      - action: rest_command.homeback_preview
        data:
          camera_id: camera.front_door
          title: Front Door
          message: Person detected
          image_url: >-
            http://192.168.1.10:8123/local/homeback/front_door.jpg?v={{ now().timestamp() | int }}
          stream_url: >-
            http://192.168.1.10:8123/api/camera_proxy_stream/camera.front_door?token={{ state_attr('camera.front_door', 'access_token') }}
          duration_ms: 8000
```

If your camera/HA proxy is image-compatible MJPEG, the proxy stream URL can be rendered directly by the image path. If it resolves to a browser-native video format, HomeBack's Camera companion uses video playback. If you do not want live motion, omit `stream_url`; the snapshot remains sufficient for the Cameras PiP viewer.

### `/local/` snapshot security

`/config/www` is served without Home Assistant authentication. Anything that can reach your HA HTTP endpoint and knows or guesses the URL can fetch the snapshot until it is overwritten or removed. Use a stable file **per camera** rather than accumulating timestamped event images.

The `?v=<event>` query parameter is only a cache buster. It does not make the underlying JPEG private or immutable.

HomeBack stores recent event URLs in volatile memory for up to two minutes. It is a recent-event viewer, not an image archive. A HomeBack service/system restart clears this state.

## Camera diagnostics

List recent cameras:

```sh
luna-send -n 1 -f \
  luna://com.homebrew.homeback.service/cameras/list \
  '{}'
```

Inspect the manually controlled PiP state:

```sh
luna-send -n 1 -f \
  luna://com.homebrew.homeback.service/cameras/pipStatus \
  '{}'
```

The status includes the retained main app, PiP admission result, the requested geometry, whether that geometry was accepted, and any geometry error. A geometry failure is intentionally non-fatal.

To close the companion from the shell during diagnosis:

```sh
luna-send -n 1 -f \
  luna://com.homebrew.homeback.service/cameras/close \
  '{}'
```

## Configuring remote buttons

HomeBack's user-editable remote mapping file is:

```text
/home/root/.config/homeback/remote-buttons.json
```

HomeBack watches this file and normally applies valid changes within about a second, so a reboot is usually not needed.

Before editing, make a backup:

```sh
cp /home/root/.config/homeback/remote-buttons.json \
   /home/root/.config/homeback/remote-buttons.json.bak
```

### HOME: short press HomeBack, long press stock LG Home

The default HOME mapping on the tested Magic Remote uses key code `773`:

```json
"773": {
  "label": "HOME",
  "short": {
    "action": "launch",
    "id": "com.homebrew.homeback",
    "params": { "intent": "homeback:show" }
  },
  "long": {
    "action": "launch",
    "id": "com.webos.app.home"
  }
}
```

The default long-press threshold is 650 ms. Remote key codes can vary by TV, remote and firmware, so treat the bundled defaults as a starting point.

### Launch an app

```json
"1037": {
  "action": "launch",
  "id": "youtube.leanback.v4"
}
```

### Give one button separate short and long actions

```json
"1038": {
  "label": "Prime Video button",
  "short": {
    "action": "launch",
    "id": "com.webos.app.hdmi1"
  },
  "long": {
    "action": "launch",
    "id": "com.webos.app.usbc2"
  }
}
```

You can override the hold threshold on one key with `"longPressMs": 800`, or change `defaultLongPressMs` for all timed mappings.

### Replace, ignore, pass or execute

Replace a button with another LG key:

```json
"362": {
  "action": "replace",
  "keycode": 795
}
```

Ignore a button:

```json
"1042": {
  "action": "ignore"
}
```

Pass a button through unchanged:

```json
"1042": {
  "action": "pass"
}
```

Run a shell command:

```json
"1044": {
  "action": "exec",
  "command": "your-command-here"
}
```

**Be careful with `exec`: commands run through HomeBack's privileged helper. Only configure commands you understand and trust.**

For the complete mapping schema and more examples, see [REMOTE-BUTTONS.md](./REMOTE-BUTTONS.md).

## Finding the key code for a remote button

HomeBack writes native input events to files such as:

```text
/tmp/homeback-inputhook-lginput2-<pid>.log
/tmp/homeback-inputhook-micomservice-<pid>.log
```

Watch them over SSH:

```sh
tail -F /tmp/homeback-inputhook-*.log
```

Then press the physical button you want to map. Look for a line containing a key code, for example:

```text
uinput_code=773
```

Use that number as the JSON key in `remote-buttons.json`.

## Checking HomeBack's remote service

```sh
luna-send -n 1 -f \
  luna://com.homebrew.homeback.service/remote/status \
  '{}'
```

A healthy HomeBack-owned setup normally reports:

```text
started: true
eventTailerHealthy: true
timedMappingsArmed: true
legacyInputHookDetected: false
nativeOwnershipVerified: true
```

`timedMappingsArmed` is intentionally fail-open: timed short/long mappings are only swallowed natively while the helper has a healthy retained event-log tailer and verified native ownership. If those conditions fail, HomeBack disarms the timed native `ignore` entries so affected buttons pass through rather than becoming dead system-wide.

If `blockedHooks` is non-empty, do not force another injection. Inspect the reported reason first; in some cases rebooting the TV is the safest recovery.

## Resetting mappings

Restore your backup:

```sh
cp /home/root/.config/homeback/remote-buttons.json.bak \
   /home/root/.config/homeback/remote-buttons.json
```

Or, if you intentionally want the bundled defaults again, remove the user file and relaunch HomeBack:

```sh
rm /home/root/.config/homeback/remote-buttons.json
```

Do not remove it unless you want to discard all of your custom mappings.

## Credits and upstream projects

HomeBack stands on work from the webOS homebrew community. In particular:

- **[AltHome by kitsuned](https://github.com/kitsuned/AltHome)** — the replacement-launcher project HomeBack was originally derived from. AltHome is licensed under GPL-2.0. HomeBack retains that GPL lineage.
- **[LG Input Hook by Simon34545](https://github.com/Simon34545/lginputhook)** — the original open-source LG remote-button remapper and native-hook lineage that inspired HomeBack's integrated remote interception. The public upstream project is BSD-3-Clause licensed and its last public package/repository version is 1.4.0.
- **smx-smx** — creator of `ezinject` / hookfactory, credited by the LG Input Hook project.
- **Informatic** — creator of the original input-hook script, credited by the LG Input Hook project.

### About the bundled native hook

HomeBack currently bundles `ezinject` and `libinputhookpp.so` from an **unofficial community build commonly referred to as LG Input Hook 1.5.0**. It was obtained from the webOS community/Discord after the public 1.4.0 project stopped working on newer TVs. The author of those binary modifications and the corresponding modified source are not currently known.

HomeBack does **not** claim that the unofficial modified binary itself is authored by HomeBack or automatically covered by HomeBack's GPL-2.0 license. The public LG Input Hook source it descends from is BSD-3-Clause. Exact bundled-binary hashes and provenance notes are kept in [`packages/service/vendor/inputhook/NOTICE.md`](./packages/service/vendor/inputhook/NOTICE.md).

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for the licensing breakdown.

## License

HomeBack's source code is distributed under **GNU GPL v2.0 only (`GPL-2.0-only`)**, consistent with the AltHome codebase from which it is derived. See [LICENSE](./LICENSE).

Third-party components and binaries keep their own rights and notices; see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Building from source

Developer/build history and notes are in [`docs/history/BUILD-OPTIMIZED.md`](./docs/history/BUILD-OPTIMIZED.md).

The normal release gate is:

```sh
corepack enable
corepack prepare yarn@4.12.0 --activate
corepack yarn install
corepack yarn check:full
corepack yarn build
```

A successful camera-enabled build produces both the main HomeBack IPK and the separate `com.homebrew.homeback.camera_<version>_all.ipk` companion.

---

HomeBack is an independent community project and is not affiliated with or endorsed by LG Electronics.
