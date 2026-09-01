import { spawn } from 'child_process';
import {
	closeSync,
	constants as fsConstants,
	fchmodSync,
	fsyncSync,
	mkdirSync,
	promises,
	renameSync,
	unlinkSync,
	writeFileSync,
	openSync,
} from 'fs';
import { dirname } from 'path';
import process from 'process';

class ProcessExitError extends Error {
	public constructor(
		public readonly command: string,
		public readonly code: number | null,
		public readonly signal: NodeJS.Signals | null,
	) {
		super(`${command} exited with ${code === null ? `signal ${String(signal)}` : `code ${code}`}`);
		Object.setPrototypeOf(this, ProcessExitError.prototype);
	}
}

const readFile = (path: string): Promise<string> =>
	promises.readFile(path, { encoding: 'utf8' });

export const writeFile = async (
	path: string,
	content: string,
	requestedMode?: number,
): Promise<void> => {
	const temporary = `${path}.homeback-tmp-${process.pid}-${Date.now()}`;
	let mode = requestedMode;

	if (mode === undefined) {
		try {
			mode = (await promises.stat(path)).mode & 0o777;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	}

	try {
		await promises.mkdir(dirname(path), { recursive: true });
		await promises.writeFile(temporary, content, { encoding: 'utf8', mode });
		if (mode !== undefined) await promises.chmod(temporary, mode);
		await promises.rename(temporary, path);
	} catch (error) {
		await promises.unlink(temporary).catch(() => undefined);
		throw error;
	}
};

/**
 * Synchronous counterpart used only by process-exit fail-safe paths. Write a
 * new inode opened with O_NOFOLLOW, fsync it, then atomically replace the
 * destination so the native hook never observes truncated JSON.
 */
export const writeFileAtomicSync = (
	path: string,
	content: string,
	mode: number,
): void => {
	const temporary = `${path}.homeback-tmp-${process.pid}-${Date.now()}`;
	let fd: number | null = null;
	try {
		mkdirSync(dirname(path), { recursive: true });
		fd = openSync(
			temporary,
			fsConstants.O_WRONLY |
				fsConstants.O_CREAT |
				fsConstants.O_EXCL |
				fsConstants.O_NOFOLLOW,
			mode,
		);
		fchmodSync(fd, mode);
		writeFileSync(fd, content, { encoding: 'utf8' });
		fsyncSync(fd);
		closeSync(fd);
		fd = null;
		renameSync(temporary, path);
	} catch (error) {
		if (fd !== null) {
			try { closeSync(fd); } catch { /* descriptor already closed */ }
		}
		try { unlinkSync(temporary); } catch { /* temporary file may not exist */ }
		throw error;
	}
};

export const readJson = async <T>(path: string): Promise<T> =>
	JSON.parse(await readFile(path)) as T;

export const writeJson = <T>(path: string, content: T, mode?: number): Promise<void> =>
	writeFile(path, `${JSON.stringify(content, null, '\t')}\n`, mode);

export const getUid = (): number =>
	typeof process.getuid === 'function' ? process.getuid() : -1;

const asyncSpawn = (bin: string, args: string[] = []): Promise<void> =>
	new Promise((resolve, reject) => {
		const child = spawn(bin, args, { stdio: 'inherit' });
		let settled = false;

		child.once('error', error => {
			if (settled) return;
			settled = true;
			reject(error);
		});

		child.once('close', (code, signal) => {
			if (settled) return;
			settled = true;
			if (code === 0) resolve();
			else reject(new ProcessExitError([bin, ...args].join(' '), code, signal));
		});
	});

export const rescanLunaManifests = (): Promise<void> =>
	asyncSpawn('ls-control', ['scan-services']);
