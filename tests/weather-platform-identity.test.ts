import assert from 'node:assert/strict';
import test from 'node:test';

import {
	type StockWeatherCapability,
	type WeatherCapabilityStore,
	WeatherService,
} from '../packages/service/src/weather.ts';

const NOW = Date.parse('2026-09-03T07:35:00+10:00');

class MemoryCapabilityStore implements WeatherCapabilityStore {
	public value: StockWeatherCapability | null = null;
	public saves = 0;

	public async load(): Promise<unknown> {
		return this.value;
	}

	public async save(capability: StockWeatherCapability): Promise<void> {
		this.saves++;
		this.value = capability;
	}
}

test('unavailable TV platform identity keeps capability transient but does not break weather fallback', async () => {
	const store = new MemoryCapabilityStore();
	let stockProbeCalls = 0;
	const lunaCall = async <T extends Record<string, any>>(uri: string): Promise<T> => {
		if (uri.endsWith('/getSystemInfo')) throw new Error('Luna request timed out after 1500ms');
		if (uri.includes('/appProperties/')) {
			stockProbeCalls++;
			return { returnValue: true, values: [] } as T;
		}
		if (uri === 'luna://com.webos.service.location/getLocationUpdates') {
			return {
				returnValue: true,
				latitude: -27.47,
				longitude: 153.03,
				city: 'Brisbane',
			} as T;
		}
		throw new Error(`unexpected Luna call: ${uri}`);
	};
	const jsonRequest = async (): Promise<unknown> => ({
		current: { temperature_2m: 25.1, weather_code: 0 },
	});
	const service = new WeatherService(lunaCall, jsonRequest, () => NOW, store);

	await service.initialize();
	assert.ok(stockProbeCalls > 0, 'the current service session may still probe stock weather');
	assert.equal(store.saves, 0, 'unverified platform identity must never create persistent capability state');
	assert.equal(store.value, null);

	const weather = await service.current();
	assert.equal(weather?.temperatureC, 25.1);
	assert.equal(weather?.condition, 'clear');
	assert.equal(weather?.source, 'webos-location-openmeteo');
});
