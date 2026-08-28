import { useCallback, useEffect, useRef, useState } from 'react';

import { observer } from 'mobx-react-lite';

import { luna } from 'shared/services/luna';

import { useRibbonService } from '../../services';
import {
	keypadMicomKeycode,
	moveNumericKeypadSelection,
	NUMERIC_KEYPAD_COLOURS,
	NUMERIC_KEYPAD_DIGITS,
	NUMERIC_REMOTE_KEY_INTERVAL_MS,
	type NumericKeypadDirection,
	type NumericKeypadSelection,
} from './numeric-keyboard.lib';

import s from './numeric-keyboard-proxy.module.scss';

const delay = (milliseconds: number): Promise<void> =>
	new Promise(resolve => {
		setTimeout(resolve, milliseconds);
	});

export const NumericKeyboardProxy = observer((): JSX.Element | null => {
	const service = useRibbonService();
	const [selectedKey, setSelectedKey] = useState<NumericKeypadSelection>('1');
	const selectedKeyRef = useRef<NumericKeypadSelection>('1');
	const sendQueue = useRef<Promise<void>>(Promise.resolve());

	const selectKey = useCallback((key: NumericKeypadSelection): void => {
		selectedKeyRef.current = key;
		setSelectedKey(key);
	}, []);

	const sendKey = useCallback((key: NumericKeypadSelection): void => {
		const keycode = keypadMicomKeycode(key);
		selectKey(key);
		if (keycode === null) {
			console.error(`No MICOM keycode for keypad selection: ${key}`);
			return;
		}

		// Keep presses ordered and remote-like so multi-digit channel entry and
		// colour-key actions behave like physical remote button presses.
		sendQueue.current = sendQueue.current.then(async () => {
			await luna('luna://com.webos.service.micomservice/sendKeycode', { keycode });
			await delay(NUMERIC_REMOTE_KEY_INTERVAL_MS);
		}).catch(error => {
			console.error('Unable to send keypad remote key:', error);
		});
	}, [selectKey]);

	const close = useCallback((): void => {
		service.closeNumericKeypad();
	}, [service]);

	const moveSelection = useCallback((direction: NumericKeypadDirection): void => {
		selectKey(moveNumericKeypadSelection(selectedKeyRef.current, direction));
	}, [selectKey]);

	useEffect(() => {
		service.keyboardService.registerOwner('keypad', {
			horizontal: shift => moveSelection(shift < 0 ? 'left' : 'right'),
			vertical: shift => moveSelection(shift < 0 ? 'up' : 'down'),
			enter: () => sendKey(selectedKeyRef.current),
			back: close,
			digit: digit => sendKey(digit),
		});
		return () => service.keyboardService.unregisterOwner('keypad');
	}, [close, moveSelection, sendKey, service]);

	useEffect(() => {
		if (service.numericKeypadVisible) selectKey('1');
	}, [selectKey, service.numericKeypadVisible]);

	if (!service.numericKeypadVisible) return null;

	return (
		<div
			className={s.keypad}
			role='dialog'
			aria-label='Numeric and colour remote keypad'
		>
			<div className={s.header}>
				<span>Number pad</span>
				<button
					className={s.close}
					type='button'
					aria-label='Close keypad'
					onClick={close}
				>
					×
				</button>
			</div>
			<div className={s.grid}>
				{NUMERIC_KEYPAD_DIGITS.map(digit => (
					<button
						key={digit}
						type='button'
						className={`${s.key} ${digit === selectedKey ? s.selected : ''} ${digit === '0' ? s.zero : ''}`}
						onMouseEnter={() => selectKey(digit)}
						onClick={() => sendKey(digit)}
					>
						{digit}
					</button>
				))}
			</div>
			<div className={s.colourRow} aria-label='Remote colour buttons'>
				{NUMERIC_KEYPAD_COLOURS.map(({ id }) => (
					<button
						key={id}
						type='button'
						aria-label={`${id[0].toUpperCase()}${id.slice(1)} remote button`}
						className={`${s.colourKey} ${s[id]} ${id === selectedKey ? s.selectedColour : ''}`}
						onMouseEnter={() => selectKey(id)}
						onClick={() => sendKey(id)}
					/>
				))}
			</div>
		</div>
	);
});
