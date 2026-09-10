#!/usr/bin/env node
// Generates the webOS Homebrew Channel package manifests and repository indexes
// from one source of truth. Schema:
// https://github.com/webosbrew/apps-repo/blob/main/content/schemas/api/PackageManifest.json
const fs = require('fs');
const path = require('path');

const pkg = require(path.resolve(__dirname, '..', 'package.json'));

const TITLE = 'HomeBack';
const CAMERA_TITLE = 'HomeBack Camera';
const CAMERA_ID = `${pkg.id}.camera`;
const SOURCE_URL = 'https://github.com/angelcode1/webos-HomeBack';
const RAW_SOURCE_URL = SOURCE_URL.replace('github.com', 'raw.githubusercontent.com');
const ICON_URI = `${RAW_SOURCE_URL}/main/packages/app/manifests/icon130.png`;
const CAMERA_ICON_URI = `${RAW_SOURCE_URL}/main/packages/pip-app/manifests/icon130.png`;
const CAMERA_DESCRIPTION = 'Camera PiP companion for HomeBack Home Assistant notifications.';

const serializeJson = value => `${JSON.stringify(value, null, 2)}\n`;

const releaseIpkName = version => `${pkg.id}_${version}_all.ipk`;
const cameraReleaseIpkName = version => `${CAMERA_ID}_${version}_all.ipk`;

const validateVersion = version => {
	if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
		throw new Error('CATALOG_VERSION must look like 0.6.0');
	}
};

const validateHash = (name, value) => {
	if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
		throw new Error(`${name} must be a 64-character SHA-256 hex digest`);
	}
};

const buildManifest = ({
	id,
	version,
	title,
	description,
	iconUri,
	ipkHash,
	ipkName,
	releaseTag,
}) => ({
	id,
	version,
	type: 'web',
	title,
	appDescription: description,
	iconUri,
	sourceUrl: SOURCE_URL,
	rootRequired: true,
	ipkUrl: `${SOURCE_URL}/releases/download/${releaseTag}/${ipkName}`,
	ipkHash: { sha256: ipkHash.toLowerCase() },
});

const buildPackageEntry = ({ manifest, title, description, iconUri }) => ({
	id: manifest.id,
	title,
	iconUri,
	shortDescription: description,
	manifest,
});

const buildCatalogArtifacts = ({
	ipkHash,
	cameraIpkHash,
	version = pkg.version,
	ipkName = releaseIpkName(version),
	cameraIpkName = cameraReleaseIpkName(version),
	releaseTag = `v${version}`,
} = {}) => {
	validateVersion(version);
	validateHash('IPK_HASH', ipkHash);
	if (cameraIpkHash !== undefined) validateHash('CAMERA_IPK_HASH', cameraIpkHash);
	if (typeof ipkName !== 'string' || !ipkName) throw new Error('IPK_NAME must be non-empty');
	if (typeof cameraIpkName !== 'string' || !cameraIpkName) {
		throw new Error('CAMERA_IPK_NAME must be non-empty');
	}
	if (typeof releaseTag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(releaseTag)) {
		throw new Error('RELEASE_TAG must look like v0.6.0');
	}

	const manifest = buildManifest({
		id: pkg.id,
		version,
		title: TITLE,
		description: pkg.description,
		iconUri: ICON_URI,
		ipkHash,
		ipkName,
		releaseTag,
	});
	const cameraManifest = cameraIpkHash
		? buildManifest({
				id: CAMERA_ID,
				version,
				title: CAMERA_TITLE,
				description: CAMERA_DESCRIPTION,
				iconUri: CAMERA_ICON_URI,
				ipkHash: cameraIpkHash,
				ipkName: cameraIpkName,
				releaseTag,
			})
		: undefined;

	const packages = [
		buildPackageEntry({
			manifest,
			title: TITLE,
			description: pkg.description,
			iconUri: ICON_URI,
		}),
	];
	if (cameraManifest) {
		packages.push(
			buildPackageEntry({
				manifest: cameraManifest,
				title: CAMERA_TITLE,
				description: CAMERA_DESCRIPTION,
				iconUri: CAMERA_ICON_URI,
			}),
		);
	}

	const index = {
		paging: {
			page: 1,
			count: packages.length,
			maxPage: 1,
			itemsTotal: packages.length,
		},
		packages,
	};

	return { manifest, cameraManifest, index };
};

const writeJson = (filePath, value) => {
	fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
	fs.writeFileSync(filePath, serializeJson(value));
};

const main = () => {
	const version = process.env.CATALOG_VERSION || pkg.version;
	const { manifest, cameraManifest, index } = buildCatalogArtifacts({
		ipkHash: process.env.IPK_HASH,
		cameraIpkHash: process.env.CAMERA_IPK_HASH,
		version,
		ipkName: process.env.IPK_NAME || releaseIpkName(version),
		cameraIpkName: process.env.CAMERA_IPK_NAME || cameraReleaseIpkName(version),
		releaseTag: process.env.RELEASE_TAG || `v${version}`,
	});

	if (process.env.MANIFEST_PATH) writeJson(process.env.MANIFEST_PATH, manifest);
	if (process.env.CAMERA_MANIFEST_PATH) {
		if (!cameraManifest) throw new Error('CAMERA_IPK_HASH is required with CAMERA_MANIFEST_PATH');
		writeJson(process.env.CAMERA_MANIFEST_PATH, cameraManifest);
	}
	writeJson(process.env.REPO_INDEX_PATH || 'repo.json', index);
	writeJson(process.env.WEBOSBREW_INDEX_PATH || 'webosbrew/index.json', index);
};

module.exports = {
	buildCatalogArtifacts,
	cameraReleaseIpkName,
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
