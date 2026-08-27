import React from 'react';
import ReactDOM from 'react-dom/client';

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

// Setup is visible only until the first successful bootstrap. Persist completion
// before a one-time restart request so normal reboots never show setup again.
if (setupComplete) renderApp();
else renderSetup();

void bootstrapHomeBack(() => markSetupComplete(window.localStorage))
	.then(state => {
		if (state === 'restarting') return;
		renderApp();
	})
	.catch(error => {
		if (appRendered) {
			console.error('HomeBack background bootstrap failed:', error);
			return;
		}
		renderBootstrapError(error);
	});
