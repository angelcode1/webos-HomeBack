import { useEffect, useRef, useState } from 'react';

const PROBE_DURATION_MS = 20_000;
const SNAPSHOT_INTERVAL_MS = 250;

type ProbeCounts = {
	keydown: number;
	keyup: number;
	wheel: number;
	pointermove: number;
	click: number;
	focus: number;
	blur: number;
};

const createCounts = (): ProbeCounts => ({
	keydown: 0,
	keyup: 0,
	wheel: 0,
	pointermove: 0,
	click: 0,
	focus: 0,
	blur: 0,
});

export const App = (): JSX.Element => {
	const countsRef = useRef<ProbeCounts>(createCounts());
	const recentRef = useRef<string[]>([]);
	const [counts, setCounts] = useState<ProbeCounts>(createCounts);
	const [recent, setRecent] = useState<string[]>([]);
	const [remainingSeconds, setRemainingSeconds] = useState(PROBE_DURATION_MS / 1_000);
	const [focused, setFocused] = useState(document.hasFocus());

	useEffect(() => {
		const startedAtMs = Date.now();
		const expiresAtMs = startedAtMs + PROBE_DURATION_MS;
		let lastPointerLogMs = 0;

		const record = (kind: keyof ProbeCounts, detail = '', log = true): void => {
			countsRef.current[kind] += 1;
			if (!log) return;
			const line = `${Date.now() - startedAtMs}ms ${kind}${detail ? ` ${detail}` : ''}`;
			recentRef.current = [line, ...recentRef.current].slice(0, 10);
			console.warn(`[HomeBackOverlayProbe] ${line}`);
		};

		const handleKeyDown = (event: KeyboardEvent): void => {
			record(
				'keydown',
				`key=${JSON.stringify(event.key)} code=${JSON.stringify(event.code)} ` +
					`keyCode=${event.keyCode} repeat=${event.repeat} defaultPrevented=${event.defaultPrevented}`,
			);
		};
		const handleKeyUp = (event: KeyboardEvent): void => {
			record(
				'keyup',
				`key=${JSON.stringify(event.key)} code=${JSON.stringify(event.code)} ` +
					`keyCode=${event.keyCode} repeat=${event.repeat} defaultPrevented=${event.defaultPrevented}`,
			);
		};
		const handleWheel = (event: WheelEvent): void => {
			record(
				'wheel',
				`deltaX=${event.deltaX} deltaY=${event.deltaY} defaultPrevented=${event.defaultPrevented}`,
			);
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

		window.addEventListener('keydown', handleKeyDown, true);
		window.addEventListener('keyup', handleKeyUp, true);
		window.addEventListener('wheel', handleWheel, { passive: true, capture: true });
		window.addEventListener('pointermove', handlePointerMove, true);
		window.addEventListener('click', handleClick, true);
		window.addEventListener('focus', handleFocus, true);
		window.addEventListener('blur', handleBlur, true);

		console.warn(
			`[HomeBackOverlayProbe] start epochMs=${startedAtMs} ` +
				`launchParams=${JSON.stringify(webOSSystem.launchParams)} ` +
				`focused=${document.hasFocus()} visibilityState=${document.visibilityState}`,
		);

		const snapshotTimer = window.setInterval(() => {
			setCounts({ ...countsRef.current });
			setRecent([...recentRef.current]);
			setFocused(document.hasFocus());
			setRemainingSeconds(Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1_000)));
		}, SNAPSHOT_INTERVAL_MS);

		const expiryTimer = window.setTimeout(() => {
			console.warn('[HomeBackOverlayProbe] timeout: webOSSystem.hide()');
			webOSSystem.hide();
		}, PROBE_DURATION_MS);

		return () => {
			clearInterval(snapshotTimer);
			clearTimeout(expiryTimer);
			window.removeEventListener('keydown', handleKeyDown, true);
			window.removeEventListener('keyup', handleKeyUp, true);
			window.removeEventListener('wheel', handleWheel, true);
			window.removeEventListener('pointermove', handlePointerMove, true);
			window.removeEventListener('click', handleClick, true);
			window.removeEventListener('focus', handleFocus, true);
			window.removeEventListener('blur', handleBlur, true);
		};
	}, []);

	return (
		<section
			aria-label='HomeBack overlay input probe'
			style={{
				position: 'fixed',
				top: 48,
				right: 48,
				width: 560,
				padding: 28,
				borderRadius: 20,
				background: 'rgba(10, 10, 14, 0.94)',
				color: 'white',
				fontFamily: 'sans-serif',
				fontSize: 22,
				lineHeight: 1.35,
				pointerEvents: 'none',
			}}
		>
			<div style={{ fontSize: 30, fontWeight: 700 }}>HomeBack Overlay Input Probe</div>
			<div style={{ marginTop: 8, opacity: 0.8 }}>
				20 s · no activate() · logging only · no input consumption
			</div>
			<div style={{ marginTop: 18 }}>
				Remaining: {remainingSeconds}s · Focus: {focused ? 'yes' : 'no'}
			</div>
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
					gap: 8,
					marginTop: 18,
				}}
			>
				{Object.entries(counts).map(([name, count]) => (
					<div key={name}>
						{name}: <strong>{count}</strong>
					</div>
				))}
			</div>
			<div style={{ marginTop: 18, fontSize: 17, opacity: 0.8 }}>
				{recent.length > 0
					? recent.map(event => <div key={event}>{event}</div>)
					: <div>No input observed.</div>}
			</div>
		</section>
	);
};
