/* eslint-disable prefer-destructuring */

export const APP_ID = process.env.APP_ID;
export const APP_VERSION = process.env.APP_VERSION;
export const SERVICE_ID = process.env.SERVICE_ID;

// Webpack emits service.js into the LS2 service root. __dirname therefore
// remains stable regardless of which cwd SAM/LS2 uses when activating us.
export const SERVICE_ROOT_DIR = __dirname;
export const APPLICATION_MANAGER_URI = 'luna://com.webos.service.applicationManager';
