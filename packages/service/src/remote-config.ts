export type NativeReplace = { action: 'replace'; keycode: number };
export type NativeIgnore = { action: 'ignore' };
export type NativeExec = { action: 'exec'; command: string };
export type NativeLaunch = { action: 'launch'; id: string };
export type NativePass = { action: 'pass' };
export type SimpleMapping = (
	NativeReplace | NativeIgnore | NativeExec | NativeLaunch | NativePass
) & { label?: string };

export type SemanticAction =
	| { action: 'ignore' }
	| { action: 'launch'; id: string; params?: Record<string, unknown> }
	| { action: 'exec'; command: string }
	| { action: 'replace'; keycode: number };

export type TimedMapping = {
	label?: string;
	longPressMs?: number;
	short?: SemanticAction;
	long?: SemanticAction;
};

export type RemoteMapping = SimpleMapping | TimedMapping;
export type RemoteConfig = {
	version: 1;
	defaultLongPressMs?: number;
	keys: Record<string, RemoteMapping>;
};

const MAX_KEYCODE = 0x7fffffff;
const MAX_LONG_PRESS_MS = 60_000;

export const isTimedMapping = (mapping: RemoteMapping): mapping is TimedMapping =>
	'short' in mapping || 'long' in mapping || 'longPressMs' in mapping;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.trim().length > 0;

export const isKeycode = (value: unknown): value is number =>
	typeof value === 'number' &&
	Number.isInteger(value) &&
	value >= 0 &&
	value <= MAX_KEYCODE;

const TIMED_REPLACE_NON_DIGIT_KEYCODES = new Set([
	28, // KEY_ENTER
	103, // KEY_UP
	105, // KEY_LEFT
	106, // KEY_RIGHT
	108, // KEY_DOWN
	113, // KEY_MUTE
	114, // KEY_VOLUMEDOWN
	115, // KEY_VOLUMEUP
	116, // KEY_POWER
	398, // KEY_RED
	399, // KEY_GREEN
	400, // KEY_YELLOW
	401, // KEY_BLUE
	402, // KEY_CHANNELUP
	403, // KEY_CHANNELDOWN
	412, // KEY_PREVIOUS / BACK
]);

/**
 * Timed replace actions are executed through micomservice rather than the
 * native uinput hook, so only uinput codes with an explicit MICOM translation
 * are valid here. Keep this predicate in lockstep with micom-keycodes.ts; the
 * regression suite compares the two across the supported range.
 */
export const isTimedReplaceKeycode = (value: unknown): value is number =>
	isKeycode(value) &&
	((value >= 2 && value <= 11) || TIMED_REPLACE_NON_DIGIT_KEYCODES.has(value));

const isDuration = (value: unknown): value is number =>
	typeof value === 'number' &&
	Number.isInteger(value) &&
	value >= 100 &&
	value <= MAX_LONG_PRESS_MS;

export const validateAction = (action: unknown): action is SemanticAction => {
	if (!isPlainObject(action)) return false;

	switch (action.action) {
		case 'ignore':
			return true;
		case 'launch':
			return isNonEmptyString(action.id) &&
				(action.params === undefined || isPlainObject(action.params));
		case 'exec':
			return isNonEmptyString(action.command);
		case 'replace':
			return isTimedReplaceKeycode(action.keycode);
		default:
			return false;
	}
};

export const validateConfig = (input: unknown): input is RemoteConfig => {
	if (!isPlainObject(input) || input.version !== 1 || !isPlainObject(input.keys)) return false;

	if (input.defaultLongPressMs !== undefined && !isDuration(input.defaultLongPressMs)) return false;

	for (const [key, raw] of Object.entries(input.keys)) {
		if (!/^\d+$/.test(key) || !isKeycode(Number(key)) || !isPlainObject(raw)) return false;

		if ('short' in raw || 'long' in raw || 'longPressMs' in raw) {
			if (raw.short === undefined && raw.long === undefined) return false;
			if (raw.short !== undefined && !validateAction(raw.short)) return false;
			if (raw.long !== undefined && !validateAction(raw.long)) return false;
			if (raw.longPressMs !== undefined && !isDuration(raw.longPressMs)) return false;
			continue;
		}

		switch (raw.action) {
			case 'pass':
			case 'ignore':
				break;
			case 'replace':
				if (!isKeycode(raw.keycode)) return false;
				break;
			case 'exec':
				if (!isNonEmptyString(raw.command)) return false;
				break;
			case 'launch':
				if (!isNonEmptyString(raw.id)) return false;
				break;
			default:
				return false;
		}
	}

	return true;
};

export const buildNativeKeybinds = (config: RemoteConfig): Record<string, Record<string, unknown>> => {
	const native: Record<string, Record<string, unknown>> = {};

	for (const [key, mapping] of Object.entries(config.keys)) {
		if (isTimedMapping(mapping)) {
			native[key] = { action: 'ignore' };
			continue;
		}

		if (mapping.action === 'pass') continue;
		const { label: _label, ...nativeMapping } = mapping;
		native[key] = nativeMapping;
	}

	return native;
};
