import {
	isTimedMapping,
	type RemoteConfig,
	type RemoteMapping,
	type TimedMapping,
} from './remote-config.ts';

type ShortcutState = {
	label: string;
	shortId: string;
	longKeycode: number;
};

type ShortcutMigration = {
	desired: ShortcutState;
	knownDefaults: ShortcutState[];
};

type LaunchShortcutState = {
	label: string;
	shortId: string;
	longId: string;
};

type LaunchShortcutMigration = {
	desired: LaunchShortcutState;
	knownDefaults: LaunchShortcutState[];
};

const SHORTCUT_MIGRATIONS: Record<string, ShortcutMigration> = {
	'1042': {
		desired: { label: 'Disney+ button', shortId: 'com.webos.app.hdmi1', longKeycode: 398 },
		knownDefaults: [
			{ label: 'Disney+ button', shortId: 'com.webos.app.hdmi2', longKeycode: 398 },
		],
	},
	'1043': {
		desired: { label: 'LG Channels button', shortId: 'com.webos.app.hdmi4', longKeycode: 399 },
		knownDefaults: [
			{ label: 'Stan button', shortId: 'com.webos.app.hdmi3', longKeycode: 399 },
			{ label: 'LG Channels button', shortId: 'com.webos.app.hdmi4', longKeycode: 400 },
			{ label: 'LG Channels button', shortId: 'com.webos.app.hdmi3', longKeycode: 399 },
		],
	},
	'1086': {
		desired: { label: 'Alexa button', shortId: 'org.xbmc.kodi', longKeycode: 400 },
		knownDefaults: [
			{ label: 'Alexa button', shortId: 'cdp-30', longKeycode: 400 },
			{ label: 'LG Channels button', shortId: 'com.webos.app.hdmi4', longKeycode: 400 },
			{ label: 'Alexa button', shortId: 'cdp-30', longKeycode: 401 },
			{ label: 'Alexa button', shortId: 'com.webos.app.hdmi4', longKeycode: 400 },
		],
	},
	'1111': {
		desired: { label: 'Stan button', shortId: 'com.webos.app.hdmi3', longKeycode: 401 },
		knownDefaults: [
			{ label: 'Alexa button', shortId: 'cdp-30', longKeycode: 401 },
			{ label: 'Model-specific button (observed keycode 1111)', shortId: 'com.webos.app.hdmi2', longKeycode: 398 },
			{ label: 'Model-specific button (observed keycode 1111)', shortId: 'cdp-30', longKeycode: 401 },
		],
	},
};

const LAUNCH_SHORTCUT_MIGRATIONS: Record<string, LaunchShortcutMigration> = {
	'1037': {
		desired: { label: 'Netflix button', shortId: 'youtube.leanback.v4', longId: 'cdp-30' },
		knownDefaults: [
			{ label: 'Netflix button', shortId: 'youtube.leanback.v4', longId: 'com.webos.app.usbc1' },
		],
	},
	'1038': {
		desired: { label: 'Prime Video button', shortId: 'com.webos.app.hdmi1', longId: 'com.webos.app.browser' },
		knownDefaults: [
			{ label: 'Prime Video button', shortId: 'com.webos.app.hdmi1', longId: 'com.webos.app.usbc2' },
		],
	},
};

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

const matchesLaunchShortcutState = (
	mapping: RemoteMapping | undefined,
	state: LaunchShortcutState,
): mapping is TimedMapping => {
	if (!mapping || !isTimedMapping(mapping)) return false;
	return mapping.label === state.label &&
		mapping.short?.action === 'launch' &&
		mapping.short.id === state.shortId &&
		mapping.short.params === undefined &&
		mapping.long?.action === 'launch' &&
		mapping.long.id === state.longId &&
		mapping.long.params === undefined;
};

export const migrateDefaultRemoteShortcuts = (config: RemoteConfig): boolean => {
	let changed = false;

	for (const [key, migration] of Object.entries(SHORTCUT_MIGRATIONS)) {
		const mapping = config.keys[key];
		if (!migration.knownDefaults.some(state => matchesShortcutState(mapping, state))) continue;
		config.keys[key] = {
			...mapping,
			label: migration.desired.label,
			short: { action: 'launch', id: migration.desired.shortId },
			long: { action: 'replace', keycode: migration.desired.longKeycode },
		};
		changed = true;
	}

	for (const [key, migration] of Object.entries(LAUNCH_SHORTCUT_MIGRATIONS)) {
		const mapping = config.keys[key];
		if (!migration.knownDefaults.some(state => matchesLaunchShortcutState(mapping, state))) continue;
		config.keys[key] = {
			...mapping,
			label: migration.desired.label,
			short: { action: 'launch', id: migration.desired.shortId },
			long: { action: 'launch', id: migration.desired.longId },
		};
		changed = true;
	}

	return changed;
};
