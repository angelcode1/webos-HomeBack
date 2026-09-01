import {
	APPLICATION_MANAGER_URI,
	HOME_BACK_PREVIEW_INTENT,
	HOME_BACK_SHOW_INTENT,
} from '@homeback/utils';

export const Intent = {
	ShowHomeBack: HOME_BACK_SHOW_INTENT,
	Preview: HOME_BACK_PREVIEW_INTENT,
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

export { APPLICATION_MANAGER_URI };

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
