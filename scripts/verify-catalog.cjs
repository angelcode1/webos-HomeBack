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
const MAIN_APP_ID = 'com.homebrew.homeback';
const CAMERA_APP_ID = `${MAIN_APP_ID}.camera`;

const readIndex = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const readHash = (entry, label) => {
	const value = entry?.manifest?.ipkHash?.sha256;
	if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
		console.error(`repo.json does not contain a valid ${label} SHA-256 digest`);
		process.exit(1);
	}
	return value;
};

const canonical = readIndex(INDEX_PATHS[0]);
const entries = Array.isArray(canonical?.packages) ? canonical.packages : [];
const mainEntry = entries.find(entry => entry?.id === MAIN_APP_ID);
if (!mainEntry) {
	console.error(`repo.json does not contain ${MAIN_APP_ID}`);
	process.exit(1);
}

const catalogVersion = mainEntry?.manifest?.version;
if (typeof catalogVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(catalogVersion)) {
	console.error('repo.json does not contain a valid catalog version');
	process.exit(1);
}

const ipkHash = readHash(mainEntry, 'HomeBack package');
const cameraEntry = entries.find(entry => entry?.id === CAMERA_APP_ID);
const cameraIpkHash = cameraEntry ? readHash(cameraEntry, 'HomeBack Camera package') : undefined;

const expected = serializeJson(
	buildCatalogArtifacts({
		ipkHash,
		cameraIpkHash,
		version: catalogVersion,
	}).index,
);
let failed = false;
for (const filePath of INDEX_PATHS) {
	const actual = fs.readFileSync(filePath, 'utf8');
	if (actual === expected) continue;
	failed = true;
	console.error(`${path.relative(ROOT, filePath)} is not generated from current package metadata.`);
}

if (failed) {
	console.error(
		`Regenerate with the released package hashes and CATALOG_VERSION=${catalogVersion} node scripts/generate-manifest.cjs`,
	);
	process.exit(1);
}

console.log('Homebrew catalog indexes match generated metadata.');
