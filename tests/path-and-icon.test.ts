import assert from 'node:assert/strict';
import test from 'node:test';

import {
	extractMethodPath,
	joinMethodPath,
} from '../packages/service/src/bus/path.ts';
import { genericAppIcon } from '../packages/app/src/shared/services/launcher/model/icon-fallback.ts';

test('LS2 method path helpers round-trip root and nested paths', () => {
	for (const method of ['/bootstrap', '/remote/start', '/a/b/c']) {
		const [category, name] = extractMethodPath(method);
		assert.equal(joinMethodPath(category, name), method);
	}
});

test('fallback icon supports non-BMP title initials', () => {
	assert.doesNotThrow(() => genericAppIcon('😀 App'));
	assert.match(genericAppIcon('😀 App'), /^data:image\/svg\+xml/);
});
