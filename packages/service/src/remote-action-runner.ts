import { spawn } from 'child_process';

import type { Service } from './bus';
import { APPLICATION_MANAGER_URI, APP_ID } from './environment';
import { micomKeycodeForUinput } from './micom-keycodes';
import type { SemanticAction } from './remote-config';

export type RemoteActionKind = 'short' | 'long';

export type LastRemoteAction = {
	keycode: number;
	kind: RemoteActionKind;
	action: SemanticAction['action'];
	startedAtMs: number;
	completedAtMs: number | null;
	outcome: 'pending' | 'ok' | 'error';
	error?: string;
};

export class RemoteActionRunner {
	public lastAction: LastRemoteAction | null = null;

	public constructor(private readonly service: Service) {}

	public async execute(
		action: SemanticAction,
		keycode: number,
		kind: RemoteActionKind,
	): Promise<void> {
		const record: LastRemoteAction = {
			keycode,
			kind,
			action: action.action,
			startedAtMs: Date.now(),
			completedAtMs: null,
			outcome: 'pending',
		};
		this.lastAction = record;

		try {
			console.log(
				`Remote key ${keycode} ${kind}: ${action.action} at=${new Date(record.startedAtMs).toISOString()}`,
			);

			switch (action.action) {
				case 'ignore':
					break;
				case 'launch': {
					const params = action.params ?? (action.id === APP_ID ? { intent: 'homeback:show' } : undefined);
					await this.service.oneshot(`${APPLICATION_MANAGER_URI}/launch`, {
						id: action.id,
						...(params ? { params } : {}),
					});
					break;
				}
				case 'replace': {
					// remote-buttons.json is in Linux input-event codes; sendKeycode is not.
					// Refuse unknown codes rather than firing an arbitrary MICOM command.
					const micom = micomKeycodeForUinput(action.keycode);
					if (micom === null) {
						throw new Error(
							`No MICOM translation for keycode ${action.keycode}; ` +
								'timed replace mappings only support keys listed in micom-keycodes.ts.',
						);
					}
					await this.service.oneshot('luna://com.webos.service.micomservice/sendKeycode', {
						keycode: micom,
					});
					break;
				}
				case 'exec': {
					const child = spawn('/bin/sh', ['-c', action.command], {
						detached: true,
						stdio: 'ignore',
					});
					child.unref();
					break;
				}
			}

			record.completedAtMs = Date.now();
			record.outcome = 'ok';
		} catch (error) {
			record.completedAtMs = Date.now();
			record.outcome = 'error';
			record.error = error instanceof Error ? error.message : String(error);
			console.error(`Remote key ${keycode} ${kind} action failed:`, error);
		}
	}
}
