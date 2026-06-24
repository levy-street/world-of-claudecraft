// Default (Mouse Camera off): classic-MMO-style — WASD + A/D keyboard turn, Q/E strafe,
// left-drag orbits, right-drag mouselooks, both buttons run forward.
// Optional Mouse Camera (on): OSRS-style — WASD is camera-relative, A/D strafe,
// mouse drag rotates the orbit (no pointer lock), no keyboard turn.
// Shared: space jump, wheel zoom, Tab target, rebindable action bar, R autorun.

import { sanitizeMoveFacing, sanitizeMoveInput } from '../sim/move_input';
import type { MoveInput } from '../sim/types';
import { cursorForHover, type HoverCursorKind } from './cursors';
import { comboCode, isModifierCode, type Keybinds, makeCombo } from './keybinds';
import { shouldEngagePointerLock, shouldReleasePointerLock } from './pointer_lock';
import { clickPickFromMouseGesture, DEFAULT_CLICK_PICK_MAX_MS } from './pointer_pick';

const BASE_LOOK_SENS = 0.0045;
const TOUCH_LOOK_YAW_RATE = 3.2;
const TOUCH_LOOK_PITCH_RATE = 2.2;
const TOUCH_JUMP_LATCH_MS = 220;
// A keyboard jump press is latched the same way a touch tap is: a fast spacebar
// tap can be pressed and released entirely between two 20Hz input samples (or
// sim-tick gaps), so reading the raw key-held state silently drops it. Holding
// the value above one full input/tick window (50ms) guarantees a grounded tick
// observes the jump. Held jumps are unaffected (the key stays physically down).
const KEY_JUMP_LATCH_MS = 150;
const CAMERA_DRAG_START_DISTANCE = 18;
const CAMERA_DRAG_START_MS = 140;

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
};

type ContextMenuTarget = {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selectors: string) => Element | null;
};

export interface InputCallbacks {
  onTab(): void;
  onTargetFriendly(): void;
  onCycleFriendly(): void;
  onAbility(slot: number): void;
  onUiKey(
    key:
      | 'interact'
      | 'bags'
      | 'char'
      | 'spellbook'
      | 'talents'
      | 'questlog'
      | 'map'
      | 'nameplates'
      | 'escape'
      | 'chat'
      | 'meters'
      | 'social'
      | 'arena'
      | 'leaderboard',
  ): void;
  onEmoteWheel(open: boolean): void;
  onClickPick(x: number, y: number, button: number): void;
  /** Attack-move key pressed (only fires while Attack Move mode is on); x/y is the cursor. */
  onAttackMove?(x: number, y: number): void;
  /** When false, edge actions (spells, UI keys) are ignored. */
  canUseGameKeys?: () => boolean;
  onInputIntent?(kind: 'move' | 'look' | 'zoom'): void;
}

export interface TouchMoveInput {
  forward: boolean;
  back: boolean;
  strafeLeft: boolean;
  strafeRight: boolean;
}

export interface InputDebugState {
  suspendMovement: boolean;
  attackMoveEnabled: boolean;
  mouseCameraEnabled: boolean;
  activeElementTag: string;
  keyCount: number;
  keys: string[];
  movementHeld: {
    forward: boolean;
    back: boolean;
    turnLeft: boolean;
    turnRight: boolean;
    strafeLeft: boolean;
    strafeRight: boolean;
    jump: boolean;
  };
  leftDown: boolean;
  rightDown: boolean;
  cameraDragActive: boolean;
  pointerLocked: boolean;
  hoverActive: boolean;
}

export class Input {
  keys = new Set<string>();
  leftDown = false;
  rightDown = false;
  camYaw = Math.PI;
  camPitch = 0.32;
  camDist = 12;
  autorun = false;
  suspendMovement = false;
  // click-to-move (#95): a world destination the player clicked; the frame loop
  // walks toward it until arrival or until the player takes manual control.
  // null when inactive. clickMoveTarget is the current waypoint; clickMoveGoal
  // is the final clicked location or live entity position. clickMoveStop is how
  // close counts as "there" at the final waypoint.
  clickMoveTarget: { x: number; z: number } | null = null;
  clickMoveGoal: { x: number; z: number } | null = null;
  clickMovePath: { x: number; z: number }[] = [];
  clickMovePathIndex = 0;
  clickMoveEntityId: number | null = null;
  clickMoveStop = 0.5;
  clickMoveFacing: number | null = null;
  clickMovePulse = 0;
  clickMovePulseTarget: { x: number; z: number } | null = null;
  // True while the current click-to-move was issued as an attack-move (walk to
  // the point and auto-attack enemies). Set by setClickMoveTarget, cleared on stop.
  clickMoveAttack = false;
  // When on (the Attack Move setting), only the attack-move key itself is
  // reserved. Other movement keys still work so enabling Attack Move cannot
  // make WASD appear dead.
  private attackMoveEnabled = false;
  /** Latest pointer position while over the canvas (for hover pick). */
  hoverX = 0;
  hoverY = 0;
  hoverActive = false;
  private hoverKind: HoverCursorKind = 'default';
  private mouseCameraEnabled = false;
  // "Lock cursor while rotating" (settings: lockCursorOnRotate, default on).
  // When on, an active camera drag pointer-locks the canvas so the OS cursor
  // cannot reach the screen edge (camera freeze) or slip to a second monitor.
  private lockCursorOnRotate = true;
  private dragDistance = 0;
  private cameraDragActive = false;
  private clickMoveMouseButton: 0 | 2 | null = null;
  // +1 normal, -1 inverts the vertical mouselook axis (settings: invertLookY).
  private lookPitchSign = 1;
  private downButton = -1;
  private pointerLockRequestedForDrag = false;
  private downX = 0;
  private downY = 0;
  private downAt = 0;
  // one-shot key capture for the rebind UI: the next keydown is delivered here
  // (Escape cancels with null) instead of being dispatched as an action
  private captureCb: ((code: string | null) => void) | null = null;
  private controllerMoveInput: MoveInput | null = null;
  private controllerFacing: number | null = null;
  private emoteWheelHeldCodes = new Set<string>();
  // mouse-look sensitivity, in radians per pixel of drag; the old fixed value
  // was BASE_LOOK_SENS — setCameraSpeed scales it from the settings menu
  private lookSensitivity = BASE_LOOK_SENS;
  private touchMove: TouchMoveInput = {
    forward: false,
    back: false,
    strafeLeft: false,
    strafeRight: false,
  };
  // Movement flags from the gamepad's left stick, OR'd into readMoveInput()
  // alongside the touch joystick. The gamepad polls each frame (gamepad.ts).
  private gamepadMove: TouchMoveInput = {
    forward: false,
    back: false,
    strafeLeft: false,
    strafeRight: false,
  };
  private touchJumpUntil = 0;
  private keyJumpUntil = 0;
  private touchLookActive = false;
  private touchLookVector = { x: 0, y: 0 };
  // multiplier on the touch look (camera joystick) rate; setTouchLookSpeed
  // drives it from the settings menu. Mouselook uses lookSensitivity instead.
  private touchLookSpeed = 1;
  // +1 normal, -1 when the player inverts the touch camera's vertical axis
  private touchPitchSign = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: InputCallbacks,
    private keybinds: Keybinds,
  ) {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.releaseCapture('blur'));
    window.addEventListener('pointerup', (e) => this.onMouseUp(e));
    window.addEventListener('pointercancel', (e) => this.onMouseUp(e));
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement) this.releaseCapture('pointerlock');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseCapture('hidden');
    });
    document.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    document.addEventListener('selectstart', (e) => this.onSelectStart(e));
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomBy(Math.sign(e.deltaY) * 1.4);
        this.noteIntent('zoom');
      },
      { passive: false },
    );
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mouseenter', () => {
      this.hoverActive = true;
    });
    canvas.addEventListener('mouseleave', () => {
      this.hoverActive = false;
      this.setHoverCursor('default');
    });
    this.updateCursor();
  }

  private onContextMenu(e: MouseEvent): void {
    if (this.shouldSuppressContextMenu(e.target)) e.preventDefault();
  }

  private onSelectStart(e: Event): void {
    const body = document.body;
    if (!body?.classList.contains('game-active') || !body.classList.contains('mobile-touch'))
      return;
    if (this.isEditableContextTarget(e.target)) return;
    e.preventDefault();
  }

  private shouldSuppressContextMenu(target: EventTarget | null): boolean {
    const body = document.body;
    if (body && !body.classList.contains('game-active')) return false;
    if (this.isEditableContextTarget(target)) return false;
    if (!body && target !== this.canvas && !this.isGameSurfaceTarget(target)) return false;
    return true;
  }

  private isEditableContextTarget(target: EventTarget | null): boolean {
    const el = this.contextMenuTarget(target);
    if (!el) return false;
    const tag = (el.tagName ?? '').toLowerCase();
    return (
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      el.isContentEditable === true ||
      !!el.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
    );
  }

  private isGameSurfaceTarget(target: EventTarget | null): boolean {
    const el = this.contextMenuTarget(target);
    return !!el?.closest?.('#ui, #game-canvas, #nameplates');
  }

  private contextMenuTarget(target: EventTarget | null): ContextMenuTarget | null {
    return target && typeof target === 'object' ? (target as ContextMenuTarget) : null;
  }

  /** Move the camera in/out, clamped to the zoom limits. Shared by wheel + touch pinch. */
  zoomBy(delta: number): void {
    this.camDist = Math.min(22, Math.max(3, this.camDist + delta));
  }

  /** True while a mouse button is held for camera drag. */
  isDragging(): boolean {
    return this.leftDown || this.rightDown;
  }

  isCameraDragActive(): boolean {
    return this.cameraDragActive;
  }

  setClickMoveMouseButton(button: 0 | 2 | null): void {
    this.clickMoveMouseButton = button;
    if (button !== null && this.downButton === button) {
      this.cameraDragActive = false;
      this.pointerLockRequestedForDrag = false;
    }
    this.updateCursor();
  }

  /** Update hand / sword / shield cursor from a hover pick (called once per frame). */
  setHoverCursor(kind: HoverCursorKind): void {
    if (this.hoverKind === kind) return;
    this.hoverKind = kind;
    this.updateCursor();
  }

  isMouseCameraMode(): boolean {
    return this.mouseCameraEnabled;
  }

  isAttackMoveEnabled(): boolean {
    return this.attackMoveEnabled;
  }

  setAttackMoveEnabled(on: boolean): void {
    this.attackMoveEnabled = on;
  }

  debugState(): InputDebugState {
    return {
      suspendMovement: this.suspendMovement,
      attackMoveEnabled: this.attackMoveEnabled,
      mouseCameraEnabled: this.mouseCameraEnabled,
      activeElementTag: (document.activeElement?.tagName ?? '').toLowerCase(),
      keyCount: this.keys.size,
      keys: [...this.keys].sort(),
      movementHeld: {
        forward: this.heldAction('forward'),
        back: this.heldAction('back'),
        turnLeft: this.heldAction('turnLeft'),
        turnRight: this.heldAction('turnRight'),
        strafeLeft: this.heldAction('strafeLeft'),
        strafeRight: this.heldAction('strafeRight'),
        jump: this.keybinds.codesForAction('jump').some((c) => this.keys.has(comboCode(c))),
      },
      leftDown: this.leftDown,
      rightDown: this.rightDown,
      cameraDragActive: this.cameraDragActive,
      pointerLocked: document.pointerLockElement === this.canvas,
      hoverActive: this.hoverActive,
    };
  }

  setLockCursorOnRotate(on: boolean): void {
    this.lockCursorOnRotate = on;
    if (!on && document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
    }
  }

  setMouseCameraEnabled(on: boolean): void {
    this.mouseCameraEnabled = on;
    if (on && document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
      // Toggling mode mid-drag: drop the drag/lock state now rather than waiting
      // for the async pointerlockchange, so the in-flight drag cannot leave the
      // request flag latched (which would block re-acquiring the lock).
      this.cameraDragActive = false;
      this.pointerLockRequestedForDrag = false;
    }
    this.updateCursor();
  }

  captureNextKey(cb: (code: string | null) => void): void {
    this.captureCb = cb;
  }

  setCameraSpeed(mult: number): void {
    this.lookSensitivity = BASE_LOOK_SENS * mult;
  }

  setTouchLookSpeed(mult: number): void {
    this.touchLookSpeed = mult;
  }

  // Invert the vertical mouselook/touch-look axis. Applied to every pitch delta
  // so the preference is consistent across mouse drag, pointer-lock, and touch.
  setInvertLookY(on: boolean): void {
    this.lookPitchSign = on ? -1 : 1;
  }

  setTouchMove(move: TouchMoveInput): void {
    const changed =
      move.forward !== this.touchMove.forward ||
      move.back !== this.touchMove.back ||
      move.strafeLeft !== this.touchMove.strafeLeft ||
      move.strafeRight !== this.touchMove.strafeRight;
    this.touchMove = move;
    if (move.forward || move.back) this.autorun = false;
    if (changed) this.noteIntent('move');
  }

  clearTouchMove(): void {
    const changed =
      this.touchMove.forward ||
      this.touchMove.back ||
      this.touchMove.strafeLeft ||
      this.touchMove.strafeRight;
    this.touchMove = { forward: false, back: false, strafeLeft: false, strafeRight: false };
    if (changed) this.noteIntent('move');
  }

  // A touch jump is momentary, but readMoveInput() is also used by camera/HUD
  // helpers between sim ticks. Latch the tap briefly so those reads cannot eat
  // the jump before the grounded movement tick sees it.
  triggerTouchJump(): void {
    this.touchJumpUntil = Math.max(this.touchJumpUntil, performance.now() + TOUCH_JUMP_LATCH_MS);
  }

  // Touch-reachable autorun toggle (the keyboard path is the 'autorun' edge action).
  // Returns the new state so the on-screen button can reflect it.
  toggleAutorun(): boolean {
    this.autorun = !this.autorun;
    return this.autorun;
  }

  setTouchLook(active: boolean): void {
    if (active !== this.touchLookActive) this.noteIntent('look');
    this.touchLookActive = active;
  }

  setTouchLookVector(v: { x: number; y: number }): void {
    if (v.x !== this.touchLookVector.x || v.y !== this.touchLookVector.y) this.noteIntent('look');
    this.touchLookVector = v;
  }

  // Flip the vertical axis of the touch camera (joystick + swipe-look) only;
  // mouselook is unaffected. Off by default (see BOOL_SETTINGS.touchInvertLook).
  setTouchInvertLook(on: boolean): void {
    this.touchPitchSign = on ? -1 : 1;
  }

  applyTouchLookDelta(dx: number, dy: number): void {
    this.camYaw -= dx * this.lookSensitivity;
    this.camPitch = Math.min(
      1.35,
      Math.max(-0.4, this.camPitch + this.touchPitchSign * dy * this.lookSensitivity),
    );
    if (dx !== 0 || dy !== 0) this.noteIntent('look');
  }

  // --- Gamepad (poll-based) -------------------------------------------------
  // The gamepad shares the touch joystick's movement path: its left-stick flags
  // are OR'd into readMoveInput(). Set/cleared each poll by GamepadManager.
  setGamepadMove(move: TouchMoveInput): void {
    const changed =
      move.forward !== this.gamepadMove.forward ||
      move.back !== this.gamepadMove.back ||
      move.strafeLeft !== this.gamepadMove.strafeLeft ||
      move.strafeRight !== this.gamepadMove.strafeRight;
    this.gamepadMove = move;
    if (move.forward || move.back) this.autorun = false;
    if (changed) this.noteIntent('move');
  }

  clearGamepadMove(): void {
    const changed =
      this.gamepadMove.forward ||
      this.gamepadMove.back ||
      this.gamepadMove.strafeLeft ||
      this.gamepadMove.strafeRight;
    this.gamepadMove = { forward: false, back: false, strafeLeft: false, strafeRight: false };
    if (changed) this.noteIntent('move');
  }

  // Latch a gamepad jump-button tap the same way touch jumps latch, so reads
  // between sim ticks don't swallow it before the grounded tick sees it.
  triggerGamepadJump(): void {
    this.touchJumpUntil = Math.max(this.touchJumpUntil, performance.now() + TOUCH_JUMP_LATCH_MS);
  }

  // Apply the right-stick camera deltas (already in radians, computed by the
  // pure stickToLook core). Clamps pitch to the same range as touch/mouse look.
  applyGamepadLook(yawDelta: number, pitchDelta: number): void {
    if (yawDelta === 0 && pitchDelta === 0) return;
    this.camYaw += yawDelta;
    this.camPitch = Math.min(1.35, Math.max(-0.4, this.camPitch + pitchDelta));
    this.noteIntent('look');
  }

  updateTouchLook(dt: number): void {
    if (!this.touchLookActive) return;
    this.camYaw -= this.touchLookVector.x * TOUCH_LOOK_YAW_RATE * this.touchLookSpeed * dt;
    this.camPitch = Math.min(
      1.35,
      Math.max(
        -0.4,
        this.camPitch +
          this.touchPitchSign *
            this.touchLookVector.y *
            TOUCH_LOOK_PITCH_RATE *
            this.touchLookSpeed *
            dt,
      ),
    );
  }

  /** Snap the orbit camera back behind the character (mobile recenter gesture). */
  recenterCameraBehind(facing: number): void {
    if (Number.isFinite(facing)) this.camYaw = facing;
    this.camPitch = 0.32;
  }

  isMouselookActive(): boolean {
    if (this.mouseCameraEnabled) return this.touchLookActive;
    return (this.rightDown && this.cameraDragActive) || this.touchLookActive;
  }

  setControllerMoveInput(input: unknown, facing?: unknown): void {
    this.controllerMoveInput = sanitizeMoveInput(input);
    if (arguments.length > 1) this.controllerFacing = sanitizeMoveFacing(facing);
  }

  setControllerFacing(facing: unknown): void {
    this.controllerFacing = sanitizeMoveFacing(facing);
  }

  clearControllerMoveInput(): void {
    this.controllerMoveInput = null;
    this.controllerFacing = null;
  }

  setClickMoveTarget(
    target: { x: number; z: number },
    stopDistance: number,
    entityId: number | null = null,
    path: { x: number; z: number }[] = [target],
    attack = false,
  ): void {
    this.applyClickMovePath(target, path);
    this.clickMoveStop = stopDistance;
    this.clickMoveEntityId = entityId;
    this.clickMoveAttack = attack;
    this.clickMoveFacing = null;
    this.clickMovePulseTarget = target;
    this.clickMovePulse++;
    this.autorun = false;
    this.noteIntent('move');
  }

  rerouteClickMoveTarget(
    target: { x: number; z: number },
    path: { x: number; z: number }[] = [target],
  ): void {
    if (!this.clickMoveTarget) return;
    this.applyClickMovePath(target, path);
  }

  advanceClickMoveWaypoint(): boolean {
    if (!this.clickMoveTarget) return false;
    if (this.clickMovePathIndex >= this.clickMovePath.length - 1) return false;
    this.clickMovePathIndex++;
    this.clickMoveTarget = this.clickMovePath[this.clickMovePathIndex];
    return true;
  }

  isClickMoveFinalWaypoint(): boolean {
    return !!this.clickMoveTarget && this.clickMovePathIndex >= this.clickMovePath.length - 1;
  }

  clearClickMove(): void {
    if (!this.clickMoveTarget && this.clickMoveEntityId === null) return;
    this.clickMoveTarget = null;
    this.clickMoveGoal = null;
    this.clickMovePath = [];
    this.clickMovePathIndex = 0;
    this.clickMoveEntityId = null;
    this.clickMoveFacing = null;
    this.clickMoveAttack = false;
    this.noteIntent('move');
  }

  private applyClickMovePath(
    target: { x: number; z: number },
    path: { x: number; z: number }[],
  ): void {
    this.clickMoveGoal = target;
    const cleaned = path.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
    this.clickMovePath = cleaned.length > 0 ? cleaned : [target];
    this.clickMovePathIndex = 0;
    this.clickMoveTarget = this.clickMovePath[0];
  }

  controllerFacingOverride(): number | null {
    return this.controllerFacing;
  }

  private releaseCapture(reason: string): void {
    const hadInput = this.keys.size > 0 || this.leftDown || this.rightDown;
    // Always drop the mouse-drag state so a button can't stick "held".
    this.leftDown = false;
    this.rightDown = false;
    this.cameraDragActive = false;
    this.downButton = -1;
    this.pointerLockRequestedForDrag = false;
    // Focus loss (blur / tab hidden) means the OS will swallow the matching
    // keyup, so we must forget held movement keys or they'd stick on. A pointer
    // -lock exit is different: the window still has focus and keyup will fire
    // normally, so clearing keys here would cancel a walk the instant a camera
    // drag ends (every right/left-drag exits pointer lock on release).
    if (reason !== 'pointerlock') this.keys.clear();
    if (reason !== 'pointerlock' && this.emoteWheelHeldCodes.size > 0) {
      this.emoteWheelHeldCodes.clear();
      this.cb.onEmoteWheel(false);
    }
    this.updateCursor();
    if (hadInput) this.noteIntent('move');
  }

  private updateCursor(): void {
    this.canvas.style.cursor = cursorForHover(
      this.hoverKind,
      this.cameraDragActive || document.pointerLockElement === this.canvas,
    );
  }

  private isBrowserFullscreen(): boolean {
    const doc = document as FullscreenDocument;
    return !!(document.fullscreenElement ?? doc.webkitFullscreenElement);
  }

  private pressDurationMs(): number {
    return Math.max(0, performance.now() - this.downAt);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (this.captureCb) {
      e.preventDefault();
      // Escape cancels the capture. A lone modifier keypress is ignored so the
      // player can hold Shift/Ctrl/Alt and THEN press the real key to bind the
      // whole chord (e.g. Shift+1); the chord is captured on that final key.
      if (e.code === 'Escape') {
        const cb = this.captureCb;
        this.captureCb = null;
        cb(null);
        return;
      }
      if (isModifierCode(e.code)) return;
      const cb = this.captureCb;
      this.captureCb = null;
      cb(makeCombo(e.code, { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }));
      return;
    }
    const tag = (document.activeElement?.tagName ?? '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.code === 'Escape') {
      this.cb.onUiKey('escape');
      return;
    }
    if (this.cb.canUseGameKeys && !this.cb.canUseGameKeys()) return;
    if (e.code === 'Tab') e.preventDefault();
    if (e.code === 'Space') e.preventDefault?.();
    // The full modifier chord for this press (null if it is itself a bare
    // modifier key, which never triggers an action on its own).
    const combo = isModifierCode(e.code)
      ? null
      : makeCombo(e.code, { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
    // Attack Move mode: the bound chord (default A) issues an attack-move toward
    // the cursor and wins over whatever movement action shares that key.
    if (
      this.attackMoveEnabled &&
      this.hoverActive &&
      combo &&
      this.keybinds.codesForAction('attackMove').includes(combo)
    ) {
      e.preventDefault();
      this.cb.onAttackMove?.(this.hoverX, this.hoverY);
      return;
    }
    // Held (movement) actions match the physical key only, so a held modifier
    // never stops movement (Shift+W still walks). Edge actions match the full
    // chord, so Shift+1 is distinct from 1. Both may fire on one press — that is
    // intentional (move while casting).
    const held = this.keybinds.heldActionForCode(e.code);
    if (held === 'emoteWheel') {
      this.emoteWheelHeldCodes.add(e.code);
      this.cb.onEmoteWheel(true);
      e.preventDefault();
    } else if (held !== null) {
      this.keys.add(e.code);
      if (held === 'forward' || held === 'back') this.autorun = false;
      // Latch a jump press (e.repeat is filtered above, so this is the real
      // edge) so a fast tap survives until a grounded movement tick samples it.
      if (held === 'jump')
        this.keyJumpUntil = Math.max(this.keyJumpUntil, performance.now() + KEY_JUMP_LATCH_MS);
      this.noteIntent('move');
    }
    const edge = combo ? this.keybinds.edgeActionForCombo(combo) : null;
    if (edge !== null) this.dispatchEdge(edge);
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (this.keys.delete(e.code)) this.noteIntent('move');
    if (this.emoteWheelHeldCodes.delete(e.code) && this.emoteWheelHeldCodes.size === 0) {
      this.cb.onEmoteWheel(false);
      e.preventDefault();
    }
  }

  private dispatchEdge(action: string): void {
    if (action.startsWith('slot')) {
      this.cb.onAbility(Number(action.slice(4)));
      return;
    }
    switch (action) {
      case 'autorun':
        this.autorun = !this.autorun;
        this.noteIntent('move');
        return;
      case 'target':
        this.cb.onTab();
        return;
      case 'targetFriendly':
        this.cb.onTargetFriendly();
        return;
      case 'targetFriendlyNext':
        this.cb.onCycleFriendly();
        return;
      case 'interact':
        this.cb.onUiKey('interact');
        return;
      case 'bags':
        this.cb.onUiKey('bags');
        return;
      case 'char':
        this.cb.onUiKey('char');
        return;
      case 'spellbook':
        this.cb.onUiKey('spellbook');
        return;
      case 'talents':
        this.cb.onUiKey('talents');
        return;
      case 'questlog':
        this.cb.onUiKey('questlog');
        return;
      case 'map':
        this.cb.onUiKey('map');
        return;
      case 'nameplates':
        this.cb.onUiKey('nameplates');
        return;
      case 'meters':
        this.cb.onUiKey('meters');
        return;
      case 'social':
        this.cb.onUiKey('social');
        return;
      case 'arena':
        this.cb.onUiKey('arena');
        return;
      case 'leaderboard':
        this.cb.onUiKey('leaderboard');
        return;
      case 'chat':
        this.cb.onUiKey('chat');
        return;
    }
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button === 0) this.leftDown = true;
    if (e.button === 2) this.rightDown = true;
    if (e.button === 0 || e.button === 2) e.preventDefault?.();
    if (e.button === 0 || e.button === 2) this.noteIntent(e.button === 2 ? 'look' : 'move');
    this.downButton = e.button;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.downAt = performance.now();
    this.dragDistance = 0;
    this.cameraDragActive = false;
    // Pointer lock is requested lazily once a drag actually begins (see
    // onMouseMove) — NOT on every press, which spammed the browser "mouse
    // capture" banner on every right-click used to attack/look (#116).
    this.pointerLockRequestedForDrag = false;
    this.updateCursor();
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button === 0) this.leftDown = false;
    if (e.button === 2) this.rightDown = false;
    if (e.button === 0 || e.button === 2) this.noteIntent(e.button === 2 ? 'look' : 'move');
    const wasCameraDrag = this.cameraDragActive;
    const pick = wasCameraDrag
      ? null
      : clickPickFromMouseGesture({
          button: e.button,
          downButton: this.downButton,
          downX: this.downX,
          downY: this.downY,
          upX: e.clientX,
          upY: e.clientY,
          movementDrag: this.dragDistance,
          releaseOnCanvas: e.target === this.canvas || document.pointerLockElement === this.canvas,
          pointerLocked: document.pointerLockElement === this.canvas,
          pressDurationMs: performance.now() - this.downAt,
        });
    // Release the drag lock in both camera modes once no rotation button is
    // held, so the OS cursor returns between drags for target/loot/UI clicking.
    if (
      shouldReleasePointerLock({
        anyButtonDown: this.leftDown || this.rightDown,
        hasLock: document.pointerLockElement === this.canvas,
      })
    ) {
      document.exitPointerLock();
    }
    if (pick) this.cb.onClickPick(pick.x, pick.y, pick.button);
    if (!this.leftDown && !this.rightDown) this.cameraDragActive = false;
    this.downButton = -1;
    this.pointerLockRequestedForDrag = false;
    this.updateCursor();
  }

  private onMouseMove(e: MouseEvent): void {
    if (e.target === this.canvas) {
      this.hoverX = e.clientX;
      this.hoverY = e.clientY;
    }
    if (!this.leftDown && !this.rightDown) return;
    const mx = e.movementX ?? 0,
      my = e.movementY ?? 0;
    if (mx === 0 && my === 0) return;
    const heldMs = this.pressDurationMs();
    if (this.downButton === this.clickMoveMouseButton && heldMs <= DEFAULT_CLICK_PICK_MAX_MS)
      return;
    this.dragDistance += Math.abs(mx) + Math.abs(my);
    if (!this.cameraDragActive) {
      if (this.dragDistance < CAMERA_DRAG_START_DISTANCE && heldMs < CAMERA_DRAG_START_MS) return;
      this.cameraDragActive = true;
      // Engage pointer lock the instant a press becomes a real camera drag, in
      // BOTH camera modes, so rotation never begins with a free cursor that can
      // reach the screen edge (movementX clamps to 0 and the camera freezes) or
      // slip onto a second monitor. One lock per drag, none for a plain click
      // (#116); fullscreen stays a plain drag because Chrome forces its own
      // "press and hold Esc" prompt there.
      if (
        !this.pointerLockRequestedForDrag &&
        shouldEngagePointerLock({
          lockOnRotate: this.lockCursorOnRotate,
          isFullscreen: this.isBrowserFullscreen(),
          alreadyLocked: document.pointerLockElement === this.canvas,
        })
      ) {
        this.pointerLockRequestedForDrag = true;
        this.canvas.requestPointerLock?.();
      }
      this.noteIntent('look');
      this.updateCursor();
      return;
    }
    this.camYaw -= mx * this.lookSensitivity;
    this.camPitch = Math.min(
      1.35,
      Math.max(-0.4, this.camPitch + my * this.lookSensitivity * this.lookPitchSign),
    );
    if (mx !== 0 || my !== 0) this.noteIntent('look');
  }

  private noteIntent(kind: 'move' | 'look' | 'zoom'): void {
    this.cb.onInputIntent?.(kind);
  }

  private isAttackMoveReservedCode(code: string): boolean {
    return this.attackMoveEnabled && this.keybinds.codesForAction('attackMove').includes(code);
  }

  private heldAction(id: string): boolean {
    // Held movement matches the physical key only: strip any modifier prefix so the
    // bare e.code stored in `this.keys` still matches even if storage holds a stray
    // modifier combo for a held action (a held modifier never blocks movement).
    return this.keybinds
      .codesForAction(id)
      .some((c) => this.keys.has(comboCode(c)) && !this.isAttackMoveReservedCode(c));
  }

  readMoveInput(): MoveInput {
    if (this.suspendMovement) {
      // A game menu / modal is open (or chat is focused). Suppress held keys and
      // pointer/touch/gamepad movement so menu keystrokes never leak into the
      // world, but keep the latched autorun running: in a classic MMO the world
      // never pauses, so opening the Esc menu lets you keep auto-running while
      // you change a setting. The latch itself is untouched, and the next manual
      // forward/back key press still clears it.
      return {
        forward: this.autorun,
        back: false,
        turnLeft: false,
        turnRight: false,
        strafeLeft: false,
        strafeRight: false,
        jump: false,
      };
    }
    if (this.controllerMoveInput) return { ...this.controllerMoveInput };
    const held = (id: string) => this.heldAction(id);
    const bothButtons = this.leftDown && this.rightDown;
    const forward =
      held('forward') ||
      bothButtons ||
      this.autorun ||
      this.touchMove.forward ||
      this.gamepadMove.forward;
    const back = held('back') || this.touchMove.back || this.gamepadMove.back;
    // Jump is not a WASD key, so it keeps working in Attack Move mode.
    const jump =
      this.keybinds.codesForAction('jump').some((c) => this.keys.has(comboCode(c))) ||
      performance.now() <= this.touchJumpUntil ||
      performance.now() <= this.keyJumpUntil;

    if (this.mouseCameraEnabled) {
      return {
        forward,
        back,
        jump,
        turnLeft: false,
        turnRight: false,
        strafeLeft:
          held('strafeLeft') ||
          held('turnLeft') ||
          this.touchMove.strafeLeft ||
          this.gamepadMove.strafeLeft,
        strafeRight:
          held('strafeRight') ||
          held('turnRight') ||
          this.touchMove.strafeRight ||
          this.gamepadMove.strafeRight,
      };
    }

    const mouselook = this.isMouselookActive();
    const aHeld = held('turnLeft');
    const dHeld = held('turnRight');
    return {
      forward,
      back,
      jump,
      strafeLeft:
        held('strafeLeft') ||
        (mouselook && aHeld) ||
        this.touchMove.strafeLeft ||
        this.gamepadMove.strafeLeft,
      strafeRight:
        held('strafeRight') ||
        (mouselook && dHeld) ||
        this.touchMove.strafeRight ||
        this.gamepadMove.strafeRight,
      turnLeft: !mouselook && aHeld,
      turnRight: !mouselook && dHeld,
    };
  }
}
