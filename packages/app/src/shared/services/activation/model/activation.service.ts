import mitt from 'mitt';

import { parseActivateType, type ActivateType } from 'shared/api/common';

import type { ActivationAction, ActivationEvents } from '../api/activation.interface';
import { activationActionFrom } from './activation.lib';

export class ActivationService {
	public readonly emitter = mitt<ActivationEvents>();
	public readonly initialAction: ActivationAction;

	public constructor() {
		this.initialAction = activationActionFrom(
			parseActivateType(webOSSystem.launchParams),
			webOSSystem.launchReason,
			true,
		);
		document.addEventListener('webOSRelaunch', this.handleRelaunch);
	}

	public dispose(): void {
		document.removeEventListener('webOSRelaunch', this.handleRelaunch);
	}

	private readonly handleRelaunch = (event: CustomEvent<ActivateType>): void => {
		this.emitter.emit(
			'action',
			activationActionFrom(event.detail ?? {}, webOSSystem.launchReason, false),
		);
	};
}
