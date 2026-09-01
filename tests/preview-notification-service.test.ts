import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildPreviewToastRequest,
	getPreviewNotificationKey,
	PreviewNotificationState,
	type NotificationToastRequest,
	type PreviewNotificationRequest,
} from '../packages/service/src/notification.ts';
import { PreviewNotificationService } from '../packages/service/src/preview-notification-service.ts';

const TEST_SERVICE_ID = 'com.homebrew.homeback.service';

const testRequest = (overrides: Partial<PreviewNotificationRequest> = {}): PreviewNotificationRequest => ({
	cameraId: 'camera.front_door',
	title: 'Front Door',
	message: 'Person detected',
	preview: {
		imageUrl: 'http://ha.local/camera?token=current',
		durationMs: 8_000,
	},
	...overrides,
});

test('suppressed preview notification returns early without sending a native toast', async () => {
	const state = new PreviewNotificationState();
	const sent: NotificationToastRequest[] = [];
	const request = testRequest();
	state.prepare(request);
	const service = new PreviewNotificationService(
		state,
		TEST_SERVICE_ID,
		async toast => {
			sent.push(toast);
		},
		buildPreviewToastRequest,
	);

	const result = await service.createPreviewNotification(request);

	assert.deepEqual(result, {
		done: true,
		suppressed: true,
		cameraRegistered: true,
	});
	assert.equal(sent.length, 0);
});

test('unsuppressed preview notification sends exactly the built native toast', async () => {
	const state = new PreviewNotificationState();
	const sent: NotificationToastRequest[] = [];
	const request = testRequest();
	const service = new PreviewNotificationService(
		state,
		TEST_SERVICE_ID,
		async toast => {
			sent.push(toast);
		},
		buildPreviewToastRequest,
	);

	const result = await service.createPreviewNotification(request);

	assert.deepEqual(sent, [buildPreviewToastRequest(request, TEST_SERVICE_ID)]);
	assert.deepEqual(result, {
		done: true,
		suppressed: false,
		cameraRegistered: true,
	});
});

test('failed native toast releases its reservation and propagates the sender error', async () => {
	const state = new PreviewNotificationState();
	const request = testRequest({ cameraId: 'camera.driveway' });
	const expectedError = new Error('native toast failed');
	let attempts = 0;
	const service = new PreviewNotificationService(
		state,
		TEST_SERVICE_ID,
		async () => {
			attempts += 1;
			if (attempts === 1) throw expectedError;
		},
		buildPreviewToastRequest,
	);

	await assert.rejects(
		service.createPreviewNotification(request),
		error => error === expectedError,
	);

	const retry = await service.createPreviewNotification(request);
	assert.equal(attempts, 2);
	assert.deepEqual(retry, {
		done: true,
		suppressed: false,
		cameraRegistered: true,
	});
});

test('requests without cameraId share the default key and still register newest camera media', async () => {
	const state = new PreviewNotificationState();
	const sent: NotificationToastRequest[] = [];
	const firstRequest = testRequest({ cameraId: undefined, message: 'Detection 1' });
	const secondRequest = testRequest({
		cameraId: undefined,
		message: 'Detection 2',
		preview: {
			imageUrl: 'http://ha.local/camera?token=newest',
			durationMs: 8_000,
		},
	});
	const service = new PreviewNotificationService(
		state,
		TEST_SERVICE_ID,
		async toast => {
			sent.push(toast);
		},
		buildPreviewToastRequest,
	);

	const first = await service.createPreviewNotification(firstRequest);
	const second = await service.createPreviewNotification(secondRequest);
	const [camera] = state.listRecentCameras();

	assert.equal(first.cameraRegistered, true);
	assert.equal(first.suppressed, false);
	assert.equal(second.cameraRegistered, true);
	assert.equal(second.suppressed, true);
	assert.equal(sent.length, 1);
	assert.equal(camera.cameraId, getPreviewNotificationKey(firstRequest));
	assert.equal(camera.message, 'Detection 2');
	assert.equal(camera.imageUrl, 'http://ha.local/camera?token=newest');
});

test('five concurrent same-camera requests reserve one toast and retain the newest camera event', async () => {
	const state = new PreviewNotificationState();
	let releaseFirstToast: (() => void) | null = null;
	const firstToastPending = new Promise<void>(resolve => {
		releaseFirstToast = resolve;
	});
	let senderCalls = 0;
	const service = new PreviewNotificationService(
		state,
		TEST_SERVICE_ID,
		async () => {
			senderCalls += 1;
			await firstToastPending;
		},
		buildPreviewToastRequest,
	);
	const requests = Array.from({ length: 5 }, (_, index) =>
		testRequest({
			message: `Detection ${index + 1}`,
			preview: {
				imageUrl: `http://ha.local/camera?token=${index + 1}`,
				durationMs: 8_000,
			},
		}),
	);

	const pending = requests.map(request => service.createPreviewNotification(request));
	await Promise.resolve();

	assert.equal(senderCalls, 1);
	assert.ok(releaseFirstToast);
	releaseFirstToast();
	const results = await Promise.all(pending);
	const [camera] = state.listRecentCameras();

	assert.equal(results.filter(result => !result.suppressed).length, 1);
	assert.equal(results.filter(result => result.suppressed).length, 4);
	assert.equal(camera.cameraId, 'camera.front_door');
	assert.equal(camera.message, 'Detection 5');
	assert.equal(camera.imageUrl, 'http://ha.local/camera?token=5');
});
