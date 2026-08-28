import assert from 'node:assert/strict';
import test from 'node:test';

import { CoalescedTask } from '../packages/service/src/coalesced-task.ts';

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
	let resolve!: () => void;
	const promise = new Promise<void>(done => {
		resolve = done;
	});
	return { promise, resolve };
};

const nextTurn = (): Promise<void> => new Promise(resolve => {
	setImmediate(resolve);
});

test('a request arriving mid-run waits for the rescan it requested', async () => {
	const firstGate = deferred();
	const secondGate = deferred();
	let calls = 0;

	const task = new CoalescedTask<void>(async () => {
		calls += 1;
		if (calls === 1) await firstGate.promise;
		if (calls === 2) await secondGate.promise;
	}, () => undefined);

	const first = task.request(undefined);
	await nextTurn();
	assert.equal(calls, 1);

	let secondResolved = false;
	const second = task.request(undefined).then(() => {
		secondResolved = true;
	});

	firstGate.resolve();
	await nextTurn();
	assert.equal(calls, 2);
	assert.equal(secondResolved, false);

	secondGate.resolve();
	await Promise.all([first, second]);
	assert.equal(calls, 2);
	assert.equal(secondResolved, true);
});

test('pending config reload requests merge force=true without overlapping writes', async () => {
	const firstGate = deferred();
	const secondGate = deferred();
	const forces: boolean[] = [];

	const task = new CoalescedTask<boolean>(async force => {
		forces.push(force);
		if (forces.length === 1) await firstGate.promise;
		if (forces.length === 2) await secondGate.promise;
	}, (current, incoming) => current || incoming);

	const first = task.request(false);
	await nextTurn();
	const second = task.request(false);
	const forced = task.request(true);

	firstGate.resolve();
	await nextTurn();
	assert.deepEqual(forces, [false, true]);

	secondGate.resolve();
	await Promise.all([first, second, forced]);
	assert.deepEqual(forces, [false, true]);
});
