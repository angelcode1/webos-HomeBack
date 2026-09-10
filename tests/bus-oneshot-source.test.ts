import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('packages/service/src/bus/index.ts', 'utf8');

test('Service.oneshot uses a real Palm bus one-shot call without subscription injection', () => {
	const method = source.slice(source.indexOf('public async oneshot'), source.indexOf('private handleRequest'));
	assert.match(method, /this\.handle\.call\(uri, JSON\.stringify\(params\)\)/);
	assert.doesNotMatch(method, /this\.subscribe/);
	assert.doesNotMatch(method, /subscribe:\s*true/);
});
