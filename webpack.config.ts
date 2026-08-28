import { hoc } from '@webosbrew/webos-packager-plugin';

import app from '@homeback/app/webpack.config';
import service from '@homeback/service/webpack.config';

import { id, version } from './package.json';

export default hoc({
	id,
	version,
	app,
	services: [service],
});
