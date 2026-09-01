import type { RemoteActionRunner } from './remote-action-runner';
import { isTimedMapping, type RemoteConfig, type TimedMapping } from './remote-config.ts';

const DEFAULT_LONG_PRESS_MS = 650;
const ACTION_COOLDOWN_MS = 150;
const MAX_STUCK_PRESS_GRACE_MS = 5_000;

const UINPUT_SEND_MARKER = 'lginput_uinput_send_button called:';
const MICOM_WRITE_MARKER = 'MICOM_FuncWriteKeyEvent called:';
const DEV_UINPUT_MARKER = 'write to /dev/uinput:';
const UINPUT_SEND_PATTERN = /lginput_uinput_send_button called: keyid=\d+, state=(-?\d+) uinput_code=(\d+)/;
const MICOM_WRITE_PATTERN = /MICOM_FuncWriteKeyEvent called: fd=\d+, type=\d+, code=(\d+), value=(-?\d+)/;
const DEV_UINPUT_PATTERN = /write to \/dev\/uinput: code=(\d+), value=(-?\d+)/;

type ActivePress = {
	mapping: TimedMapping;
	startedAtMs: number;
	longFired: boolean;
	longTimer: NodeJS.Timeout | null;
	watchdogTimer: NodeJS.Timeout | null;
};

export type LastRemoteKeyEvent = {
	keycode: number;
	state: number;
	atMs: number;
};

const actionThreshold = (mapping: TimedMapping, config: RemoteConfig): number =>
	mapping.longPressMs ?? config.defaultLongPressMs ?? DEFAULT_LONG_PRESS_MS;

export class RemotePressStateMachine {
	private readonly activePresses = new Map<number, ActivePress>();
	private readonly lastActionAt = new Map<number, number>();
	private lastEvent: LastRemoteKeyEvent | null = null;

	public constructor(
		private readonly getConfig: () => RemoteConfig,
		private readonly actionRunner: RemoteActionRunner,
	) {}

	public get activeKeys(): number[] {
		return [...this.activePresses.keys()];
	}

	public get lastKeyEvent(): LastRemoteKeyEvent | null {
		return this.lastEvent;
	}

	public stop(): void {
		for (const [keycode, active] of [...this.activePresses.entries()]) {
			this.clearActivePress(keycode, active);
		}
	}

	public handleLogLine(line: string): void {
		let keycode: number | null = null;
		let state: number | null = null;

		if (line.includes(UINPUT_SEND_MARKER)) {
			const match = UINPUT_SEND_PATTERN.exec(line);
			if (match) {
				state = Number(match[1]);
				keycode = Number(match[2]);
			}
		} else if (line.includes(MICOM_WRITE_MARKER)) {
			const match = MICOM_WRITE_PATTERN.exec(line);
			if (match) {
				keycode = Number(match[1]);
				state = Number(match[2]);
			}
		} else if (line.includes(DEV_UINPUT_MARKER)) {
			const match = DEV_UINPUT_PATTERN.exec(line);
			if (match) {
				keycode = Number(match[1]);
				state = Number(match[2]);
			}
		}

		if (keycode === null || state === null) return;
		this.handleState(keycode, state);
	}

	private handleState(keycode: number, state: number): void {
		this.lastEvent = { keycode, state, atMs: Date.now() };
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

		const config = this.getConfig();
		const mapping = config.keys[String(keycode)];
		if (!mapping || !isTimedMapping(mapping) || this.activePresses.has(keycode)) return;

		const threshold = actionThreshold(mapping, config);
		const active: ActivePress = {
			mapping,
			startedAtMs: Date.now(),
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
			if (current !== active) return;

			const lastActionAt = this.lastActionAt.get(keycode) ?? 0;
			if (lastActionAt < active.startedAtMs) {
				console.warn(
					`[HomeBackRemote] unserviced timed key keycode=${keycode} thresholdMs=${threshold}`,
				);
			}
			console.warn(`Clearing stale remote key press for keycode ${keycode}.`);
			this.clearActivePress(keycode, active);
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
