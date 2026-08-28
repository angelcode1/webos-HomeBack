import assert from 'node:assert/strict';
import test from 'node:test';

import { micomKeycodeForUinput } from '../packages/service/src/micom-keycodes.ts';
import { isTimedReplaceKeycode } from '../packages/service/src/remote-config.ts';

test('timed replace translates Linux numeric keycodes to MICOM bytes', () => {
	assert.equal(micomKeycodeForUinput(11), 0x10); // KEY_0
	assert.equal(micomKeycodeForUinput(2), 0x11); // KEY_1
	assert.equal(micomKeycodeForUinput(8), 0x17); // KEY_7, not MICOM POWER
	assert.equal(micomKeycodeForUinput(10), 0x19); // KEY_9
});

test('timed replace translates Linux colour keycodes to MICOM bytes', () => {
	assert.equal(micomKeycodeForUinput(398), 0x72);
	assert.equal(micomKeycodeForUinput(399), 0x71);
	assert.equal(micomKeycodeForUinput(400), 0x63);
	assert.equal(micomKeycodeForUinput(401), 0x61);
});

test('unknown Linux keycodes are rejected rather than passed through', () => {
	assert.equal(micomKeycodeForUinput(0x7fffffff), null);
	assert.equal(micomKeycodeForUinput(9999), null);
});

test('timed replace validation stays in lockstep with the MICOM translator', () => {
	for (let keycode = 0; keycode <= 1200; keycode += 1) {
		assert.equal(
			isTimedReplaceKeycode(keycode),
			micomKeycodeForUinput(keycode) !== null,
			`translation/validation mismatch for uinput keycode ${keycode}`,
		);
	}
});
