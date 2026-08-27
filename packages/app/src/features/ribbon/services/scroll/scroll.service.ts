import { makeAutoObservable, observable, reaction, when } from 'mobx';

import { SettingsService } from 'shared/services/settings';

const ANIMATION_MS = 220;

const easeOutCubic = (progress: number): number =>
	1 - ((1 - progress) ** 3);

export class ScrollService {
	public container: HTMLElement | null = null;
	public selectedLaunchPointIndex: number | null = null;
	public enabled = false;

	private wheelShift = 0;
	private animationFrame: number | null = null;

	public constructor(private readonly settingsService: SettingsService) {
		makeAutoObservable<ScrollService, 'container' | 'settingsService'>(
			this,
			{
				container: observable.ref,
				settingsService: false,
			},
			{ autoBind: true },
		);

		when(
			() => this.container !== null,
			() => {
				reaction(
					() => this.selectedLaunchPointIndex,
					() => {
						this.wheelShift = this.focusedElementPosition;
					},
				);

				reaction(
					() => this.wheelShift,
					target => this.animateTo(target),
				);
			},
		);

		document.addEventListener('wheel', this.handleScroll, { passive: false });
	}

	public isAnimating(): boolean {
		return this.animationFrame !== null;
	}

	private animateTo(target: number): void {
		const container = this.container;
		if (!container) return;

		if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);

		const start = container.scrollLeft;
		const distance = target - start;
		if (Math.abs(distance) < 1) {
			container.scrollLeft = target;
			this.animationFrame = null;
			return;
		}

		const startedAt = performance.now();

		const step = (now: number): void => {
			const progress = Math.min(1, (now - startedAt) / ANIMATION_MS);
			container.scrollLeft = start + distance * easeOutCubic(progress);

			if (progress < 1) this.animationFrame = requestAnimationFrame(step);
			else this.animationFrame = null;
		};

		this.animationFrame = requestAnimationFrame(step);
	}

	private get focusedElementPosition(): number {
		const container = this.container;
		if (!container || this.selectedLaunchPointIndex === null) {
			return container?.scrollLeft ?? 0;
		}

		const element =
			container.children.length <= this.selectedLaunchPointIndex
				? container.lastElementChild
				: container.children[this.selectedLaunchPointIndex];
		if (!element) return container.scrollLeft;

		const box = element.getBoundingClientRect();
		const viewportWidth = container.clientWidth;

		if (box.left >= 0 && box.right <= viewportWidth) return container.scrollLeft;
		if (box.left < 0) return container.scrollLeft + box.left;
		return container.scrollLeft + box.right - viewportWidth;
	}

	private get shiftThreshold(): number {
		const container = this.container;
		if (!container) return 0;
		return Math.max(0, container.scrollWidth - container.clientWidth);
	}

	private handleScroll(event: WheelEvent): void {
		const container = this.container;
		if (!this.enabled || !container) return;

		const target = event.target;
		if (
			target instanceof Element &&
			target.closest('[data-homeback-wheel-owner="drawer"]')
		) return;

		event.preventDefault();

		const deltaScale =
			event.deltaMode === 1
				? 16
				: event.deltaMode === 2
					? container.clientWidth
					: 1;

		this.wheelShift +=
			event.deltaY * deltaScale * this.settingsService.wheelVelocityFactor;
		this.wheelShift = Math.max(0, Math.min(this.shiftThreshold, this.wheelShift));
	}
}
