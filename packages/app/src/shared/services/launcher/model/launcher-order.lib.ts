type PersistedLaunchPoint = {
	launchPointId: string;
	builtin: boolean;
};

export const sanitizePersistedOrder = (
	value: readonly string[],
	launchPoints: readonly PersistedLaunchPoint[],
): string[] => {
	const builtinIds = new Set(
		launchPoints.filter(item => item.builtin).map(item => item.launchPointId),
	);
	return [...new Set(value)].filter(id => !builtinIds.has(id));
};

// Precondition: persisted order is deduplicated during hydration and on every order write.
export const moveWithinPersistedOrder = (
	order: readonly string[],
	visibleIds: readonly string[],
	launchPointId: string,
	shift: number,
): string[] | null => {
	if (shift !== -1 && shift !== 1) return null;

	const from = visibleIds.indexOf(launchPointId);
	const to = from + shift;
	if (from < 0 || to < 0 || to >= visibleIds.length) return null;

	const fromIndex = order.indexOf(launchPointId);
	const toIndex = order.indexOf(visibleIds[to]);
	if (fromIndex < 0 || toIndex < 0) return null;

	const moved = [...order];
	[moved[fromIndex], moved[toIndex]] = [moved[toIndex], moved[fromIndex]];
	return moved;
};
