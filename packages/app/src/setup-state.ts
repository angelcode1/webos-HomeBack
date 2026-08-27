export const SETUP_COMPLETE_STORAGE_KEY = 'homeback.setupComplete.v1';

type SetupStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const hasCompletedSetup = (storage: SetupStorage): boolean => {
	try {
		return storage.getItem(SETUP_COMPLETE_STORAGE_KEY) === '1';
	} catch {
		return false;
	}
};

export const markSetupComplete = (storage: SetupStorage): void => {
	try {
		storage.setItem(SETUP_COMPLETE_STORAGE_KEY, '1');
	} catch {
		// localStorage can be unavailable in restricted webviews; setup still succeeds.
	}
};
