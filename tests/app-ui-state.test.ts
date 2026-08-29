import assert from 'node:assert/strict';
import test from 'node:test';

import { Intent, parseActivateType } from '../packages/app/src/shared/api/common.ts';
import { wheelShiftFromDelta } from '../packages/app/src/features/ribbon/services/app-drawer/app-drawer.lib.ts';
import { RIBBON_AUTO_HIDE_MS } from '../packages/app/src/features/ribbon/services/ribbon/ribbon.lib.ts';
import {
	hasCompletedSetup,
	markSetupComplete,
	SETUP_COMPLETE_STORAGE_KEY,
} from '../packages/app/src/setup-state.ts';

class MemoryStorage {
	private readonly values = new Map<string, string>();

	public getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	public setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

test('setup-complete marker persists successful first setup', () => {
	const storage = new MemoryStorage();
	assert.equal(hasCompletedSetup(storage), false);
	markSetupComplete(storage);
	assert.equal(storage.getItem(SETUP_COMPLETE_STORAGE_KEY), '1');
	assert.equal(hasCompletedSetup(storage), true);
});

test('launch intents are parsed without making malformed params fatal', () => {
	assert.equal(
		parseActivateType('{"intent":"homeback:show"}').intent,
		Intent.ShowHomeBack,
	);
	assert.equal(
		parseActivateType('{"intent":"homeback:preview"}').intent,
		Intent.PreviewInputProbe,
	);
	assert.deepEqual(parseActivateType('not-json'), {});
	assert.deepEqual(parseActivateType('[]'), {});
});

test('drawer wheel delta maps to one deterministic selection shift', () => {
	assert.equal(wheelShiftFromDelta(-120), -1);
	assert.equal(wheelShiftFromDelta(-1), -1);
	assert.equal(wheelShiftFromDelta(0), 0);
	assert.equal(wheelShiftFromDelta(1), 1);
	assert.equal(wheelShiftFromDelta(120), 1);
	assert.equal(wheelShiftFromDelta(Number.NaN), 0);
});


test('ribbon inactivity timeout is three seconds', () => {
	assert.equal(RIBBON_AUTO_HIDE_MS, 3_000);
});
