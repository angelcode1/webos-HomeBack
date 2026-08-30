import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
	moveWithinPersistedOrder,
	sanitizePersistedOrder,
} from '../packages/app/src/shared/services/launcher/model/launcher-order.lib.ts';

const read = (relativePath: string): string =>
	fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

test('settled provider error does not prune persisted launcher order', () => {
	const seededOrder = ['app.one', 'app.two', 'app.three'];

	// AppManagerProvider leaves launchPoints unchanged on returnValue:false. On a
	// first-message failure that means the settled launcher snapshot is empty.
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

test('launcher service never rebuilds persisted order from provider snapshots', () => {
	const launcher = read('packages/app/src/shared/services/launcher/model/launcher.service.ts');
	assert.match(launcher, /sanitizePersistedOrder\(value, this\.launchPoints\)/);
	assert.match(launcher, /moveWithinPersistedOrder\(/);
	assert.doesNotMatch(launcher, /validIds/);
	assert.doesNotMatch(launcher, /const pruned/);
	assert.doesNotMatch(launcher, /const ids = this\.visible/);
});
