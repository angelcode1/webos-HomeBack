import { reaction } from 'mobx';

import { previewService } from '../features/preview';
import { ribbonService } from '../features/ribbon/services';
import { selectKeyboardOwner } from '../shared/services/keyboard';
import { luna } from '../shared/services/luna';
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

		// Camera PiP is an explicit user action. Fully yield HomeBack's floating
		// ribbon before asking the root helper to preserve the underlying CARD as
		// Multi View main and launch the separate camera CARD as PiP sub.
		await surfaceService.yieldSurfaceAndWait();
		try {
			await luna(`luna://${process.env.SERVICE_ID}/cameras/open`, {
				cameraId: camera.cameraId,
			});
		} catch (error) {
			console.error('[HomeBackCamera] unable to open camera PiP:', error);
		}
	};
}

export const appController = new AppController();
