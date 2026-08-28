import { resolve } from 'node:path';

import { DefinePlugin } from 'webpack';

import CopyPlugin from 'copy-webpack-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';

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
	id: APP_ID,
	name: 'app',
	target: 'web',
	mode: argv.mode ?? 'development',
	context: __dirname,
	entry: './src/index.tsx',
	devtool: argv.mode === 'development' ? 'source-map' : false,
	devServer: {
		hot: true,
	},
	output: {
		filename: 'app.js',
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
			{
				test: /\.scss$/,
				use: [
					MiniCssExtractPlugin.loader,
					'css-loader',
					{
						loader: 'postcss-loader',
						options: {
							postcssOptions: {
								plugins: ['postcss-preset-env'],
							},
						},
					},
					{
						loader: 'sass-loader',
						options: { api: 'modern' },
					},
				],
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
			'process.env.APP_ID': JSON.stringify(APP_ID),
			'process.env.SERVICE_ID': JSON.stringify(SERVICE_ID),
		}),
		new MiniCssExtractPlugin(),
		new HtmlWebpackPlugin({
			template: './src/app/index.html',
		}),
		new CopyPlugin({
			patterns: [
				{
					from: '**/*',
					context: './manifests',
					globOptions: { ignore: ['**/*.json'] },
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
