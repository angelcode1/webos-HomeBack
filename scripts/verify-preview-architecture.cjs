const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appRoot = path.join(root, 'packages/app/src');
const relative = file => path.relative(root, file).replaceAll(path.sep, '/');

const collect = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
	const target = path.join(directory, entry.name);
	if (entry.isDirectory()) return collect(target);
	return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
});

const files = collect(appRoot);
const sources = files.map(file => ({ file, path: relative(file), text: fs.readFileSync(file, 'utf8') }));
const fail = message => {
	throw new Error(`[preview-architecture] ${message}`);
};

const matches = pattern => sources.flatMap(source =>
	[...source.text.matchAll(pattern)].map(match => ({ path: source.path, match: match[0] })),
);

const keyboardConstructors = matches(/new\s+KeyboardService\s*\(/g);
if (keyboardConstructors.length !== 1) {
	fail(`expected exactly one KeyboardService construction, found ${keyboardConstructors.length}`);
}
if (keyboardConstructors[0].path !== 'packages/app/src/features/ribbon/services/ribbon/ribbon.module.ts') {
	fail(`KeyboardService must be constructed in ribbon.module.ts, found ${keyboardConstructors[0].path}`);
}

if (matches(/homeback:probe/g).length !== 0) fail('experiment probe intent leaked into production source');

const runtimeSources = sources.filter(source => !source.path.endsWith('.d.ts'));
const onlyIn = (pattern, expectedPath, label) => {
	const found = runtimeSources.flatMap(source =>
		[...source.text.matchAll(pattern)].map(match => ({ path: source.path, match: match[0] })),
	);
	const wrong = found.filter(item => item.path !== expectedPath);
	if (wrong.length > 0) fail(`${label} escaped ${expectedPath}: ${wrong.map(item => item.path).join(', ')}`);
	if (found.length === 0) fail(`${label} is missing from ${expectedPath}`);
};

const surfacePath = 'packages/app/src/shared/services/surface/model/surface.service.ts';
onlyIn(/webOSSystem\.activate\s*\(/g, surfacePath, 'webOSSystem.activate');
onlyIn(/webOSSystem\.hide\s*\(/g, surfacePath, 'webOSSystem.hide');
onlyIn(/APPLICATION_MANAGER_URI\}\/suspense/g, surfacePath, 'applicationManager/suspense');

const activationPath = 'packages/app/src/shared/services/activation/model/activation.service.ts';
onlyIn(/webOSSystem\.launchParams/g, activationPath, 'webOSSystem.launchParams');
onlyIn(/webOSRelaunch/g, activationPath, 'webOSRelaunch listener');

const previewSources = sources.filter(source => source.path.includes('/features/preview/'));
for (const source of previewSources) {
	if (/launcherService|\.fulfilled\b/.test(source.text)) {
		fail(`preview feature depends on launcher readiness in ${source.path}`);
	}
}

const controller = fs.readFileSync(path.join(appRoot, 'app/app.controller.ts'), 'utf8');
if (!controller.includes("emitter.on('foreignLaunch', this.handleForeignLaunch)")) {
	fail('foreign app lifecycle events are not wired to the app controller');
}
if (!/handleForeignLaunch[\s\S]*?this\.dismissFeatures\(\)/.test(controller)) {
	fail('foreign launch does not dismiss both launcher and preview features');
}
if (!controller.includes("registerOwner('preview'")) fail('preview keyboard owner is not registered');

const previewLib = fs.readFileSync(path.join(appRoot, 'features/preview/preview.lib.ts'), 'utf8');
if (!/PREVIEW_MAX_DURATION_MS\s*=\s*10_000/.test(previewLib)) {
	fail('preview hard maximum must remain 10 seconds');
}
const previewService = fs.readFileSync(path.join(appRoot, 'features/preview/preview.service.ts'), 'utf8');
if (!/setInterval\(this\.watchdog,\s*PREVIEW_WATCHDOG_INTERVAL_MS\)/.test(previewService)) {
	fail('preview watchdog is missing');
}

console.log('Preview architecture invariants verified.');
