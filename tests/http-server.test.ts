import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer as createNodeServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	bearerTokenMatches,
	HTTP_MAX_BODY_BYTES,
	HttpPreviewServer,
	isHttpSourceAllowed,
	parseHttpPreviewConfig,
} from '../packages/service/src/http-server.ts';

const freePort = async (): Promise<number> => {
	const server = createNodeServer();
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const address = server.address();
	assert.ok(address && typeof address === 'object');
	const port = address.port;
	await new Promise<void>(resolve => server.close(() => resolve()));
	return port;
};

const request = async (
	port: number,
	options: { method?: string; path: string; token?: string; body?: string; contentType?: string },
): Promise<{ statusCode: number; body: string }> =>
	new Promise((resolve, reject) => {
		const req = httpRequest(
			{
				host: '127.0.0.1',
				port,
				method: options.method ?? 'GET',
				path: options.path,
				headers: {
					...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
					...(options.contentType ? { 'Content-Type': options.contentType } : {}),
				},
			},
			response => {
				const chunks: Buffer[] = [];
				response.on('data', chunk => chunks.push(Buffer.from(chunk)));
				response.on('end', () => {
					resolve({
						statusCode: response.statusCode ?? 0,
						body: Buffer.concat(chunks).toString('utf8'),
					});
				});
			},
		);
		req.once('error', reject);
		if (options.body !== undefined) req.write(options.body);
		req.end();
	});

const writeEnabledConfig = async (path: string, port: number): Promise<void> => {
	await writeFile(
		path,
		`${JSON.stringify(
			{
				http: {
					enabled: true,
					port,
					allowedSources: ['127.0.0.1'],
				},
			},
			null,
			2,
		)}\n`,
		{ mode: 0o600 },
	);
};

test('HTTP config and source rules stay bounded to explicit IPv4/CIDR inputs', () => {
	assert.deepEqual(
		parseHttpPreviewConfig({ http: { enabled: true, port: 9876, allowedSources: ['192.168.8.20/32'] } }),
		{ enabled: true, port: 9876, allowedSources: ['192.168.8.20/32'] },
	);
	assert.equal(parseHttpPreviewConfig({ http: { enabled: true, port: 70_000, allowedSources: [] } }), null);
	assert.equal(parseHttpPreviewConfig({ http: { enabled: true, port: 9876, allowedSources: ['ha.local'] } }), null);
	assert.equal(isHttpSourceAllowed('192.168.8.20', []), true);
	assert.equal(isHttpSourceAllowed('8.8.8.8', []), false);
	assert.equal(isHttpSourceAllowed('192.168.8.20', ['192.168.8.20']), true);
	assert.equal(isHttpSourceAllowed('192.168.8.21', ['192.168.8.20']), false);
	assert.equal(bearerTokenMatches('Bearer same-token', 'same-token'), true);
	assert.equal(bearerTokenMatches('Bearer wrong-token', 'same-token'), false);
});

test('HTTP status distinguishes config loading from a loaded disabled config', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'homeback-http-disabled-'));
	const configPath = join(dir, 'http.json');
	const tokenPath = join(dir, 'api-token');
	const server = new HttpPreviewServer({
		version: 'test',
		configPath,
		tokenPath,
		bindAddress: '127.0.0.1',
		createPreviewNotification: async () => ({ done: true, suppressed: false, cameraRegistered: true }),
	});

	const startPromise = server.start();
	assert.deepEqual(server.status(), {
		httpConfigLoaded: false,
		httpEnabled: false,
		httpListening: false,
		httpPort: 9876,
		httpConfigPath: configPath,
		httpFailureReason: null,
	});

	await startPromise;
	assert.deepEqual(server.status(), {
		httpConfigLoaded: true,
		httpEnabled: false,
		httpListening: false,
		httpPort: 9876,
		httpConfigPath: configPath,
		httpFailureReason: null,
	});
	const config = JSON.parse(await readFile(configPath, 'utf8')) as { http: { enabled: boolean } };
	assert.equal(config.http.enabled, false);
	await assert.rejects(readFile(tokenPath, 'utf8'), { code: 'ENOENT' });
});

test('invalid HTTP config remains distinguishable from a loaded config', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'homeback-http-invalid-'));
	const configPath = join(dir, 'http.json');
	const tokenPath = join(dir, 'api-token');
	await writeFile(configPath, '{"http":{"enabled":"yes"}}\n', { mode: 0o600 });
	const server = new HttpPreviewServer({
		version: 'test',
		configPath,
		tokenPath,
		bindAddress: '127.0.0.1',
		createPreviewNotification: async () => ({ done: true, suppressed: false, cameraRegistered: true }),
	});

	await server.start();
	assert.equal(server.status().httpConfigLoaded, false);
	assert.equal(server.status().httpEnabled, false);
	assert.equal(server.status().httpListening, false);
	assert.equal(server.status().httpFailureReason, 'config-error');
	await assert.rejects(readFile(tokenPath, 'utf8'), { code: 'ENOENT' });
});

test('enabled listener creates a 0600 token only after binding and authenticates status', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'homeback-http-enabled-'));
	const configPath = join(dir, 'http.json');
	const tokenPath = join(dir, 'api-token');
	const port = await freePort();
	await writeEnabledConfig(configPath, port);
	const server = new HttpPreviewServer({
		version: '0.5.0-test',
		configPath,
		tokenPath,
		bindAddress: '127.0.0.1',
		createPreviewNotification: async () => ({ done: true, suppressed: false, cameraRegistered: true }),
	});

	await server.start();
	const token = await readFile(tokenPath, 'utf8');
	assert.match(token, /^[0-9a-f]{64}$/);
	assert.equal((await stat(tokenPath)).mode & 0o777, 0o600);
	const unauthorized = await request(port, { path: '/status' });
	assert.equal(unauthorized.statusCode, 401);
	assert.equal(unauthorized.body, '');
	const status = await request(port, { path: '/status', token });
	assert.equal(status.statusCode, 200);
	assert.deepEqual(JSON.parse(status.body), { ok: true, version: '0.5.0-test' });
	assert.equal(server.status().httpConfigLoaded, true);
	assert.equal(server.status().httpListening, true);
	await server.stop();
	assert.equal(server.status().httpListening, false);
});

test('preview sender failures map to an empty 502 response and oversized JSON is rejected', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'homeback-http-errors-'));
	const configPath = join(dir, 'http.json');
	const tokenPath = join(dir, 'api-token');
	const port = await freePort();
	await writeEnabledConfig(configPath, port);
	const server = new HttpPreviewServer({
		version: 'test',
		configPath,
		tokenPath,
		bindAddress: '127.0.0.1',
		createPreviewNotification: async () => {
			throw new Error('native failure for http://ha.local/camera?token=secret');
		},
	});
	await server.start();
	const token = await readFile(tokenPath, 'utf8');

	const failed = await request(port, {
		method: 'POST',
		path: '/notification/createPreviewToast',
		token,
		contentType: 'application/json',
		body: JSON.stringify({ cameraId: 'camera.test', preview: { imageUrl: 'http://ha.local/camera?token=secret' } }),
	});
	assert.equal(failed.statusCode, 502);
	assert.equal(failed.body, '');

	const oversized = await request(port, {
		method: 'POST',
		path: '/notification/createPreviewToast',
		token,
		contentType: 'application/json',
		body: JSON.stringify({ message: 'x'.repeat(HTTP_MAX_BODY_BYTES) }),
	});
	assert.equal(oversized.statusCode, 413);
	assert.equal(oversized.body, '');
	await server.stop();
});

test('bind failure is fail-open and does not persist a newly generated token', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'homeback-http-bind-'));
	const configPath = join(dir, 'http.json');
	const tokenPath = join(dir, 'api-token');
	const blocker = createNodeServer();
	await new Promise<void>((resolve, reject) => {
		blocker.once('error', reject);
		blocker.listen(0, '127.0.0.1', () => resolve());
	});
	const address = blocker.address();
	assert.ok(address && typeof address === 'object');
	await writeEnabledConfig(configPath, address.port);
	const server = new HttpPreviewServer({
		version: 'test',
		configPath,
		tokenPath,
		bindAddress: '127.0.0.1',
		createPreviewNotification: async () => ({ done: true, suppressed: false, cameraRegistered: true }),
	});

	await server.start();
	assert.equal(server.status().httpConfigLoaded, true);
	assert.equal(server.status().httpListening, false);
	assert.equal(server.status().httpFailureReason, 'EADDRINUSE');
	await assert.rejects(readFile(tokenPath, 'utf8'), { code: 'ENOENT' });
	await new Promise<void>(resolve => blocker.close(() => resolve()));
});
