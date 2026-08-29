import { useEffect, useRef, useState } from 'react';

import type { ActivateType } from 'shared/api/common';
import { lifecycleManagerService, systemInfoService } from 'shared/services/services';

import s from './preview-input-probe.module.scss';

const PROBE_DURATION_MS = 30_000;
const SNAPSHOT_INTERVAL_MS = 250;
const FOCUS_RELEASE_FALLBACK_MS = 250;
const FOCUS_RELEASE_CHECK_MS = 100;
const RECENT_EVENT_LIMIT = 10;

type ProbeCounter =
	| 'keydown'
	| 'keyup'
	| 'wheel'
	| 'mousemove'
	| 'pointermove'
	| 'click'
	| 'focus'
	| 'blur'
	| 'visibilitychange';

type ProbeCounts = Record<ProbeCounter, number>;

type PreviewInputProbeProps = {
	activation: ActivateType;
	onComplete: () => void;
};

const createCounts = (): ProbeCounts => ({
	keydown: 0,
	keyup: 0,
	wheel: 0,
	mousemove: 0,
	pointermove: 0,
	click: 0,
	focus: 0,
	blur: 0,
	visibilitychange: 0,
});

export const PreviewInputProbe = ({
	activation,
	onComplete,
}: PreviewInputProbeProps): JSX.Element => {
	const releaseFocus = activation.releaseFocus === true;
	const countsRef = useRef<ProbeCounts>(createCounts());
	const recentEventsRef = useRef<string[]>([]);
	const [counts, setCounts] = useState<ProbeCounts>(createCounts);
	const [recentEvents, setRecentEvents] = useState<string[]>([]);
	const [remainingSeconds, setRemainingSeconds] = useState(PROBE_DURATION_MS / 1_000);
	const [focused, setFocused] = useState(false);
	const [visibilityState, setVisibilityState] = useState(document.visibilityState);

	useEffect(() => {
		let lastMouseLogMs = 0;
		let lastPointerLogMs = 0;
		let secondPaintFrame: number | null = null;
		let focusReleaseFrame: number | null = null;
		let focusReleaseFallbackTimer: number | null = null;
		let focusReleaseCheckTimer: number | null = null;
		let focusReleaseRequested = false;
		const startedAtMs = Date.now();
		const performanceStartedAtMs = performance.now();
		const expiresAtMs = startedAtMs + PROBE_DURATION_MS;

		const record = (kind: ProbeCounter, detail = '', log = true): void => {
			countsRef.current[kind] += 1;
			if (!log) return;
			const elapsed = Date.now() - startedAtMs;
			const line = `${elapsed}ms ${kind}${detail ? ` ${detail}` : ''}`;
			recentEventsRef.current = [line, ...recentEventsRef.current].slice(0, RECENT_EVENT_LIMIT);
			console.warn(`[HomeBackPreviewProbe] ${line}`);
		};

		const requestWindowFocusRelease = (reason: string): void => {
			if (!releaseFocus || focusReleaseRequested) return;
			focusReleaseRequested = true;
			console.warn(
				`[HomeBackPreviewProbe] focus-release request reason=${reason} ` +
					`focusedBefore=${document.hasFocus()} visibilityState=${document.visibilityState}`,
			);
			try {
				webOSSystem.window.setFocus(false);
			} catch (error) {
				console.warn('[HomeBackPreviewProbe] focus-release threw', error);
				return;
			}
			focusReleaseCheckTimer = window.setTimeout(() => {
				focusReleaseCheckTimer = null;
				console.warn(
					`[HomeBackPreviewProbe] focus-release result focused=${document.hasFocus()} ` +
						`visibilityState=${document.visibilityState}`,
				);
			}, FOCUS_RELEASE_CHECK_MS);
		};

		const handleKeyDown = (event: KeyboardEvent): void => {
			record(
				'keydown',
				`key=${JSON.stringify(event.key)} code=${JSON.stringify(event.code)} ` +
					`keyCode=${event.keyCode} which=${event.which} repeat=${event.repeat} ` +
					`defaultPrevented=${event.defaultPrevented}`,
			);
		};
		const handleKeyUp = (event: KeyboardEvent): void => {
			record(
				'keyup',
				`key=${JSON.stringify(event.key)} code=${JSON.stringify(event.code)} ` +
					`keyCode=${event.keyCode} which=${event.which} repeat=${event.repeat} ` +
					`defaultPrevented=${event.defaultPrevented}`,
			);
		};
		const handleWheel = (event: WheelEvent): void => {
			record(
				'wheel',
				`deltaX=${event.deltaX} deltaY=${event.deltaY} deltaMode=${event.deltaMode} ` +
					`defaultPrevented=${event.defaultPrevented}`,
			);
		};
		const handleMouseMove = (event: MouseEvent): void => {
			const now = Date.now();
			const shouldLog = now - lastMouseLogMs >= SNAPSHOT_INTERVAL_MS;
			if (shouldLog) lastMouseLogMs = now;
			record('mousemove', `x=${event.clientX} y=${event.clientY}`, shouldLog);
		};
		const handlePointerMove = (event: PointerEvent): void => {
			const now = Date.now();
			const shouldLog = now - lastPointerLogMs >= SNAPSHOT_INTERVAL_MS;
			if (shouldLog) lastPointerLogMs = now;
			record(
				'pointermove',
				`type=${event.pointerType} x=${event.clientX} y=${event.clientY}`,
				shouldLog,
			);
		};
		const handleClick = (event: MouseEvent): void => {
			record('click', `button=${event.button} x=${event.clientX} y=${event.clientY}`);
		};
		const handleFocus = (): void => {
			record('focus');
			if (releaseFocus && !focusReleaseRequested && focusReleaseFrame === null) {
				// Let the compositor finish the activate/focus transition, then ask
				// webOS to drop this floating window's focus without hiding it.
				focusReleaseFrame = window.requestAnimationFrame(() => {
					focusReleaseFrame = null;
					requestWindowFocusRelease('focus-event');
				});
			}
		};
		const handleBlur = (): void => record('blur');
		const handleVisibilityChange = (): void => {
			record('visibilitychange', `state=${document.visibilityState}`);
		};

		// Capture at window level so the probe observes input before any existing
		// document-level capture listener can consume it. The handlers themselves
		// remain strictly non-consuming.
		window.addEventListener('keydown', handleKeyDown, true);
		window.addEventListener('keyup', handleKeyUp, true);
		window.addEventListener('wheel', handleWheel, { passive: true, capture: true });
		window.addEventListener('mousemove', handleMouseMove, true);
		window.addEventListener('pointermove', handlePointerMove, true);
		window.addEventListener('click', handleClick, true);
		document.addEventListener('visibilitychange', handleVisibilityChange, true);
		window.addEventListener('focus', handleFocus, true);
		window.addEventListener('blur', handleBlur, true);

		lifecycleManagerService.commitVisible();
		console.warn(
			`[HomeBackPreviewProbe] start epochMs=${startedAtMs} ` +
				`performanceNowMs=${performanceStartedAtMs.toFixed(1)} ` +
				`timeOriginMs=${performance.timeOrigin} navigationStartMs=${performance.timing.navigationStart} ` +
				`activation=${JSON.stringify(activation)} releaseFocus=${releaseFocus} ` +
				`launchReason=${JSON.stringify(webOSSystem.launchReason)} ` +
				`visibilityState=${document.visibilityState} focused=${document.hasFocus()} ` +
				`sdkVersion=${JSON.stringify(systemInfoService.sdkVersion)} ` +
				`firmwareVersion=${JSON.stringify(systemInfoService.firmwareVersion)} ` +
				`modelName=${JSON.stringify(systemInfoService.modelName)}`,
		);

		if (releaseFocus) {
			// The normal C5 run produced a focus event ~72 ms after activate(). This
			// fallback covers firmware where focus was already established before the
			// listener ran or where the browser doesn't dispatch a focus event.
			focusReleaseFallbackTimer = window.setTimeout(() => {
				focusReleaseFallbackTimer = null;
				requestWindowFocusRelease('fallback');
			}, FOCUS_RELEASE_FALLBACK_MS);
		}

		const firstPaintFrame = window.requestAnimationFrame(() => {
			secondPaintFrame = window.requestAnimationFrame(() => {
				const paintEntries = performance.getEntriesByType('paint').map(entry => ({
					name: entry.name,
					startTimeMs: Math.round(entry.startTime * 10) / 10,
				}));
				console.warn(
					`[HomeBackPreviewProbe] post-mount-frame epochMs=${Date.now()} ` +
						`performanceNowMs=${performance.now().toFixed(1)} paintEntries=${JSON.stringify(paintEntries)}`,
				);
			});
		});

		const snapshot = (): void => {
			setCounts({ ...countsRef.current });
			setRecentEvents([...recentEventsRef.current]);
			setFocused(document.hasFocus());
			setVisibilityState(document.visibilityState);
			setRemainingSeconds(Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1_000)));
		};
		snapshot();

		const snapshotTimer = setInterval(snapshot, SNAPSHOT_INTERVAL_MS);
		const expiryTimer = setTimeout(() => {
			console.warn('[HomeBackPreviewProbe] timeout: committing hidden surface');
			lifecycleManagerService.commitHidden();
			onComplete();
		}, PROBE_DURATION_MS);

		return () => {
			clearInterval(snapshotTimer);
			clearTimeout(expiryTimer);
			window.cancelAnimationFrame(firstPaintFrame);
			if (secondPaintFrame !== null) window.cancelAnimationFrame(secondPaintFrame);
			if (focusReleaseFrame !== null) window.cancelAnimationFrame(focusReleaseFrame);
			if (focusReleaseFallbackTimer !== null) clearTimeout(focusReleaseFallbackTimer);
			if (focusReleaseCheckTimer !== null) clearTimeout(focusReleaseCheckTimer);
			window.removeEventListener('keydown', handleKeyDown, true);
			window.removeEventListener('keyup', handleKeyUp, true);
			window.removeEventListener('wheel', handleWheel, true);
			window.removeEventListener('mousemove', handleMouseMove, true);
			window.removeEventListener('pointermove', handlePointerMove, true);
			window.removeEventListener('click', handleClick, true);
			document.removeEventListener('visibilitychange', handleVisibilityChange, true);
			window.removeEventListener('focus', handleFocus, true);
			window.removeEventListener('blur', handleBlur, true);
		};
	}, [activation, onComplete, releaseFocus]);

	return (
		<section className={s.probe} aria-label='HomeBack preview input probe'>
			<div className={s.heading}>HomeBack Preview Input Probe</div>
			<div className={s.warning}>
				30 s · logging only · {releaseFocus ? 'release window focus' : 'keep activated focus'}
			</div>
			<div className={s.status}>
				<span>Remaining: {remainingSeconds}s</span>
				<span>Focus: {focused ? 'yes' : 'no'}</span>
				<span>Visibility: {visibilityState}</span>
			</div>
			<div className={s.grid}>
				{Object.entries(counts).map(([name, count]) => (
					<div key={name} className={s.counter}>
						<span>{name}</span>
						<strong>{count}</strong>
					</div>
				))}
			</div>
			<div className={s.events}>
				<div className={s.eventsTitle}>Recent events</div>
				{recentEvents.length > 0
					? recentEvents.map(event => <div key={event}>{event}</div>)
					: <div>No input events observed yet.</div>}
			</div>
		</section>
	);
};
