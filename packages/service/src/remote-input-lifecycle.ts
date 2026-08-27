export const ESSENTIAL_TARGET_NAMES = ['lginput2', 'micomservice'] as const;
export const MAX_INJECTION_FAILURES = 3;
export const BLOCKED_RECHECK_MS = 10_000;

const INJECTION_RETRY_BASE_MS = 5_000;
const INJECTION_RETRY_MAX_MS = 30_000;

export const injectionRetryDelayMs = (failureCount: number): number | null => {
	if (!Number.isInteger(failureCount) || failureCount < 1) {
		throw new Error('failureCount must be a positive integer');
	}
	if (failureCount >= MAX_INJECTION_FAILURES) return null;

	return Math.min(
		INJECTION_RETRY_BASE_MS * (2 ** (failureCount - 1)),
		INJECTION_RETRY_MAX_MS,
	);
};
