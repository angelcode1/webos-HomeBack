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
requireInvariant(pkg.version === '0.4.15', 'Unexpected application version');
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
requireInvariant(
	remote.includes('configFingerprint') && remote.includes('rejectedConfigFingerprint') && remote.includes('stat.mtimeMs') && remote.includes('stat.size') && remote.includes('stat.ino'),
	'config change fingerprint must include mtime, size and inode',
);
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
requireInvariant(remote.includes('INJECTION_WATCHDOG_MS = 15_000'), '15-second injector watchdog missing');
requireInvariant(remote.includes('startTimeTicks') && remote.includes('readProcessStartTime'), 'PID start-time identity checks missing');
requireInvariant(!remote.includes("'testapp'") && !remote.includes("'RELEASE'"), 'obsolete testapp/RELEASE injection targets must remain removed');
const serviceEnvironment = read('packages/service/src/environment.ts');
requireInvariant(serviceEnvironment.includes('SERVICE_ROOT_DIR = __dirname'), 'service vendor root must be cwd-independent');
const eventLogTailer = read('packages/service/src/event-log-tailer.ts');
requireInvariant(
	eventLogTailer.includes('fstatSync(cursor.fd)') &&
	eventLogTailer.includes('readSync(') &&
	eventLogTailer.includes('ftruncateSync(cursor.fd, 0)') &&
	!eventLogTailer.includes('openSync('),
	'event log polling/rotation must remain pinned to retained file descriptors',
);
requireInvariant(
	remote.includes('this.logTailer.add(logPath, eventFd') && remote.includes('O_NOFOLLOW'),
	'remote hook logs must be created/adopted with nofollow descriptors retained by the tailer',
);
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
requireInvariant(
	appIndex.includes('/remote/status') && appIndex.includes('/remote/start') && appIndex.includes('if (setupComplete) {') && appIndex.includes('renderApp();'),
	'completed setup must render immediately and use the cheap remote status/start path',
);
requireInvariant(
	appIndex.includes('setTimeout(renderApp, 3_000)'),
	'first-run restart failure fallback must prevent an indefinite setup screen',
);
const internalProvider = read('packages/app/src/shared/services/launcher/providers/internal/internal.provider.ts');
requireInvariant(
	internalProvider.indexOf("launchPointId: '@button:inputs'") <
	internalProvider.indexOf("launchPointId: '@button:keypad'") &&
	internalProvider.indexOf("launchPointId: '@button:keypad'") <
	internalProvider.indexOf("launchPointId: '@intent:add_apps'"),
	'Keypad tile must remain immediately after Inputs and before Add apps',
);
requireInvariant(
	!internalProvider.includes('colorButton(') && !internalProvider.includes("internalAction: 'micomKey'"),
	'R/G/Y/B must live inside the keypad rather than as standalone ribbon tiles',
);
const numericKeyboardProxy = exists('packages/app/src/features/ribbon/ui/numeric-keyboard-proxy/numeric-keyboard-proxy.component.tsx')
	? read('packages/app/src/features/ribbon/ui/numeric-keyboard-proxy/numeric-keyboard-proxy.component.tsx')
	: '';
const numericKeyboardCss = exists('packages/app/src/features/ribbon/ui/numeric-keyboard-proxy/numeric-keyboard-proxy.module.scss')
	? read('packages/app/src/features/ribbon/ui/numeric-keyboard-proxy/numeric-keyboard-proxy.module.scss')
	: '';
requireInvariant(
	Boolean(numericKeyboardProxy) && numericKeyboardProxy.includes('com.webos.service.micomservice/sendKeycode'),
	'functional numeric keypad overlay missing',
);
requireInvariant(
	!numericKeyboardProxy.includes('<input') && numericKeyboardProxy.includes('NUMERIC_KEYPAD_DIGITS'),
	'Keypad must remain an in-app numeric overlay rather than invoking the fixed-bottom webOS virtual keyboard',
);
requireInvariant(
	numericKeyboardProxy.includes('NUMERIC_KEYPAD_COLOURS') &&
	numericKeyboardCss.includes('.colourRow') &&
	numericKeyboardCss.includes('grid-template-columns: repeat(4, 1fr)'),
	'Keypad must include the four-button R/G/Y/B row below the numeric keys',
);
const numericKeyboardLib = read('packages/app/src/features/ribbon/ui/numeric-keyboard-proxy/numeric-keyboard.lib.ts');
requireInvariant(
	numericKeyboardLib.includes('red: 0x72') &&
	numericKeyboardLib.includes('green: 0x71') &&
	numericKeyboardLib.includes('yellow: 0x63') &&
	numericKeyboardLib.includes('blue: 0x61'),
	'Keypad colour row must use LG MICOM Red/Green/Yellow/Blue command bytes',
);
requireInvariant(
	numericKeyboardCss.includes('bottom: 240px') && numericKeyboardCss.includes('z-index: 5000'),
	'Numeric keypad must remain positioned above the HomeBack tray',
);
requireInvariant(
	numericKeyboardProxy.includes("registerOwner('keypad'") && numericKeyboardProxy.includes('back: close') && numericKeyboardProxy.includes('closeNumericKeypad'),
	'Keypad must use the central keyboard owner and dismiss on physical Back without exiting HomeBack',
);
requireInvariant(
	numericKeyboardProxy.includes('NUMERIC_REMOTE_KEY_INTERVAL_MS') &&
	numericKeyboardProxy.includes('com.webos.service.micomservice/sendKeycode'),
	'Keypad must serialize real numeric remote-key emulation',
);
const keyboardModule = read('packages/app/src/features/ribbon/services/ribbon/ribbon.module.ts');
const keyboardDispatcher = read('packages/app/src/features/ribbon/services/keyboard/keyboard.service.ts');
const drawerKeyboardOwner = read('packages/app/src/features/ribbon/services/app-drawer/app-drawer.service.ts');
requireInvariant(
	(keyboardModule.match(/new KeyboardService\(\)/g) ?? []).length === 1 &&
	keyboardDispatcher.includes('private owner: KeyboardOwner') &&
	drawerKeyboardOwner.includes("registerOwner('drawer'") &&
	numericKeyboardProxy.includes("registerOwner('keypad'"),
	'ribbon, drawer and keypad must share one explicit-owner keyboard dispatcher',
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
const ribbonAutoHideService = read('packages/app/src/features/ribbon/services/ribbon/ribbon.service.ts');
const ribbonLib = read('packages/app/src/features/ribbon/services/ribbon/ribbon.lib.ts');
requireInvariant(
	ribbonLib.includes('RIBBON_AUTO_HIDE_MS = 3_000') &&
	ribbonAutoHideService.includes('scheduleAutoHide') &&
	ribbonAutoHideService.includes('RIBBON_AUTO_HIDE_MS'),
	'3-second ribbon inactivity auto-hide missing',
);
requireInvariant(
	ribbonAutoHideService.includes('this.numericKeypadVisible') &&
	ribbonAutoHideService.includes('this.appDrawerService.visible') &&
	ribbonAutoHideService.includes('this.moving'),
	'editing, drawer and numeric keypad must pause ribbon auto-hide',
);
const ribbonCardCss = read('packages/app/src/features/ribbon/ui/ribbon-card/ribbon-card.module.scss');
requireInvariant(
	ribbonCardCss.includes('opacity: 0.85;'),
	'tray background must remain at 85% opacity',
);
const ribbonService = read('packages/app/src/features/ribbon/services/ribbon/ribbon.service.ts');
requireInvariant(
	ribbonService.includes('visible && !drawerVisible && !keypadVisible'),
	'ribbon wheel scrolling must be disabled while the app drawer or keypad owns input',
);
const cardCss = read('packages/app/src/features/ribbon/ui/ribbon-card/ribbon-card.module.scss');
requireInvariant(
	cardCss.includes('$input-tile-scale: 0.8;'),
	'Inputs tile 20% width/icon scaling missing',
);
requireInvariant(cardCss.includes('.card.moving'), 'moving-card transform must not rely on CSS source ordering');
const appManagerProvider = read('packages/app/src/shared/services/launcher/providers/app-manager/app-manager.provider.ts');
requireInvariant(appManagerProvider.includes('this.iconQueue.length = 0'), 'stale icon hydration queue cancellation missing');
const drawer = read('packages/app/src/features/ribbon/ui/ribbon-app-drawer/ribbon-app-drawer.component.tsx');
requireInvariant(drawer.includes('{active && <RibbonAppDrawerList />}'), 'hidden app drawer list must not remain mounted at startup');
const launcherService = read('packages/app/src/shared/services/launcher/model/launcher.service.ts');
requireInvariant(launcherService.includes('providerErrorCount'), 'launcher provider failure status must be surfaced');
requireInvariant(launcherService.includes('launchPoint.builtin') && launcherService.includes('nonBuiltinIds'), 'builtin IDs must be excluded from persisted user ordering');
const ribbonComponent = read('packages/app/src/features/ribbon/ui/ribbon/ribbon.component.tsx');
requireInvariant(ribbonComponent.includes('service.warningText'), 'user-visible remote/provider warning missing');
requireInvariant(appPkg.name === '@homeback/app' && servicePkg.name === '@homeback/service' && utilsPkg.name === '@homeback/utils', 'HomeBack workspace package names regressed');
requireInvariant(read('packages/app/src/shared/services/settings/model/settings.service.ts').includes('althome:settings'), 'legacy settings key must remain stable to preserve user tile order');
const deployScript = read('scripts/deploy-tv.sh');
requireInvariant(deployScript.includes("<<'REMOTE'\nset -eu"), 'deploy remote heredoc must fail safely with set -eu');
requireInvariant(
	iconSvg.indexOf('stroke="#FF0844" stroke-width="34"') >= 0 &&
	iconSvg.indexOf('stroke="#6B6B6B" stroke-width="22"') >= 0,
	'launcher arrow must keep a grey centre with bright-red outline',
);
const commonApi = read('packages/app/src/shared/api/common.ts');
requireInvariant(commonApi.includes('APPLICATION_MANAGER_URI'), 'Application Manager Luna URI constant missing');
requireInvariant(!read('packages/service/src/remote-input.ts').includes('sweepActivePresses'), 'dead active-press sweep must remain removed');
requireInvariant(!read('packages/app/src/features/ribbon/ui/numeric-keyboard-proxy/numeric-keyboard.lib.ts').includes('numericMicomKeycodes'), 'dead plural numeric keycode helper must remain removed');

if (errors.length > 0) {
	console.error('Optimized source verification failed:');
	for (const error of errors) console.error(` - ${error}`);
	process.exit(1);
}

console.log('Optimized source verification passed.');
