import type { LaunchPoint } from '../model/launch-point.model';

export type InternalLaunchParams =
	| { internalAction: 'openDrawer' }
	| { internalAction: 'showInputPicker' }
	| { internalAction: 'openNumericKeyboard' }
	| { internalAction: 'micomKey'; keycode: 398 | 399 | 400 | 401 };

export type LaunchParams = InternalLaunchParams | Record<string, unknown>;

export type LaunchPointInput = {
	id: string;
	title: string;
	launchPointId: string;
	iconColor: string;
	icon: string;
	folderPath?: string;
	mediumLargeIcon?: string;
	largeIcon?: string;
	extraLargeIcon?: string;
	builtin?: boolean;
	params?: LaunchParams;
};

export type LaunchPointInstance = LaunchPoint;

export interface LaunchPointActions {
	launch(launchPoint: LaunchPointInstance): Promise<unknown>;
	move(launchPoint: LaunchPointInstance, shift: number): void;
	show(launchPoint: LaunchPointInstance): void;
	hide(launchPoint: LaunchPointInstance): void;
}
