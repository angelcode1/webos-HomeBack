import assert from 'node:assert/strict';
import test from 'node:test';

import { cameraToPreviewPayload } from '../packages/app/src/shared/services/camera/camera.lib.ts';
import {
	buildPreviewToastRequest,
	buildRecentCameraEntry,
	isRecentCameraFresh,
	PREVIEW_TOAST_SUPPRESSION_MS,
	PreviewNotificationState,
	RECENT_CAMERA_FRESHNESS_MS,
	shouldSuppressPreviewToast,
} from '../packages/service/src/notification.ts';

const TEST_SERVICE_ID = 'com.homebrew.homeback.service';

test('passive camera toast uses the compact webOS light type, camera icon, service identity and bounded message', () => {
	const toast = buildPreviewToastRequest({
		title: 'Front Door',
		message: 'Person detected '.repeat(10),
	}, TEST_SERVICE_ID);

	assert.equal(toast.type, 'light');
	assert.equal(Array.from(toast.message).length <= 60, true);
	assert.equal(toast.sourceId, TEST_SERVICE_ID);
	assert.equal(
		toast.iconUrl,
		'file:///media/developer/apps/usr/palm/applications/com.homebrew.homeback/camera-toast-icon.png',
	);
});

test('toast title budget preserves event text when the friendly name is very long', () => {
	const toast = buildPreviewToastRequest({
		title: 'Front Door Driveway Detection Zone With An Extremely Long Friendly Name',
		message: 'Person detected in driveway',
	}, TEST_SERVICE_ID);

	assert.equal(Array.from(toast.message).length <= 60, true);
	assert.match(toast.message, /Person detected in driveway/);
	assert.equal(toast.message.startsWith('Front Door Driveway Dete: '), true);
});

test('toast truncation preserves a non-BMP character at the 60-code-unit boundary', () => {
	const toast = buildPreviewToastRequest({
		message: `${'a'.repeat(58)}😀suffix`,
	}, TEST_SERVICE_ID);

	assert.equal(toast.message.length, 60);
	assert.equal(Array.from(toast.message).length, 59);
	assert.equal(toast.message.endsWith('😀'), true);
	assert.equal(toast.message.isWellFormed(), true);
});

test('toast truncation bounds emoji-heavy messages to 60 UTF-16 code units', () => {
	const toast = buildPreviewToastRequest({
		message: '😀'.repeat(80),
	}, TEST_SERVICE_ID);

	assert.equal(toast.message.length, 60);
	assert.equal(Array.from(toast.message).length, 30);
	assert.equal(toast.message.isWellFormed(), true);
});

test('camera registry stores receipt time and expires recent-event URLs conservatively', () => {
	const receivedAt = 1_000_000;
	const camera = buildRecentCameraEntry({
		cameraId: 'camera.front_door',
		preview: {
			title: 'Front Door',
			message: 'Person detected',
			imageUrl: 'http://ha.local:8123/api/camera_proxy_stream/camera.front_door?token=rotating',
			durationMs: 60_000,
		},
	}, receivedAt);

	assert.ok(camera);
	assert.equal(camera.receivedAt, receivedAt);
	assert.equal(camera.expiresAt, receivedAt + RECENT_CAMERA_FRESHNESS_MS);
	assert.equal(camera.durationMs, 10_000);
	assert.equal(isRecentCameraFresh(camera, camera.expiresAt - 1), true);
	assert.equal(isRecentCameraFresh(camera, camera.expiresAt), false);
	assert.equal(buildRecentCameraEntry({ cameraId: 'camera.no_media' }, receivedAt), null);
});

test('five-second suppression has an explicit boundary', () => {
	assert.equal(shouldSuppressPreviewToast(undefined, 10_000), false);
	assert.equal(shouldSuppressPreviewToast(10_000, 10_001), true);
	assert.equal(
		shouldSuppressPreviewToast(10_000, 10_000 + PREVIEW_TOAST_SUPPRESSION_MS - 1),
		true,
	);
	assert.equal(
		shouldSuppressPreviewToast(10_000, 10_000 + PREVIEW_TOAST_SUPPRESSION_MS),
		false,
	);
});

test('suppressed burst events still refresh the newest camera URL and timestamp', () => {
	const state = new PreviewNotificationState();
	const request = (sequence: number) => ({
		cameraId: 'camera.front_door',
		title: 'Front Door',
		message: `Detection ${sequence}`,
		preview: {
			imageUrl: `http://ha.local/camera?token=event-${sequence}`,
		},
	});

	const first = state.prepare(request(1), 10_000);
	assert.equal(first.suppressed, false);
	assert.equal(first.reservedAt, 10_000);

	for (let sequence = 2; sequence <= 5; sequence++) {
		const prepared = state.prepare(request(sequence), 10_000 + sequence * 500);
		assert.equal(prepared.suppressed, true);
		assert.equal(prepared.reservedAt, null);
	}

	const [camera] = state.listRecentCameras(12_500);
	assert.equal(camera.imageUrl, 'http://ha.local/camera?token=event-5');
	assert.equal(camera.message, 'Detection 5');
	assert.equal(camera.receivedAt, 12_500);
});

test('failed toast reservation can be released without muting the next event', () => {
	const state = new PreviewNotificationState();
	const request = {
		cameraId: 'camera.driveway',
		message: 'Vehicle detected',
	};

	const first = state.prepare(request, 20_000);
	assert.equal(first.suppressed, false);
	assert.equal(first.reservedAt, 20_000);
	state.releaseToastReservation(first.key, first.reservedAt ?? -1);

	const retry = state.prepare(request, 20_100);
	assert.equal(retry.suppressed, false);
	assert.equal(retry.reservedAt, 20_100);
});

test('camera coordinator converts registry entries to explicit interactive preview payloads', () => {
	assert.deepEqual(cameraToPreviewPayload({
		cameraId: 'camera.front_door',
		title: 'Front Door',
		message: 'Person detected',
		imageUrl: 'http://ha.local/camera?token=fresh',
		durationMs: 8_000,
		receivedAt: 1,
		expiresAt: 2,
	}), {
		title: 'Front Door',
		message: 'Person detected',
		imageUrl: 'http://ha.local/camera?token=fresh',
		durationMs: 8_000,
		interactive: true,
	});
});
