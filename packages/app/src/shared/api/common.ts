export const Intent = {
	ShowHomeBack: 'homeback:show',
	Preview: 'homeback:preview',
} as const;

export type Intent = typeof Intent[keyof typeof Intent];

export interface PreviewLaunchPayload {
	title?: string;
	message?: string;
	imageUrl?: string;
	durationMs?: number;
	interactive?: boolean;
}

export interface ActivateType {
	activateType?: 'home' | string;
	intent?: Intent | string;
	preview?: PreviewLaunchPayload;
}

export const APPLICATION_MANAGER_URI = 'luna://com.webos.service.applicationManager';

export const parseActivateType = (serialized: string): ActivateType => {
	if (!serialized) return {};
	try {
		const parsed = JSON.parse(serialized) as unknown;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? parsed as ActivateType
			: {};
	} catch {
		return {};
	}
};
