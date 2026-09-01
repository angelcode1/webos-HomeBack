import { promises as fs } from 'fs';

import { buildNativeKeybinds, type RemoteConfig } from './remote-config.ts';
import { writeFile, writeFileAtomicSync } from './utils.ts';

const serializeNativeConfig = (config: RemoteConfig, timedMappingsArmed: boolean): string =>
	`${JSON.stringify(buildNativeKeybinds(config, timedMappingsArmed), null, '\t')}\n`;

export class NativeConfigWriter {
	private armed = false;
	private writeTail: Promise<void> = Promise.resolve();

	public constructor(private readonly path: string) {}

	public get timedMappingsArmed(): boolean {
		return this.armed;
	}

	public writeConfig(config: RemoteConfig): Promise<void> {
		return this.write(config, this.armed);
	}

	public async setArmed(config: RemoteConfig, armed: boolean): Promise<void> {
		if (this.armed === armed) return;
		const previous = this.armed;
		this.armed = armed;
		try {
			await this.write(config, armed);
			console.warn(`[HomeBackRemote] timed mappings ${armed ? 'armed' : 'disarmed'}`);
		} catch (error) {
			if (this.armed === armed) this.armed = previous;
			throw error;
		}
	}

	public disarmSync(config: RemoteConfig): void {
		writeFileAtomicSync(this.path, serializeNativeConfig(config, false), 0o644);
		this.armed = false;
	}

	private write(config: RemoteConfig, armed: boolean): Promise<void> {
		const serialized = serializeNativeConfig(config, armed);
		const run = this.writeTail.catch(() => undefined).then(async () => {
			let current = '';
			try {
				current = await fs.readFile(this.path, 'utf8');
			} catch {
				// Write below.
			}
			if (current !== serialized) await writeFile(this.path, serialized, 0o644);
		});
		this.writeTail = run.catch(() => undefined);
		return run;
	}
}
