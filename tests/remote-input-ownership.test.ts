import assert from 'node:assert/strict';
import test from 'node:test';

import { ESSENTIAL_TARGET_NAMES } from '../packages/service/src/remote-input-lifecycle.ts';
import {
	findMappedLibraryPath,
	hasVerifiedNativeOwnership,
	isHomeBackMappedLibraryPath,
} from '../packages/service/src/remote-input-ownership.ts';

const HOME_BACK_LIBRARY =
	'/media/developer/apps/usr/palm/services/com.homebrew.homeback.service/inputhook/libinputhookpp.so';
const observed = (...entries: Array<[number, string]>) =>
	entries.map(([pid, name]) => ({ pid, name }));

const managed = (...entries: Array<[number, string, 'injecting' | 'active']>) =>
	entries.map(([pid, name, state]) => ({ pid, name, state }));

test('findMappedLibraryPath finds the loaded input hook and preserves deleted marker', () => {
	const maps = [
		'00010000-00020000 r-xp 00000000 00:00 1 /usr/lib/libc.so',
		`12340000-12350000 r-xp 00000000 00:00 2 ${HOME_BACK_LIBRARY} (deleted)`,
	].join('\n');

	assert.equal(
		findMappedLibraryPath(maps, 'libinputhookpp.so'),
		`${HOME_BACK_LIBRARY} (deleted)`,
	);
});

test('HomeBack mapped library is classified as adoptable across service restart', () => {
	assert.equal(
		isHomeBackMappedLibraryPath(HOME_BACK_LIBRARY, HOME_BACK_LIBRARY, 'com.homebrew.homeback.service'),
		true,
	);
	assert.equal(
		isHomeBackMappedLibraryPath(
			`${HOME_BACK_LIBRARY} (deleted)`,
			'/other/install/root/inputhook/libinputhookpp.so',
			'com.homebrew.homeback.service',
		),
		true,
	);
});

test('standalone LG Input Hook path is never classified as HomeBack-owned', () => {
	const standalone =
		'/media/developer/apps/usr/palm/services/org.webosbrew.inputhook.service/lib/libinputhookpp.so';

	assert.equal(
		isHomeBackMappedLibraryPath(standalone, HOME_BACK_LIBRARY, 'com.homebrew.homeback.service'),
		false,
	);
});

test('verified native ownership requires active ownership for every observed essential target', () => {
	const live = observed([101, 'lginput2'], [102, 'micomservice']);

	assert.equal(
		hasVerifiedNativeOwnership(
			true,
			false,
			ESSENTIAL_TARGET_NAMES,
			live,
			managed([101, 'lginput2', 'active'], [102, 'micomservice', 'active']),
			[],
		),
		true,
	);
	assert.equal(
		hasVerifiedNativeOwnership(
			true,
			false,
			ESSENTIAL_TARGET_NAMES,
			live,
			managed([101, 'lginput2', 'active'], [102, 'micomservice', 'injecting']),
			[],
		),
		false,
	);
});

test('non-essential blockers do not make verified native ownership fail', () => {
	assert.equal(
		hasVerifiedNativeOwnership(
			true,
			false,
			ESSENTIAL_TARGET_NAMES,
			observed([101, 'lginput2'], [201, 'tvservice']),
			managed([101, 'lginput2', 'active']),
			observed([201, 'tvservice']),
		),
		true,
	);
});

test('essential blockers, legacy mode, stopped service, and no essential targets fail verification', () => {
	const oneEssential = observed([101, 'lginput2']);
	const oneActive = managed([101, 'lginput2', 'active']);

	assert.equal(
		hasVerifiedNativeOwnership(true, false, ESSENTIAL_TARGET_NAMES, oneEssential, oneActive, observed([101, 'lginput2'])),
		false,
	);
	assert.equal(hasVerifiedNativeOwnership(false, false, ESSENTIAL_TARGET_NAMES, oneEssential, oneActive, []), false);
	assert.equal(hasVerifiedNativeOwnership(true, true, ESSENTIAL_TARGET_NAMES, oneEssential, oneActive, []), false);
	assert.equal(
		hasVerifiedNativeOwnership(
			true,
			false,
			ESSENTIAL_TARGET_NAMES,
			observed([201, 'tvservice']),
			managed([201, 'tvservice', 'active']),
			[],
		),
		false,
	);
});
