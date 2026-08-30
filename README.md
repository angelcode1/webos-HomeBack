# HomeBack

HomeBack is a fast replacement Home launcher for **rooted LG TVs running webOS 6+**. It gives you a compact app ribbon, a scrollable app drawer, quick access to Inputs, a numeric keypad with remote colour keys, configurable short/long-press remote-button mappings, and optional Home Assistant camera notifications.

HomeBack is designed to feel like part of the TV rather than a separate launcher app:

- **HOME tap** — show or hide the HomeBack ribbon
- **HOME hold** — open the stock LG Home screen
- **App drawer** — browse installed apps with the remote D-pad or Magic Remote wheel
- **Inputs tile** — open the LG input picker
- **Keypad tile** — open HomeBack's compact pad; 0–9 and R/G/Y/B send the matching physical remote key presses
- **Recent Cameras tile** — appears only while HomeBack has a fresh camera event URL
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

When a fresh camera event is available, **Cameras** is inserted before **Add apps**. The Cameras entry is intentionally a short-lived recent-event view, not a permanent camera directory.

- **Inputs** opens the TV input picker.
- **Keypad** opens a compact pad above the HomeBack tray. Each digit is sent immediately to the TV as the corresponding physical remote number key, so on Live TV it can be used for normal channel-number entry. A four-button **R / G / Y / B** row sits below `0` and sends the corresponding LG colour-key IDs. The in-app pad avoids webOS shifting the tray when the system virtual keyboard opens. Press **Back** to dismiss the keypad without leaving HomeBack.
- **Cameras**, when present, opens the newest still-fresh camera event as the same bounded interactive preview used by direct HomeBack camera launches.
- **Add apps** opens the app drawer so you can add or reorder apps on the ribbon.

The ribbon auto-hides after about three seconds of inactivity during normal ribbon browsing. D-pad, wheel, and pointer activity reset the timer. Editing, the app drawer, and the numeric keypad pause auto-hide while you are actively using those modes; closing them resumes the normal three-second inactivity timer.

Use the D-pad or Magic Remote wheel in the app drawer. HomeBack keeps drawer wheel scrolling separate from the ribbon's horizontal scrolling.

## Home Assistant camera notifications

HomeBack has two deliberately different camera-notification paths:

- **Passive notification** — Home Assistant calls HomeBack's `/notification/createPreviewToast` service method. webOS shows its native compact top-right toast and keeps the app you are watching in control of the D-pad. On the tested webOS 10 TV, `type: "light"` selects this compact toast form; it does **not** force a light-coloured theme, and service-sourced toasts use the generic webOS information icon rather than HomeBack branding.
- **Interactive video/image preview** — Home Assistant explicitly launches `homeback:preview` with `interactive:true`. HomeBack shows its own **bright top-right** preview, intentionally owns remote input while it is visible, dismisses on **Back**, and enforces a hard maximum of 10 seconds.

This is an intentional platform tradeoff: the native toast preserves underlying-app input but webOS controls its pixels, while the HomeBack interactive preview controls its appearance but owns input while visible.

Passive notifications are suppressed for **5 seconds per camera ID** to collapse detector bursts. A suppressed event still refreshes the camera's newest media URL, so a burst of detections produces one toast while the Cameras tile points at the most recent event.

### Test a passive notification from the TV shell

Run this over SSH on the TV:

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
      "imageUrl":"http://HOME_ASSISTANT:8123/api/camera_proxy_stream/camera.front_door?token=CURRENT_TOKEN",
      "durationMs":8000
    }
  }'
```

`preview.imageUrl` is optional for a text-only toast. When it is present, HomeBack keeps the newest URL for that camera as a **recent event** for up to two minutes. After that it is removed from the Cameras list rather than being presented as a reliable live-camera URL.

Home Assistant camera-proxy tokens rotate and can become invalid sooner, for example after Home Assistant restarts. HomeBack therefore does **not** store camera credentials, refresh HA tokens, or promise that the recent-event URL remains valid for the whole two-minute convenience window. If a URL has already expired, the interactive preview reports **Camera unavailable**.

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
        "imageUrl":"http://HOME_ASSISTANT:8123/api/camera_proxy_stream/camera.front_door?token=CURRENT_TOKEN",
        "durationMs":8000
      }
    }
  }'
```

The interactive card is always rendered with HomeBack's bright palette at the **top-right** of the screen. The native passive toast separately uses webOS `type: "light"` only to select the compact toast form; webOS still owns its colours and system icon.

### Calling HomeBack from a Home Assistant automation

Home Assistant's `shell_command` integration can call the TV over SSH. Store the HA SSH key under `/config/.ssh`; do not rely on `/root/.ssh` inside the Home Assistant container.

A convenient way to avoid shell-quoting camera URLs and messages is to install this small decoder on the TV once:

```sh
cat >/home/root/homeback-camera-notify.sh <<'EOF'
#!/bin/sh
set -eu
[ "$#" -eq 1 ] || exit 64
payload="$(printf '%s' "$1" | base64 -d)"
exec luna-send -n 1 -f \
  -a com.homebrew.homeback.service \
  luna://com.homebrew.homeback.service/notification/createPreviewToast \
  "$payload"
EOF
chmod 700 /home/root/homeback-camera-notify.sh
```

Then add a shell command in Home Assistant. Replace the TV IP with your own:

```yaml
shell_command:
  homeback_camera_event: >-
    ssh -i /config/.ssh/id_ed25519
    -o UserKnownHostsFile=/config/.ssh/known_hosts
    root@192.168.1.50
    /home/root/homeback-camera-notify.sh
    {{ ({
      "cameraId": camera_id,
      "title": title,
      "message": message,
      "preview": {
        "title": title,
        "message": message,
        "imageUrl": image_url,
        "durationMs": duration_ms | default(8000)
      }
    } | to_json | base64_encode) }}
```

Home Assistant supports templated `shell_command` action data, `to_json`, and `base64_encode`. After adding or changing `shell_command`, reload that integration from **Settings → Tools → YAML**.

An automation can then pass the current HA camera-proxy stream URL. For camera integrations exposing the current `access_token`, a local-network example is:

```yaml
automation:
  - alias: "Front door to HomeBack"
    triggers:
      - trigger: state
        entity_id: binary_sensor.front_door_person
        to: "on"
    actions:
      - action: shell_command.homeback_camera_event
        data:
          camera_id: camera.front_door
          title: Front Door
          message: Person detected
          image_url: >-
            http://192.168.1.10:8123/api/camera_proxy_stream/camera.front_door?token={{ state_attr('camera.front_door', 'access_token') }}
          duration_ms: 8000
```

Use an HA URL that the TV can actually reach. If your camera integration does not expose `access_token`, supply whatever current signed/proxied media URL your HA/Frigate automation already produces. Do not place a long-lived camera username/password in the HomeBack payload.

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
