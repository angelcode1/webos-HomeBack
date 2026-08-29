import mitt from 'mitt';

import {
	Intent,
	parseActivateType,
	type ActivateType,
	type PreviewLaunchPayload,
} from 'shared/api/common';

import type {
	ActivationAction,
	ActivationEvents,
	PreviewRequest,
} from '../api/activation.interface';

const MAX_PREVIEW_TITLE_LENGTH = 120;

const parsePreviewUrl = (value: unknown): string | null => {
	if (typeof value !== 'string' || value.length === 0) return null;
	try {
		const parsed = new URL(value);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:'
			? parsed.toString()
			: null;
	} catch {
		return null;
	}
};

export const parsePreviewRequest = (
	payload: PreviewLaunchPayload | undefined,
): PreviewRequest | null => {
	if (!payload || payload.interactive !== true) return null;
	const url = parsePreviewUrl(payload.url);
	if (!url) return null;

	const title = typeof payload.title === 'string'
		? payload.title.trim().slice(0, MAX_PREVIEW_TITLE_LENGTH)
		: '';
	const durationMs = typeof payload.durationMs === 'number' && Number.isFinite(payload.durationMs)
		? payload.durationMs
		: undefined;

	return {
		url,
		...(title ? { title } : {}),
		...(durationMs !== undefined ? { durationMs } : {}),
		interactive: true,
	};
};

export const activationActionFrom = (
	activation: ActivateType,
	launchReason: string | undefined,
	cold: boolean,
): ActivationAction => {
	if (activation.intent === Intent.Preview) {
		const preview = parsePreviewRequest(activation.preview);
		return preview ? { type: 'showPreview', preview } : { type: 'none' };
	}

	if (activation.intent === Intent.ShowHomeBack || activation.activateType === 'home') {
		return cold ? { type: 'showLauncher' } : { type: 'toggleLauncher' };
	}

	if (cold && launchReason === 'preload') return { type: 'none' };
	return cold ? { type: 'showLauncher' } : { type: 'none' };
};

export class ActivationService {
	public readonly emitter = mitt<ActivationEvents>();
	public readonly initialAction: ActivationAction;

	public constructor() {
		this.initialAction = activationActionFrom(
			parseActivateType(webOSSystem.launchParams),
			webOSSystem.launchReason,
			true,
		);
		document.addEventListener('webOSRelaunch', this.handleRelaunch);
	}

	public dispose(): void {
		document.removeEventListener('webOSRelaunch', this.handleRelaunch);
	}

	private readonly handleRelaunch = (event: CustomEvent<ActivateType>): void => {
		this.emitter.emit('action', activationActionFrom(event.detail ?? {}, webOSSystem.launchReason, false));
	};
}
