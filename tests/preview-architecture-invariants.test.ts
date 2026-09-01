import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const APP_SRC = path.join(process.cwd(), 'packages/app/src');

const sourceFiles = (root: string): string[] =>
	readdirSync(root).flatMap(name => {
		const file = path.join(root, name);
		if (statSync(file).isDirectory()) return sourceFiles(file);
		return /\.(?:ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [file] : [];
	});

const matches = (needle: string): string[] =>
	sourceFiles(APP_SRC)
		.filter(file => readFileSync(file, 'utf8').includes(needle))
		.map(file => path.relative(process.cwd(), file));

test('surface service exclusively owns compositor visibility APIs', () => {
	const surface = 'packages/app/src/shared/services/surface/surface.service.ts';
	assert.deepEqual(matches('webOSSystem.activate()'), [surface]);
	assert.deepEqual(matches('webOSSystem.hide()'), [surface]);
	assert.deepEqual(matches("/suspense`"), [surface]);
});

test('preview safety dismissal bypasses the ribbon transition delay', () => {
	const surface = readFileSync(
		path.join(APP_SRC, 'shared/services/surface/surface.service.ts'),
		'utf8',
	);
	assert.equal(
		surface.includes('if (!visible && !this.requestedVisible) this.commitHiddenNow()'),
		true,
	);
	assert.equal(surface.includes('if (previewWasRequested) this.commitHiddenNow()'), true);
});

test('cold preview dismissal defaults unresolved SDK detection to hide', () => {
	const surface = readFileSync(
		path.join(APP_SRC, 'shared/services/surface/surface.service.ts'),
		'utf8',
	);
	assert.equal(surface.includes("return this.compositorShimsRequired ? 'suspense' : 'hide'"), true);
	assert.match(surface, /if \(major === null\) \{[\s\S]*?return false;[\s\S]*?\}/);
});

test('feature teardown is emitted before an immediate preview surface hide', () => {
	const surface = readFileSync(
		path.join(APP_SRC, 'shared/services/surface/surface.service.ts'),
		'utf8',
	);
	const teardown = surface.indexOf("this.emitter.emit('dismissFeatures')");
	const immediateHide = surface.indexOf('if (previewWasRequested) this.commitHiddenNow()');
	assert.notEqual(teardown, -1);
	assert.notEqual(immediateHide, -1);
	assert.equal(teardown < immediateHide, true);
});

test('activation service exclusively owns launch params and relaunch event', () => {
	const activation = 'packages/app/src/shared/services/activation/activation.service.ts';
	assert.deepEqual(matches('webOSSystem.launchParams'), [activation]);
	assert.deepEqual(matches("'webOSRelaunch'"), [activation]);
});

test('activation relaunch listener stays explicitly bound and typed', () => {
	const activation = readFileSync(
		path.join(APP_SRC, 'shared/services/activation/activation.service.ts'),
		'utf8',
	);
	assert.match(
		activation,
		/private readonly handleRelaunch = \(event: CustomEvent<ActivateType>\): void => \{/,
	);
	assert.equal(
		activation.includes("document.addEventListener('webOSRelaunch', this.handleRelaunch);"),
		true,
	);
	assert.equal(activation.includes('this.handleRelaunch as EventListener'), false);
});

test('preview image failures are explicit without logging camera URLs', () => {
	const preview = readFileSync(
		path.join(APP_SRC, 'features/preview/preview.component.tsx'),
		'utf8',
	);
	assert.equal(preview.includes('onError={() => {'), true);
	assert.equal(preview.includes('image error host=${previewImageHost(imageUrl)}'), true);
	assert.equal(preview.includes('Camera unavailable'), true);
	assert.equal(preview.includes('console.warn(imageUrl'), false);
	assert.equal(preview.includes('console.warn(payload.imageUrl'), false);
});

test('preview presentation uses the bright theme and stays anchored top-right', () => {
	const styles = readFileSync(
		path.join(APP_SRC, 'features/preview/preview.module.scss'),
		'utf8',
	);
	assert.equal(styles.includes('\ttop: 48px;'), true);
	assert.equal(styles.includes('\tbottom: 48px;'), false);
	assert.equal(styles.includes('\tcolor-scheme: light;'), true);
	assert.equal(styles.includes('\tbackground: rgba(255, 255, 255, 0.98);'), true);
	assert.equal(styles.includes('\tcolor: #111827;'), true);
});

test('there is exactly one KeyboardService instance', () => {
	assert.deepEqual(matches('new KeyboardService()'), [
		'packages/app/src/shared/services/services.ts',
	]);
});

test('preview is independent from launcher readiness and has a watchdog', () => {
	const preview = readFileSync(
		path.join(APP_SRC, 'features/preview/preview.service.ts'),
		'utf8',
	);
	assert.equal(preview.includes('launcherService'), false);
	assert.equal(preview.includes('.fulfilled'), false);
	assert.equal(preview.includes('setInterval'), true);
	assert.equal(preview.includes("registerOwner('preview'"), true);
});

test('foreign app launches dismiss the focus-owning preview with all features', () => {
	const controller = readFileSync(path.join(APP_SRC, 'app/app.controller.ts'), 'utf8');
	assert.equal(controller.includes("emitter.on('foreignLaunch'"), true);
	assert.equal(controller.includes('surfaceService.dismissFeatures()'), true);
});

test('passive camera notifications use compact light-type toasts and queue-free suppression', () => {
	const service = readFileSync(
		path.join(process.cwd(), 'packages/service/src/index.ts'),
		'utf8',
	);
	const notification = readFileSync(
		path.join(process.cwd(), 'packages/service/src/notification.ts'),
		'utf8',
	);
	assert.equal(service.includes('/createToast`'), true);
	assert.equal(service.includes('createAlert'), false);
	assert.equal(service.includes('closeAlert'), false);
	assert.equal(service.includes('runPreviewToastSerial'), false);
	assert.equal(service.includes('previewToastQueues'), false);
	assert.equal(service.includes('TOAST_BRANDING'), false);
	assert.equal(service.includes('/icon80.png'), false);
	assert.equal(notification.includes("type: 'light'"), true);
	assert.equal(notification.includes('compact top-right toast'), true);
	assert.equal(notification.includes('PREVIEW_TOAST_SUPPRESSION_MS = 5_000'), true);
	assert.equal(notification.includes('iconUrl'), false);
	assert.equal(notification.includes("from './environment'"), false);
	assert.equal(notification.includes('PreviewNotificationState'), true);
	assert.equal(notification.includes('per-camera Promise queue'), true);
	assert.equal(notification.includes('result.length + point.length > maxLength'), true);
});

test('Cameras stays behind an app-level coordinator and only appears with recent cameras', () => {
	const controller = readFileSync(path.join(APP_SRC, 'app/app.controller.ts'), 'utf8');
	const launcher = readFileSync(
		path.join(APP_SRC, 'shared/services/launcher/model/launcher.service.ts'),
		'utf8',
	);
	const internalProvider = readFileSync(
		path.join(APP_SRC, 'shared/services/launcher/providers/internal/internal.provider.ts'),
		'utf8',
	);
	const notification = readFileSync(
		path.join(process.cwd(), 'packages/service/src/notification.ts'),
		'utf8',
	);

	assert.equal(internalProvider.includes('this.cameraService.cameras.length > 0'), true);
	assert.equal(internalProvider.includes("internalAction: 'openCameras'"), true);
	assert.equal(launcher.includes("this.emitter.emit('openCameras')"), true);
	assert.equal(launcher.includes('features/preview'), false);
	assert.equal(controller.includes("emitter.on('openCameras', this.openCameras)"), true);
	assert.equal(controller.includes('cameraToPreviewPayload(camera)'), true);
	assert.equal(controller.includes("console.warn('[HomeBackCamera] no recent camera')"), true);
	const previewShow = controller.indexOf('previewService.show(payload);');
	const ribbonHide = controller.indexOf('ribbonService.hide();');
	assert.notEqual(previewShow, -1);
	assert.notEqual(ribbonHide, -1);
	assert.equal(previewShow < ribbonHide, true);
	assert.equal(notification.includes('receivedAt: number'), true);
	assert.equal(notification.includes('expiresAt: number'), true);
	assert.equal(notification.includes('RECENT_CAMERA_FRESHNESS_MS = 2 * 60_000'), true);
});

test('root autostart remains remote-only and never prelaunches UI', () => {
	const bootstrap = readFileSync(
		path.join(process.cwd(), 'packages/service/src/bootstrap.ts'),
		'utf8',
	);
	assert.equal(bootstrap.includes('@invariant: remote-only-autostart'), true);
	assert.equal(bootstrap.includes('applicationManager/launch'), false);
});
