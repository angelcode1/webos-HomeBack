import { useEffect, useMemo, useState } from 'react';

type CameraEntry = {
	cameraId: string;
	title: string;
	message: string | null;
	imageUrl: string;
	durationMs: number;
	receivedAt: number;
	expiresAt: number;
};

type CameraListResponse = {
	returnValue: boolean;
	cameras?: CameraEntry[];
};

type ServiceFailure = {
	returnValue?: false;
	errorText?: string;
	errorCode?: number;
};

const REFRESH_MS = 1_000;

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
				reject(
					new Error(
						response.errorText ??
							`LS2 request failed (${response.errorCode ?? 'unknown'})`,
					),
				);
				return;
			}
			resolve(response);
		};
		bridge.call(uri, JSON.stringify(params));
	});

const newestRecentCamera = (cameras: CameraEntry[]): CameraEntry | null => {
	const now = Date.now();
	return (
		cameras
			.filter(camera => camera.expiresAt > now && camera.imageUrl.length > 0)
			.sort((left, right) => right.receivedAt - left.receivedAt)[0] ?? null
	);
};

export const App = (): JSX.Element => {
	const [camera, setCamera] = useState<CameraEntry | null>(null);
	const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
	const [serviceError, setServiceError] = useState<string | null>(null);

	useEffect(() => {
		let disposed = false;

		const refresh = async (): Promise<void> => {
			try {
				const response = await luna<CameraListResponse>(
					`luna://${process.env.SERVICE_ID}/cameras/list`,
				);
				if (disposed) return;
				setCamera(newestRecentCamera(response.cameras ?? []));
				setServiceError(null);
			} catch (error) {
				if (disposed) return;
				setServiceError(error instanceof Error ? error.message : String(error));
			}
		};

		const scheduleRefresh = (): void => {
			refresh().catch(error => {
				if (!disposed) setServiceError(error instanceof Error ? error.message : String(error));
			});
		};

		scheduleRefresh();
		const timer = window.setInterval(scheduleRefresh, REFRESH_MS);
		return () => {
			disposed = true;
			window.clearInterval(timer);
		};
	}, []);

	useEffect(() => {
		setFailedImageUrl(null);
	}, [camera?.imageUrl]);

	const imageAvailable = Boolean(camera?.imageUrl && failedImageUrl !== camera.imageUrl);
	const statusMessage = useMemo(() => {
		if (camera?.message) return camera.message;
		if (camera) return 'HomeBack camera notification';
		if (serviceError) return `Camera service unavailable: ${serviceError}`;
		return 'Waiting for a recent camera event';
	}, [camera, serviceError]);

	return (
		<main
			aria-label='HomeBack camera PiP'
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
			) : null}

			<div
				style={{
					position: 'absolute',
					left: '4%',
					right: '4%',
					bottom: '5%',
					padding: '3%',
					boxSizing: 'border-box',
					background: 'rgba(0, 0, 0, 0.72)',
					borderRadius: '12px',
				}}
			>
				<div style={{ fontSize: '4vw', fontWeight: 700 }}>
					{camera?.title ?? 'HomeBack Camera PiP'}
				</div>
				<div style={{ marginTop: '1.5%', fontSize: '2.5vw', opacity: 0.88 }}>
					{statusMessage}
				</div>
			</div>
		</main>
	);
};
