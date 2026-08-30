import { makeAutoObservable, observable, reaction } from 'mobx';
import mitt from 'mitt';

import { APPLICATION_MANAGER_URI } from 'shared/api/common';

import { luna } from '../../luna';
import { SettingsService } from '../../settings';
import { SurfaceService } from '../../surface';
import type {
	InternalLaunchParams,
	LaunchPointActions,
	LaunchPointInput,
	LaunchPointInstance,
} from '../api/launch-point.interface';
import type { LaunchPointsProvider } from '../providers';
import {
	moveWithinPersistedOrder,
	sanitizePersistedOrder,
} from './launcher-order.lib';
import { LaunchPoint } from './launch-point.model';

type LauncherEvents = {
	openDrawer: void;
	openNumericKeyboard: void;
};

const isInternalParams = (
	params: Record<string, unknown> | InternalLaunchParams,
): params is InternalLaunchParams =>
	'internalAction' in params;

export class LauncherService implements LaunchPointActions {
	public readonly emitter = mitt<LauncherEvents>();
	private readonly launchPointsMap = observable.map<string, LaunchPointInstance>();
	private launchPointIds: string[] = [];

	public constructor(
		private readonly settingsService: SettingsService,
		private readonly surfaceService: SurfaceService,
		private readonly providers: LaunchPointsProvider[],
	) {
		makeAutoObservable<
			LauncherService,
			'settingsService' | 'surfaceService' | 'providers' | 'launchPointsMap'
		>(
			this,
			{
				settingsService: false,
				surfaceService: false,
				providers: false,
				launchPointsMap: false,
			},
			{ autoBind: true },
		);

		reaction(
			() => this.providers.flatMap(provider => provider.launchPoints),
			snapshots => this.reconcileLaunchPoints(snapshots),
			{ fireImmediately: true },
		);
	}

	public get fulfilled(): boolean {
		// Settled means the launcher has enough information to render. A provider
		// error is surfaced separately rather than masquerading as healthy.
		return this.providers.every(provider => provider.state !== 'loading');
	}

	public get providerErrorCount(): number {
		return this.providers.filter(provider => provider.state === 'error').length;
	}

	public get launchPoints(): LaunchPointInstance[] {
		if (!this.fulfilled) return [];
		return this.launchPointIds
			.map(id => this.launchPointsMap.get(id))
			.filter((launchPoint): launchPoint is LaunchPointInstance => Boolean(launchPoint));
	}

	public get visible(): LaunchPointInstance[] {
		const all = this.launchPoints;
		const byId = new Map(all.map(launchPoint => [launchPoint.launchPointId, launchPoint]));
		const builtinIds = all.filter(lp => lp.builtin).map(lp => lp.launchPointId);

		return [...this.order, ...builtinIds]
			.map(id => byId.get(id))
			.filter((launchPoint): launchPoint is LaunchPointInstance => Boolean(launchPoint));
	}

	public get hidden(): LaunchPointInstance[] {
		const order = new Set(this.order);
		return this.launchPoints.filter(lp => !lp.builtin && !order.has(lp.launchPointId));
	}

	public async launch({ appId, builtin, params }: LaunchPointInstance): Promise<unknown> {
		if (builtin && isInternalParams(params)) {
			switch (params.internalAction) {
				case 'openDrawer':
					this.emitter.emit('openDrawer');
					return { returnValue: true };

				case 'openNumericKeyboard':
					this.emitter.emit('openNumericKeyboard');
					return { returnValue: true };

				case 'showInputPicker':
					await this.surfaceService.yieldSurfaceAndWait();
					return luna('luna://com.webos.surfacemanager/showInputPicker', {});
			}
		}

		if (!builtin) this.surfaceService.dismissFeatures();

		return luna(`${APPLICATION_MANAGER_URI}/launch`, {
			id: appId,
			params,
		});
	}

	public show(launchPoint: LaunchPointInstance): void {
		if (launchPoint.builtin || this.order.includes(launchPoint.launchPointId)) return;
		this.order = [...this.order, launchPoint.launchPointId];
	}

	public hide({ launchPointId }: LaunchPointInstance): void {
		this.order = this.order.filter(id => id !== launchPointId);
	}

	public move(launchPoint: LaunchPointInstance, shift: number): void {
		const visibleIds = this.visible
			.filter(item => !item.builtin)
			.map(item => item.launchPointId);
		const nextOrder = moveWithinPersistedOrder(
			this.order,
			visibleIds,
			launchPoint.launchPointId,
			shift,
		);
		if (nextOrder) this.order = nextOrder;
	}

	private get order(): string[] {
		return this.settingsService.order;
	}

	private set order(value: string[]) {
		if (!this.fulfilled) return;
		this.settingsService.order = sanitizePersistedOrder(value, this.launchPoints);
	}

	private reconcileLaunchPoints(snapshots: LaunchPointInput[]): void {
		const nextIds: string[] = [];
		const liveIds = new Set<string>();

		for (const snapshot of snapshots) {
			nextIds.push(snapshot.launchPointId);
			liveIds.add(snapshot.launchPointId);

			const existing = this.launchPointsMap.get(snapshot.launchPointId);
			if (existing) existing.apply(snapshot);
			else this.launchPointsMap.set(snapshot.launchPointId, new LaunchPoint(this, snapshot));
		}

		for (const id of [...this.launchPointsMap.keys()]) {
			if (!liveIds.has(id)) this.launchPointsMap.delete(id);
		}

		this.launchPointIds = nextIds;
	}
}
