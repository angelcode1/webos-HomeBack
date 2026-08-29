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
			// Reuse only an in-flight hide that is still logically hiding the Ribbon.
			// If another relaunch reopened it, the old waiter is stale and a fresh
			// hide must own the transition before a probe may start.
			if (ribbonQuiesce && !ribbonService.visible) return ribbonQuiesce;
			ribbonQuiesce = null;

			ribbonService.hide();
			const pending = ribbonService.waitUntilHidden()
				.catch(error => {
					console.warn('[HomeBackPreviewProbe] unable to quiesce Ribbon before probe', error);
					throw error;
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
				// Ribbon commit. If the committed hide fails, fail closed and do not
				// run a contaminated hardware measurement.
				if (ribbonQuiesce || ribbonService.visible) {
					const pending = ribbonQuiesce && !ribbonService.visible
						? ribbonQuiesce
						: beginRibbonQuiesce();
					void pending.then(showProbe, () => undefined);
					return;
				}

				showProbe();
				return;
			}

			// Any non-probe relaunch invalidates an in-flight probe transition. Its
			// waiter may still settle later, but it must never be reused by a future
			// probe after HOME/show has reopened the Ribbon.
			ribbonQuiesce = null;
			setMode({ kind: 'ribbon' });
		};

		document.addEventListener('webOSRelaunch', handleRelaunch);
		return () => {
			relaunchRevision += 1;
			ribbonQuiesce = null;
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
