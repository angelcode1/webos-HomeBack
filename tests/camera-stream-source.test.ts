import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRecentCameraEntry } from '../packages/service/src/notification.ts';

test('camera events retain an optional stream URL and use it as media fallback', () => {
	const entry = buildRecentCameraEntry({
		cameraId: 'camera.front',
		preview: {
			streamUrl: 'http://ha.local/api/camera_proxy_stream/camera.front',
		},
	}, 1000);
	assert.ok(entry);
	assert.equal(entry.streamUrl, 'http://ha.local/api/camera_proxy_stream/camera.front');
	assert.equal(entry.imageUrl, entry.streamUrl);
});
