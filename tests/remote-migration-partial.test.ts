import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateDefaultRemoteShortcuts } from '../packages/service/src/remote-default-migration.lib.ts';

test('migration repairs HDMI3 independently when only key 1043 is in the known bad 0.4.16 state', () => {
	const config = {
		version: 1 as const,
		keys: {
			'1043': {
				label: 'LG Channels button',
				longPressMs: 900,
				short: { action: 'launch' as const, id: 'com.webos.app.hdmi4' },
				long: { action: 'replace' as const, keycode: 400 },
			},
			'1086': {
				label: 'Custom mapping',
				short: { action: 'launch' as const, id: 'youtube.leanback.v4' },
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
	assert.deepEqual(config.keys['1043'], {
		label: 'LG Channels button',
		longPressMs: 900,
		short: { action: 'launch', id: 'com.webos.app.hdmi3' },
		long: { action: 'replace', keycode: 399 },
	});
	assert.deepEqual(config.keys['1086'], {
		label: 'Custom mapping',
		short: { action: 'launch', id: 'youtube.leanback.v4' },
		long: { action: 'replace', keycode: 401 },
	});
});

test('migration preserves a genuinely customized HDMI3 shortcut', () => {
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
