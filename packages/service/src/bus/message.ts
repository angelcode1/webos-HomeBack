import type palmbus from 'palmbus';

import { joinMethodPath } from './path';

export class Message<T extends Record<string, any>> {
	private parsedPayload: T | null = null;

	protected constructor(private readonly pMessage: palmbus.Message) {}

	public get method(): string {
		return joinMethodPath(this.pMessage.category(), this.pMessage.method());
	}

	public get isSubscription(): boolean {
		return this.pMessage.isSubscription();
	}

	public get payload(): T {
		if (this.parsedPayload === null) this.parsedPayload = JSON.parse(this.pMessage.payload()) as T;
		return this.parsedPayload;
	}

	public respond(message: Record<string, any>): void {
		this.pMessage.respond(JSON.stringify(message));
	}

	public static fromPalmMessage<T extends Record<string, any> = Record<string, any>>(
		pMessage: palmbus.Message,
	): Message<T> {
		return new Message<T>(pMessage);
	}
}
