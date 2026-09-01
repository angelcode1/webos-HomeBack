import type {
	NotificationToastRequest,
	PreviewNotificationRequest,
	PreviewNotificationState,
} from './notification';

export type PreviewNotificationResult = {
	done: true;
	suppressed: boolean;
	cameraRegistered: boolean;
};

export type PreviewToastSender = (toast: NotificationToastRequest) => Promise<unknown>;
export type PreviewToastBuilder = (
	request: PreviewNotificationRequest,
	sourceId: string,
) => NotificationToastRequest;

export class PreviewNotificationService {
	private readonly state: PreviewNotificationState;
	private readonly sourceId: string;
	private readonly sendToast: PreviewToastSender;
	private readonly buildToast: PreviewToastBuilder;

	public constructor(
		state: PreviewNotificationState,
		sourceId: string,
		sendToast: PreviewToastSender,
		buildToast: PreviewToastBuilder,
	) {
		this.state = state;
		this.sourceId = sourceId;
		this.sendToast = sendToast;
		this.buildToast = buildToast;
	}

	public async createPreviewNotification(
		request: PreviewNotificationRequest,
	): Promise<PreviewNotificationResult> {
		const prepared = this.state.prepare(request);

		if (prepared.suppressed) {
			return {
				done: true,
				suppressed: true,
				cameraRegistered: Boolean(prepared.camera),
			};
		}

		try {
			await this.sendToast(this.buildToast(request, this.sourceId));
		} catch (error) {
			if (prepared.reservedAt !== null) {
				this.state.releaseToastReservation(prepared.key, prepared.reservedAt);
			}
			throw error;
		}

		return {
			done: true,
			suppressed: false,
			cameraRegistered: Boolean(prepared.camera),
		};
	}
}
