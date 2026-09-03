export const LAUNCHER_PROVIDER_WARNING_GRACE_MS = 10_000;

export class LauncherProviderWarningGate {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private visible = false;

	public constructor(
		private readonly onChange: (visible: boolean) => void,
		private readonly graceMs = LAUNCHER_PROVIDER_WARNING_GRACE_MS,
	) {}

	public update(errorCount: number): void {
		if (errorCount <= 0) {
			this.clearTimer();
			if (this.visible) {
				this.visible = false;
				this.onChange(false);
			}
			return;
		}

		if (this.visible || this.timer) return;

		this.timer = setTimeout(() => {
			this.timer = null;
			this.visible = true;
			this.onChange(true);
		}, this.graceMs);
	}

	public dispose(): void {
		this.clearTimer();
	}

	private clearTimer(): void {
		if (!this.timer) return;
		clearTimeout(this.timer);
		this.timer = null;
	}
}
