# HomeBack remote key mapping

HomeBack can remap buttons on an LG webOS remote without requiring the separate
LG Input Hook application. HomeBack integrates an unofficial community-built
native input-hook payload and manages it from its own root helper service. See
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for upstream credit and the
known provenance/licensing boundary of the bundled native binaries.

## Where the configuration lives

After HomeBack has been launched once, the editable configuration is:

```text
/home/root/.config/homeback/remote-buttons.json
```

Edit **that file only**. HomeBack generates this compatibility file for the
native hook and will overwrite it when your HomeBack configuration changes:

```text
/home/root/.config/lginputhook/keybinds.json
```

HomeBack watches `remote-buttons.json` and normally reloads changes within
about one second. A reboot is not required for ordinary mapping changes.

> Existing installations keep their configured short/long actions. Starting with
> HomeBack 0.4.17, the three known stale shipped labels are corrected when they still
> exactly match the old labels; custom labels and actions are left unchanged.

> **Safety validation:** timed mappings and direct `ignore` mappings are rejected
> when their physical **source** key is one of the standard system-critical codes:
> OK/Enter `28`, D-pad `103`/`105`/`106`/`108`, mute `113`, volume `114`/`115`,
> power `116`, or Back `412`. The whole edited config is rejected rather than
> silently dropping one mapping, so correct the offending source key before retrying.
> HomeBack clears service-dependent native timed `ignore` entries before startup
> validation, so an invalid config fails open instead of leaving those keys swallowed.
> Remote models can report different physical codes; use the event logs below to
> verify the actual code on the TV before assigning a timed shortcut.

## Default configuration

Fresh installs of HomeBack 0.4.17 start with:

```json
{
  "version": 1,
  "defaultLongPressMs": 650,
  "keys": {
    "362": {
      "action": "replace",
      "keycode": 795
    },
    "428": {
      "action": "replace",
      "keycode": 119
    },
    "773": {
      "label": "HOME (LG Magic Remote; edit keycode if your model differs)",
      "short": {
        "action": "launch",
        "id": "com.homebrew.homeback",
        "params": {
          "intent": "homeback:show"
        }
      },
      "long": {
        "action": "launch",
        "id": "com.webos.app.home"
      }
    },
    "994": {
      "action": "replace",
      "keycode": 174
    },
    "1037": {
      "label": "Netflix button",
      "short": {
        "action": "launch",
        "id": "youtube.leanback.v4"
      },
      "long": {
        "action": "launch",
        "id": "com.webos.app.usbc1"
      }
    },
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
    },
    "1042": {
      "label": "Disney+ button",
      "short": {
        "action": "launch",
        "id": "com.webos.app.hdmi2"
      },
      "long": {
        "action": "replace",
        "keycode": 398
      }
    },
    "1043": {
      "label": "LG Channels button",
      "short": {
        "action": "launch",
        "id": "com.webos.app.hdmi3"
      },
      "long": {
        "action": "replace",
        "keycode": 399
      }
    },
    "1086": {
      "label": "Alexa button",
      "short": {
        "action": "launch",
        "id": "com.webos.app.hdmi4"
      },
      "long": {
        "action": "replace",
        "keycode": 400
      }
    },
    "1111": {
      "label": "Model-specific button (observed keycode 1111)",
      "short": {
        "action": "launch",
        "id": "cdp-30"
      },
      "long": {
        "action": "replace",
        "keycode": 401
      }
    },
    "1124": {
      "action": "replace",
      "keycode": 113
    }
  }
}
```

The default six shortcut mappings remain unchanged; only the stale physical-button
labels were corrected:

| Physical button | Short press | Long press |
| --- | --- | --- |
| Netflix | YouTube | USB-C 1 |
| Prime Video | HDMI 1 | USB-C 2 |
| Disney+ | HDMI 2 | Red |
| LG Channels (1043) | HDMI 3 | Green |
| Alexa (1086) | HDMI 4 | Yellow |
| Model-specific (1111) | Plex (CDP-30) | Blue |

The numeric JSON keys are the physical key codes reported by the TV. They can
vary between remote models and firmware versions, so treat this file as an
example as well as the default. Keycode `1111` is retained as a model-specific
key observed on the tested remote rather than labelled as a standard Alexa key.

## HOME short press and long press

A mapping can have different actions for a short and long press. The default
HOME mapping uses key code `773`:

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

With the default configuration:

- HOME tap while HomeBack is hidden shows the HomeBack tray.
- HOME tap while HomeBack is visible hides the tray.
- HOME held for 650 ms launches the stock LG Home screen.

You can override the long-press threshold per key with `longPressMs`, or change
the global default with `defaultLongPressMs`.

## Supported actions

### Launch an app

```json
"1037": {
  "action": "launch",
  "id": "youtube.leanback.v4"
}
```

The `id` is the webOS application ID. Optional launch parameters can be supplied
with `params`.

### Replace one key with another

```json
"362": {
  "action": "replace",
  "keycode": 795
}
```

This makes the physical key behave as the replacement webOS key code.

`remote-buttons.json` always expresses `keycode` values in the Linux/uinput key
space. The execution path differs by nesting:

- A top-level `replace` is written directly to LG Input Hook and stays in the
  native uinput key space.
- A `replace` nested under `short` or `long` is executed by HomeBack's service.
  HomeBack translates that same uinput value through `micom-keycodes.ts` before
  calling `micomservice/sendKeycode`, which expects an LG MICOM/IR command byte.

Unsupported nested replacement codes are rejected when the configuration is
loaded rather than being passed through to MICOM. Do not put raw MICOM bytes in
`remote-buttons.json`; for example, the Red/Green/Yellow/Blue replacements remain
Linux `398`/`399`/`400`/`401` in this file and are translated internally to
MICOM `0x72`/`0x71`/`0x63`/`0x61`.

### Ignore a key

```json
"1042": {
  "action": "ignore"
}
```

The original key event is consumed. Direct `ignore` is not permitted for the
reserved system-critical source keycodes listed above.

### Pass a key through unchanged

```json
"1042": {
  "action": "pass"
}
```

HomeBack does not intercept that key.

### Execute a shell command

```json
"1044": {
  "action": "exec",
  "command": "your-command-here"
}
```

`exec` runs as the HomeBack root helper. Only add commands you understand and
trust.

## Editing the file over SSH

For example:

```sh
cp /home/root/.config/homeback/remote-buttons.json \
   /home/root/.config/homeback/remote-buttons.json.bak

vi /home/root/.config/homeback/remote-buttons.json
```

Save valid JSON. HomeBack keeps the previous working configuration if a new
file fails validation during a live reload. On helper startup, invalid
configuration prevents timed shortcuts from arming, while the generated native
file is first cleared of service-dependent timed `ignore` entries so ordinary
TV keys fail open.

Check the active HomeBack remote subsystem with:

```sh
luna-send -n 1 -f \
  luna://com.homebrew.homeback.service/remote/status \
  '{}'
```

A healthy HomeBack-owned state reports `started:true`,
`legacyInputHookDetected:false`, `nativeOwnershipVerified:true`,
`eventTailerHealthy:true`, and `timedMappingsArmed:true`. Active entries in
`injected` include a `source` field: `injected` means this helper performed and
verified the native injection; `adopted` means a recreated helper found the
existing HomeBack library in `/proc/<pid>/maps` and safely resumed ownership
without injecting it again. If `timedMappingsArmed:false`, HomeBack deliberately
leaves short/long shortcut source keys native/pass-through because it cannot
prove that it can service them; check `eventTailerHealthy`,
`nativeOwnershipVerified`, `blockedHooks`, and `injected` before treating a
missing HOME shortcut as a mapping regression. If `blockedHooks` is non-empty,
do not force another injection; inspect the reported reason/path and restart the
native target (normally by rebooting) if required.

## Finding key codes

When HomeBack owns the input hook, native event logs are written under:

```text
/tmp/homeback-inputhook-<process>-<pid>.log
```

To watch recent events:

```sh
tail -F /tmp/homeback-inputhook-*.log
```

Press the button you want to identify and look for the reported key code. A
single physical press can be visible in more than one hooked process; HomeBack
handles duplicate timed events internally.

If a D-pad direction, OK, Back, or another system key stops behaving on a
particular remote model, compare its observed physical keycode with the source
keys in `remote-buttons.json` and `keybinds.json`. A model-specific code can
collide with a shortcut such as `773`, `1042`, or another default even when the
standard Linux D-pad codes themselves are reserved.

## Recovery

If you make a mistake, restore your backup:

```sh
cp /home/root/.config/homeback/remote-buttons.json.bak \
   /home/root/.config/homeback/remote-buttons.json
```

Or remove the file and restart/relaunch HomeBack to have a fresh configuration
created from the bundled default:

```sh
rm /home/root/.config/homeback/remote-buttons.json
```

Do not delete the file unless you intentionally want to reset all custom
mappings.
