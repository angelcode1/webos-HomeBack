import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
	CLOCK_TILE_REVEAL_DELAY_MS,
	formatClockTileDate,
} from '../packages/app/src/features/ribbon/ui/ribbon-clock-tile/ribbon-clock-tile.lib.ts';

const ribbonSource = readFileSync(
	'packages/app/src/features/ribbon/ui/ribbon/ribbon.component.tsx',
	'utf8',
);
const clockSource = readFileSync(
	'packages/app/src/features/ribbon/ui/ribbon-clock-tile/ribbon-clock-tile.component.tsx',
	'utf8',
);
const serviceSource = readFileSync('packages/service/src/index.ts', 'utf8');
const utilsIndex = readFileSync('packages/utils/index.ts', 'utf8');

const removedWeatherPaths = [
	'docs/WEATHER-STATUS-TILE.md',
	'packages/app/src/shared/services/weather',
	'packages/app/src/features/ribbon/ui/ribbon-status-tile',
	'packages/service/src/weather.ts',
	'packages/utils/weather.ts',
];

test('clock tile date uses compact month and day', () => {
	assert.equal(formatClockTileDate(new Date(2026, 8, 3, 11, 12)), 'Sep, 3');
});

test('clock tile reveal is delayed by one second', () => {
	assert.equal(CLOCK_TILE_REVEAL_DELAY_MS, 1_000);
});

test('clock/date tile is mounted outside the launcher group and remains local-only', () => {
	assert.match(ribbonSource, /<RibbonClockTile visible=\{service\.visible\} \/>/);
	assert.doesNotMatch(clockSource, /Weather|weather|fetch\(|https?:|luna\(|PalmServiceBridge/);
});

test('weather implementation and external-weather dependencies are removed', () => {
	for (const path of removedWeatherPaths) assert.equal(existsSync(path), false, path);
	assert.doesNotMatch(serviceSource, /Weather|weather/);
	assert.doesNotMatch(utilsIndex, /Weather|weather/);
});
