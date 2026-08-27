#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(root, rel));
const sha256 = rel => crypto
	.createHash('sha256')
	.update(fs.readFileSync(path.join(root, rel)))
	.digest('hex');

const pngDimensions = rel => {
	const data = fs.readFileSync(path.join(root, rel));
	if (data.length < 24 || data.toString('ascii', 1, 4) !== 'PNG') return null;
	return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
};

const errors = [];
const requireInvariant = (condition, message) => {
	if (!condition) errors.push(message);
};

const pkg = JSON.parse(read('package.json'));
const appPkg = JSON.parse(read('packages/app/package.json'));
const servicePkg = JSON.parse(read('packages/service/package.json'));
const utilsPkg = JSON.parse(read('packages/utils/package.json'));
const appinfo = JSON.parse(read('packages/app/manifests/appinfo.json'));
const defaults = JSON.parse(read('packages/service/vendor/inputhook/remote-buttons.default.json'));

requireInvariant(pkg.id === 'com.homebrew.homeback', 'Unexpected application id');
requireInvariant(pkg.version === '0.4.14', 'Unexpected application version');
requireInvariant(pkg.license === 'GPL-2.0-only', 'HomeBack source license must remain GPL-2.0-only');
requireInvariant(exists('THIRD_PARTY_NOTICES.md'), 'Third-party notices missing');
requireInvariant(exists('scripts/verify-publication.cjs'), 'public-release provenance gate missing');
requireInvariant(exists('packages/service/vendor/inputhook/UPSTREAM-LICENSE.md'), 'LG Input Hook upstream license notice missing');
requireInvariant(pkg.devDependencies.typescript === '5.9.3', 'TypeScript must remain pinned to 5.9.3');
requireInvariant(pkg.resolutions.typescript === '5.9.3', 'TypeScript resolution must remain 5.9.3');
requireInvariant(pkg.devDependencies.webpack === '5.105.0', 'Webpack must remain on the native tsconfig resolver release');
requireInvariant(!pkg.dependencies['framer-motion'], 'framer-motion should remain removed');
requireInvariant(!pkg.dependencies.inversify, 'inversify should remain removed');
requireInvariant(!pkg.dependencies['reflect-metadata'], 'reflect-metadata should remain removed');
requireInvariant(!pkg.devDependencies['tsconfig-paths-webpack-plugin'], 'tsconfig-paths-webpack-plugin should remain removed');
requireInvariant(!pkg.devDependencies.autoprefixer, 'standalone autoprefixer should remain removed');
requireInvariant(!pkg.devDependencies['eslint-config-airbnb-base'], 'JS-only Airbnb lint preset should remain removed');
requireInvariant(!pkg.devDependencies['eslint-plugin-sonarjs'], 'SonarJS hard-error preset should remain removed');
requireInvariant(!pkg.devDependencies['ts-api-utils'], 'direct ts-api-utils dependency should remain removed with SonarJS');
requireInvariant(pkg.scripts?.['verify:publication'] === 'node scripts/verify-publication.cjs', 'publication verification script missing');

requireInvariant(appinfo.title === 'HomeBack', 'App title changed unexpectedly');
requireInvariant(appinfo.visible === true, 'HomeBack must remain visible in stock launcher');
requireInvariant(exists('packages/app/manifests/icon80.png'), '80x80 launcher icon missing');
requireInvariant(exists('packages/app/manifests/icon130.png'), '130x130 launcher icon missing');
requireInvariant(
	JSON.stringify(pngDimensions('packages/app/manifests/icon80.png')) === JSON.stringify({ width: 80, height: 80 }),
	'80x80 launcher icon dimensions changed',
);
requireInvariant(
	JSON.stringify(pngDimensions('packages/app/manifests/icon130.png')) === JSON.stringify({ width: 130, height: 130 }),
	'130x130 launcher icon dimensions changed',
);
const iconSvg = read('packages/app/manifests/icon.svg');
requireInvariant(
	iconSvg.includes('width="320"') && iconSvg.includes('height="320"') && iconSvg.includes('viewBox="0 0 320 320"'),
	'launcher SVG canvas dimensions changed',
);
for (const requiredColor of ['#A50034', '#FFFFFF', '#FF0844', '#6B6B6B']) {
	requireInvariant(iconSvg.includes(requiredColor), `launcher SVG palette color missing: ${requiredColor}`);
}

requireInvariant(exists('packages/service/vendor/inputhook/ezinject'), 'Bundled ezinject missing');
requireInvariant(exists('packages/service/vendor/inputhook/libinputhookpp.so'), 'Bundled inputhook library missing');
requireInvariant(
	sha256('packages/service/vendor/inputhook/ezinject') ===
		'3a03f5ea162651315cdbe710f6da815c8dd2650ea733e401a6cdce06943741b5',
	'Bundled ezinject hash changed',
);
requireInvariant(
	sha256('packages/service/vendor/inputhook/libinputhookpp.so') ===
		'fc1cd1e207e9d0c1fadb3019e340c56ab68b031a77ed207cb3a55b2d8641c084',
	'Bundled inputhook library hash changed',
);

const home = defaults.keys?.['773'];
requireInvariant(home?.short?.action === 'launch' && home.short.id === pkg.id, 'Default HOME short mapping changed');
requireInvariant(home?.long?.action === 'launch' && home.long.id === 'com.webos.app.home', 'Default HOME long mapping changed');
requireInvariant(defaults.defaultLongPressMs === 650, 'Default long-press threshold changed');

for (const deadPath of [
	'packages/service/src/routines',
	'packages/service/src/routine.ts',
	'packages/app/src/shared/core/di',
]) {
	requireInvariant(!exists(deadPath), `Dead architecture unexpectedly present: ${deadPath}`);
}

const bus = read('packages/service/src/bus/index.ts');
const serviceIndex = read('packages/service/src/index.ts');
const bootstrap = read('packages/service/src/bootstrap.ts');
const remote = read('packages/service/src/remote-input.ts');
const appWebpack = read('packages/app/webpack.config.ts');
const releaseScript = read('scripts/release.sh');

requireInvariant(bus.includes('@invariant: palmbus-keepalive'), 'palmbus keepalive invariant marker missing');
requireInvariant(releaseScript.includes('verify:publication'), 'release script must enforce native-payload publication gate');
requireInvariant(serviceIndex.includes('@invariant: root-helper-self-start'), 'root helper self-start invariant marker missing');
requireInvariant(bootstrap.includes('/tmp/homeback-autostart.log'), 'remote-input autostart logging missing');
requireInvariant(remote.includes('rejectedConfigMtime'), 'invalid config mtime suppression missing');
requireInvariant(remote.includes('verifyInjection'), 'injection verification missing');
requireInvariant(remote.includes('adoptExistingHook'), 'existing HomeBack hook adoption missing');
requireInvariant(remote.includes('inspectMappedHook'), 'pre-injection /proc maps inspection missing');
requireInvariant(remote.includes('nativeOwnershipVerified'), 'verified native ownership status missing');
requireInvariant(remote.includes('hasVerifiedNativeOwnership'), 'verified native ownership predicate missing');
requireInvariant(remote.includes('@invariant: single-proc-snapshot'), 'single /proc snapshot invariant missing');
requireInvariant(remote.includes('@invariant: blocked-target-recheck'), 'blocked target recheck invariant missing');
requireInvariant(remote.includes('@invariant: bounded-injection-retries'), 'bounded injection retry invariant missing');
requireInvariant(remote.includes('@invariant: essential-native-ownership'), 'essential-target ownership invariant missing');
requireInvariant(remote.includes('@invariant: nofollow-log-permissions'), 'nofollow log-permission invariant missing');
requireInvariant(
	bootstrap.includes('\"nativeOwnershipVerified\":true'),
	'autostart must require verified native ownership',
);
requireInvariant(
	bootstrap.includes('@invariant: remote-only-autostart') &&
	!bootstrap.includes('applicationManager/launch') &&
	!bootstrap.includes('homeback:warm'),
	'autostart must initialize remote input only and never prelaunch the HomeBack UI',
);
const appEnv = exists('packages/app/src/shared/api/env.d.ts')
	? read('packages/app/src/shared/api/env.d.ts')
	: '';
requireInvariant(Boolean(appEnv), 'app runtime globals declaration missing');
requireInvariant(appEnv.includes('declare const __DEV__: boolean'), '__DEV__ app global declaration missing');
requireInvariant(appEnv.includes('APP_ID: string') && appEnv.includes('SERVICE_ID: string'), 'app env id globals missing');
requireInvariant(remote.includes('cleanupTarget'), 'target cleanup lifecycle missing');
requireInvariant(remote.includes('ACTION_COOLDOWN_MS'), 'duplicate-action cooldown missing');
const lintCommand = 'eslint --ext .ts,.tsx,.js .';
requireInvariant(appPkg.scripts?.lint === lintCommand, 'app lint must explicitly cover TypeScript sources');
requireInvariant(servicePkg.scripts?.lint === lintCommand, 'service lint must explicitly cover TypeScript sources');
requireInvariant(utilsPkg.scripts?.lint === lintCommand, 'utils lint must explicitly cover TypeScript sources');
requireInvariant(exists('packages/utils/.eslintrc.yaml'), 'utils TypeScript ESLint config missing');
const rootEslint = read('.eslintrc.yaml');
requireInvariant(rootEslint.includes("files: [ '*.ts', '*.tsx' ]"), 'root TypeScript ESLint override missing');
requireInvariant(rootEslint.includes('no-undef: off'), 'TypeScript no-undef override missing');
requireInvariant(rootEslint.includes("'@typescript-eslint/no-unused-vars':"), 'TypeScript unused-vars rule missing');
requireInvariant(
	rootEslint.includes("'@typescript-eslint/consistent-type-imports': off"),
	'unsafe consistent-type-imports autofixer must remain disabled for this toolchain',
);
requireInvariant(rootEslint.includes('import/default: off'), 'TypeScript import/default false-positive override missing');
requireInvariant(rootEslint.includes('require-yield: off'), 'TypeScript generator false-positive override missing');
requireInvariant(appWebpack.includes("argv.mode === 'development' ? 'source-map' : false"), 'production source maps must remain disabled');
requireInvariant(appWebpack.includes('tsconfig: resolve('), 'Webpack native tsconfig resolver missing');

const appIndex = read('packages/app/src/index.tsx');
requireInvariant(
	appIndex.includes('hasCompletedSetup(window.localStorage)') &&
	appIndex.includes('markSetupComplete(window.localStorage)'),
	'first-run setup persistence guard missing',
);
requireInvariant(
	appIndex.includes('bootstrapHomeBack(() => markSetupComplete(window.localStorage))'),
	'setup completion must be persisted before any one-time restart request',
);
const internalProvider = read('packages/app/src/shared/services/launcher/providers/internal/internal.provider.ts');
requireInvariant(
	internalProvider.indexOf("launchPointId: '@button:inputs'") <
	internalProvider.indexOf("launchPointId: '@button:keypad'") &&
	internalProvider.indexOf("launchPointId: '@button:keypad'") <
	internalProvider.indexOf("colorButton('red'"),
	'Keypad tile must remain immediately after Inputs and before R/G/Y/B',
);
const numericKeyboardProxy = exists('packages/app/src/features/ribbon/ui/numeric-keyboard-proxy/numeric-keyboard-proxy.component.tsx')
	? read('packages/app/src/features/ribbon/ui/numeric-keyboard-proxy/numeric-keyboard-proxy.component.tsx')
	: '';
requireInvariant(
	Boolean(numericKeyboardProxy) && numericKeyboardProxy.includes('com.webos.service.micomservice/sendKeycode'),
	'functional numeric keypad proxy missing',
);
requireInvariant(
	numericKeyboardProxy.includes("type='number'") && numericKeyboardProxy.includes("inputMode='numeric'"),
	'Keypad must request the webOS numeric on-screen keyboard',
);
requireInvariant(
	numericKeyboardProxy.includes('bottom: 0') && !numericKeyboardProxy.includes('top: 0'),
	'Keypad input proxy must remain in the lower screen area so webOS shifts the tray above the virtual keyboard',
);
requireInvariant(
	numericKeyboardProxy.includes('isRemoteBackKey') && numericKeyboardProxy.includes('dismissOnRemoteBack'),
	'Keypad must dismiss on physical Back without exiting HomeBack',
);
requireInvariant(
	numericKeyboardProxy.includes('NUMERIC_REMOTE_KEY_INTERVAL_MS') &&
	numericKeyboardProxy.includes('com.webos.service.micomservice/sendKeycode'),
	'Keypad must serialize real numeric remote-key emulation',
);
requireInvariant(
	remote.includes('lastKeyEvent') && remote.includes('lastAction'),
	'remote timing telemetry missing',
);
requireInvariant(
	!read('packages/app/src/shared/api/common.ts').includes('homeback:warm'),
	'unsafe boot warm-launch intent must remain removed',
);
const drawerList = read('packages/app/src/features/ribbon/ui/ribbon-app-drawer/ribbon-app-drawer-list/ribbon-app-drawer-list.component.tsx');
requireInvariant(
	drawerList.includes("data-homeback-wheel-owner='drawer'") && drawerList.includes('onWheel={handleWheel}'),
	'app drawer must explicitly own wheel input',
);
const drawerCss = read('packages/app/src/features/ribbon/ui/ribbon-app-drawer/ribbon-app-drawer-list/ribbon-app-drawer-list.module.scss');
requireInvariant(
	drawerCss.includes('flex: 1 1 auto;') && drawerCss.includes('min-height: 0;'),
	'app drawer flex-scroll constraints missing',
);
const ribbonService = read('packages/app/src/features/ribbon/services/ribbon/ribbon.service.ts');
requireInvariant(
	ribbonService.includes('visible && !drawerVisible'),
	'ribbon wheel scrolling must be disabled while the app drawer is open',
);
const cardCss = read('packages/app/src/features/ribbon/ui/ribbon-card/ribbon-card.module.scss');
requireInvariant(
	cardCss.includes('$input-tile-scale: 0.8;'),
	'Inputs tile 20% width/icon scaling missing',
);

if (errors.length > 0) {
	console.error('Optimized source verification failed:');
	for (const error of errors) console.error(` - ${error}`);
	process.exit(1);
}

console.log('Optimized source verification passed.');
