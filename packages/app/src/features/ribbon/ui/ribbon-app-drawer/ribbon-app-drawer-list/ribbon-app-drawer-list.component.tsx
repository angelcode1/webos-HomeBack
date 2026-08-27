import type { WheelEvent } from 'react';

import { observer } from 'mobx-react-lite';

import { useRibbonService } from 'features/ribbon/services';
import { RibbonAppDrawerItem } from '../ribbon-app-drawer-item';

import s from './ribbon-app-drawer-list.module.scss';

export const RibbonAppDrawerList = observer((): JSX.Element => {
	const svc = useRibbonService();
	const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
		if (!svc.appDrawerService.visible) return;
		event.preventDefault();
		event.stopPropagation();
		svc.appDrawerService.handleWheel(event.deltaY);
	};

	return (
		<div
			ref={svc.appDrawerService.containerRef}
			tabIndex={0}
			className={s.list}
			data-homeback-wheel-owner='drawer'
			onWheel={handleWheel}
		>
			{svc.appDrawerService.items.map(lp => (
				<RibbonAppDrawerItem key={lp.launchPointId} launchPoint={lp} />
			))}
		</div>
	);
});
