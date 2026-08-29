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
import { LaunchPoint } from './launch-point.model';

export type LauncherEvents = {
	openDrawer: void;
	openNumericKeyboard: void;
	beforeExternalLaunch: void;
	beforeSurfaceYield: void;
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

		reaction(
			() => ({
				settled: this.fulfilled,
				validIds: this.launchPoints.filter(lp => !lp.builtin).map(lp => lp.launchPointId),
			}),
			({ settled, validIds }) => {
				if (!settled) return;
				const valid = new Set(validIds);
				const pruned = this.settingsService.order.filter(id => valid.has(id));
				if (pruned.length !== this.settingsService.order.length) {
					this.settingsService.order = pruned;
				}
			},
		);
	}

	public get fulfilled(): boolean {
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
					this.emitter.emit('beforeSurfaceYield');
					await this.surfaceService.waitUntilHidden();
					return luna('luna://com.webos.surfacemanager/showInputPicker', {});
			}
		}

		if (!builtin) this.emitter.emit('beforeExternalLaunch');

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
		if (shift !== -1 && shift !== 1) return;
		const ids = this.visible
			.filter(item => !item.builtin)
			.map(item => item.launchPointId);
		const from = ids.indexOf(launchPoint.launchPointId);
		const to = from + shift;
		if (from < 0 || to < 0 || to >= ids.length) return;

		ids.splice(from, 1);
		ids.splice(to, 0, launchPoint.launchPointId);
		this.order = ids;
	}

	private get order(): string[] {
		return this.settingsService.order;
	}

	private set order(value: string[]) {
		if (!this.fulfilled) return;

		const nonBuiltinIds = new Set(
			this.launchPoints.filter(item => !item.builtin).map(item => item.launchPointId),
		);
		this.settingsService.order = [...new Set(value)].filter(id => nonBuiltinIds.has(id));
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
