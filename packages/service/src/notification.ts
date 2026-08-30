import { APPLICATION_MANAGER_URI, APP_ID } from './environment';

const ALERT_CAMERA_ID_MAX_LENGTH = 128;
const ALERT_TITLE_MAX_LENGTH = 96;
const ALERT_MESSAGE_MAX_LENGTH = 256;
const ALERT_URL_MAX_LENGTH = 2_048;
const PREVIEW_MIN_DURATION_MS = 1_000;
const PREVIEW_MAX_DURATION_MS = 10_000;
const DEFAULT_ALERT_KEY = '__default__';

export type PreviewAlertRequest = {
	cameraId?: string;
	title?: string;
	message?: string;
	iconUrl?: string;
	preview?: {
		title?: string;
		message?: string;
		imageUrl?: string;
		durationMs?: number;
	};
};

export type NotificationAlertRequest = {
	title?: string;
	message: string;
	iconUrl?: string;
	buttons: Array<{
		label: string;
		focus?: boolean;
		onclick?: string;
		params?: Record<string, unknown>;
	}>;
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

export const getPreviewAlertKey = (request: PreviewAlertRequest): string =>
	boundedOpaqueString(request.cameraId, ALERT_CAMERA_ID_MAX_LENGTH) ?? DEFAULT_ALERT_KEY;

export const buildPreviewAlertRequest = (
	request: PreviewAlertRequest,
): NotificationAlertRequest => {
	const title = displayText(request.title, ALERT_TITLE_MAX_LENGTH);
	const message = displayText(request.message, ALERT_MESSAGE_MAX_LENGTH) ?? 'Camera event';
	const iconUrl = boundedOpaqueString(request.iconUrl, ALERT_URL_MAX_LENGTH);
	const preview = request.preview ?? {};
	const previewTitle =
		displayText(preview.title, ALERT_TITLE_MAX_LENGTH) ?? title ?? 'Camera preview';
	const previewMessage = displayText(preview.message, ALERT_MESSAGE_MAX_LENGTH) ?? message;
	const previewImageUrl = boundedOpaqueString(preview.imageUrl, ALERT_URL_MAX_LENGTH);
	const previewDurationMs = boundedDuration(preview.durationMs);

	// Construct the launch payload explicitly. Do not spread producer-owned
	// objects through System UI into HomeBack launchParams.
	return {
		...(title ? { title } : {}),
		message,
		...(iconUrl ? { iconUrl } : {}),
		buttons: [
			{
				label: 'View camera',
				focus: true,
				onclick: `${APPLICATION_MANAGER_URI}/launch`,
				params: {
					id: APP_ID,
					params: {
						intent: 'homeback:preview',
						preview: {
							title: previewTitle,
							message: previewMessage,
							...(previewImageUrl ? { imageUrl: previewImageUrl } : {}),
							...(previewDurationMs ? { durationMs: previewDurationMs } : {}),
							interactive: true,
						},
					},
				},
			},
			{ label: 'Dismiss' },
		],
	};
};
