import { makeAutoObservable, observable, reaction, when } from 'mobx';

import { Intent, parseActivateType } from 'shared/api/common';
import type { LaunchPointInstance } from 'shared/services/launcher';
import { LauncherService } from 'shared/services/launcher';
import { LifecycleManagerService } from 'shared/services/lifecycle-manager';
import { luna } from 'shared/services/luna';

import { AppDrawerService } from '../app-drawer';
import { KeyboardService } from '../keyboard';
import { ScrollService } from '../scroll';
import { RIBBON_AUTO_HIDE_MS } from './ribbon.lib';

const VISIBILITY_TRANSITION_MS = 500;
const HIDE_WAIT_TIMEOUT_MS = 2_000;
const REMOTE_HEALTH_POLL_MS = 5_000;
const INITIAL_ACTIVATION = parseActivateType(webOSSystem.launchParams);
const START_HIDDEN =
	webOSSystem.launchReason === 'preload' &&
	INITIAL_ACTIVATION.intent !== Intent.ShowHomeBack &&
	INITIAL_ACTIVATION.activateType !== 'home';

type RemoteStatusResponse = {
	returnValue: true;
	status: {
		legacyInputHookDetected?: boolean;
		blockedHooks?: Array<{ name?: string; reason?: string; recovery?: string }>;
	};
};

export class RibbonService {
	public visible = false;
	public moving = false;
	public deleteFocused = false;
	public numericKeypadVisible = false;
	public remoteWarning: string | null = null;

	private ref: HTMLElement | null = null;
	private index: number | null = null;
	private visibilityTimer: ReturnType<typeof setTimeout> | null = null;
	private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
	private remoteHealthInterval: ReturnType<typeof setInterval> | null = null;
	private visibilityRevision = 0;
	private hiddenCommitted = START_HIDDEN;
	private readonly hiddenWaiters = new Set<{
		resolve: () => void;
		reject: (error: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}>();

	public constructor(
		public readonly launcherService: LauncherService,
		public readonly scrollService: ScrollService,
		public readonly appDrawerService: AppDrawerService,
		private readonly lifecycleManager: LifecycleManagerService,
		public readonly keyboardService: KeyboardService,
	) {
		makeAutoObservable<
			RibbonService,
			'ref' | 'lifecycleManager' | 'hiddenWaiters' | 'autoHideTimer' | 'remoteHealthInterval' | 'keyboardService'
		>(
			this,
			{
				ref: observable.ref,
				lifecycleManager: false,
				hiddenWaiters: false,
				autoHideTimer: false,
				remoteHealthInterval: false,
				keyboardService: false,
			},
			{ autoBind: true },
		);

		this.scrollService.setInteractionHandler(this.noteInteraction);
		keyboardService.registerOwner('ribbon', {
			horizontal: this.handleShift,
			vertical: this.handleVertical,
			enter: this.handleEnter,
			hold: this.handleHold,
			back: this.handleBack,
		});

		lifecycleManager.bindVisibilityController({
			isVisible: () => this.visible,
			requestHide: this.hide,
			waitUntilHidden: this.waitUntilHidden,
		});

		when(
			() => this.mounted && this.launcherService.fulfilled,
			() => {
				if (START_HIDDEN) {
					this.visible = false;
					this.lifecycleManager.commitHidden();
				} else {
					this.visible = true;
				}
			},
		);

		reaction(
			() => this.visible,
			visible => {
				this.scheduleVisibilityCommit(visible);
				this.moving = false;
				this.deleteFocused = false;
				this.appDrawerService.visible = false;
				if (!visible) this.numericKeypadVisible = false;

				if (visible) {
					keyboardService.subscribe(document, true);
					void this.refreshRemoteHealth();
				} else {
					keyboardService.unsubscribe();
				}
			},
		);

		// One UI-state reaction owns scroll routing, key ownership and auto-hide.
		reaction(
			() => [this.visible, this.moving, this.appDrawerService.visible, this.numericKeypadVisible] as const,
			([visible, _moving, drawerVisible, keypadVisible]) => {
				this.scrollService.enabled = visible && !drawerVisible && !keypadVisible;
				keyboardService.setOwner(keypadVisible ? 'keypad' : drawerVisible ? 'drawer' : 'ribbon');
				this.scheduleAutoHide();
			},
			{ fireImmediately: true },
		);

		reaction(
			() => this.index,
			index => {
				this.scrollService.selectedLaunchPointIndex = index;
			},
		);

		lifecycleManager.emitter.on('relaunch', this.toggle);
		lifecycleManager.emitter.on('requestHide', this.hide);
		this.launcherService.emitter.on('openDrawer', this.openDrawer);
		this.launcherService.emitter.on('openNumericKeyboard', this.openNumericKeypad);

		this.remoteHealthInterval = setInterval(() => {
			if (this.visible) void this.refreshRemoteHealth();
		}, REMOTE_HEALTH_POLL_MS);
	}

	public get selectedLaunchPoint(): LaunchPointInstance | null {
		return this.index !== null
			? this.launcherService.visible[this.index] ?? null
			: null;
	}

	public get canMoveEditingLeft(): boolean {
		if (!this.moving) return false;
		const selected = this.selectedLaunchPoint;
		if (!selected || selected.builtin) return false;
		return this.launcherService.visible.filter(item => !item.builtin).indexOf(selected) > 0;
	}

	public get canMoveEditingRight(): boolean {
		if (!this.moving) return false;
		const selected = this.selectedLaunchPoint;
		if (!selected || selected.builtin) return false;
		const editable = this.launcherService.visible.filter(item => !item.builtin);
		const editableIndex = editable.indexOf(selected);
		return editableIndex >= 0 && editableIndex < editable.length - 1;
	}

	public get warningText(): string | null {
		if (this.remoteWarning) return this.remoteWarning;
		if (this.launcherService.providerErrorCount > 0) {
			return 'Some launcher sources are unavailable. Reopen HomeBack or check system services.';
		}
		return null;
	}

	public noteInteraction(): void {
		this.scheduleAutoHide();
	}

	public openNumericKeypad(): void {
		this.finishEditing();
		this.appDrawerService.visible = false;
		this.numericKeypadVisible = true;
	}

	public closeNumericKeypad(): void {
		if (!this.numericKeypadVisible) return;
		this.numericKeypadVisible = false;
	}

	public ribbonRef(ref: HTMLElement | null): void {
		this.ref = ref;
		this.scrollService.container = ref;
	}

	public focusToLaunchPoint(launchPoint: LaunchPointInstance): void {
		this.noteInteraction();
		if (!this.moving) this.index = this.launcherService.visible.indexOf(launchPoint);
	}

	public beginEditing(launchPoint?: LaunchPointInstance | null): void {
		this.noteInteraction();
		const target = launchPoint ?? this.selectedLaunchPoint;
		if (!target || target.builtin) return;

		this.appDrawerService.visible = false;
		this.index = this.launcherService.visible.indexOf(target);
		if (this.index < 0) return;

		this.deleteFocused = false;
		this.moving = true;
	}

	public finishEditing(): void {
		this.noteInteraction();
		if (!this.moving) return;
		this.moving = false;
		this.deleteFocused = false;
	}

	public focusDeleteControl(): void {
		this.noteInteraction();
		if (this.moving) this.deleteFocused = true;
	}

	public focusMoveControl(): void {
		this.noteInteraction();
		if (this.moving) this.deleteFocused = false;
	}

	public moveEditing(shift: number): void {
		this.noteInteraction();
		if (!this.moving || (shift !== -1 && shift !== 1)) return;
		const launchPoint = this.selectedLaunchPoint;
		if (!launchPoint || launchPoint.builtin) return;

		const editable = this.launcherService.visible.filter(item => !item.builtin);
		const from = editable.indexOf(launchPoint);
		const to = from + shift;
		if (from < 0 || to < 0 || to >= editable.length) return;

		launchPoint.move(shift);
		this.index = this.launcherService.visible.indexOf(launchPoint);
	}

	public removeEditingLaunchPoint(): void {
		this.noteInteraction();
		if (!this.moving) return;
		const launchPoint = this.selectedLaunchPoint;
		if (!launchPoint || launchPoint.builtin) return;

		const oldIndex = this.index ?? 0;
		launchPoint.hide();
		this.moving = false;
		this.deleteFocused = false;
		const max = this.launcherService.visible.length - 1;
		this.index = max >= 0 ? Math.min(oldIndex, max) : null;
	}

	public hide(): void {
		this.visible = false;
	}

	public async waitUntilHidden(): Promise<void> {
		if (!this.visible && this.hiddenCommitted) return;
		await when(() => !this.visible);
		if (this.hiddenCommitted) return;

		await new Promise<void>((resolve, reject) => {
			const waiter = {
				resolve,
				reject,
				timer: setTimeout(() => {
					this.hiddenWaiters.delete(waiter);
					reject(new Error('Timed out waiting for HomeBack to finish hiding.'));
				}, HIDE_WAIT_TIMEOUT_MS),
			};
			this.hiddenWaiters.add(waiter);
		});
	}

	public dispose(): void {
		if (this.remoteHealthInterval) {
			clearInterval(this.remoteHealthInterval);
			this.remoteHealthInterval = null;
		}
		if (this.visibilityTimer) {
			clearTimeout(this.visibilityTimer);
			this.visibilityTimer = null;
		}
		if (this.autoHideTimer) {
			clearTimeout(this.autoHideTimer);
			this.autoHideTimer = null;
		}
		this.keyboardService.unsubscribe();
		this.keyboardService.unregisterOwner('ribbon');
		this.lifecycleManager.emitter.off('relaunch', this.toggle);
		this.lifecycleManager.emitter.off('requestHide', this.hide);
		this.launcherService.emitter.off('openDrawer', this.openDrawer);
		this.launcherService.emitter.off('openNumericKeyboard', this.openNumericKeypad);
	}

	private get mounted(): boolean {
		return Boolean(this.ref);
	}

	private toggle(): void {
		this.visible = !this.visible;
	}

	private openDrawer(): void {
		this.finishEditing();
		this.numericKeypadVisible = false;
		this.appDrawerService.visible = true;
	}

	private scheduleAutoHide(): void {
		if (this.autoHideTimer) {
			clearTimeout(this.autoHideTimer);
			this.autoHideTimer = null;
		}

		if (
			!this.visible ||
			this.moving ||
			this.appDrawerService.visible ||
			this.numericKeypadVisible
		) return;

		this.autoHideTimer = setTimeout(() => {
			this.autoHideTimer = null;
			if (
				this.visible &&
				!this.moving &&
				!this.appDrawerService.visible &&
				!this.numericKeypadVisible
			) this.visible = false;
		}, RIBBON_AUTO_HIDE_MS);
	}

	private scheduleVisibilityCommit(visible: boolean): void {
		if (this.visibilityTimer) clearTimeout(this.visibilityTimer);
		const revision = ++this.visibilityRevision;
		if (visible) this.hiddenCommitted = false;

		this.visibilityTimer = setTimeout(() => {
			this.visibilityTimer = null;
			if (revision !== this.visibilityRevision || this.visible !== visible) return;

			if (visible) {
				this.lifecycleManager.commitVisible();
				return;
			}

			this.lifecycleManager.commitHidden();
			this.hiddenCommitted = true;
			for (const waiter of this.hiddenWaiters) {
				clearTimeout(waiter.timer);
				waiter.resolve();
			}
			this.hiddenWaiters.clear();
		}, VISIBILITY_TRANSITION_MS);
	}

	private focusToFirstVisibleNode(): void {
		for (const [index, child] of Array.from(this.ref?.children ?? []).entries()) {
			if (child.getBoundingClientRect().left >= 0) {
				this.index = index;
				return;
			}
		}
	}

	private handleVertical(shift: number): void {
		this.noteInteraction();
		if (!this.moving) return;
		if (shift < 0) this.focusDeleteControl();
		else this.focusMoveControl();
	}

	private handleShift(shift: number): void {
		this.noteInteraction();
		if (this.index === null) {
			this.focusToFirstVisibleNode();
			return;
		}

		if (this.moving) {
			if (!this.deleteFocused) this.moveEditing(shift);
			return;
		}

		const max = this.launcherService.visible.length - 1;
		this.index = Math.max(0, Math.min(max, this.index + shift));
	}

	private handleEnter(): void {
		this.noteInteraction();
		if (this.moving) {
			if (this.deleteFocused) this.removeEditingLaunchPoint();
			else this.finishEditing();
			return;
		}

		void this.selectedLaunchPoint?.launch().catch(error => {
			console.error('Launch failed:', error);
		});
	}

	private handleHold(): void {
		this.noteInteraction();
		this.beginEditing(this.selectedLaunchPoint);
	}

	private handleBack(): void {
		this.noteInteraction();
		if (this.moving) this.finishEditing();
		else this.visible = false;
	}

	private async refreshRemoteHealth(): Promise<void> {
		try {
			const response = await luna<RemoteStatusResponse>(
				`luna://${process.env.SERVICE_ID}/remote/status`,
			);
			if (response.status.legacyInputHookDetected) {
				this.remoteWarning = 'Another input hook is active. Reboot after removing the conflicting hook.';
				return;
			}

			const blocked = (response.status.blockedHooks ?? []).find(item =>
				item.reason === 'foreign-hook' ||
				item.reason === 'injection-failed' ||
				item.reason === 'homeback-log-missing',
			);
			this.remoteWarning = blocked
				? `Remote hook issue${blocked.name ? ` (${blocked.name})` : ''}: ${blocked.recovery ?? 'reboot and check HomeBack diagnostics.'}`
				: null;
		} catch (error) {
			if (__DEV__) console.warn('Unable to read HomeBack remote-input health:', error);
		}
	}
}
