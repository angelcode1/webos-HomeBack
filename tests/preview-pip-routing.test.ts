import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildPreviewToastRequest,
	PreviewNotificationState,
	type NotificationToastRequest,
	type PreviewNotificationRequest,
} from '../packages/service/src/notification.ts';
import { PreviewNotificationService } from '../packages/service/src/preview-notification-service.ts';

const SERVICE_ID = 'com.homebrew.homeback.service';

const request = (): PreviewNotificationRequest => ({
	cameraId: 'camera.front_door',
	title: 'Front Door',
	message: 'Person detected',
	preview: {
		imageUrl: 'http://ha.local/camera.jpg',
		durationMs: 8_000,
	},
});

test('verified PiP presentation suppresses duplicate native toast for the same event', async () => {
	const state = new PreviewNotificationState();
	const toasts: NotificationToastRequest[] = [];
	let pipCalls = 0;
	const service = new PreviewNotificationService(
		state,
		SERVICE_ID,
		async toast => {
			toasts.push(toast);
		},
		buildPreviewToastRequest,
		async camera => {
			pipCalls += 1;
			assert.equal(camera.cameraId, 'camera.front_door');
			return true;
		},
	);

	const result = await service.createPreviewNotification(request());

	assert.equal(pipCalls, 1);
	assert.equal(toasts.length, 0);
	assert.deepEqual(result, {
		done: true,
		suppressed: false,
		cameraRegistered: true,
	});
});

test('PiP rejection immediately falls back to existing native toast', async () => {
	const state = new PreviewNotificationState();
	const toasts: NotificationToastRequest[] = [];
	const previewRequest = request();
	const service = new PreviewNotificationService(
		state,
		SERVICE_ID,
		async toast => {
			toasts.push(toast);
		},
		buildPreviewToastRequest,
		async () => false,
	);

	await service.createPreviewNotification(previewRequest);

	assert.deepEqual(toasts, [buildPreviewToastRequest(previewRequest, SERVICE_ID)]);
});

test('unexpected PiP presenter exception is fail-open and still sends native toast', async () => {
	const state = new PreviewNotificationState();
	let toastCalls = 0;
	const service = new PreviewNotificationService(
		state,
		SERVICE_ID,
		async () => {
			toastCalls += 1;
		},
		buildPreviewToastRequest,
		async () => {
			throw new Error('controller unavailable');
		},
	);

	await service.createPreviewNotification(request());
	assert.equal(toastCalls, 1);
});
