import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath: string): string =>
	fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

test('review hardening and cleanup remain applied', () => {
	const launcher = read('packages/app/src/shared/services/launcher/model/launcher.service.ts');
	const keyboard = read('packages/app/src/shared/services/keyboard/keyboard.service.ts');
	const keypad = read('packages/app/src/features/ribbon/ui/numeric-keyboard-proxy/numeric-keyboard-proxy.component.tsx');
	const ribbon = read('packages/app/src/features/ribbon/services/ribbon/ribbon.service.ts');
	const settings = read('packages/app/src/shared/services/settings/model/settings.service.ts');
	const provider = read('packages/app/src/shared/services/launcher/providers/internal/internal.provider.ts');
	const card = read('packages/app/src/features/ribbon/ui/ribbon-card/ribbon-card.component.tsx');
	const cardCss = read('packages/app/src/features/ribbon/ui/ribbon-card/ribbon-card.module.scss');
	const webpack = read('packages/app/webpack.config.ts');

	assert.match(launcher, /private set order\(value: string\[\]\) \{\n\t\tif \(!this\.fulfilled\) return;/);
	assert.match(keyboard, /registerOwner[\s\S]*return \(\) =>/);
	assert.match(keypad, /return service\.keyboardService\.registerOwner\('keypad'/);
	assert.match(ribbon, /remoteHealthTimer/);
	assert.match(ribbon, /public dispose\(\): void/);
	assert.match(settings, /const KEY = 'homeback:settings'/);
	assert.match(settings, /const LEGACY_KEY = 'althome:settings'/);
	assert.match(provider, /const plusIcon = svgIcon/);
	assert.doesNotMatch(provider, /plus\.png/);
	assert.doesNotMatch(card, /COLOUR_BUTTON|colourCard|colourIcon/);
	assert.doesNotMatch(cardCss, /colourCard|colourIcon|colour-card-width/);
	assert.doesNotMatch(webpack, /test: \/\\\.png\$\//);
	assert.equal(fs.existsSync(path.resolve(process.cwd(), 'packages/app/src/assets/plus.png')), false);
});
