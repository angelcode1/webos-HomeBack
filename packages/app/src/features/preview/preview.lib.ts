import type { PreviewLaunchPayload } from 'shared/api/common';

export const PREVIEW_DEFAULT_DURATION_MS = 8_000;
export const PREVIEW_MIN_DURATION_MS = 1_000;
export const PREVIEW_MAX_DURATION_MS = 10_000;
export const PREVIEW_WATCHDOG_INTERVAL_MS = 250;
export const PREVIEW_TITLE_MAX_LENGTH = 96;
export const PREVIEW_MESSAGE_MAX_LENGTH = 256;
export const PREVIEW_IMAGE_URL_MAX_LENGTH = 2_048;

const PREVIEW_IMAGE_HOST_MAX_LENGTH = 253;

export type PreviewPayload = {
	title: string;
	message: string | null;
	imageUrl: string | null;
	durationMs: number;
};

export const clampPreviewDuration = (durationMs: unknown): number => {
	if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) {
		return PREVIEW_DEFAULT_DURATION_MS;
	}
	return Math.min(
		PREVIEW_MAX_DURATION_MS,
		Math.max(PREVIEW_MIN_DURATION_MS, Math.trunc(durationMs)),
	);
};

export const previewImageHost = (imageUrl: string): string => {
	try {
		const hostname = new URL(imageUrl).hostname;
		return hostname ? hostname.slice(0, PREVIEW_IMAGE_HOST_MAX_LENGTH) : 'none';
	} catch {
		return 'invalid';
	}
};

const normalizedText = (value: unknown, maxLength: number): string | null => {
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	return normalized ? normalized.slice(0, maxLength) : null;
};

const normalizedUrl = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	if (!normalized || normalized.length > PREVIEW_IMAGE_URL_MAX_LENGTH) return null;
	return normalized;
};

export const normalizePreviewPayload = (input: PreviewLaunchPayload): PreviewPayload | null => {
	// A web preview owns the TV's application input focus on tested hardware.
	// Therefore omission must be safe: only an explicit opt-in may raise it.
	if (input.interactive !== true) return null;

	return {
		title: normalizedText(input.title, PREVIEW_TITLE_MAX_LENGTH) ?? 'Camera preview',
		message: normalizedText(input.message, PREVIEW_MESSAGE_MAX_LENGTH),
		imageUrl: normalizedUrl(input.imageUrl),
		durationMs: clampPreviewDuration(input.durationMs),
	};
};
