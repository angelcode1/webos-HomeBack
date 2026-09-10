export const SETUP_COMPLETE_STORAGE_KEY = 'homeback.setupComplete.v1';
export const PERMISSION_SCHEMA_STORAGE_KEY = 'homeback.permissionSchema.v2';

type SetupStorage = Pick<Storage, 'getItem' | 'setItem'>;

const hasMarker = (storage: SetupStorage, key: string): boolean => {
	try {
		return storage.getItem(key) === '1';
	} catch {
		return false;
	}
};

const markMarker = (storage: SetupStorage, key: string): void => {
	try {
		storage.setItem(key, '1');
	} catch {
		// localStorage can be unavailable in restricted webviews; setup still succeeds.
	}
};

export const hasCompletedSetup = (storage: SetupStorage): boolean =>
	hasMarker(storage, SETUP_COMPLETE_STORAGE_KEY);

export const markSetupComplete = (storage: SetupStorage): void =>
	markMarker(storage, SETUP_COMPLETE_STORAGE_KEY);

export const hasCurrentPermissionSchema = (storage: SetupStorage): boolean =>
	hasMarker(storage, PERMISSION_SCHEMA_STORAGE_KEY);

export const markCurrentPermissionSchema = (storage: SetupStorage): void =>
	markMarker(storage, PERMISSION_SCHEMA_STORAGE_KEY);
