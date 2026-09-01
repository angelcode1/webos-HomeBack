import { promises as fs } from 'fs';
import { extname, isAbsolute, join, resolve, sep } from 'path';

const APP_ROOTS = [
	'/usr/palm/applications',
	'/media/cryptofs/apps/usr/palm/applications',
	'/media/developer/apps/usr/palm/applications',
] as const;

const MAX_ICON_BYTES = 2 * 1024 * 1024;
const ICON_CACHE_MAX_ENTRIES = 128;

type IconCacheEntry = {
	mtimeMs: number;
	size: number;
	dataUrl: string;
};

const iconCache = new Map<string, IconCacheEntry>();

type AppInfo = {
	id?: unknown;
	icon?: unknown;
	mediumLargeIcon?: unknown;
	largeIcon?: unknown;
	extraLargeIcon?: unknown;
};

export type IconRequest = {
	id?: string;
	folderPath?: string;
	paths?: string[];
};

const isString = (value: unknown): value is string =>
	typeof value === 'string' && value.trim().length > 0;

const containsPath = (root: string, candidate: string): boolean =>
	candidate === root || candidate.startsWith(`${root}${sep}`);

const canonicalAllowedPath = async (candidate: string): Promise<string | null> => {
	let realCandidate: string;
	try {
		realCandidate = await fs.realpath(candidate);
	} catch {
		return null;
	}

	for (const root of APP_ROOTS) {
		try {
			const realRoot = await fs.realpath(root);
			if (containsPath(realRoot, realCandidate)) return realCandidate;
		} catch {
			// Root does not exist on this installation.
		}
	}

	return null;
};

const lexicalAllowedPath = (candidate: string): boolean => {
	const normalized = resolve(candidate);
	return APP_ROOTS.some(root => containsPath(resolve(root), normalized));
};

const mimeFor = (path: string): string | null => {
	switch (extname(path).toLowerCase()) {
		case '.png':
			return 'image/png';
		case '.jpg':
		case '.jpeg':
			return 'image/jpeg';
		case '.webp':
			return 'image/webp';
		case '.svg':
			return 'image/svg+xml';
		default:
			return null;
	}
};

const cacheIcon = (canonical: string, entry: IconCacheEntry): string => {
	iconCache.delete(canonical);
	iconCache.set(canonical, entry);
	while (iconCache.size > ICON_CACHE_MAX_ENTRIES) {
		const oldest = iconCache.keys().next().value as string | undefined;
		if (oldest === undefined) break;
		iconCache.delete(oldest);
	}
	return entry.dataUrl;
};

const readIconFile = async (candidate: string): Promise<string | null> => {
	if (!lexicalAllowedPath(candidate)) return null;

	try {
		const canonical = await canonicalAllowedPath(candidate);
		if (!canonical) return null;

		const mime = mimeFor(canonical);
		if (!mime) return null;

		const stat = await fs.stat(canonical);
		if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ICON_BYTES) return null;

		const cached = iconCache.get(canonical);
		if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
			return cacheIcon(canonical, cached);
		}

		const buffer = await fs.readFile(canonical);
		if (buffer.length !== stat.size || buffer.length > MAX_ICON_BYTES) return null;

		return cacheIcon(canonical, {
			mtimeMs: stat.mtimeMs,
			size: stat.size,
			dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
		});
	} catch {
		return null;
	}
};

const resolveCandidate = (candidate: string, folderPath?: string): string | null => {
	if (!candidate || /^(?:data|blob|https?|file):/i.test(candidate)) return null;
	if (isAbsolute(candidate)) return lexicalAllowedPath(candidate) ? resolve(candidate) : null;
	if (!folderPath || !lexicalAllowedPath(folderPath)) return null;

	const combined = resolve(folderPath, candidate);
	return lexicalAllowedPath(combined) ? combined : null;
};

const readAppInfo = async (id: string): Promise<{ directory: string; appInfo: AppInfo } | null> => {
	if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;

	for (const root of [...APP_ROOTS].reverse()) {
		const directory = join(root, id);

		try {
			const canonicalDirectory = await canonicalAllowedPath(directory);
			if (!canonicalDirectory) continue;

			const appInfoPath = join(canonicalDirectory, 'appinfo.json');
			const canonicalAppInfoPath = await canonicalAllowedPath(appInfoPath);
			if (!canonicalAppInfoPath) continue;

			const appInfo = JSON.parse(await fs.readFile(canonicalAppInfoPath, 'utf8')) as AppInfo;
			return { directory: canonicalDirectory, appInfo };
		} catch {
			// Try the next root.
		}
	}

	return null;
};

export const readLaunchPointIcon = async ({
	id,
	folderPath,
	paths = [],
}: IconRequest): Promise<string | null> => {
	for (const candidate of paths) {
		if (!isString(candidate)) continue;
		const resolved = resolveCandidate(candidate, folderPath);
		if (!resolved) continue;
		const dataUrl = await readIconFile(resolved);
		if (dataUrl) return dataUrl;
	}

	if (!id) return null;
	const app = await readAppInfo(id);
	if (!app) return null;

	for (const candidate of [
		app.appInfo.mediumLargeIcon,
		app.appInfo.largeIcon,
		app.appInfo.extraLargeIcon,
		app.appInfo.icon,
	]) {
		if (!isString(candidate)) continue;
		const path = resolve(isAbsolute(candidate) ? candidate : join(app.directory, candidate));
		const dataUrl = await readIconFile(path);
		if (dataUrl) return dataUrl;
	}

	return null;
};
