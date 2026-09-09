import { execFile } from 'child_process';
import { promisify } from 'util';

import { colourMicomKeycode, numericMicomKeycode } from '@homeback/utils';

const execFileAsync = promisify(execFile);
const MICOM_SEND_KEYCODE_URI = 'luna://com.webos.service.micomservice/sendKeycode';
const LUNA_SEND_TIMEOUT_MS = 3_000;
const LUNA_SEND_MAX_BUFFER = 16 * 1024;

type LunaSendResponse = {
	returnValue?: unknown;
	errorCode?: unknown;
	errorText?: unknown;
};

const describeError = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export const micomKeycodeForRemoteButton = (button: unknown): number | null => {
	if (typeof button !== 'string') return null;
	return numericMicomKeycode(button) ?? colourMicomKeycode(button);
};

/**
 * Send a synthetic LG remote command from the elevated helper process.
 *
 * Do not call micomservice directly from the web app: HomeBack intentionally
 * does not grant the app the private MICOM ACG. Using luna-send from the root
 * helper also avoids coupling timed replacements to the helper service's LS2
 * outbound identity.
 */
export const sendMicomKeycode = async (micomKeycode: number): Promise<void> => {
	let stdout = '';
	let stderr = '';

	try {
		const result = await execFileAsync(
			'luna-send',
			[
				'-n',
				'1',
				'-f',
				MICOM_SEND_KEYCODE_URI,
				JSON.stringify({ keycode: micomKeycode }),
			],
			{
				encoding: 'utf8',
				timeout: LUNA_SEND_TIMEOUT_MS,
				maxBuffer: LUNA_SEND_MAX_BUFFER,
			},
		);
		stdout = result.stdout;
		stderr = result.stderr;
	} catch (error) {
		throw new Error(`luna-send could not send MICOM keycode ${micomKeycode}: ${describeError(error)}`);
	}

	let response: LunaSendResponse;
	try {
		response = JSON.parse(stdout.trim()) as LunaSendResponse;
	} catch (error) {
		const detail = stderr.trim() || stdout.trim() || describeError(error);
		throw new Error(`Invalid luna-send response for MICOM keycode ${micomKeycode}: ${detail}`);
	}

	if (response.returnValue !== true) {
		const detail =
			typeof response.errorText === 'string'
				? response.errorText
				: stderr.trim() || `errorCode=${String(response.errorCode ?? 'unknown')}`;
		throw new Error(`MICOM keycode ${micomKeycode} was rejected: ${detail}`);
	}
};
