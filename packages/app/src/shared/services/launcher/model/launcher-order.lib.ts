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
