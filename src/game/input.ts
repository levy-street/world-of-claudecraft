// WoW-style input: WASD + A/D keyboard turn, Q/E strafe, space jump,
// left-drag orbits the camera, right-drag mouselooks (turns the character),
// both buttons run forward, wheel zooms, Tab targets, action-bar keys cast
// (player-rebindable, see Keybinds), C/P/L/M/B windows, V nameplates,
// F interacts, R autorun.

import { Keybinds } from './keybinds';

export interface InputCallbacks {
  onTab(): void;
  onAbility(slot: number): void;
  onUiKey(key: 'interact' | 'bags' | 'char' | 'spellbook' | 'questlog' | 'map' | 'nameplates' | 'escape' | 'chat' | 'meters'): void;
  onClickPick(x: number, y: number, button: number): void;
}

export class Input {
  keys = new Set<string>();
  leftDown = false;
  rightDown = false;
  camYaw = Math.PI;
  camPitch = 0.32;
  camDist = 12;
  autorun = false;
  // while true, readMoveInput reports neutral — set when a modal (the options
  // menu) is open so held WASD doesn't drive the character behind it
  suspendMovement = false;
  private dragDistance = 0;
  private downButton = -1;
  // one-shot key capture for the rebind UI: the next keydown is delivered here
  // (Escape cancels with null) instead of being dispatched as an action
  private captureCb: ((code: string | null) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private cb: InputCallbacks, private keybinds: Keybinds) {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.leftDown = false; this.rightDown = false; });
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist = Math.min(22, Math.max(3, this.camDist + Math.sign(e.deltaY) * 1.4));
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Capture the next keypress (for the rebind UI) instead of acting on it. */
  captureNextKey(cb: (code: string | null) => void): void {
    this.captureCb = cb;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    // rebind capture intercepts everything (incl. action/UI keys); Escape cancels
    if (this.captureCb) {
      e.preventDefault();
      const cb = this.captureCb;
      this.captureCb = null;
      cb(e.code === 'Escape' ? null : e.code);
      return;
    }
    const tag = (document.activeElement?.tagName ?? '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const slot = this.keybinds.slotForCode(e.code);
    if (slot !== null) {
      this.cb.onAbility(slot);
      return;
    }
    switch (e.code) {
      case 'Tab':
        e.preventDefault();
        this.cb.onTab();
        return;
      case 'KeyF': this.cb.onUiKey('interact'); return;
      case 'KeyB': this.cb.onUiKey('bags'); return;
      case 'KeyC': this.cb.onUiKey('char'); return;
      case 'KeyP': this.cb.onUiKey('spellbook'); return;
      case 'KeyL': this.cb.onUiKey('questlog'); return;
      case 'KeyM': this.cb.onUiKey('map'); return;
      case 'KeyV': this.cb.onUiKey('nameplates'); return;
      case 'KeyN': this.cb.onUiKey('meters'); return;
      case 'Enter': case 'NumpadEnter': this.cb.onUiKey('chat'); return;
      case 'Escape': this.cb.onUiKey('escape'); return;
      case 'NumLock': case 'KeyR': this.autorun = !this.autorun; return;
    }
    this.keys.add(e.code);
    if (['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown'].includes(e.code)) this.autorun = false;
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button === 0) this.leftDown = true;
    if (e.button === 2) this.rightDown = true;
    this.downButton = e.button;
    this.dragDistance = 0;
    this.canvas.requestPointerLock?.();
  }

  private onMouseUp(e: MouseEvent): void {
    const wasDrag = this.dragDistance > 5;
    if (e.button === 0) this.leftDown = false;
    if (e.button === 2) this.rightDown = false;
    if (!this.leftDown && !this.rightDown && document.pointerLockElement) {
      document.exitPointerLock();
    }
    if (!wasDrag && e.button === this.downButton && (e.target === this.canvas || document.pointerLockElement === this.canvas)) {
      this.cb.onClickPick(e.clientX, e.clientY, e.button);
    }
    this.downButton = -1;
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.leftDown && !this.rightDown) return;
    const mx = e.movementX ?? 0, my = e.movementY ?? 0;
    this.dragDistance += Math.abs(mx) + Math.abs(my);
    this.camYaw -= mx * 0.0045;
    this.camPitch = Math.min(1.35, Math.max(-0.4, this.camPitch + my * 0.0045));
  }

  readMoveInput(): {
    forward: boolean; back: boolean; turnLeft: boolean; turnRight: boolean;
    strafeLeft: boolean; strafeRight: boolean; jump: boolean;
  } {
    if (this.suspendMovement) {
      return { forward: false, back: false, turnLeft: false, turnRight: false, strafeLeft: false, strafeRight: false, jump: false };
    }
    const k = this.keys;
    const bothButtons = this.leftDown && this.rightDown;
    const mouselook = this.rightDown;
    const forward = k.has('KeyW') || k.has('ArrowUp') || bothButtons || this.autorun;
    const back = k.has('KeyS') || k.has('ArrowDown');
    const aHeld = k.has('KeyA') || k.has('ArrowLeft');
    const dHeld = k.has('KeyD') || k.has('ArrowRight');
    const strafeLeft = k.has('KeyQ') || (mouselook && aHeld);
    const strafeRight = k.has('KeyE') || (mouselook && dHeld);
    const turnLeft = !mouselook && aHeld;
    const turnRight = !mouselook && dHeld;
    const jump = k.has('Space');
    return { forward, back, turnLeft, turnRight, strafeLeft, strafeRight, jump };
  }
}
