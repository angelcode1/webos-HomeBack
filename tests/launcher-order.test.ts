import assert from 'node:assert/strict';
import test from 'node:test';

import {
	moveWithinPersistedOrder,
	sanitizePersistedOrder,
} from '../packages/app/src/shared/services/launcher/model/launcher-order.lib.ts';

test('settled provider error does not prune persisted launcher order', () => {
	const seededOrder = ['app.one', 'app.two', 'app.three'];
	assert.deepEqual(sanitizePersistedOrder(seededOrder, []), seededOrder);
});

test('persisted launcher order excludes only known builtins and deduplicates ids', () => {
	assert.deepEqual(
		sanitizePersistedOrder(
			['app.one', '@button:inputs', 'temporarily-missing', 'app.one'],
			[
				{ launchPointId: 'app.one', builtin: false },
				{ launchPointId: '@button:inputs', builtin: true },
			],
		),
		['app.one', 'temporarily-missing'],
	);
});

test('moving visible launch points preserves transiently missing persisted ids', () => {
	assert.deepEqual(
		moveWithinPersistedOrder(
			['app.one', 'temporarily-missing', 'app.two', 'app.three'],
			['app.one', 'app.two', 'app.three'],
			'app.one',
			1,
		),
		['app.two', 'temporarily-missing', 'app.one', 'app.three'],
	);
});
