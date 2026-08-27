import { spawn } from 'child_process';
import { promises } from 'fs';
import { dirname } from 'path';
import process from 'process';

export class ProcessExitError extends Error {
	public constructor(
		public readonly command: string,
		public readonly code: number | null,
		public readonly signal: NodeJS.Signals | null,
	) {
		super(`${command} exited with ${code === null ? `signal ${String(signal)}` : `code ${code}`}`);
		Object.setPrototypeOf(this, ProcessExitError.prototype);
	}
}

export const readFile = (path: string): Promise<string> =>
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

export const readJson = async <T>(path: string): Promise<T> =>
	JSON.parse(await readFile(path)) as T;

export const writeJson = <T>(path: string, content: T, mode?: number): Promise<void> =>
	writeFile(path, `${JSON.stringify(content, null, '\t')}\n`, mode);

export const getUid = (): number =>
	typeof process.getuid === 'function' ? process.getuid() : -1;

export const asyncSpawn = (bin: string, args: string[] = []): Promise<void> =>
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
