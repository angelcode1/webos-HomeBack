// Five seconds collapses camera detector bursts without hiding distinct events
// for long. Suppressed events still refresh the recent-camera media reference.
export const PREVIEW_TOAST_SUPPRESSION_MS = 5_000;
// Recent Cameras is an event convenience, not a durable camera directory. HA
// signed proxy URLs rotate, so stop offering an old URL after a short window
// rather than pretending HomeBack can refresh credentials on its own.
export const RECENT_CAMERA_FRESHNESS_MS = 2 * 60_000;
export const RECENT_CAMERA_MAX_ENTRIES = 32;

const CAMERA_ID_MAX_LENGTH = 128;
const TITLE_MAX_LENGTH = 96;
const MESSAGE_MAX_LENGTH = 256;
const TOAST_MESSAGE_MAX_LENGTH = 60;
const TOAST_TITLE_MAX_CODEPOINTS = 24;
const URL_MAX_LENGTH = 2_048;
const PREVIEW_MIN_DURATION_MS = 1_000;
const PREVIEW_DEFAULT_DURATION_MS = 8_000;
const PREVIEW_MAX_DURATION_MS = 10_000;
const DEFAULT_NOTIFICATION_KEY = '__default__';

export type PreviewNotificationRequest = {
	cameraId?: string;
	title?: string;
	message?: string;
	preview?: {
		title?: string;
		message?: string;
		imageUrl?: string;
		durationMs?: number;
	};
};

export type NotificationToastRequest = {
	message: string;
	sourceId: string;
	type: 'light';
};

export type RecentCameraEntry = {
	cameraId: string;
	title: string;
	message: string | null;
	imageUrl: string;
	durationMs: number;
	receivedAt: number;
	expiresAt: number;
};

const normalizedString = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	return normalized || null;
};

const displayText = (value: unknown, maxLength: number): string | null =>
	normalizedString(value)?.slice(0, maxLength) ?? null;

const truncateCodePoints = (value: string, maxLength: number): string => {
	// One Unicode code point occupies at most two UTF-16 code units. Bound the
	// intermediate string before Array.from() as well as the final code-point list.
	const boundedCodeUnits = value.slice(0, maxLength * 2);
	return Array.from(boundedCodeUnits).slice(0, maxLength).join('');
};

const boundedOpaqueString = (value: unknown, maxLength: number): string | null => {
	const normalized = normalizedString(value);
	return normalized && normalized.length <= maxLength ? normalized : null;
};

const boundedDuration = (value: unknown): number | null => {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	return Math.min(
		PREVIEW_MAX_DURATION_MS,
		Math.max(PREVIEW_MIN_DURATION_MS, Math.trunc(value)),
	);
};

export const getPreviewNotificationKey = (request: PreviewNotificationRequest): string =>
	boundedOpaqueString(request.cameraId, CAMERA_ID_MAX_LENGTH) ?? DEFAULT_NOTIFICATION_KEY;

export const buildPreviewToastRequest = (
	request: PreviewNotificationRequest,
	sourceId: string,
): NotificationToastRequest => {
	// A toast has only 60 characters total. Keep camera/location context short so
	// an unusually long friendly name cannot consume the event text entirely.
	const rawTitle = displayText(request.title, TITLE_MAX_LENGTH);
	const title = rawTitle ? truncateCodePoints(rawTitle, TOAST_TITLE_MAX_CODEPOINTS) : null;
	const message = displayText(request.message, MESSAGE_MAX_LENGTH) ?? 'Camera event';
	const combined = title ? `${title}: ${message}` : message;

	return {
		message: truncateCodePoints(combined, TOAST_MESSAGE_MAX_LENGTH),
		sourceId,
		// On the tested webOS 10 TV, "light" selects the compact top-right toast
		// form. It does not force a light colour theme; webOS owns toast styling.
		type: 'light',
	};
};

export const buildRecentCameraEntry = (
	request: PreviewNotificationRequest,
	receivedAt: number,
): RecentCameraEntry | null => {
	const preview = request.preview ?? {};
	const imageUrl = boundedOpaqueString(preview.imageUrl, URL_MAX_LENGTH);
	if (!imageUrl) return null;

	const title =
		displayText(preview.title, TITLE_MAX_LENGTH) ??
		displayText(request.title, TITLE_MAX_LENGTH) ??
		'Camera preview';
	const message =
		displayText(preview.message, MESSAGE_MAX_LENGTH) ??
		displayText(request.message, MESSAGE_MAX_LENGTH);

	return {
		cameraId: getPreviewNotificationKey(request),
		title,
		message,
		imageUrl,
		durationMs: boundedDuration(preview.durationMs) ?? PREVIEW_DEFAULT_DURATION_MS,
		receivedAt,
		expiresAt: receivedAt + RECENT_CAMERA_FRESHNESS_MS,
	};
};

export const isRecentCameraFresh = (
	camera: Pick<RecentCameraEntry, 'expiresAt'>,
	now: number,
): boolean => Number.isFinite(camera.expiresAt) && camera.expiresAt > now;

export const shouldSuppressPreviewToast = (
	lastSentAt: number | undefined,
	now: number,
): boolean =>
	lastSentAt !== undefined &&
	now >= lastSentAt &&
	now - lastSentAt < PREVIEW_TOAST_SUPPRESSION_MS;

export type PreparedPreviewNotification = {
	key: string;
	camera: RecentCameraEntry | null;
	suppressed: boolean;
	reservedAt: number | null;
};

const TOAST_SUPPRESSION_MAX_KEYS = 64;

export class PreviewNotificationState {
	private readonly recentCameras = new Map<string, RecentCameraEntry>();
	private readonly lastToastAt = new Map<string, number>();

	public prepare(
		request: PreviewNotificationRequest,
		now = Date.now(),
	): PreparedPreviewNotification {
		const key = getPreviewNotificationKey(request);
		const camera = buildRecentCameraEntry(request, now);
		if (camera) this.upsertRecentCamera(camera);

		const suppressed = shouldSuppressPreviewToast(this.lastToastAt.get(key), now);
		if (!suppressed) this.reserveToast(key, now);

		return {
			key,
			camera,
			suppressed,
			reservedAt: suppressed ? null : now,
		};
	}

	public releaseToastReservation(key: string, reservedAt: number): void {
		if (this.lastToastAt.get(key) === reservedAt) this.lastToastAt.delete(key);
	}

	public listRecentCameras(now = Date.now()): RecentCameraEntry[] {
		for (const [key, camera] of this.recentCameras) {
			if (!isRecentCameraFresh(camera, now)) this.recentCameras.delete(key);
		}
		return [...this.recentCameras.values()]
			.sort((left, right) => right.receivedAt - left.receivedAt);
	}

	private reserveToast(key: string, reservedAt: number): void {
		// Reserve synchronously before the async LS2 createToast call. This makes
		// concurrent burst requests deterministic without a per-camera Promise queue.
		this.lastToastAt.delete(key);
		this.lastToastAt.set(key, reservedAt);
		while (this.lastToastAt.size > TOAST_SUPPRESSION_MAX_KEYS) {
			const oldestKey = this.lastToastAt.keys().next().value as string | undefined;
			if (oldestKey === undefined) break;
			this.lastToastAt.delete(oldestKey);
		}
	}

	private upsertRecentCamera(camera: RecentCameraEntry): void {
		// A suppressed burst member must still become the camera's newest media
		// reference. Delete + set also refreshes insertion order for bounded eviction.
		this.recentCameras.delete(camera.cameraId);
		this.recentCameras.set(camera.cameraId, camera);
		while (this.recentCameras.size > RECENT_CAMERA_MAX_ENTRIES) {
			const oldestKey = this.recentCameras.keys().next().value as string | undefined;
			if (oldestKey === undefined) break;
			this.recentCameras.delete(oldestKey);
		}
	}
}
