import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { NativeConfigWriter } from '../packages/service/src/native-config-writer.ts';
import type { RemoteConfig } from '../packages/service/src/remote-config.ts';

const config: RemoteConfig = {
	version: 1,
	keys: {
		1042: {
			short: { action: 'launch', id: 'com.example.app' },
			long: { action: 'replace', keycode: 398 },
		},
	},
};

test('native writer arms and synchronously disarms timed mappings', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'homeback-native-'));
	const configPath = path.join(directory, 'keybinds.json');
	const writer = new NativeConfigWriter(configPath);

	await writer.setArmed(config, true);
	assert.equal(writer.timedMappingsArmed, true);
	assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), { 1042: { action: 'ignore' } });

	writer.disarmSync(config);
	assert.equal(writer.timedMappingsArmed, false);
	assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {});
});

test('synchronous disarm replaces a symlink instead of following it', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'homeback-native-'));
	const victim = path.join(directory, 'victim.json');
	const configPath = path.join(directory, 'keybinds.json');
	await writeFile(victim, 'do-not-touch\n');
	await symlink(victim, configPath);

	const writer = new NativeConfigWriter(configPath);
	writer.disarmSync(config);

	assert.equal(await readFile(victim, 'utf8'), 'do-not-touch\n');
	assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {});
});
