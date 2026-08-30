import { useState } from 'react';
import { observer } from 'mobx-react-lite';

import { usePreviewService } from './preview.module';
import { previewImageHost, type PreviewPayload } from './preview.lib';

import s from './preview.module.scss';

export const Preview = observer((): JSX.Element | null => {
	const service = usePreviewService();
	const [failedPayload, setFailedPayload] = useState<PreviewPayload | null>(null);
	const payload = service.payload;
	if (!service.visible || !payload) return null;

	const imageUrl = payload.imageUrl;
	const imageUnavailable = Boolean(imageUrl && failedPayload === payload);

	return (
		<div className={s.preview} role='status' aria-label={payload.title}>
			{imageUrl && (
				imageUnavailable ? (
					<div className={s.imageUnavailable}>Camera unavailable</div>
				) : (
					<img
						className={s.image}
						src={imageUrl}
						alt=''
						onError={() => {
							console.warn(
								`[HomeBackPreview] image error host=${previewImageHost(imageUrl)}`,
							);
							setFailedPayload(payload);
						}}
					/>
				)
			)}
			<div className={s.copy}>
				<strong className={s.title}>{payload.title}</strong>
				{payload.message && <span className={s.message}>{payload.message}</span>}
				<span className={s.hint}>Back to dismiss</span>
			</div>
		</div>
	);
});
