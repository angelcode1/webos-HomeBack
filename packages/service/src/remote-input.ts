import {
	closeSync,
	constants as fsConstants,
	existsSync,
	fstatSync,
	openSync,
	promises as fs,
} from 'fs';
import { dirname, join } from 'path';

import { isPlainObject } from '@homeback/utils';

import type { Service } from './bus';
import { CoalescedTask } from './coalesced-task';
import { SERVICE_ROOT_DIR } from './environment';
import { EventLogTailer } from './event-log-tailer';
import { HOME_BACK_CONFIG_DIR } from './homeback-paths';
import { InjectionManager } from './remote-injection-manager';
import { ESSENTIAL_TARGET_NAMES } from './remote-input-lifecycle';
import { hasVerifiedNativeOwnership } from './remote-input-ownership';
import { NativeConfigWriter } from './native-config-writer';
import { RemoteActionRunner } from './remote-action-runner';
import {
	type RemoteConfig,
	type RemoteMapping,
	validateConfig,
} from './remote-config';
import { RemotePressStateMachine } from './remote-press-state-machine';
import { ProcessScanner, type ProcTargetSnapshot } from './remote-process-scanner';
import { writeFile } from './utils';

export const REMOTE_CONFIG_PATH = `${HOME_BACK_CONFIG_DIR}/remote-buttons.json`;
const NATIVE_CONFIG_PATH = '/home/root/.config/lginputhook/keybinds.json';
const DEFAULT_CONFIG_PATH = join(SERVICE_ROOT_DIR, 'inputhook', 'remote-buttons.default.json');
const EZINJECT_PATH = join(SERVICE_ROOT_DIR, 'inputhook', 'ezinject');
const INPUTHOOK_LIBRARY_PATH = join(SERVICE_ROOT_DIR, 'inputhook', 'libinputhookpp.so');

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

const configFingerprint = (stat: { mtimeMs: number; size: number; ino: number }): string =>
	`${stat.mtimeMs}:${stat.size}:${stat.ino}`;

export class RemoteInputManager {
	private config: RemoteConfig = { version: 1, defaultLongPressMs: DEFAULT_LONG_PRESS_MS, keys: {} };
	private configFingerprint = '';
	private rejectedConfigFingerprint = '';
	private started = false;
	private eventTailerHealthy = false;
	private readonly lastObservedTargets = new Map<number, ProcTargetSnapshot>();
	private readonly legacyPids = new Set<number>();
	private legacyMode = false;
	private readonly logTailer: EventLogTailer;
	private readonly actionRunner: RemoteActionRunner;
	private readonly pressState: RemotePressStateMachine;
	private readonly scanner: ProcessScanner;
	private readonly injectionManager: InjectionManager;
	private readonly nativeConfigWriter: NativeConfigWriter;
	private logTimer: NodeJS.Timeout | null = null;
	private processTimer: NodeJS.Timeout | null = null;
	private configTimer: NodeJS.Timeout | null = null;
	private startPromise: Promise<void> | null = null;
	private readonly processScans: CoalescedTask<void>;
	private readonly configReloads: CoalescedTask<boolean>;

	public constructor(service: Service) {
		this.logTailer = new EventLogTailer();
		this.actionRunner = new RemoteActionRunner(service);
		this.pressState = new RemotePressStateMachine(() => this.config, this.actionRunner);
		this.scanner = new ProcessScanner(TARGET_NAMES, INPUTHOOK_LIBRARY_PATH);
		this.nativeConfigWriter = new NativeConfigWriter(NATIVE_CONFIG_PATH);
		this.processScans = new CoalescedTask<void>(
			() => this.scanProcessesOnce(),
			() => undefined,
		);
		this.configReloads = new CoalescedTask<boolean>(
			force => this.reloadConfigOnce(force),
			(current, incoming) => current || incoming,
		);
		this.injectionManager = new InjectionManager(
			this.scanner,
			this.logTailer,
			INPUTHOOK_LIBRARY_PATH,
			EZINJECT_PATH,
			() => this.requestProcessScan(),
			() => this.syncTimedMappingsArmed(),
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

	public async stop(): Promise<void> {
		if (this.logTimer) clearInterval(this.logTimer);
		if (this.processTimer) clearInterval(this.processTimer);
		if (this.configTimer) clearInterval(this.configTimer);
		this.logTimer = null;
		this.processTimer = null;
		this.configTimer = null;
		this.started = false;
		this.eventTailerHealthy = false;
		this.pressState.stop();

		await this.nativeConfigWriter.setArmed(this.config, false);
		this.logTailer.closeAll();
	}

	/**
	 * Last-resort synchronous exit hook. This cannot protect against SIGKILL or
	 * power loss, but it atomically replaces the native config on normal exit,
	 * handled signals and most JavaScript crashes.
	 */
	public disarmTimedMappingsSync(): void {
		try {
			this.nativeConfigWriter.disarmSync(this.config);
		} catch (error) {
			console.error('Unable to synchronously disarm HomeBack timed remote mappings:', error);
		}
	}

	public status(): Record<string, unknown> {
		const mappedLegacyPids = [...this.injectionManager.blockedHooks.values()]
			.filter(target => target.hookPath.includes(`/${LEGACY_SERVICE_ID}/`))
			.map(target => target.pid);
		const legacyPids = [...new Set([...this.legacyPids, ...mappedLegacyPids])];

		return {
			started: this.started,
			configPath: REMOTE_CONFIG_PATH,
			nativeConfigPath: NATIVE_CONFIG_PATH,
			timedMappingsArmed: this.nativeConfigWriter.timedMappingsArmed,
			eventTailerHealthy: this.eventTailerHealthy,
			injected: [...this.injectionManager.targets.values()]
				.filter(target => target.state === 'active')
				.map(({ pid, name, source }) => ({ pid, name, source })),
			injecting: [...this.injectionManager.targets.values()]
				.filter(target => target.state === 'injecting')
				.map(({ pid, name }) => ({ pid, name })),
			blockedHooks: [...this.injectionManager.blockedHooks.values()],
			retrying: [...this.injectionManager.injectionFailures.entries()].map(([pid, failure]) => ({
				pid,
				name: failure.name,
				failures: failure.failures,
				nextAttemptAt: failure.nextAttemptAt,
				lastError: failure.lastError,
			})),
			nativeOwnershipVerified: this.isNativeOwnershipVerified(),
			activeKeys: this.pressState.activeKeys,
			legacyInputHookDetected: this.legacyMode || mappedLegacyPids.length > 0,
			legacyPids,
			lastKeyEvent: this.pressState.lastKeyEvent,
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
			[...this.injectionManager.targets.values()].map(({ pid, name, state }) => ({ pid, name, state })),
			[...this.injectionManager.blockedHooks.values()].map(({ pid, name }) => ({ pid, name })),
		);
	}

	private async startOnce(): Promise<void> {
		await this.ensureConfigFiles();
		await this.reloadConfig(true);
		await fs.chmod(EZINJECT_PATH, 0o755);
		await this.scanProcesses();

		this.started = true;
		this.logTimer = setInterval(() => {
			this.runGuarded('Remote event-log poll failed:', () => this.pollEventLogs());
		}, LOG_POLL_MS);
		this.processTimer = setInterval(() => {
			this.runGuarded('Remote process scan failed:', () => this.scanProcesses());
		}, PROCESS_SCAN_MS);
		this.configTimer = setInterval(() => {
			this.runGuarded('Remote config reload failed:', () => this.reloadConfig(false));
		}, CONFIG_SCAN_MS);
		await this.pollEventLogs();
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
				if (isPlainObject(legacyRaw)) {
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

		// Preserve a legacy native file long enough for the migration above, then
		// clear service-dependent swallows before a forced reload can reject startup.
		await writeFile(NATIVE_CONFIG_PATH, '{}\n', 0o644);
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

			await this.nativeConfigWriter.writeConfig(parsed);
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

	private async syncTimedMappingsArmed(): Promise<void> {
		const shouldArm =
			this.started &&
			this.eventTailerHealthy &&
			this.logTailer.size > 0 &&
			this.isNativeOwnershipVerified();
		await this.nativeConfigWriter.setArmed(this.config, shouldArm);
	}

	private async pollEventLogs(): Promise<void> {
		this.eventTailerHealthy = this.logTailer.poll(line => this.pressState.handleLogLine(line));
		await this.syncTimedMappingsArmed();
	}

	private async detectLiveLegacyInputHook(
		procTargets: ReadonlyMap<number, ProcTargetSnapshot>,
	): Promise<boolean> {
		this.legacyPids.clear();
		const legacyInstallPresent =
			existsSync('/tmp/inputhook') && LEGACY_SERVICE_DIRS.some(path => existsSync(path));

		for (const target of procTargets.values()) {
			if (target.mapsReadable && target.mappedHookPath) {
				if (await this.injectionManager.isHomeBackHookPath(target.mappedHookPath)) continue;
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
				fd = null;
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

		if (legacyDetected && this.injectionManager.targets.size === 0) {
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
		const procTargets = await this.scanner.scan();
		if (!procTargets) {
			this.lastObservedTargets.clear();
			await this.syncTimedMappingsArmed();
			return;
		}
		this.lastObservedTargets.clear();
		for (const [pid, target] of procTargets) this.lastObservedTargets.set(pid, target);

		if (await this.reconcileLegacyMode(procTargets)) {
			await this.injectionManager.pruneDeadProcessState(procTargets);
			await this.syncTimedMappingsArmed();
			return;
		}

		await this.injectionManager.reconcile(procTargets);
		await this.syncTimedMappingsArmed();
	}

	private requestProcessScan(): void {
		this.runGuarded('Requested remote process rescan failed:', () => this.scanProcesses());
	}

	private runGuarded(message: string, task: () => Promise<void>): void {
		void task().catch(error => console.error(message, error));
	}
}
