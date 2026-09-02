import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ribbonSource = readFileSync(
	'packages/app/src/features/ribbon/ui/ribbon/ribbon.component.tsx',
	'utf8',
);
const ribbonStyles = readFileSync(
	'packages/app/src/features/ribbon/ui/ribbon/ribbon.module.scss',
	'utf8',
);
const appServicesSource = readFileSync('packages/app/src/shared/services/services.ts', 'utf8');
const serviceSource = readFileSync('packages/service/src/index.ts', 'utf8');

test('weather hotfix keeps weather out of the web-app startup and launcher render paths', () => {
	assert.doesNotMatch(ribbonSource, /RibbonStatusTile/);
	assert.doesNotMatch(appServicesSource, /WeatherService|weatherService/);
	assert.match(ribbonStyles, /inset:\s*0;/);
	assert.doesNotMatch(ribbonStyles, /inset:\s*0\s+194px\s+0\s+0/);
});

test('weather discovery cannot block or fail the privileged bootstrap path', () => {
	const bootstrapStart = serviceSource.indexOf("service.registerSimple('/bootstrap'");
	const remoteStart = serviceSource.indexOf("service.registerSimple('/remote/start'");
	assert.notEqual(bootstrapStart, -1);
	assert.notEqual(remoteStart, -1);
	assert.ok(remoteStart > bootstrapStart);

	const bootstrapBlock = serviceSource.slice(bootstrapStart, remoteStart);
	assert.doesNotMatch(bootstrapBlock, /weatherService/);
	assert.match(serviceSource, /service\.registerSimple\('\/weather\/current'/);
});
