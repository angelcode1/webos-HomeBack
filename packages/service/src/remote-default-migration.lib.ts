import type { RemoteConfig, RemoteMapping, TimedMapping } from './remote-config';

type ShortcutMigration = {
	oldLabel: string;
	newLabel: string;
	oldShortId: string;
	oldLongKeycode: number;
	newShortId: string;
	newLongKeycode: number;
};

const SHORTCUT_MIGRATIONS: Record<string, ShortcutMigration> = {
	'1043': {
		oldLabel: 'Stan button',
		newLabel: 'LG Channels button',
		oldShortId: 'com.webos.app.hdmi3',
		oldLongKeycode: 399,
		newShortId: 'com.webos.app.hdmi4',
		newLongKeycode: 400,
	},
	'1086': {
		oldLabel: 'LG Channels button',
		newLabel: 'Alexa button',
		oldShortId: 'com.webos.app.hdmi4',
		oldLongKeycode: 400,
		newShortId: 'cdp-30',
		newLongKeycode: 401,
	},
	'1111': {
		oldLabel: 'Alexa button',
		newLabel: 'Model-specific button (observed keycode 1111)',
		oldShortId: 'cdp-30',
		oldLongKeycode: 401,
		newShortId: 'com.webos.app.hdmi2',
		newLongKeycode: 398,
	},
};

const isTimedMapping = (mapping: RemoteMapping): mapping is TimedMapping =>
	'short' in mapping || 'long' in mapping || 'longPressMs' in mapping;

const matchesDefaultPair = (
	mapping: RemoteMapping,
	migration: ShortcutMigration,
): mapping is TimedMapping =>
	isTimedMapping(mapping) &&
	mapping.short?.action === 'launch' &&
	mapping.short.id === migration.oldShortId &&
	mapping.short.params === undefined &&
	mapping.long?.action === 'replace' &&
	mapping.long.keycode === migration.oldLongKeycode;

export const migrateDefaultRemoteShortcuts = (config: RemoteConfig): boolean => {
	let changed = false;

	for (const [key, migration] of Object.entries(SHORTCUT_MIGRATIONS)) {
		const mapping = config.keys[key];
		if (!mapping || !matchesDefaultPair(mapping, migration)) continue;

		const label = mapping.label === migration.oldLabel || mapping.label === undefined
			? migration.newLabel
			: mapping.label;
		config.keys[key] = {
			...mapping,
			label,
			short: { action: 'launch', id: migration.newShortId },
			long: { action: 'replace', keycode: migration.newLongKeycode },
		};
		changed = true;
	}

	return changed;
};
