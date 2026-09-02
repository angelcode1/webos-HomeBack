import assert from 'node:assert/strict';
import test from 'node:test';

import {
	conditionFromWmoCode,
	extractStockWeather,
	extractWeatherLocation,
	WeatherService,
} from '../packages/service/src/weather.ts';

const NOW = Date.parse('2026-09-03T06:30:00+10:00');

test('WMO weather codes normalize to HomeBack condition icons', () => {
	assert.equal(conditionFromWmoCode(0), 'clear');
	assert.equal(conditionFromWmoCode(2), 'partly-cloudy');
	assert.equal(conditionFromWmoCode(3), 'cloudy');
	assert.equal(conditionFromWmoCode(45), 'fog');
	assert.equal(conditionFromWmoCode(61), 'rain');
	assert.equal(conditionFromWmoCode(82), 'heavy-rain');
	assert.equal(conditionFromWmoCode(75), 'snow');
	assert.equal(conditionFromWmoCode(95), 'storm');
	assert.equal(conditionFromWmoCode(999), 'unknown');
});

test('stock AccuWeather-shaped values are extracted without an external request', () => {
	const weather = extractStockWeather({
		values: [{
			currentConditions: {
				LocalObservationDateTime: '2026-09-03T06:25:00+10:00',
				WeatherText: 'Partly cloudy',
				WeatherIcon: 4,
				Temperature: {
					Metric: { Value: 23.4, Unit: 'C' },
					Imperial: { Value: 74, Unit: 'F' },
				},
			},
		}],
	}, NOW);

	assert.ok(weather);
	assert.equal(weather.temperatureC, 23.4);
	assert.equal(weather.condition, 'partly-cloudy');
	assert.equal(weather.observedAt, Date.parse('2026-09-03T06:25:00+10:00'));
	assert.equal(weather.source, 'webos-weather');
});

test('LG Weather Location Setting shape is recognized', () => {
	assert.deepEqual(
		extractWeatherLocation({
			returnValue: true,
			location: {
				locationKey: '24741',
				localizedName: 'Brisbane',
			},
		}),
		{ name: 'Brisbane' },
	);
});

test('WeatherService reuses stock weather and caches it', async () => {
	let lunaCalls = 0;
	let httpCalls = 0;
	const lunaCall = async <T extends Record<string, any>>(
		uri: string,
		params: Record<string, any> = {},
	): Promise<T> => {
		lunaCalls++;
		if (uri.includes('getAllAppPropertiesObj') && params.appId === 'com.webos.app.home') {
			return {
				returnValue: true,
				values: [{
					Temperature: { Metric: { Value: 21.8 } },
					WeatherText: 'Rain',
				}],
			} as T;
		}
		throw new Error('unavailable');
	};
	const jsonRequest = async (): Promise<unknown> => {
		httpCalls++;
		throw new Error('external weather should not be requested');
	};
	const service = new WeatherService(lunaCall, jsonRequest, () => NOW);

	const first = await service.current();
	const callsAfterFirst = lunaCalls;
	const second = await service.current();

	assert.equal(first?.temperatureC, 21.8);
	assert.equal(first?.condition, 'rain');
	assert.equal(first?.source, 'webos-weather');
	assert.deepEqual(second, first);
	assert.equal(lunaCalls, callsAfterFirst);
	assert.equal(httpCalls, 0);
});

test('WeatherService geocodes LG weather location before Open-Meteo fallback', async () => {
	const lunaCall = async <T extends Record<string, any>>(
		uri: string,
		params: Record<string, any> = {},
	): Promise<T> => {
		if (uri.includes('getAllAppPropertiesObj') && params.appId === 'com.webos.app.home') {
			return {
				returnValue: true,
				values: [{ location: { locationKey: '24741', localizedName: 'Brisbane' } }],
			} as T;
		}
		throw new Error('unavailable');
	};
	const requested: string[] = [];
	const jsonRequest = async (url: string): Promise<unknown> => {
		requested.push(url);
		if (url.includes('geocoding-api.open-meteo.com')) {
			return { results: [{ name: 'Brisbane', latitude: -27.47, longitude: 153.03 }] };
		}
		return { current: { temperature_2m: 24.6, weather_code: 61 } };
	};
	const service = new WeatherService(lunaCall, jsonRequest, () => NOW);

	const weather = await service.current();

	assert.equal(weather?.temperatureC, 24.6);
	assert.equal(weather?.condition, 'rain');
	assert.equal(weather?.location, 'Brisbane');
	assert.equal(weather?.source, 'webos-location-openmeteo');
	assert.equal(requested.length, 2);
	assert.match(requested[0], /name=Brisbane/);
	assert.match(requested[1], /latitude=-27\.47/);
});
