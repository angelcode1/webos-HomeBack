export const wheelShiftFromDelta = (deltaY: number): -1 | 0 | 1 => {
	if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
	return deltaY > 0 ? 1 : -1;
};
