export const NUMERIC_REMOTE_KEY_INTERVAL_MS = 80;

/*
 * `micomservice/sendKeycode` takes LG's MICOM/IR command byte, NOT a Linux
 * input-event code. The two spaces overlap numerically, so the previous
 * Linux-code table was accepted by the service (returnValue: true) while
 * firing unrelated functions: Linux KEY_7 is 8, and MICOM 0x08 is POWER, so
 * pressing 7 on the keypad turned the TV off.
 *
 * MICOM digits are 0x10..0x19 for 0..9.
 */
const NUMERIC_MICOM_KEYCODES: Readonly<Record<string, number>> = {
	'0': 0x10,
	'1': 0x11,
	'2': 0x12,
	'3': 0x13,
	'4': 0x14,
	'5': 0x15,
	'6': 0x16,
	'7': 0x17,
	'8': 0x18,
	'9': 0x19,
};

export const NUMERIC_KEYPAD_DIGITS = [
	'1', '2', '3',
	'4', '5', '6',
	'7', '8', '9',
	'0',
] as const;

/*
 * MICOM colour-key bytes. The previous values (398..401) were the Linux
 * KEY_RED..KEY_BLUE codes; they are outside the single-byte MICOM range, so
 * the service accepted them and nothing happened.
 */
const COLOUR_MICOM_KEYCODES = {
	red: 0x72,
	green: 0x71,
	yellow: 0x63,
	blue: 0x61,
} as const;

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

/**
 * MICOM command byte for a numeric remote button: 0-9 => 0x10-0x19.
 *
 * Do not substitute the table decompiled out of `network-input-service`: that
 * one is in Linux input-event codes (KEY_1 = 2 ... KEY_0 = 11) and belongs to
 * the native hook's keybinds, not to micomservice.
 */
export const numericMicomKeycode = (digit: string): number | null =>
	NUMERIC_MICOM_KEYCODES[digit] ?? null;

/** MICOM colour-key bytes: Red=0x72, Green=0x71, Yellow=0x63, Blue=0x61. */
export const colourMicomKeycode = (colour: string): number | null =>
	colour in COLOUR_MICOM_KEYCODES
		? COLOUR_MICOM_KEYCODES[colour as NumericKeypadColour]
		: null;

export const keypadMicomKeycode = (key: NumericKeypadSelection): number | null =>
	numericMicomKeycode(key) ?? colourMicomKeycode(key);

export const moveNumericKeypadSelection = (
	current: NumericKeypadSelection,
	direction: NumericKeypadDirection,
): NumericKeypadSelection => NUMERIC_KEYPAD_NEIGHBOURS[current][direction] ?? current;
