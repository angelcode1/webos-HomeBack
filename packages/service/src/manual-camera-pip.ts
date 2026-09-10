const SURFACE_MANAGER_FOREGROUND_URI =
	'luna://com.webos.surfacemanager/getForegroundAppInfo';
const MULTIVIEW_LAUNCH_URI =
	'luna://com.webos.service.multiviewcontroller/launchApps';
const SET_APP_COORDINATE_URI =
	'luna://com.webos.service.multiviewcontroller/setAppCoordinate';
const APPLICATION_CLOSE_URI =
	'luna://com.webos.service.applicationManager/closeByAppId';

const CARD_WINDOW_TYPE = '_WEBOS_WINDOW_TYPE_CARD';
const MULTIVIEW_VIEW_TYPE = 'mvpip';
const NORMAL_VIEW_TYPE = 'normal';
const POLL_INTERVAL_MS = 250;
const ADMISSION_CHECKS = 21;
const SURFACE_QUERY_TIMEOUT_MS = 1_000;
const MULTIVIEW_LAUNCH_TIMEOUT_MS = 4_000;
const GEOMETRY_TIMEOUT_MS = 1_000;
const CLOSE_TIMEOUT_MS = 1_000;

// Hardware-measured default PiP on the target C5 was 576x324 logical pixels.
// The manual camera viewer targets 70% of that size while preserving 16:9.
// A 72px logical margin keeps it in the top-right safe area measured on 1920x1080.
export const CAMERA_PIP_GEOMETRY = {
	x: 1_445,
	y: 72,
	width: 403,
	height: 227,
} as const;

export type CameraPipLunaCall = (
	uri: string,
	params?: Record<string, unknown>,
	timeoutMs?: number,
) => Promise<Record<string, unknown>>;

export type CameraPipStatus = {
	pipCompanionAppId: string;
	pipLastOutcome: 'idle' | 'shown' | 'failed' | 'closed';
	pipLastReason: string | null;
	pipLastMainAppId: string | null;
	pipLastError: string | null;
	pipSessionActive: boolean;
	pipGeometryTarget: typeof CAMERA_PIP_GEOMETRY;
	pipGeometryApplied: boolean;
	pipGeometryError: string | null;
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

const optionalString = (value: unknown): string | null =>
	typeof value === 'string' ? value : null;

const optionalBoolean = (value: unknown): boolean | null =>
	typeof value === 'boolean' ? value : null;

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

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

const isNormalCard = (app: SurfaceApp): boolean =>
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

const sleep = (milliseconds: number): Promise<void> =>
	new Promise(resolve => setTimeout(resolve, milliseconds));

export class ManualCameraPip {
	private lastOutcome: CameraPipStatus['pipLastOutcome'] = 'idle';
	private lastReason: string | null = null;
	private lastMainAppId: string | null = null;
	private lastError: string | null = null;
	private sessionActive = false;
	private geometryApplied = false;
	private geometryError: string | null = null;

	public constructor(
		private readonly call: CameraPipLunaCall,
		private readonly pipAppId: string,
	) {}

	public status(): CameraPipStatus {
		return {
			pipCompanionAppId: this.pipAppId,
			pipLastOutcome: this.lastOutcome,
			pipLastReason: this.lastReason,
			pipLastMainAppId: this.lastMainAppId,
			pipLastError: this.lastError,
			pipSessionActive: this.sessionActive,
			pipGeometryTarget: CAMERA_PIP_GEOMETRY,
			pipGeometryApplied: this.geometryApplied,
			pipGeometryError: this.geometryError,
		};
	}

	public async open(): Promise<CameraPipStatus> {
		this.geometryApplied = false;
		this.geometryError = null;
		this.lastError = null;

		let initial: SurfaceSnapshot;
		try {
			initial = await this.readSurface();
		} catch (error) {
			return this.fail('foreground-query-failed', null, error);
		}

		if (initial.mode === 'multiview') {
			const companion = initial.apps.find(app => isCompanionPipSurface(app, this.pipAppId));
			const retainedMain = initial.apps.find(
				app => app.appId !== this.pipAppId && isMainPipSurface(app, app.appId),
			);
			if (companion && retainedMain) {
				this.recordShown(retainedMain.appId, 'already-active');
				await this.applyPreferredGeometry();
				return this.status();
			}
			return this.fail('foreground-multiview-active', null);
		}

		const eligibleMains = initial.apps.filter(isNormalCard);
		if (eligibleMains.length !== 1) {
			return this.fail('foreground-main-not-resolved', null);
		}
		const [main] = eligibleMains;
		if (main.appId === this.pipAppId) {
			return this.fail('foreground-main-invalid', main.appId);
		}

		try {
			await this.call(
				MULTIVIEW_LAUNCH_URI,
				{
					apps: [
						{ appId: main.appId, role: 'main', order: 0 },
						{ appId: this.pipAppId, role: 'sub', order: 1 },
					],
					mode: 'pip',
				},
				MULTIVIEW_LAUNCH_TIMEOUT_MS,
			);
		} catch (error) {
			await this.closeCompanionBestEffort();
			return this.fail('launch-rejected', main.appId, error);
		}

		for (let check = 0; check < ADMISSION_CHECKS; check += 1) {
			if (check > 0) await sleep(POLL_INTERVAL_MS);
			let current: SurfaceSnapshot;
			try {
				current = await this.readSurface();
			} catch (error) {
				await this.closeCompanionBestEffort();
				return this.fail('admission-query-failed', main.appId, error);
			}
			if (this.isAdmitted(current, main.appId)) {
				this.recordShown(main.appId, 'admitted');
				await this.applyPreferredGeometry();
				return this.status();
			}
		}

		await this.closeCompanionBestEffort();
		return this.fail('admission-timeout', main.appId);
	}

	public async close(): Promise<CameraPipStatus> {
		try {
			await this.call(
				APPLICATION_CLOSE_URI,
				{ id: this.pipAppId },
				CLOSE_TIMEOUT_MS,
			);
			this.lastError = null;
		} catch (error) {
			this.lastError = errorMessage(error);
		}
		this.sessionActive = false;
		this.lastOutcome = 'closed';
		this.lastReason = 'manual-close';
		return this.status();
	}

	private async readSurface(): Promise<SurfaceSnapshot> {
		return parseSurfaceSnapshot(await this.call(
			SURFACE_MANAGER_FOREGROUND_URI,
			{ subscribe: false },
			SURFACE_QUERY_TIMEOUT_MS,
		));
	}

	private isAdmitted(snapshot: SurfaceSnapshot, mainAppId: string): boolean {
		return snapshot.mode === 'multiview' &&
			snapshot.apps.some(app => isMainPipSurface(app, mainAppId)) &&
			snapshot.apps.some(app => isCompanionPipSurface(app, this.pipAppId));
	}

	private async applyPreferredGeometry(): Promise<void> {
		try {
			await this.call(
				SET_APP_COORDINATE_URI,
				{
					appId: this.pipAppId,
					...CAMERA_PIP_GEOMETRY,
				},
				GEOMETRY_TIMEOUT_MS,
			);
			this.geometryApplied = true;
			this.geometryError = null;
		} catch (error) {
			// Geometry is cosmetic. Never tear down an otherwise-valid camera PiP.
			this.geometryApplied = false;
			this.geometryError = errorMessage(error);
			console.warn('[HomeBackCamera] preferred PiP geometry was rejected:', this.geometryError);
		}
	}

	private async closeCompanionBestEffort(): Promise<void> {
		try {
			await this.call(
				APPLICATION_CLOSE_URI,
				{ id: this.pipAppId },
				CLOSE_TIMEOUT_MS,
			);
		} catch {
			// A failed launch often means the companion was never created.
		}
		this.sessionActive = false;
	}

	private recordShown(mainAppId: string, reason: string): void {
		this.lastOutcome = 'shown';
		this.lastReason = reason;
		this.lastMainAppId = mainAppId;
		this.lastError = null;
		this.sessionActive = true;
	}

	private fail(
		reason: string,
		mainAppId: string | null,
		error?: unknown,
	): CameraPipStatus {
		this.lastOutcome = 'failed';
		this.lastReason = reason;
		this.lastMainAppId = mainAppId;
		this.lastError = error === undefined ? null : errorMessage(error);
		this.sessionActive = false;
		return this.status();
	}
}
