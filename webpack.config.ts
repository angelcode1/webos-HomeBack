import { hoc } from '@webosbrew/webos-packager-plugin';

import app from '@homeback/app/webpack.config';
import pipApp from '@homeback/pip-app/webpack.config';
import service from '@homeback/service/webpack.config';

import { PIP_APP_ID } from './build/project';
import { id, version } from './package.json';

const homeBackPackage = hoc({
	id,
	version,
	app,
	services: [service],
});

const cameraPipPackage = hoc({
	id: PIP_APP_ID,
	version,
	app: pipApp,
});

const config = (
	env: { WEBPACK_SERVE?: boolean },
	argv: { mode?: 'none' | 'development' | 'production' },
) => [...homeBackPackage(env, argv), ...cameraPipPackage(env, argv)];

export default config;
