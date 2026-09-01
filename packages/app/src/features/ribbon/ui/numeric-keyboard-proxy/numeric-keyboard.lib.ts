import {
	COLOUR_MICOM_KEYCODES,
	colourMicomKeycode,
	numericMicomKeycode,
} from '@homeback/utils';

export const NUMERIC_REMOTE_KEY_INTERVAL_MS = 80;

export const NUMERIC_KEYPAD_DIGITS = [
	'1', '2', '3',
	'4', '5', '6',
	'7', '8', '9',
	'0',
] as const;

export type NumericKeypadDigit = typeof NUMERIC_KEYPAD_DIGITS[number];
export type NumericKeypadColour = keyof typeof COLOUR_MICOM_KEYCODES;
export type NumericKeypadSelection = NumericKeypadDigit | NumericKeypadColour;
export type NumericKeypadDirection = 'left' | 'right' | 'up' | 'down';

export const NUMERIC_KEYPAD_COLOURS = [
	{ id: 'red' },
	{ id: 'green' },
	{ id: 'yellow' },
	{ id: 'blue' },
] as const;

const NUMERIC_KEYPAD_NEIGHBOURS: Readonly<
	Record<NumericKeypadSelection, Partial<Record<NumericKeypadDirection, NumericKeypadSelection>>>
> = {
	'1': { right: '2', down: '4' },
	'2': { left: '1', right: '3', down: '5' },
	'3': { left: '2', down: '6' },
	'4': { right: '5', up: '1', down: '7' },
	'5': { left: '4', right: '6', up: '2', down: '8' },
	'6': { left: '5', up: '3', down: '9' },
	'7': { right: '8', up: '4', down: '0' },
	'8': { left: '7', right: '9', up: '5', down: '0' },
	'9': { left: '8', up: '6', down: '0' },
	'0': { up: '8', down: 'green' },
	red: { right: 'green', up: '7' },
	green: { left: 'red', right: 'yellow', up: '0' },
	yellow: { left: 'green', right: 'blue', up: '0' },
	blue: { left: 'yellow', up: '9' },
};

export { colourMicomKeycode, numericMicomKeycode };

export const keypadMicomKeycode = (key: NumericKeypadSelection): number | null =>
	numericMicomKeycode(key) ?? colourMicomKeycode(key);

export const moveNumericKeypadSelection = (
	current: NumericKeypadSelection,
	direction: NumericKeypadDirection,
): NumericKeypadSelection => NUMERIC_KEYPAD_NEIGHBOURS[current][direction] ?? current;
