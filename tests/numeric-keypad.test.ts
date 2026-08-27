import assert from 'node:assert/strict';
import test from 'node:test';

import {
	isRemoteBackKey,
	NUMERIC_REMOTE_KEY_INTERVAL_MS,
	numericMicomKeycode,
	numericMicomKeycodes,
} from '../packages/app/src/features/ribbon/ui/numeric-keyboard-proxy/numeric-keyboard.lib.ts';

test('numeric keypad maps digits to LG remote keycodes', () => {
	assert.deepEqual(
		['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map(numericMicomKeycode),
		[11, 2, 3, 4, 5, 6, 7, 8, 9, 10],
	);
});

test('numeric keypad converts a multi-digit channel number into ordered remote presses', () => {
	assert.deepEqual(numericMicomKeycodes('120'), [2, 3, 11]);
	assert.deepEqual(numericMicomKeycodes('7x05'), [8, 11, 6]);
});

test('numeric keypad rejects non-digits', () => {
	for (const value of ['', '10', 'a', '-', '.']) assert.equal(numericMicomKeycode(value), null);
});

test('numeric remote presses have a small deterministic inter-key gap', () => {
	assert.equal(NUMERIC_REMOTE_KEY_INTERVAL_MS, 80);
});

test('physical Back is recognized for keypad dismissal without treating Backspace as Back', () => {
	assert.equal(isRemoteBackKey({ key: 'GoBack' }), true);
	assert.equal(isRemoteBackKey({ key: 'BrowserBack' }), true);
	assert.equal(isRemoteBackKey({ keyCode: 461 }), true);
	assert.equal(isRemoteBackKey({ which: 461 }), true);
	assert.equal(isRemoteBackKey({ key: 'Backspace', keyCode: 8 }), false);
});
