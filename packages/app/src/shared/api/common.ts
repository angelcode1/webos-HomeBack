export const Intent = {
	ShowHomeBack: 'homeback:show',
	PreviewInputProbe: 'homeback:preview',
} as const;

export type Intent = typeof Intent[keyof typeof Intent];

export interface ActivateType {
	activateType?: 'home' | string;
	intent?: Intent | string;
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
