import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './app';
import { bootstrapHomeBack } from './bootstrap';
import { luna, LunaError } from './shared/services/luna';
import {
	hasCompletedSetup,
	hasCurrentPermissionSchema,
	markCurrentPermissionSchema,
	markSetupComplete,
} from './setup-state';

import './app/styles/global.scss';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
const setupComplete = hasCompletedSetup(window.localStorage);
const permissionSchemaCurrent = hasCurrentPermissionSchema(window.localStorage);
let appRendered = false;

const renderApp = (): void => {
	if (appRendered) return;
	appRendered = true;
	root.render(
		<React.StrictMode>
			<App />
		</React.StrictMode>,
	);
};

const renderSetup = (): void => {
	root.render(
		<div style={{ padding: 48, color: 'white', fontFamily: 'sans-serif', fontSize: 28 }}>
			<h2>Setting up HomeBack…</h2>
			<p>Preparing launcher permissions and remote input.</p>
		</div>,
	);
};

const renderBootstrapError = (error: unknown): void => {
	const message = error instanceof Error ? error.message : String(error);
	root.render(
		<div style={{ padding: 48, color: 'white', fontFamily: 'sans-serif', fontSize: 28 }}>
			<h2>HomeBack setup failed</h2>
			<p>{message}</p>
			<p>Confirm Homebrew Channel reports root access as OK, then launch HomeBack again.</p>
		</div>,
	);
};

type RemoteStatusResponse = {
	returnValue: true;
	done: true;
	status: {
		started?: boolean;
		nativeOwnershipVerified?: boolean;
	};
};

const markPermissionSchemaCurrent = (): void =>
	markCurrentPermissionSchema(window.localStorage);

const reconcileBootstrap = async (): Promise<void> => {
	try {
		await bootstrapHomeBack(markPermissionSchemaCurrent);
	} catch (error) {
		console.error('HomeBack client-permission reconciliation failed:', error);
	}
};

/**
 * Normal HOME launches avoid replaying the privileged bootstrap path when the
 * helper is healthy. A -401 means an install/reinstall lost service elevation,
 * so recover through the same idempotent bootstrap/elevation path used by first setup.
 */
const ensureRemoteInput = async (): Promise<void> => {
	try {
		const response = await luna<RemoteStatusResponse>(
			`luna://${process.env.SERVICE_ID}/remote/status`,
		);
		if (response.status.started && response.status.nativeOwnershipVerified) return;
		await luna(`luna://${process.env.SERVICE_ID}/remote/start`);
	} catch (error) {
		if (error instanceof LunaError && error.errorCode === -401) {
			await reconcileBootstrap();
			return;
		}
		console.error('HomeBack background remote-input health check failed:', error);
	}
};

if (setupComplete) {
	renderApp();
	if (permissionSchemaCurrent) {
		void ensureRemoteInput();
	} else {
		void reconcileBootstrap();
	}
} else {
	renderSetup();
	void bootstrapHomeBack(() => {
		markSetupComplete(window.localStorage);
		markPermissionSchemaCurrent();
	})
		.then(state => {
			if (state === 'restarting') {
				// /restartApp is intentionally fire-and-forget in the helper. If SAM
				// accepts the request but the subsequent relaunch fails, do not strand
				// this still-running webview on the setup screen indefinitely.
				setTimeout(renderApp, 3_000);
				return;
			}
			renderApp();
		})
		.catch(renderBootstrapError);
}
