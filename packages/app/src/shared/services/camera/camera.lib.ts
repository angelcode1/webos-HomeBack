import type { PreviewLaunchPayload } from 'shared/api/common';

export type CameraEntry = {
	cameraId: string;
	title: string;
	message: string | null;
	imageUrl: string;
	durationMs: number;
	receivedAt: number;
	expiresAt: number;
};

export const cameraToPreviewPayload = (camera: CameraEntry): PreviewLaunchPayload => ({
	title: camera.title,
	...(camera.message ? { message: camera.message } : {}),
	imageUrl: camera.imageUrl,
	durationMs: camera.durationMs,
	interactive: true,
});
