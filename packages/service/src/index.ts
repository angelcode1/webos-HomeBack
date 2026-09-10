import { readLaunchPointIcon, type IconRequest } from './app-catalog';
import { HomeBackBootstrap } from './bootstrap';
import { Service, ServiceError } from './bus';
import { APPLICATION_MANAGER_URI, APP_ID, APP_VERSION, PIP_APP_ID, SERVICE_ID } from './environment';
import { HttpPreviewServer } from './http-server';
import { ManualCameraPip } from './manual-camera-pip';
import {
	buildPreviewToastRequest,
	PreviewNotificationState,
	type PreviewNotificationRequest,
	type RecentCameraEntry,
} from './notification';
import { PreviewNotificationService } from './preview-notification-service';
import { micomKeycodeForRemoteButton, sendMicomKeycode } from './remote-key-sender';
import { getUid } from './utils';

const NOTIFICATION_URI = 'luna://com.webos.notification';
const service = new Service();
const previewNotificationState = new PreviewNotificationState();
const previewNotificationService = new PreviewNotificationService(
	previewNotificationState,
	SERVICE_ID,
	toast => service.oneshot(`${NOTIFICATION_URI}/createToast`, toast),
	buildPreviewToastRequest,
);
const cameraPip = new ManualCameraPip(
	(uri, params, timeoutMs) => service.oneshot(uri, params, timeoutMs),
	PIP_APP_ID ?? 'com.homebrew.homeback.camera',
);
const httpPreviewServer = new HttpPreviewServer({
	version: APP_VERSION ?? 'unknown',
	createPreviewNotification: request =>
		previewNotificationService.createPreviewNotification(request),
});

const bootstrap = new HomeBackBootstrap(service);
let shuttingDown = false;
let selectedCameraId: string | null = null;

type RemoteButtonRequest = {
	button?: unknown;
};

type CameraOpenRequest = {
	cameraId?: unknown;
};

const currentCamera = (): RecentCameraEntry | null => {
	const cameras = previewNotificationState.listRecentCameras();
	if (selectedCameraId) {
		const selected = cameras.find(camera => camera.cameraId === selectedCameraId);
		if (selected) return selected;
	}
	return cameras[0] ?? null;
};

const serviceStatus = (): Record<string, unknown> => ({
	...bootstrap.remoteInput.status(),
	...httpPreviewServer.status(),
});

const shutdownService = (exitCode = 0): void => {
	if (shuttingDown) return;
	shuttingDown = true;
	const stopRemoteInput = bootstrap.remoteInput.stop().catch(error => {
		console.error('Unable to cleanly stop HomeBack remote input:', error);
	});
	const stopHttp = httpPreviewServer.stop().catch(error => {
		console.error(
			'Unable to cleanly stop HomeBack HTTP Preview listener:',
			error instanceof Error ? error.name : 'UnknownError',
		);
	});
	const stopCamera = cameraPip.close().catch(error => {
		console.error('Unable to cleanly close HomeBack camera PiP:', error);
	});
	void Promise.all([stopRemoteInput, stopHttp, stopCamera]).finally(() => process.exit(exitCode));
};

process.once('exit', () => bootstrap.remoteInput.disarmTimedMappingsSync());
process.once('SIGTERM', () => shutdownService(0));
process.once('SIGINT', () => shutdownService(0));

const selfStartRemoteInput = async (): Promise<void> => {
	if (getUid() !== 0) return;
	try {
		await bootstrap.startRemoteInput();
		console.log('HomeBack root helper self-started remote input.');
	} catch (error) {
		console.error('HomeBack root helper could not self-start remote input:', error);
	}
};

const selfStartHttpPreview = async (): Promise<void> => {
	if (getUid() !== 0) return;
	await httpPreviewServer.start();
};

service.registerSimple<IconRequest>('/readIcon', async request => ({
	done: true,
	dataUrl: await readLaunchPointIcon(request ?? {}),
}));

service.registerSimple('/bootstrap', async () => {
	const result = await bootstrap.apply();
	return { done: true, ...result };
});

service.registerSimple('/remote/start', async () => {
	await bootstrap.startRemoteInput();
	return { done: true, status: serviceStatus() };
});

service.registerSimple('/remote/status', () => ({
	done: true,
	status: serviceStatus(),
}));

service.registerSimple<RemoteButtonRequest>('/remote/sendButton', async request => {
	const micomKeycode = micomKeycodeForRemoteButton(request?.button);
	if (micomKeycode === null) {
		throw new ServiceError('Unsupported remote button. Expected digit 0-9 or red/green/yellow/blue.', -400);
	}
	if (getUid() !== 0) {
		throw new ServiceError('HomeBack helper service is not running as root.', -401);
	}
	await sendMicomKeycode(micomKeycode);
	return { done: true };
});

service.registerSimple<PreviewNotificationRequest>('/notification/createPreviewToast', request =>
	previewNotificationService.createPreviewNotification(request ?? {}),
);

service.registerSimple('/cameras/list', () => ({
	done: true,
	cameras: previewNotificationState.listRecentCameras(),
}));

service.registerSimple('/cameras/current', () => ({
	done: true,
	camera: currentCamera(),
}));

service.registerSimple<CameraOpenRequest>('/cameras/open', async request => {
	const cameras = previewNotificationState.listRecentCameras();
	if (cameras.length === 0) throw new ServiceError('No recent camera event is available.', -404);

	if (request?.cameraId !== undefined && typeof request.cameraId !== 'string') {
		throw new ServiceError('cameraId must be a string.', -400);
	}
	const requestedId = typeof request?.cameraId === 'string' ? request.cameraId : null;
	const camera = requestedId
		? cameras.find(candidate => candidate.cameraId === requestedId) ?? null
		: cameras[0] ?? null;
	if (!camera) throw new ServiceError('Requested camera event is no longer available.', -404);

	selectedCameraId = camera.cameraId;
	const status = await cameraPip.open();
	if (status.pipLastOutcome !== 'shown') {
		const detail = status.pipLastError ? `: ${status.pipLastError}` : '';
		throw new ServiceError(`Unable to open camera PiP (${status.pipLastReason ?? 'unknown'})${detail}`, -503);
	}
	return { done: true, cameraId: camera.cameraId, status };
});

service.registerSimple('/cameras/close', async () => ({
	done: true,
	status: await cameraPip.close(),
}));

service.registerSimple('/cameras/pipStatus', () => ({
	done: true,
	status: cameraPip.status(),
}));

service.registerSimple('/restartService', () => {
	setTimeout(() => shutdownService(0), 100);
	return { done: true };
});

service.registerSimple('/restartApp', () => {
	setTimeout(() => {
		void (async () => {
			try {
				await service.oneshot(`${APPLICATION_MANAGER_URI}/closeByAppId`, { id: APP_ID });
			} catch {
				// App may already be gone.
			}
			await new Promise(resolve => setTimeout(resolve, 400));
			try {
				await service.oneshot(`${APPLICATION_MANAGER_URI}/launch`, { id: APP_ID });
			} catch (error) {
				console.error('Unable to relaunch HomeBack after ACG bootstrap:', error);
			}
		})();
	}, 100);
	return { done: true };
});

if (__DEV__) {
	service.registerSimple('/quit', () => {
		setTimeout(() => shutdownService(0), 100);
		return { returnValue: true, message: 'Bye bye!' };
	});
}

// @invariant: root-helper-self-start
setTimeout(() => {
	void selfStartRemoteInput();
	void selfStartHttpPreview();
}, 0);
