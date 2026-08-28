/*
 * `luna://com.webos.service.micomservice/sendKeycode` takes LG's MICOM/IR
 * command byte. `remote-buttons.json` is written in Linux input-event codes
 * throughout, because that is what the native hook matches on and what
 * REMOTE-BUTTONS.md documents. The two spaces overlap numerically, so an
 * untranslated value is accepted (returnValue: true) and fires an unrelated
 * function -- Linux KEY_7 is 8, and MICOM 0x08 is POWER.
 *
 * Only immediate (top-level) `replace` mappings are handled natively in the
 * uinput space. Timed `short`/`long` mappings are executed here, so they are
 * the ones that need translating.
 *
 * VERIFIED on hardware: 0x08 powers the TV off. The rest come from the public
 * LG IR command table and should be spot-checked per model before being
 * relied on.
 */
const UINPUT_TO_MICOM: Readonly<Record<number, number>> = {
	11: 0x10, // KEY_0
	2: 0x11, // KEY_1
	3: 0x12, // KEY_2
	4: 0x13, // KEY_3
	5: 0x14, // KEY_4
	6: 0x15, // KEY_5
	7: 0x16, // KEY_6
	8: 0x17, // KEY_7
	9: 0x18, // KEY_8
	10: 0x19, // KEY_9

	398: 0x72, // KEY_RED
	399: 0x71, // KEY_GREEN
	400: 0x63, // KEY_YELLOW
	401: 0x61, // KEY_BLUE

	103: 0x40, // KEY_UP
	108: 0x41, // KEY_DOWN
	105: 0x07, // KEY_LEFT
	106: 0x06, // KEY_RIGHT
	28: 0x44, // KEY_ENTER -> OK

	115: 0x02, // KEY_VOLUMEUP
	114: 0x03, // KEY_VOLUMEDOWN
	113: 0x09, // KEY_MUTE
	402: 0x00, // KEY_CHANNELUP
	403: 0x01, // KEY_CHANNELDOWN

	412: 0x28, // KEY_PREVIOUS -> BACK
	116: 0x08, // KEY_POWER
};

/**
 * Translates a Linux input-event code from remote-buttons.json into the MICOM
 * byte `sendKeycode` expects. Returns null when no translation is known, so
 * the caller can refuse rather than send an arbitrary command.
 */
export const micomKeycodeForUinput = (uinputCode: number): number | null =>
	UINPUT_TO_MICOM[uinputCode] ?? null;
