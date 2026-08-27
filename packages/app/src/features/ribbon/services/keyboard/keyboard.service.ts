import mitt from 'mitt';

import type { KeyboardEvents } from './keyboard.interface';
import { ArrowKey, HOLD_THRESHOLD_MS } from './keyboard.lib';

type KeyboardTarget = HTMLElement | Document;

export class KeyboardService {
	private ref: KeyboardTarget | null = null;
	private capture = false;
	private enterTimer: ReturnType<typeof setTimeout> | null = null;
	private holdFired = false;

	public emitter = mitt<KeyboardEvents>();

	public constructor() {
		this.handleKeyDown = this.handleKeyDown.bind(this);
		this.handleKeyUp = this.handleKeyUp.bind(this);
	}

	public subscribe(ref: KeyboardTarget = document.body, capture = false): void {
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
		this.capture = false;
		this.resetEnterState();
	}

	private isEditableTarget(event: KeyboardEvent): boolean {
		const target = event.target;
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		);
	}

	private debug(event: KeyboardEvent): void {
		if (!__DEV__) return;
		const target = event.target as HTMLElement | null;
		console.info(
			`[HomeBackKeyDBG] type=${event.type} key=${event.key} code=${event.code}` +
				` keyCode=${event.keyCode} which=${event.which} repeat=${event.repeat}` +
				` target=${target?.tagName ?? '<none>'} capture=${this.capture}`,
		);
	}

	private consume(event: KeyboardEvent): void {
		event.preventDefault();
		event.stopPropagation();
	}

	private isEnter(event: KeyboardEvent): boolean {
		return (
			event.key === 'Enter' ||
			event.keyCode === 13 ||
			event.which === 13
		);
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

	private handleKeyDown(event: KeyboardEvent): void {
		this.debug(event);
		if (this.isEditableTarget(event)) return;

		const arrow = this.arrowKey(event);
		const enter = this.isEnter(event);
		const back = this.isBack(event);
		if (!arrow && !enter && !back) return;

		this.consume(event);
		if (back) {
			this.emitter.emit('back');
			return;
		}
		if (enter) {
			this.handleEnterKeyDown(event);
			return;
		}
		if (arrow) this.handleArrowKeyDown(arrow);
	}

	private handleKeyUp(event: KeyboardEvent): void {
		this.debug(event);
		if (this.isEditableTarget(event) || !this.isEnter(event)) return;
		this.consume(event);
		this.handleEnterKeyUp();
	}

	private handleEnterKeyDown(event: KeyboardEvent): void {
		if (event.repeat || this.enterTimer !== null || this.holdFired) return;
		this.enterTimer = setTimeout(() => {
			this.enterTimer = null;
			this.holdFired = true;
			if (__DEV__) console.info('[HomeBackKeyDBG] HOLD fired');
			this.emitter.emit('hold');
		}, HOLD_THRESHOLD_MS);
	}

	private handleEnterKeyUp(): void {
		if (this.enterTimer !== null) {
			clearTimeout(this.enterTimer);
			this.enterTimer = null;
			if (!this.holdFired) {
				if (__DEV__) console.info('[HomeBackKeyDBG] ENTER fired');
				this.emitter.emit('enter');
			}
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
				this.emitter.emit('shiftX', -1); break;
			case ArrowKey.Right:
				this.emitter.emit('shiftX', 1); break;
			case ArrowKey.Up:
				this.emitter.emit('shiftY', -1); this.emitter.emit('up'); break;
			case ArrowKey.Down:
				this.emitter.emit('shiftY', 1); this.emitter.emit('down'); break;
		}
	}
}
