/**
 * Parse field 22 (starttime) from /proc/<pid>/stat.
 *
 * The comm field is parenthesized and may itself contain spaces or ')' so we
 * split only after the final ") ". The first token after that delimiter is
 * field 3 (state), making starttime token index 19 in the remaining fields.
 */
export const parseProcStatStartTime = (stat: string): string | null => {
	const commEnd = stat.lastIndexOf(') ');
	if (commEnd < 0) return null;
	const fields = stat.slice(commEnd + 2).trim().split(/\s+/);
	const startTime = fields[19];
	return startTime && /^\d+$/.test(startTime) ? startTime : null;
};
