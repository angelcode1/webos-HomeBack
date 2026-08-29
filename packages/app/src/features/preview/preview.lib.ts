export const PREVIEW_DEFAULT_DURATION_MS = 7_000;
export const PREVIEW_MIN_DURATION_MS = 1_000;
export const PREVIEW_MAX_DURATION_MS = 10_000;
export const PREVIEW_WATCHDOG_INTERVAL_MS = 250;

export const clampPreviewDuration = (durationMs: number | undefined): number => {
	if (durationMs === undefined || !Number.isFinite(durationMs)) return PREVIEW_DEFAULT_DURATION_MS;
	return Math.min(PREVIEW_MAX_DURATION_MS, Math.max(PREVIEW_MIN_DURATION_MS, Math.round(durationMs)));
};
