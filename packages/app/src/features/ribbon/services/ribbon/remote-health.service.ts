import { makeAutoObservable } from 'mobx';

import { luna } from 'shared/services/luna';

const REMOTE_HEALTH_POLL_MS = 5_000;

type RemoteStatusResponse = {
	returnValue: true;
	status: {
		legacyInputHookDetected?: boolean;
		blockedHooks?: Array<{ name?: string; reason?: string; recovery?: string }>;
	};
};

export class RemoteHealthService {
	public warning: string | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;
	private active = false;
	private refreshInFlight = false;

	public constructor() {
		makeAutoObservable<RemoteHealthService, 'timer' | 'refreshInFlight'>(
			this,
			{ timer: false, refreshInFlight: false },
			{ autoBind: true },
		);
	}

	public setActive(active: boolean): void {
		if (this.active === active) return;
		this.active = active;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		if (!active) return;

		this.refreshGuarded();
		this.timer = setInterval(this.refreshGuarded, REMOTE_HEALTH_POLL_MS);
	}

	private refreshGuarded(): void {
		if (!this.active || this.refreshInFlight) return;
		this.refreshInFlight = true;
		void this.refresh()
			.catch(error => {
				if (__DEV__) console.warn('Unable to read HomeBack remote-input health:', error);
			})
			.finally(() => {
				this.refreshInFlight = false;
			});
	}

	private async refresh(): Promise<void> {
		const response = await luna<RemoteStatusResponse>(
			`luna://${process.env.SERVICE_ID}/remote/status`,
		);
		if (response.status.legacyInputHookDetected) {
			this.warning = 'Another input hook is active. Reboot after removing the conflicting hook.';
			return;
		}

		const blocked = (response.status.blockedHooks ?? []).find(item =>
			item.reason === 'foreign-hook' ||
			item.reason === 'injection-failed' ||
			item.reason === 'homeback-log-missing',
		);
		this.warning = blocked
			? `Remote hook issue${blocked.name ? ` (${blocked.name})` : ''}: ${blocked.recovery ?? 'reboot and check HomeBack diagnostics.'}`
			: null;
	}
}
