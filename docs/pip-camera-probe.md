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

## Phase 3 companion result — PASS

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

### Camera data permission gate — PASS

The first companion run exposed an LS2 permission-upgrade issue, not a compositor issue. After reinstalling the main package, a direct `/bootstrap` call returned `-401` because the helper service was no longer elevated. The companion then repeatedly received `LS_REQUIRES_SECURITY` for `/cameras/list`.

The branch added a versioned permission migration (`homeback.permissionSchema.v2`) and `-401` self-healing. On the hardware retest:

- Launching normal HomeBack once successfully elevated/reconciled the helper after reinstall.
- `/bootstrap` then returned `returnValue:true`, `done:true`, and `restartRequired:false`.
- `com.homebrew.homeback.camera-*` was present in the generated HomeBack client-permission files.
- The subsequent Live TV + companion run contained no actual `LS_REQUIRES_SECURITY` event for `/cameras/list`.
- The companion remained a valid PiP sub through the same retention/input test.

The permission boundary is therefore closed. The log did not independently prove that a particular camera image was visibly rendered, so visible media rendering remains part of the end-to-end automatic-event test rather than being inferred from the absence of LS2 errors.

## Phase 4 automatic runtime prototype

The service now contains a guarded automatic camera PiP presenter. It is intentionally conservative for the first end-to-end hardware test:

1. Read Surface Manager's current foreground state; never hard-code or force a source.
2. Reuse an already-valid HomeBack companion PiP session if one exists.
3. Otherwise require exactly one normal foreground CARD and allow only mains already measured successfully on this TV: `com.webos.app.livetv` and `youtube.leanback.v4`.
4. Never replace an unrelated existing Multi View session.
5. Ask `multiviewcontroller/launchApps` to keep the detected app as `main` and launch `com.homebrew.homeback.camera` as `sub`.
6. Verify the actual Surface Manager pair before considering PiP successful; `launchApps returnValue:true` alone is insufficient.
7. On verified PiP, suppress the duplicate native toast and let the companion display the recent camera state.
8. On unsupported foreground, controller rejection, query failure, or admission timeout, leave the main app alone and use the existing passive native toast fallback.
9. Close only the companion after the requested camera duration (bounded 1–10 seconds), and reset that timer when a later unsuppressed event reuses the active session.

The automatic presenter exposes diagnostic state at `com.homebrew.homeback.service/pip/status` with the last outcome, reason, detected main app, companion ID, and whether HomeBack considers a PiP session active.

The HTTP camera endpoint has a hard five-second request timeout, so automatic admission is deliberately bounded: foreground Surface Manager calls have a 500 ms timeout, controller launch 750 ms, admission polling uses an immediate sample plus eight 250 ms intervals, and the fallback toast has a one-second LS2 timeout. An admission-query error fails open immediately rather than consuming the entire HTTP request budget.

CI #340 is green on automatic-runtime code head `78c88a240f46c2995d71f57b8fb70fed6393d272`: immutable install, tests, typecheck, lint, both IPK builds, experimental artifact validation, and upload all passed.

## Production implication

Do **not** convert the production HomeBack application from `floating` to `card`. The production Ribbon/Preview app intentionally uses floating/overlay lifecycle behavior and has different input semantics.

The next hardware gate is the automatic runtime itself. If that passes, production hardening should add active-session source-change handling and decide whether additional mains are enabled only after they are measured rather than inferred from manifest metadata.

HDMI remains intentionally outside the initial automatic allowlist. A previous HDMI1 control pair was rejected by firmware with `Multiview cannot be launched for restriction`; an HDMI camera event should therefore remain on HDMI and use the passive native-toast fallback.

## Probe script

`scripts/pip-camera-probe.sh` remains available for low-level retention diagnostics and supports the production-shaped companion modes:

- `livetv-companion`
- `youtube-companion`
- `hdmi1-companion`

The automatic Phase 4 test should **not** invoke the probe script: the point is to validate that a normal camera notification discovers and preserves the already-foreground app itself.

`known-amazon` remains non-diagnostic on the target TV because app ID `amazon` is not installed.

## Remaining validation

Install the Phase 4 main and companion packages, launch normal HomeBack once after reinstall so its root helper is healthy, then trigger normal camera notifications with Live TV, YouTube, and HDMI1 already foreground.

A pass requires:

- Live TV and YouTube: automatic companion PiP admission, camera content visible, no duplicate native toast, main input retained, and companion-only timeout closure.
- HDMI1: no source switch and no attempted replacement of the foreground app; passive native toast fallback instead.
- `/pip/status` and Surface Manager state must agree with the observed behavior.

Only after this gate passes should the automatic presenter be considered for a clean production implementation; this disposable branch and PR remain non-mergeable experiment history.
