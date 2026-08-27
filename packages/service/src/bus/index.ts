import palmbus from 'palmbus';

import { AsyncSink } from '@althome/utils';

import { SERVICE_ID } from '../environment';
import { Message } from './message';
import { extractMethodPath } from './path';

const DEFAULT_ONESHOT_TIMEOUT_MS = 10_000;

type Executor<T, N extends Record<string, any>> = (body: T) => AsyncGenerator<N>;
type SimpleExecutor<T, N extends Record<string, any>> = (body: T) => Promise<N> | N;

export class ServiceError extends Error {
	public constructor(
		message: string,
		public readonly errorCode = -1,
	) {
		super(message);
		Object.setPrototypeOf(this, ServiceError.prototype);
	}
}

export class Service {
	private readonly handle: palmbus.Handle;
	private readonly methods = new Map<string, Executor<any, any>>();

	public constructor(serviceId = SERVICE_ID) {
		this.handle = new palmbus.Handle(serviceId);
		this.handle.addListener('request', this.handleRequest.bind(this));

		// @invariant: palmbus-keepalive
		// LG TV's native palmbus Handle does not keep the Node event loop referenced
		// while LS2 is still activating a dynamic service.
		setTimeout(() => undefined, 10_000);
	}

	public register<T, N extends Record<string, any> = Record<string, any>>(
		method: string,
		executor: Executor<T, N>,
	): void {
		this.handle.registerMethod(...extractMethodPath(method));
		this.methods.set(method, executor);
	}

	public registerSimple<T = Record<string, never>, N extends Record<string, any> = Record<string, any>>(
		method: string,
		executor: SimpleExecutor<T, N>,
	): void {
		this.register<T, N>(method, async function* simpleExecutor(body: T) {
			return await executor(body);
		});
	}

	public async *subscribe<T extends Record<string, any>>(
		uri: string,
		params: Record<string, any> = {},
	): AsyncGenerator<T, void> {
		const sink = new AsyncSink<T>();
		const subscription = this.handle.subscribe(uri, JSON.stringify({ ...params, subscribe: true }));

		subscription.addListener('response', pMessage => {
			try {
				sink.push(Message.fromPalmMessage<T>(pMessage).payload);
			} catch (error) {
				sink.fail(error);
			}
		});

		try {
			for await (const value of sink) yield value;
		} finally {
			sink.close();
			subscription.cancel();
		}
	}

	public async oneshot<T extends Record<string, any>>(
		uri: string,
		params: Record<string, any> = {},
		timeoutMs = DEFAULT_ONESHOT_TIMEOUT_MS,
	): Promise<T> {
		const generator = this.subscribe<T>(uri, params);
		let timeout: NodeJS.Timeout | null = null;

		try {
			const result = await Promise.race([
				generator.next(),
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(
						() => reject(new Error(`Luna request timed out after ${timeoutMs}ms: ${uri}`)),
						timeoutMs,
					);
				}),
			]);

			if (result.done || !result.value) throw new Error(`No response from ${uri}`);
			if (result.value.returnValue === false) {
				throw new Error(result.value.errorText ?? `Luna call failed: ${uri}`);
			}
			return result.value;
		} finally {
			if (timeout) clearTimeout(timeout);
			await generator.return();
		}
	}

	private handleRequest(pMessage: palmbus.Message): void {
		const message = Message.fromPalmMessage(pMessage);

		Promise.resolve()
			.then(() => message.payload)
			.then(async body => {
				const impl = this.methods.get(message.method);
				if (!impl) throw new ServiceError(`Unregistered method: ${message.method}`, -404);
				return this.drainExecutor(impl(body), message);
			})
			.catch(error => {
				console.error('Failed to handle message:', error);
				message.respond({
					returnValue: false,
					errorCode: error instanceof ServiceError ? error.errorCode : -1,
					errorText: error instanceof Error ? error.message : String(error),
				});
			});
	}

	private async drainExecutor(
		generator: ReturnType<Executor<any, any>>,
		message: Message<any>,
	): Promise<void> {
		let result: IteratorResult<any>;

		do {
			result = await generator.next();
			if (message.isSubscription || result.done) {
				message.respond({ returnValue: true, ...result.value });
			}
		} while (!result.done);
	}
}
