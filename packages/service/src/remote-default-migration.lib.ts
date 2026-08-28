import type { RemoteConfig, RemoteMapping, TimedMapping } from './remote-config';

type LabelMigration = {
	oldLabel: string;
	newLabel: string;
};

type ShortcutState = {
	label: string;
	shortId: string;
	longKeycode: number;
};

const LABEL_MIGRATIONS: Record<string, LabelMigration> = {
	'1043': {
		oldLabel: 'Stan button',
		newLabel: 'LG Channels button',
	},
	'1086': {
		oldLabel: 'LG Channels button',
		newLabel: 'Alexa button',
	},
	'1111': {
		oldLabel: 'Alexa button',
		newLabel: 'Model-specific button (observed keycode 1111)',
	},
};

const BAD_0416_ROTATION: Record<string, ShortcutState> = {
	'1043': {
		label: 'LG Channels button',
		shortId: 'com.webos.app.hdmi4',
		longKeycode: 400,
	},
	'1086': {
		label: 'Alexa button',
		shortId: 'cdp-30',
		longKeycode: 401,
	},
	'1111': {
		label: 'Model-specific button (observed keycode 1111)',
		shortId: 'com.webos.app.hdmi2',
		longKeycode: 398,
	},
};

const RESTORED_SHORTCUTS: Record<string, ShortcutState> = {
	'1043': {
		label: 'LG Channels button',
		shortId: 'com.webos.app.hdmi3',
		longKeycode: 399,
	},
	'1086': {
		label: 'Alexa button',
		shortId: 'com.webos.app.hdmi4',
		longKeycode: 400,
	},
	'1111': {
		label: 'Model-specific button (observed keycode 1111)',
		shortId: 'cdp-30',
		longKeycode: 401,
	},
};

const isTimedMapping = (mapping: RemoteMapping): mapping is TimedMapping =>
	'short' in mapping || 'long' in mapping || 'longPressMs' in mapping;

const matchesShortcutState = (
	mapping: RemoteMapping | undefined,
	state: ShortcutState,
): mapping is TimedMapping => {
	if (!mapping || !isTimedMapping(mapping)) return false;
	return mapping.label === state.label &&
		mapping.short?.action === 'launch' &&
		mapping.short.id === state.shortId &&
		mapping.short.params === undefined &&
		mapping.long?.action === 'replace' &&
		mapping.long.keycode === state.longKeycode;
};

const repairBad0416Rotation = (config: RemoteConfig): boolean => {
	const affectedKeys = Object.keys(BAD_0416_ROTATION);
	const isExactBadRotation = affectedKeys.every(key =>
		matchesShortcutState(config.keys[key], BAD_0416_ROTATION[key]),
	);
	if (!isExactBadRotation) return false;

	for (const key of affectedKeys) {
		const mapping = config.keys[key] as TimedMapping;
		const restored = RESTORED_SHORTCUTS[key];
		config.keys[key] = {
			...mapping,
			label: restored.label,
			short: { action: 'launch', id: restored.shortId },
			long: { action: 'replace', keycode: restored.longKeycode },
		};
	}
	return true;
};

export const migrateDefaultRemoteShortcuts = (config: RemoteConfig): boolean => {
	let changed = repairBad0416Rotation(config);

	for (const [key, migration] of Object.entries(LABEL_MIGRATIONS)) {
		const mapping = config.keys[key];
		if (!mapping || mapping.label !== migration.oldLabel) continue;

		config.keys[key] = {
			...mapping,
			label: migration.newLabel,
		};
		changed = true;
	}

	return changed;
};
