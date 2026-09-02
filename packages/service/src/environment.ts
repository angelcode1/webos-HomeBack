/* eslint-disable prefer-destructuring */

export { APPLICATION_MANAGER_URI } from '@homeback/utils';

export const APP_ID = process.env.APP_ID;
export const APP_VERSION = process.env.APP_VERSION;
export const SERVICE_ID = process.env.SERVICE_ID;

// Webpack emits service.js into the LS2 service root. __dirname therefore
// remains stable regardless of which cwd SAM/LS2 uses when activating us.
// The cwd fallback exists only for direct ESM source tests, where __dirname is
// intentionally unavailable and SERVICE_ROOT_DIR is not consumed.
export const SERVICE_ROOT_DIR = typeof __dirname === 'string' ? __dirname : process.cwd();
