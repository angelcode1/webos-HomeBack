declare class PalmServiceBridge {
	constructor(serviceId?: string);

	onservicecallback(serializedMessage: string): void;
	call(uri: string, serializedParameters: string): void;
	cancel(): void;
}
