export type ProcIdentity = {
	name: string;
	startTimeTicks: string;
};

/**
 * Parse the process name (comm) and field 22 (starttime) from /proc/<pid>/stat.
 *
 * The comm field is parenthesized and may itself contain spaces or ')' so we
 * split only after the final ") ". The first token after that delimiter is
 * field 3 (state), making starttime token index 19 in the remaining fields.
 */
export const parseProcStatIdentity = (stat: string): ProcIdentity | null => {
	const commStart = stat.indexOf('(');
	const commEnd = stat.lastIndexOf(') ');
	if (commStart < 0 || commEnd <= commStart) return null;

	const fields = stat.slice(commEnd + 2).trim().split(/\s+/);
	const startTimeTicks = fields[19];
	if (!startTimeTicks || !/^\d+$/.test(startTimeTicks)) return null;

	return {
		name: stat.slice(commStart + 1, commEnd),
		startTimeTicks,
	};
};

export const parseProcStatStartTime = (stat: string): string | null =>
	parseProcStatIdentity(stat)?.startTimeTicks ?? null;
