# HomeBack PiP camera probe — disposable hardware experiment

> **Do not merge this branch into `main`.** This experiment starts from current
> production `main`. The frozen `experiment/overlay-input-probe` branch remains
> untouched because it is the measurement record for web-app OVERLAY focus behavior.

## Why this probe exists

The earlier OVERLAY experiment answered one narrow question: a HomeBack web-app
`_WEBOS_WINDOW_TYPE_OVERLAY` surface on the tested LG C5 becomes the focused
surface and prevents the underlying CARD app from receiving normal D-pad input.
That result does **not** answer the behavior of LG Multi View / Picture in Picture.

webOS surface state distinguishes a real Multi View PiP session from an overlay:
its foreground entries can identify two CARD surfaces with `viewType: "mvpip"`,
one `primary: true, pip: false` and the other `primary: false, pip: true`.
LG's own TV UI also exposes Picture in Picture as a Multi View layout on supported
models.

The question for this branch is therefore:

> Can HomeBack's camera presentation run as the PiP **sub** CARD while the existing
> foreground app remains the **main** CARD and continues to own ordinary remote input?

If yes, PiP is materially different from the failed OVERLAY approach and can become
a candidate transport for automatic Home Assistant camera previews.

## Existing HomeBack camera plumbing already available

Do not redesign the Home Assistant boundary for this experiment. Production already
provides the pieces needed upstream of presentation:

- authenticated HTTP `POST /notification/createPreviewToast`;
- per-camera burst suppression;
- newest recent camera event retention;
- signed `preview.imageUrl` retention for at most two minutes;
- `/cameras/list` for the app-side provider;
- existing image/title/message rendering.

The PiP experiment should eventually consume the same recent-camera state rather
than putting signed Home Assistant URLs into shell commands, process arguments, or
logs.

## Important production constraint

Current HomeBack is installed as `defaultWindowType: "floating"`, and its rich
interactive preview intentionally owns focus. Production also dismisses HomeBack
features when a foreign app launches. Those are correct for the existing launcher
architecture but may be incompatible with PiP.

Do **not** change those production contracts until the platform capability is proven.
The first phase below therefore performs controller/surface eligibility tests against
the current app before introducing a dedicated CARD probe.

## Phase 0 — inspect current foreground state

On the TV:

```sh
sh scripts/pip-camera-probe.sh inspect
```

Keep the raw output. This establishes the ordinary single-app foreground shape.

## Phase 1A — prove Multi View PiP itself with a known pair

Run:

```sh
sh scripts/pip-camera-probe.sh known
```

This asks the private LG Multi View controller for:

- main: `com.webos.app.livetv`
- sub: `youtube.leanback.v4`
- mode: `pip`

The probe deliberately uses a platform-supported-style combination first. If this
fails, stop: a HomeBack-specific CARD/whitelist experiment is not yet justified.
Capture both the `launchApps` response and foreground state.

If `luna-send` cannot reach the controller at the process/bus level, repeat the same
request manually with `luna-send-pub`; firmware builds can expose private services
differently. Do not assume that an exit code of zero means PiP succeeded—inspect the
JSON response and foreground surface state.

### PiP success signature

The exact response shape is firmware-specific, but the decisive foreground evidence
is two simultaneous surfaces in Multi View/PiP, conceptually:

```text
main: primary=true  pip=false viewType=mvpip windowType=...CARD
sub:  primary=false pip=true  viewType=mvpip windowType=...CARD
```

During the 20-second window, **do not select the sub window**. Verify D-pad and OK
continue operating the main app. The script then closes only the sub app and prints
foreground state again so we can verify that the main app returns to ordinary
full-screen operation.

## Phase 1B — test HomeBack eligibility without changing HomeBack

After Phase 1A passes:

```sh
sh scripts/pip-camera-probe.sh homeback
```

or, to leave YouTube as the main app:

```sh
sh scripts/pip-camera-probe.sh youtube-homeback
```

This is intentionally a crude eligibility probe. Current HomeBack is still a
`floating` launcher app, so one of several outcomes is useful:

1. **HomeBack becomes the PiP sub CARD and main keeps input.** Excellent: the
   controller may coerce/host the app appropriately and the next experiment can
   concentrate on camera-only UI and lifecycle.
2. **Known pair works but HomeBack is rejected.** Most likely window type and/or LG
   Multi View app allowlisting must be addressed. Proceed to a dedicated CARD probe,
   not an OVERLAY modification.
3. **HomeBack appears but remains floating/overlay-like or steals main input.** PiP
   has not solved the focus problem yet; inspect `primary`, `pip`, `viewType`, and
   window type before changing app code.
4. **PiP starts but closes/fails for the current video mode.** Retest with ordinary
   SDR/non-HFR content. LG documents source/content restrictions for Multi View.

## Phase 2 — dedicated camera CARD probe (only after Phase 1)

If the controller works but current HomeBack's window type/launcher lifecycle is the
blocker, create the next disposable implementation on **this PiP branch**, not on the
frozen overlay branch:

- CARD-style camera surface;
- no `SurfaceService.activate()`;
- no Ribbon, drawer, keypad, or Preview keyboard ownership;
- no D-pad/Back consumption;
- render the newest `/cameras/list` entry directly;
- log focus/blur/key events without consuming them;
- 10–20 second hard safety lifetime;
- close only the PiP sub surface on expiry;
- never log the camera URL path/query/token.

The preferred production form, if hardware validates PiP, is likely a **small
companion CARD app/surface** dedicated to camera presentation rather than changing
HomeBack's launcher window type. That keeps HomeBack's existing floating launcher and
PiP camera lifecycle/focus contracts isolated.

## Phase 3 — automatic Home Assistant presentation

Only after CARD PiP focus behavior is proven should the service add an automatic
presentation policy. A safe shape is:

1. HA POST arrives through the existing authenticated endpoint.
2. Existing state records the newest camera event and signed image URL.
3. Native compact toast remains the fallback.
4. If PiP capability/current foreground/source mode permit it, launch or refresh the
   camera companion as the `sub` surface.
5. Main app remains `primary` and ordinary remote input remains there.
6. New events for the same camera replace/refresh the sub image without creating a
   queue of PiP sessions.
7. Hard timeout closes the camera sub surface and restores the single main app.

Do not put HA credentials or signed URLs in `multiviewcontroller` payloads. Resolve
camera media inside the HomeBack app/service boundary.

## Hardware gates before any production merge

A production PiP implementation is not approved until all of these are measured on
hardware:

- known LG PiP pair works through the controller;
- HomeBack/companion is accepted as PiP sub;
- foreground state proves `mvpip`, main primary, camera sub PiP;
- main D-pad/OK continues working without manually selecting main after notification;
- HomeBack camera surface receives no ordinary key events while main is selected;
- Magic Remote pointer behavior is understood;
- Back behavior is safe and predictable;
- timeout/close collapses to the original main app cleanly;
- repeated camera events refresh rather than stack sessions;
- image failure cannot strand PiP;
- app launch/source change while PiP is open fails closed/cleans up;
- Live TV, YouTube, HDMI SDR are sampled separately;
- Dolby Vision / 4K HFR / other restricted modes fail gracefully to native toast;
- Home Assistant signed URL expiry behavior remains bounded and token-free in logs.

## What not to infer

- The existence of LG's visible PiP UI does not imply arbitrary third-party apps are
  accepted as a sub surface.
- A successful `launchApps` response does not prove input routing; foreground state
  and remote behavior are the decisive measurements.
- The old OVERLAY failure does not prove PiP failure.
- Conversely, successful PiP does not make a normal web-app overlay passive.

Keep this branch disposable until those distinctions are resolved on the target TV.
