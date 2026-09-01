import { reaction } from 'mobx';

import {
	activationService,
	keyboardService,
	launcherService,
	settingsService,
	surfaceService,
} from 'shared/services/services';

import { AppDrawerService } from '../app-drawer';
import { ScrollService } from '../scroll';
import { RemoteHealthService } from './remote-health.service';
import { RibbonService } from './ribbon.service';

const scrollService = new ScrollService(settingsService);
const appDrawerService = new AppDrawerService(launcherService, keyboardService);
const remoteHealthService = new RemoteHealthService();

export const ribbonService = new RibbonService(
	launcherService,
	scrollService,
	appDrawerService,
	activationService,
	surfaceService,
	keyboardService,
	remoteHealthService,
);

reaction(
	() => ribbonService.visible,
	visible => console.warn(`[HomeBackRibbon] visible=${visible}`),
	{ fireImmediately: true },
);

export const useRibbonService = (): RibbonService => ribbonService;
