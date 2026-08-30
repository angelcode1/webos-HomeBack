import { APP_ID, SERVICE_ID } from './environment';

export const PREVIEW_TOAST_SUPPRESSION_MS = 5_000;
export const RECENT_CAMERA_FRESHNESS_MS = 2 * 60_000;
export const RECENT_CAMERA_MAX_ENTRIES = 32;

const CAMERA_ID_MAX_LENGTH = 128;
const TITLE_MAX_LENGTH = 96;
const MESSAGE_MAX_LENGTH = 256;
const TOAST_MESSAGE_MAX_LENGTH = 60;
const URL_MAX_LENGTH = 2_048;
const PREVIEW_MIN_DURATION_MS = 1_000;
const PREVIEW_DEFAULT_DURATION_MS = 8_000;
const PREVIEW_MAX_DURATION_MS = 10_000;
const DEFAULT_NOTIFICATION_KEY = '__default__';
const TOAST_ICON_URL =
	`file:///media/developer/apps/usr/palm/applications/${APP_ID}/icon80.png`;

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
	iconUrl: string;
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
): NotificationToastRequest => {
	const title = displayText(request.title, TITLE_MAX_LENGTH);
	const message = displayText(request.message, MESSAGE_MAX_LENGTH) ?? 'Camera event';
	const combined = title ? `${title}: ${message}` : message;

	return {
		message: combined.slice(0, TOAST_MESSAGE_MAX_LENGTH),
		sourceId: SERVICE_ID,
		iconUrl: TOAST_ICON_URL,
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

		return {
			key,
			camera,
			suppressed: shouldSuppressPreviewToast(this.lastToastAt.get(key), now),
		};
	}

	public markToastSent(key: string, sentAt = Date.now()): void {
		this.lastToastAt.delete(key);
		this.lastToastAt.set(key, sentAt);
		while (this.lastToastAt.size > TOAST_SUPPRESSION_MAX_KEYS) {
			const oldestKey = this.lastToastAt.keys().next().value as string | undefined;
			if (oldestKey === undefined) break;
			this.lastToastAt.delete(oldestKey);
		}
	}

	public listRecentCameras(now = Date.now()): RecentCameraEntry[] {
		for (const [key, camera] of this.recentCameras) {
			if (!isRecentCameraFresh(camera, now)) this.recentCameras.delete(key);
		}
		return [...this.recentCameras.values()]
			.sort((left, right) => right.receivedAt - left.receivedAt);
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
