import { makeAutoObservable } from 'mobx';

import type { PreviewLaunchPayload } from 'shared/api/common';
import { ActivationService, type ActivationAction } from 'shared/services/activation';
import { KeyboardService } from 'shared/services/keyboard';
import { SurfaceService } from 'shared/services/surface';

import {
	normalizePreviewPayload,
	PREVIEW_WATCHDOG_INTERVAL_MS,
	type PreviewPayload,
} from './preview.lib';

export class PreviewService {
	public visible = false;
	public payload: PreviewPayload | null = null;

	private primaryTimer: ReturnType<typeof setTimeout> | null = null;
	private watchdogTimer: ReturnType<typeof setInterval> | null = null;
	private deadlineMs = 0;
	private timerRevision = 0;

	public constructor(
		private readonly activationService: ActivationService,
		private readonly surfaceService: SurfaceService,
		keyboardService: KeyboardService,
	) {
		makeAutoObservable<PreviewService, 'activationService' | 'surfaceService'>(
			this,
			{
				activationService: false,
				surfaceService: false,
			},
			{ autoBind: true },
		);

		keyboardService.registerOwner('preview', {
			back: () => this.dismiss('back'),
		});

		activationService.emitter.on('action', this.handleAction);
		surfaceService.emitter.on('dismissFeatures', () => this.dismiss('feature-dismiss'));

		if (activationService.initialAction.type === 'showPreview') {
			this.show(activationService.initialAction.preview);
		}
	}

	public show(input: PreviewLaunchPayload): boolean {
		const payload = normalizePreviewPayload(input);
		if (!payload) {
			this.dismiss('non-interactive');
			return false;
		}
		if (!this.surfaceService.requestPreviewVisible(true)) return false;

		this.clearTimers();
		this.payload = payload;
		this.visible = true;
		this.armDeadline(payload.durationMs);
		// Keep this diagnostic free of camera title/message/image data. It exists to
		// distinguish a cold unresolved-SDK hide path from compositor behaviour.
		console.warn(
			`[HomeBackPreview] show durationMs=${payload.durationMs} ` +
			`sdkVersion=${this.surfaceService.sdkVersion ?? 'pending/unknown'} ` +
			`hideStrategy=${this.surfaceService.hideStrategy}`,
		);
		return true;
	}

	public dismiss(reason = 'dismiss'): void {
		const wasVisible = this.visible || this.payload !== null;
		this.clearTimers();
		this.visible = false;
		this.payload = null;
		this.surfaceService.requestPreviewVisible(false);
		if (wasVisible) console.warn(`[HomeBackPreview] dismissed reason=${reason}`);
	}

	private handleAction(action: ActivationAction): void {
		if (action.type === 'showPreview') this.show(action.preview);
	}

	private armDeadline(durationMs: number): void {
		const revision = ++this.timerRevision;
		this.deadlineMs = Date.now() + durationMs;

		this.primaryTimer = setTimeout(() => {
			if (revision !== this.timerRevision) return;
			this.primaryTimer = null;
			this.dismiss('timeout');
		}, durationMs);

		// Independent deadline watchdog: a lost/replaced primary timeout cannot
		// leave a network-triggered preview owning the remote indefinitely.
		this.watchdogTimer = setInterval(() => {
			if (revision !== this.timerRevision || !this.visible) return;
			if (Date.now() >= this.deadlineMs) this.dismiss('watchdog');
		}, PREVIEW_WATCHDOG_INTERVAL_MS);
	}

	private clearTimers(): void {
		this.timerRevision++;
		this.deadlineMs = 0;
		if (this.primaryTimer) clearTimeout(this.primaryTimer);
		if (this.watchdogTimer) clearInterval(this.watchdogTimer);
		this.primaryTimer = null;
		this.watchdogTimer = null;
	}
}
