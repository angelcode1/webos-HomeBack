import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';

import type { WeatherCondition } from '@homeback/utils';

import { weatherService } from 'shared/services/services';

import s from './ribbon-status-tile.module.scss';

const WEATHER_POLL_MS = 5 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
	hour: 'numeric',
	minute: '2-digit',
});

const minuteBoundaryDelay = (now: number): number => MINUTE_MS - (now % MINUTE_MS) + 20;

const useClock = (active: boolean): Date => {
	const [now, setNow] = useState(() => new Date());

	useEffect(() => {
		if (!active) return undefined;
		setNow(new Date());
		let interval: ReturnType<typeof setInterval> | null = null;
		const timeout = setTimeout(() => {
			setNow(new Date());
			interval = setInterval(() => setNow(new Date()), MINUTE_MS);
		}, minuteBoundaryDelay(Date.now()));

		return () => {
			clearTimeout(timeout);
			if (interval) clearInterval(interval);
		};
	}, [active]);

	return now;
};

const cloudPath = 'M9.2 23h14.1a5.2 5.2 0 0 0 .4-10.4A7.8 7.8 0 0 0 9 11.2 5.9 5.9 0 0 0 9.2 23Z';

const WeatherIcon = ({ condition }: { condition: WeatherCondition }): JSX.Element => {
	const common = {
		className: s.icon,
		viewBox: '0 0 32 32',
		fill: 'none',
		stroke: 'currentColor',
		strokeWidth: 1.8,
		strokeLinecap: 'round' as const,
		strokeLinejoin: 'round' as const,
		'aria-hidden': true,
	};

	if (condition === 'clear') {
		return (
			<svg {...common}>
				<circle cx='16' cy='16' r='5' />
				<path d='M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M25.2 6.8l-2.8 2.8M9.6 22.4l-2.8 2.8' />
			</svg>
		);
	}

	if (condition === 'partly-cloudy') {
		return (
			<svg {...common}>
				<circle cx='11' cy='11' r='4.2' />
				<path d={cloudPath} />
			</svg>
		);
	}

	if (condition === 'rain' || condition === 'heavy-rain') {
		return (
			<svg {...common}>
				<path d={cloudPath} />
				<path d={condition === 'heavy-rain' ? 'M11 25.5l-1 3M17 25.5l-1 3M23 25.5l-1 3' : 'M12 25.5l-1 2.5M20 25.5l-1 2.5'} />
			</svg>
		);
	}

	if (condition === 'storm') {
		return (
			<svg {...common}>
				<path d={cloudPath} />
				<path d='M17 23l-3 5h3l-1 3 5-6h-3l2-2' />
			</svg>
		);
	}

	if (condition === 'snow') {
		return (
			<svg {...common}>
				<path d={cloudPath} />
				<path d='M12 25v4M10.3 26l3.4 2M13.7 26l-3.4 2M21 25v4M19.3 26l3.4 2M22.7 26l-3.4 2' />
			</svg>
		);
	}

	if (condition === 'fog') {
		return (
			<svg {...common}>
				<path d={cloudPath} />
				<path d='M8 26h16M11 29h13' />
			</svg>
		);
	}

	return (
		<svg {...common}>
			<path d={cloudPath} />
		</svg>
	);
};

export const RibbonStatusTile = observer(({ visible }: { visible: boolean }): JSX.Element => {
	const now = useClock(visible);
	const weather = weatherService.weather;

	useEffect(() => {
		if (!visible) return undefined;
		void weatherService.refresh();
		const timer = setInterval(() => void weatherService.refresh(), WEATHER_POLL_MS);
		return () => clearInterval(timer);
	}, [visible]);

	const temperature = weather ? `${Math.round(weather.temperatureC)}°C` : '--°';
	const condition = weather?.condition ?? 'unknown';

	return (
		<div
			className={`${s.tile} ${visible ? s.visible : ''} ${weather?.stale ? s.stale : ''}`}
			role='status'
			aria-label={`${TIME_FORMATTER.format(now)}, ${temperature}`}
			title={weather?.location}
		>
			<div className={s.time}>{TIME_FORMATTER.format(now)}</div>
			<div className={s.weather}>
				<WeatherIcon condition={condition} />
				<span className={s.temperature}>{temperature}</span>
			</div>
		</div>
	);
});
