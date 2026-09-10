import { useEffect, useMemo, useState } from 'react';

type CameraEntry = {
	cameraId: string;
	title: string;
	message: string | null;
	imageUrl: string;
	streamUrl?: string | null;
	receivedAt: number;
	expiresAt: number;
};

type CurrentCameraResponse = {
	returnValue: boolean;
	camera?: CameraEntry | null;
};

type ServiceFailure = {
	returnValue?: false;
	errorText?: string;
	errorCode?: number;
};

const REFRESH_MS = 1_000;
const VIDEO_URL_PATTERN = /\.(?:m3u8|mp4|m4v|webm)(?:$|[?#])/i;

const luna = <T extends object>(uri: string, params: Record<string, unknown> = {}): Promise<T> =>
	new Promise((resolve, reject) => {
		const bridge = new PalmServiceBridge();
		bridge.onservicecallback = serializedMessage => {
			let response: T & ServiceFailure;
			try {
				response = JSON.parse(serializedMessage) as T & ServiceFailure;
			} catch (error) {
				reject(error);
				return;
			}
			if (response.returnValue === false) {
				reject(new Error(response.errorText ?? `LS2 request failed (${response.errorCode ?? 'unknown'})`));
				return;
			}
			resolve(response);
		};
		bridge.call(uri, JSON.stringify(params));
	});

const isFresh = (camera: CameraEntry | null): camera is CameraEntry =>
	Boolean(camera && camera.expiresAt > Date.now() && camera.imageUrl.length > 0);

export const App = (): JSX.Element => {
	const [camera, setCamera] = useState<CameraEntry | null>(null);
	const [failedMediaUrl, setFailedMediaUrl] = useState<string | null>(null);
	const [serviceError, setServiceError] = useState<string | null>(null);

	useEffect(() => {
		let disposed = false;
		const refresh = async (): Promise<void> => {
			try {
				const response = await luna<CurrentCameraResponse>(
					`luna://${process.env.SERVICE_ID}/cameras/current`,
				);
				if (disposed) return;
				const next = response.camera ?? null;
				setCamera(isFresh(next) ? next : null);
				setServiceError(null);
			} catch (error) {
				if (!disposed) setServiceError(error instanceof Error ? error.message : String(error));
			}
		};
		void refresh();
		const timer = window.setInterval(() => void refresh(), REFRESH_MS);
		return () => {
			disposed = true;
			window.clearInterval(timer);
		};
	}, []);

	const streamUrl = camera?.streamUrl ?? null;
	const preferredMediaUrl = streamUrl ?? camera?.imageUrl ?? null;
	useEffect(() => {
		setFailedMediaUrl(null);
	}, [preferredMediaUrl]);

	const showPreferred = Boolean(preferredMediaUrl && failedMediaUrl !== preferredMediaUrl);
	const useVideo = Boolean(streamUrl && VIDEO_URL_PATTERN.test(streamUrl));
	const fallbackImageUrl = camera?.imageUrl ?? null;
	const statusMessage = useMemo(() => {
		if (camera?.message) return camera.message;
		if (camera) return 'HomeBack camera';
		if (serviceError) return `Camera service unavailable: ${serviceError}`;
		return 'Waiting for a recent camera event';
	}, [camera, serviceError]);

	return (
		<main
			aria-label='HomeBack camera PiP'
			style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#050505', color: '#fff', fontFamily: 'sans-serif' }}
		>
			{camera && showPreferred && useVideo ? (
				<video
					src={streamUrl ?? undefined}
					autoPlay
					muted
					playsInline
					onError={() => setFailedMediaUrl(streamUrl)}
					style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
				/>
			) : null}

			{camera && showPreferred && !useVideo ? (
				<img
					src={preferredMediaUrl ?? undefined}
					alt=''
					onError={() => setFailedMediaUrl(preferredMediaUrl)}
					style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
				/>
			) : null}

			{camera && !showPreferred && fallbackImageUrl && fallbackImageUrl !== preferredMediaUrl ? (
				<img
					src={fallbackImageUrl}
					alt=''
					style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
				/>
			) : null}

			<div
				style={{
					position: 'absolute',
					left: '4%',
					right: '4%',
					bottom: '5%',
					padding: '3%',
					boxSizing: 'border-box',
					background: 'rgba(0, 0, 0, 0.68)',
					borderRadius: '12px',
				}}
			>
				<div style={{ fontSize: '4vw', fontWeight: 700 }}>
					{camera?.title ?? 'HomeBack Camera'}
				</div>
				<div style={{ marginTop: '1.5%', fontSize: '2.5vw', opacity: 0.88 }}>
					{statusMessage}
				</div>
			</div>
		</main>
	);
};
