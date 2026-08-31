export const LUNA_TOPIC_RETRY_BASE_MS = 500;
export const LUNA_TOPIC_RETRY_MAX_MS = 8_000;

type LunaSubscriptionStatus = {
	returnValue?: unknown;
	subscribed?: unknown;
};

export const shouldRetryLunaTopic = (message: LunaSubscriptionStatus): boolean =>
	message.returnValue === false || message.subscribed === false;

export class LunaTopicRetryController {
	private attempt = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private readonly retry: () => void;

	public constructor(retry: () => void) {
		this.retry = retry;
	}

	public failed(): void {
		if (this.timer) return;

		const delay = Math.min(
			LUNA_TOPIC_RETRY_BASE_MS * 2 ** this.attempt,
			LUNA_TOPIC_RETRY_MAX_MS,
		);
		if (delay < LUNA_TOPIC_RETRY_MAX_MS) this.attempt += 1;

		this.timer = setTimeout(() => {
			this.timer = null;
			this.retry();
		}, delay);
	}

	public succeeded(): void {
		this.attempt = 0;
	}
}
