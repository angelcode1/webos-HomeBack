import { makeAutoObservable, observable, reaction, when } from 'mobx';

import type { LaunchPointInstance } from 'shared/services/launcher';
import { LauncherService } from 'shared/services/launcher';
import { LifecycleManagerService } from 'shared/services/lifecycle-manager';

import { AppDrawerService } from '../app-drawer';
import { KeyboardService } from '../keyboard';
import { ScrollService } from '../scroll';

const VISIBILITY_TRANSITION_MS = 500;
const HIDE_WAIT_TIMEOUT_MS = 2_000;
const START_HIDDEN = webOSSystem.launchReason === 'preload';

export class RibbonService {
	public visible = false;
	public moving = false;
	public deleteFocused = false;

	private ref: HTMLElement | null = null;
	private index: number | null = null;
	private visibilityTimer: ReturnType<typeof setTimeout> | null = null;
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
		keyboardService: KeyboardService,
	) {
		makeAutoObservable<
			RibbonService,
			'ref' | 'lifecycleManager' | 'hiddenWaiters'
		>(
			this,
			{
				ref: observable.ref,
				lifecycleManager: false,
				hiddenWaiters: false,
			},
			{ autoBind: true },
		);

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

				if (visible) keyboardService.subscribe();
				else keyboardService.unsubscribe();
			},
		);

		reaction(
			() => [this.visible, this.appDrawerService.visible] as const,
			([visible, drawerVisible]) => {
				this.scrollService.enabled = visible && !drawerVisible;
			},
			{ fireImmediately: true },
		);

		reaction(
			() => this.index,
			index => {
				this.scrollService.selectedLaunchPointIndex = index;
			},
		);

		keyboardService.emitter.on('shiftX', this.handleShift);
		keyboardService.emitter.on('enter', this.handleEnter);
		keyboardService.emitter.on('hold', this.handleHold);
		keyboardService.emitter.on('up', this.handleUp);
		keyboardService.emitter.on('down', this.handleDown);
		keyboardService.emitter.on('back', this.handleBack);
		lifecycleManager.emitter.on('relaunch', this.toggle);
		lifecycleManager.emitter.on('requestHide', this.hide);
		this.launcherService.emitter.on('openDrawer', this.openDrawer);
	}

	public get selectedLaunchPoint(): LaunchPointInstance | null {
		return this.index !== null
			? this.launcherService.visible[this.index] ?? null
			: null;
	}

	public get canMoveEditingLeft(): boolean {
		return this.moving && this.index !== null && this.index > 0;
	}

	public get canMoveEditingRight(): boolean {
		if (!this.moving || this.index === null) return false;
		const editable = this.launcherService.visible.filter(lp => !lp.builtin);
		return this.index < editable.length - 1;
	}

	public ribbonRef(ref: HTMLElement | null): void {
		this.ref = ref;
		this.scrollService.container = ref;
	}

	public focusToLaunchPoint(launchPoint: LaunchPointInstance): void {
		if (!this.moving) this.index = this.launcherService.visible.indexOf(launchPoint);
	}

	public beginEditing(launchPoint?: LaunchPointInstance | null): void {
		const target = launchPoint ?? this.selectedLaunchPoint;
		if (!target || target.builtin) return;

		this.appDrawerService.visible = false;
		this.index = this.launcherService.visible.indexOf(target);
		if (this.index < 0) return;

		this.deleteFocused = false;
		this.moving = true;
	}

	public finishEditing(): void {
		if (!this.moving) return;
		this.moving = false;
		this.deleteFocused = false;
	}

	public focusDeleteControl(): void {
		if (this.moving) this.deleteFocused = true;
	}

	public focusMoveControl(): void {
		if (this.moving) this.deleteFocused = false;
	}

	public moveEditing(shift: number): void {
		if (!this.moving || this.index === null || (shift !== -1 && shift !== 1)) return;

		const launchPoint = this.selectedLaunchPoint;
		if (!launchPoint || launchPoint.builtin) return;

		const editable = this.launcherService.visible.filter(item => !item.builtin);
		const from = editable.indexOf(launchPoint);
		const to = from + shift;
		if (from < 0 || to < 0 || to >= editable.length) return;

		launchPoint.move(shift);
		this.index = to;
	}

	public removeEditingLaunchPoint(): void {
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

	private get mounted(): boolean {
		return Boolean(this.ref);
	}

	private toggle(): void {
		this.visible = !this.visible;
	}

	private openDrawer(): void {
		this.finishEditing();
		this.appDrawerService.visible = true;
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

	private handleUp(): void {
		if (this.moving) this.focusDeleteControl();
	}

	private handleDown(): void {
		if (this.moving) this.focusMoveControl();
	}

	private handleShift(shift: number): void {
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
		this.beginEditing(this.selectedLaunchPoint);
	}

	private handleBack(): void {
		if (this.moving) this.finishEditing();
		else this.visible = false;
	}
}
