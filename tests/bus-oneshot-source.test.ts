import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../packages/service/src/bus/index.ts', import.meta.url), 'utf8');
const oneshot = source.match(/public async oneshot[\s\S]*?\n\tprivate handleRequest/)?.[0];

test('Service.oneshot uses palmbus call without forcing subscription semantics', () => {
	assert.ok(oneshot, 'oneshot implementation should be present');
	assert.match(oneshot, /this\.handle\.call\(uri, JSON\.stringify\(params\)\)/);
	assert.doesNotMatch(oneshot, /this\.subscribe/);
	assert.doesNotMatch(oneshot, /subscribe:\s*true/);
});
