import React from 'react';
import ReactDOM from 'react-dom/client';

import { luna } from './shared/services/luna';
import { App } from './app';
import { bootstrapHomeBack } from './bootstrap';
import { hasCompletedSetup, markSetupComplete } from './setup-state';

import './app/styles/global.scss';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
const setupComplete = hasCompletedSetup(window.localStorage);
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

/**
 * Normal HOME launches should not replay the privileged bootstrap path. Query
 * the cheap status endpoint first and only ask the idempotent remote/start path
 * to reconcile if the helper is not already healthy.
 */
const ensureRemoteInput = async (): Promise<void> => {
	try {
		const response = await luna<RemoteStatusResponse>(
			`luna://${process.env.SERVICE_ID}/remote/status`,
		);
		if (response.status.started && response.status.nativeOwnershipVerified) return;
		await luna(`luna://${process.env.SERVICE_ID}/remote/start`);
	} catch (error) {
		console.error('HomeBack background remote-input health check failed:', error);
	}
};

if (setupComplete) {
	renderApp();
	void ensureRemoteInput();
} else {
	renderSetup();
	void bootstrapHomeBack(() => markSetupComplete(window.localStorage))
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
