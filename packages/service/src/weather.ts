import { get as httpsGet } from 'https';

import { isPlainObject, type WeatherCondition, type WeatherSnapshot } from '@homeback/utils';

const WEATHER_CACHE_MS = 20 * 60 * 1000;
const WEATHER_STALE_MS = 2 * 60 * 60 * 1000;
const WEATHER_RETRY_MS = 5 * 60 * 1000;
const LUNA_PROBE_TIMEOUT_MS = 1_500;
const LOCATION_TIMEOUT_MS = 6_500;
const HTTP_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

const PREFERENCE_SERVICE_ROOTS = [
	'luna://com.palm.preferences',
	'luna://com.webos.service.preferences',
] as const;
const STOCK_WEATHER_APP_IDS = [
	'com.webos.app.home',
	'com.webos.app.lifeonscreen',
] as const;
const WEBOS_LOCATION_URI = 'luna://com.webos.service.location/getLocationUpdates';

type LunaCall = <T extends Record<string, any>>(
	uri: string,
	params?: Record<string, any>,
	timeoutMs?: number,
) => Promise<T>;

type JsonRequest = (url: string, timeoutMs?: number) => Promise<unknown>;

type WeatherLocation = {
	latitude?: number;
	longitude?: number;
	name?: string;
};

type StockState = {
	weather: WeatherSnapshot | null;
	location: WeatherLocation | null;
};

const finiteNumber = (value: unknown): number | null => {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
};

const fahrenheitToCelsius = (value: number): number => (value - 32) * 5 / 9;

const temperatureFromMetricObject = (value: unknown): number | null => {
	if (!isPlainObject(value)) return null;
	const metric = isPlainObject(value.Metric) ? value.Metric : null;
	const imperial = isPlainObject(value.Imperial) ? value.Imperial : null;
	const metricValue = finiteNumber(metric?.Value);
	if (metricValue !== null) return metricValue;
	const imperialValue = finiteNumber(imperial?.Value);
	return imperialValue === null ? null : fahrenheitToCelsius(imperialValue);
};

const temperatureFromRecord = (record: Record<string, unknown>): number | null => {
	const accuWeatherTemperature = temperatureFromMetricObject(record.Temperature);
	if (accuWeatherTemperature !== null) return accuWeatherTemperature;

	for (const key of ['temperatureC', 'temperature_c', 'tempC', 'currentTemperatureC']) {
		const value = finiteNumber(record[key]);
		if (value !== null) return value;
	}

	for (const key of ['temperature', 'temp']) {
		const value = finiteNumber(record[key]);
		if (value === null) continue;
		const unit = String(record.temperatureUnit ?? record.tempUnit ?? record.unit ?? '').toLowerCase();
		if (unit === 'f' || unit.includes('fahrenheit')) return fahrenheitToCelsius(value);
		if (value >= -90 && value <= 70) return value;
	}

	return null;
};

export const conditionFromWmoCode = (code: number): WeatherCondition => {
	if (code === 0) return 'clear';
	if (code === 1 || code === 2) return 'partly-cloudy';
	if (code === 3) return 'cloudy';
	if (code === 45 || code === 48) return 'fog';
	if ([51, 53, 55, 56, 57, 61, 63, 66, 80, 81].includes(code)) return 'rain';
	if ([65, 67, 82].includes(code)) return 'heavy-rain';
	if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
	if ([95, 96, 99].includes(code)) return 'storm';
	return 'unknown';
};

const conditionFromText = (value: unknown): WeatherCondition => {
	if (typeof value !== 'string') return 'unknown';
	const text = value.toLowerCase();
	if (/thunder|storm|lightning/.test(text)) return 'storm';
	if (/heavy rain|downpour|torrential/.test(text)) return 'heavy-rain';
	if (/rain|shower|drizzle/.test(text)) return 'rain';
	if (/snow|sleet|ice|freezing/.test(text)) return 'snow';
	if (/fog|mist|haze/.test(text)) return 'fog';
	if (/partly|mostly cloudy|intermittent clouds/.test(text)) return 'partly-cloudy';
	if (/cloud|overcast/.test(text)) return 'cloudy';
	if (/sun|clear|fair/.test(text)) return 'clear';
	return 'unknown';
};

const conditionFromAccuWeatherIcon = (value: unknown): WeatherCondition => {
	const icon = finiteNumber(value);
	if (icon === null) return 'unknown';
	if ([1, 2, 30, 31, 33, 34].includes(icon)) return 'clear';
	if ([3, 4, 5, 6, 35, 36, 37, 38].includes(icon)) return 'partly-cloudy';
	if ([7, 8].includes(icon)) return 'cloudy';
	if (icon === 11) return 'fog';
	if ([15, 16, 17, 41, 42].includes(icon)) return 'storm';
	if ([18].includes(icon)) return 'heavy-rain';
	if ([12, 13, 14, 39, 40].includes(icon)) return 'rain';
	if (icon >= 19 && icon <= 29) return 'snow';
	if ([43, 44].includes(icon)) return 'snow';
	return 'unknown';
};

const conditionFromRecord = (record: Record<string, unknown>): WeatherCondition => {
	for (const key of ['condition', 'weatherText', 'WeatherText', 'summary', 'description']) {
		const condition = conditionFromText(record[key]);
		if (condition !== 'unknown') return condition;
	}

	const wmoCode = finiteNumber(record.weather_code ?? record.weatherCode);
	if (wmoCode !== null) {
		const condition = conditionFromWmoCode(wmoCode);
		if (condition !== 'unknown') return condition;
	}

	return conditionFromAccuWeatherIcon(record.WeatherIcon ?? record.weatherIcon);
};

const observedAtFromRecord = (record: Record<string, unknown>, fallback: number): number => {
	for (const key of ['LocalObservationDateTime', 'localObservationDateTime', 'observedAt']) {
		const value = record[key];
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (typeof value === 'string') {
			const parsed = Date.parse(value);
			if (Number.isFinite(parsed)) return parsed;
		}
	}

	const epochSeconds = finiteNumber(record.EpochTime ?? record.epochTime);
	if (epochSeconds !== null && epochSeconds > 1_000_000_000) return epochSeconds * 1000;
	return fallback;
};

const collectRecords = (value: unknown): Record<string, unknown>[] => {
	const records: Record<string, unknown>[] = [];
	const pending: unknown[] = [value];
	while (pending.length > 0 && records.length < 256) {
		const next = pending.shift();
		if (Array.isArray(next)) {
			pending.push(...next);
			continue;
		}
		if (!isPlainObject(next)) continue;
		records.push(next);
		pending.push(...Object.values(next));
	}
	return records;
};

export const extractStockWeather = (
	value: unknown,
	now = Date.now(),
): WeatherSnapshot | null => {
	for (const record of collectRecords(value)) {
		const temperatureC = temperatureFromRecord(record);
		if (temperatureC === null) continue;
		const location = extractWeatherLocation(record)?.name;
		return {
			temperatureC,
			condition: conditionFromRecord(record),
			observedAt: observedAtFromRecord(record, now),
			...(location ? { location } : {}),
			source: 'webos-weather',
		};
	}
	return null;
};

const latitudeLongitudeFromRecord = (
	record: Record<string, unknown>,
): Pick<WeatherLocation, 'latitude' | 'longitude'> | null => {
	const latitude = finiteNumber(record.latitude ?? record.lat ?? record.Latitude);
	const longitude = finiteNumber(record.longitude ?? record.lon ?? record.lng ?? record.Longitude);
	if (latitude === null || longitude === null) return null;
	if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
	return { latitude, longitude };
};

export const extractWeatherLocation = (value: unknown): WeatherLocation | null => {
	for (const record of collectRecords(value)) {
		const coordinates = latitudeLongitudeFromRecord(record);
		const localizedName = record.localizedName ?? record.LocalizedName;
		const locationKey = record.locationKey ?? record.LocationKey;
		const genericName = record.city ?? record.City ?? record.name;
		const name = typeof localizedName === 'string' && localizedName.trim()
			? localizedName.trim()
			: ((coordinates || locationKey) && typeof genericName === 'string' && genericName.trim()
				? genericName.trim()
				: undefined);
		if (coordinates || name || (typeof locationKey === 'string' && locationKey)) {
			return {
				...(coordinates ?? {}),
				...(name ? { name } : {}),
			};
		}
	}
	return null;
};

export const requestJson = (url: string, timeoutMs = HTTP_TIMEOUT_MS): Promise<unknown> =>
	new Promise((resolve, reject) => {
		const request = httpsGet(
			url,
			{
				headers: {
					Accept: 'application/json',
					'User-Agent': 'HomeBack/Weather',
				},
			},
			response => {
				if (response.statusCode !== 200) {
					response.resume();
					reject(new Error(`Weather HTTP ${response.statusCode ?? 'unknown'} for ${url}`));
					return;
				}

				response.setEncoding('utf8');
				let body = '';
				response.on('data', chunk => {
					body += chunk;
					if (body.length > MAX_RESPONSE_BYTES) {
						response.destroy(new Error('Weather response exceeded size limit'));
					}
				});
				response.on('end', () => {
					try {
						resolve(JSON.parse(body));
					} catch (error) {
						reject(error);
					}
				});
			},
		);
		request.setTimeout(timeoutMs, () => request.destroy(new Error('Weather request timed out')));
		request.on('error', reject);
	});

export class WeatherService {
	private cache: WeatherSnapshot | null = null;
	private cachedAt = 0;
	private nextRetryAt = 0;
	private refreshPromise: Promise<WeatherSnapshot | null> | null = null;

	public constructor(
		private readonly lunaCall: LunaCall,
		private readonly jsonRequest: JsonRequest = requestJson,
		private readonly now: () => number = Date.now,
	) {}

	public async current(): Promise<WeatherSnapshot | null> {
		const now = this.now();
		if (this.cache && now - this.cachedAt < WEATHER_CACHE_MS) return this.cache;
		if (this.refreshPromise) return this.refreshPromise;
		if (now < this.nextRetryAt) return this.staleCache(now);

		this.refreshPromise = this.refresh();
		try {
			const weather = await this.refreshPromise;
			if (weather) {
				this.cache = weather;
				this.cachedAt = this.now();
				this.nextRetryAt = 0;
				return weather;
			}
			this.nextRetryAt = this.now() + WEATHER_RETRY_MS;
			return this.staleCache(this.now());
		} finally {
			this.refreshPromise = null;
		}
	}

	private staleCache(now: number): WeatherSnapshot | null {
		if (!this.cache || now - this.cachedAt > WEATHER_STALE_MS) return null;
		return { ...this.cache, stale: true };
	}

	private async refresh(): Promise<WeatherSnapshot | null> {
		const stock = await this.readStockState();
		if (stock.weather) return stock.weather;

		const preferredLocation = stock.location;
		if (preferredLocation?.latitude !== undefined && preferredLocation.longitude !== undefined) {
			return this.fetchOpenMeteo(preferredLocation);
		}
		if (preferredLocation?.name) {
			const resolved = await this.geocode(preferredLocation.name);
			if (resolved) return this.fetchOpenMeteo({ ...resolved, name: preferredLocation.name });
		}

		const webosLocation = await this.readWebosLocation();
		if (webosLocation) return this.fetchOpenMeteo(webosLocation);
		return null;
	}

	private async readStockState(): Promise<StockState> {
		const payloads = await Promise.all(
			PREFERENCE_SERVICE_ROOTS.flatMap(root =>
				STOCK_WEATHER_APP_IDS.map(appId => this.readAppProperties(root, appId)),
			),
		);

		let location: WeatherLocation | null = null;
		for (const payload of payloads) {
			if (!payload) continue;
			const weather = extractStockWeather(payload, this.now());
			if (weather) return { weather, location: extractWeatherLocation(payload) };
			location ??= extractWeatherLocation(payload);
		}
		if (location) return { weather: null, location };

		const locationPayloads = await Promise.all(
			PREFERENCE_SERVICE_ROOTS.flatMap(root =>
				STOCK_WEATHER_APP_IDS.map(appId => this.readLocationProperty(root, appId)),
			),
		);
		for (const payload of locationPayloads) {
			location ??= extractWeatherLocation(payload);
		}
		return { weather: null, location };
	}

	private async readAppProperties(root: string, appId: string): Promise<Record<string, unknown> | null> {
		try {
			return await this.lunaCall<Record<string, unknown>>(
				`${root}/appProperties/getAllAppPropertiesObj`,
				{ appId },
				LUNA_PROBE_TIMEOUT_MS,
			);
		} catch {
			return null;
		}
	}

	private async readLocationProperty(root: string, appId: string): Promise<Record<string, unknown> | null> {
		try {
			return await this.lunaCall<Record<string, unknown>>(
				`${root}/appProperties/getAppProperty`,
				{ appId, key: 'location' },
				LUNA_PROBE_TIMEOUT_MS,
			);
		} catch {
			return null;
		}
	}

	private async readWebosLocation(): Promise<WeatherLocation | null> {
		try {
			const response = await this.lunaCall<Record<string, unknown>>(
				WEBOS_LOCATION_URI,
				{ Handler: 'network', responseTimeout: 5 },
				LOCATION_TIMEOUT_MS,
			);
			return extractWeatherLocation(response);
		} catch {
			return null;
		}
	}

	private async geocode(name: string): Promise<WeatherLocation | null> {
		try {
			const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&format=json`;
			const response = await this.jsonRequest(url, HTTP_TIMEOUT_MS);
			if (!isPlainObject(response) || !Array.isArray(response.results)) return null;
			const first = response.results[0];
			if (!isPlainObject(first)) return null;
			const coordinates = latitudeLongitudeFromRecord(first);
			if (!coordinates) return null;
			return {
				...coordinates,
				name: typeof first.name === 'string' ? first.name : name,
			};
		} catch (error) {
			console.warn('[HomeBackWeather] geocoding failed', error instanceof Error ? error.message : error);
			return null;
		}
	}

	private async fetchOpenMeteo(location: WeatherLocation): Promise<WeatherSnapshot | null> {
		if (location.latitude === undefined || location.longitude === undefined) return null;
		try {
			const url = 'https://api.open-meteo.com/v1/forecast' +
				`?latitude=${encodeURIComponent(String(location.latitude))}` +
				`&longitude=${encodeURIComponent(String(location.longitude))}` +
				'&current=temperature_2m,weather_code&temperature_unit=celsius&timezone=auto';
			const response = await this.jsonRequest(url, HTTP_TIMEOUT_MS);
			if (!isPlainObject(response) || !isPlainObject(response.current)) return null;
			const temperatureC = finiteNumber(response.current.temperature_2m);
			const weatherCode = finiteNumber(response.current.weather_code);
			if (temperatureC === null) return null;
			return {
				temperatureC,
				condition: weatherCode === null ? 'unknown' : conditionFromWmoCode(weatherCode),
				observedAt: this.now(),
				...(location.name ? { location: location.name } : {}),
				source: 'webos-location-openmeteo',
			};
		} catch (error) {
			console.warn('[HomeBackWeather] weather fetch failed', error instanceof Error ? error.message : error);
			return null;
		}
	}
}
