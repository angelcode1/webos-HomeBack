import { makeAutoObservable, observable, reaction, runInAction } from 'mobx';

import { luna, LunaTopic } from 'shared/services/luna';
import type { LaunchPointInput } from '../../api/launch-point.interface';
import {
	genericAppIcon,
	preferredIconPaths,
} from '../../model/icon-fallback';
import type { LaunchPointsProvider, ProviderState } from '../launch-points.provider';
import type { AppManagerMessage } from './app-manager.interface';

const INPUT_APP_ID = /^com\.webos\.app\.(?:hdmi\d+|av\d+|component\d+)$/i;
const ICON_CONCURRENCY = 4;

type IconResponse = {
	returnValue: true;
	done: true;
	dataUrl: string | null;
};

export class AppManagerProvider implements LaunchPointsProvider {
	public launchPoints: LaunchPointInput[] = observable.array([]);
	public state: ProviderState = 'loading';

	private readonly topic = new LunaTopic<AppManagerMessage>(
		'luna://com.webos.service.applicationManager/listLaunchPoints',
	);
	private generation = 0;
	private readonly iconRevision = new Map<string, number>();
	private readonly iconQueue: Array<() => Promise<void>> = [];
	private activeIconLoads = 0;

	public constructor() {
		makeAutoObservable<
			AppManagerProvider,
			'topic' | 'generation' | 'iconRevision' | 'iconQueue' | 'activeIconLoads'
		>(
			this,
			{
				topic: false,
				generation: false,
				iconRevision: false,
				iconQueue: false,
				activeIconLoads: false,
			},
			{ autoBind: true },
		);

		reaction(
			() => this.topic.message,
			message => {
				if (message) this.handleMessage(message);
			},
		);
	}

	private handleMessage(message: AppManagerMessage): void {
		if (!message.returnValue) {
			this.state = 'error';
			console.error('listLaunchPoints failed:', message);
			return;
		}

		this.state = 'ready';

		if ('launchPoints' in message) {
			const generation = ++this.generation;
			this.iconRevision.clear();

			const raw = message.launchPoints.filter(
				lp => lp.id !== process.env.APP_ID && !INPUT_APP_ID.test(lp.id),
			);
			this.launchPoints = raw.map(this.withFallbackIcon);

			for (const snapshot of raw) {
				const revision = this.bumpRevision(snapshot.launchPointId);
				this.enqueueIcon(snapshot, generation, revision);
			}
			return;
		}

		if (!('change' in message)) return;

		const { change, returnValue: _returnValue, ...rest } = message;
		const snapshot = rest as LaunchPointInput;
		if (snapshot.id === process.env.APP_ID || INPUT_APP_ID.test(snapshot.id)) return;

		const index = this.launchPoints.findIndex(
			item => item.launchPointId === snapshot.launchPointId,
		);
		const revision = this.bumpRevision(snapshot.launchPointId);

		switch (change) {
			case 'added':
			case 'updated': {
				const prepared = this.withFallbackIcon(snapshot);
				if (index >= 0) this.launchPoints[index] = prepared;
				else this.launchPoints.push(prepared);
				this.enqueueIcon(snapshot, this.generation, revision);
				break;
			}
			case 'removed':
				if (index >= 0) this.launchPoints.splice(index, 1);
				break;
		}
	}

	private bumpRevision(launchPointId: string): number {
		const next = (this.iconRevision.get(launchPointId) ?? 0) + 1;
		this.iconRevision.set(launchPointId, next);
		return next;
	}

	private withFallbackIcon(snapshot: LaunchPointInput): LaunchPointInput {
		return {
			...snapshot,
			icon: genericAppIcon(snapshot.title),
			mediumLargeIcon: undefined,
			largeIcon: undefined,
			extraLargeIcon: undefined,
		};
	}

	private enqueueIcon(snapshot: LaunchPointInput, generation: number, revision: number): void {
		this.iconQueue.push(() => this.hydrateIcon(snapshot, generation, revision));
		this.drainIconQueue();
	}

	private drainIconQueue(): void {
		while (this.activeIconLoads < ICON_CONCURRENCY && this.iconQueue.length > 0) {
			const task = this.iconQueue.shift()!;
			this.activeIconLoads += 1;
			void task().finally(() => {
				this.activeIconLoads -= 1;
				this.drainIconQueue();
			});
		}
	}

	private async hydrateIcon(
		snapshot: LaunchPointInput,
		generation: number,
		revision: number,
	): Promise<void> {
		try {
			const response = await luna<IconResponse>(
				`luna://${process.env.SERVICE_ID}/readIcon`,
				{
					id: snapshot.id,
					folderPath: snapshot.folderPath,
					paths: preferredIconPaths(snapshot),
				},
			);

			if (
				!response.dataUrl ||
				generation !== this.generation ||
				this.iconRevision.get(snapshot.launchPointId) !== revision
			) {
				return;
			}

			runInAction(() => {
				const index = this.launchPoints.findIndex(
					lp => lp.launchPointId === snapshot.launchPointId,
				);
				if (index < 0) return;
				this.launchPoints[index] = {
					...this.launchPoints[index],
					icon: response.dataUrl!,
				};
			});
		} catch (error) {
			if (__DEV__) console.warn(`Unable to hydrate icon for ${snapshot.id}:`, error);
		}
	}
}
