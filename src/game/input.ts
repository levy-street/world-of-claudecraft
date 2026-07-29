// Default (Mouse Camera off): classic-MMO-style (WASD + A/D keyboard turn, Q/E strafe,
// left-drag orbits, right-drag mouselooks, both buttons run forward).
// Optional Mouse Camera (on): OSRS-style (WASD is camera-relative, A/D strafe,
// mouse drag rotates the orbit, no keyboard turn).
// Shared: space jump, wheel zoom, Tab target, rebindable action bar, R autorun.

import { sanitizeMoveFacing, sanitizeMoveInput } from '../sim/move_input';
import type { MoveInput } from '../sim/types';
import { detectBrowserEngine } from './browser_env';
import { cursorForHover, type HoverCursorKind } from './cursors';
import { comboCode, isModifierCode, type Keybinds, makeCombo } from './keybinds';
import { bindableMouseCodeForButton, isReservedMouseButton } from './mouse_binds';
import {
  inForcedPointerLockCooldown,
  pointerLockNeedsSyncGesture,
  shouldEngagePointerLock,
  shouldEngagePointerLockOnMouseDown,
  shouldReleasePointerLock,
} from './pointer_lock';
import { normalizePointerLookDelta } from './pointer_look_delta';
import { clickPickFromMouseGesture, DEFAULT_CLICK_PICK_MAX_MS } from './pointer_pick';

function detectPointerLockNeedsSyncGesture(): boolean {
  try {
    return pointerLockNeedsSyncGesture(navigator.userAgent);
  } catch {
    return false;
  }
}

const BASE_LOOK_SENS = 0.0045;
const TOUCH_LOOK_YAW_RATE = 3.2;
const TOUCH_LOOK_PITCH_RATE = 2.2;
// One-finger swipe-drag on the open canvas (mobile_controls.ts onSwipeLookMove)
// felt sluggish next to the joystick look path: a full-screen-width swipe barely
// turned the camera. This multiplier only scales that drag path, not mouselook
// or the camera joystick, so desktop and the joystick are unaffected.
const TOUCH_DRAG_SENS_MULT = 2.2;
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
  // Pet-bar command (bound to Ctrl+1..5 by default): attack the current target,
  // stop (passive stance), taunt, or set the defensive/aggressive stance.
  onPet(action: 'attack' | 'stop' | 'taunt' | 'defensive' | 'aggressive'): void;
  // Select your own pet (Ctrl+6 by default). Separate from onPet: this targets the
  // pet rather than commanding it, so it belongs with the targeting callbacks above.
  onTargetPet(): void;
  onAbility(slot: number): void;
  // Action-bar slot key DOWN / UP, so a slot can HOLD to charge (the Vale Cup
  // shoot) and release to fire. A tap is a down immediately followed by an up.
  onAbilityDown(slot: number): void;
  onAbilityUp(slot: number): void;
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
      | 'targetAuras'
      | 'social'
      | 'arena'
      | 'valecup'
      | 'bgFlag'
      | 'dungeonFinder'
      | 'leaderboard'
      | 'calendar'
      | 'discord'
      | 'deeds'
      | 'professions'
      | 'crafting'
      | 'sheathe'
      | 'mount',
  ): void;
  onEmoteWheel(open: boolean): void;
  onClickPick(x: number, y: number, button: number): void;
  /** Attack-move key pressed (only fires while Attack Move mode is on); x/y is the cursor. */
  onAttackMove?(x: number, y: number): void;
  /** When false, keydown-driven actions are ignored: edge actions (spells, UI keys)
   *  and held movement keys. Escape is handled before this gate and still reaches
   *  onUiKey; key releases are ungated. */
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
    dive: boolean;
    surface: boolean;
  };
  leftDown: boolean;
  rightDown: boolean;
  cameraDragActive: boolean;
  pointerLocked: boolean;
  hoverActive: boolean;
}

// Camera-driven swimming. camPitch is POSITIVE looking DOWN (renderer.ts seats
// the boom at eyeY + sin(pitch) * dist), clamped to [-0.4, 1.35], and RESTS at
// 0.32 — so the bands cannot be centred on zero: a neutral camera has to mean
// "hold this depth", or every swimmer would sink on sight. Diving needs a
// deliberate ~17 degrees past rest, surfacing about 15 degrees back the other
// way, leaving a wide dead band in between.
const SWIM_LOOK_DOWN = 0.62;
const SWIM_LOOK_UP = 0.05;
// ...and how far PAST that threshold the view is aimed, which scales the rate:
// ease the camera over the line and you drift down, bury it and you plunge.
// Ends of each ramp, in camPitch radians (the clamps are the natural ends).
const SWIM_DIVE_FULL = 1.25;
const SWIM_SURFACE_FULL = -0.3;
// Quantised, because the steer rides the SAME change-detected input frame as
// the movement keys (net/online.ts inputSignature): a continuous float would
// resend on every mouse-move, where steps resend only when the band changes.
// Six steps is finer than the eye reads on a 3.2 yd/s descent.
const SWIM_STEER_STEPS = 6;
// Hysteresis on the threshold itself. Without it, a camera resting exactly on
// the line chatters the dive bit (and its input frame) at mouse-jitter rate.
const SWIM_LOOK_HYSTERESIS = 0.05;

/** Camera pitch -> 0..1 steer, quantised, for whichever band the view is in. */
export function swimSteerFromPitch(pitch: number, from: number, to: number): number {
  const t = Math.min(1, Math.max(0, (pitch - from) / (to - from)));
  return Math.round(t * SWIM_STEER_STEPS) / SWIM_STEER_STEPS;
}

export class Input {
  keys = new Set<string>();
  leftDown = false;
  rightDown = false;
  camYaw = Math.PI;
  camPitch = 0.32;
  camDist = 12;
  // Fired whenever the player changes the zoom distance (wheel / pinch), so main.ts can
  // persist it to settings (issue 1657). Not fired on a direct camDist assignment (the
  // startup restore / Reset path sets the field itself), so restoring never re-persists.
  onCameraDistChange?: (dist: number) => void;
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
  // Set when the browser itself force-unlocks the pointer (Escape, focus
  // loss) while a drag button was still held; see inForcedPointerLockCooldown.
  private forcedUnlockAt: number | null = null;
  // Firefox rejects requestPointerLock() when it is deferred to a later
  // mousemove; computed once since the browser cannot change mid-session.
  private readonly needsSyncPointerLockGesture = detectPointerLockNeedsSyncGesture();
  private downX = 0;
  private downY = 0;
  private downAt = 0;
  // one-shot key capture for the rebind UI: the next keydown is delivered here
  // (Escape cancels with null) instead of being dispatched as an action
  private captureCb: ((code: string | null) => void) | null = null;
  private controllerMoveInput: MoveInput | null = null;
  private controllerFacing: number | null = null;
  private emoteWheelHeldCodes = new Set<string>();
  // Advances only when the player starts or replaces movement. Releasing a held
  // key/stick is not newer travel intent and must not invalidate a delayed
  // successful interaction that should stop autorun.
  private movementIntentRevision = 0;
  // Physical key code -> action-bar slot currently held down, so key UP (or a
  // blur) releases the matching slot (drives the hold-to-charge shoot).
  private heldSlotCodes = new Map<string, number>();
  // MouseEvent.button indices whose press this frame was consumed by a binding
  // (or by the rebind capture), so the matching `auxclick` can be cancelled too.
  // Chromium and Gecko navigate back/forward on the thumb buttons; cancelling
  // both events is what keeps a bound thumb button from also leaving the page.
  // An UNBOUND button is deliberately left alone, so browser navigation behaves
  // exactly as it does today for every player who binds nothing.
  private consumedMouseButtons = new Set<number>();
  // mouse-look sensitivity, in radians per pixel of drag; the old fixed value
  // was BASE_LOOK_SENS — setCameraSpeed scales it from the settings menu
  private lookSensitivity = BASE_LOOK_SENS;
  // Gecko (Firefox) reports movementX/movementY in CSS pixels, not the physical
  // pixels Chromium reports and the sensitivity is tuned against, so on a HiDPI
  // display or under page zoom its mouselook runs at the wrong speed (#1834).
  // Detected once (the engine never changes mid-session) and used to normalize
  // each delta in onMouseMove; every other engine stays a pass-through.
  private readonly isGeckoEngine =
    typeof navigator !== 'undefined' &&
    detectBrowserEngine(navigator.userAgent || '').engine === 'gecko';
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
  // Swim-down held by an on-screen/controller control (the keyboard path is the
  // 'dive' held action). Not latched like the jump tap: descending is a hold.
  private touchDive = false;
  // Latched sides of the camera-steer bands (see readSwimSteer): which one the
  // view is currently inside, so the threshold can hysteresis rather than
  // chatter when the camera rests on it.
  private swimLookDown = false;
  private swimLookUp = false;
  // The pitch the SWIMMER aims along — synced from camPitch only by STEERING
  // looks (right-drag mouselook, touch look, gamepad look, mouse-camera mode).
  // A left-drag orbit is camera-only sightseeing and must never steer the
  // body up or down through the water (the WoW rule).
  private swimAimPitch = 0.32;
  private keyJumpUntil = 0;
  private touchLookActive = false;
  // True while the gamepad's right stick is deflected past its deadzone, set
  // each poll by GamepadManager (mirrors touchLookActive for the touch camera
  // joystick). Folded into isMouselookActive() so looking around with the
  // right stick turns the character the same way the touch joystick and
  // mouselook do, instead of only ever orbiting the free camera.
  private gamepadLookActive = false;
  private touchLookVector = { x: 0, y: 0 };
  // multiplier on the touch look rate, both the camera joystick (updateTouchLook)
  // and the default one-finger swipe-drag (applyTouchLookDelta); setTouchLookSpeed
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
      if (!document.pointerLockElement) {
        // A forced unlock (Escape, or losing focus while locked) fires with a
        // drag button still physically down: the ordinary end-of-drag
        // exitPointerLock() call only ever runs after mouseup has already
        // cleared leftDown/rightDown. This is not a hard guarantee though:
        // setLockCursorOnRotate()/setMouseCameraEnabled() call
        // exitPointerLock() directly and can fire mid-drag with a button
        // still held, which reads here as a forced unlock too. The fallout is
        // small (toggling one of those settings mid-drag suppresses the lock
        // for the next ~1.3s on Firefox) and self-corrects once the drag
        // ends, so it is an accepted trade-off rather than something worth
        // threading extra state through to distinguish. Remember the forced
        // unlock so the next requestPointerLock() attempt can skip Firefox's
        // post-forced-unlock cooldown instead of failing silently mid-drag
        // (#1834 recurrence).
        if (this.leftDown || this.rightDown) this.forcedUnlockAt = performance.now();
        this.releaseCapture('pointerlock');
        return;
      }
      // A fast click can beat the async requestPointerLock() grant: the
      // mousedown-synchronous request above (Firefox) or the drag-threshold
      // request (Chromium) can resolve AFTER mouseup already ran, so nothing
      // released it there. If the grant lands with no drag button currently
      // held, drop it immediately rather than leaving the cursor stuck
      // captured until the next press/release cycle.
      if (
        shouldReleasePointerLock({
          anyButtonDown: this.leftDown || this.rightDown,
          hasLock: document.pointerLockElement === this.canvas,
        })
      ) {
        document.exitPointerLock();
      }
    });
    // A denied request (e.g. the forced-unlock cooldown above, or any other
    // rejection) otherwise leaves pointerLockRequestedForDrag wrongly set to
    // true with no lock actually granted; without this the drag never
    // reconsiders requesting the lock again for the rest of that press.
    document.addEventListener('pointerlockerror', () => {
      this.pointerLockRequestedForDrag = false;
      // A denial is itself the strongest available evidence that we are
      // inside Firefox's forced-unlock cooldown, whatever caused it: the
      // pointerlockchange handler above only records forcedUnlockAt when a
      // drag button happens to still be held at unlock time, which misses
      // orderings where focus loss clears leftDown/rightDown before the
      // unlock event fires (blur landing ahead of pointerlockchange, the
      // likely ordering for a focus-loss forced unlock). Recording it here
      // too makes the mechanism self-healing: the next drag attempt within
      // the window skips the doomed request regardless of event ordering.
      this.forcedUnlockAt = performance.now();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseCapture('hidden');
    });
    document.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    document.addEventListener('selectstart', (e) => this.onSelectStart(e));
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    // The bindable mouse buttons (middle and up) listen on the WINDOW, not the
    // canvas: a thumb button bound to an ability has to fire while the cursor
    // rests over the HUD too, exactly like the keyboard does.
    window.addEventListener('mousedown', (e) => this.onBindableMouseDown(e));
    window.addEventListener('auxclick', (e) => this.onAuxClick(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (document.body.classList.contains('mobile-touch')) return;
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

  /** Move the camera in/out, clamped to the zoom limits. */
  zoomBy(delta: number): void {
    const next = Math.min(22, Math.max(3, this.camDist + delta));
    if (next === this.camDist) return;
    this.camDist = next;
    this.onCameraDistChange?.(next);
  }

  /** True while a mouse button is held for camera drag. */
  isDragging(): boolean {
    return this.leftDown || this.rightDown;
  }

  isCameraDragActive(): boolean {
    return this.cameraDragActive;
  }

  cursorPoint(): { x: number; y: number } | null {
    return this.hoverActive ? { x: this.hoverX, y: this.hoverY } : null;
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
        // Read the camera-steer bands the way the move frame does (latched
        // thresholds, key OR camera, move-gated), so the readout cannot
        // disagree with the input the sim is actually being given.
        dive:
          (this.anyMoveHeld() && this.swimLookDown) || this.heldAction('dive') || this.touchDive,
        surface: this.anyMoveHeld() && this.swimLookUp,
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

  setSuspendMovement(on: boolean): void {
    if (this.suspendMovement === on) return;
    this.suspendMovement = on;
    if (!on) return;
    // The held-open emote wheel itself counts as a modal (hud.isModalOpen()),
    // so when its keys are down this suspension almost always IS the wheel. The
    // stale-input clear below must not run then: it would close the wheel one
    // frame after the bound key opened it, and drop still-held movement keys
    // mid-emote. Nothing held is actually stale in that state, because onKeyUp
    // is never modal-gated and releaseCapture handles focus loss. (Rare corner:
    // the hud can close the wheel while the key is still physically down, e.g.
    // Escape or clicking a slice mid-hold; a menu suspension inside that window
    // also skips the clear, which just restores the pre-clear behavior of held
    // movement resuming when the menu closes.)
    if (this.emoteWheelHeldCodes.size > 0) return;
    const hadHeldInput = this.keys.size > 0 || this.keyJumpUntil > 0;
    this.keys.clear();
    this.keyJumpUntil = 0;
    // Suspending input drops any charging Vale Cup sport move (held Shoot etc.).
    this.releaseHeldSlots();
    if (hadHeldInput) this.noteIntent('move');
  }

  /**
   * Reset every transient gameplay-input source before an in-place client
   * transition. Unlike an ordinary modal suspension, this also drops autorun,
   * click-to-move, controller/touch/gamepad state, and latched jumps so no old
   * intent can resume when the transition curtain comes down.
   */
  resetForClientTransition(): void {
    const emoteWheelWasOpen = this.emoteWheelHeldCodes.size > 0;
    this.keys.clear();
    this.keyJumpUntil = 0;
    this.touchJumpUntil = 0;
    this.autorun = false;
    this.clearClickMove();
    this.touchMove = { forward: false, back: false, strafeLeft: false, strafeRight: false };
    this.gamepadMove = { forward: false, back: false, strafeLeft: false, strafeRight: false };
    this.touchLookActive = false;
    this.touchLookVector = { x: 0, y: 0 };
    this.gamepadLookActive = false;
    this.controllerMoveInput = null;
    this.controllerFacing = null;
    this.leftDown = false;
    this.rightDown = false;
    this.cameraDragActive = false;
    this.downButton = -1;
    this.pointerLockRequestedForDrag = false;
    this.releaseHeldSlots();
    this.emoteWheelHeldCodes.clear();
    if (emoteWheelWasOpen) this.cb.onEmoteWheel(false);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
    this.suspendMovement = true;
    this.updateCursor();
    this.noteIntent('move');
  }

  // Passing null clears an armed capture without invoking a callback, so a
  // caller that abandons a pending capture (Done / Reset confirm) does not
  // leave a stale one-shot handler in place to swallow the player's next
  // real keypress.
  captureNextKey(cb: ((code: string | null) => void) | null): void {
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
    const moving = move.forward || move.back || move.strafeLeft || move.strafeRight;
    this.touchMove = move;
    if (move.forward || move.back) this.autorun = false;
    if (changed) {
      if (moving) this.noteMovementIntent();
      else this.noteIntent('move');
    }
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

  /** Touch/controller swim-down, held for as long as the control is pressed. */
  setTouchDive(on: boolean): void {
    if (this.touchDive !== on) this.noteMovementIntent();
    this.touchDive = on;
  }

  // Touch-reachable autorun toggle (the keyboard path is the 'autorun' edge action).
  // Returns the new state so the on-screen button can reflect it.
  toggleAutorun(): boolean {
    this.autorun = !this.autorun;
    this.noteMovementIntent();
    return this.autorun;
  }

  // Idempotent autorun latch for analog inputs that have a one-way "engage"
  // gesture, such as the mobile move joystick's top band.
  setAutorun(on: boolean): boolean {
    if (this.autorun !== on) this.noteMovementIntent();
    this.autorun = on;
    return this.autorun;
  }

  movementIntentVersion(): number {
    return this.movementIntentRevision;
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
    const dragSens = this.lookSensitivity * TOUCH_DRAG_SENS_MULT * this.touchLookSpeed;
    this.camYaw -= dx * dragSens;
    this.camPitch = Math.min(
      1.35,
      Math.max(-0.4, this.camPitch + this.touchPitchSign * dy * dragSens),
    );
    this.swimAimPitch = this.camPitch;
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
    const moving = move.forward || move.back || move.strafeLeft || move.strafeRight;
    this.gamepadMove = move;
    if (move.forward || move.back) this.autorun = false;
    if (changed) {
      if (moving) this.noteMovementIntent();
      else this.noteIntent('move');
    }
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
    this.swimAimPitch = this.camPitch;
    this.noteIntent('look');
  }

  // Set each poll by GamepadManager from stickToLook's `active` flag: true
  // while the right stick is deflected past its deadzone. See
  // isMouselookActive, which folds this in the same way touchLookActive is.
  setGamepadLookActive(active: boolean): void {
    if (active !== this.gamepadLookActive) this.noteIntent('look');
    this.gamepadLookActive = active;
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
    this.swimAimPitch = this.camPitch;
  }

  /** Snap the orbit camera back behind the character (mobile recenter gesture). */
  recenterCameraBehind(facing: number): void {
    if (Number.isFinite(facing)) this.camYaw = facing;
    this.camPitch = 0.32;
    this.swimAimPitch = 0.32;
  }

  isMouselookActive(): boolean {
    if (this.mouseCameraEnabled) return this.touchLookActive || this.gamepadLookActive;
    return (
      (this.rightDown && this.cameraDragActive) || this.touchLookActive || this.gamepadLookActive
    );
  }

  setControllerMoveInput(input: unknown, facing?: unknown): void {
    this.controllerMoveInput = sanitizeMoveInput(input);
    if (facing !== undefined) this.controllerFacing = sanitizeMoveFacing(facing);
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
    this.noteMovementIntent();
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

  private msSinceForcedUnlock(): number | null {
    return this.forcedUnlockAt === null ? null : performance.now() - this.forcedUnlockAt;
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
    if (reason !== 'pointerlock') this.releaseHeldSlots();
    // Focus loss swallows the auxclick that would have cleared these, so drop
    // them here rather than letting a stale entry cancel a later, unrelated click.
    if (reason !== 'pointerlock') this.consumedMouseButtons.clear();
    this.updateCursor();
    if (hadInput) this.noteIntent('move');
  }

  private updateCursor(): void {
    this.canvas.style.cursor = cursorForHover(
      this.hoverKind,
      this.cameraDragActive || document.pointerLockElement === this.canvas,
    );
  }

  /**
   * Engage the pointer lock for the active camera drag if it is both wanted
   * (setting on, not already locked, not in Firefox's forced-unlock cooldown).
   * The Lock Cursor setting means every active camera drag holds the pointer
   * until mouseup, so the cursor cannot escape the game surface mid-look. Still
   * at most one request per drag (#116), in both camera modes, with fullscreen
   * on the same path so mouselook behaves identically there.
   */
  private maybeEngageDragPointerLock(): void {
    if (this.pointerLockRequestedForDrag) return;
    if (
      !shouldEngagePointerLock({
        lockOnRotate: this.lockCursorOnRotate,
        isFullscreen: this.isBrowserFullscreen(),
        alreadyLocked: document.pointerLockElement === this.canvas,
      })
    )
      return;
    if (
      inForcedPointerLockCooldown({
        needsSyncGesture: this.needsSyncPointerLockGesture,
        msSinceForcedUnlock: this.msSinceForcedUnlock(),
      })
    )
      return;
    this.pointerLockRequestedForDrag = true;
    this.canvas.requestPointerLock?.();
  }

  private activateCameraDrag(): void {
    this.cameraDragActive = true;
    this.maybeEngageDragPointerLock();
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
      this.noteMovementIntent();
    }
    const edge = combo ? this.keybinds.edgeActionForCombo(combo) : null;
    if (edge !== null) {
      // A matched chord that carries a modifier (Ctrl/Alt/Cmd) shadows a browser
      // accelerator, e.g. Ctrl+number tab switching. Cancel the default so the
      // game keeps the keypress. Some accelerators are not cancelable (Chrome and
      // Edge reserve Ctrl+1..8 outright), but this reclaims the ones that are
      // (Firefox) and is a no-op where there is nothing to cancel.
      if (e.ctrlKey || e.altKey || e.metaKey) e.preventDefault?.();
      // 'chat' focuses the composer textarea as a side effect of this very
      // keydown. Left un-prevented, the browser still delivers the follow-up
      // keypress (and its default newline insertion) to whichever element is
      // focused AT THAT POINT, i.e. the composer we just focused, so Enter
      // both opens chat and types a newline into it before the placeholder is
      // ever seen. Cancel the default so the composer opens empty, but only
      // when the key was not itself focused on a button: a button's own Enter
      // activation is a real default action too, and it should still fire
      // alongside chat opening, same as before this fix.
      if (edge === 'chat' && tag !== 'button') e.preventDefault?.();
      if (edge.startsWith('slot')) {
        // Slot keys use DOWN/UP so a slot can hold to charge; the HUD decides
        // whether a slot charges (shoot) or fires immediately (tap = down+up).
        const slot = Number(edge.slice(4));
        this.heldSlotCodes.set(e.code, slot);
        this.cb.onAbilityDown(slot);
      } else {
        this.dispatchEdge(edge);
      }
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (this.releaseBoundCode(e.code)) e.preventDefault();
  }

  // The release half of a bound press, shared by the keyboard (onKeyUp) and the
  // bindable mouse buttons (onMouseUp): drop the code from the held-movement
  // set, close the emote wheel once its last held code lifts, and end a slot
  // that was charging. Returns true when the emote wheel closed, the one case
  // the caller cancels the event's default for.
  private releaseBoundCode(code: string): boolean {
    if (this.keys.delete(code)) this.noteIntent('move');
    let closedEmoteWheel = false;
    if (this.emoteWheelHeldCodes.delete(code) && this.emoteWheelHeldCodes.size === 0) {
      this.cb.onEmoteWheel(false);
      closedEmoteWheel = true;
    }
    const slot = this.heldSlotCodes.get(code);
    if (slot !== undefined) {
      this.heldSlotCodes.delete(code);
      this.cb.onAbilityUp(slot);
    }
    return closedEmoteWheel;
  }

  // Release every held slot (fire onAbilityUp), e.g. on blur/menu, so a charge in
  // progress cannot stick.
  private releaseHeldSlots(): void {
    if (this.heldSlotCodes.size === 0) return;
    const slots = [...this.heldSlotCodes.values()];
    this.heldSlotCodes.clear();
    for (const slot of slots) this.cb.onAbilityUp(slot);
  }

  private dispatchEdge(action: string): void {
    if (action.startsWith('slot')) {
      this.cb.onAbility(Number(action.slice(4)));
      return;
    }
    switch (action) {
      case 'autorun':
        this.autorun = !this.autorun;
        this.noteMovementIntent();
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
      case 'petAttack':
        this.cb.onPet('attack');
        return;
      case 'petStop':
        this.cb.onPet('stop');
        return;
      case 'petTaunt':
        this.cb.onPet('taunt');
        return;
      case 'petDefensive':
        this.cb.onPet('defensive');
        return;
      case 'petAggressive':
        this.cb.onPet('aggressive');
        return;
      case 'targetPet':
        this.cb.onTargetPet();
        return;
      case 'interact':
        this.cb.onUiKey('interact');
        return;
      case 'bags':
        this.cb.onUiKey('bags');
        return;
      case 'crafting':
        this.cb.onUiKey('crafting');
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
      case 'targetAuras':
        this.cb.onUiKey('targetAuras');
        return;
      case 'social':
        this.cb.onUiKey('social');
        return;
      case 'arena':
        this.cb.onUiKey('arena');
        return;
      case 'dungeonFinder':
        this.cb.onUiKey('dungeonFinder');
        return;
      case 'mount':
        this.cb.onUiKey('mount');
        return;
      case 'valecup':
        this.cb.onUiKey('valecup');
        return;
      case 'bgFlag':
        this.cb.onUiKey('bgFlag');
        return;
      case 'leaderboard':
        this.cb.onUiKey('leaderboard');
        return;
      case 'calendar':
        this.cb.onUiKey('calendar');
        return;
      case 'discord':
        this.cb.onUiKey('discord');
        return;
      case 'deeds':
        this.cb.onUiKey('deeds');
        return;
      case 'professions':
        this.cb.onUiKey('professions');
        return;
      case 'chat':
        this.cb.onUiKey('chat');
        return;
      case 'sheathe':
        this.cb.onUiKey('sheathe');
        return;
    }
  }

  private onMouseDown(e: MouseEvent): void {
    // Only left and right take part in the camera drag / click-pick gesture. An
    // extra (bindable) button returns early so pressing it never resets a drag
    // already in flight, and so its release cannot synthesize a world click;
    // its binding dispatch is the window-level onBindableMouseDown below.
    if (!isReservedMouseButton(e.button)) return;
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
    // Pointer lock is requested lazily once a drag actually begins on browsers
    // that allow a deferred request (see onMouseMove), not on every press, so
    // ordinary clicks do not show the browser's capture notice (#116). Firefox
    // denies that deferred mousemove call outside fullscreen (see
    // needsSyncPointerLockGesture), so on Firefox it is instead requested
    // synchronously right here for either drag-capable button (left or right),
    // excluding the click-to-move button. That preserves #116 fully only on
    // Chromium: on Firefox, an ordinary click on a non-click-to-move button
    // still takes and releases the lock on every press because we cannot tell a
    // click from a drag until it has already moved.
    this.pointerLockRequestedForDrag = false;
    if (
      shouldEngagePointerLockOnMouseDown({
        button: e.button,
        clickMoveButton: this.clickMoveMouseButton,
        needsSyncGesture: this.needsSyncPointerLockGesture,
        lockOnRotate: this.lockCursorOnRotate,
        alreadyLocked: document.pointerLockElement === this.canvas,
      }) &&
      !inForcedPointerLockCooldown({
        needsSyncGesture: this.needsSyncPointerLockGesture,
        msSinceForcedUnlock: this.msSinceForcedUnlock(),
      })
    ) {
      this.pointerLockRequestedForDrag = true;
      void this.canvas.requestPointerLock?.()?.catch?.(() => {});
    }
    this.updateCursor();
  }

  // A bindable mouse button (middle, thumb back/forward, and anything past them;
  // see mouse_binds.ts) behaves exactly like a key: it feeds the rebind capture,
  // fires held and edge actions through the same Keybinds lookups, and honors the
  // same guards (a focused text field, a menu that suppresses game keys). Held
  // and edge may both fire on one press, the same intentional co-fire onKeyDown
  // allows (move while casting).
  private onBindableMouseDown(e: MouseEvent): void {
    const code = bindableMouseCodeForButton(e.button);
    if (code === null) return; // left/right belong to the camera and click-pick
    // A press whose release lands outside the window never gets its auxclick, so
    // its entry would linger and cancel a later, unrelated one. Drop any stale
    // entry for this button up front: consumeMouseButton re-adds it if this press
    // is consumed too, which makes the set self-correcting one press at a time.
    this.consumedMouseButtons.delete(e.button);
    const combo = makeCombo(code, {
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
    });
    if (this.captureCb) {
      const cb = this.captureCb;
      this.captureCb = null;
      this.consumeMouseButton(e);
      cb(combo);
      return;
    }
    const tag = (document.activeElement?.tagName ?? '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (this.cb.canUseGameKeys && !this.cb.canUseGameKeys()) return;
    // Attack Move mode wins over whatever else shares the button, as on the keyboard.
    if (
      this.attackMoveEnabled &&
      this.hoverActive &&
      this.keybinds.codesForAction('attackMove').includes(combo)
    ) {
      this.consumeMouseButton(e);
      this.cb.onAttackMove?.(this.hoverX, this.hoverY);
      return;
    }
    const held = this.keybinds.heldActionForCode(code);
    if (held === 'emoteWheel') {
      this.emoteWheelHeldCodes.add(code);
      this.cb.onEmoteWheel(true);
    } else if (held !== null) {
      this.keys.add(code);
      if (held === 'forward' || held === 'back') this.autorun = false;
      if (held === 'jump')
        this.keyJumpUntil = Math.max(this.keyJumpUntil, performance.now() + KEY_JUMP_LATCH_MS);
      this.noteMovementIntent();
    }
    const edge = this.keybinds.edgeActionForCombo(combo);
    if (edge !== null) {
      if (edge.startsWith('slot')) {
        // Slot buttons use DOWN/UP so a slot can hold to charge, same as slot keys.
        const slot = Number(edge.slice(4));
        this.heldSlotCodes.set(code, slot);
        this.cb.onAbilityDown(slot);
      } else {
        this.dispatchEdge(edge);
      }
    }
    if (held !== null || edge !== null) this.consumeMouseButton(e);
  }

  // Cancel the browser's own action for a press the game just used (thumb-button
  // history navigation, middle-click autoscroll) and remember the button so its
  // follow-up auxclick is cancelled too.
  private consumeMouseButton(e: MouseEvent): void {
    e.preventDefault?.();
    this.consumedMouseButtons.add(e.button);
  }

  private onAuxClick(e: MouseEvent): void {
    if (!this.consumedMouseButtons.delete(e.button)) return;
    e.preventDefault?.();
  }

  private onMouseUp(e: MouseEvent): void {
    // Release the binding half first: it is the only part an extra button has,
    // and it must run whether the release arrives as pointerup or mouseup.
    const boundCode = bindableMouseCodeForButton(e.button);
    if (boundCode !== null) {
      if (this.releaseBoundCode(boundCode)) e.preventDefault?.();
      return;
    }
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
    // Normalize the raw movement delta to Chromium's physical-pixel unit so
    // mouselook keeps the same speed and drag-start feel on Firefox, where the
    // deltas arrive in CSS pixels (#1834). A no-op on Chromium/WebKit.
    const { dx: mx, dy: my } = normalizePointerLookDelta({
      movementX: e.movementX ?? 0,
      movementY: e.movementY ?? 0,
      isGecko: this.isGeckoEngine,
      devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
    });
    if (mx === 0 && my === 0) {
      if (this.cameraDragActive) this.maybeEngageDragPointerLock();
      return;
    }
    const heldMs = this.pressDurationMs();
    if (this.downButton === this.clickMoveMouseButton && heldMs <= DEFAULT_CLICK_PICK_MAX_MS)
      return;
    this.dragDistance += Math.abs(mx) + Math.abs(my);
    if (!this.cameraDragActive) {
      if (this.dragDistance < CAMERA_DRAG_START_DISTANCE && heldMs < CAMERA_DRAG_START_MS) return;
      this.activateCameraDrag();
      this.noteIntent('look');
      this.updateCursor();
      return;
    }
    // Re-checked on every move of an already-active drag in case the previous
    // request was denied or the lock was released by the browser while the
    // player kept holding a drag button.
    this.maybeEngageDragPointerLock();
    this.camYaw -= mx * this.lookSensitivity;
    this.camPitch = Math.min(
      1.35,
      Math.max(-0.4, this.camPitch + my * this.lookSensitivity * this.lookPitchSign),
    );
    if (this.rightDown || this.mouseCameraEnabled) this.swimAimPitch = this.camPitch;
    if (mx !== 0 || my !== 0) this.noteIntent('look');
  }

  private noteIntent(kind: 'move' | 'look' | 'zoom'): void {
    this.cb.onInputIntent?.(kind);
  }

  private noteMovementIntent(): void {
    this.movementIntentRevision++;
    this.noteIntent('move');
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

  /**
   * The vertical half of swimming, off the camera: whether the view is aimed
   * into a dive or a climb, and how steeply.
   *
   * The thresholds latch (SWIM_LOOK_HYSTERESIS) so a view resting on the line
   * cannot flicker the bit — and with it the netted input frame — at
   * mouse-jitter rate. Beyond the threshold the steer ramps to 1, which is what
   * turns the old on/off plunge into a control you can feather.
   */
  private readSwimSteer(moving: boolean): { dive: boolean; surface: boolean; swimSteer: number } {
    const keyDive = this.heldAction('dive') || this.touchDive;
    const enterDown = this.swimLookDown ? SWIM_LOOK_DOWN - SWIM_LOOK_HYSTERESIS : SWIM_LOOK_DOWN;
    const enterUp = this.swimLookUp ? SWIM_LOOK_UP + SWIM_LOOK_HYSTERESIS : SWIM_LOOK_UP;
    // Bands latch over swimAimPitch — the pitch STEERING looks wrote — never
    // the raw camPitch a left-drag orbit happens to be at (the WoW rule:
    // left-drag is sightseeing, right-drag steers the swimmer).
    this.swimLookDown = this.swimAimPitch >= enterDown;
    this.swimLookUp = this.swimAimPitch <= enterUp;
    // ...and the bands only ACT while the player is actually swimming
    // somewhere (a move key held). Floating in place and pointing the view at
    // the lake bed must not sink you; the explicit dive key always does.
    const bandDown = moving && this.swimLookDown;
    const bandUp = moving && this.swimLookUp;
    const dive = keyDive || bandDown;
    const surface = bandUp;
    // A held KEY is not a steer, so it dives at full rate; the camera grades.
    const swimSteer = keyDive
      ? 1
      : bandDown
        ? swimSteerFromPitch(this.swimAimPitch, SWIM_LOOK_DOWN, SWIM_DIVE_FULL)
        : bandUp
          ? swimSteerFromPitch(this.swimAimPitch, SWIM_LOOK_UP, SWIM_SURFACE_FULL)
          : 0;
    return { dive, surface, swimSteer };
  }

  /** Any horizontal movement input held, from any device — the gate the swim
   *  camera bands ride (readSwimSteer). Mirrors the readMoveInput sources. */
  private anyMoveHeld(): boolean {
    return (
      this.heldAction('forward') ||
      this.heldAction('back') ||
      this.heldAction('strafeLeft') ||
      this.heldAction('strafeRight') ||
      this.heldAction('turnLeft') ||
      this.heldAction('turnRight') ||
      (this.leftDown && this.rightDown) ||
      this.autorun ||
      this.touchMove.forward ||
      this.touchMove.back ||
      this.touchMove.strafeLeft ||
      this.touchMove.strafeRight ||
      this.gamepadMove.forward ||
      this.gamepadMove.back ||
      this.gamepadMove.strafeLeft ||
      this.gamepadMove.strafeRight
    );
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
        dive: false,
        surface: false,
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
    // Swim down / up, from the CAMERA as well as the keys: steer the view down
    // (right-drag) while swimming forward and you dive, tilt it back up and
    // you rise. The camera bands only act while a MOVE key is held and only
    // read steering looks — floating in place and orbiting with left-drag
    // never moves the body (the WoW rule). Every flag here is only ever read
    // while swimming, so aiming the camera around on land is inert. See
    // SWIM_LOOK_* for the bands and swimSteer for the graded rate.
    const { dive, surface, swimSteer } = this.readSwimSteer(this.anyMoveHeld());

    if (this.mouseCameraEnabled) {
      return {
        forward,
        back,
        jump,
        dive,
        surface,
        swimSteer,
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
      dive,
      surface,
      swimSteer,
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
