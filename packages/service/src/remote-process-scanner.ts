import { promises as fs } from 'fs';
import { basename } from 'path';

import { findMappedLibraryPath } from './remote-input-ownership.ts';
import { parseProcStatIdentity, type ProcIdentity } from './remote-process.ts';

export type ProcTargetSnapshot = ProcIdentity & {
	pid: number;
	mapsReadable: boolean;
	mappedHookPath: string | null;
};

export type HookInspection = Pick<ProcTargetSnapshot, 'mapsReadable' | 'mappedHookPath'>;

export type ProcFileSystem = {
	readdir(path: string): Promise<string[]>;
	readFile(path: string, encoding: 'utf8'): Promise<string>;
};

const defaultProcFileSystem: ProcFileSystem = {
	readdir: path => fs.readdir(path),
	readFile: (path, encoding) => fs.readFile(path, encoding),
};

/**
 * Reads /proc/<pid>/stat on every scan so PID reuse can never preserve a stale
 * process name. The stat file carries both comm and starttime, replacing the
 * former comm + stat pair with one identity syscall per live PID.
 */
export class ProcessScanner {
	private readonly identityCache = new Map<number, ProcIdentity>();

	public constructor(
		private readonly targetNames: ReadonlySet<string>,
		private readonly hookLibraryPath: string,
		private readonly procRoot = '/proc',
		private readonly io: ProcFileSystem = defaultProcFileSystem,
	) {}

	public async scan(): Promise<Map<number, ProcTargetSnapshot> | null> {
		let entries: string[];
		try {
			entries = await this.io.readdir(this.procRoot);
		} catch (error) {
			console.error('Unable to scan /proc for remote input targets:', error);
			return null;
		}

		const targets = new Map<number, ProcTargetSnapshot>();
		const livePids = new Set<number>();
		for (const entry of entries) {
			if (!/^\d+$/.test(entry)) continue;
			const pid = Number(entry);
			livePids.add(pid);

			const identity = await this.readIdentity(pid);
			if (!identity) continue;
			this.identityCache.set(pid, identity);
			if (!this.targetNames.has(identity.name)) continue;

			const inspection = await this.inspectMappedHook(pid);
			targets.set(pid, { pid, ...identity, ...inspection });
		}

		for (const pid of [...this.identityCache.keys()]) {
			if (!livePids.has(pid)) this.identityCache.delete(pid);
		}
		return targets;
	}

	public async readIdentity(pid: number): Promise<ProcIdentity | null> {
		try {
			return parseProcStatIdentity(await this.io.readFile(`${this.procRoot}/${pid}/stat`, 'utf8'));
		} catch {
			return null;
		}
	}

	public async inspectMappedHook(pid: number): Promise<HookInspection> {
		try {
			const maps = await this.io.readFile(`${this.procRoot}/${pid}/maps`, 'utf8');
			return {
				mapsReadable: true,
				mappedHookPath: findMappedLibraryPath(maps, basename(this.hookLibraryPath)),
			};
		} catch {
			// Unreadable maps must never be interpreted as an unhooked process.
			return { mapsReadable: false, mappedHookPath: null };
		}
	}
}
