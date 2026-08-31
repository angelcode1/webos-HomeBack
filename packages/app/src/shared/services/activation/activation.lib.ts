import type { ActivateType, PreviewLaunchPayload } from 'shared/api/common';

export type ActivationAction =
	| { type: 'showPreview'; preview: PreviewLaunchPayload }
	| { type: 'showLauncher' }
	| { type: 'toggleLauncher' }
	| { type: 'none' };

const SHOW_HOME_BACK_INTENT = 'homeback:show';
const PREVIEW_INTENT = 'homeback:preview';

const previewPayload = (activation: ActivateType): PreviewLaunchPayload => {
	const preview = activation.preview;
	return preview && typeof preview === 'object' && !Array.isArray(preview) ? preview : {};
};

export const resolveInitialActivation = (
	activation: ActivateType,
	launchReason?: string,
): ActivationAction => {
	if (activation.intent === PREVIEW_INTENT) {
		return { type: 'showPreview', preview: previewPayload(activation) };
	}
	if (activation.intent === SHOW_HOME_BACK_INTENT || activation.activateType === 'home') {
		return { type: 'showLauncher' };
	}
	if (launchReason === 'preload') return { type: 'none' };
	return { type: 'showLauncher' };
};

export const resolveRelaunchActivation = (activation: ActivateType): ActivationAction => {
	if (activation.intent === PREVIEW_INTENT) {
		return { type: 'showPreview', preview: previewPayload(activation) };
	}
	if (activation.intent === SHOW_HOME_BACK_INTENT || activation.activateType === 'home') {
		return { type: 'toggleLauncher' };
	}
	return { type: 'none' };
};
