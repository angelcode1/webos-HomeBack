import { reaction, type IReactionDisposer } from 'mobx';

import { previewService, PreviewService } from '../features/preview';
import { ribbonService } from '../features/ribbon/services';
import { RibbonService } from '../features/ribbon/services/ribbon/ribbon.service';
import { KeyboardService } from '../features/ribbon/services/keyboard';
import {
	activationService,
	launcherService,
	lifecycleManagerService,
	surfaceService,
} from '../shared/services/services';
import { ActivationService, type ActivationAction } from '../shared/services/activation';
import { LauncherService } from '../shared/services/launcher';
import { LifecycleManagerService } from '../shared/services/lifecycle-manager';
import { SurfaceService } from '../shared/services/surface';
import { keyboardOwnerFor, surfaceVisibleFor, type AppVisibilityState } from './app.lib';

export class AppControllerService {
	private readonly disposers: IReactionDisposer[] = [];
	private readonly unregisterPreviewKeyboard: () => void;

	public constructor(
		private readonly activation: ActivationService,
		private readonly lifecycle: LifecycleManagerService,
		private readonly launcher: LauncherService,
		private readonly surface: SurfaceService,
		private readonly ribbon: RibbonService,
		private readonly preview: PreviewService,
		private readonly keyboard: KeyboardService,
	) {
		this.unregisterPreviewKeyboard = this.keyboard.registerOwner('preview', {
			back: this.preview.dismiss,
		});

		this.disposers.push(
			reaction(
				() => this.visibilityState,
				() => {
					this.syncSurface();
					this.syncKeyboard();
				},
				{ fireImmediately: true },
			),
		);

		this.activation.emitter.on('action', this.handleActivation);
		this.lifecycle.emitter.on('foreignLaunch', this.handleForeignLaunch);
		this.launcher.emitter.on('beforeExternalLaunch', this.handleExternalLaunch);
		this.launcher.emitter.on('beforeSurfaceYield', this.handleSurfaceYield);

		this.handleActivation(this.activation.initialAction);
	}

	public requestLauncherHide(): void {
		this.ribbon.dismissFeatures();
		this.syncSurface();
		this.syncKeyboard();
	}

	public dismissFeatures(): void {
		this.ribbon.dismissFeatures();
		this.preview.dismiss();
		this.syncSurface();
		this.syncKeyboard();
	}

	public async yieldSurfaceAndWait(): Promise<void> {
		this.dismissFeatures();
		await this.surface.waitUntilHidden();
	}

	public dispose(): void {
		for (const dispose of this.disposers) dispose();
		this.disposers.length = 0;
		this.unregisterPreviewKeyboard();
		this.activation.emitter.off('action', this.handleActivation);
		this.lifecycle.emitter.off('foreignLaunch', this.handleForeignLaunch);
		this.launcher.emitter.off('beforeExternalLaunch', this.handleExternalLaunch);
		this.launcher.emitter.off('beforeSurfaceYield', this.handleSurfaceYield);
		this.keyboard.unsubscribe();
	}

	private get visibilityState(): AppVisibilityState {
		return {
			ribbonVisible: this.ribbon.visible,
			drawerVisible: this.ribbon.appDrawerService.visible,
			keypadVisible: this.ribbon.numericKeypadVisible,
			previewVisible: this.preview.visible,
		};
	}

	private syncSurface(): void {
		this.surface.requestVisible(surfaceVisibleFor(this.visibilityState));
	}

	private syncKeyboard(): void {
		const owner = keyboardOwnerFor(this.visibilityState);
		if (!owner) {
			this.keyboard.unsubscribe();
			return;
		}

		this.keyboard.subscribe(document, true);
		this.keyboard.setOwner(owner);
	}

	private readonly handleActivation = (action: ActivationAction): void => {
		switch (action.type) {
			case 'showPreview':
				this.preview.show(action.preview);
				break;

			case 'showLauncher':
				this.preview.dismiss();
				this.ribbon.show();
				break;

			case 'toggleLauncher':
				this.preview.dismiss();
				this.ribbon.toggle();
				break;

			case 'none':
				break;
		}
	};

	private readonly handleForeignLaunch = (): void => {
		this.dismissFeatures();
	};

	private readonly handleExternalLaunch = (): void => {
		this.dismissFeatures();
	};

	private readonly handleSurfaceYield = (): void => {
		this.dismissFeatures();
	};
}

export const appControllerService = new AppControllerService(
	activationService,
	lifecycleManagerService,
	launcherService,
	surfaceService,
	ribbonService,
	previewService,
	ribbonService.keyboardService,
);
