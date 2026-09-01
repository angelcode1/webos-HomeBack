import assert from 'node:assert/strict';
import test from 'node:test';

import { parseProcStatIdentity } from '../packages/service/src/remote-process.ts';
import {
	ProcessScanner,
	type ProcFileSystem,
} from '../packages/service/src/remote-process-scanner.ts';

const statLine = (pid: number, name: string, startTime: string): string => {
	const fields = ['S', ...Array.from({ length: 18 }, () => '0'), startTime];
	return `${pid} (${name}) ${fields.join(' ')}`;
};

test('proc stat parser handles parenthesized names containing spaces and )', () => {
	assert.deepEqual(
		parseProcStatIdentity(statLine(42, 'lg input) worker', '12345')),
		{ name: 'lg input) worker', startTimeTicks: '12345' },
	);
});

test('process scanner detects a target after PID reuse from a non-target', async () => {
	const files = new Map<string, string>([
		['/proc/42/stat', statLine(42, 'bash', '100')],
		['/proc/42/maps', ''],
	]);
	const io: ProcFileSystem = {
		readdir: async () => ['42'],
		readFile: async path => {
			const value = files.get(path);
			if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
			return value;
		},
	};
	const scanner = new ProcessScanner(new Set(['lginput2']), '/opt/libinputhookpp.so', '/proc', io);

	assert.equal((await scanner.scan())?.size, 0);

	// Same PID, new process identity: a stale comm cache must not hide it.
	files.set('/proc/42/stat', statLine(42, 'lginput2', '200'));
	const targets = await scanner.scan();
	assert.equal(targets?.size, 1);
	assert.deepEqual(targets?.get(42), {
		pid: 42,
		name: 'lginput2',
		startTimeTicks: '200',
		mapsReadable: true,
		mappedHookPath: null,
	});
});
