import { makeAutoObservable, runInAction } from 'mobx';

import { luna } from '../../luna';
import type { SystemInfoMessage } from '../api/system-info.interface';
import { systemInfoKeys } from '../lib/system-info-keys.lib';

export class SystemInfoService {
	public firmwareVersion: string | null = null;
	public modelName: string | null = null;
	public sdkVersion: string | null = null;

	public constructor() {
		makeAutoObservable(this, {}, { autoBind: true });

		void luna<SystemInfoMessage>(
			'luna://com.webos.service.tv.systemproperty/getSystemInfo',
			{ keys: systemInfoKeys },
		)
			.then(message => {
				if (!message.returnValue) return;
				runInAction(() => {
					this.firmwareVersion =
						typeof message.firmwareVersion === 'string'
							? message.firmwareVersion
							: null;
					this.modelName =
						typeof message.modelName === 'string'
							? message.modelName
							: null;
					this.sdkVersion =
						typeof message.sdkVersion === 'string'
							? message.sdkVersion
							: null;
				});
			})
			.catch(error => console.error('Unable to read system information:', error));
	}

	public get osMajorVersion(): number | null {
		return this.osVersionParts?.[0] ?? null;
	}

	public get osMinorVersion(): number | null {
		return this.osVersionParts?.[1] ?? null;
	}

	private get osVersionParts(): [number, number, number] | null {
		if (!this.sdkVersion) return null;

		const parts = this.sdkVersion.split('.').map(Number);
		if (
			parts.length < 2 ||
			parts.length > 3 ||
			parts.some(part => !Number.isInteger(part) || part < 0)
		) {
			return null;
		}

		return [parts[0], parts[1], parts[2] ?? 0];
	}
}
