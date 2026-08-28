import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, MouseEvent } from 'react';

import { observer } from 'mobx-react-lite';

import { HOLD_THRESHOLD_MS, useRibbonService } from '../../services';
import { AppIcon } from '../app-icon';
import type { RibbonCardProps } from './ribbon-card.interface';

import s from './ribbon-card.module.scss';

const COLOUR_BUTTON = /^@button:(red|green|yellow|blue)$/;

const cx = (...classes: Array<string | false | undefined>): string =>
	classes.filter(Boolean).join(' ');

type EditControlProps = {
	className: string;
	label?: string;
	onMouseEnter?: () => void;
	onMouseDown: (event: MouseEvent<HTMLSpanElement>) => void;
	onClick: (event: MouseEvent<HTMLSpanElement>) => void;
	children: JSX.Element;
};

const EditControl = ({
	className,
	label,
	onMouseEnter,
	onMouseDown,
	onClick,
	children,
}: EditControlProps): JSX.Element => (
	<span
		className={className}
		title={label}
		onMouseEnter={onMouseEnter}
		onMouseDown={onMouseDown}
		onClick={onClick}
	>
		{children}
	</span>
);

const Chevron = ({ direction }: { direction: 'left' | 'right' }): JSX.Element => (
	<svg viewBox='0 0 24 24' aria-hidden='true'>
		<path
			d={direction === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}
			fill='none'
			stroke='currentColor'
			strokeWidth='2.5'
			strokeLinecap='round'
			strokeLinejoin='round'
		/>
	</svg>
);

export const RibbonCard = observer(
	({ position, launchPoint }: RibbonCardProps): JSX.Element => {
		const service = useRibbonService();
		const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
		const holdFiredRef = useRef(false);

		const isSelected = service.selectedLaunchPoint === launchPoint;
		const editing = isSelected && service.moving && !launchPoint.builtin;
		const isColourButton = COLOUR_BUTTON.test(launchPoint.launchPointId);
		const isInputTile = launchPoint.launchPointId === '@button:inputs';
		const isCompactUtility =
			launchPoint.launchPointId === '@button:keypad' ||
			launchPoint.launchPointId === '@intent:add_apps';

		const style = useMemo<CSSProperties>(
			() => ({
				zIndex: isSelected ? 1000 : position + 5,
				'--card-color': launchPoint.iconColor,
			} as CSSProperties),
			[position, isSelected, launchPoint.iconColor],
		);

		const clearHoldTimer = useCallback(() => {
			if (holdTimerRef.current === null) return;
			clearTimeout(holdTimerRef.current);
			holdTimerRef.current = null;
		}, []);

		useEffect(() => () => clearHoldTimer(), [clearHoldTimer]);

		const handleMouseEnter = useCallback(() => {
			if (!service.moving && !service.scrollService.isAnimating()) {
				service.focusToLaunchPoint(launchPoint);
			}
		}, [service, launchPoint]);

		const handleMouseDown = useCallback((event: MouseEvent<HTMLButtonElement>) => {
			if (event.button !== 0 || launchPoint.builtin || service.moving) return;

			service.focusToLaunchPoint(launchPoint);
			clearHoldTimer();
			holdFiredRef.current = false;
			holdTimerRef.current = setTimeout(() => {
				holdTimerRef.current = null;
				holdFiredRef.current = true;
				service.beginEditing(launchPoint);
			}, HOLD_THRESHOLD_MS);
		}, [service, launchPoint, clearHoldTimer]);

		const handleMouseUp = useCallback(() => {
			clearHoldTimer();
		}, [clearHoldTimer]);

		const handleMouseLeave = useCallback(() => {
			clearHoldTimer();
			holdFiredRef.current = false;
		}, [clearHoldTimer]);

		const handleClick = useCallback(() => {
			service.noteInteraction();
			if (holdFiredRef.current) {
				holdFiredRef.current = false;
				return;
			}

			if (service.moving) {
				if (service.selectedLaunchPoint === launchPoint) service.finishEditing();
				return;
			}

			void launchPoint.launch().catch(error => console.error('Launch failed:', error));
		}, [service, launchPoint]);

		const stopControlMouseDown = useCallback(
			(event: MouseEvent<HTMLSpanElement>) => {
				event.preventDefault();
				event.stopPropagation();
				clearHoldTimer();
			},
			[clearHoldTimer],
		);

		const moveLeft = useCallback((event: MouseEvent<HTMLSpanElement>) => {
			event.preventDefault();
			event.stopPropagation();
			service.moveEditing(-1);
		}, [service]);

		const moveRight = useCallback((event: MouseEvent<HTMLSpanElement>) => {
			event.preventDefault();
			event.stopPropagation();
			service.moveEditing(1);
		}, [service]);

		const removeFromTray = useCallback((event: MouseEvent<HTMLSpanElement>) => {
			event.preventDefault();
			event.stopPropagation();
			service.removeEditingLaunchPoint();
		}, [service]);

		return (
			<button
				className={cx(
					s.card,
					isSelected && s.selected,
					editing && s.editing,
					editing && s.moving,
					isColourButton && s.colourCard,
					isInputTile && s.inputCard,
					isCompactUtility && s.compactUtilityCard,
				)}
				onClick={handleClick}
				onMouseEnter={handleMouseEnter}
				onMouseDown={handleMouseDown}
				onMouseUp={handleMouseUp}
				onMouseLeave={handleMouseLeave}
				style={style}
			>
				<AppIcon
					src={launchPoint.icon}
					fallbackIcon={launchPoint.fallbackIcon}
					className={cx(
						s.icon,
						isColourButton && s.colourIcon,
						isInputTile && s.inputIcon,
						isCompactUtility && s.compactUtilityIcon,
					)}
					alt=''
				/>

				{editing && (
					<>
						<EditControl
							className={cx(
								s.editControl,
								s.removeControl,
								service.deleteFocused && s.removeFocused,
							)}
							label='Remove from HomeBack'
							onMouseEnter={service.focusDeleteControl}
							onMouseDown={stopControlMouseDown}
							onClick={removeFromTray}
						>
							<svg viewBox='0 0 24 24' aria-hidden='true'>
								<path
									d='M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5'
									fill='none'
									stroke='currentColor'
									strokeWidth='1.9'
									strokeLinecap='round'
									strokeLinejoin='round'
								/>
							</svg>
						</EditControl>

						{service.canMoveEditingLeft && (
							<EditControl
								className={cx(s.editControl, s.leftControl)}
								onMouseEnter={service.focusMoveControl}
								onMouseDown={stopControlMouseDown}
								onClick={moveLeft}
							>
								<Chevron direction='left' />
							</EditControl>
						)}

						{service.canMoveEditingRight && (
							<EditControl
								className={cx(s.editControl, s.rightControl)}
								onMouseEnter={service.focusMoveControl}
								onMouseDown={stopControlMouseDown}
								onClick={moveRight}
							>
								<Chevron direction='right' />
							</EditControl>
						)}
					</>
				)}
			</button>
		);
	},
);
