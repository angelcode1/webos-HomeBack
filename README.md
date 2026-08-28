# HomeBack

HomeBack is a fast replacement Home launcher for **rooted LG TVs running webOS 6+**. It gives you a compact app ribbon, a scrollable app drawer, quick access to Inputs, a numeric keypad with remote colour keys, and configurable short/long-press remote-button mappings.

HomeBack is designed to feel like part of the TV rather than a separate launcher app:

- **HOME tap** — show or hide the HomeBack ribbon
- **HOME hold** — open the stock LG Home screen
- **App drawer** — browse installed apps with the remote D-pad or Magic Remote wheel
- **Inputs tile** — open the LG input picker
- **Keypad tile** — open HomeBack's compact pad; 0–9 and R/G/Y/B send the matching physical remote key presses
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

The built-in utility tiles are placed alongside your apps:

**Inputs → Keypad → Add apps**

- **Inputs** opens the TV input picker.
- **Keypad** opens a compact pad above the HomeBack tray. Each digit is sent immediately to the TV as the corresponding physical remote number key, so on Live TV it can be used for normal channel-number entry. A four-button **R / G / Y / B** row sits below `0` and sends the corresponding LG colour-key IDs. The in-app pad avoids webOS shifting the tray when the system virtual keyboard opens. Press **Back** to dismiss the keypad without leaving HomeBack.
- **Add apps** opens the app drawer so you can add or reorder apps on the ribbon.

The ribbon auto-hides after about three seconds of inactivity during normal ribbon browsing. D-pad, wheel, and pointer activity reset the timer. Editing, the app drawer, and the numeric keypad pause auto-hide while you are actively using those modes; closing them resumes the normal three-second inactivity timer.

Use the D-pad or Magic Remote wheel in the app drawer. HomeBack keeps drawer wheel scrolling separate from the ribbon's horizontal scrolling.

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
legacyInputHookDetected: false
nativeOwnershipVerified: true
```

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

For that reason, HomeBack does **not** claim that the unofficial modified binary itself is authored by HomeBack or automatically covered by HomeBack's GPL-2.0 license. The public LG Input Hook source it descends from is BSD-3-Clause, but the exact licensing/provenance of the later binary modifications should be independently confirmed before redistribution in a public package repository. Exact bundled-binary hashes and provenance notes are kept in [`packages/service/vendor/inputhook/NOTICE.md`](./packages/service/vendor/inputhook/NOTICE.md).

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
