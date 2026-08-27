import { luna, LunaError } from './shared/services/luna';

type BootstrapResponse = {
	returnValue: true;
	done: true;
	restartRequired: boolean;
	permissionFiles: string[];
};

type RootConfiguration = {
	returnValue: true;
	root?: boolean;
	homebrewBaseDir?: string | null;
};

type ExecResponse = {
	returnValue: true;
	error?: string | null;
	stdoutString?: string;
	stderrString?: string;
};

const ELEVATION_RETRY_MS = 250;
const ELEVATION_DEADLINE_MS = 15_000;

const sleep = (ms: number): Promise<void> =>
	new Promise(resolve => setTimeout(resolve, ms));

const callBootstrap = (): Promise<BootstrapResponse> =>
	luna<BootstrapResponse>(`luna://${process.env.SERVICE_ID}/bootstrap`);

const shellQuote = (value: string): string =>
	`'${value.replace(/'/g, `'"'"'`)}'`;

const elevateWithExecFallback = async (config: RootConfiguration): Promise<void> => {
	const serviceId = process.env.SERVICE_ID;
	const candidates = [
		config.homebrewBaseDir
			? `${config.homebrewBaseDir}/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service`
			: null,
		'/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service',
		'/media/cryptofs/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service',
	].filter((path): path is string => Boolean(path));

	const candidateList = [...new Set(candidates)].map(shellQuote).join(' ');
	const command = [
		`for script in ${candidateList}; do`,
		'  if [ -x "$script" ]; then',
		`    exec "$script" ${shellQuote(serviceId)}`,
		'  fi',
		'done',
		'echo "Homebrew Channel elevate-service script not found" >&2',
		'exit 127',
	].join('\n');

	const response = await luna<ExecResponse>(
		'luna://org.webosbrew.hbchannel.service/exec',
		{ command },
	);

	if (response.error) throw new Error(`Homebrew Channel exec failed: ${response.error}`);
};

const elevateHelper = async (): Promise<void> => {
	const config = await luna<RootConfiguration>(
		'luna://org.webosbrew.hbchannel.service/getConfiguration',
	);
	if (!config.root) {
		throw new Error('Homebrew Channel is installed but root access is not enabled.');
	}

	try {
		await luna('luna://org.webosbrew.hbchannel.service/elevateService', {
			id: process.env.SERVICE_ID,
		});
		return;
	} catch (error) {
		if (__DEV__) {
			console.warn(
				'Homebrew Channel /elevateService unavailable; trying compatibility fallback:',
				error,
			);
		}
	}

	await elevateWithExecFallback(config);
};

const restartHelperAfterElevation = async (): Promise<void> => {
	try {
		await luna(`luna://${process.env.SERVICE_ID}/restartService`);
	} catch (error) {
		if (__DEV__) {
			console.warn(
				'HomeBack helper restart after elevation did not respond:',
				error,
			);
		}
	}
};

const requiresElevation = (error: unknown): boolean =>
	error instanceof LunaError && error.errorCode === -401;

export const bootstrapHomeBack = async (
	onSetupComplete?: () => void,
): Promise<'ready' | 'restarting'> => {
	let result: BootstrapResponse;

	try {
		result = await callBootstrap();
	} catch (error) {
		if (!requiresElevation(error)) throw error;

		await elevateHelper();
		await restartHelperAfterElevation();

		const deadline = Date.now() + ELEVATION_DEADLINE_MS;
		let lastError: unknown = error;

		while (Date.now() < deadline) {
			await sleep(ELEVATION_RETRY_MS);

			try {
				result = await callBootstrap();
				lastError = null;
				break;
			} catch (retryError) {
				lastError = retryError;
			}
		}

		if (lastError) {
			throw lastError instanceof Error
				? lastError
				: new Error('HomeBack helper did not become available after elevation.');
		}
	}

	onSetupComplete?.();

	if (result!.restartRequired) {
		await luna(`luna://${process.env.SERVICE_ID}/restartApp`);
		return 'restarting';
	}

	return 'ready';
};
