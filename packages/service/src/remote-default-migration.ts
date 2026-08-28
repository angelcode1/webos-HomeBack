import { promises as fs } from 'fs';

import { validateConfig } from './remote-config';
import { migrateDefaultRemoteShortcuts } from './remote-default-migration.lib';
import { writeFile } from './utils';

export { migrateDefaultRemoteShortcuts } from './remote-default-migration.lib';

export const migrateRemoteDefaultsFile = async (path: string): Promise<void> => {
	let stat;
	try {
		stat = await fs.lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
		throw error;
	}
	if (!stat.isFile() || stat.isSymbolicLink()) return;

	let parsed: unknown;
	try {
		parsed = JSON.parse(await fs.readFile(path, 'utf8')) as unknown;
	} catch {
		return;
	}
	if (!validateConfig(parsed) || !migrateDefaultRemoteShortcuts(parsed)) return;

	await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, 0o600);
};
