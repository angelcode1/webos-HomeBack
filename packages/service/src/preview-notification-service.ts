import type {
	NotificationToastRequest,
	PreviewNotificationRequest,
	PreviewNotificationState,
	RecentCameraEntry,
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
export type PreviewCameraPresenter = (camera: RecentCameraEntry) => Promise<boolean>;

export class PreviewNotificationService {
	private readonly state: PreviewNotificationState;
	private readonly sourceId: string;
	private readonly sendToast: PreviewToastSender;
	private readonly buildToast: PreviewToastBuilder;
	private readonly presentCamera: PreviewCameraPresenter | null;

	public constructor(
		state: PreviewNotificationState,
		sourceId: string,
		sendToast: PreviewToastSender,
		buildToast: PreviewToastBuilder,
		presentCamera: PreviewCameraPresenter | null = null,
	) {
		this.state = state;
		this.sourceId = sourceId;
		this.sendToast = sendToast;
		this.buildToast = buildToast;
		this.presentCamera = presentCamera;
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

		let presentedAsPip = false;
		if (prepared.camera && this.presentCamera) {
			try {
				presentedAsPip = await this.presentCamera(prepared.camera);
			} catch (error) {
				console.warn(
					'HomeBack camera PiP presenter failed; falling back to native toast:',
					error instanceof Error ? error.message : String(error),
				);
			}
		}

		if (!presentedAsPip) {
			try {
				await this.sendToast(this.buildToast(request, this.sourceId));
			} catch (error) {
				if (prepared.reservedAt !== null) {
					this.state.releaseToastReservation(prepared.key, prepared.reservedAt);
				}
				throw error;
			}
		}

		return {
			done: true,
			suppressed: false,
			cameraRegistered: Boolean(prepared.camera),
		};
	}
}
