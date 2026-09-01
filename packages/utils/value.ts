export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const normalizedText = (value: unknown, maxLength: number): string | null => {
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	return normalized ? normalized.slice(0, maxLength) : null;
};

export const clampInteger = (
	value: unknown,
	minimum: number,
	maximum: number,
): number | null => {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
};
