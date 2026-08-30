import assert from 'node:assert/strict';
import {
	appendFileSync,
	closeSync,
	constants as fsConstants,
	ftruncateSync,
	mkdtempSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
	writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	EventLogTailer,
	MAX_LOG_BYTES,
} from '../packages/service/src/event-log-tailer.ts';

test('event log tailing remains pinned to the opened inode after pathname replacement', () => {
	const dir = mkdtempSync(join(tmpdir(), 'homeback-log-test-'));
	const logPath = join(dir, 'hook.log');
	const originalPath = join(dir, 'hook.original');
	const victimPath = join(dir, 'victim');
	writeFileSync(logPath, 'first\n', { mode: 0o600 });
	writeFileSync(victimPath, 'DO NOT TOUCH\n', { mode: 0o600 });

	const fd = openSync(logPath, fsConstants.O_RDWR | fsConstants.O_NOFOLLOW);
	const tailer = new EventLogTailer();
	const lines: string[] = [];
	try {
		tailer.add(logPath, fd, 0, true);
		assert.equal(tailer.poll(line => lines.push(line)), true);
		assert.deepEqual(lines, ['first']);

		// Simulate a path swap after the privileged O_NOFOLLOW open. The tailer
		// must continue using fd rather than following this new symlink.
		renameSync(logPath, originalPath);
		symlinkSync(victimPath, logPath);
		appendFileSync(originalPath, 'second\n');
		assert.equal(tailer.poll(line => lines.push(line)), true);
		assert.deepEqual(lines, ['first', 'second']);
		assert.equal(readFileSync(victimPath, 'utf8'), 'DO NOT TOUCH\n');

		// Force the opened inode over the rotation threshold. Repeated polls drain
		// the sparse file, then ftruncate(fd) must truncate only the original inode.
		ftruncateSync(fd, MAX_LOG_BYTES);
		writeSync(fd, Buffer.from('\n'), 0, 1, MAX_LOG_BYTES - 1);
		for (let index = 0; index < 12; index += 1) assert.equal(tailer.poll(() => undefined), true);
		assert.equal(statSync(originalPath).size, 0);
		assert.equal(readFileSync(victimPath, 'utf8'), 'DO NOT TOUCH\n');
	} finally {
		tailer.closeAll();
		// fd ownership is transferred to the tailer; close only if a test failure
		// happened before add().
		try { closeSync(fd); } catch { /* already closed */ }
		rmSync(dir, { recursive: true, force: true });
	}
});

test('oversized log truncation stays safe for an already-open append-mode hook writer', () => {
	const dir = mkdtempSync(join(tmpdir(), 'homeback-log-append-test-'));
	const logPath = join(dir, 'hook.log');
	writeFileSync(logPath, '', { mode: 0o600 });

	const readerFd = openSync(logPath, fsConstants.O_RDWR | fsConstants.O_NOFOLLOW);
	const writerFd = openSync(logPath, fsConstants.O_WRONLY | fsConstants.O_APPEND);
	const tailer = new EventLogTailer();
	try {
		ftruncateSync(readerFd, MAX_LOG_BYTES);
		tailer.add(logPath, readerFd, MAX_LOG_BYTES, true);
		assert.equal(tailer.poll(() => undefined), true);
		assert.equal(statSync(logPath).size, 0);

		writeSync(writerFd, Buffer.from('after-truncate\n'));
		assert.equal(readFileSync(logPath, 'utf8'), 'after-truncate\n');
	} finally {
		tailer.closeAll();
		closeSync(writerFd);
		try { closeSync(readerFd); } catch { /* already closed */ }
		rmSync(dir, { recursive: true, force: true });
	}
});

test('event log tailer reports a retained descriptor failure as unhealthy', () => {
	const dir = mkdtempSync(join(tmpdir(), 'homeback-log-health-test-'));
	const logPath = join(dir, 'hook.log');
	writeFileSync(logPath, '', { mode: 0o600 });

	const fd = openSync(logPath, fsConstants.O_RDWR | fsConstants.O_NOFOLLOW);
	const tailer = new EventLogTailer();
	try {
		tailer.add(logPath, fd, 0, true);
		closeSync(fd);
		assert.equal(tailer.poll(() => undefined), false);
	} finally {
		tailer.closeAll();
		rmSync(dir, { recursive: true, force: true });
	}
});
