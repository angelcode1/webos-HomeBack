import { readLaunchPointIcon, type IconRequest } from './app-catalog';
import { HomeBackBootstrap } from './bootstrap';
import { Service } from './bus';
import { APPLICATION_MANAGER_URI, APP_ID, SERVICE_ID } from './environment';
import {
	buildPreviewToastRequest,
	PreviewNotificationState,
	type PreviewNotificationRequest,
} from './notification';
import { getUid } from './utils';

const NOTIFICATION_URI = 'luna://com.webos.notification';
const TOAST_BRANDING = {
	sourceId: SERVICE_ID,
	iconUrl: `file:///media/developer/apps/usr/palm/applications/${APP_ID}/icon80.png`,
} as const;
const previewNotificationState = new PreviewNotificationState();

const service = new Service();
const bootstrap = new HomeBackBootstrap(service);
let shuttingDown = false;

const shutdownService = (exitCode = 0): void => {
	if (shuttingDown) return;
	shuttingDown = true;
	void bootstrap.remoteInput.stop()
		.catch(error => {
			console.error('Unable to cleanly stop HomeBack remote input:', error);
		})
		.finally(() => process.exit(exitCode));
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

service.registerSimple<IconRequest>('/readIcon', async request => ({
	done: true,
	dataUrl: await readLaunchPointIcon(request ?? {}),
}));

service.registerSimple('/bootstrap', async () => ({
	done: true,
	...(await bootstrap.apply()),
}));

service.registerSimple('/remote/start', async () => {
	await bootstrap.startRemoteInput();
	return { done: true, status: bootstrap.remoteInput.status() };
});

service.registerSimple('/remote/status', () => ({
	done: true,
	status: bootstrap.remoteInput.status(),
}));

service.registerSimple<PreviewNotificationRequest>('/notification/createPreviewToast', async request => {
	const normalizedRequest = request ?? {};
	const prepared = previewNotificationState.prepare(normalizedRequest);

	if (prepared.suppressed) {
		return {
			done: true,
			suppressed: true,
			cameraRegistered: Boolean(prepared.camera),
		};
	}

	try {
		await service.oneshot(
			`${NOTIFICATION_URI}/createToast`,
			buildPreviewToastRequest(normalizedRequest, TOAST_BRANDING),
		);
	} catch (error) {
		if (prepared.reservedAt !== null) {
			previewNotificationState.releaseToastReservation(
				prepared.key,
				prepared.reservedAt,
			);
		}
		throw error;
	}

	return {
		done: true,
		suppressed: false,
		cameraRegistered: Boolean(prepared.camera),
	};
});

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
}, 0);
