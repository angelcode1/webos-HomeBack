import assert from 'node:assert/strict';
import test from 'node:test';

import {
	injectionRetryDelayMs,
	MAX_INJECTION_FAILURES,
} from '../packages/service/src/remote-input-lifecycle.ts';

test('injection retries back off and stop after the configured failure limit', () => {
	assert.equal(MAX_INJECTION_FAILURES, 3);
	assert.equal(injectionRetryDelayMs(1), 5_000);
	assert.equal(injectionRetryDelayMs(2), 10_000);
	assert.equal(injectionRetryDelayMs(3), null);
	assert.equal(injectionRetryDelayMs(8), null);
});

test('injection retry policy rejects invalid failure counters', () => {
	assert.throws(() => injectionRetryDelayMs(0));
	assert.throws(() => injectionRetryDelayMs(1.5));
});
