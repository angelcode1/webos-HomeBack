import assert from 'node:assert/strict';
import test from 'node:test';

import { Intent } from '../packages/app/src/shared/api/common.ts';
import {
	resolveInitialActivation,
	resolveRelaunchActivation,
} from '../packages/app/src/shared/services/activation/activation.lib.ts';
import { selectKeyboardOwner } from '../packages/app/src/shared/services/keyboard/keyboard.lib.ts';
import {
	clampPreviewDuration,
	normalizePreviewPayload,
	previewImageHost,
	PREVIEW_DEFAULT_DURATION_MS,
	PREVIEW_IMAGE_URL_MAX_LENGTH,
	PREVIEW_MAX_DURATION_MS,
	PREVIEW_MESSAGE_MAX_LENGTH,
	PREVIEW_MIN_DURATION_MS,
	PREVIEW_TITLE_MAX_LENGTH,
} from '../packages/app/src/features/preview/preview.lib.ts';

test('cold activation prioritizes explicit preview/show over preload', () => {
	assert.deepEqual(
		resolveInitialActivation({
			intent: Intent.Preview,
			preview: { interactive: true, title: 'Front Door' },
		}, 'preload'),
		{
			type: 'showPreview',
			preview: { interactive: true, title: 'Front Door' },
		},
	);
	assert.deepEqual(
		resolveInitialActivation({ intent: Intent.ShowHomeBack }, 'preload'),
		{ type: 'showLauncher' },
	);
	assert.deepEqual(
		resolveInitialActivation({ activateType: 'home' }, 'preload'),
		{ type: 'showLauncher' },
	);
	assert.deepEqual(resolveInitialActivation({}, 'preload'), { type: 'none' });
	assert.deepEqual(resolveInitialActivation({}, 'launch'), { type: 'showLauncher' });
});

test('relaunch activation preserves HOME toggle and preview show semantics', () => {
	assert.deepEqual(
		resolveRelaunchActivation({ intent: Intent.ShowHomeBack }),
		{ type: 'toggleLauncher' },
	);
	assert.deepEqual(
		resolveRelaunchActivation({ activateType: 'home' }),
		{ type: 'toggleLauncher' },
	);
	assert.deepEqual(
		resolveRelaunchActivation({
			intent: Intent.Preview,
			preview: { interactive: true },
		}),
		{ type: 'showPreview', preview: { interactive: true } },
	);
	assert.deepEqual(resolveRelaunchActivation({ intent: 'unknown' }), { type: 'none' });
});

test('preview duration is always hard-clamped', () => {
	assert.equal(clampPreviewDuration(undefined), PREVIEW_DEFAULT_DURATION_MS);
	assert.equal(clampPreviewDuration(Number.NaN), PREVIEW_DEFAULT_DURATION_MS);
	assert.equal(clampPreviewDuration(1), PREVIEW_MIN_DURATION_MS);
	assert.equal(clampPreviewDuration(5_000.9), 5_000);
	assert.equal(clampPreviewDuration(60_000), PREVIEW_MAX_DURATION_MS);
});

test('preview image diagnostics expose host only', () => {
	assert.equal(
		previewImageHost('https://user:pass@Cam.Example.com:8443/live?token=secret#frame'),
		'cam.example.com',
	);
	assert.equal(previewImageHost('https://127.0.0.1:1/none.jpg'), '127.0.0.1');
	assert.equal(previewImageHost('file:///tmp/camera.jpg'), 'none');
	assert.equal(previewImageHost('not a url'), 'invalid');
});

test('web preview requires explicit interactive opt-in and bounds launch strings', () => {
	assert.equal(normalizePreviewPayload({ title: 'Motion' }), null);
	assert.equal(normalizePreviewPayload({ interactive: false, title: 'Motion' }), null);
	assert.deepEqual(
		normalizePreviewPayload({
			interactive: true,
			title: '  Front Door  ',
			message: ' Person detected ',
			imageUrl: ' http://camera/image ',
			durationMs: 99_000,
		}),
		{
			title: 'Front Door',
			message: 'Person detected',
			imageUrl: 'http://camera/image',
			durationMs: PREVIEW_MAX_DURATION_MS,
		},
	);

	const bounded = normalizePreviewPayload({
		interactive: true,
		title: 't'.repeat(PREVIEW_TITLE_MAX_LENGTH + 20),
		message: 'm'.repeat(PREVIEW_MESSAGE_MAX_LENGTH + 20),
		imageUrl: 'u'.repeat(PREVIEW_IMAGE_URL_MAX_LENGTH + 1),
	});
	assert.equal(bounded?.title.length, PREVIEW_TITLE_MAX_LENGTH);
	assert.equal(bounded?.message?.length, PREVIEW_MESSAGE_MAX_LENGTH);
	assert.equal(bounded?.imageUrl, null);
});

test('keyboard ownership priority is keypad > drawer > ribbon > preview', () => {
	assert.equal(selectKeyboardOwner({ keypad: true, drawer: true, ribbon: true, preview: true }), 'keypad');
	assert.equal(selectKeyboardOwner({ keypad: false, drawer: true, ribbon: true, preview: true }), 'drawer');
	assert.equal(selectKeyboardOwner({ keypad: false, drawer: false, ribbon: true, preview: true }), 'ribbon');
	assert.equal(selectKeyboardOwner({ keypad: false, drawer: false, ribbon: false, preview: true }), 'preview');
	assert.equal(selectKeyboardOwner({ keypad: false, drawer: false, ribbon: false, preview: false }), null);
});
