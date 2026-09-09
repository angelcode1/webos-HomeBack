import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';

import {
	CameraService,
	NotificationCameraProvider,
} from '../shared/services/camera';
import { luna } from '../shared/services/luna';

const PROBE_LIFETIME_MS = 18_000;
const CAMERA_REFRESH_MS = 3_000;
const CLOSE_URI = 'luna://com.webos.service.applicationManager/closeByAppId';

// Deliberately instantiate only the camera provider/service. Do not import the
// production services singleton: that would also construct SurfaceService,
// ActivationService, Ribbon, Preview, and keyboard ownership machinery.
const cameraService = new CameraService([new NotificationCameraProvider()]);

export const App = observer((): JSX.Element => {
	const camera = cameraService.cameras[0];
	const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

	useEffect(() => {
		void cameraService.refresh();
		const refreshTimer = setInterval(() => {
			void cameraService.refresh();
		}, CAMERA_REFRESH_MS);

		const onFocus = (): void => console.info('[HomeBackPiPProbe] focus');
		const onBlur = (): void => console.info('[HomeBackPiPProbe] blur');
		const onKeyDown = (event: KeyboardEvent): void => {
			// Measurement only. Never preventDefault/stopPropagation and never map
			// remote input in this disposable CARD probe.
			console.info(`[HomeBackPiPProbe] keydown code=${event.keyCode} key=${event.key}`);
		};
		window.addEventListener('focus', onFocus);
		window.addEventListener('blur', onBlur);
		document.addEventListener('keydown', onKeyDown, true);

		const closeTimer = setTimeout(() => {
			void luna(CLOSE_URI, { id: process.env.APP_ID }).catch(error => {
				console.warn('[HomeBackPiPProbe] self-close failed', error);
			});
		}, PROBE_LIFETIME_MS);

		return () => {
			clearInterval(refreshTimer);
			clearTimeout(closeTimer);
			window.removeEventListener('focus', onFocus);
			window.removeEventListener('blur', onBlur);
			document.removeEventListener('keydown', onKeyDown, true);
		};
	}, []);

	useEffect(() => {
		setFailedImageUrl(null);
	}, [camera?.imageUrl]);

	const imageAvailable = Boolean(camera?.imageUrl && failedImageUrl !== camera.imageUrl);

	return (
		<main
			aria-label='HomeBack PiP CARD probe'
			style={{
				position: 'fixed',
				inset: 0,
				overflow: 'hidden',
				background: '#050505',
				color: '#fff',
				fontFamily: 'sans-serif',
			}}
		>
			{camera && imageAvailable ? (
				<img
					src={camera.imageUrl}
					alt=''
					onError={() => setFailedImageUrl(camera.imageUrl)}
					style={{
						position: 'absolute',
						inset: 0,
						width: '100%',
						height: '100%',
						objectFit: 'cover',
					}}
				/>
			) : (
				<div
					style={{
						position: 'absolute',
						inset: 0,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						padding: '8%',
						boxSizing: 'border-box',
						textAlign: 'center',
						fontSize: '5vw',
					}}
				>
					{camera ? 'Camera image unavailable' : 'HomeBack PiP CARD probe'}
				</div>
			)}

			<div
				style={{
					position: 'absolute',
					left: '5%',
					right: '5%',
					bottom: '6%',
					padding: '3%',
					boxSizing: 'border-box',
					background: 'rgba(0, 0, 0, 0.72)',
					borderRadius: '12px',
				}}
			>
				<div style={{ fontSize: '4vw', fontWeight: 700 }}>
					{camera?.title ?? 'PiP surface eligibility test'}
				</div>
				<div style={{ marginTop: '1.5%', fontSize: '2.6vw', opacity: 0.86 }}>
					{camera?.message ?? 'No Ribbon, Preview, activate(), or keyboard ownership.'}
				</div>
			</div>
		</main>
	);
});
