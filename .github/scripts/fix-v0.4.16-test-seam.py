from pathlib import Path

lib = """import type { RemoteConfig, RemoteMapping, TimedMapping } from './remote-config';

type ShortcutMigration = {
\toldLabel: string;
\tnewLabel: string;
\toldShortId: string;
\toldLongKeycode: number;
\tnewShortId: string;
\tnewLongKeycode: number;
};

const SHORTCUT_MIGRATIONS: Record<string, ShortcutMigration> = {
\t'1043': {
\t\toldLabel: 'Stan button',
\t\tnewLabel: 'LG Channels button',
\t\toldShortId: 'com.webos.app.hdmi3',
\t\toldLongKeycode: 399,
\t\tnewShortId: 'com.webos.app.hdmi4',
\t\tnewLongKeycode: 400,
\t},
\t'1086': {
\t\toldLabel: 'LG Channels button',
\t\tnewLabel: 'Alexa button',
\t\toldShortId: 'com.webos.app.hdmi4',
\t\toldLongKeycode: 400,
\t\tnewShortId: 'cdp-30',
\t\tnewLongKeycode: 401,
\t},
\t'1111': {
\t\toldLabel: 'Alexa button',
\t\tnewLabel: 'Model-specific button (observed keycode 1111)',
\t\toldShortId: 'cdp-30',
\t\toldLongKeycode: 401,
\t\tnewShortId: 'com.webos.app.hdmi2',
\t\tnewLongKeycode: 398,
\t},
};

const isTimedMapping = (mapping: RemoteMapping): mapping is TimedMapping =>
\t'short' in mapping || 'long' in mapping || 'longPressMs' in mapping;

const matchesDefaultPair = (
\tmapping: RemoteMapping,
\tmigration: ShortcutMigration,
): mapping is TimedMapping =>
\tisTimedMapping(mapping) &&
\tmapping.short?.action === 'launch' &&
\tmapping.short.id === migration.oldShortId &&
\tmapping.short.params === undefined &&
\tmapping.long?.action === 'replace' &&
\tmapping.long.keycode === migration.oldLongKeycode;

export const migrateDefaultRemoteShortcuts = (config: RemoteConfig): boolean => {
\tlet changed = false;

\tfor (const [key, migration] of Object.entries(SHORTCUT_MIGRATIONS)) {
\t\tconst mapping = config.keys[key];
\t\tif (!mapping || !matchesDefaultPair(mapping, migration)) continue;

\t\tconst label = mapping.label === migration.oldLabel || mapping.label === undefined
\t\t\t? migration.newLabel
\t\t\t: mapping.label;
\t\tconfig.keys[key] = {
\t\t\t...mapping,
\t\t\tlabel,
\t\t\tshort: { action: 'launch', id: migration.newShortId },
\t\t\tlong: { action: 'replace', keycode: migration.newLongKeycode },
\t\t};
\t\tchanged = true;
\t}

\treturn changed;
};
"""

wrapper = """import { promises as fs } from 'fs';

import { validateConfig } from './remote-config';
import { migrateDefaultRemoteShortcuts } from './remote-default-migration.lib';
import { writeFile } from './utils';

export { migrateDefaultRemoteShortcuts } from './remote-default-migration.lib';

export const migrateRemoteDefaultsFile = async (path: string): Promise<void> => {
\tlet stat;
\ttry {
\t\tstat = await fs.lstat(path);
\t} catch (error) {
\t\tif ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
\t\tthrow error;
\t}
\tif (!stat.isFile() || stat.isSymbolicLink()) return;

\tlet parsed: unknown;
\ttry {
\t\tparsed = JSON.parse(await fs.readFile(path, 'utf8')) as unknown;
\t} catch {
\t\treturn;
\t}
\tif (!validateConfig(parsed) || !migrateDefaultRemoteShortcuts(parsed)) return;

\tawait writeFile(path, `${JSON.stringify(parsed, null, 2)}\\n`, 0o600);
};
"""

Path('packages/service/src/remote-default-migration.lib.ts').write_text(lib)
Path('packages/service/src/remote-default-migration.ts').write_text(wrapper)

test_path = Path('tests/remote-config.test.ts')
test_text = test_path.read_text()
old = "import { migrateDefaultRemoteShortcuts } from '../packages/service/src/remote-default-migration.ts';"
new = "import { migrateDefaultRemoteShortcuts } from '../packages/service/src/remote-default-migration.lib.ts';"
if test_text.count(old) != 1:
    raise SystemExit('expected migration test import exactly once')
test_path.write_text(test_text.replace(old, new, 1))
