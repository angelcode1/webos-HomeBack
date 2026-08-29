import { useCallback, useEffect, useState } from 'react';

import { Intent, parseActivateType, type ActivateType } from 'shared/api/common';

import { PreviewInputProbe } from '../features/preview-input-probe';
import { Ribbon } from '../features/ribbon';
import { ribbonService } from '../features/ribbon/services';

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
		let relaunchRevision = 0;

		const handleRelaunch = (event: CustomEvent<ActivateType>): void => {
			const revision = ++relaunchRevision;
			console.warn('[HomeBackPreviewProbe] webOSRelaunch', event.detail);
			if (event.detail?.intent === Intent.PreviewInputProbe) {
				const showProbe = (): void => {
					if (revision !== relaunchRevision) return;
					setMode(current => ({
						kind: 'probe',
						activation: event.detail ?? {},
						sequence: current.kind === 'probe' ? current.sequence + 1 : 1,
					}));
				};

				// A probe launched from an already-visible Ribbon must first quiesce
				// the old Ribbon-owned keyboard and auto-hide machinery. Waiting here
				// is experiment-only and does not affect the cold preview measurement.
				if (!ribbonService.visible) {
					showProbe();
					return;
				}

				ribbonService.hide();
				void ribbonService.waitUntilHidden()
					.catch(error => {
						console.warn('[HomeBackPreviewProbe] unable to quiesce Ribbon before probe', error);
					})
					.finally(showProbe);
				return;
			}

			setMode({ kind: 'ribbon' });
		};

		document.addEventListener('webOSRelaunch', handleRelaunch);
		return () => {
			relaunchRevision += 1;
			document.removeEventListener('webOSRelaunch', handleRelaunch);
		};
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
