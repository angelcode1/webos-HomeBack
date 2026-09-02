import assert from 'node:assert/strict';
import test from 'node:test';

import {
	type StockWeatherCapability,
	WEATHER_CAPABILITY_PATH,
	type WeatherCapabilityStore,
	WeatherService,
} from '../packages/service/src/weather.ts';

const NOW = Date.parse('2026-09-03T07:35:00+10:00');
const PLATFORM = {
	modelName: 'OLED55C5PSA',
	firmwareVersion: '33.20.10',
	sdkVersion: '25.0.0',
};

class MemoryCapabilityStore implements WeatherCapabilityStore {
	public value: StockWeatherCapability | null = null;
	public loads = 0;
	public saves = 0;

	public async load(): Promise<unknown> {
		this.loads++;
		return this.value;
	}

	public async save(capability: StockWeatherCapability): Promise<void> {
		this.saves++;
		this.value = capability;
	}
}

const systemInfoResponse = <T extends Record<string, any>>(overrides: Record<string, unknown> = {}): T => ({
	returnValue: true,
	...PLATFORM,
	...overrides,
}) as T;

const storedNegative = (overrides: Partial<StockWeatherCapability> = {}): StockWeatherCapability => ({
	schemaVersion: 2,
	appVersion: process.env.APP_VERSION ?? 'unknown',
	modelName: PLATFORM.modelName,
	firmwareVersion: PLATFORM.firmwareVersion,
	sdkVersion: PLATFORM.sdkVersion,
	checkedAt: NOW - 10_000,
	stockWeatherAvailable: false,
	weatherSource: null,
	...overrides,
});

test('weather capability machine state is outside the hand-edited config directory', () => {
	assert.equal(WEATHER_CAPABILITY_PATH, '/var/lib/homeback/weather-capability.json');
	assert.equal(WEATHER_CAPABILITY_PATH.startsWith('/home/root/.config/homeback/'), false);
});

test('model, firmware, or SDK identity changes invalidate stored stock capability', async () => {
	const mismatches: Array<Partial<StockWeatherCapability>> = [
		{ modelName: 'OLED55C6PSA' },
		{ firmwareVersion: '34.00.00' },
		{ sdkVersion: '26.0.0' },
	];

	for (const mismatch of mismatches) {
		const store = new MemoryCapabilityStore();
		store.value = storedNegative(mismatch);
		let systemInfoCalls = 0;
		let stockProbeCalls = 0;
		const lunaCall = async <T extends Record<string, any>>(uri: string): Promise<T> => {
			if (uri.endsWith('/getSystemInfo')) {
				systemInfoCalls++;
				return systemInfoResponse<T>();
			}
			if (uri.includes('/appProperties/')) {
				stockProbeCalls++;
				return { returnValue: true, values: [] } as T;
			}
			throw new Error(`unexpected Luna call: ${uri}`);
		};

		const service = new WeatherService(lunaCall, async () => null, () => NOW, store);
		await service.initialize();

		assert.equal(systemInfoCalls, 1, 'startup must read current TV platform identity');
		assert.ok(stockProbeCalls > 0, 'platform mismatch must force a new capability probe');
		assert.equal(store.saves, 1, 'replacement capability should be persisted after a definitive probe');
		assert.equal(store.value?.modelName, PLATFORM.modelName);
		assert.equal(store.value?.firmwareVersion, PLATFORM.firmwareVersion);
		assert.equal(store.value?.sdkVersion, PLATFORM.sdkVersion);
	}
});

test('transient stock probe failure is inconclusive, is not persisted, and retries next launch', async () => {
	const store = new MemoryCapabilityStore();
	let systemInfoCalls = 0;
	let probeCalls = 0;
	const lunaCall = async <T extends Record<string, any>>(uri: string): Promise<T> => {
		if (uri.endsWith('/getSystemInfo')) {
			systemInfoCalls++;
			return systemInfoResponse<T>();
		}
		if (uri.includes('/appProperties/')) {
			probeCalls++;
			throw new Error('Luna request timed out after 1500ms');
		}
		throw new Error(`unexpected Luna call: ${uri}`);
	};

	const first = new WeatherService(lunaCall, async () => null, () => NOW, store);
	await first.initialize();

	assert.equal(systemInfoCalls, 1);
	assert.ok(probeCalls > 0);
	assert.equal(store.saves, 0, 'timeouts must never be frozen as stock-weather unavailable');
	assert.equal(store.value, null);

	const callsBeforeRetry = probeCalls;
	const second = new WeatherService(lunaCall, async () => null, () => NOW + 60_000, store);
	await second.initialize();
	assert.ok(probeCalls > callsBeforeRetry, 'an inconclusive probe must retry on the next service launch');
	assert.equal(store.saves, 0);
});

test('definitive stock absence is persisted and not re-probed on the same platform tuple', async () => {
	const store = new MemoryCapabilityStore();
	let stockProbeCalls = 0;
	const lunaCall = async <T extends Record<string, any>>(uri: string): Promise<T> => {
		if (uri.endsWith('/getSystemInfo')) return systemInfoResponse<T>();
		if (uri.includes('/appProperties/')) {
			stockProbeCalls++;
			return { returnValue: true, values: [] } as T;
		}
		throw new Error(`unexpected Luna call: ${uri}`);
	};

	const first = new WeatherService(lunaCall, async () => null, () => NOW, store);
	await first.initialize();
	const callsAfterFirst = stockProbeCalls;
	assert.ok(callsAfterFirst > 0);
	assert.equal(store.saves, 1);
	assert.equal(store.value?.stockWeatherAvailable, false);

	const second = new WeatherService(lunaCall, async () => null, () => NOW + 30 * 24 * 60 * 60 * 1000, store);
	await second.initialize();
	assert.equal(stockProbeCalls, callsAfterFirst, 'matching model/firmware/sdk/app tuple must reuse a definitive verdict');
	assert.equal(store.saves, 1);
});

test('Weather Location is read fresh after capability discovery', async () => {
	const store = new MemoryCapabilityStore();
	const firstLunaCall = async <T extends Record<string, any>>(uri: string): Promise<T> => {
		if (uri.endsWith('/getSystemInfo')) return systemInfoResponse<T>();
		if (uri.includes('getAllAppPropertiesObj')) {
			return {
				returnValue: true,
				values: [{ location: { locationKey: '24741', localizedName: 'Brisbane' } }],
			} as T;
		}
		throw new Error(`unexpected initial Luna call: ${uri}`);
	};
	const first = new WeatherService(firstLunaCall, async () => null, () => NOW, store);
	await first.initialize();
	assert.equal(store.value?.stockWeatherAvailable, false);

	const requested: string[] = [];
	let locationReads = 0;
	const secondLunaCall = async <T extends Record<string, any>>(uri: string): Promise<T> => {
		if (uri.endsWith('/getSystemInfo')) return systemInfoResponse<T>();
		if (uri.includes('getAppProperty')) {
			locationReads++;
			return {
				returnValue: true,
				location: { locationKey: '22889', localizedName: 'Sydney' },
			} as T;
		}
		if (uri === 'luna://com.webos.service.location/getLocationUpdates') {
			throw new Error('webOS location fallback should not be needed');
		}
		throw new Error(`unexpected refresh Luna call: ${uri}`);
	};
	const jsonRequest = async (url: string): Promise<unknown> => {
		requested.push(url);
		if (url.includes('geocoding-api.open-meteo.com')) {
			return { results: [{ name: 'Sydney', latitude: -33.87, longitude: 151.21 }] };
		}
		return { current: { temperature_2m: 19.4, weather_code: 2 } };
	};
	const second = new WeatherService(secondLunaCall, jsonRequest, () => NOW + 60_000, store);
	await second.initialize();
	const weather = await second.current();

	assert.ok(locationReads > 0, 'LG Weather Location must be read during refresh, not frozen in capability state');
	assert.match(requested[0] ?? '', /name=Sydney/);
	assert.equal(weather?.location, 'Sydney');
	assert.equal(weather?.temperatureC, 19.4);
});

test('stock-unavailable webOS 6-style TV produces an Open-Meteo snapshot from webOS location', async () => {
	const store = new MemoryCapabilityStore();
	const lunaCall = async <T extends Record<string, any>>(uri: string): Promise<T> => {
		if (uri.endsWith('/getSystemInfo')) return systemInfoResponse<T>({ sdkVersion: '6.0.0' });
		if (uri.includes('/appProperties/')) return { returnValue: true, values: [] } as T;
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
	const requested: string[] = [];
	const jsonRequest = async (url: string): Promise<unknown> => {
		requested.push(url);
		return { current: { temperature_2m: 26.3, weather_code: 1 } };
	};
	const service = new WeatherService(lunaCall, jsonRequest, () => NOW, store);

	await service.initialize();
	const weather = await service.current();

	assert.equal(store.value?.stockWeatherAvailable, false);
	assert.equal(weather?.temperatureC, 26.3);
	assert.equal(weather?.condition, 'partly-cloudy');
	assert.equal(weather?.source, 'webos-location-openmeteo');
	assert.match(requested[0] ?? '', /latitude=-27\.47/);
	assert.match(requested[0] ?? '', /longitude=153\.03/);
});
