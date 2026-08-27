/* eslint-disable @typescript-eslint/naming-convention */
declare global {
	const __DEV__: boolean;

	namespace NodeJS {
		interface ProcessEnv {
			APP_ID: string;
			SERVICE_ID: string;
		}
	}
}

export {};
