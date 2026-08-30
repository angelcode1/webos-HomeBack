import {
	closeSync,
	fstatSync,
	ftruncateSync,
	readSync,
} from 'fs';

export const MAX_LOG_READ = 256 * 1024;
export const MAX_LOG_BYTES = 2 * 1024 * 1024;

export type EventLogCursor = {
	path: string;
	fd: number;
	offset: number;
	carry: string;
	truncateWhenComplete: boolean;
};

/**
 * Tails already-open log descriptors.
 *
 * Keeping the descriptor for the lifetime of a cursor is intentional: /tmp is
 * world-writable, so reopening by pathname after creation would reintroduce a
 * symlink TOCTOU window. Reads, stat and truncation all operate on the same
 * inode that was opened with O_NOFOLLOW by the caller.
 */
export class EventLogTailer {
	private readonly cursors = new Map<string, EventLogCursor>();
	private readonly readBuffer = Buffer.allocUnsafe(MAX_LOG_READ);

	public get size(): number {
		return this.cursors.size;
	}

	public has(path: string): boolean {
		return this.cursors.has(path);
	}

	public add(
		path: string,
		fd: number,
		offset = 0,
		truncateWhenComplete = false,
	): void {
		this.remove(path);
		this.cursors.set(path, {
			path,
			fd,
			offset,
			carry: '',
			truncateWhenComplete,
		});
	}

	public remove(path: string): void {
		const cursor = this.cursors.get(path);
		if (!cursor) return;
		this.cursors.delete(path);
		try {
			closeSync(cursor.fd);
		} catch {
			// Descriptor may already have been closed during process teardown.
		}
	}

	public removeWhere(predicate: (cursor: EventLogCursor) => boolean): void {
		for (const cursor of [...this.cursors.values()]) {
			if (predicate(cursor)) this.remove(cursor.path);
		}
	}

	public closeAll(): void {
		for (const path of [...this.cursors.keys()]) this.remove(path);
	}

	/**
	 * Returns false if any retained cursor cannot be read safely. Callers that
	 * depend on the log to recreate a natively-consumed key can then fail open.
	 */
	public poll(onLine: (line: string) => void): boolean {
		let healthy = true;
		for (const cursor of this.cursors.values()) {
			try {
				const stat = fstatSync(cursor.fd);
				if (stat.size < cursor.offset) {
					cursor.offset = 0;
					cursor.carry = '';
				}

				if (stat.size > cursor.offset) {
					const length = Math.min(stat.size - cursor.offset, this.readBuffer.length);
					const bytesRead = readSync(
						cursor.fd,
						this.readBuffer,
						0,
						length,
						cursor.offset,
					);
					if (bytesRead > 0) {
						cursor.offset += bytesRead;
						const text = cursor.carry + this.readBuffer.subarray(0, bytesRead).toString('utf8');
						const lines = text.split(/\r?\n/);
						cursor.carry = lines.pop() ?? '';
						for (const line of lines) onLine(line);
					}
				}

				this.rotateIfNeeded(cursor, stat.size);
			} catch (error) {
				healthy = false;
				const code = (error as NodeJS.ErrnoException).code;
				if (code !== 'EBADF') console.error(`Failed reading ${cursor.path}:`, error);
			}
		}
		return healthy;
	}

	private rotateIfNeeded(cursor: EventLogCursor, knownSize: number): void {
		if (
			!cursor.truncateWhenComplete ||
			knownSize < MAX_LOG_BYTES ||
			cursor.offset < knownSize ||
			cursor.carry.length > 0
		) return;

		try {
			ftruncateSync(cursor.fd, 0);
			cursor.offset = 0;
		} catch (error) {
			console.warn(`Unable to truncate oversized remote-input log ${cursor.path}:`, error);
		}
	}
}
