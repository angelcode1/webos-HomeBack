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

> **Preview validation scope:** the TV-side notification, Recent Cameras and interactive-preview architecture was hardware-validated on one **LG OLED42C5PSA.AAUQLJD** running **webOS SDK 10.0.0** and **firmware 33.00.71**. The opt-in authenticated HTTP listener was also validated on that TV for enable/restart/token handling and repeated standby/reboot recovery. A real Home Assistant `rest_command` notification/media path remains **open** until the HA-side gates below are run.

HomeBack targets webOS 6+, but this validation cycle did not exercise older firmware. When the reported SDK version is below 7.3, HomeBack uses the compositor `suspense` path rather than `webOSSystem.hide()` when hiding its surface; that older-version path remains untested on hardware.

Native-toast behavior is also firmware-specific. On the tested TV/firmware, `type: "light"` selected the compact top-right toast, `standard` produced a bottom banner, and service-created toasts used generic webOS identity rather than HomeBack branding. Other webOS models or firmware may render native notifications differently.

HomeBack has two deliberately different TV-side camera-notification paths:

- **Passive notification** — an external integration calls HomeBack's `/notification/createPreviewToast` operation. webOS shows its native compact top-right toast and keeps the app you are watching in control of the D-pad on the tested webOS 10 TV.
- **Interactive video/image preview** — an external integration explicitly launches `homeback:preview` with `interactive:true`. HomeBack shows its own **bright top-right** preview, intentionally owns remote input while it is visible, dismisses on **Back**, and enforces a hard maximum of 10 seconds.

This is an intentional platform tradeoff: the native toast preserves underlying-app input but webOS controls its pixels, while the HomeBack interactive preview controls its appearance but owns input while visible.

Passive notifications are suppressed for **5 seconds per camera ID** to collapse detector bursts. A suppressed event still refreshes the camera's newest media URL, so a burst of detections produces one toast while the Cameras tile points at the most recent event.

The selected Preview transport is an **opt-in authenticated HTTP listener**. It is disabled by default. SSH/`luna-send` remains a developer, recovery and reference path; MQTT remains a possible future transport if broker-native or dynamic-addressing requirements justify it. The HTTP design and remaining hardware gates are tracked in [issue #22](https://github.com/angelcode1/webos-HomeBack/issues/22).

### Enable the authenticated HTTP transport

The HTTP listener is plain HTTP with bearer authentication. Treat it as a **trusted-LAN Preview feature only**: do not port-forward it to the Internet, and do not use it across an untrusted network where the bearer token could be observed in transit.

The enable order matters because HomeBack does not create a bearer token until the listener has successfully bound its port:

1. **Confirm the default disabled state after configuration has loaded.** `/remote/status` should report `httpConfigLoaded: true`, `httpEnabled: false` and `httpListening: false`. A fresh config is `/home/root/.config/homeback/http.json` with `enabled: false`; no API token is created while HTTP has never been enabled. Disabling a listener that was enabled previously does not itself delete the existing token. On the measured C5, a fresh **manual candidate-IPK install** required one HomeBack app launch before root-helper initialisation and default HTTP-config creation had completed; that exact bootstrap sequence is scoped to the measured manual-install path.
2. **Edit the HTTP config.** Set `enabled` to `true`, keep or change port `9876`, and preferably pin `allowedSources` to the Home Assistant host's IPv4 address.
3. **Restart the HomeBack service.** The listener is service-owned; restarting only the HomeBack UI app is not the enable action.
4. **Check `/remote/status`.** A successful config load/bind should report `httpConfigLoaded: true`, `httpEnabled: true`, `httpListening: true`, the configured `httpPort`, and `httpFailureReason: null`.
5. **Only after that successful bind, read the token** from `/home/root/.config/homeback/api-token`. If the file does not exist, do not invent one: check `httpConfigLoaded`, `httpFailureReason` and the configured port/source settings first.
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

`httpConfigLoaded: false` means the current service instance has not yet completed a valid HTTP-config load (or that config loading failed). It prevents the startup window from being mistaken for a deliberately disabled listener.

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

C5 standby testing does **not** justify a universal Home Assistant `rest_command timeout:` recommendation. The measured listener remains reachable for about 119-120 seconds after standby begins, then the TV reboots; after a manual wake, authenticated HTTP returned about 53-55 seconds later in the two corrected runs. Changing an HA request timeout does not turn that wake path into a useful real-time camera notification path.

An automation can call the HTTP command with the current media URL:

```yaml
automation:
  - alias: "Front door to HomeBack"
    triggers:
      - trigger: state
        entity_id: binary_sensor.front_door_person
        to: "on"
    actions:
      - action: rest_command.homeback_preview
        data:
          camera_id: camera.front_door
          title: Front Door
          message: Person detected
          image_url: >-
            http://192.168.1.10:8123/api/camera_proxy_stream/camera.front_door?token={{ state_attr('camera.front_door', 'access_token') }}
          duration_ms: 8000
```

HomeBack camera notifications are for a TV that is **already on**. If the TV is deeply off or HomeBack is unavailable, the request is intended to fail and be dropped, not queue for replay at power-on. Waking the tested C5 and then waiting roughly 53-55 seconds for authenticated HTTP is not a viable doorbell-notification workaround; replaying the event that late would be stale.

There is one standby edge case to understand. On the tested C5 the listener remains reachable for a highly repeatable roughly-120-second grace period before the deep reboot. A request accepted during that window can return HTTP 200 with `cameraRegistered: true`, but the Recent Cameras registry is in-memory only and the subsequent reboot clears it. **HTTP 200 means HomeBack accepted the event while reachable; it does not prove that a person saw the toast and it does not make the event durable.**

Use an HA URL that the TV can actually reach. Notification delivery is HA → TV, while preview media is fetched in the opposite direction, TV → HA. Both network directions therefore need to work. If your camera integration does not expose `access_token`, supply whatever current signed/proxied media URL your HA/Frigate automation already produces. Do not place a long-lived camera username/password in the HomeBack payload.

Real Home Assistant camera-proxy/signed URL lifetime has not yet been validated end to end. Such URLs can expire or be invalidated independently of HomeBack's two-minute convenience window. HomeBack therefore does **not** store camera credentials, refresh HA tokens, persist Recent Cameras across reboot, or promise that a recent-event URL remains usable for the full window. If a URL has already expired, the interactive preview reports **Camera unavailable**. See [issue #21](https://github.com/angelcode1/webos-HomeBack/issues/21) for the deferred HA token-lifetime validation.

### Measured standby/wake behavior on the tested C5

Use the repository probe rather than hand-timing the listener:

```sh
HOMEBACK_TOKEN="$(ssh root@TV-IP cat /home/root/.config/homeback/api-token)" \
  node scripts/measure-http-preview-standby.cjs http://TV-IP:9876
```

The corrected probe makes an authenticated `/status` request every 500 ms, applies a true 2000 ms whole-request deadline by default, records a separate connected-socket inactivity result and `connected=true|false`, and caps concurrent probes. It does not print the bearer token.

Two corrected runs on the named C5/firmware reproduced:

- standby → network unavailable: `>119.297 s` / `<=119.787 s`, then `>119.172 s` / `<=119.655 s`;
- wake → HTTP-ready observation window: `>54.328 s` / `<=54.830 s`, then `>53.180 s` / `<=53.682 s`;
- first completed authenticated HTTP 200 after wake: `54.877 s` and `53.711 s`.

The standby windows overlap and are consistent with a fixed approximately-120-second timer on this tested C5/firmware; do not generalise that into a webOS-wide constant. `/proc/uptime` proved the deep transition includes a kernel/system reboot. The TV wall clock was stable within each boot but stepped across reboots, so per-boot clock calibration is useful while cross-boot wall-clock correlation is not.

The full evidence, probe interpretation, boot-relative timings, service-restart/app-restart gates, grace-window no-replay test and TV → HA media checks are in [HTTP-PREVIEW-VALIDATION.md](./HTTP-PREVIEW-VALIDATION.md).

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

`preview.imageUrl` is optional for a text-only toast. When it is present, HomeBack keeps the newest URL for that camera as a **recent event** for up to two minutes. After that it is removed from the Cameras list rather than being presented as a reliable live-camera URL. The registry is intentionally volatile and is cleared by a HomeBack service/system restart rather than persisting potentially expired signed media URLs across reboot.

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
