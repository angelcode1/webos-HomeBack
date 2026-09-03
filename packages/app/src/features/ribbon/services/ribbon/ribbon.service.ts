import { makeAutoObservable, observable, reaction } from 'mobx';

import { ActivationService, type ActivationAction } from 'shared/services/activation';
import type { LaunchPointInstance } from 'shared/services/launcher';
import { LauncherService } from 'shared/services/launcher';
import { KeyboardService } from 'shared/services/keyboard';
import { SurfaceService } from 'shared/services/surface';

import { AppDrawerService } from '../app-drawer';
import { ScrollService } from '../scroll';
import { LauncherProviderWarningGate } from './launcher-provider-warning.lib';
import { RemoteHealthService } from './remote-health.service';
import { RIBBON_AUTO_HIDE_MS } from './ribbon.lib';

export class RibbonService {
	public visible = false;
	public moving = false;
	public deleteFocused = false;
	public numericKeypadVisible = false;

	private ref: HTMLElement | null = null;
	private index: number | null = null;
	private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
	private providerWarningVisible = false;
	private providerWarningGate: LauncherProviderWarningGate | null = null;

	public constructor(
		public readonly launcherService: LauncherService,
		public readonly scrollService: ScrollService,
		public readonly appDrawerService: AppDrawerService,
		private readonly activationService: ActivationService,
		private readonly surfaceService: SurfaceService,
		public readonly keyboardService: KeyboardService,
		private readonly remoteHealthService: RemoteHealthService,
	) {
		makeAutoObservable<
			RibbonService,
			| 'ref'
			| 'activationService'
			| 'surfaceService'
			| 'autoHideTimer'
			| 'providerWarningGate'
			| 'keyboardService'
			| 'remoteHealthService'
		>(
			this,
			{
				ref: observable.ref,
				activationService: false,
				surfaceService: false,
				autoHideTimer: false,
				providerWarningGate: false,
				keyboardService: false,
				remoteHealthService: false,
			},
			{ autoBind: true },
		);

		this.providerWarningGate = new LauncherProviderWarningGate(
			this.setProviderWarningVisible,
		);
		this.visible = activationService.initialAction.type === 'showLauncher';
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
				if (visible) this.surfaceService.requestLauncherVisible(true);
				else this.surfaceService.requestLauncherVisible(false);

				this.moving = false;
				this.deleteFocused = false;
				this.appDrawerService.close();
				if (!visible) this.numericKeypadVisible = false;
				this.remoteHealthService.setActive(visible);
			},
			{ fireImmediately: true },
		);

		// Ribbon owns feature-local state only. Global keyboard subscription and
		// owner priority are coordinated at the app level.
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

		reaction(
			() => this.launcherService.providerErrorCount,
			errorCount => this.providerWarningGate?.update(errorCount),
			{ fireImmediately: true },
		);

		activationService.emitter.on('action', this.handleActivation);
		surfaceService.emitter.on('requestLauncherHide', this.hide);
		surfaceService.emitter.on('dismissFeatures', this.hide);
		this.launcherService.emitter.on('openDrawer', this.openDrawer);
		this.launcherService.emitter.on('openNumericKeyboard', this.openNumericKeypad);
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
		if (this.remoteHealthService.warning) return this.remoteHealthService.warning;
		if (this.providerWarningVisible) {
			return 'Some launcher sources are unavailable. Reopen HomeBack or check system services.';
		}
		return null;
	}

	public noteInteraction(): void {
		this.scheduleAutoHide();
	}

	public show(): void {
		if (!this.surfaceService.requestLauncherVisible(true)) return;
		this.visible = true;
	}

	public hide(): void {
		this.visible = false;
		this.surfaceService.requestLauncherVisible(false);
	}

	public openNumericKeypad(): void {
		this.finishEditing();
		this.appDrawerService.close();
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

		this.appDrawerService.close();
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

	private setProviderWarningVisible(visible: boolean): void {
		this.providerWarningVisible = visible;
	}

	private handleActivation(action: ActivationAction): void {
		if (action.type === 'showLauncher') this.show();
		else if (action.type === 'toggleLauncher') this.toggle();
	}

	private toggle(): void {
		if (this.visible) this.hide();
		else this.show();
	}

	private openDrawer(): void {
		this.finishEditing();
		this.numericKeypadVisible = false;
		this.appDrawerService.open();
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
			) this.hide();
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
		else this.hide();
	}
}
