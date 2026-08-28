import assert from 'node:assert/strict';
import test from 'node:test';

import { parseProcStatStartTime } from '../packages/service/src/remote-process.ts';

test('proc stat parser extracts starttime despite spaces and closing parentheses in comm', () => {
	// fields after comm begin at field 3 (state); index 19 is field 22/starttime.
	const tail = [
		'S', '1', '2', '3', '4', '5', '6', '7', '8', '9',
		'10', '11', '12', '13', '14', '15', '16', '17', '18', '424242',
		'20', '21',
	].join(' ');
	assert.equal(parseProcStatStartTime(`123 (odd process) name) ${tail}`), '424242');
	assert.equal(parseProcStatStartTime('malformed'), null);
});
