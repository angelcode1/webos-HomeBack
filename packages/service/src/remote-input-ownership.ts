const stripDeletedSuffix = (path: string): string => path.replace(/\s+\(deleted\)$/, '');

export type ObservedNativeTarget = {
	pid: number;
	name: string;
};

export type ManagedNativeTarget = ObservedNativeTarget & {
	state: 'injecting' | 'active';
};

export const findMappedLibraryPath = (maps: string, libraryBasename: string): string | null => {
	for (const line of maps.split('\n')) {
		const fields = line.trim().split(/\s+/);
		if (fields.length < 6) continue;

		const mappedPath = fields.slice(5).join(' ');
		const cleanPath = stripDeletedSuffix(mappedPath);
		if (cleanPath === libraryBasename || cleanPath.endsWith(`/${libraryBasename}`)) return mappedPath;
	}

	return null;
};

export const normalizeMappedLibraryPath = (mappedPath: string): string =>
	stripDeletedSuffix(mappedPath);

export const isHomeBackMappedLibraryPath = (
	mappedPath: string,
	expectedPath: string,
	serviceId: string,
): boolean => {
	const cleanPath = stripDeletedSuffix(mappedPath);
	return cleanPath === expectedPath || cleanPath.includes(`/${serviceId}/`);
};

export const hasVerifiedNativeOwnership = (
	started: boolean,
	legacyMode: boolean,
	essentialTargetNames: readonly string[],
	observedTargets: readonly ObservedNativeTarget[],
	managedTargets: readonly ManagedNativeTarget[],
	blockedTargets: readonly ObservedNativeTarget[],
): boolean => {
	if (!started || legacyMode) return false;

	const essentialNames = new Set(essentialTargetNames);
	const observedEssentialTargets = observedTargets.filter(target => essentialNames.has(target.name));
	if (observedEssentialTargets.length === 0) return false;

	const activePids = new Set(
		managedTargets
			.filter(target => target.state === 'active' && essentialNames.has(target.name))
			.map(target => target.pid),
	);
	const blockedPids = new Set(
		blockedTargets
			.filter(target => essentialNames.has(target.name))
			.map(target => target.pid),
	);

	return observedEssentialTargets.every(target => activePids.has(target.pid) && !blockedPids.has(target.pid));
};
