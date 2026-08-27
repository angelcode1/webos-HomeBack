import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';

import { observer } from 'mobx-react-lite';

import { useRibbonService } from 'features/ribbon/services';
import { AppIcon } from '../../app-icon';
import type { RibbonAppDrawerItemProps } from './ribbon-app-drawer-item.interface';

import s from './ribbon-app-drawer-item.module.scss';

export const RibbonAppDrawerItem = observer(
	({ launchPoint }: RibbonAppDrawerItemProps): JSX.Element => {
		const service = useRibbonService();
		const elementRef = useRef<HTMLButtonElement>(null);
		const isSelected = service.appDrawerService.isSelected(launchPoint);
		const style = useMemo(
			() => ({ '--icon-color': launchPoint.iconColor } as CSSProperties),
			[launchPoint.iconColor],
		);

		useEffect(() => {
			if (isSelected) elementRef.current?.scrollIntoView({ block: 'nearest' });
		}, [isSelected]);

		return (
			<button
				ref={elementRef}
				className={isSelected ? `${s.button} ${s.focused}` : s.button}
				style={style}
				onMouseEnter={() => service.appDrawerService.focusToLaunchPoint(launchPoint)}
				onFocus={() => service.appDrawerService.focusToLaunchPoint(launchPoint)}
				onClick={() => service.appDrawerService.activate(launchPoint)}
			>
				<AppIcon
					src={launchPoint.icon}
					fallbackIcon={launchPoint.fallbackIcon}
					className={s.icon}
					alt=''
				/>
				{launchPoint.title}
			</button>
		);
	},
);
