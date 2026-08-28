import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import {
	closeSync,
	constants as fsConstants,
	existsSync,
	fchmodSync,
	fstatSync,
	ftruncateSync,
	openSync,
	promises as fs,
} from 'fs';
import { basename, dirname, join } from 'path';

import type { Service } from './bus';
import { CoalescedTask } from './coalesced-task';
import { SERVICE_ID, SERVICE_ROOT_DIR } from './environment';
import { EventLogTailer, MAX_LOG_BYTES } from './event-log-tailer';
import { RemoteActionRunner } from './remote-action-runner';
import { parseProcStatStartTime } from './remote-process';
import {
	buildNativeKeybinds,
	isTimedMapping,
	type RemoteConfig,
	type RemoteMapping,
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
const TARGET_NAMES = new Set([...ESSENTIAL_TARGET_NAMES, 'tvservice']);
const LEGACY_SERVICE_ID = 'org.webosbrew.inputhook.service';
const LEGACY_SERVICE_DIRS = [
	'/media/developer/apps/usr/palm/services/org.webosbrew.inputhook.service',
	'/media/cryptofs/apps/usr/palm/services/org.webosbrew.inputhook.service',
];

const LOG_POLL_MS = 80;
const PROCESS_SCAN_MS = 2_000;
const CONFIG_SCAN_MS = 1_000;
const DEFAULT_LONG_PRESS_MS = 650;
const ACTION_COOLDOWN_MS = 150;
const MAX_STUCK_PRESS_GRACE_MS = 5_000;
const INJECTION_VERIFY_DELAY_MS = 150;
const INJECTION_VERIFY_ATTEMPTS = 10;
const INJECTION_WATCHDOG_MS = 15_000;

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

type TargetSource = 'injected' | 'adopted';

type InjectedTarget = {
	pid: number;
	name: string;
	startTimeTicks: string;
	logPath: string;
	injectorLogPath: string;
	hookPath: string;
	state: 'injecting' | 'active';
	source: TargetSource;
	injectionWatchdog: NodeJS.Timeout | null;
	injector: ChildProcess | null;
};

type BlockedHookReason =
	| 'foreign-hook'
	| 'homeback-log-missing'
	| 'injection-failed'
	| 'proc-maps-unreadable';

type BlockedHook = {
	pid: number;
	name: string;
	startTimeTicks: string;
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
	startTimeTicks: string;
	failures: number;
	nextAttemptAt: number;
	lastError: string;
};

type ProcTargetSnapshot = {
	pid: number;
	name: string;
	startTimeTicks: string;
	mapsReadable: boolean;
	mappedHookPath: string | null;
};

type HookInspection = Pick<ProcTargetSnapshot, 'mapsReadable' | 'mappedHookPath'>;
type TargetIdentity = Pick<ProcTargetSnapshot, 'pid' | 'name' | 'startTimeTicks'>;

const serializeNativeConfig = (config: RemoteConfig): string =>
	`${JSON.stringify(buildNativeKeybinds(config), null, '\t')}\n`;

const actionThreshold = (mapping: TimedMapping, config: RemoteConfig): number =>
	mapping.longPressMs ?? config.defaultLongPressMs ?? DEFAULT_LONG_PRESS_MS;

// @invariant: nofollow-log-permissions
const createFreshLogFile = (path: string): number => {
	const fd = openSync(
		path,
		fsConstants.O_RDWR |
			fsConstants.O_CREAT |
			fsConstants.O_TRUNC |
			fsConstants.O_NOFOLLOW,
		0o600,
	);
	try {
		fchmodSync(fd, 0o600);
		return fd;
	} catch (error) {
		closeSync(fd);
		throw error;
	}
};

const configFingerprint = (stat: { mtimeMs: number; size: number; ino: number }): string =>
	`${stat.mtimeMs}:${stat.size}:${stat.ino}`;

export class RemoteInputManager {
	private config: RemoteConfig = { version: 1, defaultLongPressMs: DEFAULT_LONG_PRESS_MS, keys: {} };
	private configFingerprint = '';
	private rejectedConfigFingerprint = '';
	private started = false;
	private readonly targets = new Map<number, InjectedTarget>();
	private readonly blockedHooks = new Map<number, BlockedHook>();
	private readonly injectionFailures = new Map<number, InjectionFailure>();
	private readonly lastObservedTargets = new Map<number, ProcTargetSnapshot>();
	private readonly processNameCache = new Map<number, string>();
	private readonly legacyPids = new Set<number>();
	private legacyMode = false;
	private readonly logTailer: EventLogTailer;
	private readonly actionRunner: RemoteActionRunner;
	private readonly activePresses = new Map<number, ActivePress>();
	private readonly lastActionAt = new Map<number, number>();
	private lastKeyEvent: LastRemoteKeyEvent | null = null;
	private logTimer: NodeJS.Timeout | null = null;
	private processTimer: NodeJS.Timeout | null = null;
	private configTimer: NodeJS.Timeout | null = null;
	private startPromise: Promise<void> | null = null;
	private readonly processScans: CoalescedTask<void>;
	private readonly configReloads: CoalescedTask<boolean>;

	public constructor(private readonly service: Service) {
		this.logTailer = new EventLogTailer();
		this.actionRunner = new RemoteActionRunner(service);
		this.processScans = new CoalescedTask<void>(
			() => this.scanProcessesOnce(),
			() => undefined,
		);
		this.configReloads = new CoalescedTask<boolean>(
			force => this.reloadConfigOnce(force),
			(current, incoming) => current || incoming,
		);
	}

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
			lastAction: this.actionRunner.lastAction,
			logCursorCount: this.logTailer.size,
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
		this.logTimer = setInterval(() => this.logTailer.poll(line => this.parseLogLine(line)), LOG_POLL_MS);
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

	private reloadConfig(force: boolean): Promise<void> {
		return this.configReloads.request(force);
	}

	private async reloadConfigOnce(force: boolean): Promise<void> {
		let stat;
		try {
			stat = await fs.lstat(REMOTE_CONFIG_PATH);
		} catch (error) {
			if (force) throw error;
			console.error('Unable to stat remote mapping config:', error);
			return;
		}

		const fingerprint = configFingerprint(stat);
		if (!stat.isFile() || stat.isSymbolicLink()) {
			const error = new Error(`${REMOTE_CONFIG_PATH} must be a regular file, not a symlink.`);
			if (force) throw error;
			if (fingerprint !== this.rejectedConfigFingerprint) console.error(error.message);
			this.rejectedConfigFingerprint = fingerprint;
			return;
		}

		if (!force && (fingerprint === this.configFingerprint || fingerprint === this.rejectedConfigFingerprint)) return;

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
			this.configFingerprint = fingerprint;
			this.rejectedConfigFingerprint = '';
			console.log(`Loaded remote button mappings from ${REMOTE_CONFIG_PATH}`);
		} catch (error) {
			this.rejectedConfigFingerprint = fingerprint;
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

		const livePids = new Set<number>();
		for (const entry of entries) {
			if (!/^\d+$/.test(entry)) continue;
			const pid = Number(entry);
			livePids.add(pid);

			let name = this.processNameCache.get(pid);
			if (name === undefined) {
				try {
					name = (await fs.readFile(`/proc/${entry}/comm`, 'utf8')).trim();
					this.processNameCache.set(pid, name);
				} catch {
					continue;
				}
			}
			if (!TARGET_NAMES.has(name)) continue;

			const startTimeTicks = await this.readProcessStartTime(pid);
			if (!startTimeTicks) continue;
			const previousTarget = this.lastObservedTargets.get(pid);
			if (previousTarget && previousTarget.startTimeTicks !== startTimeTicks) {
				// A PID can be recycled without being absent from two-second snapshots.
				// Never trust the cached comm across an observed identity change.
				try {
					name = (await fs.readFile(`/proc/${entry}/comm`, 'utf8')).trim();
					this.processNameCache.set(pid, name);
				} catch {
					continue;
				}
				if (!TARGET_NAMES.has(name)) continue;
			}
			const inspection = await this.inspectMappedHook(pid);
			targets.set(pid, {
				pid,
				name,
				startTimeTicks,
				...inspection,
			});
		}

		for (const pid of [...this.processNameCache.keys()]) {
			if (!livePids.has(pid)) this.processNameCache.delete(pid);
		}
		return targets;
	}

	private async readProcessStartTime(pid: number): Promise<string | null> {
		try {
			return parseProcStatStartTime(await fs.readFile(`/proc/${pid}/stat`, 'utf8'));
		} catch {
			return null;
		}
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
			if (!existsSync(path) || this.logTailer.has(path)) continue;

			let fd: number | null = null;
			try {
				fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
				const stat = fstatSync(fd);
				if (!stat.isFile()) throw new Error('legacy event log is not a regular file');
				this.logTailer.add(path, fd, stat.size, false);
				fd = null; // ownership transferred to EventLogTailer
				console.log(`Using existing LG Input Hook event log for ${name}`);
			} catch (error) {
				if (fd !== null) closeSync(fd);
				console.warn(`Unable to attach legacy input-hook log ${path}:`, error);
			}
		}
	}

	private detachLegacyLogs(): void {
		this.logTailer.removeWhere(cursor => cursor.path.startsWith('/tmp/lginput-hook-'));
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

	private scanProcesses(): Promise<void> {
		return this.processScans.request(undefined);
	}

	private async scanProcessesOnce(): Promise<void> {
		const procTargets = await this.scanTargetProcesses();
		if (!procTargets) return;
		this.lastObservedTargets.clear();
		for (const [pid, target] of procTargets) this.lastObservedTargets.set(pid, target);

		await this.pruneDeadProcessState(procTargets);
		if (await this.reconcileLegacyMode(procTargets)) return;

		const now = Date.now();
		for (const target of procTargets.values()) {
			const existing = this.targets.get(target.pid);
			if (existing) {
				if (existing.startTimeTicks === target.startTimeTicks) continue;
				await this.cleanupTarget(target.pid);
			}

			const blocked = this.blockedHooks.get(target.pid);
			if (blocked) {
				if (blocked.startTimeTicks !== target.startTimeTicks) {
					this.blockedHooks.delete(target.pid);
				} else {
					if (now >= blocked.nextRecheckAt) await this.recheckBlockedTarget(target, blocked);
					continue;
				}
			}

			const failure = this.injectionFailures.get(target.pid);
			if (failure) {
				if (failure.startTimeTicks !== target.startTimeTicks) {
					this.injectionFailures.delete(target.pid);
				} else if (now < failure.nextAttemptAt) {
					continue;
				}
			}
			await this.reconcileTarget(target);
		}
	}

	private async pruneDeadProcessState(
		procTargets: ReadonlyMap<number, ProcTargetSnapshot>,
	): Promise<void> {
		for (const [pid, existing] of [...this.targets.entries()]) {
			const live = procTargets.get(pid);
			if (!live || live.startTimeTicks !== existing.startTimeTicks) await this.cleanupTarget(pid);
		}
		for (const [pid, blocked] of [...this.blockedHooks.entries()]) {
			const live = procTargets.get(pid);
			if (!live || live.startTimeTicks !== blocked.startTimeTicks) this.blockedHooks.delete(pid);
		}
		for (const [pid, failure] of [...this.injectionFailures.entries()]) {
			const live = procTargets.get(pid);
			if (!live || live.startTimeTicks !== failure.startTimeTicks) this.injectionFailures.delete(pid);
		}
	}

	private async reconcileTarget(target: ProcTargetSnapshot): Promise<void> {
		if (!target.mapsReadable) {
			const changed = this.blockTarget(
				target,
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
			await this.handleMappedHook(target, target.mappedHookPath);
			return;
		}

		await this.inject(target);
	}

	// @invariant: blocked-target-recheck
	private async recheckBlockedTarget(target: ProcTargetSnapshot, blocked: BlockedHook): Promise<void> {
		blocked.lastCheckedAt = Date.now();
		blocked.nextRecheckAt = blocked.lastCheckedAt + BLOCKED_RECHECK_MS;

		if (!target.mapsReadable) return;

		if (target.mappedHookPath) {
			await this.handleMappedHook(target, target.mappedHookPath);
			return;
		}

		if (blocked.reason === 'injection-failed') {
			// Automatic injection retries are deliberately capped. Keep probing /proc so
			// an externally restored HomeBack mapping can still be adopted safely.
			return;
		}

		this.blockedHooks.delete(target.pid);
		this.injectionFailures.delete(target.pid);
		await this.inject(target);
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
		target: TargetIdentity,
		hookPath: string,
		reason: BlockedHookReason,
		recovery: string,
		failures?: number,
	): boolean {
		const now = Date.now();
		const previous = this.blockedHooks.get(target.pid);
		const sameIdentity = previous?.startTimeTicks === target.startTimeTicks;
		const changed = !previous || !sameIdentity || previous.reason !== reason || previous.hookPath !== hookPath;
		this.blockedHooks.set(target.pid, {
			pid: target.pid,
			name: target.name,
			startTimeTicks: target.startTimeTicks,
			hookPath,
			reason,
			recovery,
			failures,
			firstBlockedAt: sameIdentity && previous ? previous.firstBlockedAt : now,
			lastCheckedAt: now,
			nextRecheckAt: now + BLOCKED_RECHECK_MS,
		});
		return changed;
	}

	private async handleMappedHook(target: ProcTargetSnapshot, mappedHookPath: string): Promise<void> {
		if (await this.isHomeBackHookPath(mappedHookPath)) {
			await this.adoptExistingHook(target, mappedHookPath);
			return;
		}

		this.injectionFailures.delete(target.pid);
		const changed = this.blockTarget(
			target,
			mappedHookPath,
			'foreign-hook',
			'Remove the conflicting input hook and restart the target process (or reboot) before HomeBack can own it.',
		);
		if (changed) {
			console.warn(
				`Refusing to inject ${target.name} (${target.pid}): an existing non-HomeBack input hook is already mapped at ` +
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

	private async adoptExistingHook(target: ProcTargetSnapshot, hookPath: string): Promise<void> {
		const { pid, name, startTimeTicks } = target;
		const logPath = `/tmp/homeback-inputhook-${name}-${pid}.log`;
		const injectorLogPath = `/tmp/homeback-ezinject-${name}-${pid}.log`;

		let fd: number | null = null;
		let offset = 0;
		try {
			fd = openSync(logPath, fsConstants.O_RDWR | fsConstants.O_NOFOLLOW);
			const stat = fstatSync(fd);
			if (!stat.isFile()) throw new Error('event log is not a regular file');
			offset = stat.size;
			if (offset > MAX_LOG_BYTES) {
				ftruncateSync(fd, 0);
				offset = 0;
			}

			const liveStartTime = await this.readProcessStartTime(pid);
			if (liveStartTime !== startTimeTicks) {
				throw new Error('target identity changed while adopting existing hook');
			}
		} catch (error) {
			if (fd !== null) closeSync(fd);
			const changed = this.blockTarget(
				target,
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
			startTimeTicks,
			logPath,
			injectorLogPath,
			hookPath,
			state: 'active',
			source: 'adopted',
			injectionWatchdog: null,
			injector: null,
		});
		// Start at EOF so a recreated helper never replays stale key events from before its restart.
		this.logTailer.add(logPath, fd!, offset, true);
		console.log(`Adopted existing HomeBack remote hook in ${name} (${pid}); reinjection skipped.`);
	}

	private async inject(snapshot: ProcTargetSnapshot): Promise<void> {
		const { pid, name, startTimeTicks } = snapshot;
		// Re-check target identity and maps immediately before spawning ezinject. This
		// closes both PID-reuse and concurrent-hook races between scan and injection.
		if (await this.readProcessStartTime(pid) !== startTimeTicks) {
			void this.scanProcesses();
			return;
		}

		const inspection = await this.inspectMappedHook(pid);
		if (!inspection.mapsReadable) {
			this.blockTarget(
				snapshot,
				'',
				'proc-maps-unreadable',
				'HomeBack could not complete its final /proc maps safety check. It will retry without injecting.',
			);
			return;
		}
		if (inspection.mappedHookPath) {
			await this.handleMappedHook({ ...snapshot, ...inspection }, inspection.mappedHookPath);
			return;
		}

		const logPath = `/tmp/homeback-inputhook-${name}-${pid}.log`;
		const injectorLogPath = `/tmp/homeback-ezinject-${name}-${pid}.log`;
		const target: InjectedTarget = {
			pid,
			name,
			startTimeTicks,
			logPath,
			injectorLogPath,
			hookPath: INPUTHOOK_LIBRARY_PATH,
			state: 'injecting',
			source: 'injected',
			injectionWatchdog: null,
			injector: null,
		};
		this.targets.set(pid, target);

		let injectorFd: number | null = null;
		try {
			const eventFd = createFreshLogFile(logPath);
			this.logTailer.add(logPath, eventFd, 0, true);
			injectorFd = createFreshLogFile(injectorLogPath);

			const child = spawn(EZINJECT_PATH, ['-l', logPath, String(pid), INPUTHOOK_LIBRARY_PATH], {
				detached: true,
				stdio: ['ignore', injectorFd, injectorFd],
			});
			target.injector = child;
			target.injectionWatchdog = setTimeout(() => {
				if (this.targets.get(pid) !== target || target.state !== 'injecting') return;
				console.error(`ezinject watchdog expired for ${name} (${pid}) after ${INJECTION_WATCHDOG_MS}ms.`);
				try {
					child.kill('SIGKILL');
				} catch {
					// Process may have exited between the watchdog check and kill.
				}
				void this.failInjection(target, 'ezinject timed out').catch(error => {
					console.error('Failed to record ezinject timeout:', error);
				});
			}, INJECTION_WATCHDOG_MS);

			child.once('error', error => {
				this.clearInjectionWatchdog(target);
				target.injector = null;
				void this.failInjection(target, `spawn error: ${String(error)}`).catch(failureError => {
					console.error('Failed to record injection spawn error:', failureError);
				});
			});

			child.once('exit', (code, signal) => {
				this.clearInjectionWatchdog(target);
				target.injector = null;
				if (code !== 0 || signal !== null) {
					void this.failInjection(
						target,
						`ezinject exit code=${String(code)} signal=${String(signal)}`,
					).catch(failureError => {
						console.error('Failed to record injection exit error:', failureError);
					});
					return;
				}
				setTimeout(() => {
					void this.verifyInjection(target).catch(error => {
						console.error('Injection verification failed unexpectedly:', error);
					});
				}, INJECTION_VERIFY_DELAY_MS);
			});

			child.unref();
			console.log(`Injecting HomeBack remote hook into ${name} (${pid})`);
		} catch (error) {
			await this.failInjection(target, `unable to start ezinject: ${String(error)}`);
		} finally {
			if (injectorFd !== null) closeSync(injectorFd);
		}
	}

	private clearInjectionWatchdog(target: InjectedTarget): void {
		if (!target.injectionWatchdog) return;
		clearTimeout(target.injectionWatchdog);
		target.injectionWatchdog = null;
	}

	private async verifyInjection(target: InjectedTarget): Promise<void> {
		let lastError = 'input hook verification did not run';

		for (let attempt = 1; attempt <= INJECTION_VERIFY_ATTEMPTS; attempt += 1) {
			if (this.targets.get(target.pid) !== target) return;

			const startTimeTicks = await this.readProcessStartTime(target.pid);
			if (startTimeTicks !== target.startTimeTicks) {
				console.warn(`Target PID ${target.pid} was reused while verifying ${target.name}; abandoning stale verification.`);
				await this.cleanupTarget(target.pid);
				void this.scanProcesses();
				return;
			}

			const inspection = await this.inspectMappedHook(target.pid);
			if (!inspection.mapsReadable) {
				lastError = 'target process maps became unreadable';
			} else if (!inspection.mappedHookPath) {
				lastError = 'input hook library not present in target process maps';
			} else if (!(await this.isHomeBackHookPath(inspection.mappedHookPath))) {
				lastError = `unexpected input hook mapped after injection: ${inspection.mappedHookPath}`;
			} else {
				target.hookPath = inspection.mappedHookPath;
				target.state = 'active';
				this.injectionFailures.delete(target.pid);
				this.blockedHooks.delete(target.pid);
				console.log(`HomeBack remote hook active in ${target.name} (${target.pid})`);
				return;
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

		const previous = this.injectionFailures.get(target.pid);
		const previousFailures = previous?.startTimeTicks === target.startTimeTicks ? previous.failures : 0;
		const failures = previousFailures + 1;
		if (failures >= MAX_INJECTION_FAILURES) {
			this.injectionFailures.delete(target.pid);
			this.blockTarget(
				target,
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
		if (retryDelay === null) {
			console.error(
				`Injection retry policy returned no delay before the failure limit for ${target.name} (${target.pid}); blocking safely.`,
			);
			this.blockTarget(
				target,
				'',
				'injection-failed',
				'Restart the target process or reboot after correcting the injection failure.',
				failures,
			);
			return;
		}
		this.injectionFailures.set(target.pid, {
			name: target.name,
			startTimeTicks: target.startTimeTicks,
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
		this.clearInjectionWatchdog(target);
		if (target.injector) {
			try {
				target.injector.kill('SIGKILL');
			} catch {
				// Injector may already have exited.
			}
			target.injector = null;
		}
		this.logTailer.remove(target.logPath);
		await Promise.all([
			fs.unlink(target.logPath).catch(() => undefined),
			fs.unlink(target.injectorLogPath).catch(() => undefined),
		]);
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
				void this.actionRunner.execute(active.mapping.short, keycode, 'short');
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
				void this.actionRunner.execute(mapping.long!, keycode, 'long');
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

	private canFireAction(keycode: number): boolean {
		const previous = this.lastActionAt.get(keycode) ?? 0;
		return Date.now() - previous >= ACTION_COOLDOWN_MS;
	}

	private markActionFired(keycode: number): void {
		this.lastActionAt.set(keycode, Date.now());
	}


}
