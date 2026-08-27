import type { LaunchPointInput } from '../api/launch-point.interface';

export type ProviderState = 'loading' | 'ready' | 'error';

export interface LaunchPointsProvider {
	readonly state: ProviderState;
	readonly launchPoints: LaunchPointInput[];
	refresh?(): Promise<void> | void;
}
