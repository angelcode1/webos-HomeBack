export type LifecycleManagerEvents = {
	relaunch: void;
	requestHide: void;
};

export type VisibilityController = {
	isVisible: () => boolean;
	requestHide: () => void;
	waitUntilHidden: () => Promise<void>;
};
