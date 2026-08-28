import { comparer, makeAutoObservable, reaction, toJS } from 'mobx';

const KEY = 'homeback:settings';
const LEGACY_KEY = 'althome:settings';
const MIN_WHEEL_FACTOR = 0.1;
const MAX_WHEEL_FACTOR = 8;

type SettingsSnapshot = {
	wheelVelocityFactor: number;
	order: string[];
};

const clampWheelFactor = (value: number): number =>
	Math.min(MAX_WHEEL_FACTOR, Math.max(MIN_WHEEL_FACTOR, value));

export class SettingsService {
	public wheelVelocityFactor = 1.5;
	public order: string[] = [];

	public constructor() {
		this.hydrate();
		makeAutoObservable(this, {}, { autoBind: true });
		reaction(() => this.serialized, this.saveConfig, { equals: comparer.structural });
	}

	private saveConfig(serialized: SettingsSnapshot): void {
		try {
			localStorage.setItem(KEY, JSON.stringify(serialized));
		} catch (error) {
			console.error('Unable to persist HomeBack settings:', error);
		}
	}

	private get serialized(): SettingsSnapshot {
		return toJS({
			wheelVelocityFactor: this.wheelVelocityFactor,
			order: this.order,
		});
	}

	private hydrate(): void {
		let parsed: unknown;
		let migrated = false;

		try {
			const current = localStorage.getItem(KEY);
			const serialized = current ?? localStorage.getItem(LEGACY_KEY) ?? '{}';
			migrated = current === null && serialized !== '{}';
			parsed = JSON.parse(serialized);
		} catch (error) {
			console.warn('Ignoring invalid HomeBack settings JSON:', error);
			return;
		}

		if (!parsed || typeof parsed !== 'object') return;
		const value = parsed as Record<string, unknown>;

		if (
			typeof value.wheelVelocityFactor === 'number' &&
			Number.isFinite(value.wheelVelocityFactor)
		) {
			this.wheelVelocityFactor = clampWheelFactor(value.wheelVelocityFactor);
		}

		if (Array.isArray(value.order) && value.order.every(item => typeof item === 'string')) {
			this.order = [...new Set(value.order)];
		}

		if (migrated) this.saveConfig(this.serialized);
	}
}
