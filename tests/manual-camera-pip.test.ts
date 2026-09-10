import assert from 'node:assert/strict';
import test from 'node:test';

import {
	CAMERA_PIP_GEOMETRY,
	ManualCameraPip,
	type CameraPipLunaCall,
} from '../packages/service/src/manual-camera-pip.ts';

const PIP_ID = 'com.homebrew.homeback.camera';
const SURFACE = 'luna://com.webos.surfacemanager/getForegroundAppInfo';
const LAUNCH = 'luna://com.webos.service.multiviewcontroller/launchApps';
const COORDINATE = 'luna://com.webos.service.multiviewcontroller/setAppCoordinate';

const normal = (appId: string): Record<string, unknown> => ({
	returnValue: true,
	mode: 'normal',
	foregroundAppInfo: [{
		appId,
		windowType: '_WEBOS_WINDOW_TYPE_CARD',
		viewType: 'normal',
		multiview: false,
		pip: false,
		primary: true,
	}],
});

const admitted = (appId: string): Record<string, unknown> => ({
	returnValue: true,
	mode: 'multiview',
	foregroundAppInfo: [
		{ appId, windowType: '_WEBOS_WINDOW_TYPE_CARD', viewType: 'mvpip', multiview: true, pip: false, primary: true },
		{ appId: PIP_ID, windowType: '_WEBOS_WINDOW_TYPE_CARD', viewType: 'mvpip', multiview: true, pip: true, primary: false },
	],
});

test('manual camera PiP preserves detected main and applies 70-percent top-right geometry', async () => {
	const main = 'youtube.leanback.v4';
	const calls: Array<{ uri: string; params?: Record<string, unknown> }> = [];
	let surfaceReads = 0;
	const call: CameraPipLunaCall = async (uri, params) => {
		calls.push({ uri, params });
		if (uri === SURFACE) return surfaceReads++ === 0 ? normal(main) : admitted(main);
		return { returnValue: true };
	};
	const pip = new ManualCameraPip(call, PIP_ID);
	const status = await pip.open();

	assert.equal(status.pipLastOutcome, 'shown');
	assert.equal(status.pipLastMainAppId, main);
	assert.equal(status.pipGeometryApplied, true);
	assert.deepEqual(calls.find(item => item.uri === LAUNCH)?.params, {
		apps: [
			{ appId: main, role: 'main', order: 0 },
			{ appId: PIP_ID, role: 'sub', order: 1 },
		],
		mode: 'pip',
	});
	assert.deepEqual(calls.find(item => item.uri === COORDINATE)?.params, {
		appId: PIP_ID,
		...CAMERA_PIP_GEOMETRY,
	});
	assert.deepEqual(CAMERA_PIP_GEOMETRY, { x: 1445, y: 72, width: 403, height: 227 });
});

test('geometry rejection does not tear down an admitted camera PiP', async () => {
	const main = 'com.webos.app.livetv';
	let surfaceReads = 0;
	const call: CameraPipLunaCall = async uri => {
		if (uri === SURFACE) return surfaceReads++ === 0 ? normal(main) : admitted(main);
		if (uri === COORDINATE) throw new Error('unsupported coordinate payload');
		return { returnValue: true };
	};
	const pip = new ManualCameraPip(call, PIP_ID);
	const status = await pip.open();

	assert.equal(status.pipLastOutcome, 'shown');
	assert.equal(status.pipSessionActive, true);
	assert.equal(status.pipGeometryApplied, false);
	assert.match(status.pipGeometryError ?? '', /unsupported coordinate payload/);
});
