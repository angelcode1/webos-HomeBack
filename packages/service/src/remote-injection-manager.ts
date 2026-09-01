import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import {
	closeSync,
	constants as fsConstants,
	fchmodSync,
	fstatSync,
	ftruncateSync,
	openSync,
	promises as fs,
} from 'fs';

import { SERVICE_ID } from './environment';
import { EventLogTailer, MAX_LOG_BYTES } from './event-log-tailer';
import {
	BLOCKED_RECHECK_MS,
	injectionRetryDelayMs,
	MAX_INJECTION_FAILURES,
} from './remote-input-lifecycle';
import {
	isHomeBackMappedLibraryPath,
	normalizeMappedLibraryPath,
} from './remote-input-ownership';
import { ProcessScanner, type ProcTargetSnapshot } from './remote-process-scanner';

type TargetSource = 'injected' | 'adopted';

export type InjectedTarget = {
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

export type BlockedHookReason =
	| 'foreign-hook'
	| 'homeback-log-missing'
	| 'injection-failed'
	| 'proc-maps-unreadable';

export type BlockedHook = {
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

export type InjectionFailure = {
	name: string;
	startTimeTicks: string;
	failures: number;
	nextAttemptAt: number;
	lastError: string;
};

type TargetIdentity = Pick<ProcTargetSnapshot, 'pid' | 'name' | 'startTimeTicks'>;

const INJECTION_VERIFY_DELAY_MS = 150;
const INJECTION_VERIFY_ATTEMPTS = 10;
const INJECTION_WATCHDOG_MS = 15_000;

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

export class InjectionManager {
	public readonly targets = new Map<number, InjectedTarget>();
	public readonly blockedHooks = new Map<number, BlockedHook>();
	public readonly injectionFailures = new Map<number, InjectionFailure>();

	public constructor(
		private readonly scanner: ProcessScanner,
		private readonly logTailer: EventLogTailer,
		private readonly inputHookLibraryPath: string,
		private readonly ezinjectPath: string,
		private readonly requestRescan: () => void,
		private readonly onStateChange: () => Promise<void>,
	) {}

	public async reconcile(procTargets: ReadonlyMap<number, ProcTargetSnapshot>): Promise<void> {
		await this.pruneDeadProcessState(procTargets);

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

	public async pruneDeadProcessState(
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

	public async isHomeBackHookPath(mappedPath: string): Promise<boolean> {
		if (isHomeBackMappedLibraryPath(mappedPath, this.inputHookLibraryPath, SERVICE_ID)) return true;

		try {
			const [mappedRealPath, expectedRealPath] = await Promise.all([
				fs.realpath(normalizeMappedLibraryPath(mappedPath)),
				fs.realpath(this.inputHookLibraryPath),
			]);
			return mappedRealPath === expectedRealPath;
		} catch {
			return false;
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

	private async recheckBlockedTarget(target: ProcTargetSnapshot, blocked: BlockedHook): Promise<void> {
		blocked.lastCheckedAt = Date.now();
		blocked.nextRecheckAt = blocked.lastCheckedAt + BLOCKED_RECHECK_MS;

		if (!target.mapsReadable) return;
		if (target.mappedHookPath) {
			await this.handleMappedHook(target, target.mappedHookPath);
			return;
		}
		if (blocked.reason === 'injection-failed') return;

		this.blockedHooks.delete(target.pid);
		this.injectionFailures.delete(target.pid);
		await this.inject(target);
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

			const liveIdentity = await this.scanner.readIdentity(pid);
			if (liveIdentity?.startTimeTicks !== startTimeTicks) {
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
		this.logTailer.add(logPath, fd!, offset, true);
		console.log(`Adopted existing HomeBack remote hook in ${name} (${pid}); reinjection skipped.`);
		await this.onStateChange();
	}

	private async inject(snapshot: ProcTargetSnapshot): Promise<void> {
		const { pid, name, startTimeTicks } = snapshot;
		const liveIdentity = await this.scanner.readIdentity(pid);
		if (liveIdentity?.startTimeTicks !== startTimeTicks) {
			this.requestRescan();
			return;
		}

		const inspection = await this.scanner.inspectMappedHook(pid);
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
			hookPath: this.inputHookLibraryPath,
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

			const child = spawn(this.ezinjectPath, ['-l', logPath, String(pid), this.inputHookLibraryPath], {
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

			const identity = await this.scanner.readIdentity(target.pid);
			if (identity?.startTimeTicks !== target.startTimeTicks) {
				console.warn(`Target PID ${target.pid} was reused while verifying ${target.name}; abandoning stale verification.`);
				await this.cleanupTarget(target.pid);
				this.requestRescan();
				return;
			}

			const inspection = await this.scanner.inspectMappedHook(target.pid);
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
				await this.onStateChange();
				return;
			}

			if (attempt < INJECTION_VERIFY_ATTEMPTS) {
				await new Promise(resolve => setTimeout(resolve, INJECTION_VERIFY_DELAY_MS));
			}
		}

		await this.failInjection(target, `verification failed: ${lastError}`);
	}

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
		await this.onStateChange();
		await Promise.all([
			fs.unlink(target.logPath).catch(() => undefined),
			fs.unlink(target.injectorLogPath).catch(() => undefined),
		]);
	}
}
