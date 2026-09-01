import { randomBytes, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP, type Socket } from 'node:net';
import { dirname } from 'node:path';

import type { PreviewNotificationRequest } from './notification';
import type { PreviewNotificationResult } from './preview-notification-service';

const HOME_BACK_CONFIG_DIR = '/home/root/.config/homeback';
export const HTTP_CONFIG_PATH = `${HOME_BACK_CONFIG_DIR}/http.json`;
export const HTTP_TOKEN_PATH = `${HOME_BACK_CONFIG_DIR}/api-token`;
export const DEFAULT_HTTP_PORT = 9_876;
export const HTTP_MAX_BODY_BYTES = 16 * 1_024;
const HTTP_TIMEOUT_MS = 5_000;
const HTTP_KEEP_ALIVE_TIMEOUT_MS = 1_000;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export type HttpPreviewConfig = {
	enabled: boolean;
	port: number;
	allowedSources: string[];
};

type HttpPreviewConfigFile = {
	http: HttpPreviewConfig;
};

export type HttpPreviewServerStatus = {
	httpConfigLoaded: boolean;
	httpEnabled: boolean;
	httpListening: boolean;
	httpPort: number;
	httpConfigPath: string;
	httpFailureReason: string | null;
};

type PreviewNotificationHandler = (
	request: PreviewNotificationRequest,
) => Promise<PreviewNotificationResult>;

export type HttpPreviewServerOptions = {
	version: string;
	createPreviewNotification: PreviewNotificationHandler;
	configPath?: string;
	tokenPath?: string;
	bindAddress?: string;
};

type BodyReadResult =
	| { ok: true; value: Record<string, unknown> }
	| { ok: false; statusCode: 400 | 413 };

const defaultConfig = (): HttpPreviewConfig => ({
	enabled: false,
	port: DEFAULT_HTTP_PORT,
	allowedSources: [],
});

const defaultConfigFile = (): HttpPreviewConfigFile => ({ http: defaultConfig() });

const errorCode = (error: unknown, fallback: string): string => {
	const code = (error as NodeJS.ErrnoException | null)?.code;
	if (typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code)) return code;
	return fallback;
};

const secureCreateFile = async (path: string, content: string): Promise<void> => {
	await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await fs.chmod(dirname(path), 0o700);
	const handle = await fs.open(
		path,
		fsConstants.O_WRONLY |
			fsConstants.O_CREAT |
			fsConstants.O_EXCL |
			fsConstants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.chmod(0o600);
		await handle.writeFile(content, { encoding: 'utf8' });
		await handle.sync();
	} finally {
		await handle.close();
	}
};

const readRegularFile = async (path: string): Promise<string> => {
	const stat = await fs.lstat(path);
	if (!stat.isFile() || stat.isSymbolicLink()) {
		throw new Error(`${path} must be a regular file, not a symlink.`);
	}
	await fs.chmod(path, 0o600);
	return fs.readFile(path, 'utf8');
};

const isObject = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseAllowedSource = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const rule = value.trim();
	if (!rule) return null;
	const [address, prefixText, extra] = rule.split('/');
	if (extra !== undefined || isIP(address) !== 4) return null;
	if (prefixText === undefined) return address;
	if (!/^\d{1,2}$/.test(prefixText)) return null;
	const prefix = Number(prefixText);
	return prefix >= 0 && prefix <= 32 ? `${address}/${prefix}` : null;
};

export const parseHttpPreviewConfig = (value: unknown): HttpPreviewConfig | null => {
	if (!isObject(value)) return null;
	const http = value.http;
	if (!isObject(http)) return null;
	if (typeof http.enabled !== 'boolean') return null;

	const port = http.port ?? DEFAULT_HTTP_PORT;
	if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) return null;

	const sourceValues = http.allowedSources ?? [];
	if (!Array.isArray(sourceValues)) return null;
	const allowedSources = sourceValues.map(parseAllowedSource);
	if (allowedSources.some(source => source === null)) return null;

	return {
		enabled: http.enabled,
		port,
		allowedSources: allowedSources as string[],
	};
};

const ipv4ToUint32 = (address: string): number =>
	address.split('.').reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);

const matchesSourceRule = (address: string, rule: string): boolean => {
	const [network, prefixText] = rule.split('/');
	const prefix = prefixText === undefined ? 32 : Number(prefixText);
	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	return (ipv4ToUint32(address) & mask) === (ipv4ToUint32(network) & mask);
};

const normalizedRemoteAddress = (value: string | undefined): string | null => {
	if (!value) return null;
	const normalized = value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value;
	return isIP(normalized) === 4 ? normalized : null;
};

const isPrivateIpv4 = (address: string): boolean => {
	const [first, second] = address.split('.').map(Number);
	return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
};

export const isHttpSourceAllowed = (
	remoteAddress: string | undefined,
	allowedSources: readonly string[],
): boolean => {
	const address = normalizedRemoteAddress(remoteAddress);
	if (!address) return false;
	if (allowedSources.length === 0) return isPrivateIpv4(address);
	return allowedSources.some(rule => matchesSourceRule(address, rule));
};

export const bearerTokenMatches = (authorization: string | undefined, expectedToken: string): boolean => {
	if (!authorization?.startsWith('Bearer ')) return false;
	const provided = Buffer.from(authorization.slice('Bearer '.length), 'utf8');
	const expected = Buffer.from(expectedToken, 'utf8');
	return provided.length === expected.length && timingSafeEqual(provided, expected);
};

const sendEmpty = (response: ServerResponse, statusCode: number): void => {
	response.statusCode = statusCode;
	response.setHeader('Cache-Control', 'no-store');
	response.setHeader('Content-Length', '0');
	response.end();
};

const sendJson = (response: ServerResponse, statusCode: number, value: unknown): void => {
	const body = `${JSON.stringify(value)}\n`;
	response.statusCode = statusCode;
	response.setHeader('Cache-Control', 'no-store');
	response.setHeader('Content-Type', 'application/json; charset=utf-8');
	response.setHeader('Content-Length', String(Buffer.byteLength(body)));
	response.end(body);
};

const readJsonObjectBody = (request: IncomingMessage): Promise<BodyReadResult> =>
	new Promise(resolve => {
		const contentLength = request.headers['content-length'];
		if (typeof contentLength === 'string') {
			const declared = Number(contentLength);
			if (Number.isFinite(declared) && declared > HTTP_MAX_BODY_BYTES) {
				request.resume();
				resolve({ ok: false, statusCode: 413 });
				return;
			}
		}

		const chunks: Buffer[] = [];
		let size = 0;
		let settled = false;

		const cleanup = (): void => {
			request.off('data', onData);
			request.off('end', onEnd);
			request.off('error', onFailure);
			request.off('aborted', onFailure);
		};
		const finish = (result: BodyReadResult): void => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(result);
		};
		const onFailure = (): void => finish({ ok: false, statusCode: 400 });
		const onData = (chunk: Buffer | string): void => {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			size += buffer.length;
			if (size > HTTP_MAX_BODY_BYTES) {
				chunks.length = 0;
				finish({ ok: false, statusCode: 413 });
				request.resume();
				return;
			}
			chunks.push(buffer);
		};
		const onEnd = (): void => {
			try {
				const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
				finish(isObject(parsed) ? { ok: true, value: parsed } : { ok: false, statusCode: 400 });
			} catch {
				finish({ ok: false, statusCode: 400 });
			}
		};

		request.on('data', onData);
		request.once('end', onEnd);
		request.once('error', onFailure);
		request.once('aborted', onFailure);
	});

const listen = (server: Server, port: number, host: string): Promise<void> =>
	new Promise((resolve, reject) => {
		const onError = (error: Error): void => {
			server.off('listening', onListening);
			reject(error);
		};
		const onListening = (): void => {
			server.off('error', onError);
			resolve();
		};
		server.once('error', onError);
		server.once('listening', onListening);
		server.listen(port, host);
	});

const close = (server: Server): Promise<void> =>
	new Promise(resolve => {
		server.close(() => resolve());
	});

export class HttpPreviewServer {
	private readonly version: string;
	private readonly createPreviewNotification: PreviewNotificationHandler;
	private readonly configPath: string;
	private readonly tokenPath: string;
	private readonly bindAddress: string;
	private readonly sockets = new Set<Socket>();
	private server: Server | null = null;
	private startPromise: Promise<void> | null = null;
	private ready = false;
	private configLoaded = false;
	private enabled = false;
	private listening = false;
	private port = DEFAULT_HTTP_PORT;
	private failureReason: string | null = null;

	public constructor(options: HttpPreviewServerOptions) {
		this.version = options.version;
		this.createPreviewNotification = options.createPreviewNotification;
		this.configPath = options.configPath ?? HTTP_CONFIG_PATH;
		this.tokenPath = options.tokenPath ?? HTTP_TOKEN_PATH;
		this.bindAddress = options.bindAddress ?? '0.0.0.0';
	}

	public start(): Promise<void> {
		if (this.server || this.startPromise) return this.startPromise ?? Promise.resolve();
		this.startPromise = this.startOnce()
			.catch(error => this.fail(errorCode(error, 'startup-error')))
			.finally(() => {
				this.startPromise = null;
			});
		return this.startPromise;
	}

	public async stop(): Promise<void> {
		this.ready = false;
		this.listening = false;
		const server = this.server;
		this.server = null;
		if (!server) return;

		for (const socket of this.sockets) socket.destroy();
		this.sockets.clear();
		await close(server).catch(() => undefined);
	}

	public status(): HttpPreviewServerStatus {
		return {
			httpConfigLoaded: this.configLoaded,
			httpEnabled: this.enabled,
			httpListening: this.listening,
			httpPort: this.port,
			httpConfigPath: this.configPath,
			httpFailureReason: this.failureReason,
		};
	}

	private async startOnce(): Promise<void> {
		this.configLoaded = false;
		this.failureReason = null;
		let config: HttpPreviewConfig;
		try {
			config = await this.loadConfig();
		} catch (error) {
			this.fail(errorCode(error, 'config-error'));
			return;
		}

		this.configLoaded = true;
		this.enabled = config.enabled;
		this.port = config.port;
		if (!config.enabled) return;

		let token: string | null;
		try {
			token = await this.readToken();
		} catch (error) {
			this.fail(errorCode(error, 'token-error'));
			return;
		}

		const server = createServer((request, response) => {
			void this.handleRequest(request, response, config, token ?? '').catch(error => {
				console.error(
					'HomeBack HTTP request failed unexpectedly:',
					error instanceof Error ? error.name : 'UnknownError',
				);
				if (!response.headersSent) sendEmpty(response, 500);
				else response.end();
			});
		});
		server.headersTimeout = HTTP_TIMEOUT_MS;
		if ('requestTimeout' in server) server.requestTimeout = HTTP_TIMEOUT_MS;
		server.timeout = HTTP_TIMEOUT_MS;
		server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
		server.maxHeadersCount = 32;
		server.on('connection', socket => {
			this.sockets.add(socket);
			socket.once('close', () => this.sockets.delete(socket));
		});
		server.on('clientError', (_error, socket) => {
			if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
			else socket.destroy();
		});
		server.on('error', error => {
			if (this.server !== server) return;
			this.ready = false;
			this.listening = false;
			this.failureReason = errorCode(error, 'listener-error');
			console.error(`HomeBack HTTP listener stopped (${this.failureReason}).`);
		});

		try {
			await listen(server, config.port, this.bindAddress);
		} catch (error) {
			for (const socket of this.sockets) socket.destroy();
			this.sockets.clear();
			this.fail(errorCode(error, 'listen-error'));
			return;
		}

		if (token === null) {
			token = randomBytes(TOKEN_BYTES).toString('hex');
			try {
				await secureCreateFile(this.tokenPath, token);
			} catch (error) {
				for (const socket of this.sockets) socket.destroy();
				this.sockets.clear();
				await close(server).catch(() => undefined);
				this.fail(errorCode(error, 'token-error'));
				return;
			}
		}

		this.server = server;
		this.ready = true;
		this.listening = true;
		console.log(`HomeBack HTTP Preview listener active on ${this.bindAddress}:${config.port}.`);
	}

	private async loadConfig(): Promise<HttpPreviewConfig> {
		await fs.mkdir(dirname(this.configPath), { recursive: true, mode: 0o700 });
		await fs.chmod(dirname(this.configPath), 0o700);
		try {
			await fs.lstat(this.configPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			try {
				await secureCreateFile(
					this.configPath,
					`${JSON.stringify(defaultConfigFile(), null, 2)}\n`,
				);
			} catch (createError) {
				if ((createError as NodeJS.ErrnoException).code !== 'EEXIST') throw createError;
			}
		}

		const parsed = JSON.parse(await readRegularFile(this.configPath)) as unknown;
		const config = parseHttpPreviewConfig(parsed);
		if (!config) throw new Error('Invalid HomeBack HTTP config.');
		return config;
	}

	private async readToken(): Promise<string | null> {
		let raw: string;
		try {
			raw = await readRegularFile(this.tokenPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
			throw error;
		}
		const token = raw.trim();
		if (!TOKEN_PATTERN.test(token)) throw new Error('Invalid HomeBack HTTP API token.');
		return token;
	}

	private async handleRequest(
		request: IncomingMessage,
		response: ServerResponse,
		config: HttpPreviewConfig,
		token: string,
	): Promise<void> {
		if (!this.ready) {
			request.resume();
			sendEmpty(response, 503);
			return;
		}
		if (!isHttpSourceAllowed(request.socket.remoteAddress, config.allowedSources)) {
			request.resume();
			sendEmpty(response, 403);
			return;
		}
		if (!bearerTokenMatches(request.headers.authorization, token)) {
			request.resume();
			sendEmpty(response, 401);
			return;
		}

		const path = (request.url ?? '/').split('?', 1)[0];
		if (path === '/status') {
			request.resume();
			if (request.method !== 'GET') {
				response.setHeader('Allow', 'GET');
				sendEmpty(response, 405);
				return;
			}
			sendJson(response, 200, { ok: true, version: this.version });
			return;
		}

		if (path !== '/notification/createPreviewToast') {
			request.resume();
			sendEmpty(response, 404);
			return;
		}
		if (request.method !== 'POST') {
			request.resume();
			response.setHeader('Allow', 'POST');
			sendEmpty(response, 405);
			return;
		}
		const contentType = request.headers['content-type'];
		if (
			typeof contentType !== 'string' ||
			contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json'
		) {
			request.resume();
			sendEmpty(response, 415);
			return;
		}

		const body = await readJsonObjectBody(request);
		if (!body.ok) {
			sendEmpty(response, body.statusCode);
			return;
		}

		try {
			const result = await this.createPreviewNotification(body.value as PreviewNotificationRequest);
			sendJson(response, 200, result);
		} catch (error) {
			console.error(
				'HomeBack HTTP preview notification failed:',
				error instanceof Error ? error.name : 'UnknownError',
			);
			sendEmpty(response, 502);
		}
	}

	private fail(reason: string): void {
		this.ready = false;
		this.listening = false;
		this.failureReason = reason;
		console.error(`HomeBack HTTP Preview listener unavailable (${reason}).`);
	}
}
