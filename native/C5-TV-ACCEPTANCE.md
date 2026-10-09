# LG C5 qualification checklist — structured native remote input

This page is for the **unreleased 0.7.2 CI candidate**. The installed
0.7.1 prerelease has already been shown working for Home after reboot.
Do not confuse source/CI checks with a physical remote acceptance test.

## Before you install

- Download the candidate from its specific CI workflow run's
  `homeback-c5-native-test-0.7.2` artifact, not the older 0.7.1 release.
- Keep `com.homebrew.homeback_0.7.1_all.ipk` from
  https://github.com/angelcode1/webos-HomeBack/releases/tag/v0.7.1-c5-native-test.1
  and the existing `/home/root/.config/homeback/remote-buttons.json` backup.
- Do not change `lgc5` optimizer settings or unrelated system binaries.
- **Check the UID of the hooked TV services**. This experimental IPC
  implementation places the socket and lease in a root-only `0700` directory:
  ```sh
  for pid in $(pidof lginput2 micomservice); do
    echo "== $pid =="
    grep -E '^(Name|Uid|Gid):' "/proc/$pid/status"
  done
  ```
  If any target has a nonroot UID, **do not assume structured key interception
  can work**. Share the results before using the candidate; this is a
  deliberate fail-open security decision, not permission to make the socket
  world-writable.

## After installing the candidate

Reboot before testing: a previously mapped 0.7.1 native library remains
in memory until its owner process exits. Then test:

| Key | Short press | Long press |
| --- | --- | --- |
| Home (773) | HomeBack ribbon only | Stock LG Home only |
| Netflix (1037) | configured action | configured action |
| Prime (1038) | configured action | configured action |
| Disney+ (1042) | configured action | configured action |
| LG Channels (1043) | configured action | configured action |
| Alexa (1086) | configured action | configured action |
| Stan (1111) | configured action | configured action |

Observe that a single key action never launches both the native stock UI
and a HomeBack action. Confirm the app still works after another reboot.
Inspect `/proc/<pid>/maps` for the loaded libinputhookpp path.

## Read-only receiver checks

```sh
ls -ld /tmp/homeback-remote-ipc
ls -l /tmp/homeback-remote-ipc/events.sock /tmp/homeback-remote-ipc/lease
cat /home/root/.config/lginputhook/keybinds.json
for pid in $(pidof lginput2 micomservice); do
  echo "== $pid =="
  grep -m 1 libinputhookpp.so "/proc/$pid/maps"
done
```

The native config uses `{"773":{"action":"timed_ignore"}}` when the service
owns timed interception; a plain `ignore` action applies only to explicit
native-only mappings. In the diagnostics status returned by HomeBack, the
structured event count should rise for each physical press and release.

A missing listener, stale lease, failed nonblocking send, or unavailable service
must permit the original remote action (fail open). Treat failed custom mapping
in this situation as expected; **trapping an essential key is unacceptable**.

## Crash-path qualification

Only test service shutdown/kill with SSH recovery access and the existing
working IPK available. The watchdog must **not** rely on reinjecting a second
library into an already hooked LG process. If the service is unavailable,
Home should pass through to the native stock action. After HomeBack restarts,
the hook must re-arm cleanly with no duplicate or stuck timed actions.

## Rollback

Reinstall the saved 0.7.1 HomeBack IPK without clearing configuration, reboot,
and confirm Home short/long are restored. Preserve logs locally before sharing;
remote mapping files may contain arbitrary commands and application IDs.
