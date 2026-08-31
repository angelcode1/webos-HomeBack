import {
	activationService,
	keyboardService,
	surfaceService,
} from 'shared/services/services';

import { PreviewService } from './preview.service';

export const previewService = new PreviewService(
	activationService,
	surfaceService,
	keyboardService,
);

export const usePreviewService = (): PreviewService => previewService;
