import { computed, makeObservable } from 'mobx';

import { LunaTopic } from 'shared/services/luna';
import type { LaunchPointInput } from '../../api/launch-point.interface';
import { genericInputIcon } from '../../model/icon-fallback';
import type { LaunchPointsProvider, ProviderState } from '../launch-points.provider';
import type { Device, InputManagerMessage } from './input-manager.interface';

export class InputProvider implements LaunchPointsProvider {
	private readonly topic = new LunaTopic<InputManagerMessage>(
		'luna://com.webos.service.eim/getAllInputStatus',
	);

	public constructor() {
		makeObservable(
			this,
			{
				state: computed,
				launchPoints: computed.struct,
			},
			{ autoBind: true },
		);
	}

	public get state(): ProviderState {
		if (!this.topic.message) return 'loading';
		return this.topic.message.returnValue ? 'ready' : 'error';
	}

	public get launchPoints(): LaunchPointInput[] {
		const { message } = this.topic;
		if (!message?.returnValue || !Array.isArray(message.devices)) return [];

		return message.devices
			.filter(this.isPhysicalDevice)
			.map(this.mapDeviceToLaunchPoint);
	}

	private isPhysicalDevice(device: Device): boolean {
		return !('mvpdIcon' in device || 'pigImage' in device);
	}

	private mapDeviceToLaunchPoint(device: Device): LaunchPointInput {
		return {
			id: device.appId,
			launchPointId: `@input:${device.appId}`,
			title: device.label,
			icon: genericInputIcon,
			iconColor: '#ffffff',
		};
	}
}
