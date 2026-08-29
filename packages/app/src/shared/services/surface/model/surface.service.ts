import { makeAutoObservable } from 'mobx';

import { APPLICATION_MANAGER_URI } from 'shared/api/common';

import { luna } from '../../luna';
import { SystemInfoService } from '../../system-info';
import type { SurfaceCommitState, SurfaceSnapshot } from '../api/surface.interface';

export const SURFACE_TRANSITION_MS = 500;
export const SURFACE_HIDE_WAIT_TIMEOUT_MS = 2_000;

type HiddenWaiter = {
	resolve: () => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

export class SurfaceService {
	public requestedVisible = false;
	public committed: SurfaceCommitState = 'visible';

	private transitionTimer: ReturnType<typeof setTimeout> | null = null;
	private revision = 0;
	private readonly hiddenWaiters = new Set<HiddenWaiter>();

	public constructor(private readonly systemInfoService: SystemInfoService) {
		makeAutoObservable<SurfaceService, 'systemInfoService' | 'hiddenWaiters'>(
			this,
			{
				systemInfoService: false,
				hiddenWaiters: false,
			},
			{ autoBind: true },
		);
	}

	public get snapshot(): SurfaceSnapshot {
		return {
			requestedVisible: this.requestedVisible,
			committed: this.committed,
		};
	}

	public requestVisible(visible: boolean): void {
		if (this.requestedVisible === visible && this.transitionTimer !== null) return;
		if (this.requestedVisible === visible && this.isCommitted(visible)) return;

		this.requestedVisible = visible;
		this.scheduleCommit();
	}

	public async waitUntilHidden(): Promise<void> {
		if (!this.requestedVisible && this.committed === 'hidden') return;

		await new Promise<void>((resolve, reject) => {
			const waiter: HiddenWaiter = {
				resolve,
				reject,
				timer: setTimeout(() => {
					this.hiddenWaiters.delete(waiter);
					reject(new Error('Timed out waiting for HomeBack surface to hide.'));
				}, SURFACE_HIDE_WAIT_TIMEOUT_MS),
			};
			this.hiddenWaiters.add(waiter);
		});
	}

	public dispose(): void {
		if (this.transitionTimer !== null) clearTimeout(this.transitionTimer);
		this.transitionTimer = null;
		for (const waiter of this.hiddenWaiters) {
			clearTimeout(waiter.timer);
			waiter.reject(new Error('Surface service disposed before hide completed.'));
		}
		this.hiddenWaiters.clear();
	}

	private isCommitted(visible: boolean): boolean {
		return this.committed === (visible ? 'visible' : 'hidden');
	}

	private scheduleCommit(): void {
		if (this.transitionTimer !== null) clearTimeout(this.transitionTimer);
		const revision = ++this.revision;

		this.transitionTimer = setTimeout(() => {
			this.transitionTimer = null;
			if (revision !== this.revision) return;
			this.commit(this.requestedVisible);
		}, SURFACE_TRANSITION_MS);
	}

	private commit(visible: boolean): void {
		if (visible) {
			webOSSystem.activate();
			this.committed = 'visible';
			return;
		}

		if (this.compositorShimsRequired) this.requestSuspense();
		else webOSSystem.hide();
		this.committed = 'hidden';
		this.resolveHiddenWaiters();
	}

	private resolveHiddenWaiters(): void {
		for (const waiter of this.hiddenWaiters) {
			clearTimeout(waiter.timer);
			waiter.resolve();
		}
		this.hiddenWaiters.clear();
	}

	private get compositorShimsRequired(): boolean {
		if (this.systemInfoService.osMajorVersion === 7) {
			return (this.systemInfoService.osMinorVersion ?? 0) < 3;
		}

		return this.systemInfoService.osMajorVersion
			? this.systemInfoService.osMajorVersion < 7
			: true;
	}

	private requestSuspense(): void {
		void luna(`${APPLICATION_MANAGER_URI}/suspense`, {
			id: process.env.APP_ID,
		}).catch(error => console.error('Unable to suspend HomeBack:', error));
	}
}
