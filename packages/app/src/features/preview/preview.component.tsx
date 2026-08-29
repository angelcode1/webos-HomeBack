import { observer } from 'mobx-react-lite';

import { previewService } from './preview.module';

import s from './preview.module.scss';

export const Preview = observer((): JSX.Element | null => {
	const preview = previewService.active;
	if (!preview) return null;

	return (
		<section className={s.preview} aria-label='Camera preview'>
			{preview.title && <div className={s.title}>{preview.title}</div>}
			<img className={s.image} src={preview.url} alt={preview.title ?? 'Camera preview'} />
			<div className={s.hint}>Back to close</div>
		</section>
	);
});
