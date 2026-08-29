import type { KeyboardOwner } from '../features/ribbon/services/keyboard';

export type AppVisibilityState = {
	ribbonVisible: boolean;
	drawerVisible: boolean;
	keypadVisible: boolean;
	previewVisible: boolean;
};

export const keyboardOwnerFor = (state: AppVisibilityState): KeyboardOwner | null => {
	if (state.keypadVisible) return 'keypad';
	if (state.drawerVisible) return 'drawer';
	if (state.ribbonVisible) return 'ribbon';
	if (state.previewVisible) return 'preview';
	return null;
};

export const surfaceVisibleFor = (state: Pick<AppVisibilityState, 'ribbonVisible' | 'previewVisible'>): boolean =>
	state.ribbonVisible || state.previewVisible;
