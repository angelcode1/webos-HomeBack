# HomeBack

HomeBack is a fast replacement Home launcher for **rooted LG TVs running webOS 6+**. It gives you a compact app ribbon, a scrollable app drawer, quick access to Inputs, a numeric keypad with remote colour keys, configurable short/long-press remote-button mappings, and optional Home Assistant camera notifications **(Preview)**.

HomeBack is designed to feel like part of the TV rather than a separate launcher app:

- **HOME tap** — show or hide the HomeBack ribbon
- **HOME hold** — open the stock LG Home screen
- **App drawer** — browse installed apps with the remote D-pad or Magic Remote wheel
- **Inputs tile** — open the LG input picker
- **Keypad tile** — open HomeBack's compact pad; 0–9 and R/G/Y/B send the matching physical remote key presses
- **Recent Cameras tile (Preview)** — appears only while HomeBack has a fresh camera event URL
- **Custom remote mappings** — launch apps, replace keys, ignore keys, run short/long actions, or execute commands

HomeBack includes its own remote-input service, so you **should not run the standalone LG Input Hook app at the same time**.

> **Requirements:** a rooted LG webOS TV with the webOS Homebrew Channel installed. HomeBack uses Homebrew's root capabilities and boot hooks. It is intended for webOS 6+.

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

When a fresh camera event is available, **Cameras** is inserted before **Add apps**. The Cameras entry is intentionally a short-lived recent-event view, not a permanent camera directory. Recent Cameras is volatile in-memory state: a HomeBack service/system restart clears it rather than persisting camera-event URLs across reboot.

- **Inputs** opens the TV input picker.
- **Keypad** opens a compact pad above the HomeBack tray. Each digit is sent immediately to the TV as the corresponding physical remote number key, so on Live TV it can be used for normal channel-number entry. A four-button **R / G / Y / B** row sits below `0` and sends the corresponding LG colour-key IDs. The in-app pad avoids webOS shifting the tray when the system virtual keyboard opens. Press **Back** to dismiss the keypad without leaving HomeBack.
- **Cameras**, when present, opens the newest still-fresh camera event as the same bounded interactive preview used by direct HomeBack camera launches.
- **Add apps** opens the app drawer so you can add or reorder apps on the ribbon.

The ribbon auto-hides after about three seconds of inactivity during normal ribbon browsing. D-pad, wheel, and pointer activity reset the timer. Editing, the app drawer, and the numeric keypad pause auto-hide while you are actively using those modes; closing them resumes the normal three-second inactivity timer.

Use the D-pad or Magic Remote wheel in the app drawer. HomeBack keeps drawer wheel scrolling separate from the ribbon's horizontal scrolling.

## Home Assistant camera notifications — Preview

> **Preview validation scope:** the TV-side notification, Recent Cameras, interactive Preview and opt-in authenticated HTTP transport were hardware-validated on one **LG OLED42C5PSA.AAUQLJD** running **webOS SDK 10.0.0** and **firmware 33.00.71**. Real Home Assistant `rest_command` ingress, HA-hosted static JPEG media, synthetic-camera proxy snapshot/stream behavior, source restriction, token lifetime and restart behavior were exercised end to end. Those results are single-device/integration evidence, not universal webOS or Home Assistant claims.

HomeBack targets webOS 6+, but this validation cycle did not exercise older firmware. When the reported SDK version is below 7.3, HomeBack uses the compositor `suspense` path rather than `webOSSystem.hide()` when hiding its surface; that older-version path remains untested on hardware.

Native-toast behavior is also firmware-specific. On the tested TV/firmware, `type: "light"` selected the compact top-right toast, `standard` produced a bottom banner, and service-created toasts used generic webOS identity rather than HomeBack branding. Other webOS models or firmware may render native notifications differently.

HomeBack has two deliberately different TV-side camera-notification paths:

- **Passive notification** — an external integration calls HomeBack's `/notification/createPreviewToast` operation. webOS shows its native compact top-right toast and keeps the app you are watching in control of the D-pad on the tested webOS 10 TV.
- **Interactive video/image preview** — HomeBack launches its bounded `homeback:preview` surface when the user opens the recent camera event. The Preview owns remote input while visible, dismisses on **Back**, and enforces a hard maximum of 10 seconds.

This is an intentional platform tradeoff: the native toast preserves underlying-app input but webOS controls its pixels, while the HomeBack interactive preview controls its appearance but owns input while visible.

Passive notifications are suppressed for **5 seconds per camera ID** to collapse detector bursts. A suppressed event still refreshes the camera's newest media URL, so a burst of detections produces one toast while the Cameras entry points at the most recent event.

The selected transport is an **opt-in authenticated HTTP listener**. It is disabled by default. SSH/`luna-send` remains a developer, recovery and reference path; MQTT remains a possible future transport if broker-native or dynamic-addressing requirements justify it. See [issue #22](https://github.com/angelcode1/webos-HomeBack/issues/22) and [HTTP-PREVIEW-VALIDATION.md](./HTTP-PREVIEW-VALIDATION.md) for the measured evidence and boundaries.

### Enable the authenticated HTTP transport

The HTTP listener is plain HTTP with bearer authentication. Treat it as a **trusted-LAN Preview feature only**: do not port-forward it to the Internet, and do not use it across an untrusted network where the bearer token could be observed in transit.

The enable order matters because HomeBack does not create a bearer token until the listener has successfully bound its port:

1. **Confirm the default disabled state after configuration has loaded.** `/remote/status` should report `httpConfigLoaded: true`, `httpEnabled: false` and `httpListening: false`. A fresh config is `/home/root/.config/homeback/http.json` with `enabled: false`; no API token is created while HTTP has never been enabled. Disabling a listener that was enabled previously does not itself delete the existing token. On the measured C5, a fresh **manual candidate-IPK install** required one HomeBack app launch before root-helper initialisation and default HTTP-config creation had completed; that exact bootstrap sequence is scoped to the measured manual-install path.
2. **Edit the HTTP config.** Set `enabled` to `true`, keep or change port `9876`, and preferably pin `allowedSources` to the Home Assistant host's IPv4 address.
3. **Restart the HomeBack service.** The listener is service-owned; restarting only the HomeBack UI app is not the enable action.
4. **Check `/remote/status`.** A successful config load/bind should report `httpConfigLoaded: true`, `httpEnabled: true`, `httpListening: true`, the configured `httpPort`, and `httpFailureReason: null`.
5. **Only after that successful bind, read the token** from `/home/root/.config/homeback/api-token`. If the file does not exist, check `httpConfigLoaded`, `httpFailureReason` and the configured port/source settings first.
6. **Store the full Authorization value in Home Assistant `secrets.yaml`**, then configure `rest_command` as shown below.

Recommended config when Home Assistant is `192.168.1.10`:

```json
{
  "http": {
    "enabled": true,
    "port": 9876,
    "allowedSources": ["192.168.1.10"]
  }
}
```

`allowedSources: []` does **not** mean deny-all. When the list is empty, HomeBack accepts authenticated clients from RFC1918 IPv4 private ranges (`10/8`, `172.16/12`, `192.168/16`). That is convenient for initial setup but is a broader trust boundary. Pin the HA host/IP when practical. IPv4 CIDR entries such as `192.168.1.0/24` are also supported when a bounded subnet is intentional.

Restart and inspect the service from the TV shell:

```sh
luna-send -n 1 -f \
  luna://com.homebrew.homeback.service/restartService \
  '{}'

# Reconnect after the service restarts, then:
luna-send -n 1 -f \
  luna://com.homebrew.homeback.service/remote/status \
  '{}'
```

Expected HTTP fields after a successful enable are equivalent to:

```text
httpConfigLoaded: true
httpEnabled: true
httpListening: true
httpPort: 9876
httpFailureReason: null
```

`httpConfigLoaded: false` means the current service instance has not yet completed a valid HTTP-config load (or that config loading failed). Hardware validation reproduced that transient state during `restartService`, followed by the expected loaded/listening state.

Then retrieve the generated token over the trusted root shell:

```sh
cat /home/root/.config/homeback/api-token
```

The token file is root-only (`0600`). Token rotation is currently an explicit local-admin operation rather than an HTTP endpoint. To rotate without leaving the old listener open, set `enabled: false` and restart the service, remove `/home/root/.config/homeback/api-token`, set `enabled: true`, restart again, verify `httpListening: true`, then read the newly generated token and update HA. Do not expose token retrieval or arbitrary Luna calls through the HTTP listener.

### Home Assistant `rest_command` — Preview

Put the **full** Authorization header value in `secrets.yaml`:

```yaml
homeback_token: "Bearer REPLACE_WITH_THE_64_HEX_TOKEN"
```

Then add the commands to `configuration.yaml`, replacing the TV IP with your own:

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
    payload: >-
      {"cameraId": {{ camera_id | tojson }},
       "title": {{ title | tojson }},
       "message": {{ message | tojson }},
       "preview": {
         "title": {{ title | tojson }},
         "message": {{ message | tojson }},
         "imageUrl": {{ image_url | tojson }},
         "durationMs": {{ (duration_ms | default(8000) | int) | tojson }}
       }}
```

Every interpolated JSON value is serialized with Jinja `| tojson`; do not hand-quote camera names, messages or signed URLs. Quotes, backslashes, Unicode and other camera metadata must remain valid JSON.

### Recommended HA recipe — snapshot to `/local/`

For an 8–10 second notification Preview, the recommended default is a fresh JPEG snapshot rather than a live camera-proxy stream. On the tested path, an ordinary HA-hosted `/local/*.jpg` rendered on the **first** Preview activation, while both synthetic-camera `camera_proxy` and `camera_proxy_stream` were blank/white on first activation and rendered on the second. The exact HA proxy/FFmpeg warm-up mechanism was not timed directly; this is integration guidance, not a HomeBack source defect.

#### One-time `/local/` setup

Home Assistant serves `/config/www` at `/local/`, but if `www` does not exist when Home Assistant starts, creating it afterwards does not register the route until a restart. Create the directory first:

```sh
mkdir -p /config/www/homeback
```

If `/config/www` was created for the first time while HA was already running, **restart Home Assistant once** before relying on `/local/`. See Home Assistant's [HTTP static-file documentation](https://www.home-assistant.io/integrations/http/#hosting-files).

Current Home Assistant allows `camera.snapshot` to write under the configuration `www` directory without adding another `allowlist_external_dirs` entry. Use one stable file per camera and overwrite it on each event:

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
          duration_ms: 8000
```

After a snapshot exists, verify HA's static route with a real **GET** before diagnosing HomeBack:

```sh
curl -sS -o /dev/null \
  -w 'http=%{http_code} bytes=%{size_download} type=%{content_type}\n' \
  http://192.168.1.10:8123/local/homeback/front_door.jpg
```

Require HTTP 200, non-zero bytes and an image content type. Using GET avoids treating a setup-specific HEAD response as a false route failure.

#### Snapshot security and semantics

**`/config/www` is served without Home Assistant authentication.** Anything that can reach the HA HTTP endpoint and knows or guesses the URL can fetch the snapshot until the file is overwritten or removed. If your HA endpoint is reachable beyond the LAN, the exposure boundary is broader than the LAN too.

Use a stable file **per camera** — for example `front_door.jpg` and `driveway.jpg` — rather than accumulating timestamped unauthenticated event files. The `?v=<event>` query string is a cache buster; it does not make the underlying JPEG immutable.

HomeBack stores the event URL, but that URL points at a mutable per-camera file. Opening Recent Cameras later therefore shows the **latest contents of that camera's snapshot file**, not a guaranteed archival copy of the frame that originally produced the toast. With multiple cameras, each camera entry independently points at its own mutable file. This aligns with HomeBack's newest-wins behavior but is not event-image archival.

### Optional live-motion recipe

If live motion matters more than first-open predictability, pass a current HA `camera_proxy_stream` or integration-specific signed/proxied URL instead:

```yaml
      - action: rest_command.homeback_preview
        data:
          camera_id: camera.front_door
          title: Front Door
          message: Person detected
          image_url: >-
            http://192.168.1.10:8123/api/camera_proxy_stream/camera.front_door?token={{ state_attr('camera.front_door', 'access_token') }}
          duration_ms: 8000
```

On the tested synthetic FFmpeg camera, constraining the source to camera-like output removed the earlier extreme-source slow/stalling behavior: the toast was prompt, moving video was smooth and no stalls were observed after warm-up. The first proxy Preview activation was still blank/white and the second rendered. A single-JPEG `camera_proxy` showed the same first-open blank/second-open render, while a local packaged image and ordinary HA `/local/` JPEG both rendered first time. Other integrations such as Frigate/Reolink were not tested and must not be assumed to behave the same way.

An HA automation can prime a known-cold camera/proxy before sending the HomeBack event if desired. HomeBack itself intentionally does not store HA camera credentials, refresh tokens, or queue stale notifications.

### Camera-token lifetime

A fixed token from the tested synthetic HA camera remained HTTP 200 at approximately 2 s, 62 s, 183 s and 302 s after capture, and returned 403 by 600 s. The exact expiry instant was not measured. HomeBack's Recent Cameras entry expires after 120 s, so in that run the HomeBack registry expired first by at least about 180 s. Restarting HA Core invalidated the pre-restart camera token immediately.

That evidence is recorded in [issue #21](https://github.com/angelcode1/webos-HomeBack/issues/21). The recommended `/local/` snapshot recipe removes camera-token expiry from the normal recipe entirely; token lifetime still matters for optional proxy/signed-media integrations.

### Measured standby/wake behavior on the tested C5

Use the repository probe rather than hand-timing the listener:

```sh
HOMEBACK_TOKEN="$(ssh root@TV-IP cat /home/root/.config/homeback/api-token)" \
  node scripts/measure-http-preview-standby.cjs http://TV-IP:9876
```

The corrected probe makes an authenticated `/status` request every 500 ms, applies a true 2000 ms whole-request deadline by default, records a separate connected-socket inactivity result and `connected=true|false`, and caps concurrent probes. It does not print the bearer token.

The tested C5 exhibited **at least two standby lifecycle behaviors**:

- in two corrected cycles it became network-unavailable at `>119.297/<=119.787 s` and `>119.172/<=119.655 s`, then underwent a real kernel reboot; after manual wake, authenticated HTTP completed at `54.877 s` and `53.711 s` respectively;
- in a later session, real Home Assistant requests were still accepted at about +30 s, +135 s and, in an isolated run with no earlier event traffic, +180 s after the physical standby mark. The +180 s run remained on the same kernel boot.

The earlier unavailable/reboot cycles had **continuous authenticated 500 ms polling from the Mac and still went dark**, so ordinary active inbound TCP/HTTP traffic is not sufficient to hold that standby mode awake. The +180 s isolated run also rules out the earlier +30 s notification as the sole reason the later session remained reachable.

The controlling platform state is not established. Record LG power settings such as **Quick Start+** in future evidence, but treat them as hypotheses until a controlled setting change reproduces the lifecycle difference.

The TV wall clock was stable within a boot but discontinuous across reboots. Do not derive cross-host boot timing from TV `date - /proc/uptime` across a reboot.

HomeBack camera notifications target a TV that is already on. If the TV/service is unavailable, requests are intended to fail/drop rather than queue for replay at power-on. HTTP 200 means HomeBack accepted the event while reachable; it does not prove a person saw it and does not make it durable.

The later real-HA deep-off/drop test is recorded as **NOT REPRODUCED**, because the listener never became unavailable in that session. Earlier cycles still prove that an unavailable/reboot mode exists. See [HTTP-PREVIEW-VALIDATION.md](./HTTP-PREVIEW-VALIDATION.md) for the complete evidence and separation of hardware-proven, CI-proven and characterised behavior.

### Test the TV-side Luna path directly

The existing Luna method remains useful for local diagnosis without opening the HTTP listener:

```sh
luna-send -n 1 -f \
  -a com.homebrew.homeback.service \
  luna://com.homebrew.homeback.service/notification/createPreviewToast \
  '{
    "cameraId":"camera.front_door",
    "title":"Front Door",
    "message":"Person detected",
    "preview":{
      "title":"Front Door",
      "message":"Person detected",
      "imageUrl":"file:///media/developer/apps/usr/palm/applications/com.homebrew.homeback/icon130.png",
      "durationMs":8000
    }
  }'
```

`preview.imageUrl` is optional for a text-only toast. When it is present, HomeBack keeps the newest URL for that camera as a **recent event** for up to two minutes. After that it is removed from the Cameras list rather than being presented as a reliable live-camera URL. The registry is intentionally volatile and is cleared by a HomeBack service/system restart.

### Test an explicit interactive preview

```sh
luna-send -n 1 -f \
  -a com.homebrew.homeback.service \
  luna://com.webos.service.applicationManager/launch \
  '{
    "id":"com.homebrew.homeback",
    "params":{
      "intent":"homeback:preview",
      "preview":{
        "interactive":true,
        "title":"Front Door",
        "message":"Person detected",
        "imageUrl":"file:///media/developer/apps/usr/palm/applications/com.homebrew.homeback/icon130.png",
        "durationMs":8000
      }
    }
  }'
```

The interactive card is always rendered with HomeBack's bright palette at the **top-right** of the screen. On the tested TV/firmware, the native passive toast separately uses webOS `type: "light"` to select the compact toast form; webOS still owns its colours and system icon.

### SSH remains a reference/recovery path

SSH is no longer the selected runtime automation transport. It remains useful for setup, token retrieval/rotation, direct `luna-send` diagnosis and recovery. The HTTP path deliberately exposes only authenticated `GET /status` and `POST /notification/createPreviewToast`; it is not a generic Luna proxy or app-launch API.

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

Then edit it over SSH with your preferred editor, for example:

```sh
vi /home/root/.config/homeback/remote-buttons.json
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

The default long-press threshold is 650 ms. Remote key codes can vary by TV, remote and firmware, so treat the bundled defaults as a starting point rather than a universal list.

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

### Replace a button with another LG key

```json
"362": {
  "action": "replace",
  "keycode": 795
}
```

### Ignore a button

```json
"1042": {
  "action": "ignore"
}
```

### Pass a button through unchanged

```json
"1042": {
  "action": "pass"
}
```

### Run a shell command

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

Then press the physical button you want to map. Magic Remote events commonly appear in the `lginput2` log. Look for a line containing a key code, for example:

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

`timedMappingsArmed` is intentionally fail-open: timed short/long mappings are only swallowed natively while the helper has a healthy retained event-log tailer and verified native ownership. If those conditions fail, HomeBack disarms the timed native `ignore` entries so the affected buttons pass through rather than becoming dead system-wide.

`injected` shows the native processes HomeBack currently owns. A target may show `source: "injected"` when this service instance injected it, or `source: "adopted"` when HomeBack safely detected and resumed an already-loaded HomeBack hook after its helper restarted.

If `blockedHooks` is non-empty, do not force another injection. Inspect the reported reason first; in some cases rebooting the TV is the safest recovery.

## Resetting your mappings

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

For that reason, HomeBack does **not** claim that the unofficial modified binary itself is authored by HomeBack or automatically covered by HomeBack's GPL-2.0 license. The public LG Input Hook source it descends from is BSD-3-Clause. Exact bundled-binary hashes and provenance notes are kept in [`packages/service/vendor/inputhook/NOTICE.md`](./packages/service/vendor/inputhook/NOTICE.md).

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for the licensing breakdown.

## License

HomeBack's source code is distributed under **GNU GPL v2.0 only (`GPL-2.0-only`)**, consistent with the AltHome codebase from which it is derived. See [LICENSE](./LICENSE).

Third-party components and binaries keep their own rights and notices; see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Building from source

Developer/build instructions are in [BUILD-OPTIMIZED.md](./BUILD-OPTIMIZED.md).

The normal release gate is:

```sh
corepack enable
corepack prepare yarn@4.12.0 --activate
corepack yarn install
corepack yarn check:full
corepack yarn build
```

The first dependency resolution creates `yarn.lock` if it is not already present; keep that lockfile for reproducible subsequent builds.

---

HomeBack is an independent community project and is not affiliated with or endorsed by LG Electronics.

## Weather capability reset

Stock-weather capability is machine state, not user configuration. HomeBack stores it at `/var/lib/homeback/weather-capability.json`, keyed by TV model, firmware version, webOS SDK version and HomeBack version. LG Weather Location is read dynamically and is not stored in that record.

To force stock-weather capability discovery again, delete the state file and restart the helper:

```sh
rm -f /var/lib/homeback/weather-capability.json
luna-send -n 1 -f \
  luna://com.homebrew.homeback.service/restartService \
  '{}'
```

See [`docs/WEATHER-STATUS-TILE.md`](./docs/WEATHER-STATUS-TILE.md) for probe, invalidation and fallback behavior.
