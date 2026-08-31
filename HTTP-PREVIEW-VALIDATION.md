# HTTP Preview transport validation

This document is the hardware-validation procedure and current measured baseline for HomeBack's opt-in authenticated HTTP transport for Preview camera notifications.

It does **not** turn single-device evidence into a general webOS claim. The existing camera surface/notification behavior and the HTTP listener lifecycle below were validated on one LG OLED42C5PSA.AAUQLJD running webOS SDK 10.0.0 / firmware 33.00.71. The real Home Assistant notification/media path still has open gates.

Issue [#22](https://github.com/angelcode1/webos-HomeBack/issues/22) tracks this transport. Issue [#21](https://github.com/angelcode1/webos-HomeBack/issues/21) separately tracks real Home Assistant signed/proxied media URL lifetime.

## Preconditions

Before measuring:

1. Install the candidate build on the TV.
2. Enable HTTP in `/home/root/.config/homeback/http.json` as documented in the README.
3. Prefer an exact Home Assistant IPv4 address in `allowedSources`. If the measurement machine is different, either run the probe from the HA host or temporarily use `allowedSources: []`, which permits authenticated RFC1918 IPv4 clients, and record that broader validation boundary.
4. Confirm `/remote/status` reports `httpConfigLoaded: true`, `httpEnabled: true`, `httpListening: true`, the expected port and `httpFailureReason: null`.
5. Confirm authenticated `GET /status` returns HTTP 200 from the intended client network.
6. Record the exact TV model, SDK version, firmware version, candidate commit SHA and Home Assistant version before interpreting results.

On the measured C5, a fresh **manual candidate-IPK install** required one HomeBack app launch before root-helper initialisation and default HTTP-config creation had completed. Do not generalise that exact bootstrap sequence beyond the measured manual-install path.

Do not put the bearer token in issue comments, CI logs, screenshots or validation transcripts.

## Service lifecycle gates

### 1. Listener after service start

From an allowed LAN client, call authenticated `GET /status` immediately after the HomeBack service starts.

PASS requires:

- `/remote/status` first distinguishes configuration that has not loaded yet with `httpConfigLoaded: false`;
- after a valid config loads, `httpConfigLoaded: true` is reported even when HTTP is intentionally disabled;
- when enabled, the TCP/HTTP listener becomes reachable;
- authenticated `/status` returns HTTP 200;
- `/remote/status` reports `httpEnabled: true` and `httpListening: true`;
- remote input remains healthy independently of HTTP state.

This explicit config-loaded field exists because C5 hardware testing reproduced a transient restart window in which the old fields alone looked exactly like a successfully loaded disabled configuration.

### 2. Service restart restores the listener

Request:

```sh
luna-send -n 1 -f \
  luna://com.homebrew.homeback.service/restartService \
  '{}'
```

Probe `/status` continuously across the restart. PASS requires the old listener to disappear and a new authenticated HTTP 200 to return after service activation without changing the token or config.

On the measured C5, an ordinary service restart also exercised HomeBack's existing-hook adoption path (`source: "adopted"`). That path starts the event log at EOF to avoid replaying stale pre-restart input events. Treat this as evidence that the adoption branch was taken, not as a claim that stale input was independently induced and measured.

### 3. App-only restart does not own the listener

Request:

```sh
luna-send -n 1 -f \
  luna://com.homebrew.homeback.service/restartApp \
  '{}'
```

PASS requires the HTTP listener to remain service-owned and available while the UI app is closed/relaunched. Record any observed interruption rather than assuming there is none.

### 4. Optional HTTP failure remains fail-open

Occupy the configured port or otherwise reproduce a bounded listener-start failure if practical.

PASS requires:

- HomeBack's critical remote-input service remains running;
- a valid config remains identifiable with `httpConfigLoaded: true`;
- `/remote/status` reports `httpListening: false` with a bounded `httpFailureReason`;
- no unhandled server error terminates the service;
- a first-enable bind failure does not create a new token file.

The CI suite already exercises `EADDRINUSE`; this hardware gate checks that the packaged service behaves the same way on the TV runtime.

## Standby/wake measurement

Use `scripts/measure-http-preview-standby.cjs`; do not hand-time this gate.

Run from the Home Assistant host when possible so source routing and filtering match the real automation path. If that host cannot run Node, use another allowed LAN host and record that the source differs from HA.

```sh
HOMEBACK_TOKEN="$(ssh root@TV-IP cat /home/root/.config/homeback/api-token)" \
  node scripts/measure-http-preview-standby.cjs http://TV-IP:9876
```

The corrected script:

- verifies an authenticated HTTP 200 baseline before measuring;
- launches a `/status` probe every 500 ms;
- applies a true end-to-end wall-clock deadline of 2000 ms per probe by default;
- separately applies a 1500 ms connected-socket inactivity timeout at the default settings;
- records whether a TCP connection event was observed (`connected=true|false`);
- bounds concurrent probes to four at the default 500/2000 ms settings and reports a boundary skip instead of launching an unbounded fifth request;
- never prints the bearer token;
- asks for a standby marker and a wake marker;
- reports each probe plus a machine-timed summary.

`HOMEBACK_PROBE_TIMEOUT_MS` overrides the absolute per-probe budget from 500 to 30000 ms. The socket-idle timer is kept below that deadline when there is enough room; at the minimum 500 ms budget it is disabled rather than racing the absolute deadline.

The original Commit-3 probe used only `request.setTimeout()`. C5 testing showed black-holed TCP attempts lasting about 7.8 seconds despite the advertised 2000 ms setting. That Node API is useful for connected-socket inactivity but did not impose the required whole-request deadline on the measured connect path. The independent deadline is therefore a hardware-derived correction, not a theoretical cleanup.

Example corrected summary shape:

```text
summary
standby_failure_mode=EPROBEDEADLINE
standby_probe_latency_ms=2002.2
standby_failure_connected=false
standby_detection_ms=121657
wake_to_http_ready_ms=53711
```

Interpretation:

- `EPROBEDEADLINE` means the whole probe exceeded the configured wall-clock budget.
- `ESOCKETTIMEDOUT` means a socket that existed became inactive before the absolute deadline.
- `connected=true|false` is independent evidence and must be interpreted separately from the errno. C5 cycle 3, for example, briefly produced `EHOSTDOWN` with `connected=true`; do not turn an errno name into an assumed TCP-state label.
- `ECONNREFUSED` means the request received a refusal; use the recorded latency and `connected` field rather than inferring more than the result proves.
- `HTTP_401` means the listener answered but authentication failed; fix the token before interpreting standby behavior.
- `HTTP_403` means the listener answered but source filtering rejected the measurement host; fix `allowedSources` before interpreting standby behavior.
- another `HTTP_*` value is an application-level response and must be investigated rather than collapsed into a generic network failure.

`standby_detection_ms` is the completion time of the first failed probe relative to the standby marker; when that probe ends by deadline it includes the probe's own deadline. For the tighter network-transition bound, compare the last successful completion with the reconstructed start time of the first failed probe. `wake_to_http_ready_ms` is measured on the same Mac process and therefore does not depend on TV wall-clock calibration.

### Measured C5 standby/reboot baseline

Two corrected-instrument runs reproduced the same lifecycle on the tested C5/firmware:

| Measurement | Corrected cycle 2 | Corrected cycle 3 |
| --- | ---: | ---: |
| Standby -> network-unavailable transition | `>119.297 s`, `<=119.787 s` | `>119.172 s`, `<=119.655 s` |
| First failed probe | `EPROBEDEADLINE`, `connected=false` | `EPROBEDEADLINE`, `connected=false` |
| Wake -> HTTP-ready observation window | `>54.328 s`, `<=54.830 s` | `>53.180 s`, `<=53.682 s` |
| Wake -> first completed authenticated HTTP 200 | `54.877 s` | `53.711 s` |

The two standby-transition windows overlap and sit just below 120 seconds. That is **highly repeatable on this tested C5/firmware and consistent with a fixed approximately-120-second platform timer**, but two corrected runs are not evidence for a webOS-wide constant.

The deep transition is a real kernel/system reboot, not merely a HomeBack service restart. `/proc/uptime` reset, and after wake HomeBack injected fresh input targets rather than adopting the pre-standby processes.

Boot-relative TV evidence was also reproducible:

- cycle 2: HomeBack autostart worker at uptime `61.50 s`, HTTP already listening at `61.51 s`, remote input verified at `66.55 s`;
- cycle 3: HomeBack autostart worker at uptime `60.05 s`, HTTP already listening at `60.06 s`, remote input verified at `67.42 s`.

These uptime values are TV-kernel durations only. Do not combine them with a Mac wake marker by subtracting `/proc/uptime` from the TV's wall-clock `date`.

### Clock-domain rule

Mac/TV midpoint calibration showed a sharper rule than simply calling the TV clock unreliable: **the TV wall clock was stable within a boot session and discontinuous across boots**.

For example, cycle 2 post-reboot and cycle 3 pre-reboot best offsets were about `-1592.5 ms` and `-1591.5 ms`, only 1 ms apart across many minutes. Cycle 3's reboot then changed the best offset to about `-2573.5 ms`, a roughly 982 ms step. An earlier cross-boot reconstruction even implied a kernel boot about 8.3 seconds *before* the recorded wake press, an impossible result that exposed the clock step.

Per-boot calibration can therefore be useful. Cross-boot wall-clock correlation is not valid unless the relevant clock step is directly measured through the transition.

## Home Assistant HTTP gates

After the listener lifecycle is understood, validate from the real HA environment rather than only from a laptop.

### 1. HA -> `/status`

Configure the README `rest_command.homeback_status` example and invoke it from Home Assistant.

PASS requires an authenticated HTTP 200 response from the HA host with the intended `allowedSources` rule in place.

### 2. HA -> passive notification

Invoke `rest_command.homeback_preview` with a text-only request first.

PASS requires:

- HA reports the request as delivered;
- HomeBack returns a successful response;
- the TV shows one native passive toast;
- the underlying app retains D-pad/input ownership as previously validated for the TV-side Luna path.

Do not generalize toast placement/branding beyond the tested C5 firmware.

### 3. Burst/newest-wins over real HTTP ingress

Send five same-camera events close enough to fall inside the five-second suppression window, with distinguishable event text/media URLs.

PASS requires:

- one native toast attempt/visible toast for the burst;
- later burst members are suppressed;
- Recent Cameras contains one camera entry;
- that entry reflects the newest event/media reference.

The orchestration-layer CI test already proves the synchronous reservation invariant with five truly concurrent calls. This hardware gate proves the packaged HTTP ingress reaches the same behavior on the TV.

## TV -> Home Assistant media gates

Notification delivery and preview media use opposite network directions. HTTP success from HA -> TV does not prove the TV can fetch HA media.

### 1. Static JPEG

Serve or expose a stable JPEG URL from the HA-side network that the TV can reach. Send that URL through `homeback_preview` and open Recent Cameras.

PASS requires the interactive preview to load the image on the TV.

### 2. `camera_proxy_stream`

Repeat using a real current Home Assistant `camera_proxy_stream` or integration-provided signed/proxied URL.

Record:

- exact URL form with secrets/token values redacted;
- whether the TV can reach it directly;
- time between URL generation and preview open;
- whether HA restart or token rotation invalidates the URL.

### 3. Delayed-token behavior — issue #21

Deliberately delay opening the recent camera event and test near/after the observed HA URL lifetime.

Do not change HomeBack's two-minute recent-event window based on assumption. Issue #21 remains open until the real signed/proxied URL lifecycle is measured.

## TV-off and Recent Cameras semantics

HomeBack intentionally has no notification backlog. Camera notifications are designed for a TV that is **already on**.

On the tested C5, manually waking a sleeping TV is not a viable workaround for a real-time doorbell event: authenticated HTTP did not return until about 53-55 seconds after the wake marker in the two corrected runs. Queuing such a detection would turn it into a stale alert roughly a minute later, so HomeBack continues to fail/drop unavailable-TV events rather than replay them.

`PreviewNotificationState.recentCameras` is intentionally volatile in-memory state. A kernel/service restart clears it. Do not persist signed Home Assistant media URLs merely to survive reboot while issue #21 has not established that those URLs remain useful or safe after the restart.

The approximately-120-second standby grace period has a separate edge case: while the listener is still reachable, HA can receive HTTP 200 and `cameraRegistered: true` for an event accepted by HomeBack even though the subsequent reboot will erase that in-memory Recent Cameras entry. **HTTP 200 means the event was accepted while HomeBack was reachable; it does not prove a person saw the toast, and it does not make the event durable.**

Validate both off-TV cases with real HA ingress:

1. **Grace-window acceptance:** send a distinguishable event around 30 seconds after standby, confirm HTTP 200 / `cameraRegistered: true`, then allow deep standby to reboot the TV. After wake, verify that event is absent from Recent Cameras and is not replayed.
2. **Deep-off drop:** send a distinguishable event after the listener is unavailable. The HA request must fail, and the event must not appear or replay after wake.

If Home Assistant automation logic is later changed to retry requests, that retry policy must preserve the same no-stale-alert requirement.

## Evidence to record in issue #22

For the final hardware audit, record:

- exact candidate commit SHA;
- TV model, SDK and firmware;
- Home Assistant version and deployment type;
- HTTP config with token redacted;
- `/remote/status` including `httpConfigLoaded` and the other HTTP fields;
- listener after service start: PASS/FAIL;
- service restart restores listener: PASS/FAIL;
- app-only restart behavior and any interruption;
- corrected standby failure mode, latency and `connected` state;
- standby transition bounds for each corrected run;
- wake-to-HTTP-ready time for each corrected run;
- per-boot clock calibration when cross-host timestamps are being compared;
- HA -> `/status`: PASS/FAIL;
- HA -> passive notification: PASS/FAIL;
- burst/newest-wins over HTTP: PASS/FAIL;
- TV -> HA static JPEG: PASS/FAIL;
- TV -> HA `camera_proxy_stream`: PASS/FAIL;
- grace-window accepted-event/no-replay result;
- deep-off drop/no-replay result;
- delayed/expired-token result with issue #21 reference;
- any deviations from the single-C5 baseline.

Keep hardware-proven facts separate from CI-proven facts and from behavior that remains untested.
