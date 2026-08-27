import { DefinePlugin } from 'webpack';

import CopyPlugin from 'copy-webpack-plugin';

import { createManifestTransformer } from '../../build/manifest-transform';
import {
	APP_ID,
	APP_VERSION,
	SERVICE_ID,
} from '../../build/project';

const transformManifest = createManifestTransformer({
	APP_ID,
	APP_VERSION,
	SERVICE_ID,
});

const config = (
	_: { WEBPACK_SERVE?: boolean },
	argv: { mode?: 'none' | 'development' | 'production' },
) => ({
	id: SERVICE_ID,
	name: 'service',
	mode: argv.mode ?? 'development',
	target: 'node12',
	context: __dirname,
	entry: './src/index.ts',
	devtool: argv.mode === 'development' ? 'cheap-module-source-map' : false,
	output: {
		filename: 'service.js',
	},
	externals: {
		palmbus: 'commonjs palmbus',
	},
	resolve: {
		extensions: ['.ts', '.js'],
	},
	optimization: {
		minimize: false,
	},
	module: {
		rules: [
			{
				test: /\.[jt]sx?$/,
				loader: 'babel-loader',
				options: {
					presets: [
						['@babel/env', { targets: { node: 12 } }],
						['@babel/typescript', { onlyRemoveTypeImports: true }],
					],
				},
			},
		],
	},
	plugins: [
		new DefinePlugin({
			__DEV__: JSON.stringify(argv.mode === 'development'),
			'process.env.APP_ID': JSON.stringify(APP_ID),
			'process.env.SERVICE_ID': JSON.stringify(SERVICE_ID),
		}),
		new CopyPlugin({
			patterns: [
				{
					from: '*.json',
					context: './manifests',
					transform: transformManifest,
				},
				{
					from: '**/*',
					context: './vendor/inputhook',
					to: 'inputhook/[name][ext]',
				},
			],
		}),
	],
});

export default config;
