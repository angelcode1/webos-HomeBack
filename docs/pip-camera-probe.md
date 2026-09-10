# Multi View / PiP camera probe

> **Disposable hardware experiment. Do not merge this branch into `main`.**

This branch records hardware measurements for using LG's native Multi View / PiP compositor as a passive HomeBack camera surface. Production HomeBack remains unchanged on `main`.

## Confirmed C5 results

On the target LG C5 / webOS 10 firmware:

- The private `com.webos.service.multiviewcontroller/launchApps` path works.
- Live TV + YouTube produces a genuine PiP pair.
- Live TV + Browser produces a genuine PiP pair; Browser can take several seconds to register as the sub surface.
- A HomeBack web app with `defaultWindowType: card` is accepted as the PiP sub surface.
- Surface Manager reports the HomeBack CARD as `primary:false`, `pip:true`, `multiview:true`, `windowType:_WEBOS_WINDOW_TYPE_CARD`, `viewType:mvpip`.
- With the remote left untouched through t+12, the PiP surface remains stable.
- After the t+12 marker, D-pad/OK operation of the main app does not promote the HomeBack CARD or collapse Multi View; the t+15 sample remains a valid PiP pair.
- The Multi View controller reports `mode:pip`, `controlMode:none`, and `inputMode:none` while retained.

This closed the core feasibility question: a HomeBack web surface can be admitted to native LG PiP without inherently taking control away from the main app.

## Phase 3 companion result

The production-shaped prototype keeps the normal HomeBack app as `floating` and packages a separate minimal CARD app:

- `com.homebrew.homeback` — normal floating HomeBack UI and root service.
- `com.homebrew.homeback.camera` — CARD camera renderer only.

The companion does not instantiate HomeBack's `SurfaceService`, `ActivationService`, Ribbon, Preview, keyboard ownership, or a self-close timer. It polls `com.homebrew.homeback.service/cameras/list` and renders the newest recent camera event.

### Surface/input gate — PASS

The independently packaged `com.homebrew.homeback.camera` companion is accepted as a genuine PiP sub app with both tested mains:

- Live TV + companion: retained through t+12 idle and t+15 after D-pad/OK. Controller remains `mode:pip`, foreground Live TV, sub HomeBack Camera, `controlMode:none`, `inputMode:none`.
- YouTube + companion: retained through t+12 idle and t+15 after D-pad/OK. Controller remains `mode:pip`, foreground YouTube, sub HomeBack Camera, `controlMode:none`, `inputMode:none`.
- Closing only the companion returns the main app to normal single-app mode.

This validates the intended two-app production architecture. The production HomeBack app does not need to become a CARD.

### Camera data gate — permission migration pending retest

The first companion run exposed an LS2 permission-upgrade issue, not a compositor issue. After reinstalling the main package, a direct `/bootstrap` call returned `-401` because the helper service was no longer elevated. The companion then repeatedly received `LS_REQUIRES_SECURITY` for `/cameras/list`.

The existing HomeBack UI stored `homeback.setupComplete.v1` and, on subsequent launches, intentionally skipped the privileged bootstrap path. That meant a newly introduced companion client-permission entry could remain unapplied on an existing installation. A reinstall could also leave the service unelevated while the persisted setup marker still said setup was complete.

The experiment branch now fixes both upgrade cases:

- Adds versioned marker `homeback.permissionSchema.v2`.
- An existing installation with setup complete but no v2 marker performs one idempotent permission reconciliation through the existing Homebrew Channel elevation path.
- Normal remote-input health recovery also invokes that reconciliation if `/remote/start` returns `-401` after reinstall.
- The companion runtime identity receives only `public` plus `com.homebrew.homeback.service.group`; it does not inherit HomeBack's launcher/internal/eim/tv privileges.

CI #330 is green on the migration-fix head: immutable install, tests, typecheck, lint, dual IPK build, artifact validation, and artifact upload all pass.

## Production implication

Do **not** convert the production HomeBack application from `floating` to `card`. The production Ribbon/Preview app intentionally uses floating/overlay lifecycle behavior and has different input semantics.

After the camera data permission retest passes, the production service should:

1. Receive/store the HA camera event as it does today.
2. Inspect the current foreground CARD/source rather than launching Live TV.
3. Attempt `launchApps` using the existing foreground app as `main` and `com.homebrew.homeback.camera` as `sub` only on compatible sources.
4. Confirm admission from Surface Manager/controller state rather than trusting `returnValue:true` alone.
5. Keep `controlMode:none` / `inputMode:none` so the main application retains D-pad/OK.
6. Close the companion on timeout, source change, replacement by a newer camera event, or failed admission.
7. Fall back to the existing passive native toast path when PiP is restricted or unavailable.

HDMI restrictions remain a separate issue. A previous HDMI1 control pair was rejected by firmware with `Multiview cannot be launched for restriction`; production must treat that as a normal fallback condition, not as a HomeBack failure.

## Probe script

`scripts/pip-camera-probe.sh` supports the original HomeBack/control modes plus the production-shaped companion modes:

- `livetv-companion`
- `youtube-companion`
- `hdmi1-companion`

For retention tests it samples Surface Manager and controller status at multiple time points and separates an idle window from a post-input window. The shell safety cleanup closes only the requested sub app after 20 seconds.

`known-amazon` remains non-diagnostic on the target TV because app ID `amazon` is not installed.

## Remaining validation

The remaining Phase 3 gate is narrow: install the migration-fix main package, launch normal HomeBack once so the v2 permission migration/elevation runs, verify the companion can call `/cameras/list`, then trigger a fresh camera event and confirm the companion renders it while PiP is active. A successful Live TV retest is sufficient for the permission boundary because the companion identity and LS2 grant are independent of which app is the PiP main.
