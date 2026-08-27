import { makeAutoObservable } from 'mobx';

import type {
	LaunchParams,
	LaunchPointActions,
	LaunchPointInput,
} from '../api/launch-point.interface';
import {
	genericAppIcon,
	normalizeExternalIcon,
	preferredIconPath,
} from './icon-fallback';

export class LaunchPoint {
	public appId = '';
	public title = '';
	public launchPointId = '';
	public builtin = false;
	public icon = '';
	public fallbackIcon = '';
	public iconColor = '';
	public params: LaunchParams = {};

	public constructor(
		private readonly actions: LaunchPointActions,
		snapshot: LaunchPointInput,
	) {
		makeAutoObservable<LaunchPoint, 'actions'>(
			this,
			{ actions: false },
			{ autoBind: true },
		);
		this.apply(snapshot);
	}

	public launch(): Promise<unknown> {
		return this.actions.launch(this);
	}

	public move(shift: number): void {
		this.actions.move(this, shift);
	}

	public show(): void {
		this.actions.show(this);
	}

	public hide(): void {
		this.actions.hide(this);
	}

	public apply(snapshot: LaunchPointInput): LaunchPoint {
		const fallbackIcon = genericAppIcon(snapshot.title);
		this.appId = snapshot.id;
		this.icon = normalizeExternalIcon(preferredIconPath(snapshot)) || fallbackIcon;
		this.fallbackIcon = fallbackIcon;
		this.title = snapshot.title;
		this.launchPointId = snapshot.launchPointId;
		this.iconColor = snapshot.iconColor;
		this.builtin = snapshot.builtin ?? false;
		this.params = snapshot.params ?? {};
		return this;
	}
}
