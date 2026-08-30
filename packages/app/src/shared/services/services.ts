import { ActivationService } from './activation';
import { CameraService, NotificationCameraProvider } from './camera';
import { KeyboardService } from './keyboard';
import { LauncherService } from './launcher/model/launcher.service';
import { AppManagerProvider } from './launcher/providers/app-manager/app-manager.provider';
import { InputProvider } from './launcher/providers/input-manager/input-manager.provider';
import { InternalProvider } from './launcher/providers/internal/internal.provider';
import { SettingsService } from './settings';
import { SurfaceService } from './surface';
import { SystemInfoService } from './system-info';

export const systemInfoService = new SystemInfoService();
export const settingsService = new SettingsService();
export const activationService = new ActivationService();
export const surfaceService = new SurfaceService(
	systemInfoService,
	activationService.initialAction.type === 'none',
);
export const keyboardService = new KeyboardService();
export const notificationCameraProvider = new NotificationCameraProvider();
export const cameraService = new CameraService([notificationCameraProvider]);

export const launchPointProviders = [
	new InputProvider(),
	new AppManagerProvider(),
	new InternalProvider(cameraService),
];

export const launcherService = new LauncherService(
	settingsService,
	surfaceService,
	launchPointProviders,
);
