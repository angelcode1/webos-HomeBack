import { makeAutoObservable, reaction, toJS } from 'mobx';

import type { LunaRequestParams } from '../api/luna.api';
import { LunaTopicRetryController, shouldRetryLunaTopic } from './luna-topic-retry.lib';

const DEFAULT_TIMEOUT_MS = 10_000;

export class LunaError extends Error {
	public constructor(
		message: string,
		public readonly errorCode?: number,
		public readonly response?: Record<string, unknown>,
	) {
		super(message);
		Object.setPrototypeOf(this, LunaError.prototype);
	}
}

export class LunaTopic<T extends Record<string, any>, P extends LunaRequestParams = {}> {
	public message: T | null = null;
	private bridge: PalmServiceBridge | null = null;
	private readonly retryController: LunaTopicRetryController;

	public constructor(
		private readonly uri: string,
		private readonly params?: P,
	) {
		makeAutoObservable<LunaTopic<T, P>, 'bridge' | 'retryController' | 'uri' | 'params'>(
			this,
			{ bridge: false, retryController: false, uri: false, params: false },
			{ autoBind: true },
		);

		this.retryController = new LunaTopicRetryController(this.subscribe);
		this.subscribe();

		if (__DEV__) {
			console.log('<!>', uri);
			reaction(() => this.message, message => console.log('<*-', uri, toJS(message)));
		}
	}

	private subscribe(): void {
		const bridge = new PalmServiceBridge();
		this.bridge = bridge;
		bridge.onservicecallback = this.handleCallback;
		bridge.call(this.uri, JSON.stringify({ ...this.params, subscribe: true }));
	}

	private handleCallback(serialized: string): void {
		let message: T;
		try {
			message = JSON.parse(serialized) as T;
		} catch (error) {
			console.error(`Invalid Luna subscription response from ${this.uri}:`, error);
			return;
		}

		this.message = message;
		if (shouldRetryLunaTopic(message)) {
			this.releaseBridge();
			this.retryController.failed();
			return;
		}

		this.retryController.succeeded();
	}

	private releaseBridge(): void {
		const bridge = this.bridge;
		if (!bridge) return;
		bridge.onservicecallback = () => undefined;
		bridge.cancel();
		this.bridge = null;
	}
}

class LunaOneShot<T extends Record<string, any>, P extends LunaRequestParams = {}> {
	private bridge: PalmServiceBridge | null = new PalmServiceBridge();

	public constructor(
		public readonly uri: string,
		public readonly params?: P,
	) {}

	public call(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const bridge = this.bridge;
			if (!bridge) {
				reject(new Error(`Luna bridge already released: ${this.uri}`));
				return;
			}

			let settled = false;

			const cleanup = (): void => {
				bridge.onservicecallback = () => undefined;
				bridge.cancel();
				this.bridge = null;
			};

			const timeout = setTimeout(() => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(new Error(`Luna request timed out after ${timeoutMs}ms: ${this.uri}`));
			}, timeoutMs);

			bridge.onservicecallback = (message: string) => {
				if (settled) return;

				let parsed: Record<string, any>;
				try {
					parsed = JSON.parse(message) as Record<string, any>;
				} catch (error) {
					settled = true;
					clearTimeout(timeout);
					cleanup();
					reject(error);
					return;
				}

				if (__DEV__) console.log('<--', this.uri, parsed);

				settled = true;
				clearTimeout(timeout);
				cleanup();

				if (parsed.errorCode || !parsed.returnValue) {
					reject(
						new LunaError(
							parsed.errorText ?? `Luna call failed: ${this.uri}`,
							typeof parsed.errorCode === 'number' ? parsed.errorCode : undefined,
							parsed,
						),
					);
					return;
				}

				resolve(parsed as T);
			};

			if (__DEV__) console.log('-->', this.uri, this.params);
			bridge.call(this.uri, JSON.stringify(this.params ?? {}));
		});
	}
}

export const luna = <
	T extends Record<string, any>,
	P extends LunaRequestParams = {},
>(
	uri: string,
	params?: P,
): Promise<T> => new LunaOneShot<T, P>(uri, params).call();
