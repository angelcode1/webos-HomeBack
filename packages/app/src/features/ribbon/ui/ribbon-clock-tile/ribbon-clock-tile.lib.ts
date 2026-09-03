export const CLOCK_TILE_REVEAL_DELAY_MS = 1_000;
export const CLOCK_MINUTE_MS = 60 * 1000;

const MONTH_FORMATTER = new Intl.DateTimeFormat('en-US', {
	month: 'short',
});

export const formatClockTileDate = (date: Date): string =>
	`${MONTH_FORMATTER.format(date)}, ${date.getDate()}`;

export const minuteBoundaryDelay = (now: number): number =>
	CLOCK_MINUTE_MS - (now % CLOCK_MINUTE_MS) + 20;
