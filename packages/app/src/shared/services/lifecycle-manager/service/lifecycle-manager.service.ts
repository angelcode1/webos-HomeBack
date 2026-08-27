import { makeAutoObservable, reaction } from 'mobx';
import mitt from 'mitt';

import { Intent, type ActivateType } from 'shared/api/common';

import { luna, LunaTopic } from '../../luna';
import type { LunaMessage } from '../../luna';
import { SystemInfoService } from '../../system-info';
import type { LifecycleEvent } from '../api/compositor.interface';
import type {
	LifecycleManagerEvents,
	VisibilityController,
} from '../api/lifecycle-manager.interface';

export class LifecycleManagerService {
	public readonly emitter = mitt<LifecycleManagerEvents>();
	private readonly topic = new LunaTopic<LunaMessage<LifecycleEvent>>(
		'luna://com.webos.service.applicationManager/getAppLifeEvents',
	);
	private visibilityController: VisibilityController | null = null;

	public constructor(private readonly systemInfoService: SystemInfoService) {
		makeAutoObservable<
			LifecycleManagerService,
			'topic' | 'systemInfoService' | 'visibilityController'
		>(
			this,
			{
				topic: false,
				systemInfoService: false,
				visibilityController: false,
			},
			{ autoBind: true },
		);

		reaction(
			() => this.topic.message,
			message => {
				if (
					message?.returnValue &&
					message.appId !== process.env.APP_ID &&
					(message.event === 'splash' || message.event === 'launch')
				) {
					this.broadcastHide();
				}
			},
		);

		document.addEventListener('webOSRelaunch', this.handleRelaunch as EventListener);
	}

	public bindVisibilityController(controller: VisibilityController): void {
		this.visibilityController = controller;
	}

	public commitVisible(): void {
		webOSSystem.activate();
	}

	public commitHidden(): void {
		if (this.compositorShimsRequired) this.requestSuspense();
		else webOSSystem.hide();
	}

	public broadcastHide(): void {
		if (!this.visibilityController?.isVisible()) return;
		if (__DEV__) console.log('broadcasting hide request');
		this.emitter.emit('requestHide');
	}

	public async requestHideAndWait(): Promise<void> {
		const controller = this.visibilityController;
		if (!controller) {
			this.commitHidden();
			return;
		}

		controller.requestHide();
		await controller.waitUntilHidden();
	}

	private get compositorShimsRequired(): boolean {
		if (this.systemInfoService.osMajorVersion === 7) {
			return (this.systemInfoService.osMinorVersion ?? 0) < 3;
		}

		return this.systemInfoService.osMajorVersion
			? this.systemInfoService.osMajorVersion < 7
			: true;
	}

	private handleRelaunch(event: CustomEvent<ActivateType>): void {
		if (event.detail?.intent === Intent.ShowHomeBack) {
			this.emitter.emit('relaunch');
		} else if (
			event.detail?.activateType === 'home' &&
			!this.visibilityController?.isVisible()
		) {
			this.emitter.emit('relaunch');
		} else if (this.visibilityController?.isVisible()) {
			this.emitter.emit('requestHide');
		}
	}

	private requestSuspense(): void {
		void luna('luna://com.webos.service.applicationManager/suspense', {
			id: process.env.APP_ID,
		}).catch(error => console.error('Unable to suspend HomeBack:', error));
	}
}
