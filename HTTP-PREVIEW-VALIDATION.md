# HTTP Preview transport validation

This document records the validation procedure and measured baseline for HomeBack's opt-in authenticated HTTP transport for Preview camera notifications.

The hardware evidence is intentionally scoped. Runtime behavior was validated on one **LG OLED42C5PSA.AAUQLJD** running **webOS SDK 10.0.0 / firmware 33.00.71**. Real Home Assistant ingress and media tests were run against Home Assistant OS on the same LAN. Do not generalise single-device or synthetic-camera findings to other LG models, firmware, Home Assistant deployments, or camera integrations without testing.

Issue [#22](https://github.com/angelcode1/webos-HomeBack/issues/22) tracks the HTTP transport. Issue [#21](https://github.com/angelcode1/webos-HomeBack/issues/21) tracks Home Assistant camera-token lifetime separately.

The runtime candidate measured on hardware is commit `f3e4c6e1517e156ee2d62755b180960eebee216b`. The later documentation-only validation commit does not change `packages/`, the standby script, package/version metadata, catalogs, workflows, tags, or release artifacts.

## Final validation state

Hardware-proven on the tested C5 unless qualified otherwise:

- listener bootstrap, enable, authentication, token creation/rotation/persistence: **PASS**;
- `httpConfigLoaded` transient and settled restart states: **PASS**;
- service restart restores HTTP and remote input: **PASS**;
- app-only restart leaves the service-owned listener available: **PASS** — `restartApp` returned `done:true`; 60/60 HTTP probes at roughly 250 ms cadence returned 200, so no interruption was observed at that sampling resolution;
- final source restriction: **PASS** — HA-only `allowedSources`; Home Assistant received HTTP 200 while a Mac using the correct bearer token received HTTP 403;
- real HA `rest_command` -> authenticated `/status`: **PASS**;
- real HA passive camera notification: **PASS**;
- five-event same-camera burst over real HTTP ingress: **BEHAVIORAL PASS** — exactly one toast was observed and Recent Cameras retained event 5/newest media; the exact one-unsuppressed/four-suppressed response split remains CI/unit-test proven rather than independently captured from the HA burst trace;
- TV -> HA ordinary static JPEG: **PASS**;
- TV -> HA `camera_proxy_stream`: **PASS** for a synthetic FFmpeg camera after constraining it to camera-like output; moving video rendered smoothly with no observed stalls after the proxy path was warm;
- HA `camera_proxy` single-JPEG snapshot: **PASS after warm-up** on the same synthetic FFmpeg camera;
- first-open media differential: **CHARACTERISED** — packaged `file://` PNG and ordinary HA `/local/*.jpg` rendered on first Preview activation, while both synthetic-camera `camera_proxy` and `camera_proxy_stream` were blank/white on first activation and rendered on the second. This exonerates the HomeBack cold Preview surface and generic WAM remote-HTTP image loading in that test. The exact HA proxy/FFmpeg warm-up mechanism was not timed directly;
- fixed HA camera token lifetime relative to Recent Cameras: **CHARACTERISED** — the same token returned HTTP 200 at about 2 s, 62 s, 183 s and 302 s, and HTTP 403 by 600 s. Exact expiry was not measured. HomeBack's 120 s Recent Cameras lifetime therefore expired first by at least about 180 s in this run;
- HA Core restart invalidated the pre-restart camera token immediately in the measured test: **PASS/CHARACTERISED**;
- Recent Cameras process volatility: **PASS** — a registered entry with an exact 120000 ms TTL disappeared immediately after `restartService`, well inside its TTL;
- standby lifecycle: **CHARACTERISED AS STATE-DEPENDENT** — an unavailable/reboot mode is hardware-proven, but it was not unconditional in a later session;
- deep-off real-HA request drop in the later session: **NOT REPRODUCED** because the unavailable state was not reached. Do not label that later attempt PASS or FAIL.

CI additionally proves request parsing/security edge cases, exact same-camera concurrency response semantics, first-enable bind-failure/token behavior, and the corrected standby probe's bounded deadline/in-flight logic. Keep CI-proven facts separate from hardware-proven facts.

## Preconditions and security boundary

Before measuring:

1. Install the candidate build on the TV.
2. Enable HTTP in `/home/root/.config/homeback/http.json` as documented in the README.
3. Prefer an exact Home Assistant IPv4 address in `allowedSources`. Broaden the list only for a deliberate measurement and narrow it again afterwards.
4. Confirm `/remote/status` settles to `httpConfigLoaded: true`, `httpEnabled: true`, `httpListening: true`, the expected port and `httpFailureReason: null`.
5. Confirm authenticated `GET /status` returns HTTP 200 from the intended allowed host.
6. Record TV model, SDK, firmware, candidate commit, Home Assistant deployment/version when known, and relevant LG power settings. Record **Quick Start+** state when known; it is a lifecycle hypothesis/variable, not a demonstrated cause of the differing standby modes.

The HomeBack listener is plain HTTP with bearer authentication. It is a trusted-LAN Preview feature, not an Internet-facing API. Do not expose the port to an untrusted network, and never put the bearer token or Home Assistant long-lived tokens in issue comments, CI logs, screenshots, or validation transcripts.

On the measured C5, a fresh **manual candidate-IPK install** required one HomeBack app launch before root-helper initialisation and default HTTP-config creation completed. That bootstrap sequence is scoped to the measured manual-install path.

## Service lifecycle gates

### Listener start and `httpConfigLoaded`

Immediately after a service restart, `/remote/status` was observed in a real transient state with:

```text
started: false
httpConfigLoaded: false
httpEnabled: false
httpListening: false
httpFailureReason: null
```

A subsequent status read settled to:

```text
started: true
httpConfigLoaded: true
httpEnabled: true
httpListening: true
httpPort: 9876
httpFailureReason: null
nativeOwnershipVerified: true
eventTailerHealthy: true
```

This is the hardware behavior Commit 4 was designed to expose: an in-flight/not-yet-loaded configuration no longer masquerades as a successfully loaded disabled listener.

### Service restart

Request:

```sh
luna-send -n 1 -f \
  luna://com.homebrew.homeback.service/restartService \
  '{}'
```

The packaged candidate restored the listener and remote-input service with the same config/token. The measured ordinary restart exercised the safe existing-hook adoption path (`source: "adopted"`). Adoption is evidence that branch was taken; it is not independent proof that stale input was induced.

A separate direct volatility test registered `camera.volatility_probe`, confirmed `expiresAt - receivedAt = 120000`, called `restartService`, and immediately observed an empty camera registry. This proves Recent Cameras is process-local volatile state well inside the normal TTL.

### App-only restart

Request:

```sh
luna-send -n 1 -f \
  luna://com.homebrew.homeback.service/restartApp \
  '{}'
```

The valid run placed the restart inside a 60-probe window. `restartApp` returned `returnValue:true, done:true`; every probe before, across and after the restart returned HTTP 200. Probe cadence was approximately 250 ms. Record the result precisely as **no listener interruption observed at that sampling resolution**, not as a mathematical zero-millisecond interruption guarantee.

### Optional HTTP failure remains fail-open

CI directly covers `EADDRINUSE`: a valid config remains identifiable as loaded, the listener reports a bounded failure without killing critical remote input, and a first-enable bind failure does not create a token. This specific bind-failure branch is CI-proven rather than separately reproduced on final hardware.

## Source filtering / final configuration

The final measured configuration was narrowed to the Home Assistant host only. With that rule active:

- an authenticated Mac request using the known-good HomeBack bearer returned **HTTP 403**;
- a real Home Assistant `rest_command.homeback_status` request returned **HTTP 200** with `{"ok":true,"version":"0.5.0"}`.

Using the correct bearer for the blocked Mac test matters: the 403 is evidence of source filtering, not merely failed authentication.

`allowedSources: []` means authenticated RFC1918 IPv4 clients are permitted; it is **not** deny-all. Pin the HA host when practical.

## Standby/wake measurement

Use `scripts/measure-http-preview-standby.cjs` rather than hand-timing network failure. The corrected script:

- establishes an authenticated HTTP 200 baseline;
- probes every 500 ms;
- imposes a true whole-request wall-clock deadline (2000 ms by default);
- keeps connected-socket inactivity as a separate diagnostic;
- records `connected=true|false` independently of errno;
- caps live probes instead of allowing unbounded overlap;
- never prints the token.

The original probe used only Node `request.setTimeout()`. On the C5 black-holed-connect path it allowed requests to run for about 7.8 s despite the configured 2 s timeout. Commit 4 corrected that with an independent absolute deadline; corrected failures ended around 2.00 s as `EPROBEDEADLINE,connected=false`.

### Observed lifecycle mode A — unavailable/reboot around 120 s

Two corrected runs reproduced this mode:

| Measurement | Corrected cycle 2 | Corrected cycle 3 |
| --- | ---: | ---: |
| Standby -> network-unavailable transition | `>119.297 s`, `<=119.787 s` | `>119.172 s`, `<=119.655 s` |
| First failed probe | `EPROBEDEADLINE`, `connected=false` | `EPROBEDEADLINE`, `connected=false` |
| Wake -> HTTP-ready observation window | `>54.328 s`, `<=54.830 s` | `>53.180 s`, `<=53.682 s` |
| Wake -> completed authenticated HTTP 200 | `54.877 s` | `53.711 s` |

The Mac was continuously issuing authenticated `/status` probes at 500 ms cadence during these experiments and the TV still entered the unavailable/reboot mode. **Ordinary active inbound TCP/HTTP polling therefore did not hold this mode awake.** This rules out the most obvious explanation for the later reachable mode.

In these earlier cycles `/proc/uptime` reset and HomeBack came back with fresh injected targets, proving a real kernel/system reboot rather than only a HomeBack process restart.

Boot-relative observations after those wake cycles were also similar:

- cycle 2: HomeBack worker about `61.50 s` uptime, HTTP listening by `61.51 s`, remote input verified by `66.55 s`;
- cycle 3: worker about `60.05 s`, HTTP listening by `60.06 s`, remote input verified by `67.42 s`.

These measurements establish an approximately-120-second unavailable/reboot behavior **for those cycles only**. They are not a universal C5 timer and not a webOS-wide constant.

### Observed lifecycle mode B — listener remains reachable for minutes

A later session on the same C5 did not reproduce the unavailable state:

- a precisely scheduled real HA event at about **+30 s** after the physical standby mark returned HA API 200 and HomeBack HTTP 200 with `done:true`, `suppressed:false`, `cameraRegistered:true`;
- a request at about **+135 s** also returned HomeBack HTTP 200;
- an isolated run with no earlier notification activity sent its first event at about **+180 s** and again returned HomeBack HTTP 200 with `cameraRegistered:true`;
- after the isolated +180 s run, `/proc/uptime` and the boot ID showed the TV had remained on the same kernel boot throughout that standby interval;
- a corrected high-rate authenticated `/status` experiment also stayed HTTP 200 for roughly 337 s, but that particular log did not contain a machine-recorded standby marker, so it is only supporting continuous-availability evidence rather than an exact post-standby duration.

The +180 s isolated result disproves the idea that the earlier +30 s notification was the sole reason the listener stayed alive. Combined with mode A's continuous 500 ms polling, ordinary inbound HomeBack traffic is not sufficient to explain the mode difference.

**Conclusion:** the tested C5 exhibits at least two standby lifecycle behaviors, or behavior controlled by platform state that was not identified. Quick Start+ is one variable worth recording in future tests, but no causal claim is made without a controlled setting change that reproduces the difference.

### Clock-domain rule

The TV wall clock was stable within a boot session and discontinuous across boots. Cycle 2 post-reboot and cycle 3 pre-reboot offsets were about `-1592.5 ms` and `-1591.5 ms`; cycle 3's reboot changed the offset to about `-2573.5 ms`. An earlier cross-boot reconstruction even implied a boot before the recorded wake press, demonstrating why `TV date - uptime` cannot be used as a cross-host boot epoch.

Use Mac monotonic/wall-clock timing for Mac markers and probe intervals, and TV kernel uptime for TV boot-relative durations. Do not combine them across a reboot unless the relevant clock step is directly measured.

## Real Home Assistant ingress gates

### HA -> `/status`

A real Home Assistant `rest_command.homeback_status` call returned HTTP 200 with:

```json
{"ok":true,"version":"0.5.0"}
```

This was repeated after final HA-only source restriction was applied.

### HA -> passive Preview notification

A real HA `rest_command` notification returned HTTP 200 with `done:true`, `suppressed:false`, `cameraRegistered:true`. The native toast appeared on the TV and the Cameras entry/icon path was verified.

### Five-event burst / newest wins

Five same-camera HA events were sent close enough to exercise the suppression window. Exactly one toast was observed, and the resulting camera entry reflected event 5/newest media.

The hardware claim is therefore **one visible toast + newest registry event**. CI/unit coverage separately proves the exact five-concurrent response split of one unsuppressed and four suppressed calls with one native sender attempt.

## TV -> Home Assistant media

Notification delivery is HA -> TV, but Preview media is fetched TV -> HA. Test both directions separately.

### Ordinary static JPEG

The TV fetched an HA-hosted `/local/homeback-test.jpg` successfully as JPEG, and HomeBack rendered it. In a later cold-open differential, the same class of ordinary HA `/local/*.jpg` media rendered on the **first** Preview activation.

### Synthetic FFmpeg camera proxy

The real HA synthetic FFmpeg camera used the normal Home Assistant camera proxy/token mechanism. A current `camera_proxy_stream` URL was directly reachable from the TV and returned multipart video data. HomeBack rendered moving frames.

The initial unconstrained synthetic source was excessively heavy and produced slow/black startup observations. After constraining the synthetic camera to roughly 640x360 at 5 fps, the toast was prompt, the rendered live video was visually smooth/high-frame-rate, and no stalling was observed. Do not document the original extreme-source behavior as a HomeBack product limitation.

A direct A/B then produced:

| Media source | First Preview activation | Second activation |
| --- | --- | --- |
| packaged `file://` PNG | renders | renders |
| HA ordinary `/local/*.jpg` | renders | renders |
| HA synthetic-camera `camera_proxy` JPEG | blank/white | renders static image |
| HA synthetic-camera `camera_proxy_stream` | blank/white | renders moving video |

The local-file and ordinary-HTTP controls show that HomeBack's cold Preview surface and generic WAM remote HTTP image loading can render on first activation. Both proxy variants shared the first-open blank on this synthetic FFmpeg camera. The exact proxy/FFmpeg warm-up mechanism was **not directly timed**, so keep the conclusion at that level of isolation rather than claiming a measured FFmpeg spin-up duration.

This is integration guidance, not evidence for a HomeBack source-code change.

## Recommended Home Assistant media recipe

For short notification previews, the documented default should use a Home Assistant snapshot written to `/config/www/homeback/<camera>.jpg`, then pass its `/local/homeback/<camera>.jpg` URL to HomeBack. This path was the remote-media path proven to render on first activation and it avoids camera-proxy token lifetime/warm-up behavior.

### Static-route prerequisite

Home Assistant only registers `/config/www` as `/local/` after the `www` directory exists at startup. If `/config/www` does not already exist, create the directory **before** starting/restarting HA:

```sh
mkdir -p /config/www/homeback
```

If `www` was created for the first time while HA was already running, restart Home Assistant once before testing `/local/`. Home Assistant's `www` directory is writable by `camera.snapshot` without an additional `allowlist_external_dirs` entry under current core defaults.

After a snapshot exists, verify the route with a real GET rather than relying on HEAD:

```sh
curl -sS -o /dev/null \
  -w 'http=%{http_code} bytes=%{size_download} type=%{content_type}\n' \
  http://HA-IP:8123/local/homeback/front_door.jpg
```

Require HTTP 200, non-zero bytes and an image content type before diagnosing HomeBack.

### Security and mutable-file semantics

Files under `/config/www` are served through `/local/` **without Home Assistant authentication**. A snapshot is therefore fetchable by any client that can reach the HA HTTP endpoint and knows or guesses the URL until that file is overwritten or removed. If the HA HTTP endpoint is reachable beyond the LAN, the exposure boundary is broader than the LAN as well.

Use one stable file **per camera**, for example `front_door.jpg` and `driveway.jpg`, and overwrite it on each event rather than accumulating timestamped unauthenticated files. Add a query-string cache buster to the URL sent to HomeBack.

The query string makes each registered URL distinct for caching purposes but does **not** make the underlying file immutable. Recent Cameras therefore shows the latest contents of **that camera's** snapshot file when opened later, not a guaranteed archival copy of the frame that originally produced the toast. With multiple cameras, each registry entry independently points at its own mutable per-camera file.

That behavior aligns with HomeBack's newest-wins design but is a different guarantee from event-image archival.

### Live-motion option

Users who prefer live motion can opt into a current `camera_proxy_stream` or integration-specific signed/proxied URL. On the tested synthetic FFmpeg path, live video was smooth once warm, but first activation was blank while the second rendered. Other real camera integrations such as Frigate/Reolink were not tested and must not be assumed to share that behavior.

A Home Assistant automation may also deliberately prime its camera/proxy before sending the HomeBack event if its integration has a known cold-start path. That is HA/integration-side mitigation; HomeBack intentionally does not store camera credentials or queue/replay stale notifications.

## Camera-token lifetime — issue #21

The same fixed synthetic-camera access token was measured as:

```text
~2 s    HTTP 200
~62 s   HTTP 200
~183 s  HTTP 200
~302 s  HTTP 200
~600 s  HTTP 403
```

The exact expiry instant was not measured. The important HomeBack result is that its 120 s Recent Cameras lifetime expired first by a large margin in this run. HA Core restart immediately changed the old fixed token from 200 to 403.

Do not persist tokenized/signed camera URLs across reboot or add long-lived HA credentials to HomeBack solely to refresh them. The recommended `/local/` snapshot recipe avoids this token dependency entirely; issue #21 remains the record for optional proxy/token-based media behavior.

## TV-off and no-replay semantics

HomeBack intentionally has no notification backlog. HTTP 200 means the event was accepted while HomeBack was reachable; it does not prove a person saw it and does not make the event durable.

A grace-window HA event at about +30 s was accepted with HTTP 200. In that experiment no stale toast/preview appeared after wake, but the event was already older than the 120 s Recent Cameras TTL by the planned wake time, so that observation alone is TTL/reboot-confounded. The direct `restartService` test separately proves the underlying process-local registry is erased on service restart well inside TTL.

The later +135 s and isolated +180 s requests were also accepted, so those runs never reached deep-off/unavailable state. Therefore the requested real-HA **deep-off drop** case is recorded as **NOT REPRODUCED in the later session**, not PASS/FAIL. The earlier corrected lifecycle cycles independently prove that an unavailable/reboot mode exists.

No queue/replay behavior is added to compensate for either lifecycle mode. If HA retry logic is configured externally, it must avoid turning old detections into stale alerts when HomeBack later becomes reachable.

## Evidence checklist for future hardware

Record:

- exact candidate/runtime commit SHA and any docs-only head separately;
- TV model, SDK and firmware;
- Home Assistant version/deployment type when available;
- LG power settings, including **Quick Start+ state when known**, without assuming causality;
- HTTP config with bearer token redacted;
- `/remote/status` including `httpConfigLoaded` and all HTTP fields;
- listener start/restart behavior;
- app-only restart behavior and probe resolution;
- source-filter positive/negative checks;
- standby probe cadence, failure mode, absolute latency and `connected` state;
- whether continuous traffic was present during standby testing;
- standby transition bounds and whether `/proc/uptime`/boot ID prove reboot or same-kernel behavior;
- wake-to-HTTP-ready timing only when the unavailable/reboot mode actually occurs;
- per-boot clock calibration when comparing host timestamps;
- HA -> `/status` and passive notification results;
- burst/newest-wins result, distinguishing visible hardware behavior from CI response-count proof;
- TV -> HA ordinary static JPEG;
- snapshot and live proxy behavior, including first-open/warm-open differences;
- token lifetime and HA-restart invalidation if tokenized media is used;
- direct Recent Cameras volatility result;
- grace-window/no-replay observations;
- deep-off drop only if the listener actually becomes unavailable;
- any deviations from this single-C5 baseline.

Keep **hardware-proven**, **CI-proven**, **characterised/inferred**, and **not reproduced/untested** claims explicitly separate.