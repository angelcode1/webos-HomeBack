export const UINPUT_TO_MICOM: Readonly<Record<number, number>> = {
	11: 0x10,
	2: 0x11,
	3: 0x12,
	4: 0x13,
	5: 0x14,
	6: 0x15,
	7: 0x16,
	8: 0x17,
	9: 0x18,
	10: 0x19,
	398: 0x72,
	399: 0x71,
	400: 0x63,
	401: 0x61,
	103: 0x40,
	108: 0x41,
	105: 0x07,
	106: 0x06,
	28: 0x44,
	115: 0x02,
	114: 0x03,
	113: 0x09,
	402: 0x00,
	403: 0x01,
	412: 0x28,
	116: 0x08,
};

export const NUMERIC_MICOM_KEYCODES: Readonly<Record<string, number>> = {
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

export const COLOUR_MICOM_KEYCODES = {
	red: 0x72,
	green: 0x71,
	yellow: 0x63,
	blue: 0x61,
} as const;

export type MicomColour = keyof typeof COLOUR_MICOM_KEYCODES;

export const micomKeycodeForUinput = (uinputCode: number): number | null =>
	UINPUT_TO_MICOM[uinputCode] ?? null;

export const numericMicomKeycode = (digit: string): number | null =>
	NUMERIC_MICOM_KEYCODES[digit] ?? null;

export const colourMicomKeycode = (colour: string): number | null =>
	colour in COLOUR_MICOM_KEYCODES
		? COLOUR_MICOM_KEYCODES[colour as MicomColour]
		: null;
