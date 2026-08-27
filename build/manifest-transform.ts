export type ManifestReplacements = Record<string, string>;

export const createManifestTransformer = (replacements: ManifestReplacements) =>
	(content: Buffer): string => {
		let transformed = content.toString('utf8');
		for (const [key, value] of Object.entries(replacements)) {
			transformed = transformed.split(`@${key}@`).join(value);
		}
		return transformed;
	};
