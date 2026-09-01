#!/usr/bin/env node
// Generates the webOS Homebrew Channel package manifest and repository indexes
// from one source of truth. Schema:
// https://github.com/webosbrew/apps-repo/blob/main/content/schemas/api/PackageManifest.json
const fs = require('fs');
const path = require('path');

const pkg = require(path.resolve(__dirname, '..', 'package.json'));

const TITLE = 'HomeBack';
const SOURCE_URL = 'https://github.com/angelcode1/webos-HomeBack';
const ICON_URI = `${SOURCE_URL.replace('github.com', 'raw.githubusercontent.com')}/main/packages/app/manifests/icon130.png`;

const serializeJson = value => `${JSON.stringify(value, null, 2)}\n`;

const releaseIpkName = version => `${pkg.id}_${version}_all.ipk`;

const buildCatalogArtifacts = ({
	ipkHash,
	ipkName = releaseIpkName(pkg.version),
	releaseTag = `v${pkg.version}`,
} = {}) => {
	if (typeof ipkHash !== 'string' || !/^[0-9a-f]{64}$/i.test(ipkHash)) {
		throw new Error('IPK_HASH must be a 64-character SHA-256 hex digest');
	}
	if (typeof ipkName !== 'string' || !ipkName) throw new Error('IPK_NAME must be non-empty');
	if (typeof releaseTag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(releaseTag)) {
		throw new Error('RELEASE_TAG must look like v0.6.0');
	}

	const manifest = {
		id: pkg.id,
		version: pkg.version,
		type: 'web',
		title: TITLE,
		appDescription: pkg.description,
		iconUri: ICON_URI,
		sourceUrl: SOURCE_URL,
		rootRequired: true,
		ipkUrl: `${SOURCE_URL}/releases/download/${releaseTag}/${ipkName}`,
		ipkHash: { sha256: ipkHash.toLowerCase() },
	};

	const index = {
		paging: {
			page: 1,
			count: 1,
			maxPage: 1,
			itemsTotal: 1,
		},
		packages: [
			{
				id: pkg.id,
				title: TITLE,
				iconUri: ICON_URI,
				shortDescription: pkg.description,
				manifest,
			},
		],
	};

	return { manifest, index };
};

const writeJson = (filePath, value) => {
	fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
	fs.writeFileSync(filePath, serializeJson(value));
};

const main = () => {
	const { manifest, index } = buildCatalogArtifacts({
		ipkHash: process.env.IPK_HASH,
		ipkName: process.env.IPK_NAME || releaseIpkName(pkg.version),
		releaseTag: process.env.RELEASE_TAG || `v${pkg.version}`,
	});

	if (process.env.MANIFEST_PATH) writeJson(process.env.MANIFEST_PATH, manifest);
	writeJson(process.env.REPO_INDEX_PATH || 'repo.json', index);
	writeJson(process.env.WEBOSBREW_INDEX_PATH || 'webosbrew/index.json', index);
};

module.exports = {
	buildCatalogArtifacts,
	releaseIpkName,
	serializeJson,
};

if (require.main === module) {
	try {
		main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
