#!/usr/bin/env node
const fs = require('fs');
const Module = require('module');
const path = require('path');

// Preserve the established optimized-source gate byte-for-byte while the
// keyboard implementation moves from Ribbon into shared services. Only the two
// obsolete source locations are retargeted; all legacy assertions still run.
const legacyPath = path.join(__dirname, 'verify-optimized-source-legacy.cjs');
let source = fs.readFileSync(legacyPath, 'utf8');

const replacements = [
	[
		"const keyboardModule = read('packages/app/src/features/ribbon/services/ribbon/ribbon.module.ts');",
		"const keyboardModule = read('packages/app/src/shared/services/services.ts');",
	],
	[
		"const keyboardDispatcher = read('packages/app/src/features/ribbon/services/keyboard/keyboard.service.ts');",
		"const keyboardDispatcher = read('packages/app/src/shared/services/keyboard/keyboard.service.ts');",
	],
];

for (const [before, after] of replacements) {
	if (!source.includes(before)) {
		throw new Error(`Legacy optimized-source verifier changed; missing expected migration anchor: ${before}`);
	}
	source = source.replace(before, after);
}

const verifier = new Module(legacyPath, module);
verifier.filename = legacyPath;
verifier.paths = Module._nodeModulePaths(path.dirname(legacyPath));
verifier._compile(source, legacyPath);
