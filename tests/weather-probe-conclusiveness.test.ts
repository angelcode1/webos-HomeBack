import assert from 'node:assert/strict';
import test from 'node:test';

import {
	type StockWeatherCapability,
	type WeatherCapabilityStore,
	WeatherService,
} from '../packages/service/src/weather.ts';

const NOW = Date.parse('2026-09-03T07:35:00+10:00');
const PLATFORM = {
	returnValue: true,
	modelName: 'OLED55C5PSA',
	firmwareVersion: '33.20.10',
	sdkVersion: '25.0.0',
};

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

// A negative capability is cacheable only when every relevant service-root
// observation is conclusive; an unregistered root can still be an early-boot race.
test('a temporarily unregistered preference root blocks negative capability persistence', async () => {
	const store = new MemoryCapabilityStore();
	let palmCalls = 0;
	let webosCalls = 0;
	const lunaCall = async <T extends Record<string, any>>(uri: string): Promise<T> => {
		if (uri.endsWith('/getSystemInfo')) return PLATFORM as T;
		if (uri.startsWith('luna://com.palm.preferences/')) {
			palmCalls++;
			return { returnValue: true, values: [] } as T;
		}
		if (uri.startsWith('luna://com.webos.service.preferences/')) {
			webosCalls++;
			throw new Error('Service not registered');
		}
		throw new Error(`unexpected Luna call: ${uri}`);
	};

	const service = new WeatherService(lunaCall, async () => null, () => NOW, store);
	await service.initialize();

	assert.ok(palmCalls > 0);
	assert.ok(webosCalls > 0);
	assert.equal(store.saves, 0, 'a missing/unready candidate root must keep the negative verdict transient');
	assert.equal(store.value, null);
});

test('HomeBack version mismatch invalidates an otherwise matching platform capability', async () => {
	const store = new MemoryCapabilityStore();
	store.value = {
		schemaVersion: 2,
		appVersion: 'definitely-not-the-current-version',
		modelName: PLATFORM.modelName,
		firmwareVersion: PLATFORM.firmwareVersion,
		sdkVersion: PLATFORM.sdkVersion,
		checkedAt: NOW - 1_000,
		stockWeatherAvailable: false,
		weatherSource: null,
	};
	let probeCalls = 0;
	const lunaCall = async <T extends Record<string, any>>(uri: string): Promise<T> => {
		if (uri.endsWith('/getSystemInfo')) return PLATFORM as T;
		if (uri.includes('/appProperties/')) {
			probeCalls++;
			return { returnValue: true, values: [] } as T;
		}
		throw new Error(`unexpected Luna call: ${uri}`);
	};

	const service = new WeatherService(lunaCall, async () => null, () => NOW, store);
	await service.initialize();

	assert.ok(probeCalls > 0, 'HomeBack version mismatch must force a fresh capability probe');
	assert.equal(store.saves, 1);
	assert.notEqual(store.value?.appVersion, 'definitely-not-the-current-version');
});

test('explicit permission denial is a definitive negative and can be persisted', async () => {
	const store = new MemoryCapabilityStore();
	const lunaCall = async <T extends Record<string, any>>(uri: string): Promise<T> => {
		if (uri.endsWith('/getSystemInfo')) return PLATFORM as T;
		if (uri.includes('/appProperties/')) throw new Error('Permission denied');
		throw new Error(`unexpected Luna call: ${uri}`);
	};

	const service = new WeatherService(lunaCall, async () => null, () => NOW, store);
	await service.initialize();

	assert.equal(store.saves, 1);
	assert.equal(store.value?.stockWeatherAvailable, false);
	assert.equal(store.value?.weatherSource, null);
});
