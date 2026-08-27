import {
	launcherService,
	lifecycleManagerService,
	settingsService,
} from 'shared/services/services';

import { AppDrawerService } from '../app-drawer';
import { KeyboardService } from '../keyboard';
import { ScrollService } from '../scroll';
import { RibbonService } from './ribbon.service';

const ribbonKeyboardService = new KeyboardService();
const drawerKeyboardService = new KeyboardService();
const scrollService = new ScrollService(settingsService);
const appDrawerService = new AppDrawerService(launcherService, drawerKeyboardService);

export const ribbonService = new RibbonService(
	launcherService,
	scrollService,
	appDrawerService,
	lifecycleManagerService,
	ribbonKeyboardService,
);

export const useRibbonService = (): RibbonService => ribbonService;
