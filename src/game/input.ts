// WoW-style input: WASD + A/D keyboard turn, Q/E strafe, space jump,
// left-drag orbits the camera, right-drag mouselooks (turns the character),
// both buttons run forward, wheel zooms, Tab targets, action-bar keys cast
// (player-rebindable, see Keybinds), C/P/L/M/B windows, V nameplates,
// F interacts, R autorun.

import { Keybinds, actionKind } from './keybinds';

// the camera sensitivity that used to be hard-coded in onMouseMove; the
// settings slider scales this (cameraSpeed 1.0 reproduces the old feel)
const BASE_LOOK_SENS = 0.0045;

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
  // mouse-look sensitivity, in radians per pixel of drag; the old fixed value
  // was BASE_LOOK_SENS — setCameraSpeed scales it from the settings menu
  private lookSensitivity = BASE_LOOK_SENS;

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

  /** Scale mouse-look sensitivity. 1.0 = the original fixed speed. */
  setCameraSpeed(mult: number): void {
    this.lookSensitivity = BASE_LOOK_SENS * mult;
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
    // Escape always opens/closes the game menu — never rebindable
    if (e.code === 'Escape') { this.cb.onUiKey('escape'); return; }
    if (e.code === 'Tab') e.preventDefault(); // keep Tab from moving DOM focus in-game
    const action = this.keybinds.actionForCode(e.code);
    if (action === null) return;
    if (actionKind(action) === 'held') {
      // movement: just record the key; readMoveInput polls it each frame
      this.keys.add(e.code);
      if (action === 'forward' || action === 'back') this.autorun = false;
      return;
    }
    this.dispatchEdge(action);
  }

  // Fire a one-shot (edge) action by id. Action-bar slots route to onAbility;
  // the rest map to the targeting/interface callbacks; autorun is internal.
  private dispatchEdge(action: string): void {
    if (action.startsWith('slot')) { this.cb.onAbility(Number(action.slice(4))); return; }
    switch (action) {
      case 'autorun': this.autorun = !this.autorun; return;
      case 'target': this.cb.onTab(); return;
      case 'interact': this.cb.onUiKey('interact'); return;
      case 'bags': this.cb.onUiKey('bags'); return;
      case 'char': this.cb.onUiKey('char'); return;
      case 'spellbook': this.cb.onUiKey('spellbook'); return;
      case 'questlog': this.cb.onUiKey('questlog'); return;
      case 'map': this.cb.onUiKey('map'); return;
      case 'nameplates': this.cb.onUiKey('nameplates'); return;
      case 'meters': this.cb.onUiKey('meters'); return;
      case 'chat': this.cb.onUiKey('chat'); return;
    }
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
    this.camYaw -= mx * this.lookSensitivity;
    this.camPitch = Math.min(1.35, Math.max(-0.4, this.camPitch + my * this.lookSensitivity));
  }

  readMoveInput(): {
    forward: boolean; back: boolean; turnLeft: boolean; turnRight: boolean;
    strafeLeft: boolean; strafeRight: boolean; jump: boolean;
  } {
    if (this.suspendMovement) {
      return { forward: false, back: false, turnLeft: false, turnRight: false, strafeLeft: false, strafeRight: false, jump: false };
    }
    const k = this.keys;
    const held = (id: string) => this.keybinds.codesForAction(id).some((c) => k.has(c));
    const bothButtons = this.leftDown && this.rightDown;
    const mouselook = this.rightDown;
    // A/D (turn) double as strafe while mouselooking, matching WoW; Q/E always strafe
    const aHeld = held('turnLeft');
    const dHeld = held('turnRight');
    const forward = held('forward') || bothButtons || this.autorun;
    const back = held('back');
    const strafeLeft = held('strafeLeft') || (mouselook && aHeld);
    const strafeRight = held('strafeRight') || (mouselook && dHeld);
    const turnLeft = !mouselook && aHeld;
    const turnRight = !mouselook && dHeld;
    const jump = held('jump');
    return { forward, back, turnLeft, turnRight, strafeLeft, strafeRight, jump };
  }
}
