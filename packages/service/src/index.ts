import { readLaunchPointIcon, type IconRequest } from './app-catalog';
import { HomeBackBootstrap } from './bootstrap';
import { Service } from './bus';
import { APPLICATION_MANAGER_URI, APP_ID, APP_VERSION, SERVICE_ID } from './environment';
import { HttpPreviewServer } from './http-server';
import {
	buildPreviewToastRequest,
	PreviewNotificationState,
	type PreviewNotificationRequest,
} from './notification';
import { PreviewNotificationService } from './preview-notification-service';
import { getUid } from './utils';
import { WeatherService } from './weather';

const NOTIFICATION_URI = 'luna://com.webos.notification';
const service = new Service();
const weatherService = new WeatherService((uri, params, timeoutMs) =>
	service.oneshot(uri, params, timeoutMs),
);
const previewNotificationState = new PreviewNotificationState();
const previewNotificationService = new PreviewNotificationService(
	previewNotificationState,
	SERVICE_ID,
	toast => service.oneshot(`${NOTIFICATION_URI}/createToast`, toast),
	buildPreviewToastRequest,
);
const httpPreviewServer = new HttpPreviewServer({
	version: APP_VERSION ?? 'unknown',
	createPreviewNotification: request =>
		previewNotificationService.createPreviewNotification(request),
});

const bootstrap = new HomeBackBootstrap(service);
let shuttingDown = false;

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
	void Promise.all([stopRemoteInput, stopHttp]).finally(() => process.exit(exitCode));
};

// `exit` is synchronous-only. Keep this as a last fail-open fallback if normal
// async shutdown is skipped by an exception or direct process.exit call.
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
	return {
		done: true,
		...result,
	};
});

service.registerSimple('/remote/start', async () => {
	await bootstrap.startRemoteInput();
	return { done: true, status: serviceStatus() };
});

service.registerSimple('/remote/status', () => ({
	done: true,
	status: serviceStatus(),
}));

service.registerSimple('/weather/current', async () => ({
	done: true,
	weather: await weatherService.current(),
}));

service.registerSimple<PreviewNotificationRequest>('/notification/createPreviewToast', request =>
	previewNotificationService.createPreviewNotification(request ?? {}),
);

service.registerSimple('/cameras/list', () => ({
	done: true,
	cameras: previewNotificationState.listRecentCameras(),
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
