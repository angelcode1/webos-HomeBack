export type PendingMerge<T> = (current: T, incoming: T) => T;

/**
 * Serializes repeated requests onto one drain promise while coalescing work
 * requested during an in-flight run. Every caller waits until the queue is
 * fully drained, not merely until the run that happened to be active when it
 * called request().
 */
export class CoalescedTask<T> {
	private promise: Promise<void> | null = null;
	private hasPending = false;
	private pendingValue!: T;
	private readonly runTask: (value: T) => Promise<void>;
	private readonly mergePending: PendingMerge<T>;

	public constructor(
		runTask: (value: T) => Promise<void>,
		mergePending: PendingMerge<T>,
	) {
		this.runTask = runTask;
		this.mergePending = mergePending;
	}

	public request(value: T): Promise<void> {
		if (this.hasPending) {
			this.pendingValue = this.mergePending(this.pendingValue, value);
		} else {
			this.pendingValue = value;
			this.hasPending = true;
		}

		if (!this.promise) this.promise = this.drain();
		return this.promise;
	}

	private async drain(): Promise<void> {
		try {
			while (this.hasPending) {
				const value = this.pendingValue;
				this.hasPending = false;
				await this.runTask(value);
			}
		} finally {
			// Clear synchronously before the drain promise settles. A request that
			// arrives after this point starts a fresh drain instead of attaching to
			// an already-completed worker and leaving pending work stranded.
			this.promise = null;
		}
	}
}
