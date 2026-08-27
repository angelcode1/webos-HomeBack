import { useEffect, useRef } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';

import { luna } from 'shared/services/luna';

import { useRibbonService } from '../../services';
import {
	isRemoteBackKey,
	NUMERIC_REMOTE_KEY_INTERVAL_MS,
	numericMicomKeycodes,
} from './numeric-keyboard.lib';

const proxyStyle: CSSProperties = {
	position: 'fixed',
	// webOS moves app content upward when a focused input is in the lower part
	// of the screen. Keep the proxy here intentionally so the numeric keyboard
	// rises from the bottom while the HomeBack tray is shifted above it.
	bottom: 0,
	left: '50%',
	width: 2,
	height: 2,
	opacity: 0.01,
	pointerEvents: 'none',
	border: 0,
	padding: 0,
	margin: 0,
};

const delay = (milliseconds: number): Promise<void> =>
	new Promise(resolve => {
		setTimeout(resolve, milliseconds);
	});

export const NumericKeyboardProxy = (): JSX.Element => {
	const service = useRibbonService();
	const ref = useRef<HTMLInputElement>(null);
	const sendQueue = useRef<Promise<void>>(Promise.resolve());

	useEffect(() => {
		const open = () => {
			const input = ref.current;
			if (!input) return;
			input.value = '';
			input.focus();
		};

		service.launcherService.emitter.on('openNumericKeyboard', open);
		return () => {
			service.launcherService.emitter.off('openNumericKeyboard', open);
		};
	}, [service]);

	useEffect(() => {
		const dismissOnRemoteBack = (event: KeyboardEvent): void => {
			const input = ref.current;
			if (!input || document.activeElement !== input || !isRemoteBackKey(event)) return;

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			input.value = '';
			input.blur();
		};

		// Capture Back before the app-level navigation handler. A focused input is
		// otherwise treated as editable and webOS may close/leave the app instead
		// of merely dismissing the numeric keyboard.
		document.addEventListener('keydown', dismissOnRemoteBack, true);
		return () => {
			document.removeEventListener('keydown', dismissOnRemoteBack, true);
		};
	}, []);

	const handleInput = (event: FormEvent<HTMLInputElement>): void => {
		const input = event.currentTarget;
		const keycodes = numericMicomKeycodes(input.value);
		input.value = '';
		if (keycodes.length === 0) return;

		// Serialize number presses and leave a short remote-like gap between them.
		// This avoids LS2 bursts and makes multi-digit channel entry deterministic.
		sendQueue.current = sendQueue.current.then(async () => {
			for (const keycode of keycodes) {
				await luna('luna://com.webos.service.micomservice/sendKeycode', { keycode });
				await delay(NUMERIC_REMOTE_KEY_INTERVAL_MS);
			}
		}).catch(error => {
			console.error('Unable to send numeric remote key:', error);
		});
	};

	const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
		if (isRemoteBackKey(event)) {
			event.preventDefault();
			event.stopPropagation();
			event.currentTarget.value = '';
			event.currentTarget.blur();
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			event.currentTarget.blur();
		}
	};

	return (
		<input
			ref={ref}
			type='number'
			inputMode='numeric'
			pattern='[0-9]*'
			autoComplete='off'
			aria-label='Numeric remote keypad input'
			style={proxyStyle}
			onInput={handleInput}
			onKeyDown={handleKeyDown}
		/>
	);
};
