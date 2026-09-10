import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildCatalogArtifacts } = require('../scripts/generate-manifest.cjs') as {
	buildCatalogArtifacts: (options: {
		ipkHash: string;
		cameraIpkHash?: string;
		version?: string;
	}) => {
		manifest: Record<string, unknown>;
		cameraManifest?: Record<string, unknown>;
		index: {
			paging: { count: number; itemsTotal: number };
			packages: Array<{ id: string; manifest: Record<string, unknown> }>;
		};
	};
};

test('released Homebrew catalog includes the camera companion when its hash is supplied', () => {
	const artifacts = buildCatalogArtifacts({
		ipkHash: 'a'.repeat(64),
		cameraIpkHash: 'b'.repeat(64),
		version: '0.6.8',
	});

	assert.equal(artifacts.index.paging.count, 2);
	assert.equal(artifacts.index.paging.itemsTotal, 2);
	assert.equal(artifacts.cameraManifest?.id, 'com.homebrew.homeback.camera');
	assert.equal(
		artifacts.cameraManifest?.ipkUrl,
		'https://github.com/angelcode1/webos-HomeBack/releases/download/v0.6.8/com.homebrew.homeback.camera_0.6.8_all.ipk',
	);
	assert.equal(artifacts.index.packages[1]?.id, 'com.homebrew.homeback.camera');
});

test('pre-release catalog can continue describing the last published main package only', () => {
	const artifacts = buildCatalogArtifacts({
		ipkHash: 'a'.repeat(64),
		version: '0.6.7',
	});

	assert.equal(artifacts.index.paging.count, 1);
	assert.equal(artifacts.cameraManifest, undefined);
	assert.equal(artifacts.index.packages[0]?.id, 'com.homebrew.homeback');
	assert.equal(artifacts.index.packages[0]?.manifest.version, '0.6.7');
});
