# Multi View / PiP camera probe

> **Disposable hardware experiment. Do not merge this branch into `main`.**

This branch records hardware measurements for using LG's native Multi View / PiP compositor as a passive HomeBack camera surface. Production HomeBack remains unchanged on `main`.

## Confirmed C5 results

On the target LG C5 / webOS 10 firmware:

- The private `com.webos.service.multiviewcontroller/launchApps` path works.
- Live TV + YouTube produces a genuine PiP pair.
- Live TV + Browser produces a genuine PiP pair; Browser can take several seconds to register as the sub surface.
- A verified HomeBack web app with `defaultWindowType: card` is accepted as the PiP sub surface.
- Surface Manager reports HomeBack as `primary:false`, `pip:true`, `multiview:true`, `windowType:_WEBOS_WINDOW_TYPE_CARD`, `viewType:mvpip`.
- With the remote left untouched through t+12, that HomeBack PiP surface remains stable.
- After the t+12 marker, D-pad/OK operation of the Live TV main app does not promote HomeBack or collapse Multi View; the t+15 sample remains a valid PiP pair.
- The Multi View controller reports `mode:pip`, `foregroundAppId:com.webos.app.livetv`, `subAppId:com.homebrew.homeback`, `controlMode:none`, and `inputMode:none` while retained.
- The disposable CARD app self-closes after 18 seconds. Therefore the shell cleanup at 20 seconds may report `app is not running`; that is expected and is not a PiP failure.

This closes the core feasibility question: a HomeBack web surface can be admitted to native LG PiP without taking control away from the main app.

## Production implication

Do **not** convert the production HomeBack application from `floating` to `card`. The production Ribbon/Preview app intentionally uses floating/overlay lifecycle behavior and has different input semantics.

The production-shaped design should instead use a separate minimal CARD companion app, with a distinct app ID, dedicated only to camera rendering. The root HomeBack service can remain the authority for recent camera state and for deciding when to request Multi View. The companion must not instantiate HomeBack's production `SurfaceService`, `ActivationService`, Ribbon, Preview, or keyboard ownership stack.

The production service should:

1. Receive/store the HA camera event as it does today.
2. Inspect the current foreground CARD/source rather than launching Live TV.
3. Attempt `launchApps` using the existing foreground app as `main` and the camera companion as `sub` only on compatible sources.
4. Confirm admission from Surface Manager/controller state rather than trusting `returnValue:true` alone.
5. Keep `controlMode:none` / `inputMode:none` so the main application retains D-pad/OK.
6. Close the companion on timeout, source change, replacement by a newer camera event, or failed admission.
7. Fall back to the existing passive native toast path when PiP is restricted or unavailable.

HDMI restrictions remain a separate issue. A previous HDMI1 control pair was rejected by firmware with `Multiview cannot be launched for restriction`; production must treat that as a normal fallback condition, not as a HomeBack failure.

## Probe script

`scripts/pip-camera-probe.sh` supports:

- `inspect`
- `known` / `known-livetv`
- `known-browser`
- `known-amazon`
- `known-hdmi1`
- `homeback` / `livetv-homeback`
- `hdmi1-homeback`
- `youtube-homeback`

For HomeBack retention tests it samples Surface Manager and controller status at multiple time points and separates an idle window from a post-input window.

`known-amazon` is non-diagnostic on the target TV because app ID `amazon` is not installed.

## Remaining validation

Before promoting any implementation toward production, validate the separate companion app itself with at least Live TV and YouTube as existing mains, plus confirm the passive native-toast fallback on a source where Multi View is restricted.
