import { reaction } from 'mobx';

import { previewService } from '../features/preview';
import { ribbonService } from '../features/ribbon/services';
import { selectKeyboardOwner } from '../shared/services/keyboard';
import {
	activationService,
	keyboardService,
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

		activationService.emitter.on('foreignLaunch', () => {
			// A focus-owning preview must never cover a newly launched app that the
			// user can no longer drive. Foreign launch/splash dismisses all features.
			surfaceService.dismissFeatures();
		});
	}
}

export const appController = new AppController();
