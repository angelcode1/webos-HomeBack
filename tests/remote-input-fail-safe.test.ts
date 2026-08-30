import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath: string): string =>
	fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

test('timed native swallows are gated by verified service health', () => {
	const remote = read('packages/service/src/remote-input.ts');
	assert.match(remote, /@invariant: timed-mapping-fail-safe/);
	assert.match(remote, /this\.started &&[\s\S]*this\.eventTailerHealthy &&[\s\S]*this\.logTailer\.size > 0 &&[\s\S]*this\.isNativeOwnershipVerified\(\)/);
	assert.match(remote, /buildNativeKeybinds\(config, timedMappingsArmed\)/);
	assert.match(remote, /await this\.setTimedMappingsArmed\(false\)/);
	assert.match(remote, /disarmTimedMappingsSync/);
});

test('startup clears stale native timed swallows before config validation can fail', () => {
	const remote = read('packages/service/src/remote-input.ts');
	assert.match(remote, /@invariant: native-config-startup-disarm/);
	assert.equal(
		remote.includes("await writeFile(NATIVE_CONFIG_PATH, '{}\\n', 0o644);"),
		true,
	);
	assert.match(
		remote,
		/private async startOnce\(\): Promise<void> \{[\s\S]*await this\.ensureConfigFiles\(\);[\s\S]*await this\.reloadConfig\(true\);/,
	);
});

test('service shutdown disarms timed mappings before exit', () => {
	const service = read('packages/service/src/index.ts');
	assert.match(service, /bootstrap\.remoteInput\.stop\(\)/);
	assert.match(service, /process\.once\('exit', \(\) => bootstrap\.remoteInput\.disarmTimedMappingsSync\(\)\)/);
	assert.match(service, /process\.once\('SIGTERM', \(\) => shutdownService\(0\)\)/);
	assert.match(service, /process\.once\('SIGINT', \(\) => shutdownService\(0\)\)/);
	assert.doesNotMatch(service, /setTimeout\(\(\) => process\.exit\(0\), 100\)/);
});

test('unserviced timed presses emit a diagnostic', () => {
	const remote = read('packages/service/src/remote-input.ts');
	assert.match(remote, /\[HomeBackRemote\] unserviced timed key keycode=\$\{keycode\}/);
});
