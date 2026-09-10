import type { RecentCameraEntry } from './notification';

const SURFACE_MANAGER_FOREGROUND_URI =
	'luna://com.webos.surfacemanager/getForegroundAppInfo';
const MULTIVIEW_LAUNCH_URI =
	'luna://com.webos.service.multiviewcontroller/launchApps';
const APPLICATION_CLOSE_URI =
	'luna://com.webos.service.applicationmanager/closeByAppId';

const CARD_WINDOW_TYPE = '_WEBOS_WINDOW_TYPE_CARD';
const MULTIVIEW_VIEW_TYPE = 'mvpip';
const NORMAL_VIEW_TYPE = 'normal';
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_ADMISSION_CHECKS = 11;
const DEFAULT_PIP_APP_ID = 'com.homebrew.homeback.camera';

export const AUTOMATIC_PIP_MAIN_APP_IDS = [
	'com.webos.app.livetv',
	'youtube.leanback.v4',
] as const;

const automaticMainAppIds = new Set<string>(AUTOMATIC_PIP_MAIN_APP_IDS);

export type PipCameraLunaCall = (
	uri: string,
	params?: Record<string, unknown>,
	timeoutMs?: number,
) => Promise<Record<string, unknown>>;

export type PipCameraPresenterOptions = {
	call: PipCameraLunaCall;
	pipAppId?: string;
	pollIntervalMs?: number;
	admissionChecks?: number;
	sleep?: (milliseconds: number) => Promise<void>;
};

export type PipCameraPresenterStatus = {
	pipCompanionAppId: string;
	pipLastOutcome: 'idle' | 'shown' | 'fallback';
	pipLastReason: string | null;
	pipLastMainAppId: string | null;
	pipSessionActive: boolean;
};

type SurfaceApp = {
	appId: string;
	windowType: string | null;
	viewType: string | null;
	multiview: boolean | null;
	pip: boolean | null;
	primary: boolean | null;
};

type SurfaceSnapshot = {
	mode: string | null;
	apps: SurfaceApp[];
};

const sleep = (milliseconds: number): Promise<void> =>
	new Promise(resolve => setTimeout(resolve, milliseconds));

const optionalString = (value: unknown): string | null =>
	typeof value === 'string' ? value : null;

const optionalBoolean = (value: unknown): boolean | null =>
	typeof value === 'boolean' ? value : null;

const parseSurfaceApp = (value: unknown): SurfaceApp | null => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const appId = optionalString(record.appId);
	if (!appId) return null;
	return {
		appId,
		windowType: optionalString(record.windowType),
		viewType: optionalString(record.viewType),
		multiview: optionalBoolean(record.multiview),
		pip: optionalBoolean(record.pip),
		primary: optionalBoolean(record.primary),
	};
};

const parseSurfaceSnapshot = (value: Record<string, unknown>): SurfaceSnapshot => ({
	mode: optionalString(value.mode),
	apps: Array.isArray(value.foregroundAppInfo)
		? value.foregroundAppInfo
				.map(parseSurfaceApp)
				.filter((app): app is SurfaceApp => app !== null)
		: [],
});

const isAutomaticMain = (app: SurfaceApp): boolean =>
	automaticMainAppIds.has(app.appId) &&
	app.windowType === CARD_WINDOW_TYPE &&
	app.viewType === NORMAL_VIEW_TYPE &&
	app.multiview !== true &&
	app.pip !== true &&
	app.primary !== false;

const isMainPipSurface = (app: SurfaceApp, mainAppId: string): boolean =>
	app.appId === mainAppId &&
	app.windowType === CARD_WINDOW_TYPE &&
	app.viewType === MULTIVIEW_VIEW_TYPE &&
	app.multiview === true &&
	app.pip === false &&
	app.primary === true;

const isCompanionPipSurface = (app: SurfaceApp, pipAppId: string): boolean =>
	app.appId === pipAppId &&
	app.windowType === CARD_WINDOW_TYPE &&
	app.viewType === MULTIVIEW_VIEW_TYPE &&
	app.multiview === true &&
	app.pip === true &&
	app.primary === false;

const activePipMain = (snapshot: SurfaceSnapshot, pipAppId: string): string | null => {
	const companion = snapshot.apps.find(app => isCompanionPipSurface(app, pipAppId));
	if (!companion) return null;
	const main = snapshot.apps.find(
		app => automaticMainAppIds.has(app.appId) && isMainPipSurface(app, app.appId),
	);
	return main?.appId ?? null;
};

const boundedDuration = (durationMs: number): number =>
	Number.isFinite(durationMs) ? Math.max(1_000, Math.min(10_000, Math.trunc(durationMs))) : 8_000;

export class PipCameraPresenter {
	private readonly call: PipCameraLunaCall;
	private readonly pipAppId: string;
	private readonly pollIntervalMs: number;
	private readonly admissionChecks: number;
	private readonly wait: (milliseconds: number) => Promise<void>;
	private inFlight: Promise<boolean> | null = null;
	private closeTimer: NodeJS.Timeout | null = null;
	private lastOutcome: PipCameraPresenterStatus['pipLastOutcome'] = 'idle';
	private lastReason: string | null = null;
	private lastMainAppId: string | null = null;
	private sessionActive = false;

	public constructor(options: PipCameraPresenterOptions) {
		this.call = options.call;
		this.pipAppId = options.pipAppId ?? DEFAULT_PIP_APP_ID;
		this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		this.admissionChecks = options.admissionChecks ?? DEFAULT_ADMISSION_CHECKS;
		this.wait = options.sleep ?? sleep;
	}

	public status(): PipCameraPresenterStatus {
		return {
			pipCompanionAppId: this.pipAppId,
			pipLastOutcome: this.lastOutcome,
			pipLastReason: this.lastReason,
			pipLastMainAppId: this.lastMainAppId,
			pipSessionActive: this.sessionActive,
		};
	}

	public async present(camera: RecentCameraEntry): Promise<boolean> {
		const existingAttempt = this.inFlight;
		if (existingAttempt) {
			const shown = await existingAttempt;
			if (shown) this.scheduleClose(camera.durationMs);
			return shown;
		}

		const attempt = this.presentOnce();
		this.inFlight = attempt;
		try {
			const shown = await attempt;
			if (shown) this.scheduleClose(camera.durationMs);
			return shown;
		} finally {
			if (this.inFlight === attempt) this.inFlight = null;
		}
	}

	public async stop(): Promise<void> {
		this.clearCloseTimer();
		this.sessionActive = false;
		await this.closeCompanion();
	}

	private async presentOnce(): Promise<boolean> {
		let initial: SurfaceSnapshot;
		try {
			initial = await this.readSurface();
		} catch (error) {
			this.recordFallback('foreground-query-failed', null, error);
			return false;
		}

		const retainedMain = activePipMain(initial, this.pipAppId);
		if (retainedMain) {
			this.recordShown(retainedMain, 'already-active');
			return true;
		}

		if (initial.apps.length !== 1 || initial.mode === 'multiview') {
			this.recordFallback('foreground-not-single', null);
			return false;
		}

		const [main] = initial.apps;
		if (!isAutomaticMain(main)) {
			this.recordFallback('main-not-allowlisted', main.appId);
			return false;
		}

		try {
			await this.call(MULTIVIEW_LAUNCH_URI, {
				apps: [
					{ appId: main.appId, role: 'main', order: 0 },
					{ appId: this.pipAppId, role: 'sub', order: 1 },
				],
				mode: 'pip',
			});
		} catch (error) {
			this.recordFallback('launch-rejected', main.appId, error);
			await this.closeCompanion();
			return false;
		}

		for (let check = 0; check < this.admissionChecks; check += 1) {
			if (check > 0) await this.wait(this.pollIntervalMs);
			try {
				const current = await this.readSurface();
				if (this.isAdmitted(current, main.appId)) {
					this.recordShown(main.appId, 'admitted');
					return true;
				}
			} catch (error) {
				if (check === this.admissionChecks - 1) {
					this.recordFallback('admission-query-failed', main.appId, error);
					await this.closeCompanion();
					return false;
				}
		}

		this.recordFallback('admission-timeout', main.appId);
		await this.closeCompanion();
		return false;
	}

	private async readSurface(): Promise<SurfaceSnapshot> {
		const response = await this.call(SURFACE_MANAGER_FOREGROUND_URI, { subscribe: false });
		return parseSurfaceSnapshot(response);
	}

	private isAdmitted(snapshot: SurfaceSnapshot, mainAppId: string): boolean {
		if (snapshot.mode !== 'multiview') return false;
		return (
			snapshot.apps.some(app => isMainPipSurface(app, mainAppId)) &&
			snapshot.apps.some(app => isCompanionPipSurface(app, this.pipAppId))
		);
	}

	private scheduleClose(durationMs: number): void {
		this.clearCloseTimer();
		this.sessionActive = true;
		this.closeTimer = setTimeout(() => {
			this.closeTimer = null;
			this.sessionActive = false;
			void this.closeCompanion();
		}, boundedDuration(durationMs));
	}

	private clearCloseTimer(): void {
		if (!this.closeTimer) return;
		clearTimeout(this.closeTimer);
		this.closeTimer = null;
	}

	private async closeCompanion(): Promise<void> {
		try {
			await this.call(APPLICATION_CLOSE_URI, { id: this.pipAppId }, 2_000);
		} catch {
			// Already-closed or unavailable companion is harmless.
		}
	}

	private recordShown(mainAppId: string, reason: string): void {
		this.lastOutcome = 'shown';
		this.lastReason = reason;
		this.lastMainAppId = mainAppId;
		this.sessionActive = true;
	}

	private recordFallback(reason: string, mainAppId: string | null, error?: unknown): void {
		this.lastOutcome = 'fallback';
		this.lastReason = reason;
		this.lastMainAppId = mainAppId;
		this.sessionActive = false;
		if (error) {
			console.warn(
				`HomeBack camera PiP fallback (${reason}):`,
				error instanceof Error ? error.message : String(error),
			);
		}
	}
}
