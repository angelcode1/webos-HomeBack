import type { LaunchPointInput } from '../../api/launch-point.interface';
import { genericInputIcon, svgIcon } from '../../model/icon-fallback';
import type { LaunchPointsProvider, ProviderState } from '../launch-points.provider';

type CameraAvailability = {
	readonly cameras: readonly unknown[];
};

const keypadIcon = svgIcon([
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
	'<rect x="20" y="13" width="60" height="74" rx="9" fill="none" stroke="white" stroke-width="7"/>',
	'<g fill="white">',
	'<circle cx="36" cy="34" r="5"/><circle cx="50" cy="34" r="5"/><circle cx="64" cy="34" r="5"/>',
	'<circle cx="36" cy="50" r="5"/><circle cx="50" cy="50" r="5"/><circle cx="64" cy="50" r="5"/>',
	'<circle cx="36" cy="66" r="5"/><circle cx="50" cy="66" r="5"/><circle cx="64" cy="66" r="5"/>',
	'<circle cx="50" cy="78" r="5"/>',
	'</g></svg>',
].join(''));

const cameraIcon = svgIcon([
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
	'<path d="M20 34h14l7-9h18l7 9h14v42H20z" fill="none" stroke="white" stroke-width="7" stroke-linejoin="round"/>',
	'<circle cx="50" cy="55" r="13" fill="none" stroke="white" stroke-width="7"/>',
	'</svg>',
].join(''));

const plusIcon = svgIcon([
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
	'<path d="M50 24v52M24 50h52" fill="none" stroke="white" stroke-width="8" stroke-linecap="round"/>',
	'</svg>',
].join(''));

export class InternalProvider implements LaunchPointsProvider {
	public readonly state: ProviderState = 'ready';

	public constructor(private readonly cameraService: CameraAvailability) {}

	public get launchPoints(): LaunchPointInput[] {
		const launchPoints: LaunchPointInput[] = [
			{
				id: process.env.APP_ID,
				launchPointId: '@button:inputs',
				title: 'Inputs',
				builtin: true,
				iconColor: '#242424',
				icon: genericInputIcon,
				params: { internalAction: 'showInputPicker' },
			},
			{
				id: process.env.APP_ID,
				launchPointId: '@button:keypad',
				title: 'Keypad',
				builtin: true,
				iconColor: '#242424',
				icon: keypadIcon,
				params: { internalAction: 'openNumericKeyboard' },
			},
		];

		if (this.cameraService.cameras.length > 0) {
			launchPoints.push({
				id: process.env.APP_ID,
				launchPointId: '@button:cameras',
				title: 'Cameras',
				builtin: true,
				iconColor: '#242424',
				icon: cameraIcon,
				params: { internalAction: 'openCameras' },
			});
		}

		launchPoints.push({
			id: process.env.APP_ID,
			launchPointId: '@intent:add_apps',
			title: 'Add apps',
			builtin: true,
			iconColor: '#242424',
			icon: plusIcon,
			params: { internalAction: 'openDrawer' },
		});

		return launchPoints;
	}
}
