import assert from 'node:assert/strict';
import test from 'node:test';

import {
	conditionFromWmoCode,
	extractStockWeather,
	extractWeatherLocation,
	type StockWeatherCapability,
	type WeatherCapabilityStore,
	WeatherService,
} from '../packages/service/src/weather.ts';

const NOW = Date.parse('2026-09-03T06:30:00+10:00');
const PLATFORM = {
	returnValue: true,
	modelName: 'OLED55C5PSA',
	firmwareVersion: '33.20.10',
	sdkVersion: '25.0.0',
};

class MemoryCapabilityStore implements WeatherCapabilityStore {
	public value: StockWeatherCapability | null = null;

	public async load(): Promise<unknown> {
		return this.value;
	}

	public async save(capability: StockWeatherCapability): Promise<void> {
		this.value = capability;
	}
}

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

test('WeatherService uses the selected stock source and caches the resulting snapshot', async () => {
	const store = new MemoryCapabilityStore();
	let stockReads = 0;
	let httpCalls = 0;
	const lunaCall = async <T extends Record<string, any>>(
		uri: string,
		params: Record<string, any> = {},
	): Promise<T> => {
		if (uri.endsWith('/getSystemInfo')) return PLATFORM as T;
		if (uri.includes('getAppProperty')) {
			return {
				returnValue: true,
				location: { locationKey: '24741', localizedName: 'Brisbane' },
			} as T;
		}
		if (uri.includes('getAllAppPropertiesObj')) {
			if (params.appId === 'com.webos.app.home') {
				stockReads++;
				return {
					returnValue: true,
					values: [{
						Temperature: { Metric: { Value: 21.8 } },
						WeatherText: 'Rain',
					}],
				} as T;
			}
			return { returnValue: true, values: [] } as T;
		}
		throw new Error(`unexpected Luna call: ${uri}`);
	};
	const jsonRequest = async (): Promise<unknown> => {
		httpCalls++;
		throw new Error('external weather should not be requested');
	};
	const service = new WeatherService(lunaCall, jsonRequest, () => NOW, store);

	await service.initialize();
	const readsAfterProbe = stockReads;
	const first = await service.current();
	const readsAfterRefresh = stockReads;
	const second = await service.current();

	assert.ok(readsAfterProbe >= 1);
	assert.equal(readsAfterRefresh, readsAfterProbe + 1, 'refresh should query the selected stock source once');
	assert.equal(stockReads, readsAfterRefresh, 'fresh weather cache should avoid another stock read');
	assert.equal(first?.temperatureC, 21.8);
	assert.equal(first?.condition, 'rain');
	assert.equal(first?.location, 'Brisbane');
	assert.equal(first?.source, 'webos-weather');
	assert.deepEqual(second, first);
	assert.equal(httpCalls, 0);
});
