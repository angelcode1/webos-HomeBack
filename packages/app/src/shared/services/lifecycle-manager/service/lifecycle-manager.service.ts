import { reaction } from 'mobx';
import mitt from 'mitt';

import { APPLICATION_MANAGER_URI } from 'shared/api/common';

import { LunaTopic } from '../../luna';
import type { LunaMessage } from '../../luna';
import type { LifecycleEvent } from '../api/compositor.interface';
import type { LifecycleManagerEvents } from '../api/lifecycle-manager.interface';

export class LifecycleManagerService {
	public readonly emitter = mitt<LifecycleManagerEvents>();
	private readonly topic = new LunaTopic<LunaMessage<LifecycleEvent>>(
		`${APPLICATION_MANAGER_URI}/getAppLifeEvents`,
	);

	public constructor() {
		reaction(
			() => this.topic.message,
			message => {
				if (
					message?.returnValue &&
					message.appId !== process.env.APP_ID &&
					(message.event === 'splash' || message.event === 'launch')
				) this.emitter.emit('foreignLaunch');
			},
		);
	}
}
