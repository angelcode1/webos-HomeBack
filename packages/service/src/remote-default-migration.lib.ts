import type { RemoteConfig } from './remote-config';

type LabelMigration = {
	oldLabel: string;
	newLabel: string;
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

export const migrateDefaultRemoteShortcuts = (config: RemoteConfig): boolean => {
	let changed = false;

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
