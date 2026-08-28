import { createPortal } from 'react-dom';

import { observer } from 'mobx-react-lite';

import { useRibbonService } from '../../services';
import { RibbonAppDrawerList } from './ribbon-app-drawer-list';

import s from './ribbon-app-drawer.module.scss';

export const RibbonAppDrawer = observer((): JSX.Element => {
	const service = useRibbonService();
	const active = service.appDrawerService.visible;

	return createPortal(
		<div className={`${s.root} ${active ? s.active : ''}`} aria-hidden={!active}>
			<div className={s.backdrop} onClick={() => { service.appDrawerService.visible = false; }} />
			<div className={s.drawer}>
				<h1 className={s.header}>Apps</h1>
				{active && <RibbonAppDrawerList />}
			</div>
		</div>,
		document.body,
	);
});
