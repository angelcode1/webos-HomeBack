#!/usr/bin/env node
// Generates the webOS Homebrew Channel package manifest for this release, so the
// app can be listed in webosbrew/apps-repo. Schema:
// https://github.com/webosbrew/apps-repo/blob/main/content/schemas/api/PackageManifest.json
const fs = require('fs');
const path = require('path');

const pkg = require(path.resolve(__dirname, '..', 'package.json'));

const manifest = {
	id: pkg.id,
	version: pkg.version,
	type: 'web',
	title: 'HomeBack',
	appDescription: 'A fast replacement Home launcher and remote-button remapper for rooted LG webOS TVs.',
	iconUri: 'https://raw.githubusercontent.com/angelcode1/webos-HomeBack/main/packages/app/manifests/icon130.png',
	sourceUrl: 'https://github.com/angelcode1/webos-HomeBack',
	rootRequired: true,
	ipkUrl: process.env.IPK_NAME,
	ipkHash: { sha256: process.env.IPK_HASH },
};

if (!manifest.ipkUrl || !manifest.ipkHash.sha256) {
	console.error('IPK_NAME and IPK_HASH env vars must be set');
	process.exit(1);
}

fs.writeFileSync(process.env.MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
