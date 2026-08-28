export const svgIcon = (svg: string): string =>
	`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

const escapeXml = (value: string): string => value
	.replace(/&/g, '&amp;')
	.replace(/</g, '&lt;')
	.replace(/>/g, '&gt;')
	.replace(/"/g, '&quot;')
	.replace(/'/g, '&apos;');

/** Raw icon paths are used only by AppManagerProvider before snapshots are
 * normalized to data URLs. Keep the full priority list for asynchronous
 * /readIcon hydration. */
export const preferredIconPaths = (snapshot: {
	mediumLargeIcon?: string;
	largeIcon?: string;
	extraLargeIcon?: string;
	icon?: string;
}): string[] => [
	snapshot.mediumLargeIcon,
	snapshot.largeIcon,
	snapshot.extraLargeIcon,
	snapshot.icon,
].filter((path): path is string => typeof path === 'string' && path.length > 0);

export const genericAppIcon = (title: string): string => {
	const initial = escapeXml(([...title.trim()][0] || 'A').toUpperCase());

	return svgIcon([
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
		'<rect x="13" y="13" width="74" height="74" rx="16" fill="#343434" stroke="white" stroke-width="5"/>',
		`<text x="50" y="64" text-anchor="middle" font-family="sans-serif" font-size="42" font-weight="700" fill="white">${initial}</text>`,
		'</svg>',
	].join(''));
};

export const genericInputIcon = svgIcon([
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
	'<rect x="14" y="19" width="72" height="52" rx="7" fill="#2d2d2d" stroke="white" stroke-width="7"/>',
	'<path d="M36 84h28M50 71v13" fill="none" stroke="white" stroke-width="7" stroke-linecap="round"/>',
	'<path d="M31 45h30M54 35l11 10-11 10" fill="none" stroke="white" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>',
	'</svg>',
].join(''));
