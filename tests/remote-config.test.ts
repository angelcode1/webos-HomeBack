import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
	buildNativeKeybinds,
	validateConfig,
} from '../packages/service/src/remote-config.ts';
import { migrateDefaultRemoteShortcuts } from '../packages/service/src/remote-default-migration.lib.ts';

const defaultsPath = path.resolve(
	process.cwd(),
	'packages/service/vendor/inputhook/remote-buttons.default.json',
);

test('bundled remote config validates', () => {
	const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));
	assert.equal(validateConfig(defaults), true);
});

test('timed mapping without short or long is rejected', () => {
	assert.equal(validateConfig({
		version: 1,
		keys: {
			773: { longPressMs: 650 },
		},
	}), false);
});

test('invalid keycodes and empty actions are rejected', () => {
	assert.equal(validateConfig({
		version: 1,
		keys: {
			773: { action: 'replace', keycode: 1.5 },
		},
	}), false);

	assert.equal(validateConfig({
		version: 1,
		keys: {
			773: { action: 'launch', id: '' },
		},
	}), false);
});

test('timed mappings become native ignore while pass is omitted', () => {
	const config = {
		version: 1 as const,
		keys: {
			'1': { short: { action: 'ignore' as const } },
			'2': { action: 'pass' as const },
			'3': { action: 'replace' as const, keycode: 4 },
		},
	};
	assert.deepEqual(buildNativeKeybinds(config), {
		'1': { action: 'ignore' },
		'3': { action: 'replace', keycode: 4 },
	});
});

test('timed replace rejects uinput codes that cannot be translated to MICOM', () => {
	assert.equal(validateConfig({
		version: 1,
		keys: {
			773: {
				short: { action: 'replace', keycode: 0x7fffffff },
			},
		},
	}), false);
});

test('top-level native replace retains the wider uinput keycode space', () => {
	assert.equal(validateConfig({
		version: 1,
		keys: {
			362: { action: 'replace', keycode: 1037 },
		},
	}), true);
});


test('bundled shortcut defaults use corrected labels and requested action pairs', () => {
	const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));
	assert.deepEqual(defaults.keys['1043'], {
		label: 'LG Channels button',
		short: { action: 'launch', id: 'com.webos.app.hdmi4' },
		long: { action: 'replace', keycode: 400 },
	});
	assert.deepEqual(defaults.keys['1086'], {
		label: 'Alexa button',
		short: { action: 'launch', id: 'cdp-30' },
		long: { action: 'replace', keycode: 401 },
	});
	assert.deepEqual(defaults.keys['1111'], {
		label: 'Model-specific button (observed keycode 1111)',
		short: { action: 'launch', id: 'com.webos.app.hdmi2' },
		long: { action: 'replace', keycode: 398 },
	});
});

test('default shortcut migration moves long press with short press and preserves custom entries', () => {
	const config = {
		version: 1 as const,
		keys: {
			'1043': {
				label: 'Custom physical label',
				longPressMs: 900,
				short: { action: 'launch' as const, id: 'com.webos.app.hdmi3' },
				long: { action: 'replace' as const, keycode: 399 },
			},
			'1086': {
				label: 'Custom mapping',
				short: { action: 'launch' as const, id: 'youtube.leanback.v4' },
				long: { action: 'replace' as const, keycode: 400 },
			},
			'1111': {
				label: 'Alexa button',
				short: { action: 'launch' as const, id: 'cdp-30' },
				long: { action: 'replace' as const, keycode: 401 },
			},
		},
	};

	assert.equal(migrateDefaultRemoteShortcuts(config), true);
	assert.deepEqual(config.keys['1043'], {
		label: 'Custom physical label',
		longPressMs: 900,
		short: { action: 'launch', id: 'com.webos.app.hdmi4' },
		long: { action: 'replace', keycode: 400 },
	});
	assert.deepEqual(config.keys['1086'], {
		label: 'Custom mapping',
		short: { action: 'launch', id: 'youtube.leanback.v4' },
		long: { action: 'replace', keycode: 400 },
	});
	assert.deepEqual(config.keys['1111'], {
		label: 'Model-specific button (observed keycode 1111)',
		short: { action: 'launch', id: 'com.webos.app.hdmi2' },
		long: { action: 'replace', keycode: 398 },
	});
});
