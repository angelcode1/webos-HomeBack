import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
	buildNativeKeybinds,
	validateConfig,
} from '../packages/service/src/remote-config.ts';

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
