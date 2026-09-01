import { Intent, type ActivateType, type PreviewLaunchPayload } from 'shared/api/common';

export type ActivationAction =
	| { type: 'showPreview'; preview: PreviewLaunchPayload }
	| { type: 'showLauncher' }
	| { type: 'toggleLauncher' }
	| { type: 'none' };

const previewPayload = (activation: ActivateType): PreviewLaunchPayload => {
	const preview = activation.preview;
	return preview && typeof preview === 'object' && !Array.isArray(preview) ? preview : {};
};

export const resolveInitialActivation = (
	activation: ActivateType,
	launchReason?: string,
): ActivationAction => {
	if (activation.intent === Intent.Preview) {
		return { type: 'showPreview', preview: previewPayload(activation) };
	}
	if (activation.intent === Intent.ShowHomeBack || activation.activateType === 'home') {
		return { type: 'showLauncher' };
	}
	if (launchReason === 'preload') return { type: 'none' };
	return { type: 'showLauncher' };
};

export const resolveRelaunchActivation = (activation: ActivateType): ActivationAction => {
	if (activation.intent === Intent.Preview) {
		return { type: 'showPreview', preview: previewPayload(activation) };
	}
	if (activation.intent === Intent.ShowHomeBack || activation.activateType === 'home') {
		return { type: 'toggleLauncher' };
	}
	return { type: 'none' };
};
