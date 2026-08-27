import { makeAutoObservable, observable, reaction } from 'mobx';

import { LauncherService, type LaunchPointInstance } from 'shared/services/launcher';

import { KeyboardService } from '../keyboard';
import { wheelShiftFromDelta } from './app-drawer.lib';

const WHEEL_DETENT_COOLDOWN_MS = 90;

export class AppDrawerService {
	public visible = false;
	private index = 0;
	private ref: HTMLElement | null = null;
	private lastWheelShiftAt = 0;
	private lastWheelDirection: -1 | 0 | 1 = 0;

	public constructor(
		private readonly launcherService: LauncherService,
		keyboardService: KeyboardService,
	) {
		makeAutoObservable<AppDrawerService, 'ref' | 'launcherService'>(
			this,
			{ ref: observable.ref, launcherService: false },
			{ autoBind: true },
		);

		reaction(
			() => this.ref,
			ref => {
				if (ref && this.visible) keyboardService.subscribe(document, true);
				else keyboardService.unsubscribe();
			},
		);

		reaction(
			() => this.visible,
			visible => {
				this.lastWheelShiftAt = 0;
				this.lastWheelDirection = 0;
				if (visible && this.ref) {
					keyboardService.subscribe(document, true);
					this.ref.focus();
				} else {
					keyboardService.unsubscribe();
				}
			},
		);

		reaction(
			() => this.items.length,
			length => {
				this.index = length === 0 ? 0 : Math.min(this.index, length - 1);
			},
		);

		keyboardService.emitter.on('shiftY', this.handleShift);
		keyboardService.emitter.on('enter', this.handleEnter);
		keyboardService.emitter.on('back', this.handleBack);
	}

	public get items(): LaunchPointInstance[] {
		return this.launcherService.hidden;
	}

	public containerRef(ref: HTMLElement | null): void {
		this.ref = ref;
		if (ref && this.visible) ref.focus();
	}

	public isSelected(launchPoint: LaunchPointInstance): boolean {
		return this.items[this.index] === launchPoint;
	}

	public focusToLaunchPoint(launchPoint: LaunchPointInstance): void {
		const index = this.items.indexOf(launchPoint);
		if (index >= 0) this.index = index;
	}

	public activate(launchPoint: LaunchPointInstance): void {
		this.focusToLaunchPoint(launchPoint);
		launchPoint.show();
		this.visible = false;
	}

	public handleWheel(deltaY: number): void {
		if (!this.visible || this.items.length === 0) return;

		const shift = wheelShiftFromDelta(deltaY);
		if (shift === 0) return;

		const now = performance.now();
		if (
			shift === this.lastWheelDirection &&
			now - this.lastWheelShiftAt < WHEEL_DETENT_COOLDOWN_MS
		) return;

		this.lastWheelShiftAt = now;
		this.lastWheelDirection = shift;
		this.handleShift(shift);
	}

	private handleShift(shift: number): void {
		if (!this.visible || this.items.length === 0) return;
		this.index = Math.min(Math.max(0, this.index + shift), this.items.length - 1);
	}

	private handleEnter(): void {
		if (!this.visible) return;
		const launchPoint = this.items[this.index];
		if (launchPoint) this.activate(launchPoint);
		else this.visible = false;
	}

	private handleBack(): void {
		if (this.visible) this.visible = false;
	}
}
