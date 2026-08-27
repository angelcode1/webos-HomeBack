export const NUMERIC_REMOTE_KEY_INTERVAL_MS = 80;

const NUMERIC_MICOM_KEYCODES: Readonly<Record<string, number>> = {
	'0': 11,
	'1': 2,
	'2': 3,
	'3': 4,
	'4': 5,
	'5': 6,
	'6': 7,
	'7': 8,
	'8': 9,
	'9': 10,
};

export interface RemoteBackKeyLike {
	key?: string;
	keyCode?: number;
	which?: number;
}

/**
 * Linux input-event keycodes used by LG's micomservice for the physical 0-9
 * remote buttons. Sending these through sendKeycode makes the keypad behave
 * like number presses on the remote (for example, channel-number entry).
 */
export const numericMicomKeycode = (digit: string): number | null =>
	NUMERIC_MICOM_KEYCODES[digit] ?? null;

export const numericMicomKeycodes = (value: string): number[] =>
	[...value]
		.map(numericMicomKeycode)
		.filter((keycode): keycode is number => keycode !== null);

export const isRemoteBackKey = ({ key, keyCode, which }: RemoteBackKeyLike): boolean =>
	key === 'GoBack' || key === 'BrowserBack' || keyCode === 461 || which === 461;
