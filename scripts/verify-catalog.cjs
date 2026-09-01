#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const {
	buildCatalogArtifacts,
	serializeJson,
} = require('./generate-manifest.cjs');

const ROOT = path.resolve(__dirname, '..');
const INDEX_PATHS = [
	path.join(ROOT, 'repo.json'),
	path.join(ROOT, 'webosbrew', 'index.json'),
];

const readIndex = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const canonical = readIndex(INDEX_PATHS[0]);
const ipkHash = canonical?.packages?.[0]?.manifest?.ipkHash?.sha256;
if (typeof ipkHash !== 'string' || !/^[0-9a-f]{64}$/i.test(ipkHash)) {
	console.error('repo.json does not contain a valid package SHA-256 digest');
	process.exit(1);
}

const expected = serializeJson(buildCatalogArtifacts({ ipkHash }).index);
let failed = false;
for (const filePath of INDEX_PATHS) {
	const actual = fs.readFileSync(filePath, 'utf8');
	if (actual === expected) continue;
	failed = true;
	console.error(`${path.relative(ROOT, filePath)} is not generated from current package metadata.`);
}

if (failed) {
	console.error(`Regenerate with: IPK_HASH=${ipkHash} node scripts/generate-manifest.cjs`);
	process.exit(1);
}

console.log('Homebrew catalog indexes match generated metadata.');
