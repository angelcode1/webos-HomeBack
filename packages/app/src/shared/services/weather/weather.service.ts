import { makeAutoObservable } from 'mobx';

import { isPlainObject, type WeatherCondition, type WeatherSnapshot } from '@homeback/utils';

import { luna } from '../luna';

const WEATHER_CONDITIONS = new Set<WeatherCondition>([
	'clear',
	'partly-cloudy',
	'cloudy',
	'rain',
	'heavy-rain',
	'storm',
	'snow',
	'fog',
	'unknown',
]);

type WeatherResponse = {
	returnValue: true;
	weather: WeatherSnapshot | null;
};

const validWeatherSnapshot = (value: unknown): value is WeatherSnapshot => {
	if (!isPlainObject(value)) return false;
	const weather = value as Partial<WeatherSnapshot>;
	return typeof weather.temperatureC === 'number' &&
		Number.isFinite(weather.temperatureC) &&
		typeof weather.condition === 'string' &&
		WEATHER_CONDITIONS.has(weather.condition as WeatherCondition) &&
		typeof weather.observedAt === 'number' &&
		Number.isFinite(weather.observedAt) &&
		(weather.location === undefined || typeof weather.location === 'string') &&
		(weather.source === 'webos-weather' || weather.source === 'webos-location-openmeteo') &&
		(weather.stale === undefined || typeof weather.stale === 'boolean');
};

export class WeatherService {
	public weather: WeatherSnapshot | null = null;
	private refreshing: Promise<void> | null = null;

	public constructor() {
		makeAutoObservable<WeatherService, 'refreshing'>(
			this,
			{ refreshing: false },
			{ autoBind: true },
		);
	}

	public async refresh(): Promise<void> {
		if (this.refreshing) return this.refreshing;
		this.refreshing = this.fetchCurrent();
		try {
			await this.refreshing;
		} finally {
			this.refreshing = null;
		}
	}

	private async fetchCurrent(): Promise<void> {
		try {
			const response = await luna<WeatherResponse>(
				`luna://${process.env.SERVICE_ID}/weather/current`,
				{},
			);
			if (response.weather === null) {
				this.weather = null;
				return;
			}
			if (validWeatherSnapshot(response.weather)) this.weather = response.weather;
			else console.warn('[HomeBackWeather] ignored invalid service response');
		} catch (error) {
			console.warn('[HomeBackWeather] refresh failed', error);
		}
	}
}
