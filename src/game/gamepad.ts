// Thin, poll-based consumer that turns a connected gamepad into game input.
// All the deterministic math lives in the pure core (gamepad_map.ts); this file
// owns the side effects: polling navigator.getGamepads() each frame, driving the
// Input instance (movement / camera / jump), dispatching edge-button actions via
// the host's onAction callback, the virtual-cursor UI-navigation mode, and
// haptic rumble. Modeled structurally on MobileControls.

import type { GamepadBindings } from './gamepad_bindings';
import {
  AXIS,
  detectGamepadKind,
  GAMEPAD_NONE,
  type GamepadKind,
  GP,
  risingEdges,
  STANDARD_BUTTON_COUNT,
  stickToLook,
  stickToMoveFlags,
  TRIGGER_THRESHOLD,
} from './gamepad_map';
import type { Input } from './input';
import { type MenuIntentKind, mapMenuGamepad } from './menu_gamepad_nav';

export interface GamepadCallbacks {
  // Record one physical button rising edge for the HUD's APM readout.
  onInputEdge(): void;
  // Dispatch a bound action id (slotN / target / interact / bags / escape / ...).
  // Reuses the host's existing keybind/UI dispatch; jump & autorun are handled
  // here against Input directly and never reach this.
  onAction(id: string): void;
  // True while any interactive HUD window is open, switching the pad into the
  // virtual-cursor UI-navigation mode (movement/camera/abilities are suspended).
  isPointerMode(): boolean;
  // True while a focus trap owns the HUD (the Esc menu and other modal windows):
  // the pad switches into the deterministic MENU-navigation mode, consuming every
  // edge so world input never double-fires. Optional (falls back to pointer mode).
  isMenuMode?(): boolean;
  // Dispatch one menu navigation verb resolved from the pad this frame (a testable
  // seam: the wiring accepts intents here, never reaching for navigator itself).
  onMenuIntent?(intent: MenuIntentKind): void;
  // Current local-player health, for rumble-on-damage. Optional.
  getPlayerHealth?(): number;
  // A pad connected or disconnected, so the detected brand (and thus the button
  // glyphs shown in the Controller options panel) may have changed. Optional.
  onConnectionChange?(): void;
}

const CURSOR_SPEED = 900; // px/sec at full stick deflection in UI cursor mode

export class GamepadManager {
  private index: number | null = null;
  private kind: GamepadKind = 'generic';
  private prevPressed: boolean[] = new Array(STANDARD_BUTTON_COUNT).fill(false);
  // Left-stick X from the previous poll, for the menu mode's single-fire value
  // adjust (a held deflection must not repeat). Kept in sync in every branch so
  // entering menu mode never sees a stale crossing.
  private prevStickX = 0;
  private deadzone = 0.18;
  private camSpeed = 2.4;
  private invertY = false;
  private vibration = 1;
  private lastHealth: number | null = null;
  private cursorEl: HTMLDivElement | null = null;
  private cursorX = 0;
  private cursorY = 0;
  private cursorInit = false;
  private boundConnect = (e: GamepadEvent) => this.onConnect(e);
  private boundDisconnect = (e: GamepadEvent) => this.onDisconnect(e);

  constructor(
    private input: Input,
    private bindings: GamepadBindings,
    private cb: GamepadCallbacks,
  ) {}

  start(): void {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
    window.addEventListener('gamepadconnected', this.boundConnect);
    window.addEventListener('gamepaddisconnected', this.boundDisconnect);
    // Pick up a pad that was already connected before we started listening (e.g.
    // the Controller setting toggled on while a pad is plugged in). Notify so an
    // open Controller panel re-labels to the detected brand; a no-op otherwise.
    for (const pad of navigator.getGamepads()) {
      if (pad?.connected) {
        this.acquire(pad);
        this.cb.onConnectionChange?.();
        break;
      }
    }
  }

  stop(): void {
    window.removeEventListener('gamepadconnected', this.boundConnect);
    window.removeEventListener('gamepaddisconnected', this.boundDisconnect);
    // Fully release the pad (mirror onDisconnect), not just the listeners: poll()
    // runs unconditionally from the main loop and activePad() keys off this.index,
    // so leaving index set would keep a still-connected pad driving movement,
    // camera, and edge buttons after the Controller setting is turned off. start()
    // re-acquires an already-connected pad on re-enable.
    this.index = null;
    this.kind = 'generic';
    this.prevPressed.fill(false);
    this.prevStickX = 0;
    this.input.clearGamepadMove();
    this.hideCursor();
  }

  setDeadzone(v: number): void {
    this.deadzone = Math.min(0.4, Math.max(0.05, v));
  }
  setCameraSpeed(v: number): void {
    this.camSpeed = Math.max(0.1, v);
  }
  setInvertY(on: boolean): void {
    this.invertY = on;
  }
  setVibration(v: number): void {
    this.vibration = Math.min(1, Math.max(0, v));
  }

  isConnected(): boolean {
    return this.index !== null;
  }

  /** Detected brand of the connected pad, for glyph labeling; 'generic' when
   *  none is connected or the pad's id is unrecognized. */
  getKind(): GamepadKind {
    return this.index === null ? 'generic' : this.kind;
  }

  // Latch a pad as the active one and classify its brand from the id string.
  private acquire(pad: Gamepad): void {
    this.index = pad.index;
    this.kind = detectGamepadKind(pad.id);
  }

  private onConnect(e: GamepadEvent): void {
    if (this.index === null) {
      this.acquire(e.gamepad);
      this.cb.onConnectionChange?.();
    }
  }

  private onDisconnect(e: GamepadEvent): void {
    if (this.index === e.gamepad.index) {
      this.index = null;
      this.kind = 'generic';
      this.prevPressed.fill(false);
      // Mirror stop(): a reconnect must behave like a fresh acquisition, never
      // read the pre-disconnect deflection, or the menu mode's single-fire
      // value adjust can mis-resolve one stale crossing across the reconnect.
      this.prevStickX = 0;
      this.input.clearGamepadMove();
      this.hideCursor();
      this.cb.onConnectionChange?.();
    }
  }

  private windowFocused(): boolean {
    try {
      return typeof document === 'undefined' || document.hasFocus();
    } catch {
      return true;
    }
  }

  private activePad(): Gamepad | null {
    if (this.index === null || typeof navigator === 'undefined') return null;
    const pad = navigator.getGamepads()[this.index];
    return pad && pad.connected ? pad : null;
  }

  /** Called once per animation frame from the main loop. */
  poll(dt: number): void {
    const pad = this.activePad();
    if (!pad) return;
    const buttons = pad.buttons;
    const pressed = (i: number): boolean => {
      const b = buttons[i];
      if (!b) return false;
      // LT/RT are analog; everything else is a clean digital button.
      if (i === GP.LT || i === GP.RT) return b.value > TRIGGER_THRESHOLD;
      return b.pressed;
    };
    const cur: boolean[] = [];
    for (let i = 0; i < STANDARD_BUTTON_COUNT; i++) cur[i] = pressed(i);

    // Track the left-stick X every poll (in ALL branches) so the menu mode's
    // single-fire value adjust never sees a stale crossing on the frame it engages.
    const lx = pad.axes[AXIS.LEFT_X] ?? 0;
    const prevStickX = this.prevStickX;
    this.prevStickX = lx;

    // Match keyboard and mouse, which the browser only delivers to a focused
    // window: an unfocused window takes no pad input. Consume the button state
    // without dispatching so a button held across a refocus does not fire a
    // stale edge on return.
    if (!this.windowFocused()) {
      this.input.clearGamepadMove();
      this.hideCursor();
      this.prevPressed = cur;
      return;
    }

    this.checkRumble();

    // Menu-navigation mode (spec section 5): a focus trap owns the HUD, so the pad
    // drives deterministic menu intents and swallows every edge (the pure core is
    // menu_gamepad_nav). Checked BEFORE pointer mode so a trapped modal (the Esc
    // menu) uses real navigation, not the virtual cursor. DOM is driven only on an
    // intent, never per poll, so an idle pad costs nothing.
    if (this.cb.isMenuMode?.()) {
      this.input.clearGamepadMove();
      this.hideCursor();
      const result = mapMenuGamepad({
        prev: this.prevPressed,
        cur,
        stickX: lx,
        prevStickX,
        adjustThreshold: this.deadzone,
        trapActive: true,
      });
      // Every rising edge is consumed (APM still counts the physical press); the
      // resolved verbs dispatch through the injected seam. World input is never
      // reached, so no default pad binding (camera, movement, Esc) double-fires.
      for (let i = 0; i < result.consumedButtons.length; i++) this.cb.onInputEdge();
      for (const intent of result.intents) this.cb.onMenuIntent?.(intent);
      this.prevPressed = cur;
      return;
    }

    if (this.cb.isPointerMode()) {
      // UI-navigation cursor mode: stick drives a software pointer. Clear any
      // lingering stick movement (a non-modal window like bags doesn't freeze
      // movement on its own) and skip camera/ability dispatch.
      this.input.clearGamepadMove();
      this.updateCursor(pad, cur, dt);
      this.prevPressed = cur;
      return;
    }
    this.hideCursor();

    // Movement: left stick (lx captured above for the menu-mode adjust tracking).
    const ly = pad.axes[AXIS.LEFT_Y] ?? 0;
    this.input.setGamepadMove(stickToMoveFlags(lx, ly, this.deadzone));

    // Camera: right stick.
    const rx = pad.axes[AXIS.RIGHT_X] ?? 0;
    const ry = pad.axes[AXIS.RIGHT_Y] ?? 0;
    const look = stickToLook(rx, ry, this.deadzone, this.camSpeed, this.invertY, dt);
    this.input.applyGamepadLook(look.yaw, look.pitch);

    // Edge actions: one-shot on each button's rising edge.
    for (const idx of risingEdges(this.prevPressed, cur)) {
      this.cb.onInputEdge();
      this.dispatch(idx);
    }

    this.prevPressed = cur;
  }

  private dispatch(buttonIndex: number): void {
    const action = this.bindings.actionFor(buttonIndex);
    if (action === GAMEPAD_NONE) return;
    if (action === 'jump') {
      this.input.triggerGamepadJump();
      return;
    }
    if (action === 'autorun') {
      this.input.toggleAutorun();
      return;
    }
    this.cb.onAction(action);
  }

  // --- Haptics -------------------------------------------------------------
  private checkRumble(): void {
    if (this.vibration <= 0 || !this.cb.getPlayerHealth) {
      this.lastHealth = null;
      return;
    }
    const hp = this.cb.getPlayerHealth();
    if (this.lastHealth !== null && hp < this.lastHealth) {
      const dmgFrac = Math.min(1, (this.lastHealth - hp) / Math.max(1, this.lastHealth));
      this.rumble(0.25 + 0.65 * dmgFrac, Math.round(120 + 180 * dmgFrac));
    }
    this.lastHealth = hp;
  }

  /** Fire a dual-rumble effect scaled by the vibration setting (best-effort). */
  rumble(strength: number, durationMs: number): void {
    const pad = this.activePad();
    const actuator = (
      pad as unknown as {
        vibrationActuator?: { playEffect(type: string, opts: object): Promise<unknown> };
      }
    )?.vibrationActuator;
    if (!actuator?.playEffect) return;
    const mag = Math.min(1, Math.max(0, strength)) * this.vibration;
    try {
      void actuator.playEffect('dual-rumble', {
        duration: durationMs,
        strongMagnitude: mag,
        weakMagnitude: mag * 0.6,
      });
    } catch {
      /* unsupported actuator type */
    }
  }

  // --- UI-navigation virtual cursor ---------------------------------------
  private ensureCursor(): HTMLDivElement {
    if (!this.cursorEl) {
      const el = document.createElement('div');
      el.className = 'gamepad-cursor';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
      this.cursorEl = el;
    }
    return this.cursorEl;
  }

  private updateCursor(pad: Gamepad, cur: boolean[], dt: number): void {
    const el = this.ensureCursor();
    if (!this.cursorInit) {
      this.cursorX = window.innerWidth / 2;
      this.cursorY = window.innerHeight / 2;
      this.cursorInit = true;
    }
    el.style.display = 'block';
    // Left stick (or d-pad) moves the pointer.
    let mx = pad.axes[AXIS.LEFT_X] ?? 0;
    let my = pad.axes[AXIS.LEFT_Y] ?? 0;
    if (Math.hypot(mx, my) < this.deadzone) {
      mx = 0;
      my = 0;
    }
    if (cur[GP.DPAD_LEFT]) mx = -1;
    if (cur[GP.DPAD_RIGHT]) mx = 1;
    if (cur[GP.DPAD_UP]) my = -1;
    if (cur[GP.DPAD_DOWN]) my = 1;
    this.cursorX = Math.min(window.innerWidth, Math.max(0, this.cursorX + mx * CURSOR_SPEED * dt));
    this.cursorY = Math.min(window.innerHeight, Math.max(0, this.cursorY + my * CURSOR_SPEED * dt));
    el.style.left = `${this.cursorX}px`;
    el.style.top = `${this.cursorY}px`;

    for (const idx of risingEdges(this.prevPressed, cur)) {
      this.cb.onInputEdge();
      if (idx === GP.A) this.clickAtCursor();
      else if (idx === GP.B || idx === GP.START) this.cb.onAction('escape');
    }
  }

  // Synthesizes mousedown/mouseup/click at the cursor, reusing every existing DOM
  // click handler (use/equip/sell/trade/feed). Native HTML5 drag-to-rearrange the
  // action bar is the one interaction this cannot reach; clicks cover the rest.
  private clickAtCursor(): void {
    const target = document.elementFromPoint(this.cursorX, this.cursorY) as HTMLElement | null;
    if (!target) return;
    const opts = { bubbles: true, cancelable: true, clientX: this.cursorX, clientY: this.cursorY };
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.click();
  }

  private hideCursor(): void {
    if (this.cursorEl) this.cursorEl.style.display = 'none';
    this.cursorInit = false;
  }
}
