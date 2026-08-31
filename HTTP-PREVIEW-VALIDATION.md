# HTTP Preview transport validation

This document is the hardware-validation procedure for HomeBack's opt-in authenticated HTTP transport for Preview camera notifications.

It does **not** turn CI coverage into a hardware claim. The existing camera surface/notification behavior was validated on one LG OLED42C5PSA.AAUQLJD running webOS SDK 10.0.0 / firmware 33.00.71. The HTTP listener implementation is CI-tested, but the C5 listener lifecycle, standby/wake behavior and real Home Assistant path remain open until the measurements below are recorded.

Issue [#22](https://github.com/angelcode1/webos-HomeBack/issues/22) tracks this transport. Issue [#21](https://github.com/angelcode1/webos-HomeBack/issues/21) separately tracks real Home Assistant signed/proxied media URL lifetime.

## Preconditions

Before measuring:

1. Install the candidate build on the TV.
2. Enable HTTP in `/home/root/.config/homeback/http.json` as documented in the README.
3. Prefer an exact Home Assistant IPv4 address in `allowedSources`. If the measurement machine is different, either run the probe from the HA host or temporarily add the measurement host explicitly.
4. Confirm the service reports `httpEnabled: true`, `httpListening: true`, the expected port and `httpFailureReason: null`.
5. Confirm authenticated `GET /status` returns HTTP 200 from the intended client network.
6. Record the exact TV model, SDK version, firmware version, candidate commit SHA and Home Assistant version before interpreting results.

Do not put the bearer token in issue comments, CI logs, screenshots or validation transcripts.

## Service lifecycle gates

### 1. Listener after service start

From an allowed LAN client, call authenticated `GET /status` immediately after the HomeBack service starts.

PASS requires:

- the TCP/HTTP listener becomes reachable;
- authenticated `/status` returns HTTP 200;
- `/remote/status` reports `httpEnabled: true` and `httpListening: true`;
- remote input remains healthy independently of HTTP state.

Record listener-ready latency if service activation time can be timestamped reliably.

### 2. Service restart restores the listener

Request:

```sh
luna-send -n 1 -f \
  luna://com.homebrew.homeback.service/restartService \
  '{}'
```

Probe `/status` continuously across the restart. PASS requires the old listener to disappear and a new authenticated HTTP 200 to return after service activation without changing the token or config.

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

The script:

- verifies an authenticated HTTP 200 baseline before measuring;
- launches a `/status` probe every 500 ms;
- uses a 2000 ms per-probe timeout by default;
- never prints the bearer token;
- asks for a standby marker and a wake marker;
- reports each probe plus a machine-timed summary.

`HOMEBACK_PROBE_TIMEOUT_MS` can override the per-probe timeout for a second measurement if the network silently drops packets for longer than 2 seconds. Keep the 500 ms probe cadence unchanged when comparing runs.

Example summary shape:

```text
summary
standby_failure_mode=ECONNREFUSED
standby_probe_latency_ms=3.2
standby_detection_ms=508
wake_to_http_ready_ms=2410
```

Interpretation:

- `ECONNREFUSED` means the request failed quickly at the socket/connect layer rather than consuming the full probe timeout.
- `ETIMEDOUT` means no usable response arrived before the configured probe timeout.
- `HTTP_401` means the listener answered but authentication failed; fix the token before interpreting standby behavior.
- `HTTP_403` means the listener answered but source filtering rejected the measurement host; fix `allowedSources` before interpreting standby behavior.
- another `HTTP_*` value is an application-level response and must be investigated rather than collapsed into a generic network failure.

Record at least three standby/wake runs. Report the individual values and range; do not replace them with adjectives such as "fast" or "immediate".

The 500 ms sampling cadence means `standby_detection_ms` and `wake_to_http_ready_ms` include up to roughly one probe interval of sampling uncertainty plus request latency. `standby_probe_latency_ms` is the direct failed-request duration and is the useful discriminator between refusal and a silent timeout.

These numbers are the evidence for any Home Assistant `rest_command timeout:` recommendation. Until they exist, do not claim a C5-optimized timeout. Home Assistant currently supports an integer request timeout and defaults it to 10 seconds; the repository example intentionally leaves it unset during validation.

## Home Assistant HTTP gates

After the listener lifecycle is understood, validate from the real HA environment rather than only from a laptop.

### 1. HA -> `/status`

Configure the README `rest_command.homeback_status` example and invoke it from Home Assistant.

PASS requires an authenticated HTTP 200 response from the HA host with the production `allowedSources` rule in place.

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

## TV-off semantics

HomeBack intentionally has no notification backlog. When the TV/service is unavailable, the HA request should fail and the detection should be dropped.

Validate that a detection sent while the TV is unavailable is **not** replayed after wake. If Home Assistant automation logic is later changed to retry requests, that retry policy must preserve the same no-stale-alert requirement.

## Evidence to record in issue #22

For the final hardware audit, record:

- exact candidate commit SHA;
- TV model, SDK and firmware;
- Home Assistant version and deployment type;
- HTTP config with token redacted;
- `/remote/status` HTTP fields;
- listener after service start: PASS/FAIL;
- service restart restores listener: PASS/FAIL;
- app-only restart behavior and any interruption;
- standby failure mode;
- standby failed-request latency for each run;
- standby detection time for each run;
- wake-to-HTTP-ready time for each run;
- HA -> `/status`: PASS/FAIL;
- HA -> passive notification: PASS/FAIL;
- burst/newest-wins over HTTP: PASS/FAIL;
- TV -> HA static JPEG: PASS/FAIL;
- TV -> HA `camera_proxy_stream`: PASS/FAIL;
- delayed/expired-token result with issue #21 reference;
- any deviations from the single-C5 baseline.

Keep hardware-proven facts separate from CI-proven facts and from behavior that remains untested.
