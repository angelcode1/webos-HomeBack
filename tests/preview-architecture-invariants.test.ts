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

test('preview presentation is always light and anchored top-right', () => {
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

test('native preview alerts replace per camera and never raw-spread producer preview data', () => {
	const service = readFileSync(
		path.join(process.cwd(), 'packages/service/src/index.ts'),
		'utf8',
	);
	const notification = readFileSync(
		path.join(process.cwd(), 'packages/service/src/notification.ts'),
		'utf8',
	);
	assert.equal(service.includes('activePreviewAlerts'), true);
	assert.equal(service.includes('runPreviewAlertSerial'), true);
	assert.equal(service.includes('/closeAlert`'), true);
	assert.equal(notification.includes('cameraId?: string'), true);
	assert.equal(notification.includes('...preview,'), false);
});

test('root autostart remains remote-only and never prelaunches UI', () => {
	const bootstrap = readFileSync(
		path.join(process.cwd(), 'packages/service/src/bootstrap.ts'),
		'utf8',
	);
	assert.equal(bootstrap.includes('@invariant: remote-only-autostart'), true);
	assert.equal(bootstrap.includes('applicationManager/launch'), false);
});
