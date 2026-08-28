#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const expectedCommand = 'eslint --ext .ts,.tsx,.js .';
const workspaces = ['app', 'service', 'utils'];
const extensions = new Set(['.ts', '.tsx', '.js']);

const walk = directory => {
	const files = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.yarn') continue;
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...walk(absolute));
		else if (extensions.has(path.extname(entry.name))) files.push(absolute);
	}
	return files;
};

let failed = false;
for (const workspace of workspaces) {
	const directory = path.join(root, 'packages', workspace);
	const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
	const command = pkg.scripts?.lint;
	const files = walk(directory);
	const implementationFiles = files.filter(file => !file.endsWith('.d.ts'));

	if (command !== expectedCommand) {
		console.error(`${workspace}: lint command must be exactly: ${expectedCommand}`);
		failed = true;
	}
	if (implementationFiles.length === 0) {
		console.error(`${workspace}: no TypeScript/JavaScript implementation files would be linted`);
		failed = true;
	}

	console.log(
		`${workspace}: ${files.length} lint candidates (${implementationFiles.length} implementation files)`,
	);
}

if (failed) process.exit(1);
