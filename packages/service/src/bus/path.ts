export const joinMethodPath = (category: string, method: string): string => {
	const normalizedCategory = category === '/' ? '' : category.replace(/\/+$/, '');
	const normalizedMethod = method.replace(/^\/+/, '');
	return `${normalizedCategory}/${normalizedMethod}`;
};

export const extractMethodPath = (path: string): [string, string] => {
	const normalized = path.startsWith('/') ? path : `/${path}`;
	const lastSlashIndex = normalized.lastIndexOf('/');
	return lastSlashIndex <= 0
		? ['/', normalized.slice(1)]
		: [normalized.slice(0, lastSlashIndex), normalized.slice(lastSlashIndex + 1)];
};
