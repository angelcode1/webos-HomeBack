import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LAUNCHER_PROVIDER_WARNING_GRACE_MS,
	LauncherProviderWarningGate,
} from '../packages/app/src/features/ribbon/services/ribbon/launcher-provider-warning.lib.ts';

test('transient launcher provider failures recover silently inside the grace period', t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const states: boolean[] = [];
	const gate = new LauncherProviderWarningGate(value => states.push(value));

	gate.update(1);
	t.mock.timers.tick(LAUNCHER_PROVIDER_WARNING_GRACE_MS - 1);
	assert.deepEqual(states, []);

	gate.update(0);
	t.mock.timers.tick(1);
	assert.deepEqual(states, []);
});

test('persistent launcher provider failure surfaces after grace and clears on recovery', t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const states: boolean[] = [];
	const gate = new LauncherProviderWarningGate(value => states.push(value));

	gate.update(1);
	t.mock.timers.tick(LAUNCHER_PROVIDER_WARNING_GRACE_MS);
	assert.deepEqual(states, [true]);

	gate.update(0);
	assert.deepEqual(states, [true, false]);
});
