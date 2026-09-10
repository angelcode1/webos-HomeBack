import assert from 'node:assert/strict';
import test from 'node:test';

import type { RecentCameraEntry } from '../packages/service/src/notification.ts';
import {
	AUTOMATIC_PIP_MAIN_APP_IDS,
	PipCameraPresenter,
	type PipCameraLunaCall,
} from '../packages/service/src/pip-camera-presenter.ts';

const PIP_APP_ID = 'com.homebrew.homeback.camera';
const SURFACE_URI = 'luna://com.webos.surfacemanager/getForegroundAppInfo';
const LAUNCH_URI = 'luna://com.webos.service.multiviewcontroller/launchApps';
const CLOSE_URI = 'luna://com.webos.service.applicationManager/closeByAppId';

const camera = (durationMs = 8_000): RecentCameraEntry => ({
	cameraId: 'camera.front_door',
	title: 'Front Door',
	message: 'Person detected',
	imageUrl: 'http://ha.local/camera.jpg',
	durationMs,
	receivedAt: Date.now(),
	expiresAt: Date.now() + 120_000,
});

const normalSurface = (appId: string): Record<string, unknown> => ({
	returnValue: true,
	mode: 'normal',
	foregroundAppInfo: [
		{
			appId,
			windowType: '_WEBOS_WINDOW_TYPE_CARD',
			viewType: 'normal',
			multiview: false,
			pip: false,
			primary: true,
		},
	],
});

const pipSurface = (mainAppId: string): Record<string, unknown> => ({
	returnValue: true,
	mode: 'multiview',
	foregroundAppInfo: [
		{
			appId: mainAppId,
			windowType: '_WEBOS_WINDOW_TYPE_CARD',
			viewType: 'mvpip',
			multiview: true,
			pip: false,
			primary: true,
		},
		{
			appId: PIP_APP_ID,
			windowType: '_WEBOS_WINDOW_TYPE_CARD',
			viewType: 'mvpip',
			multiview: true,
			pip: true,
			primary: false,
		},
	],
});

test('automatic PiP allowlist is limited to measured Live TV and YouTube mains', () => {
	assert.deepEqual(AUTOMATIC_PIP_MAIN_APP_IDS, [
		'com.webos.app.livetv',
		'youtube.leanback.v4',
	]);
});

test('eligible current foreground main is launched with companion and must be admitted', async () => {
	const mainAppId = 'com.webos.app.livetv';
	const surfaceResponses = [normalSurface(mainAppId), normalSurface(mainAppId), pipSurface(mainAppId)];
	const calls: Array<{ uri: string; params?: Record<string, unknown> }> = [];
	const call: PipCameraLunaCall = async (uri, params) => {
		calls.push({ uri, params });
		if (uri === SURFACE_URI) return surfaceResponses.shift() ?? pipSurface(mainAppId);
		return { returnValue: true };
	};
	const presenter = new PipCameraPresenter({
		call,
		admissionChecks: 3,
		pollIntervalMs: 0,
		sleep: async () => undefined,
	});

	assert.equal(await presenter.present(camera()), true);
	const launch = calls.find(entry => entry.uri === LAUNCH_URI);
	assert.deepEqual(launch?.params, {
		apps: [
			{ appId: mainAppId, role: 'main', order: 0 },
			{ appId: PIP_APP_ID, role: 'sub', order: 1 },
		],
		mode: 'pip',
	});
	assert.deepEqual(presenter.status(), {
		pipCompanionAppId: PIP_APP_ID,
		pipLastOutcome: 'shown',
		pipLastReason: 'admitted',
		pipLastMainAppId: mainAppId,
		pipSessionActive: true,
	});
	await presenter.stop();
});

test('already-active valid companion PiP is reused without relaunching the main app', async () => {
	const mainAppId = 'youtube.leanback.v4';
	const calls: string[] = [];
	const call: PipCameraLunaCall = async uri => {
		calls.push(uri);
		if (uri === SURFACE_URI) return pipSurface(mainAppId);
		return { returnValue: true };
	};
	const presenter = new PipCameraPresenter({ call });

	assert.equal(await presenter.present(camera()), true);
	assert.equal(calls.includes(LAUNCH_URI), false);
	assert.equal(presenter.status().pipLastReason, 'already-active');
	await presenter.stop();
});

test('unsupported HDMI foreground falls back without asking Multi View to change source', async () => {
	const calls: string[] = [];
	const call: PipCameraLunaCall = async uri => {
		calls.push(uri);
		if (uri === SURFACE_URI) return normalSurface('com.webos.app.hdmi1');
		return { returnValue: true };
	};
	const presenter = new PipCameraPresenter({ call });

	assert.equal(await presenter.present(camera()), false);
	assert.equal(calls.includes(LAUNCH_URI), false);
	assert.equal(calls.includes(CLOSE_URI), false);
	assert.deepEqual(presenter.status(), {
		pipCompanionAppId: PIP_APP_ID,
		pipLastOutcome: 'fallback',
		pipLastReason: 'main-not-allowlisted',
		pipLastMainAppId: 'com.webos.app.hdmi1',
		pipSessionActive: false,
	});
});

test('existing unrelated Multi View state is never replaced by a camera notification', async () => {
	let launchCalls = 0;
	const call: PipCameraLunaCall = async uri => {
		if (uri === SURFACE_URI) {
			return {
				returnValue: true,
				mode: 'multiview',
				foregroundAppInfo: [
					{ appId: 'com.webos.app.livetv', windowType: '_WEBOS_WINDOW_TYPE_CARD' },
					{ appId: 'com.webos.app.browser', windowType: '_WEBOS_WINDOW_TYPE_CARD' },
				],
			};
		}
		if (uri === LAUNCH_URI) launchCalls += 1;
		return { returnValue: true };
	};
	const presenter = new PipCameraPresenter({ call });

	assert.equal(await presenter.present(camera()), false);
	assert.equal(launchCalls, 0);
	assert.equal(presenter.status().pipLastReason, 'foreground-not-single');
});

test('controller launch failure returns fallback and best-effort closes only the companion', async () => {
	const mainAppId = 'com.webos.app.livetv';
	const calls: Array<{ uri: string; params?: Record<string, unknown> }> = [];
	const call: PipCameraLunaCall = async (uri, params) => {
		calls.push({ uri, params });
		if (uri === SURFACE_URI) return normalSurface(mainAppId);
		if (uri === LAUNCH_URI) throw new Error('Multiview cannot be launched for restriction');
		return { returnValue: true };
	};
	const presenter = new PipCameraPresenter({ call });

	assert.equal(await presenter.present(camera()), false);
	assert.equal(presenter.status().pipLastReason, 'launch-rejected');
	assert.deepEqual(
		calls.filter(entry => entry.uri === CLOSE_URI).map(entry => entry.params),
		[{ id: PIP_APP_ID }],
	);
});

test('launch success without verified surface admission times out and closes companion', async () => {
	const mainAppId = 'youtube.leanback.v4';
	let closeCalls = 0;
	const call: PipCameraLunaCall = async uri => {
		if (uri === SURFACE_URI) return normalSurface(mainAppId);
		if (uri === CLOSE_URI) closeCalls += 1;
		return { returnValue: true };
	};
	const presenter = new PipCameraPresenter({
		call,
		admissionChecks: 2,
		pollIntervalMs: 0,
		sleep: async () => undefined,
	});

	assert.equal(await presenter.present(camera()), false);
	assert.equal(presenter.status().pipLastReason, 'admission-timeout');
	assert.equal(closeCalls, 1);
});
