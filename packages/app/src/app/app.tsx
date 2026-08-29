import { useCallback, useEffect, useState } from 'react';

import { Intent, parseActivateType, type ActivateType } from 'shared/api/common';

import { PreviewInputProbe } from '../features/preview-input-probe';
import { Ribbon } from '../features/ribbon';

type AppMode =
	| { kind: 'ribbon' }
	| { kind: 'idle' }
	| { kind: 'probe'; activation: ActivateType; sequence: number };

const initialAppMode = (): AppMode => {
	const activation = parseActivateType(webOSSystem.launchParams);
	return activation.intent === Intent.PreviewInputProbe
		? { kind: 'probe', activation, sequence: 1 }
		: { kind: 'ribbon' };
};

export const App = (): JSX.Element | null => {
	const [mode, setMode] = useState<AppMode>(initialAppMode);

	useEffect(() => {
		const handleRelaunch = (event: CustomEvent<ActivateType>): void => {
			console.info('[HomeBackPreviewProbe] webOSRelaunch', event.detail);
			if (event.detail?.intent === Intent.PreviewInputProbe) {
				setMode(current => ({
					kind: 'probe',
					activation: event.detail ?? {},
					sequence: current.kind === 'probe' ? current.sequence + 1 : 1,
				}));
				return;
			}

			setMode({ kind: 'ribbon' });
		};

		document.addEventListener('webOSRelaunch', handleRelaunch);
		return () => document.removeEventListener('webOSRelaunch', handleRelaunch);
	}, []);

	const handleProbeComplete = useCallback((): void => {
		setMode({ kind: 'idle' });
	}, []);

	if (mode.kind === 'probe') {
		return (
			<PreviewInputProbe
				key={mode.sequence}
				activation={mode.activation}
				onComplete={handleProbeComplete}
			/>
		);
	}
	if (mode.kind === 'idle') return null;
	return <Ribbon />;
};
