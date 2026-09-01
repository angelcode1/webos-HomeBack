# HomeBack 0.4.15 optimization pass

This source tree continues from the previously refactored 0.4.13 source and
incorporates the follow-up build/device review. The earlier review independently
confirmed that the refactor produced a production Webpack build and reduced
`app.js` from roughly 490 KB to about 271 KB minified. 0.4.14 keeps that
architecture and fixes the two regressions/gaps found afterward.

## 0.4.14 follow-up fixes

- Restored `packages/app/src/shared/api/env.d.ts`, declaring `__DEV__` and the
  compile-time `process.env.APP_ID` / `SERVICE_ID` globals used by the app.
- Added pre-injection `/proc/<pid>/maps` inspection for every native target.
- Existing HomeBack `libinputhookpp.so` mappings are adopted after helper/LS2
  recreation instead of being reinjected.
- Adopted targets reattach their deterministic event log at EOF, preventing
  stale key-event replay while restoring log/process/config polling.
- Added a second maps preflight immediately before spawning `ezinject` to close
  the process-scan/injection race.
- Foreign already-loaded hooks are blocked and surfaced diagnostically rather
  than double-injected; standalone mappings remain detectable even if their
  package/marker was removed while the native target is still alive.
- Active target status now records `source: injected|adopted` and exposes
  `nativeOwnershipVerified`.
- Native injection verification now retries for a bounded window instead of
  treating one early `/proc` sample as a permanent failure.
- Predictable root-owned `/tmp` hook logs are created/opened with `O_NOFOLLOW`;
  adoption rejects symlinked event logs.
- The Homebrew boot worker requires `nativeOwnershipVerified:true` before it
  declares remote startup successful.
- Added unit coverage for mapped-library parsing, HomeBack adoption
  classification, deleted mappings, and standalone-hook rejection.
- Updated the launcher SVG to the supplied refined house and restored the old
  reverse-Amazon-smile return arrow; regenerated optimized 80/130 px PNGs.

## Earlier refactor retained

- Canonical-path protection for privileged icon reads.
- Transactional remote-input policy reloads and rejected-mtime suppression.
- Strict mapping validation and safe legacy migration.
- Post-injection `/proc/<pid>/maps` verification.
- PID/log cleanup, rotation, short-read handling, and rescan coalescing.
- Press-time mapping snapshots, stale-press watchdog, and action cooldown.
- Timed Luna calls and typed helper/frontend error propagation.
- Removed unreachable full-apply/keyfilter/elevation/probe production surface.
- Removed dead numeric keypad and stale event paths.
- Removed Inversify, decorator metadata and reflect-metadata.
- Replaced framer-motion with CSS transitions and a cancellable rAF scroll tween.
- Pure launcher reconciliation with cache eviction and empty-list protection.
- Four-wide, revision-guarded icon hydration and Unicode-safe fallback icons.
- One visibility source of truth with bounded hide waiting.
- Production app source maps disabled; Webpack 5.105 native TS path resolution.
- Release/deploy gate on invariant tests, tests, typecheck and lint.

## Verification performed here

- `node scripts/verify-optimized-source.cjs` — run as part of final packaging.
- `node --experimental-strip-types --test tests/*.test.ts` — **14/14 pass** in this revision.
- TypeScript syntax transpilation across source files — run as part of final packaging.
- Relative-import resolution and removed-feature scans — run as part of final packaging.
- shell syntax checks for deploy/release scripts — run as part of final packaging.
- The app `env.d.ts` regression was additionally checked with the available global
  TypeScript compiler: there are no remaining `__DEV__`/`process.env` undefined
  errors; dependency type errors are expected without installed node modules.

A complete Yarn dependency install, project-version `tsc`, ESLint and production
Webpack rebuild cannot be rerun in this sandbox because Corepack cannot resolve
`repo.yarnpkg.com` (`EAI_AGAIN`). The previous reviewer did complete a genuine
install/typecheck/test/production-build pass on the immediately preceding
refactor; 0.4.14 changes should still be rebuilt on a networked host before TV
deployment.

## Device verification still required

The highest-value regression test is helper recreation **without restarting the
native target PIDs**. After HomeBack owns `micomservice` and `lginput2`, restart
the HomeBack helper and confirm `/remote/status` reports the same PIDs as
`source:"adopted"`, `nativeOwnershipVerified:true`, and no standalone hook. Then
repeat the short/long HOME and app-key mappings on the TV.

## Second 0.4.14 review pass

A subsequent full-build review found that the previous ESLint cleanup had accidentally
reduced TypeScript coverage and identified several remaining remote-input lifecycle
edge cases. This source revision applies all concrete findings from that review.

### Lint/release gate

- Every workspace now runs `eslint --ext .ts,.tsx,.js .`, so directory linting can no
  longer silently skip the TypeScript implementation tree.
- Added a TypeScript ESLint config for `packages/utils`, which previously exited with
  "No files matching the pattern" once explicit extensions were used.
- Replaced the JS-centric Airbnb/Sonar error preset combination with an explicit
  TypeScript-aware ESLint policy. TypeScript compiler responsibilities (`no-undef`,
  duplicate declarations, etc.) are disabled in the base rules while
  `@typescript-eslint/no-unused-vars`, typed floating-promise checks, type-import
  consistency, import resolution, React Hooks, and project-specific restrictions
  remain active release-gating checks.
- Removed `eslint-config-airbnb-base`, `eslint-plugin-sonarjs`, and its direct
  `ts-api-utils` support dependency. This avoids reintroducing the archived
  `eslint-config-airbnb-typescript` package, whose released peer range does not cover
  the TypeScript-ESLint 8 line used by HomeBack.
- The optimized-source verifier now guards the explicit TypeScript lint commands and
  the utils ESLint project config so this coverage regression cannot recur silently.

### Native target lifecycle

- Process scanning now builds one target snapshot from one `/proc` directory walk per
  cycle. Standalone-hook detection, cleanup, ownership decisions, and normal target
  reconciliation all consume that snapshot instead of independently walking `/proc`.
- `/proc/<pid>/maps` read failures are represented as "unknown", not "no hook". A
  target with unreadable maps is deferred and periodically rechecked; HomeBack never
  interprets an inspection failure as permission to inject.
- Blocked live targets are re-probed every 10 seconds. This allows transient event-log
  or `/proc` failures to recover without requiring the target PID to die.
- `blockedHooks` now carries a human-readable `recovery` field and timestamps. A
  genuinely missing HomeBack event log explicitly tells the operator to restart the
  target process or reboot rather than risking a second native hook.
- Injection retries are bounded to three consecutive attempts per PID. The first two
  failures use 5 s / 10 s backoff; the third moves the PID to
  `reason:"injection-failed"` and stops automatic reinjection. The helper continues
  low-frequency `/proc` checks so an externally restored HomeBack mapping can still be
  adopted safely.
- Pending injection retries are exposed in `/remote/status` under `retrying`.
- `nativeOwnershipVerified` is now scoped to observed essential native targets
  (`lginput2` and `micomservice`). A foreign hook on compatibility/diagnostic targets
  such as `tvservice` remains visible in `blockedHooks` but no longer causes a false
  boot-worker timeout when the essential HomeBack targets are healthy.
- Dead target/retry/block state is pruned before the standalone-legacy early return,
  so compatibility mode no longer retains stale PID bookkeeping.
- Predictable root-owned log creation now performs `chmod(0600)` through the already
  opened `O_NOFOLLOW` file handle before close, eliminating the path-based chmod
  symlink-swap window. Adoption also uses an `O_NOFOLLOW` file handle for stat/truncate.
- The launcher SVG verifier now checks dimensions and required palette rather than
  pinning exact path geometry, so harmless future icon drawing edits no longer break
  an unrelated source invariant.

### Added regression coverage

The unit suite is now **25 tests**. New tests cover essential-target ownership
semantics, the non-fatal treatment of non-essential blockers, and the bounded
injection retry/backoff policy in addition to the earlier adoption/config/icon/path
coverage.


## Review 4 / device-feedback fixes

- App drawer now owns wheel events, debounces wheel detents, disables the background ribbon wheel controller while open, and uses Chrome-79-safe flex scroll sizing (`flex: 1 1 auto; min-height: 0`).
- The built-in Inputs tile is 20% narrower than a standard tile and its icon is scaled by the same 0.8 factor.
- Successful first setup is persisted in localStorage. Normal launches/reboots render HomeBack immediately instead of showing the recurring "Setting up HomeBack…" screen. A first normal launch may still show setup until bootstrap succeeds.
- The Homebrew boot worker now initializes remote input only. Boot-time UI prelaunch was removed after device testing showed that an early hidden floating-app instance could become unresponsive to later HOME/show requests. The worker retains `/proc/uptime` diagnostics for native readiness.

- Restored the Keypad tile immediately after Inputs and before R/G/Y/B. Unlike the historical no-op proxy, entered digits are serialized to `micomservice/sendKeycode` using LG numeric remote keycodes.
- Added `/remote/status` last-key and last-action timing telemetry so future HOME-to-launch latency tests do not depend on stale system-log matches.

## Review 5 / publication-gate and keypad hardening

- Fixed the final `check:full` lint blockers at the ESLint-policy level instead of running an unsafe bulk autofix. The `@typescript-eslint/consistent-type-imports` fixer is disabled because this ESLint/typescript-eslint combination can emit invalid TS2206 mixed type imports. TypeScript false positives from `import/default` and intentional generator adapters are disabled, while real unused-variable and floating-promise checks remain release-gating.
- Rewrote the four implicit `() => void promise()` timer callbacks as block-bodied callbacks so the existing `no-void` rule remains useful without false positives.
- The numeric keypad is now a HomeBack-owned 3x4 overlay positioned above the tray. It no longer focuses an `<input>`, so the fixed-bottom webOS virtual keyboard cannot shift the entire application upward.
- Physical remote Back (`GoBack` / `BrowserBack` / keycode 461) dismisses the in-app keypad without leaving HomeBack. D-pad navigation, Enter activation, pointer selection and direct numeric key events are supported.
- Numeric input is explicitly treated as remote-number emulation: `0-9` map to Linux input keycodes `11,2..10`, are serialized, and have an 80 ms inter-key gap so multi-digit channel entry is delivered as ordered discrete remote presses rather than an LS2 burst.
- Numeric keypad regression coverage now includes ordered channel-number sequences, Back dismissal recognition, direct digit decoding, D-pad navigation, and the inter-key timing constant. The full dependency-free unit suite is now 25 tests.
- Added a public-release provenance gate. Local builds and TV deployment remain possible, but `scripts/release.sh` refuses to create public release artifacts until the maintainer explicitly confirms redistribution rights for the exact unofficial native payload described in `THIRD_PARTY_NOTICES.md`. This guard records the unresolved provenance issue rather than pretending a code/license change can resolve unknown third-party rights.

## Review 7 / tray behaviour and keypad layout

- Replaced the system virtual-keyboard proxy with a HomeBack-owned numeric keypad positioned 240 px above the screen bottom, safely above the 216 px maximum selected tray-card height. This avoids the webOS content-shift animation entirely.
- Added a 3-second inactivity auto-hide for normal ribbon browsing. D-pad, wheel and pointer activity reset the timer; editing, the app drawer, and the numeric keypad pause auto-hide so those interaction modes are never dismissed from under the user.
- Tray card backgrounds render at 85% opacity while icons and controls remain fully opaque.
- Wheel activity now feeds the same ribbon inactivity timer so scrolling cannot cause the tray to disappear mid-interaction.


## Review 8 / security, lifecycle and maintainability hardening

- Closed the remaining `/tmp` hook-log TOCTOU window by retaining the `O_NOFOLLOW` file descriptor for each log cursor. Polling now uses `fstat`, positioned `read`, and `ftruncate` on the original descriptor, so replacing a pathname with a symlink cannot redirect HomeBack's privileged reads or truncation. The same change eliminates per-poll open/close churn and reuses one bounded read buffer.
- Added a 15-second `ezinject` watchdog and PID start-time identity checks. A hung injector is killed and enters the existing bounded retry policy, while stale callbacks cannot act on a recycled PID.
- Config reload identity now uses `mtime:size:inode`, so timestamp-preserving backup restores are detected. Service vendor paths are rooted from runtime `__dirname` rather than process cwd.
- Completed setup no longer reruns the privileged bootstrap on every HOME press. Normal launches render immediately, query `/remote/status`, and use the idempotent `/remote/start` path only when reconciliation is actually needed. First-run restart failure now falls through to rendering instead of leaving the setup page indefinitely.
- Fixed subscription executor completion semantics, removed dead press sweeping and unreachable injection throws, and standardized Application Manager Luna URIs.
- Cached `/proc/<pid>/comm` for live PIDs, discarded stale icon hydration queues on full refresh, and stopped mounting the entire hidden app drawer at startup.
- Consolidated ribbon, drawer and keypad remote handling into one keyboard dispatcher with an explicit active owner. Vertical navigation no longer emits duplicate semantic events.
- Hardened launcher ordering so built-in tiles cannot leak into the persisted user order and editing recomputes the selected index in the visible list after moves. Provider errors and blocked remote-hook states are surfaced in the ribbon rather than appearing as a silently empty/healthy launcher.
- Removed obsolete upstream target names (`testapp`, `RELEASE`) from automatic injection. HomeBack now targets the required `lginput2` / `micomservice` processes plus optional `tvservice` only.
- Removed remaining dead APIs and stale AltHome workspace package names. The historical `althome:settings` localStorage key is intentionally retained to preserve existing users' tile order.
- Extracted descriptor-safe event log tailing and action execution from `remote-input.ts`, adding focused regression tests for symlink replacement and `/proc` start-time parsing.
- Updated the launcher icon so the return arrow has a grey centre with a bright-red outline while retaining the burgundy background and white house.
