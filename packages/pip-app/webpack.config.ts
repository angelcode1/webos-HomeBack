import { resolve } from 'node:path';

import { DefinePlugin } from 'webpack';

import CopyPlugin from 'copy-webpack-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';

import { createManifestTransformer } from '../../build/manifest-transform';
import { APP_VERSION, PIP_APP_ID, SERVICE_ID } from '../../build/project';

const transformManifest = createManifestTransformer({
	APP_ID: PIP_APP_ID,
	APP_VERSION,
	SERVICE_ID,
});

const config = (
	_: { WEBPACK_SERVE?: boolean },
	argv: { mode?: 'none' | 'development' | 'production' },
) => ({
	id: PIP_APP_ID,
	name: 'pip-app',
	target: 'web',
	mode: argv.mode ?? 'development',
	context: __dirname,
	entry: './src/index.tsx',
	devtool: argv.mode === 'development' ? 'source-map' : false,
	output: {
		filename: 'app.js',
		path: resolve(__dirname, '../../dist/pip-camera'),
	},
	resolve: {
		extensions: [...(argv.mode !== 'development' ? [] : ['.dev.ts']), '.js', '.ts', '.tsx'],
		tsconfig: resolve(__dirname, 'tsconfig.json'),
	},
	module: {
		rules: [
			{
				test: /\.[mc]?[jt]sx?$/,
				exclude: [/node_modules\/core-js/],
				use: {
					loader: 'babel-loader',
					options: {
						sourceType: 'unambiguous',
						presets: [
							[
								'@babel/env',
								{
									useBuiltIns: 'usage',
									corejs: '3.48',
								},
							],
							['@babel/react', { runtime: 'automatic' }],
							['@babel/typescript', { onlyRemoveTypeImports: true }],
						],
					},
				},
			},
		],
	},
	performance: {
		hints: argv.mode === 'production' ? 'warning' : false,
		maxEntrypointSize: 350_000,
		maxAssetSize: 350_000,
	},
	plugins: [
		new DefinePlugin({
			__DEV__: JSON.stringify(argv.mode === 'development'),
			'process.env.APP_ID': JSON.stringify(PIP_APP_ID),
			'process.env.SERVICE_ID': JSON.stringify(SERVICE_ID),
		}),
		new HtmlWebpackPlugin({
			template: './src/app/index.html',
		}),
		new CopyPlugin({
			patterns: [
				{
					from: resolve(__dirname, '../app/manifests/icon80.png'),
					to: 'icon80.png',
				},
				{
					from: resolve(__dirname, '../app/manifests/icon130.png'),
					to: 'icon130.png',
				},
				{
					from: '**/*.json',
					context: './manifests',
					transform: transformManifest,
					force: true,
				},
			],
		}),
	],
});

export default config;
