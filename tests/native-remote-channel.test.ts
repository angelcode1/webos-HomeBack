import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { NativeRemoteChannel } from '../packages/service/src/native-remote-channel.ts';
import { NativeConfigWriter } from '../packages/service/src/native-config-writer.ts';
import type { RemoteConfig } from '../packages/service/src/remote-config.ts';

test('structured event socket parses complete frames and rejects malformed input', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'homeback-ipc-'));
  const channel = new NativeRemoteChannel(dir);
  const received: Array<[number, number]> = [];
  try {
    await channel.start((keycode, state) => received.push([keycode, state]));
    assert.equal(channel.ready, true);
    await channel.setAuthorized(true);
    assert.match(await readFile(path.join(dir, 'lease'), 'utf8'), /^\d+\n$/);
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection(path.join(dir, 'events.sock'));
      socket.once('connect', () => socket.end('773 1\n773 0\nBAD\n4294967295 1\n'));
      socket.once('close', () => resolve());
      socket.once('error', reject);
    });
    assert.deepEqual(received, [[773, 1], [773, 0]]);
    assert.equal(channel.rejectedEvents, 2);
    assert.equal(channel.deliveredEvents, 2);
    await channel.setAuthorized(false);
    await assert.rejects(stat(path.join(dir, 'lease')), { code: 'ENOENT' });
  } finally {
    await channel.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('structured native writer arms only the leased timed-ignore action', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'homeback-native-mappings-'));
  const filename = path.join(dir, 'keybinds.json');
  const writer = new NativeConfigWriter(filename, true);
  const config: RemoteConfig = {
    version: 1,
    keys: {
      773: {
        short: { action: 'launch', id: 'com.homebrew.homeback' },
        long: { action: 'launch', id: 'com.webos.app.home' },
      },
      1037: { action: 'ignore' },
    },
  };
  try {
    await writer.setArmed(config, true);
    assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), {
      773: { action: 'timed_ignore' },
      1037: { action: 'ignore' },
    });
    await writer.setArmed(config, false);
    assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), {
      1037: { action: 'ignore' },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('failed second listener leaves the active owner socket and heartbeat intact', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'homeback-ipc-owner-'));
  const first = new NativeRemoteChannel(dir);
  const second = new NativeRemoteChannel(dir);
  try {
    await first.start(() => undefined);
    await first.setAuthorized(true);
    await assert.rejects(second.start(() => undefined), /already owns this socket/);
    await second.stop();
    assert.equal((await stat(path.join(dir, 'events.sock'))).isSocket(), true);
    assert.equal((await stat(path.join(dir, 'lease'))).isFile(), true);
  } finally {
    await first.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
