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
		let ribbonQuiesce: Promise<void> | null = null;

		const beginRibbonQuiesce = (): Promise<void> => {
			if (ribbonQuiesce) return ribbonQuiesce;

			ribbonService.hide();
			const pending = ribbonService.waitUntilHidden()
				.catch(error => {
					console.warn('[HomeBackPreviewProbe] unable to quiesce Ribbon before probe', error);
				})
				.finally(() => {
					if (ribbonQuiesce === pending) ribbonQuiesce = null;
				});
			ribbonQuiesce = pending;
			return pending;
		};

		const handleRelaunch = (event: CustomEvent<ActivateType>): void => {
			const revision = ++relaunchRevision;
			console.warn(
				`[HomeBackPreviewProbe] webOSRelaunch detail=${JSON.stringify(event.detail ?? {})}`,
			);
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
				// the old Ribbon-owned keyboard and auto-hide machinery. Keep that
				// quiesce promise while its 500 ms visibility commit is outstanding so
				// replacement triggers cannot race ahead and be hidden by the stale
				// Ribbon commit. This remains experiment-only and does not affect the
				// cold probe measurement.
				if (ribbonQuiesce || ribbonService.visible) {
					const pending = ribbonQuiesce ?? beginRibbonQuiesce();
					void pending.finally(showProbe);
					return;
				}

				showProbe();
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
