export class AsyncSink<T> implements AsyncIterableIterator<T> {
	private readonly values: T[] = [];
	private readonly waiters: Array<{
		resolve: (result: IteratorResult<T>) => void;
		reject: (error: unknown) => void;
	}> = [];
	private closed = false;
	private error: unknown = null;

	public [Symbol.asyncIterator](): AsyncIterableIterator<T> {
		return this;
	}

	public push(value: T): void {
		if (this.closed) return;

		const waiter = this.waiters.shift();
		if (waiter) {
			waiter.resolve({ done: false, value });
			return;
		}

		this.values.push(value);
	}

	public fail(error: unknown): void {
		if (this.closed) return;
		this.error = error;
		this.closed = true;

		for (const waiter of this.waiters.splice(0)) waiter.reject(error);
	}

	public next(): Promise<IteratorResult<T>> {
		if (this.values.length > 0) {
			return Promise.resolve({ done: false, value: this.values.shift()! });
		}

		if (this.error !== null) return Promise.reject(this.error);
		if (this.closed) return Promise.resolve({ done: true, value: undefined });

		return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
	}

	public close(): void {
		if (this.closed) return;
		this.closed = true;

		for (const waiter of this.waiters.splice(0)) {
			waiter.resolve({ done: true, value: undefined });
		}
	}

	public return(): Promise<IteratorResult<T>> {
		this.close();
		return Promise.resolve({ done: true, value: undefined });
	}
}
