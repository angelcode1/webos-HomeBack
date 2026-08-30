import type { KeyboardOwner, KeyboardOwnershipState } from './keyboard.interface';

export const HOLD_THRESHOLD_MS = 500;

export const ArrowKey = {
	Left: 'ArrowLeft',
	Right: 'ArrowRight',
	Up: 'ArrowUp',
	Down: 'ArrowDown',
} as const;

export type ArrowKey = typeof ArrowKey[keyof typeof ArrowKey];

export const selectKeyboardOwner = (state: KeyboardOwnershipState): KeyboardOwner | null => {
	if (state.keypad) return 'keypad';
	if (state.drawer) return 'drawer';
	if (state.ribbon) return 'ribbon';
	if (state.preview) return 'preview';
	return null;
};
