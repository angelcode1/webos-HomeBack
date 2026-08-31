import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath: string): string =>
	fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

test('cold activation and ribbon visibility diagnostics remain explicit', () => {
	const activation = read('packages/app/src/shared/services/activation/activation.service.ts');
	const ribbonModule = read('packages/app/src/features/ribbon/services/ribbon/ribbon.module.ts');

	assert.match(activation, /const serializedLaunchParams = webOSSystem\.launchParams;/);
	assert.match(
		activation,
		/\[HomeBackActivation\] cold source=\$\{coldSource\} action=\$\{this\.initialAction\.type\}/,
	);
	assert.match(ribbonModule, /\[HomeBackRibbon\] visible=\$\{visible\}/);
});
