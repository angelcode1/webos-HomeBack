import { observer } from 'mobx-react-lite';

import { useRibbonService } from '../../services';
import { NumericKeyboardProxy } from '../numeric-keyboard-proxy';
import { RibbonAppDrawer } from '../ribbon-app-drawer';
import { RibbonCard } from '../ribbon-card';
import { RibbonStatusTile } from '../ribbon-status-tile';

import s from './ribbon.module.scss';

export const Ribbon = observer((): JSX.Element => {
	const service = useRibbonService();

	return (
		<>
			{service.visible && service.warningText && (
				<div className={s.warning} role='status'>
					{service.warningText}
				</div>
			)}
			<div
				ref={service.ribbonRef}
				className={`${s.group} ${service.visible ? s.visible : ''}`}
			>
				{service.launcherService.visible.map((launchPoint, index) => (
					<RibbonCard
						key={launchPoint.launchPointId}
						position={index}
						launchPoint={launchPoint}
					/>
				))}
			</div>
			<RibbonStatusTile visible={service.visible} />
			<NumericKeyboardProxy />
			<RibbonAppDrawer />
		</>
	);
});
