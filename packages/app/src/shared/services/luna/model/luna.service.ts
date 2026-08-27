import { makeAutoObservable, reaction, toJS } from 'mobx';

import type { LunaRequestParams } from '../api/luna.api';

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
	private bridge!: PalmServiceBridge;

	public constructor(
		private readonly uri: string,
		private readonly params?: P,
	) {
		makeAutoObservable<LunaTopic<T, P>, 'bridge' | 'uri' | 'params'>(
			this,
			{ bridge: false, uri: false, params: false },
			{ autoBind: true },
		);

		this.subscribe();

		if (__DEV__) {
			console.log('<!>', uri);
			reaction(() => this.message, message => console.log('<*-', uri, toJS(message)));
		}
	}

	private subscribe(): void {
		this.bridge = new PalmServiceBridge();
		this.bridge.onservicecallback = this.handleCallback;
		this.bridge.call(this.uri, JSON.stringify({ ...this.params, subscribe: true }));
	}

	private handleCallback(serialized: string): void {
		try {
			this.message = JSON.parse(serialized) as T;
		} catch (error) {
			console.error(`Invalid Luna subscription response from ${this.uri}:`, error);
		}
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
