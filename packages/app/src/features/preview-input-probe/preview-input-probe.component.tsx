import { useEffect, useRef, useState } from 'react';

import type { ActivateType } from 'shared/api/common';
import { lifecycleManagerService } from 'shared/services/services';

import s from './preview-input-probe.module.scss';

const PROBE_DURATION_MS = 30_000;
const SNAPSHOT_INTERVAL_MS = 250;
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
		const startedAtMs = Date.now();
		const expiresAtMs = startedAtMs + PROBE_DURATION_MS;

		const record = (kind: ProbeCounter, detail = '', log = true): void => {
			countsRef.current[kind] += 1;
			if (!log) return;
			const elapsed = Date.now() - startedAtMs;
			const line = `${elapsed}ms ${kind}${detail ? ` ${detail}` : ''}`;
			recentEventsRef.current = [line, ...recentEventsRef.current].slice(0, RECENT_EVENT_LIMIT);
			console.info(`[HomeBackPreviewProbe] ${line}`);
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
		const handleFocus = (): void => record('focus');
		const handleBlur = (): void => record('blur');
		const handleVisibilityChange = (): void => {
			record('visibilitychange', `state=${document.visibilityState}`);
		};

		document.addEventListener('keydown', handleKeyDown, false);
		document.addEventListener('keyup', handleKeyUp, false);
		document.addEventListener('wheel', handleWheel, { passive: true });
		document.addEventListener('mousemove', handleMouseMove, false);
		document.addEventListener('pointermove', handlePointerMove, false);
		document.addEventListener('click', handleClick, false);
		document.addEventListener('visibilitychange', handleVisibilityChange, false);
		window.addEventListener('focus', handleFocus, false);
		window.addEventListener('blur', handleBlur, false);

		lifecycleManagerService.commitVisible();
		console.info('[HomeBackPreviewProbe] start', {
			activation,
			launchReason: webOSSystem.launchReason,
			visibilityState: document.visibilityState,
			focused: document.hasFocus(),
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
			console.info('[HomeBackPreviewProbe] timeout: committing hidden surface');
			lifecycleManagerService.commitHidden();
			onComplete();
		}, PROBE_DURATION_MS);

		return () => {
			clearInterval(snapshotTimer);
			clearTimeout(expiryTimer);
			document.removeEventListener('keydown', handleKeyDown, false);
			document.removeEventListener('keyup', handleKeyUp, false);
			document.removeEventListener('wheel', handleWheel, false);
			document.removeEventListener('mousemove', handleMouseMove, false);
			document.removeEventListener('pointermove', handlePointerMove, false);
			document.removeEventListener('click', handleClick, false);
			document.removeEventListener('visibilitychange', handleVisibilityChange, false);
			window.removeEventListener('focus', handleFocus, false);
			window.removeEventListener('blur', handleBlur, false);
		};
	}, [activation, onComplete]);

	return (
		<section className={s.probe} aria-label='HomeBack preview input probe'>
			<div className={s.heading}>HomeBack Preview Input Probe</div>
			<div className={s.warning}>30 s · logging only · no input consumption</div>
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
