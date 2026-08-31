import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LUNA_TOPIC_RETRY_BASE_MS,
	LUNA_TOPIC_RETRY_MAX_MS,
	LunaTopicRetryController,
	shouldRetryLunaTopic,
} from '../packages/app/src/shared/services/luna/model/luna-topic-retry.lib.ts';

test('subscription failure classification covers failed calls and terminated subscriptions', () => {
	assert.equal(shouldRetryLunaTopic({ returnValue: false }), true);
	assert.equal(shouldRetryLunaTopic({ returnValue: true, subscribed: false }), true);
	assert.equal(shouldRetryLunaTopic({ returnValue: true, subscribed: true }), false);
	assert.equal(shouldRetryLunaTopic({ returnValue: true }), false);
});

test('successful recovery resets the retry delay', t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	let retries = 0;
	const controller = new LunaTopicRetryController(() => {
		retries += 1;
	});

	controller.failed();
	t.mock.timers.tick(LUNA_TOPIC_RETRY_BASE_MS - 1);
	assert.equal(retries, 0);
	t.mock.timers.tick(1);
	assert.equal(retries, 1);

	controller.succeeded();
	controller.failed();
	t.mock.timers.tick(LUNA_TOPIC_RETRY_BASE_MS - 1);
	assert.equal(retries, 1);
	t.mock.timers.tick(1);
	assert.equal(retries, 2);
});

test('repeated failures use exponential backoff capped at eight seconds', t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	let retries = 0;
	const controller = new LunaTopicRetryController(() => {
		retries += 1;
	});
	const delays = [500, 1_000, 2_000, 4_000, 8_000, 8_000];

	for (const [index, delay] of delays.entries()) {
		controller.failed();
		t.mock.timers.tick(delay - 1);
		assert.equal(retries, index);
		t.mock.timers.tick(1);
	}

	assert.equal(retries, delays.length);
	assert.equal(delays.at(-1), LUNA_TOPIC_RETRY_MAX_MS);
});
