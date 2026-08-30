import { reaction } from 'mobx';
import mitt from 'mitt';

import { APPLICATION_MANAGER_URI, parseActivateType, type ActivateType } from 'shared/api/common';
import { LunaTopic } from 'shared/services/luna';
import type { LunaMessage } from 'shared/services/luna';

import {
	resolveInitialActivation,
	resolveRelaunchActivation,
	type ActivationAction,
} from './activation.lib';

type AppLifeEvent = {
	appId?: string;
	event?: string;
};

type ActivationEvents = {
	action: ActivationAction;
	foreignLaunch: { appId: string; event: 'launch' | 'splash' };
};

export class ActivationService {
	public readonly emitter = mitt<ActivationEvents>();
	public readonly initialAction: ActivationAction;
	private readonly appLifeTopic = new LunaTopic<LunaMessage<AppLifeEvent>>(
		`${APPLICATION_MANAGER_URI}/getAppLifeEvents`,
	);

	public constructor() {
		const serializedLaunchParams = webOSSystem.launchParams;
		this.initialAction = resolveInitialActivation(
			parseActivateType(serializedLaunchParams),
			webOSSystem.launchReason,
		);
		let coldSource = 'default';
		if (serializedLaunchParams) coldSource = 'launchParams';
		else if (webOSSystem.launchReason) coldSource = 'launchReason';
		console.warn(`[HomeBackActivation] cold source=${coldSource} action=${this.initialAction.type}`);

		reaction(
			() => this.appLifeTopic.message,
			message => {
				if (!message?.returnValue || !message.appId || message.appId === process.env.APP_ID) return;
				if (message.event !== 'launch' && message.event !== 'splash') return;
				this.emitter.emit('foreignLaunch', {
					appId: message.appId,
					event: message.event,
				});
			},
		);

		document.addEventListener('webOSRelaunch', this.handleRelaunch);
	}

	private readonly handleRelaunch = (event: CustomEvent<ActivateType>): void => {
		const action = resolveRelaunchActivation(event.detail ?? {});
		console.warn(`[HomeBackActivation] relaunch source=detail action=${action.type}`);
		this.emitter.emit('action', action);
	};
}
