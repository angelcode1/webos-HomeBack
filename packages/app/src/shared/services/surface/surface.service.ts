import { makeAutoObservable, when } from 'mobx';
import mitt from 'mitt';

import { APPLICATION_MANAGER_URI } from 'shared/api/common';
import { luna } from 'shared/services/luna';
import { SystemInfoService } from 'shared/services/system-info';

const VISIBILITY_TRANSITION_MS = 500;
const HIDE_WAIT_TIMEOUT_MS = 2_000;

type SurfaceEvents = {
	dismissFeatures: void;
	requestLauncherHide: void;
};

export class SurfaceService {
	public readonly emitter = mitt<SurfaceEvents>();
	public yielding = false;

	private launcherRequested = false;
	private previewRequested = false;
	private visibilityTimer: ReturnType<typeof setTimeout> | null = null;
	private visibilityRevision = 0;
	private hiddenCommitted = false;
	private readonly hiddenWaiters = new Set<{
		resolve: () => void;
		reject: (error: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}>();

	public constructor(
		private readonly systemInfoService: SystemInfoService,
		startHidden = false,
	) {
		makeAutoObservable<
			SurfaceService,
			'systemInfoService' | 'visibilityTimer' | 'hiddenWaiters'
		>(
			this,
			{
				systemInfoService: false,
				visibilityTimer: false,
				hiddenWaiters: false,
			},
			{ autoBind: true },
		);

		// Only preload/no-op starts need an explicit startup hide. Normal launcher
		// and preview launches are already being shown by SAM and should not be
		// hidden while their feature services finish mounting.
		if (startHidden) this.scheduleVisibilityCommit();
	}

	public get requestedVisible(): boolean {
		return this.launcherRequested || this.previewRequested;
	}

	public get sdkVersion(): string | null {
		return this.systemInfoService.sdkVersion;
	}

	public get hideStrategy(): 'hide' | 'suspense' {
		return this.compositorShimsRequired ? 'suspense' : 'hide';
	}

	public requestLauncherVisible(visible: boolean): boolean {
		if (visible && this.yielding) return false;
		if (this.launcherRequested === visible) return true;
		this.launcherRequested = visible;
		this.scheduleVisibilityCommit();
		return true;
	}

	public requestPreviewVisible(visible: boolean): boolean {
		if (visible && this.yielding) return false;
		if (this.previewRequested === visible) return true;
		this.previewRequested = visible;

		// Hardware proved both FLOATING+activate and OVERLAY-without-activate web
		// surfaces own application input focus on the tested C5. If preview was the
		// last visible feature, Back/timeout must release that focus immediately,
		// not after Ribbon's cosmetic 500 ms transition window.
		if (!visible && !this.requestedVisible) this.commitHiddenNow();
		else this.scheduleVisibilityCommit();
		return true;
	}

	public requestLauncherHide(): void {
		if (this.launcherRequested) {
			this.launcherRequested = false;
			this.scheduleVisibilityCommit();
		}
		this.emitter.emit('requestLauncherHide');
	}

	public dismissFeatures(): void {
		const changed = this.launcherRequested || this.previewRequested;
		const previewWasRequested = this.previewRequested;
		this.launcherRequested = false;
		this.previewRequested = false;

		// Give feature owners a synchronous teardown point before hiding the
		// compositor surface. This matters once preview sources hold live sockets.
		this.emitter.emit('dismissFeatures');

		// A foreign launch while preview is up must immediately restore control to
		// the newly launched application. Ribbon-only dismissal keeps its normal
		// animation/commit delay.
		if (previewWasRequested) this.commitHiddenNow();
		else if (changed) this.scheduleVisibilityCommit();
	}

	public async yieldSurfaceAndWait(): Promise<void> {
		this.yielding = true;
		this.dismissFeatures();
		try {
			await this.waitUntilHidden();
		} finally {
			this.yielding = false;
		}
	}

	public async waitUntilHidden(): Promise<void> {
		if (this.requestedVisible) await when(() => !this.requestedVisible);
		if (this.hiddenCommitted) return;

		await new Promise<void>((resolve, reject) => {
			const waiter = {
				resolve,
				reject,
				timer: setTimeout(() => {
					this.hiddenWaiters.delete(waiter);
					reject(new Error('Timed out waiting for HomeBack surface to finish hiding.'));
				}, HIDE_WAIT_TIMEOUT_MS),
			};
			this.hiddenWaiters.add(waiter);
		});
	}

	private scheduleVisibilityCommit(): void {
		this.cancelVisibilityTimer();
		const revision = ++this.visibilityRevision;
		const visible = this.requestedVisible;
		if (visible) this.hiddenCommitted = false;

		this.visibilityTimer = setTimeout(() => {
			this.visibilityTimer = null;
			if (revision !== this.visibilityRevision || this.requestedVisible !== visible) return;

			if (visible) {
				webOSSystem.activate();
				return;
			}

			this.commitHiddenAndResolveWaiters();
		}, VISIBILITY_TRANSITION_MS);
	}

	private commitHiddenNow(): void {
		this.cancelVisibilityTimer();
		this.visibilityRevision++;
		this.commitHiddenAndResolveWaiters();
	}

	private commitHiddenAndResolveWaiters(): void {
		this.commitHidden();
		this.hiddenCommitted = true;
		for (const waiter of this.hiddenWaiters) {
			clearTimeout(waiter.timer);
			waiter.resolve();
		}
		this.hiddenWaiters.clear();
	}

	private cancelVisibilityTimer(): void {
		if (!this.visibilityTimer) return;
		clearTimeout(this.visibilityTimer);
		this.visibilityTimer = null;
	}

	private commitHidden(): void {
		if (this.hideStrategy === 'suspense') this.requestSuspense();
		else webOSSystem.hide();
	}

	private get compositorShimsRequired(): boolean {
		const major = this.systemInfoService.osMajorVersion;
		if (major === null) {
			// SystemInfo resolves asynchronously. On modern TVs the cold-preview
			// Back path can run before that request completes; default to the light
			// hide operation rather than suspending a just-launched application.
			return false;
		}
		if (major === 7) return (this.systemInfoService.osMinorVersion ?? 0) < 3;
		return major < 7;
	}

	private requestSuspense(): void {
		void luna(`${APPLICATION_MANAGER_URI}/suspense`, {
			id: process.env.APP_ID,
		}).catch(error => console.error('Unable to suspend HomeBack:', error));
	}
}
