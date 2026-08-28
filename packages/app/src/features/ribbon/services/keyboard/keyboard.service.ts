import type {
	KeyboardOwner,
	KeyboardOwnerHandlers,
	RemoteDigit,
	Shift,
} from './keyboard.interface';
import { ArrowKey, HOLD_THRESHOLD_MS } from './keyboard.lib';

type KeyboardTarget = HTMLElement | Document;

/**
 * Single remote-key dispatcher for the HomeBack surface.
 *
 * Exactly one owner (ribbon, drawer or keypad) receives semantic key events at
 * a time, avoiding capture-order dependencies between multiple document
 * listeners.
 */
export class KeyboardService {
	private ref: KeyboardTarget | null = null;
	private capture = true;
	private enterTimer: ReturnType<typeof setTimeout> | null = null;
	private holdFired = false;
	private owner: KeyboardOwner = 'ribbon';
	private readonly handlers = new Map<KeyboardOwner, KeyboardOwnerHandlers>();

	public constructor() {
		this.handleKeyDown = this.handleKeyDown.bind(this);
		this.handleKeyUp = this.handleKeyUp.bind(this);
	}

	public registerOwner(owner: KeyboardOwner, handlers: KeyboardOwnerHandlers): void {
		this.handlers.set(owner, handlers);
	}

	public unregisterOwner(owner: KeyboardOwner): void {
		this.handlers.delete(owner);
		if (this.owner !== owner) return;
		this.owner = 'ribbon';
		this.resetEnterState();
	}

	public setOwner(owner: KeyboardOwner): void {
		if (this.owner === owner) return;
		this.owner = owner;
		this.resetEnterState();
	}

	public isOwner(owner: KeyboardOwner): boolean {
		return this.owner === owner;
	}

	public subscribe(ref: KeyboardTarget = document, capture = true): void {
		if (this.ref === ref && this.capture === capture) return;
		this.unsubscribe();
		this.ref = ref;
		this.capture = capture;
		this.ref.addEventListener('keydown', this.handleKeyDown as EventListener, this.capture);
		this.ref.addEventListener('keyup', this.handleKeyUp as EventListener, this.capture);
	}

	public unsubscribe(): void {
		if (this.ref) {
			this.ref.removeEventListener('keydown', this.handleKeyDown as EventListener, this.capture);
			this.ref.removeEventListener('keyup', this.handleKeyUp as EventListener, this.capture);
		}
		this.ref = null;
		this.resetEnterState();
	}

	private get activeHandlers(): KeyboardOwnerHandlers {
		return this.handlers.get(this.owner) ?? {};
	}

	private debug(event: KeyboardEvent): void {
		if (!__DEV__) return;
		console.info(
			`[HomeBackKeyDBG] type=${event.type} owner=${this.owner} key=${event.key} code=${event.code}` +
				` keyCode=${event.keyCode} which=${event.which} repeat=${event.repeat}`,
		);
	}

	private consume(event: KeyboardEvent): void {
		event.preventDefault();
		event.stopPropagation();
	}

	private isEnter(event: KeyboardEvent): boolean {
		return event.key === 'Enter' || event.keyCode === 13 || event.which === 13;
	}

	private isBack(event: KeyboardEvent): boolean {
		return (
			event.key === 'GoBack' ||
			event.key === 'BrowserBack' ||
			event.keyCode === 461 ||
			event.which === 461
		);
	}

	private arrowKey(event: KeyboardEvent): ArrowKey | null {
		switch (event.key) {
			case ArrowKey.Left: return ArrowKey.Left;
			case ArrowKey.Right: return ArrowKey.Right;
			case ArrowKey.Up: return ArrowKey.Up;
			case ArrowKey.Down: return ArrowKey.Down;
			default: break;
		}
		switch (event.keyCode || event.which) {
			case 37: return ArrowKey.Left;
			case 38: return ArrowKey.Up;
			case 39: return ArrowKey.Right;
			case 40: return ArrowKey.Down;
			default: return null;
		}
	}

	private remoteDigit(event: KeyboardEvent): RemoteDigit | null {
		if (event.key && /^[0-9]$/.test(event.key)) return event.key as RemoteDigit;
		const code = event.keyCode || event.which || 0;
		if (code >= 48 && code <= 57) return String(code - 48) as RemoteDigit;
		if (code >= 96 && code <= 105) return String(code - 96) as RemoteDigit;
		return null;
	}

	private handleKeyDown(event: KeyboardEvent): void {
		this.debug(event);
		const arrow = this.arrowKey(event);
		const enter = this.isEnter(event);
		const back = this.isBack(event);
		const digit = this.owner === 'keypad' ? this.remoteDigit(event) : null;
		if (!arrow && !enter && !back && !digit) return;

		this.consume(event);
		if (back) {
			if (!event.repeat) this.activeHandlers.back?.();
			return;
		}
		if (digit) {
			if (!event.repeat) this.activeHandlers.digit?.(digit);
			return;
		}
		if (enter) {
			if (this.owner === 'ribbon') this.handleRibbonEnterKeyDown(event);
			else if (!event.repeat) this.activeHandlers.enter?.();
			return;
		}
		if (arrow && !event.repeat) this.handleArrowKeyDown(arrow);
	}

	private handleKeyUp(event: KeyboardEvent): void {
		this.debug(event);
		const handled = this.arrowKey(event) || this.isEnter(event) || this.isBack(event) ||
			(this.owner === 'keypad' && this.remoteDigit(event));
		if (!handled) return;
		this.consume(event);
		if (this.owner === 'ribbon' && this.isEnter(event)) this.handleRibbonEnterKeyUp();
	}

	private handleRibbonEnterKeyDown(event: KeyboardEvent): void {
		if (event.repeat || this.enterTimer !== null || this.holdFired) return;
		this.enterTimer = setTimeout(() => {
			this.enterTimer = null;
			this.holdFired = true;
			this.activeHandlers.hold?.();
		}, HOLD_THRESHOLD_MS);
	}

	private handleRibbonEnterKeyUp(): void {
		if (this.enterTimer !== null) {
			clearTimeout(this.enterTimer);
			this.enterTimer = null;
			if (!this.holdFired) this.activeHandlers.enter?.();
		}
		this.holdFired = false;
	}

	private resetEnterState(): void {
		if (this.enterTimer !== null) clearTimeout(this.enterTimer);
		this.enterTimer = null;
		this.holdFired = false;
	}

	private handleArrowKeyDown(key: ArrowKey): void {
		switch (key) {
			case ArrowKey.Left:
				this.activeHandlers.horizontal?.(-1 as Shift);
				break;
			case ArrowKey.Right:
				this.activeHandlers.horizontal?.(1 as Shift);
				break;
			case ArrowKey.Up:
				this.activeHandlers.vertical?.(-1 as Shift);
				break;
			case ArrowKey.Down:
				this.activeHandlers.vertical?.(1 as Shift);
				break;
		}
	}
}
