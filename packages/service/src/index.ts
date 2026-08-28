import { Service } from './bus';
import { readLaunchPointIcon, type IconRequest } from './app-catalog';
import { APPLICATION_MANAGER_URI, APP_ID } from './environment';
import { HomeBackBootstrap } from './bootstrap';
import { getUid } from './utils';

const service = new Service();
const bootstrap = new HomeBackBootstrap(service);

const selfStartRemoteInput = async (): Promise<void> => {
	if (getUid() !== 0) return;

	try {
		await bootstrap.startRemoteInput();
		console.log('HomeBack root helper self-started remote input.');
	} catch (error) {
		console.error('HomeBack root helper could not self-start remote input:', error);
	}
};

service.registerSimple<IconRequest>('/readIcon', async request => ({
	done: true,
	dataUrl: await readLaunchPointIcon(request ?? {}),
}));

service.registerSimple('/bootstrap', async () => ({
	done: true,
	...(await bootstrap.apply()),
}));

service.registerSimple('/remote/start', async () => {
	await bootstrap.startRemoteInput();
	return { done: true, status: bootstrap.remoteInput.status() };
});

service.registerSimple('/remote/status', () => ({
	done: true,
	status: bootstrap.remoteInput.status(),
}));

service.registerSimple('/restartService', () => {
	setTimeout(() => process.exit(0), 100);
	return { done: true };
});

service.registerSimple('/restartApp', () => {
	setTimeout(() => {
		void (async () => {
			try {
				await service.oneshot(`${APPLICATION_MANAGER_URI}/closeByAppId`, { id: APP_ID });
			} catch {
				// App may already be gone.
			}

			await new Promise(resolve => setTimeout(resolve, 400));

			try {
				await service.oneshot(`${APPLICATION_MANAGER_URI}/launch`, { id: APP_ID });
			} catch (error) {
				console.error('Unable to relaunch HomeBack after ACG bootstrap:', error);
			}
		})();
	}, 100);

	return { done: true };
});

if (__DEV__) {
	service.registerSimple('/quit', () => {
		setTimeout(() => process.exit(0), 100);
		return { returnValue: true, message: 'Bye bye!' };
	});
}

// @invariant: root-helper-self-start
setTimeout(() => {
	void selfStartRemoteInput();
}, 0);
