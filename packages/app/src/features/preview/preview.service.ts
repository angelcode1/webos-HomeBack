import { makeAutoObservable } from 'mobx';

import type { PreviewRequest } from 'shared/services/activation';

import {
	clampPreviewDuration,
	PREVIEW_WATCHDOG_INTERVAL_MS,
} from './preview.lib';

export type ActivePreview = {
	url: string;
	title?: string;
	durationMs: number;
	startedAtMs: number;
	expiresAtMs: number;
};

export class PreviewService {
	public active: ActivePreview | null = null;

	private expiryTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly watchdogTimer: ReturnType<typeof setInterval>;

	public constructor() {
		makeAutoObservable<PreviewService, 'expiryTimer' | 'watchdogTimer'>(
			this,
			{
				expiryTimer: false,
				watchdogTimer: false,
			},
			{ autoBind: true },
		);

		this.watchdogTimer = setInterval(this.watchdog, PREVIEW_WATCHDOG_INTERVAL_MS);
	}

	public get visible(): boolean {
		return this.active !== null;
	}

	public show(request: PreviewRequest): void {
		const durationMs = clampPreviewDuration(request.durationMs);
		const startedAtMs = Date.now();
		this.active = {
			url: request.url,
			...(request.title ? { title: request.title } : {}),
			durationMs,
			startedAtMs,
			expiresAtMs: startedAtMs + durationMs,
		};
		this.armExpiry(durationMs);
	}

	public dismiss(): void {
		if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
		this.expiryTimer = null;
		this.active = null;
	}

	public dispose(): void {
		this.dismiss();
		clearInterval(this.watchdogTimer);
	}

	private armExpiry(durationMs: number): void {
		if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
		this.expiryTimer = setTimeout(() => {
			this.expiryTimer = null;
			this.dismiss();
		}, durationMs);
	}

	private watchdog(): void {
		const preview = this.active;
		if (preview && Date.now() >= preview.expiresAtMs) this.dismiss();
	}
}
