import { useEffect, useState } from 'react';

import {
	CLOCK_MINUTE_MS,
	CLOCK_TILE_REVEAL_DELAY_MS,
	formatClockTileDate,
	minuteBoundaryDelay,
} from './ribbon-clock-tile.lib';
import s from './ribbon-clock-tile.module.scss';

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
	hour: 'numeric',
	minute: '2-digit',
});

const useClock = (active: boolean): Date => {
	const [now, setNow] = useState(() => new Date());

	useEffect(() => {
		if (!active) return undefined;

		setNow(new Date());
		let interval: ReturnType<typeof setInterval> | null = null;
		const boundaryTimer = setTimeout(() => {
			setNow(new Date());
			interval = setInterval(() => setNow(new Date()), CLOCK_MINUTE_MS);
		}, minuteBoundaryDelay(Date.now()));

		return () => {
			clearTimeout(boundaryTimer);
			if (interval) clearInterval(interval);
		};
	}, [active]);

	return now;
};

export const RibbonClockTile = ({ visible }: { visible: boolean }): JSX.Element => {
	const now = useClock(visible);
	const [revealed, setRevealed] = useState(false);

	useEffect(() => {
		setRevealed(false);
		if (!visible) return undefined;

		const revealTimer = setTimeout(() => {
			setRevealed(true);
		}, CLOCK_TILE_REVEAL_DELAY_MS);

		return () => clearTimeout(revealTimer);
	}, [visible]);

	const time = TIME_FORMATTER.format(now);
	const date = formatClockTileDate(now);

	return (
		<div
			className={`${s.tile} ${visible && revealed ? s.visible : ''}`}
			role='status'
			aria-label={`${time}, ${date}`}
		>
			<div className={s.time}>{time}</div>
			<div className={s.date}>{date}</div>
		</div>
	);
};
