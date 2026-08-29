export type PreviewRequest = {
	url: string;
	title?: string;
	durationMs?: number;
	interactive: true;
};

export type ActivationAction =
	| { type: 'showPreview'; preview: PreviewRequest }
	| { type: 'showLauncher' }
	| { type: 'toggleLauncher' }
	| { type: 'none' };

export type ActivationEvents = {
	action: ActivationAction;
};
