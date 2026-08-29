import { makeAutoObservable, observable, reaction } from 'mobx';

import type { LaunchPointInstance } from 'shared/services/launcher';
import { LauncherService } from 'shared/services/launcher';
import { luna } from 'shared/services/luna';

import { AppDrawerService } from '../app-drawer';
import { KeyboardService } from '../keyboard';
import { ScrollService } from '../scroll';
import { RIBBON_AUTO_HIDE_MS } from './ribbon.lib';

const REMOTE_HEALTH_POLL_MS = 5_000;

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
	private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
	private remoteHealthTimer: ReturnType<typeof setInterval> | null = null;

	public constructor(
		public readonly launcherService: LauncherService,
		public readonly scrollService: ScrollService,
		public readonly appDrawerService: AppDrawerService,
		public readonly keyboardService: KeyboardService,
	) {
		makeAutoObservable<
			RibbonService,
			'ref' | 'autoHideTimer' | 'remoteHealthTimer' | 'keyboardService'
		>(
			this,
			{
				ref: observable.ref,
				autoHideTimer: false,
				remoteHealthTimer: false,
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

		reaction(
			() => this.visible,
			visible => {
				this.moving = false;
				this.deleteFocused = false;
				this.appDrawerService.visible = false;
				if (!visible) this.numericKeypadVisible = false;
				if (visible) void this.refreshRemoteHealth();
			},
		);

		reaction(
			() => [this.visible, this.moving, this.appDrawerService.visible, this.numericKeypadVisible] as const,
			([visible, _moving, drawerVisible, keypadVisible]) => {
				this.scrollService.enabled = visible && !drawerVisible && !keypadVisible;
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

		this.launcherService.emitter.on('openDrawer', this.openDrawer);
		this.launcherService.emitter.on('openNumericKeyboard', this.openNumericKeypad);

		this.remoteHealthTimer = setInterval(() => {
			if (this.visible) void this.refreshRemoteHealth();
		}, REMOTE_HEALTH_POLL_MS);
	}

	public dispose(): void {
		if (this.autoHideTimer !== null) clearTimeout(this.autoHideTimer);
		this.autoHideTimer = null;
		if (this.remoteHealthTimer !== null) clearInterval(this.remoteHealthTimer);
		this.remoteHealthTimer = null;
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

	public show(): void {
		this.visible = true;
	}

	public hide(): void {
		this.visible = false;
	}

	public toggle(): void {
		this.visible = !this.visible;
	}

	public dismissFeatures(): void {
		this.visible = false;
		this.moving = false;
		this.deleteFocused = false;
		this.appDrawerService.visible = false;
		this.numericKeypadVisible = false;
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
