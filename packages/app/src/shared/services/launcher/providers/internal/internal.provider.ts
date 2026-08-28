import type { LaunchPointInput } from '../../api/launch-point.interface';
import { genericInputIcon, svgIcon } from '../../model/icon-fallback';
import type { LaunchPointsProvider, ProviderState } from '../launch-points.provider';

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

const plusIcon = svgIcon([
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
	'<path d="M50 22v56M22 50h56" fill="none" stroke="white" stroke-width="8" stroke-linecap="round"/>',
	'</svg>',
].join(''));

export class InternalProvider implements LaunchPointsProvider {
	public readonly state: ProviderState = 'ready';

	public readonly launchPoints: LaunchPointInput[] = [
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
		{
			id: process.env.APP_ID,
			launchPointId: '@intent:add_apps',
			title: 'Add apps',
			builtin: true,
			iconColor: '#242424',
			icon: plusIcon,
			params: { internalAction: 'openDrawer' },
		},
	];
}
