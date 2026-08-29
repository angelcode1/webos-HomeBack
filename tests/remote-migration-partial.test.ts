import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { migrateDefaultRemoteShortcuts } from '../packages/service/src/remote-default-migration.lib.ts';

test('bundled remote defaults match the observed six-button layout', () => {
	const config = JSON.parse(
		readFileSync(
			new URL('../packages/service/vendor/inputhook/remote-buttons.default.json', import.meta.url),
			'utf8',
		),
	) as {
		keys: Record<string, {
			label?: string;
			short?: { id?: string };
			long?: { keycode?: number };
		}>;
	};

	assert.equal(config.keys['1038'].short?.id, 'com.webos.app.hdmi1');
	assert.equal(config.keys['1042'].short?.id, 'com.webos.app.hdmi1');
	assert.deepEqual(config.keys['1043'], {
		label: 'LG Channels button',
		short: { action: 'launch', id: 'com.webos.app.hdmi4' },
		long: { action: 'replace', keycode: 399 },
	});
	assert.deepEqual(config.keys['1086'], {
		label: 'Alexa button',
		short: { action: 'launch', id: 'cdp-30' },
		long: { action: 'replace', keycode: 400 },
	});
	assert.deepEqual(config.keys['1111'], {
		label: 'Stan button',
		short: { action: 'launch', id: 'com.webos.app.hdmi3' },
		long: { action: 'replace', keycode: 401 },
	});
});

test('migration repairs the 0.4.21 default shortcuts to the observed physical layout', () => {
	const config = {
		version: 1 as const,
		keys: {
			'1042': {
				label: 'Disney+ button',
				short: { action: 'launch' as const, id: 'com.webos.app.hdmi2' },
				long: { action: 'replace' as const, keycode: 398 },
			},
			'1043': {
				label: 'LG Channels button',
				longPressMs: 900,
				short: { action: 'launch' as const, id: 'com.webos.app.hdmi3' },
				long: { action: 'replace' as const, keycode: 399 },
			},
			'1086': {
				label: 'Alexa button',
				short: { action: 'launch' as const, id: 'com.webos.app.hdmi4' },
				long: { action: 'replace' as const, keycode: 400 },
			},
			'1111': {
				label: 'Model-specific button (observed keycode 1111)',
				short: { action: 'launch' as const, id: 'cdp-30' },
				long: { action: 'replace' as const, keycode: 401 },
			},
		},
	};

	assert.equal(migrateDefaultRemoteShortcuts(config), true);
	assert.equal(config.keys['1042'].short.id, 'com.webos.app.hdmi1');
	assert.deepEqual(config.keys['1043'], {
		label: 'LG Channels button',
		longPressMs: 900,
		short: { action: 'launch', id: 'com.webos.app.hdmi4' },
		long: { action: 'replace', keycode: 399 },
	});
	assert.deepEqual(config.keys['1086'], {
		label: 'Alexa button',
		short: { action: 'launch', id: 'cdp-30' },
		long: { action: 'replace', keycode: 400 },
	});
	assert.deepEqual(config.keys['1111'], {
		label: 'Stan button',
		short: { action: 'launch', id: 'com.webos.app.hdmi3' },
		long: { action: 'replace', keycode: 401 },
	});
});

test('migration repairs the known 0.4.16 rotation independently', () => {
	const config = {
		version: 1 as const,
		keys: {
			'1043': {
				label: 'LG Channels button',
				short: { action: 'launch' as const, id: 'com.webos.app.hdmi4' },
				long: { action: 'replace' as const, keycode: 400 },
			},
			'1086': {
				label: 'Alexa button',
				short: { action: 'launch' as const, id: 'cdp-30' },
				long: { action: 'replace' as const, keycode: 401 },
			},
			'1111': {
				label: 'Model-specific button (observed keycode 1111)',
				short: { action: 'launch' as const, id: 'com.webos.app.hdmi2' },
				long: { action: 'replace' as const, keycode: 398 },
			},
		},
	};

	assert.equal(migrateDefaultRemoteShortcuts(config), true);
	assert.equal(config.keys['1043'].short.id, 'com.webos.app.hdmi4');
	assert.equal(config.keys['1043'].long.keycode, 399);
	assert.equal(config.keys['1086'].short.id, 'cdp-30');
	assert.equal(config.keys['1086'].long.keycode, 400);
	assert.deepEqual(config.keys['1111'], {
		label: 'Stan button',
		short: { action: 'launch', id: 'com.webos.app.hdmi3' },
		long: { action: 'replace', keycode: 401 },
	});
});

test('migration preserves genuinely customized shortcuts', () => {
	const config = {
		version: 1 as const,
		keys: {
			'1043': {
				label: 'My HDMI shortcut',
				short: { action: 'launch' as const, id: 'com.webos.app.hdmi4' },
				long: { action: 'replace' as const, keycode: 400 },
			},
		},
	};
	const before = structuredClone(config);

	assert.equal(migrateDefaultRemoteShortcuts(config), false);
	assert.deepEqual(config, before);
});
