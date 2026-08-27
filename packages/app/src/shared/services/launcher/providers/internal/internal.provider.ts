import plus from 'assets/plus.png';

import type { LaunchPointInput } from '../../api/launch-point.interface';
import { genericInputIcon, svgIcon } from '../../model/icon-fallback';
import type { LaunchPointsProvider, ProviderState } from '../launch-points.provider';

const circleIcon = (color: string): string => svgIcon(
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="34" fill="${color}"/></svg>`,
);

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

const colorButton = (
	name: string,
	title: string,
	color: string,
	keycode: 398 | 399 | 400 | 401,
): LaunchPointInput => ({
	id: process.env.APP_ID,
	launchPointId: `@button:${name}`,
	title,
	builtin: true,
	iconColor: '#242424',
	icon: circleIcon(color),
	params: { internalAction: 'micomKey', keycode },
});

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
		colorButton('red', 'Red', '#ef4444', 398),
		colorButton('green', 'Green', '#4ade80', 399),
		colorButton('yellow', 'Yellow', '#facc15', 400),
		colorButton('blue', 'Blue', '#60a5fa', 401),
		{
			id: process.env.APP_ID,
			launchPointId: '@intent:add_apps',
			title: 'Add apps',
			builtin: true,
			iconColor: '#242424',
			icon: plus,
			params: { internalAction: 'openDrawer' },
		},
	];
}
