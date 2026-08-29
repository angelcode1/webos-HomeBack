import assert from 'node:assert/strict';
import test from 'node:test';

import { keyboardOwnerFor, surfaceVisibleFor } from '../packages/app/src/app/app.lib.ts';
import {
	activationActionFrom,
	parsePreviewRequest,
} from '../packages/app/src/shared/services/activation/model/activation.lib.ts';
import {
	clampPreviewDuration,
	PREVIEW_DEFAULT_DURATION_MS,
	PREVIEW_MAX_DURATION_MS,
	PREVIEW_MIN_DURATION_MS,
} from '../packages/app/src/features/preview/preview.lib.ts';

const previewUrl = 'http://camera.local/stream.mjpeg';

test('preview activation is opt-in interactive and validates its URL', () => {
	assert.deepEqual(
		activationActionFrom(
			{ intent: 'homeback:preview', preview: { url: previewUrl } },
			undefined,
			false,
		),
		{ type: 'none' },
	);
	assert.deepEqual(
		activationActionFrom({
			intent: 'homeback:preview',
			preview: { url: previewUrl, interactive: false },
		}, undefined, false),
		{ type: 'none' },
	);
	assert.deepEqual(
		activationActionFrom({
			intent: 'homeback:preview',
			preview: { url: 'javascript:alert(1)', interactive: true },
		}, undefined, false),
		{ type: 'none' },
	);
	assert.equal(
		activationActionFrom({
			intent: 'homeback:preview',
			preview: { url: previewUrl, interactive: true },
		}, undefined, false).type,
		'showPreview',
	);
	assert.equal(parsePreviewRequest({ url: previewUrl, interactive: true })?.interactive, true);
});

test('cold and warm launcher activation semantics stay distinct', () => {
	assert.deepEqual(
		activationActionFrom({ intent: 'homeback:show' }, undefined, true),
		{ type: 'showLauncher' },
	);
	assert.deepEqual(
		activationActionFrom({ intent: 'homeback:show' }, undefined, false),
		{ type: 'toggleLauncher' },
	);
	assert.deepEqual(
		activationActionFrom({ activateType: 'home' }, undefined, false),
		{ type: 'toggleLauncher' },
	);
	assert.deepEqual(activationActionFrom({}, 'preload', true), { type: 'none' });
	assert.deepEqual(activationActionFrom({}, undefined, true), { type: 'showLauncher' });
});

test('preview duration is always hard-clamped', () => {
	assert.equal(clampPreviewDuration(undefined), PREVIEW_DEFAULT_DURATION_MS);
	assert.equal(clampPreviewDuration(0), PREVIEW_MIN_DURATION_MS);
	assert.equal(clampPreviewDuration(500), PREVIEW_MIN_DURATION_MS);
	assert.equal(clampPreviewDuration(5_500), 5_500);
	assert.equal(clampPreviewDuration(60_000), PREVIEW_MAX_DURATION_MS);
	assert.equal(clampPreviewDuration(Number.NaN), PREVIEW_DEFAULT_DURATION_MS);
});

test('surface visibility is the union of launcher and preview visibility', () => {
	assert.equal(surfaceVisibleFor({ ribbonVisible: false, previewVisible: false }), false);
	assert.equal(surfaceVisibleFor({ ribbonVisible: true, previewVisible: false }), true);
	assert.equal(surfaceVisibleFor({ ribbonVisible: false, previewVisible: true }), true);
	assert.equal(surfaceVisibleFor({ ribbonVisible: true, previewVisible: true }), true);
});

test('keyboard priority is keypad then drawer then ribbon then preview', () => {
	assert.equal(keyboardOwnerFor({
		ribbonVisible: false,
		drawerVisible: false,
		keypadVisible: false,
		previewVisible: false,
	}), null);
	assert.equal(keyboardOwnerFor({
		ribbonVisible: false,
		drawerVisible: false,
		keypadVisible: false,
		previewVisible: true,
	}), 'preview');
	assert.equal(keyboardOwnerFor({
		ribbonVisible: true,
		drawerVisible: false,
		keypadVisible: false,
		previewVisible: true,
	}), 'ribbon');
	assert.equal(keyboardOwnerFor({
		ribbonVisible: true,
		drawerVisible: true,
		keypadVisible: false,
		previewVisible: true,
	}), 'drawer');
	assert.equal(keyboardOwnerFor({
		ribbonVisible: true,
		drawerVisible: true,
		keypadVisible: true,
		previewVisible: true,
	}), 'keypad');
});
