import { LauncherService } from './launcher/model/launcher.service';
import { AppManagerProvider } from './launcher/providers/app-manager/app-manager.provider';
import { InputProvider } from './launcher/providers/input-manager/input-manager.provider';
import { InternalProvider } from './launcher/providers/internal/internal.provider';
import { LifecycleManagerService } from './lifecycle-manager';
import { SettingsService } from './settings';
import { SystemInfoService } from './system-info';

export const systemInfoService = new SystemInfoService();
export const settingsService = new SettingsService();
export const lifecycleManagerService = new LifecycleManagerService(systemInfoService);

export const launchPointProviders = [
	new InputProvider(),
	new AppManagerProvider(),
	new InternalProvider(),
];

export const launcherService = new LauncherService(
	settingsService,
	lifecycleManagerService,
	launchPointProviders,
);
