import { spawn } from 'child_process';
import {
	closeSync,
	constants as fsConstants,
	existsSync,
	openSync,
	promises as fs,
	readSync,
	statSync,
	truncateSync,
} from 'fs';
import { basename, dirname, join } from 'path';

import type { Service } from './bus';
import { APP_ID, SERVICE_ID, SERVICE_ROOT_DIR } from './environment';
import {
	buildNativeKeybinds,
	isTimedMapping,
	type RemoteConfig,
	type RemoteMapping,
	type SemanticAction,
	type TimedMapping,
	validateConfig,
} from './remote-config';
import {
	BLOCKED_RECHECK_MS,
	ESSENTIAL_TARGET_NAMES,
	injectionRetryDelayMs,
	MAX_INJECTION_FAILURES,
} from './remote-input-lifecycle';
import {
	findMappedLibraryPath,
	hasVerifiedNativeOwnership,
	isHomeBackMappedLibraryPath,
	normalizeMappedLibraryPath,
} from './remote-input-ownership';
import { writeFile } from './utils';

const HOME_BACK_CONFIG_DIR = '/home/root/.config/homeback';
export const REMOTE_CONFIG_PATH = `${HOME_BACK_CONFIG_DIR}/remote-buttons.json`;
const NATIVE_CONFIG_PATH = '/home/root/.config/lginputhook/keybinds.json';
const DEFAULT_CONFIG_PATH = join(SERVICE_ROOT_DIR, 'inputhook', 'remote-buttons.default.json');
const EZINJECT_PATH = join(SERVICE_ROOT_DIR, 'inputhook', 'ezinject');
const INPUTHOOK_LIBRARY_PATH = join(SERVICE_ROOT_DIR, 'inputhook', 'libinputhookpp.so');

// @invariant: essential-native-ownership
const TARGET_NAMES = new Set(['RELEASE', ...ESSENTIAL_TARGET_NAMES, 'tvservice', 'testapp']);
const LEGACY_SERVICE_ID = 'org.webosbrew.inputhook.service';
const LEGACY_SERVICE_DIRS = [
	'/media/developer/apps/usr/palm/services/org.webosbrew.inputhook.service',
	'/media/cryptofs/apps/usr/palm/services/org.webosbrew.inputhook.service',
];

const LOG_POLL_MS = 80;
const PROCESS_SCAN_MS = 2_000;
const CONFIG_SCAN_MS = 1_000;
const DEFAULT_LONG_PRESS_MS = 650;
const MAX_LOG_READ = 256 * 1024;
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const ACTION_COOLDOWN_MS = 150;
const MAX_STUCK_PRESS_GRACE_MS = 5_000;
const INJECTION_VERIFY_DELAY_MS = 150;
const INJECTION_VERIFY_ATTEMPTS = 10;

type ActivePress = {
	mapping: TimedMapping;
	longFired: boolean;
	longTimer: NodeJS.Timeout | null;
	watchdogTimer: NodeJS.Timeout | null;
};


type LastRemoteKeyEvent = {
	keycode: number;
	state: number;
	atMs: number;
};

type LastRemoteAction = {
	keycode: number;
	kind: 'short' | 'long';
	action: SemanticAction['action'];
	startedAtMs: number;
	completedAtMs: number | null;
	outcome: 'pending' | 'ok' | 'error';
	error?: string;
};

type LogCursor = {
	path: string;
	offset: number;
	carry: string;
};

type TargetSource = 'injected' | 'adopted';

type InjectedTarget = {
	pid: number;
	name: string;
	logPath: string;
	injectorLogPath: string;
	hookPath: string;
	state: 'injecting' | 'active';
	source: TargetSource;
};

type BlockedHookReason =
	| 'foreign-hook'
	| 'homeback-log-missing'
	| 'injection-failed'
	| 'proc-maps-unreadable';

type BlockedHook = {
	pid: number;
	name: string;
	hookPath: string;
	reason: BlockedHookReason;
	recovery: string;
	failures?: number;
	firstBlockedAt: number;
	lastCheckedAt: number;
	nextRecheckAt: number;
};

type InjectionFailure = {
	name: string;
	failures: number;
	nextAttemptAt: number;
	lastError: string;
};

type ProcTargetSnapshot = {
	pid: number;
	name: string;
	mapsReadable: boolean;
	mappedHookPath: string | null;
};

type HookInspection = Pick<ProcTargetSnapshot, 'mapsReadable' | 'mappedHookPath'>;

const serializeNativeConfig = (config: RemoteConfig): string =>
	`${JSON.stringify(buildNativeKeybinds(config), null, '\t')}\n`;

const actionThreshold = (mapping: TimedMapping, config: RemoteConfig): number =>
	mapping.longPressMs ?? config.defaultLongPressMs ?? DEFAULT_LONG_PRESS_MS;

// @invariant: nofollow-log-permissions
const createFreshLogFile = async (path: string): Promise<void> => {
	const handle = await fs.open(
		path,
		fsConstants.O_WRONLY |
			fsConstants.O_CREAT |
			fsConstants.O_TRUNC |
			fsConstants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.chmod(0o600);
	} finally {
		await handle.close();
	}
};

export class RemoteInputManager {
	private config: RemoteConfig = { version: 1, defaultLongPressMs: DEFAULT_LONG_PRESS_MS, keys: {} };
	private configMtime = 0;
	private rejectedConfigMtime = 0;
	private started = false;
	private readonly targets = new Map<number, InjectedTarget>();
	private readonly blockedHooks = new Map<number, BlockedHook>();
	private readonly injectionFailures = new Map<number, InjectionFailure>();
	private readonly lastObservedTargets = new Map<number, ProcTargetSnapshot>();
	private readonly legacyPids = new Set<number>();
	private legacyMode = false;
	private readonly logs = new Map<string, LogCursor>();
	private readonly activePresses = new Map<number, ActivePress>();
	private readonly lastActionAt = new Map<number, number>();
	private lastKeyEvent: LastRemoteKeyEvent | null = null;
	private lastAction: LastRemoteAction | null = null;
	private logTimer: NodeJS.Timeout | null = null;
	private processTimer: NodeJS.Timeout | null = null;
	private configTimer: NodeJS.Timeout | null = null;
	private startPromise: Promise<void> | null = null;
	private scanPromise: Promise<void> | null = null;
	private rescanRequested = false;

	public constructor(private readonly service: Service) {}

	public async start(): Promise<void> {
		if (this.started) {
			await this.scanProcesses();
			return;
		}

		if (this.startPromise) {
			await this.startPromise;
			await this.scanProcesses();
			return;
		}

		this.startPromise = this.startOnce();
		try {
			await this.startPromise;
		} finally {
			this.startPromise = null;
		}
	}

	public status(): Record<string, unknown> {
		const mappedLegacyPids = [...this.blockedHooks.values()]
			.filter(target => target.hookPath.includes(`/${LEGACY_SERVICE_ID}/`))
			.map(target => target.pid);
		const legacyPids = [...new Set([...this.legacyPids, ...mappedLegacyPids])];

		return {
			started: this.started,
			configPath: REMOTE_CONFIG_PATH,
			nativeConfigPath: NATIVE_CONFIG_PATH,
			injected: [...this.targets.values()]
				.filter(target => target.state === 'active')
				.map(({ pid, name, source }) => ({ pid, name, source })),
			injecting: [...this.targets.values()]
				.filter(target => target.state === 'injecting')
				.map(({ pid, name }) => ({ pid, name })),
			blockedHooks: [...this.blockedHooks.values()],
			retrying: [...this.injectionFailures.entries()].map(([pid, failure]) => ({
				pid,
				name: failure.name,
				failures: failure.failures,
				nextAttemptAt: failure.nextAttemptAt,
				lastError: failure.lastError,
			})),
			nativeOwnershipVerified: this.isNativeOwnershipVerified(),
			activeKeys: [...this.activePresses.keys()],
			legacyInputHookDetected: this.legacyMode || mappedLegacyPids.length > 0,
			legacyPids,
			lastKeyEvent: this.lastKeyEvent,
			lastAction: this.lastAction,
			logCursorCount: this.logs.size,
		};
	}

	private isNativeOwnershipVerified(): boolean {
		return hasVerifiedNativeOwnership(
			this.started,
			this.legacyMode,
			ESSENTIAL_TARGET_NAMES,
			[...this.lastObservedTargets.values()].map(({ pid, name }) => ({ pid, name })),
			[...this.targets.values()].map(({ pid, name, state }) => ({ pid, name, state })),
			[...this.blockedHooks.values()].map(({ pid, name }) => ({ pid, name })),
		);
	}

	private async startOnce(): Promise<void> {
		await this.ensureConfigFiles();
		await this.reloadConfig(true);
		await fs.chmod(EZINJECT_PATH, 0o755);
		await this.scanProcesses();

		this.started = true;
		this.logTimer = setInterval(() => this.pollLogs(), LOG_POLL_MS);
		this.processTimer = setInterval(() => {
			void this.scanProcesses();
		}, PROCESS_SCAN_MS);
		this.configTimer = setInterval(() => {
			void this.reloadConfig(false);
		}, CONFIG_SCAN_MS);
	}

	private async ensureConfigFiles(): Promise<void> {
		await fs.mkdir(HOME_BACK_CONFIG_DIR, { recursive: true, mode: 0o700 });
		await fs.chmod(HOME_BACK_CONFIG_DIR, 0o700);
		await fs.mkdir(dirname(NATIVE_CONFIG_PATH), { recursive: true });

		if (!existsSync(REMOTE_CONFIG_PATH)) {
			const defaultsRaw = JSON.parse(await fs.readFile(DEFAULT_CONFIG_PATH, 'utf8')) as unknown;
			if (!validateConfig(defaultsRaw)) throw new Error('Bundled remote-buttons.default.json is invalid.');

			let merged = defaultsRaw;
			try {
				const legacyRaw = JSON.parse(await fs.readFile(NATIVE_CONFIG_PATH, 'utf8')) as unknown;
				if (legacyRaw && typeof legacyRaw === 'object' && !Array.isArray(legacyRaw)) {
					const candidate: RemoteConfig = {
						...defaultsRaw,
						keys: {
							...(legacyRaw as Record<string, RemoteMapping>),
							...defaultsRaw.keys,
						},
					};
					if (validateConfig(candidate)) {
						merged = candidate;
					} else {
						console.warn('Ignoring invalid legacy LG Input Hook mappings during HomeBack migration.');
					}
				}
			} catch {
				// No legacy mapping to migrate.
			}

			await writeFile(REMOTE_CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`, 0o600);
		}

		const remoteStat = await fs.lstat(REMOTE_CONFIG_PATH);
		if (!remoteStat.isFile() || remoteStat.isSymbolicLink()) {
			throw new Error(`${REMOTE_CONFIG_PATH} must be a regular file, not a symlink.`);
		}
		await fs.chmod(REMOTE_CONFIG_PATH, 0o600);

		if (!existsSync(NATIVE_CONFIG_PATH)) await writeFile(NATIVE_CONFIG_PATH, '{}\n', 0o644);
	}

	private async reloadConfig(force: boolean): Promise<void> {
		let stat;
		try {
			stat = await fs.lstat(REMOTE_CONFIG_PATH);
		} catch (error) {
			if (force) throw error;
			console.error('Unable to stat remote mapping config:', error);
			return;
		}

		if (!stat.isFile() || stat.isSymbolicLink()) {
			const error = new Error(`${REMOTE_CONFIG_PATH} must be a regular file, not a symlink.`);
			if (force) throw error;
			if (stat.mtimeMs !== this.rejectedConfigMtime) console.error(error.message);
			this.rejectedConfigMtime = stat.mtimeMs;
			return;
		}

		if (!force && (stat.mtimeMs === this.configMtime || stat.mtimeMs === this.rejectedConfigMtime)) return;

		try {
			const parsed = JSON.parse(await fs.readFile(REMOTE_CONFIG_PATH, 'utf8')) as unknown;
			if (!validateConfig(parsed)) throw new Error('Invalid remote-buttons.json schema');

			const serialized = serializeNativeConfig(parsed);
			let current = '';
			try {
				current = await fs.readFile(NATIVE_CONFIG_PATH, 'utf8');
			} catch {
				// Write below.
			}
			if (current !== serialized) await writeFile(NATIVE_CONFIG_PATH, serialized, 0o644);

			this.config = parsed;
			this.configMtime = stat.mtimeMs;
			this.rejectedConfigMtime = 0;
			console.log(`Loaded remote button mappings from ${REMOTE_CONFIG_PATH}`);
		} catch (error) {
			this.rejectedConfigMtime = stat.mtimeMs;
			if (force) throw error;
			console.error('Failed to reload remote button mappings; keeping previous mappings:', error);
		}
	}

	// @invariant: single-proc-snapshot
	private async scanTargetProcesses(): Promise<Map<number, ProcTargetSnapshot> | null> {
		const targets = new Map<number, ProcTargetSnapshot>();
		let entries: string[];
		try {
			entries = await fs.readdir('/proc');
		} catch (error) {
			console.error('Unable to scan /proc for remote input targets:', error);
			return null;
		}

		for (const entry of entries) {
			if (!/^\d+$/.test(entry)) continue;
			const pid = Number(entry);
			let name: string;
			try {
				name = (await fs.readFile(`/proc/${entry}/comm`, 'utf8')).trim();
			} catch {
				continue;
			}
			if (!TARGET_NAMES.has(name)) continue;

			const inspection = await this.inspectMappedHook(pid);
			targets.set(pid, {
				pid,
				name,
				...inspection,
			});
		}

		return targets;
	}

	private async detectLiveLegacyInputHook(
		procTargets: ReadonlyMap<number, ProcTargetSnapshot>,
	): Promise<boolean> {
		this.legacyPids.clear();
		const legacyInstallPresent =
			existsSync('/tmp/inputhook') && LEGACY_SERVICE_DIRS.some(path => existsSync(path));

		for (const target of procTargets.values()) {
			if (target.mapsReadable && target.mappedHookPath) {
				if (await this.isHomeBackHookPath(target.mappedHookPath)) continue;
				if (target.mappedHookPath.includes(`/${LEGACY_SERVICE_ID}/`)) this.legacyPids.add(target.pid);
				continue;
			}

			if (legacyInstallPresent && existsSync(`/tmp/lginput-hook-${target.name}.log`)) {
				this.legacyPids.add(target.pid);
			}
		}

		return this.legacyPids.size > 0;
	}

	private attachLegacyLogs(): void {
		if (!this.legacyMode) return;

		for (const name of TARGET_NAMES) {
			const path = `/tmp/lginput-hook-${name}.log`;
			if (!existsSync(path) || this.logs.has(path)) continue;

			let offset = 0;
			try {
				offset = statSync(path).size;
			} catch {
				// Start from zero.
			}
			this.logs.set(path, { path, offset, carry: '' });
			console.log(`Using existing LG Input Hook event log for ${name}`);
		}
	}

	private detachLegacyLogs(): void {
		for (const path of [...this.logs.keys()]) {
			if (path.startsWith('/tmp/lginput-hook-')) this.logs.delete(path);
		}
	}

	private async reconcileLegacyMode(
		procTargets: ReadonlyMap<number, ProcTargetSnapshot>,
	): Promise<boolean> {
		const legacyDetected = await this.detectLiveLegacyInputHook(procTargets);

		if (this.legacyMode) {
			if (legacyDetected) {
				this.attachLegacyLogs();
				return true;
			}

			this.legacyMode = false;
			this.legacyPids.clear();
			this.detachLegacyLogs();
			console.log('Standalone LG Input Hook no longer detected; HomeBack is taking remote-input ownership.');
			return false;
		}

		if (legacyDetected && this.targets.size === 0) {
			this.legacyMode = true;
			this.attachLegacyLogs();
			console.log('Standalone LG Input Hook detected; HomeBack will defer injection until it disappears.');
			return true;
		}

		return false;
	}

	private async scanProcesses(): Promise<void> {
		if (this.scanPromise) {
			this.rescanRequested = true;
			await this.scanPromise;
			return;
		}

		do {
			this.rescanRequested = false;
			this.scanPromise = this.scanProcessesOnce();
			try {
				await this.scanPromise;
			} finally {
				this.scanPromise = null;
			}
		} while (this.rescanRequested);
	}

	private async scanProcessesOnce(): Promise<void> {
		this.sweepActivePresses();
		const procTargets = await this.scanTargetProcesses();
		if (!procTargets) return;
		this.lastObservedTargets.clear();
		for (const [pid, target] of procTargets) this.lastObservedTargets.set(pid, target);

		const live = new Set(procTargets.keys());
		await this.pruneDeadProcessState(live);
		if (await this.reconcileLegacyMode(procTargets)) return;

		const now = Date.now();
		for (const target of procTargets.values()) {
			if (this.targets.has(target.pid)) continue;

			const blocked = this.blockedHooks.get(target.pid);
			if (blocked) {
				if (now >= blocked.nextRecheckAt) await this.recheckBlockedTarget(target, blocked);
				continue;
			}

			const failure = this.injectionFailures.get(target.pid);
			if (failure && now < failure.nextAttemptAt) continue;
			await this.reconcileTarget(target);
		}
	}

	private async pruneDeadProcessState(live: ReadonlySet<number>): Promise<void> {
		for (const pid of [...this.targets.keys()]) {
			if (!live.has(pid)) await this.cleanupTarget(pid);
		}
		for (const pid of [...this.blockedHooks.keys()]) {
			if (!live.has(pid)) this.blockedHooks.delete(pid);
		}
		for (const pid of [...this.injectionFailures.keys()]) {
			if (!live.has(pid)) this.injectionFailures.delete(pid);
		}
	}

	private async reconcileTarget(target: ProcTargetSnapshot): Promise<void> {
		if (!target.mapsReadable) {
			const changed = this.blockTarget(
				target.pid,
				target.name,
				'',
				'proc-maps-unreadable',
				'HomeBack could not inspect /proc/<pid>/maps safely. It will retry automatically; do not force reinjection.',
			);
			if (changed) {
				console.warn(
					`Deferring remote-hook reconciliation for ${target.name} (${target.pid}): /proc maps could not be read.`,
				);
			}
			return;
		}

		if (target.mappedHookPath) {
			await this.handleMappedHook(target.pid, target.name, target.mappedHookPath);
			return;
		}

		await this.inject(target.pid, target.name);
	}

	// @invariant: blocked-target-recheck
	private async recheckBlockedTarget(target: ProcTargetSnapshot, blocked: BlockedHook): Promise<void> {
		blocked.lastCheckedAt = Date.now();
		blocked.nextRecheckAt = blocked.lastCheckedAt + BLOCKED_RECHECK_MS;

		if (!target.mapsReadable) return;

		if (target.mappedHookPath) {
			await this.handleMappedHook(target.pid, target.name, target.mappedHookPath);
			return;
		}

		if (blocked.reason === 'injection-failed') {
			// Automatic injection retries are deliberately capped. We only keep probing /proc so
			// an externally restored HomeBack mapping can be adopted without restarting this helper.
			return;
		}

		this.blockedHooks.delete(target.pid);
		this.injectionFailures.delete(target.pid);
		await this.inject(target.pid, target.name);
	}

	private async inspectMappedHook(pid: number): Promise<HookInspection> {
		try {
			const maps = await fs.readFile(`/proc/${pid}/maps`, 'utf8');
			return {
				mapsReadable: true,
				mappedHookPath: findMappedLibraryPath(maps, basename(INPUTHOOK_LIBRARY_PATH)),
			};
		} catch {
			// Do not treat an unreadable maps file as an unhooked process: that could cause unsafe reinjection.
			return { mapsReadable: false, mappedHookPath: null };
		}
	}

	private blockTarget(
		pid: number,
		name: string,
		hookPath: string,
		reason: BlockedHookReason,
		recovery: string,
		failures?: number,
	): boolean {
		const now = Date.now();
		const previous = this.blockedHooks.get(pid);
		const changed = !previous || previous.reason !== reason || previous.hookPath !== hookPath;
		this.blockedHooks.set(pid, {
			pid,
			name,
			hookPath,
			reason,
			recovery,
			failures,
			firstBlockedAt: previous?.firstBlockedAt ?? now,
			lastCheckedAt: now,
			nextRecheckAt: now + BLOCKED_RECHECK_MS,
		});
		return changed;
	}

	private async handleMappedHook(pid: number, name: string, mappedHookPath: string): Promise<void> {
		if (await this.isHomeBackHookPath(mappedHookPath)) {
			await this.adoptExistingHook(pid, name, mappedHookPath);
			return;
		}

		this.injectionFailures.delete(pid);
		const changed = this.blockTarget(
			pid,
			name,
			mappedHookPath,
			'foreign-hook',
			'Remove the conflicting input hook and restart the target process (or reboot) before HomeBack can own it.',
		);
		if (changed) {
			console.warn(
				`Refusing to inject ${name} (${pid}): an existing non-HomeBack input hook is already mapped at ` +
					`${mappedHookPath}. Remove the conflicting hook and restart the target process or reboot.`,
			);
		}
	}

	private async isHomeBackHookPath(mappedPath: string): Promise<boolean> {
		if (isHomeBackMappedLibraryPath(mappedPath, INPUTHOOK_LIBRARY_PATH, SERVICE_ID)) return true;

		try {
			const [mappedRealPath, expectedRealPath] = await Promise.all([
				fs.realpath(normalizeMappedLibraryPath(mappedPath)),
				fs.realpath(INPUTHOOK_LIBRARY_PATH),
			]);
			return mappedRealPath === expectedRealPath;
		} catch {
			return false;
		}
	}

	private async adoptExistingHook(pid: number, name: string, hookPath: string): Promise<void> {
		const logPath = `/tmp/homeback-inputhook-${name}-${pid}.log`;
		const injectorLogPath = `/tmp/homeback-ezinject-${name}-${pid}.log`;

		let offset: number;
		try {
			const handle = await fs.open(logPath, fsConstants.O_RDWR | fsConstants.O_NOFOLLOW);
			try {
				const stat = await handle.stat();
				if (!stat.isFile()) throw new Error('event log is not a regular file');
				offset = stat.size;
				if (offset > MAX_LOG_BYTES) {
					await handle.truncate(0);
					offset = 0;
				}
			} finally {
				await handle.close();
			}
		} catch (error) {
			const changed = this.blockTarget(
				pid,
				name,
				hookPath,
				'homeback-log-missing',
				'Restart the target process or reboot. HomeBack will periodically recheck in case the log failure was transient.',
			);
			if (changed) {
				console.error(
					`HomeBack hook is already loaded in ${name} (${pid}), but its event log cannot be reattached; ` +
						'reinjection is unsafe. Restart the target process or reboot to recover.',
					error,
				);
			}
			return;
		}

		this.blockedHooks.delete(pid);
		this.injectionFailures.delete(pid);
		this.targets.set(pid, {
			pid,
			name,
			logPath,
			injectorLogPath,
			hookPath,
			state: 'active',
			source: 'adopted',
		});
		// Start at EOF so a recreated helper never replays stale key events from before its restart.
		this.logs.set(logPath, { path: logPath, offset, carry: '' });
		console.log(`Adopted existing HomeBack remote hook in ${name} (${pid}); reinjection skipped.`);
	}

	private async inject(pid: number, name: string): Promise<void> {
		// Re-check immediately before spawning ezinject. This closes the race where another
		// helper instance (or a foreign hook) maps libinputhookpp.so after the process scan.
		const inspection = await this.inspectMappedHook(pid);
		if (!inspection.mapsReadable) {
			this.blockTarget(
				pid,
				name,
				'',
				'proc-maps-unreadable',
				'HomeBack could not complete its final /proc maps safety check. It will retry without injecting.',
			);
			return;
		}
		if (inspection.mappedHookPath) {
			await this.handleMappedHook(pid, name, inspection.mappedHookPath);
			return;
		}

		const logPath = `/tmp/homeback-inputhook-${name}-${pid}.log`;
		const injectorLogPath = `/tmp/homeback-ezinject-${name}-${pid}.log`;
		const target: InjectedTarget = {
			pid,
			name,
			logPath,
			injectorLogPath,
			hookPath: INPUTHOOK_LIBRARY_PATH,
			state: 'injecting',
			source: 'injected',
		};
		this.targets.set(pid, target);

		try {
			await createFreshLogFile(logPath);
			await createFreshLogFile(injectorLogPath);
			this.logs.set(logPath, { path: logPath, offset: 0, carry: '' });

			const fd = openSync(
				injectorLogPath,
				fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW,
			);
			try {
				const child = spawn(EZINJECT_PATH, ['-l', logPath, String(pid), INPUTHOOK_LIBRARY_PATH], {
					detached: true,
					stdio: ['ignore', fd, fd],
				});

				child.once('error', error => {
					void this.failInjection(target, `spawn error: ${String(error)}`);
				});

				child.once('exit', (code, signal) => {
					if (code !== 0 || signal !== null) {
						void this.failInjection(
							target,
							`ezinject exit code=${String(code)} signal=${String(signal)}`,
						);
						return;
					}
					setTimeout(() => {
						void this.verifyInjection(target);
					}, INJECTION_VERIFY_DELAY_MS);
				});

				child.unref();
				console.log(`Injecting HomeBack remote hook into ${name} (${pid})`);
			} finally {
				closeSync(fd);
			}
		} catch (error) {
			await this.failInjection(target, `unable to start ezinject: ${String(error)}`);
		}
	}

	private async verifyInjection(target: InjectedTarget): Promise<void> {
		let lastError = 'input hook verification did not run';

		for (let attempt = 1; attempt <= INJECTION_VERIFY_ATTEMPTS; attempt += 1) {
			if (this.targets.get(target.pid) !== target) return;

			try {
				const maps = await fs.readFile(`/proc/${target.pid}/maps`, 'utf8');
				const mappedHookPath = findMappedLibraryPath(maps, basename(INPUTHOOK_LIBRARY_PATH));
				if (!mappedHookPath) throw new Error('input hook library not present in target process maps');
				if (!(await this.isHomeBackHookPath(mappedHookPath))) {
					throw new Error(`unexpected input hook mapped after injection: ${mappedHookPath}`);
				}

				target.hookPath = mappedHookPath;
				target.state = 'active';
				this.injectionFailures.delete(target.pid);
				this.blockedHooks.delete(target.pid);
				console.log(`HomeBack remote hook active in ${target.name} (${target.pid})`);
				return;
			} catch (error) {
				lastError = String(error);
			}

			if (attempt < INJECTION_VERIFY_ATTEMPTS) {
				await new Promise(resolve => setTimeout(resolve, INJECTION_VERIFY_DELAY_MS));
			}
		}

		await this.failInjection(target, `verification failed: ${lastError}`);
	}

	// @invariant: bounded-injection-retries
	private async failInjection(target: InjectedTarget, error: string): Promise<void> {
		if (this.targets.get(target.pid) !== target) return;
		await this.cleanupTarget(target.pid);

		const previousFailures = this.injectionFailures.get(target.pid)?.failures ?? 0;
		const failures = previousFailures + 1;
		if (failures >= MAX_INJECTION_FAILURES) {
			this.injectionFailures.delete(target.pid);
			this.blockTarget(
				target.pid,
				target.name,
				'',
				'injection-failed',
				'Fix the injection failure, then restart the target process (or reboot) to permit automatic injection again.',
				failures,
			);
			console.error(
				`HomeBack injection failed ${failures} consecutive times for ${target.name} (${target.pid}); ` +
					`automatic retries are now blocked. ${error}`,
			);
			return;
		}

		const retryDelay = injectionRetryDelayMs(failures);
		if (retryDelay === null) throw new Error('retry policy returned no delay before failure limit');
		this.injectionFailures.set(target.pid, {
			name: target.name,
			failures,
			nextAttemptAt: Date.now() + retryDelay,
			lastError: error,
		});
		console.warn(
			`HomeBack injection attempt ${failures}/${MAX_INJECTION_FAILURES} failed for ${target.name} ` +
				`(${target.pid}); retrying in ${retryDelay}ms. ${error}`,
		);
	}

	private async cleanupTarget(pid: number): Promise<void> {
		const target = this.targets.get(pid);
		if (!target) return;

		this.targets.delete(pid);
		this.logs.delete(target.logPath);
		await Promise.all([
			fs.unlink(target.logPath).catch(() => undefined),
			fs.unlink(target.injectorLogPath).catch(() => undefined),
		]);
	}

	private pollLogs(): void {
		for (const cursor of this.logs.values()) {
			try {
				const stat = statSync(cursor.path);
				if (stat.size < cursor.offset) {
					cursor.offset = 0;
					cursor.carry = '';
				}
				if (stat.size <= cursor.offset) {
					this.rotateLogIfNeeded(cursor, stat.size);
					continue;
				}

				const length = Math.min(stat.size - cursor.offset, MAX_LOG_READ);
				const buffer = Buffer.allocUnsafe(length);
				const fd = openSync(cursor.path, 'r');
				let bytesRead = 0;
				try {
					bytesRead = readSync(fd, buffer, 0, length, cursor.offset);
				} finally {
					closeSync(fd);
				}
				if (bytesRead <= 0) continue;

				cursor.offset += bytesRead;
				const text = cursor.carry + buffer.subarray(0, bytesRead).toString('utf8');
				const lines = text.split(/\r?\n/);
				cursor.carry = lines.pop() ?? '';
				for (const line of lines) this.parseLogLine(line);

				this.rotateLogIfNeeded(cursor, stat.size);
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code !== 'ENOENT') console.error(`Failed reading ${cursor.path}:`, error);
			}
		}
	}

	private rotateLogIfNeeded(cursor: LogCursor, knownSize: number): void {
		if (
			!cursor.path.startsWith('/tmp/homeback-inputhook-') ||
			knownSize < MAX_LOG_BYTES ||
			cursor.offset < knownSize ||
			cursor.carry.length > 0
		) {
			return;
		}

		try {
			truncateSync(cursor.path, 0);
			cursor.offset = 0;
		} catch (error) {
			console.warn(`Unable to truncate oversized remote-input log ${cursor.path}:`, error);
		}
	}

	private parseLogLine(line: string): void {
		let keycode: number | null = null;
		let state: number | null = null;

		let match = line.match(/lginput_uinput_send_button called: keyid=\d+, state=(-?\d+) uinput_code=(\d+)/);
		if (match) {
			state = Number(match[1]);
			keycode = Number(match[2]);
		}

		if (keycode === null) {
			match = line.match(/MICOM_FuncWriteKeyEvent called: fd=\d+, type=\d+, code=(\d+), value=(-?\d+)/);
			if (match) {
				keycode = Number(match[1]);
				state = Number(match[2]);
			}
		}

		if (keycode === null) {
			match = line.match(/write to \/dev\/uinput: code=(\d+), value=(-?\d+)/);
			if (match) {
				keycode = Number(match[1]);
				state = Number(match[2]);
			}
		}

		if (keycode === null || state === null) return;
		this.handleState(keycode, state);
	}

	private handleState(keycode: number, state: number): void {
		this.lastKeyEvent = { keycode, state, atMs: Date.now() };
		if (state === 2) return;

		if (state === 0) {
			const active = this.activePresses.get(keycode);
			if (!active) return;

			this.clearActivePress(keycode, active);
			if (!active.longFired && active.mapping.short && this.canFireAction(keycode)) {
				this.markActionFired(keycode);
				void this.executeAction(active.mapping.short, keycode, 'short');
			}
			return;
		}

		if (state !== 1) return;

		const mapping = this.config.keys[String(keycode)];
		if (!mapping || !isTimedMapping(mapping) || this.activePresses.has(keycode)) return;

		const threshold = actionThreshold(mapping, this.config);
		const active: ActivePress = {
			mapping,
			longFired: false,
			longTimer: null,
			watchdogTimer: null,
		};
		this.activePresses.set(keycode, active);

		if (mapping.long) {
			active.longTimer = setTimeout(() => {
				const current = this.activePresses.get(keycode);
				if (current !== active || !this.canFireAction(keycode)) return;
				current.longFired = true;
				this.markActionFired(keycode);
				void this.executeAction(mapping.long!, keycode, 'long');
			}, threshold);
		}

		active.watchdogTimer = setTimeout(() => {
			const current = this.activePresses.get(keycode);
			if (current === active) {
				console.warn(`Clearing stale remote key press for keycode ${keycode}.`);
				this.clearActivePress(keycode, active);
			}
		}, threshold + MAX_STUCK_PRESS_GRACE_MS);
	}

	private clearActivePress(keycode: number, active: ActivePress): void {
		if (active.longTimer) clearTimeout(active.longTimer);
		if (active.watchdogTimer) clearTimeout(active.watchdogTimer);
		this.activePresses.delete(keycode);
	}

	private sweepActivePresses(): void {
		for (const [keycode, active] of this.activePresses) {
			if (!active.watchdogTimer) this.clearActivePress(keycode, active);
		}
	}

	private canFireAction(keycode: number): boolean {
		const previous = this.lastActionAt.get(keycode) ?? 0;
		return Date.now() - previous >= ACTION_COOLDOWN_MS;
	}

	private markActionFired(keycode: number): void {
		this.lastActionAt.set(keycode, Date.now());
	}

	private async executeAction(action: SemanticAction, keycode: number, kind: 'short' | 'long'): Promise<void> {
		const record: LastRemoteAction = {
			keycode,
			kind,
			action: action.action,
			startedAtMs: Date.now(),
			completedAtMs: null,
			outcome: 'pending',
		};
		this.lastAction = record;

		try {
			console.log(
				`Remote key ${keycode} ${kind}: ${action.action} at=${new Date(record.startedAtMs).toISOString()}`,
			);

			switch (action.action) {
				case 'ignore':
					break;
				case 'launch': {
					const params = action.params ?? (action.id === APP_ID ? { intent: 'homeback:show' } : undefined);
					await this.service.oneshot('luna://com.webos.applicationManager/launch', {
						id: action.id,
						...(params ? { params } : {}),
					});
					break;
				}
				case 'replace':
					await this.service.oneshot('luna://com.webos.service.micomservice/sendKeycode', {
						keycode: action.keycode,
					});
					break;
				case 'exec': {
					const child = spawn('/bin/sh', ['-c', action.command], {
						detached: true,
						stdio: 'ignore',
					});
					child.unref();
					break;
				}
			}

			record.completedAtMs = Date.now();
			record.outcome = 'ok';
		} catch (error) {
			record.completedAtMs = Date.now();
			record.outcome = 'error';
			record.error = error instanceof Error ? error.message : String(error);
			console.error(`Remote key ${keycode} ${kind} action failed:`, error);
		}
	}

}
