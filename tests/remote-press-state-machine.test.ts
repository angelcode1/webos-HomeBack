import assert from 'node:assert/strict';
import test from 'node:test';

import type { RemoteActionRunner } from '../packages/service/src/remote-action-runner.ts';
import type { RemoteConfig, SemanticAction } from '../packages/service/src/remote-config.ts';
import { RemotePressStateMachine } from '../packages/service/src/remote-press-state-machine.ts';

const config: RemoteConfig = {
	version: 1,
	keys: {
		1042: {
			short: { action: 'launch', id: 'com.example.app' },
		},
	},
};

test('press state machine parses hook logs and fires short action on release', async () => {
	const calls: Array<{ action: SemanticAction; keycode: number; kind: string }> = [];
	const runner = {
		lastAction: null,
		execute: async (action: SemanticAction, keycode: number, kind: string) => {
			calls.push({ action, keycode, kind });
		},
	} as unknown as RemoteActionRunner;
	const state = new RemotePressStateMachine(() => config, runner);

	state.handleLogLine('noise that should be ignored');
	state.handleLogLine('lginput_uinput_send_button called: keyid=1, state=1 uinput_code=1042');
	state.handleLogLine('lginput_uinput_send_button called: keyid=1, state=0 uinput_code=1042');
	await Promise.resolve();

	assert.equal(calls.length, 1);
	assert.equal(calls[0].keycode, 1042);
	assert.equal(calls[0].kind, 'short');
	assert.deepEqual(calls[0].action, { action: 'launch', id: 'com.example.app' });
	assert.equal(state.activeKeys.length, 0);
	assert.equal(state.lastKeyEvent?.state, 0);
});
