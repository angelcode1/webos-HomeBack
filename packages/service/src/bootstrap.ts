import { existsSync, promises as fs } from 'fs';

import { ServiceError, type Service } from './bus';
import { APP_ID, SERVICE_ID } from './environment';
import { migrateRemoteDefaultsFile } from './remote-default-migration';
import { REMOTE_CONFIG_PATH, RemoteInputManager } from './remote-input';
import { getUid, readJson, rescanLunaManifests, writeJson } from './utils';

type ClientPermissions = Record<string, string[]>;

const REQUIRED_APP_PERMISSIONS = [
	'public',
	`${SERVICE_ID}.group`,
	'applications.launch',
	'applications.internal',
	'eim.deviceInfo',
	'location.query',
	'preferences.applicationpropertyquery',
	'tv.settings',
];

const CLIENT_PERMISSION_ROOTS = [
	'/var/luna-service2-dev/client-permissions.d',
	'/var/luna-service2/client-permissions.d',
];

const AUTOSTART_PATH = '/var/lib/webosbrew/init.d/homeback';

const autostartScript = `#!/bin/sh
# HomeBack remote-input bootstrap. The UI is intentionally never launched during boot:
# webOS can accept an early floating-app launch before its surface stack is ready and leave
# the hidden instance unresponsive to later HOME/show requests.
LOG=/tmp/homeback-autostart.log
(
  # @invariant: remote-only-autostart
  echo "HomeBack remote-input worker starting uptime=$(cut -d' ' -f1 /proc/uptime)"
  attempt=1
  while [ "$attempt" -le 60 ]; do
    uptime=$(cut -d' ' -f1 /proc/uptime)
    output=$(luna-send -n 1 -f "luna://${SERVICE_ID}/remote/start" '{}' 2>&1)
    echo "remote-attempt=$attempt uptime=$uptime $output"
    compact=$(printf '%s' "$output" | tr -d '[:space:]')
    if echo "$compact" | grep -Fq '"returnValue":true' \
      && echo "$compact" | grep -Fq '"started":true' \
      && echo "$compact" | grep -Fq '"legacyInputHookDetected":false' \
      && echo "$compact" | grep -Fq '"nativeOwnershipVerified":true'; then
      echo "HomeBack remote input verified uptime=$(cut -d' ' -f1 /proc/uptime)"
      exit 0
    fi
    ls-control scan-services >/dev/null 2>&1 || true
    attempt=$((attempt + 1))
    sleep 2
  done
  echo "HomeBack remote-input startup timed out uptime=$(cut -d' ' -f1 /proc/uptime)"
  exit 1
) </dev/null >>"$LOG" 2>&1 &
exit 0
`;

const arraysEqual = (a: string[], b: string[]): boolean =>
	a.length === b.length && a.every((value, index) => value === b[index]);

export class HomeBackBootstrap {
	public readonly remoteInput: RemoteInputManager;

	public constructor(private readonly service: Service) {
		this.remoteInput = new RemoteInputManager(service);
	}

	public async startRemoteInput(): Promise<void> {
		if (getUid() !== 0) {
			throw new ServiceError('HomeBack helper service is not running as root.', -401);
		}

		await migrateRemoteDefaultsFile(REMOTE_CONFIG_PATH);
		await this.remoteInput.start();
	}

	public async apply(): Promise<{ restartRequired: boolean; permissionFiles: string[] }> {
		if (getUid() !== 0) {
			throw new ServiceError('HomeBack helper service is not running as root.', -401);
		}

		const permissionResult = await this.ensureClientPermissions();
		await this.ensureAutostart();
		await this.startRemoteInput();

		return {
			restartRequired: permissionResult.changed,
			permissionFiles: permissionResult.files,
		};
	}

	private async ensureClientPermissions(): Promise<{ changed: boolean; files: string[] }> {
		const key = `${APP_ID}-*`;
		let changed = false;
		const files: string[] = [];

		for (const root of CLIENT_PERMISSION_ROOTS) {
			if (!existsSync(root)) continue;
			const path = `${root}/${APP_ID}.app.json`;

			try {
				let current: ClientPermissions = {};
				try {
					current = await readJson<ClientPermissions>(path);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
						console.warn(`Unable to read existing Luna permissions at ${path}; recreating HomeBack entry:`, error);
					}
				}

				const desired = [...REQUIRED_APP_PERMISSIONS].sort();
				const prior = Array.isArray(current[key]) ? [...new Set(current[key])].sort() : [];
				if (!arraysEqual(prior, desired)) {
					await writeJson(path, { ...current, [key]: desired });
					changed = true;
				}
				files.push(path);
			} catch (error) {
				console.warn(`Unable to update Luna permissions at ${path}:`, error);
			}
		}

		if (files.length === 0) {
			throw new Error('No Luna client-permissions directory exists on this TV.');
		}

		if (changed) await rescanLunaManifests();
		return { changed, files };
	}

	private async ensureAutostart(): Promise<void> {
		let current = '';
		try {
			current = await fs.readFile(AUTOSTART_PATH, 'utf8');
		} catch {
			// Create below.
		}
		if (current === autostartScript) return;

		await fs.mkdir('/var/lib/webosbrew/init.d', { recursive: true });
		await fs.writeFile(AUTOSTART_PATH, autostartScript, { encoding: 'utf8', mode: 0o755 });
		await fs.chmod(AUTOSTART_PATH, 0o755);
	}
}
