import assert from 'node:assert/strict';
import test from 'node:test';

import {
	colourMicomKeycode,
	keypadMicomKeycode,
	moveNumericKeypadSelection,
	NUMERIC_REMOTE_KEY_INTERVAL_MS,
	numericMicomKeycode,
} from '../packages/app/src/features/ribbon/ui/numeric-keyboard-proxy/numeric-keyboard.lib.ts';

test('numeric keypad maps digits to LG remote keycodes', () => {
	assert.deepEqual(
		['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map(numericMicomKeycode),
		[0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19],
	);
});

test('multi-digit channel entry remains ordered remote-button emulation', () => {
	assert.deepEqual(['1', '2', '0'].map(numericMicomKeycode), [0x11, 0x12, 0x10]);
});

test('numeric keypad rejects non-digits', () => {
	for (const value of ['', '10', 'a', '-', '.']) assert.equal(numericMicomKeycode(value), null);
});

test('keypad colour row maps to LG remote colour-key IDs', () => {
	assert.deepEqual(
		['red', 'green', 'yellow', 'blue'].map(colourMicomKeycode),
		[0x72, 0x71, 0x63, 0x61],
	);
	assert.equal(colourMicomKeycode('purple'), null);
});

test('combined keypad mapping keeps numeric and colour keys on one send path', () => {
	assert.equal(keypadMicomKeycode('0'), 0x10);
	assert.equal(keypadMicomKeycode('1'), 0x11);
	assert.equal(keypadMicomKeycode('red'), 0x72);
	assert.equal(keypadMicomKeycode('green'), 0x71);
	assert.equal(keypadMicomKeycode('yellow'), 0x63);
	assert.equal(keypadMicomKeycode('blue'), 0x61);
	assert.equal(keypadMicomKeycode('purple' as never), null);
});

test('numeric remote presses have a small deterministic inter-key gap', () => {
	assert.equal(NUMERIC_REMOTE_KEY_INTERVAL_MS, 80);
});

test('custom keypad D-pad movement includes the four-button colour row below zero', () => {
	assert.equal(moveNumericKeypadSelection('1', 'right'), '2');
	assert.equal(moveNumericKeypadSelection('2', 'down'), '5');
	assert.equal(moveNumericKeypadSelection('8', 'down'), '0');
	assert.equal(moveNumericKeypadSelection('7', 'down'), '0');
	assert.equal(moveNumericKeypadSelection('9', 'down'), '0');
	assert.equal(moveNumericKeypadSelection('0', 'up'), '8');
	assert.equal(moveNumericKeypadSelection('0', 'down'), 'green');
	assert.equal(moveNumericKeypadSelection('green', 'left'), 'red');
	assert.equal(moveNumericKeypadSelection('green', 'right'), 'yellow');
	assert.equal(moveNumericKeypadSelection('yellow', 'right'), 'blue');
	assert.equal(moveNumericKeypadSelection('red', 'up'), '7');
	assert.equal(moveNumericKeypadSelection('green', 'up'), '0');
	assert.equal(moveNumericKeypadSelection('yellow', 'up'), '0');
	assert.equal(moveNumericKeypadSelection('blue', 'up'), '9');
});

