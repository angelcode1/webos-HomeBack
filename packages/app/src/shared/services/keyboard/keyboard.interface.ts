export type Shift = -1 | 1;
export type KeyboardOwner = 'ribbon' | 'drawer' | 'keypad' | 'preview';
export type RemoteDigit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

export type KeyboardOwnerHandlers = {
	horizontal?: (shift: Shift) => void;
	vertical?: (shift: Shift) => void;
	enter?: () => void;
	hold?: () => void;
	back?: () => void;
	digit?: (digit: RemoteDigit) => void;
};

export type KeyboardOwnershipState = {
	keypad: boolean;
	drawer: boolean;
	ribbon: boolean;
	preview: boolean;
};
