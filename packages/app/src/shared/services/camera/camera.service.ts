import { makeAutoObservable } from 'mobx';

import { luna } from '../luna';
import type { CameraEntry } from './camera.lib';

export interface CameraProvider {
	readonly cameras: CameraEntry[];
	refresh(): Promise<void>;
}

type CameraListResponse = {
	returnValue: true;
	cameras: CameraEntry[];
};

const validCameraEntry = (value: unknown): value is CameraEntry => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const camera = value as Partial<CameraEntry>;
	return typeof camera.cameraId === 'string' &&
		typeof camera.title === 'string' &&
		(camera.message === null || typeof camera.message === 'string') &&
		typeof camera.imageUrl === 'string' &&
		typeof camera.durationMs === 'number' &&
		Number.isFinite(camera.durationMs) &&
		typeof camera.receivedAt === 'number' &&
		Number.isFinite(camera.receivedAt) &&
		typeof camera.expiresAt === 'number' &&
		Number.isFinite(camera.expiresAt);
};

export class NotificationCameraProvider implements CameraProvider {
	public cameras: CameraEntry[] = [];
	private expiryTimer: ReturnType<typeof setTimeout> | null = null;

	public constructor() {
		makeAutoObservable<NotificationCameraProvider, 'expiryTimer'>(
			this,
			{ expiryTimer: false },
			{ autoBind: true },
		);
	}

	public async refresh(): Promise<void> {
		const response = await luna<CameraListResponse>(
			`luna://${process.env.SERVICE_ID}/cameras/list`,
			{},
		);
		this.cameras = response.cameras.filter(validCameraEntry);
		this.pruneExpiredAndSchedule();
	}

	public dispose(): void {
		if (this.expiryTimer) clearTimeout(this.expiryTimer);
		this.expiryTimer = null;
	}

	private pruneExpiredAndSchedule(): void {
		if (this.expiryTimer) clearTimeout(this.expiryTimer);
		this.expiryTimer = null;

		const now = Date.now();
		this.cameras = this.cameras.filter(camera => camera.expiresAt > now);
		const nextExpiry = this.cameras.reduce<number | null>(
			(earliest, camera) => earliest === null || camera.expiresAt < earliest
				? camera.expiresAt
				: earliest,
			null,
		);
		if (nextExpiry === null) return;

		this.expiryTimer = setTimeout(
			this.pruneExpiredAndSchedule,
			Math.max(1, nextExpiry - now + 1),
		);
	}
}

export class CameraService {
	public constructor(private readonly providers: CameraProvider[]) {
		makeAutoObservable<CameraService, 'providers'>(
			this,
			{ providers: false },
			{ autoBind: true },
		);
		void this.refresh();
	}

	public get cameras(): CameraEntry[] {
		const byId = new Map<string, CameraEntry>();
		for (const camera of this.providers.flatMap(provider => provider.cameras)) {
			const existing = byId.get(camera.cameraId);
			if (!existing || camera.receivedAt > existing.receivedAt) {
				byId.set(camera.cameraId, camera);
			}
		}
		return [...byId.values()].sort((left, right) => right.receivedAt - left.receivedAt);
	}

	public async refresh(): Promise<void> {
		await Promise.all(this.providers.map(async provider => {
			try {
				await provider.refresh();
			} catch (error) {
				console.warn('[HomeBackCamera] provider refresh failed', error);
			}
		}));
	}
}
