import { reaction } from 'mobx';

import { previewService } from '../features/preview';
import { ribbonService } from '../features/ribbon/services';
import { cameraToPreviewPayload } from '../shared/services/camera';
import { selectKeyboardOwner } from '../shared/services/keyboard';
import {
	activationService,
	cameraService,
	keyboardService,
	launcherService,
	surfaceService,
} from '../shared/services/services';

class AppController {
	public constructor() {
		reaction(
			() => [
				ribbonService.numericKeypadVisible,
				ribbonService.appDrawerService.visible,
				ribbonService.visible,
				previewService.visible,
			] as const,
			([keypad, drawer, ribbon, preview]) => {
				const owner = selectKeyboardOwner({ keypad, drawer, ribbon, preview });
				if (!owner) {
					keyboardService.unsubscribe();
					return;
				}

				keyboardService.setOwner(owner);
				keyboardService.subscribe(document, true);
			},
			{ fireImmediately: true },
		);

		reaction(
			() => ribbonService.visible,
			visible => {
				if (visible) void cameraService.refresh();
			},
			{ fireImmediately: true },
		);

		launcherService.emitter.on('openCameras', this.openCameras);
		activationService.emitter.on('foreignLaunch', () => {
			// A focus-owning preview must never cover a newly launched app that the
			// user can no longer drive. Foreign launch/splash dismisses all features.
			surfaceService.dismissFeatures();
		});
	}

	private readonly openCameras = async (): Promise<void> => {
		await cameraService.refresh();
		const camera = cameraService.cameras[0];
		if (!camera) {
			console.warn('[HomeBackCamera] no recent camera');
			return;
		}

		const payload = cameraToPreviewPayload(camera);
		// Keep the shared surface continuously requested during the ribbon ->
		// preview handoff. Showing first avoids scheduling an unnecessary hide.
		previewService.show(payload);
		ribbonService.hide();
	};
}

export const appController = new AppController();
