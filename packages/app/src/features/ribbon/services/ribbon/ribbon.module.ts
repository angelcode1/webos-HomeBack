import {
	launcherService,
	lifecycleManagerService,
	settingsService,
} from 'shared/services/services';

import { AppDrawerService } from '../app-drawer';
import { KeyboardService } from '../keyboard';
import { ScrollService } from '../scroll';
import { RibbonService } from './ribbon.service';

const keyboardService = new KeyboardService();
const scrollService = new ScrollService(settingsService);
const appDrawerService = new AppDrawerService(launcherService, keyboardService);

export const ribbonService = new RibbonService(
	launcherService,
	scrollService,
	appDrawerService,
	lifecycleManagerService,
	keyboardService,
);

export const useRibbonService = (): RibbonService => ribbonService;
