import { t } from '../ui/i18n';
import { bindTouchTap } from '../ui/touch_tap';
import type { Input, TouchMoveInput } from './input';
import { type ChromeFadeHandle, startChromeFade } from './mobile_chrome_fade';
import type { TouchOwner, TouchRouterTarget } from './touch_router';
import {
  getTouchOwner,
  isCameraDragAllowedAt,
  isInteractiveHudElement,
  TouchOwnerLedger,
} from './touch_router';

// Detects a genuinely touch-primary device (a phone or a hand-held tablet). The
// primary test is a coarse primary pointer that cannot hover -- deliberately
// narrower than "(any-pointer: coarse)" or navigator.maxTouchPoints, which both
// fire on ordinary desktops/laptops that merely expose a touch-capable peripheral
// (a precision touchpad, a pen/Wacom digitizer, or a touchscreen used alongside a
// mouse) and would otherwise boot those machines straight into the mobile UI.
//
// The two phone-form-factor clauses are a safety net for a Chromium quirk:
// Samsung (and some OnePlus) phones self-report a virtual hovering mouse, so
// "(hover: none)" is false on a genuine touch-only Samsung phone. A coarse
// PRIMARY pointer on a phone-sized viewport recovers those without re-matching
// any desktop -- a desktop's primary pointer is fine, so none of these
// "(pointer: coarse) and ..." clauses fire there regardless of viewport size.
export const PHONE_TOUCH_QUERY =
  '(pointer: coarse) and (hover: none), (pointer: coarse) and (max-width: 940px), (pointer: coarse) and (max-height: 760px)';
const DEADZONE = 0.22;
// How far the move wheel's DRAWN position may lean from its resting spot
// toward the thumb (px), so a touch anywhere in the (much larger) move zone
// leans the visible wheel toward it without teleporting it clear across the
// screen. Cosmetic only: never fed into the input math (see onMoveDown).
const MOVE_JOYSTICK_FLOAT_RADIUS = 48;
const CAMERA_SENSITIVITY = 0.8;
export const MOVE_AUTORUN_REVEAL_THRESHOLD = 1.45;
export const MOVE_AUTORUN_THRESHOLD = 2.05;
// TODO: a dedicated deadzone/smoothing setting for swipe-look is deferred (plan
// decision 7); touchLookSpeed already covers sensitivity for both the camera
// joystick and swipe-look, so this constant stays a fixed tuning value for now.
const SWIPE_LOOK_DEADZONE_PX = 6;
// Ignore small two-finger jitter before treating the gesture as intentional
// camera zoom. The sensitivity is deliberately lower than the old pinch path so
// a comfortable spread/pinch changes camera distance gradually.
const PINCH_ZOOM_DEADZONE_PX = 12;
const PINCH_ZOOM_SENSITIVITY = 0.035;
// Haptic feedback: short Vibration-API buzzes so touch actions feel physical.
// On by default (own localStorage key, like music's ev_music_on); try/catch +
// feature-detect guarded so it no-ops on desktop and under Vitest/jsdom.
export const HAPTICS_STORE_KEY = 'woc_haptics_on';
export const HAPTIC_TAP = 10; // a button press
export const HAPTIC_JOYSTICK = 6; // grabbing a joystick
export const HAPTIC_CONFIRM = [12, 40, 12]; // haptics toggled back on

type VibrationNavigator = { vibrate?: (pattern: number | number[]) => boolean };

export function loadHapticsEnabled(
  storage: Pick<Storage, 'getItem'> | null = safeLocalStorage(),
): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(HAPTICS_STORE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveHapticsEnabled(
  on: boolean,
  storage: Pick<Storage, 'setItem'> | null = safeLocalStorage(),
): void {
  try {
    storage?.setItem(HAPTICS_STORE_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

// The top-left menu-button cluster (Chat/Social/Quests/Settings/More) ships
// COLLAPSED behind an arrow chip, because its round icons crowd the play field
// (live PR #1736 feedback). Only a player who taps it open is remembered as
// expanded across sessions; the absent/any-other value is the collapsed default.
// Own localStorage key, like music's ev_music_on and the haptics flag above.
export const MENU_EXPANDED_STORE_KEY = 'woc_menu_expanded';

export function loadMenuExpanded(
  storage: Pick<Storage, 'getItem'> | null = safeLocalStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(MENU_EXPANDED_STORE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveMenuExpanded(
  on: boolean,
  storage: Pick<Storage, 'setItem'> | null = safeLocalStorage(),
): void {
  try {
    storage?.setItem(MENU_EXPANDED_STORE_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

/** Fire a haptic pulse when enabled and the Vibration API exists. Returns whether it fired. */
export function triggerHaptic(
  pattern: number | number[],
  enabled: boolean,
  nav: VibrationNavigator | null = typeof navigator !== 'undefined' ? navigator : null,
): boolean {
  if (!enabled || !nav || typeof nav.vibrate !== 'function') return false;
  try {
    return nav.vibrate(pattern);
  } catch {
    return false;
  }
}

function safeLocalStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Hold the Chat button at least this long (ms) to toggle the read-only log peek
 * instead of opening the keyboard composer. */
export const CHAT_LONG_PRESS_MS = 420;

/** A press is a "long press" (log-peek toggle) once it has been held for at least
 * {@link CHAT_LONG_PRESS_MS}; shorter presses are taps that open the composer. */
export function isChatLongPress(heldMs: number, threshold = CHAT_LONG_PRESS_MS): boolean {
  return heldMs >= threshold;
}
// A quick second tap on the camera joystick (within this window, without
// dragging it into a look) snaps the camera back behind the character.
export const RECENTER_DOUBLE_TAP_MS = 300;
const RECENTER_TAP_MOVE_PX = 12;

export interface MobileControlCallbacks {
  /** Cycle the hostile target (the Tab-target path) from the ring's Target button. */
  onCycleTarget(): void;
  onJump(): void;
  onInteract(): void;
  /** Open the composer focused (raise the keyboard): the keybind / whisper path. */
  onChat(): void;
  /** Open the centered read view: composer bar visible but NOT focused (no keyboard). */
  onChatOpen(): void;
  /** Close chat entirely (hide the composer, drop the keyboard, recover the viewport). */
  onChatClose(): void;
  onMenu(): void;
  onSocial(): void;
  /** Open the Discord entry (account panel when available, else the community invite). */
  onDiscord(): void;
  /** Open the project donation page (external link). */
  onDonate(): void;
  onEmotes(): void;
  onArena(): void;
  /** Open the Vale Cup window (queue/roster board for the boarball minigame). */
  onValeCup(): void;
  onQuestLog(): void;
  onCharacter(): void;
  onBags(): void;
  onSpellbook(): void;
  onTalents(): void;
  onMap(): void;
  onLeaderboard(): void;
  /** Open the Daily Rewards chest, folded into the More tray on mobile. */
  onDailyRewards(): void;
  /** Toggle world nameplates; returns the new on/off state to sync the button glow. */
  onNameplates(): boolean;
  /** Toggle background music; returns whether music is now enabled. */
  onMusic(): boolean;
  /** Double-tap the camera joystick: snap the camera back behind the character. */
  onRecenterCamera(): void;
}

/**
 * True when a camera-joystick tap should count as the second half of a
 * recenter double-tap: the press was a quick, near-stationary tap (not a
 * look-drag) and it landed within the double-tap window of the previous tap.
 */
export function isRecenterDoubleTap(
  prevTapAt: number,
  now: number,
  moved: boolean,
  threshold = RECENTER_DOUBLE_TAP_MS,
): boolean {
  return !moved && prevTapAt > 0 && now - prevTapAt <= threshold;
}

export function isPhoneTouchDevice(win: Pick<Window, 'matchMedia'> = window): boolean {
  return win.matchMedia(PHONE_TOUCH_QUERY).matches;
}

// Player-chosen interface override (Options > Graphics > Interface Mode). 'auto'
// keeps the device auto-detection above; 'desktop'/'touch' force one interface
// regardless, so a tablet driven by a keyboard+mouse can pick the desktop UI and
// a desktop user can opt into the on-screen controls.
export type InterfaceMode = 'auto' | 'desktop' | 'touch';

/** Map the numeric interfaceMode setting (0 Auto, 1 Desktop, 2 Touch) to its mode. */
export function interfaceModeFromSetting(value: number): InterfaceMode {
  return value >= 2 ? 'touch' : value >= 1 ? 'desktop' : 'auto';
}

/** Resolve whether to present the touch interface: an explicit override wins,
 *  'auto' falls back to what the device auto-detection reported. */
export function resolveTouchInterface(mode: InterfaceMode, autoDetected: boolean): boolean {
  if (mode === 'desktop') return false;
  if (mode === 'touch') return true;
  return autoDetected;
}

let interfaceOverride: InterfaceMode = 'auto';

/** main.ts pushes the persisted interfaceMode setting here at boot + on change. */
export function setInterfaceMode(mode: InterfaceMode): void {
  interfaceOverride = mode;
}

/** Whether the on-screen touch interface should be shown for this player: their
 *  explicit override, else the device auto-detection. The native-app shell still
 *  forces touch on top of this (see isNativeAppShell call sites). */
export function useTouchInterface(win: Pick<Window, 'matchMedia'> = window): boolean {
  return resolveTouchInterface(interfaceOverride, isPhoneTouchDevice(win));
}

/** True inside the packaged native mobile app (VITE_NATIVE_APP build), which
 *  forces the touch UI regardless of the Interface Mode override. */
export function isNativeAppShell(): boolean {
  if (typeof document !== 'undefined' && document.body.classList.contains('native-app'))
    return true;
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/**
 * The floating wheel spawns EXACTLY under the thumb, never clamped: the input
 * origin must equal the touch point or the touchdown itself produces movement
 * intent. The shipped v0.22.0 clamp (clampJoystickOrigin) pinned the origin
 * into the 132px capture zone, which cannot contain the 140/128px wheel, so
 * every off-center touchdown instantly walked the character in an unintended
 * direction: the issue #1229 drift class that release testing hit. The wheel
 * VISUAL may overhang the zone or the screen edge; that is standard
 * floating-stick behavior and costs nothing (it is repositioned per touch).
 */

export function mapJoystickVector(x: number, y: number, deadzone = DEADZONE): TouchMoveInput {
  const mag = Math.hypot(x, y);
  if (mag < deadzone) return { forward: false, back: false, strafeLeft: false, strafeRight: false };
  const axis = deadzone * 0.85;
  return {
    forward: y < -axis,
    back: y > axis,
    strafeLeft: x < -axis,
    strafeRight: x > axis,
  };
}

export function isMoveAutorunPush(y: number, threshold = MOVE_AUTORUN_THRESHOLD): boolean {
  return y <= -threshold;
}

export function isMoveAutorunNear(y: number, threshold = MOVE_AUTORUN_REVEAL_THRESHOLD): boolean {
  return y <= -threshold;
}

export class MobileControls {
  private active = false;
  private hapticsOn = loadHapticsEnabled();
  // Whether the top-left menu-button cluster is expanded; persisted, default
  // collapsed. Applied to <body> on start() so the CSS reveal matches the
  // stored preference before the first tap.
  private menuExpanded = loadMenuExpanded();
  private joyPointer: number | null = null;
  private lookPointer: number | null = null;
  // Camera joystick is opt-in (settings.mobileCameraJoystick, def false): hidden
  // by CSS and inert here until the player turns it on. main.ts pushes the
  // persisted value in at boot via setCameraJoystickEnabled.
  private cameraJoystickEnabled = false;
  // Per-pointer ownership so a touch that starts on a button/movement zone/menu
  // never falls through to camera drag, even if it later drifts over the canvas
  // (see touch_router.ts's consumer contract).
  private touchOwners = new TouchOwnerLedger();
  private mq: MediaQueryList | null = null;
  private moveDeadzone = DEADZONE;
  // recenter double-tap bookkeeping for the camera joystick
  private lastCameraTapAt = 0;
  private cameraDownAt = 0;
  private cameraDownX = 0;
  private cameraDownY = 0;
  private cameraMoved = false;

  private moveOriginX = 0;
  private moveOriginY = 0;
  /** Rendered (transform-scaled) wheel radius: the input throw distance. */
  private moveRadius = 1;
  private moveAutorunLocked = false;
  /** Layout (pre-transform) wheel radius: what style.left/top and the stick's
   *  translate use; the --joy-scale transform scales those visually. */
  private moveStickRadius = 1;

  // Track two-finger canvas gestures for guarded camera zoom and to suppress
  // swipe-look while both fingers are down. Touches that begin on HUD chrome are
  // owned by the router and never reach this canvas path.
  private pinchPointers = new Map<number, { x: number; y: number }>();
  private pinchPrevDist: number | null = null;
  private swipeLookPointer: number | null = null;
  private swipeLookStartX = 0;
  private swipeLookStartY = 0;
  private swipeLookLastX = 0;
  private swipeLookLastY = 0;
  private swipeLookActive = false;
  private swipeLookDownAt = 0;
  private lastSwipeTapAt = 0;
  // Set when a pinch degrades to one finger and that finger is adopted as a
  // fresh swipe-look (see onPinchEnd). The adopted finger's tracked position
  // may be stale (pinch pointers hold no capture, so moves over HUD chrome are
  // lost), so the first move only resyncs the origin instead of applying a
  // spurious jump delta; and a pinch remnant is never a recenter "tap".
  private swipeLookResync = false;
  private swipeLookAdopted = false;

  private chatPressTimer: ReturnType<typeof setTimeout> | null = null;
  private chatLongFired = false;
  private chromeFade: ChromeFadeHandle | null = null;

  private canvas = document.getElementById('game-canvas') as HTMLElement | null;
  private root = document.getElementById('mobile-controls') as HTMLElement | null;
  private moveZone = document.getElementById('mobile-move-zone') as HTMLElement | null;
  private moveJoystick = document.getElementById('mobile-move-joystick') as HTMLElement | null;
  private moveStick = document.getElementById('mobile-move-stick') as HTMLElement | null;
  private cameraJoystick = document.getElementById('mobile-camera-joystick') as HTMLElement | null;
  private cameraStick = document.getElementById('mobile-camera-stick') as HTMLElement | null;
  private autorunTarget = document.getElementById('mobile-autorun-target') as HTMLElement | null;

  constructor(
    private input: Input,
    private callbacks: MobileControlCallbacks,
  ) {}

  /** Tune how far the move thumbstick must travel before movement registers. */
  setMoveDeadzone(deadzone: number): void {
    this.moveDeadzone = deadzone;
  }

  /** Enable/disable the fixed camera joystick (settings.mobileCameraJoystick).
   *  Turning it off while a joystick camera drag is active ends that drag so
   *  the camera doesn't stay stuck rotating with no visible control. */
  setCameraJoystickEnabled(on: boolean): void {
    this.cameraJoystickEnabled = on;
    if (!on) this.releaseCamera();
  }

  /** Re-evaluate touch-interface activation after the player changes the
   *  Interface Mode setting (main.ts calls setInterfaceMode first). Safe before start(). */
  refreshInterfaceMode(): void {
    this.setActive(useTouchInterface() || isNativeAppShell());
  }

  start(): void {
    if (
      !this.root ||
      !this.moveJoystick ||
      !this.moveStick ||
      !this.cameraJoystick ||
      !this.cameraStick
    )
      return;
    this.mq = window.matchMedia(PHONE_TOUCH_QUERY);
    this.setActive(useTouchInterface() || isNativeAppShell());
    this.mq.addEventListener?.('change', () =>
      this.setActive(useTouchInterface() || isNativeAppShell()),
    );

    // Idle-fade: dims the action row + minimap quick-access rail after a stretch
    // of no touch, brightens instantly on the next one. Body-scoped (CSS decides
    // which chrome selectors respond) so it works regardless of which control the
    // player actually touches. The handle's lifecycle is owned by setActive (the
    // above setActive call already armed it when in touch mode), so a flip to the
    // desktop interface disposes it and un-dims the body instead of stranding the
    // idle class. This document-level forwarder is bound once and reads
    // this.chromeFade dynamically, guarding on this.active, so it is a no-op while
    // the handle is null (desktop mode).
    document.addEventListener('pointerdown', () => {
      if (this.active) this.chromeFade?.touch();
    });

    // The move joystick floats: the pointer lifecycle lives on the lower-left
    // capture zone (so a thumb can land anywhere) AND on the visible wheel
    // itself: the 140/128px wheel overhangs the fixed 132px zone, so without
    // its own listeners the wheel's outer arc was a dead sliver that swallowed
    // touches (the wheel masks the canvas but nothing handled the event). A
    // touch hits exactly one of the two (the wheel is on top where they
    // overlap), and onMoveDown's single-pointer guard makes double-binding safe.
    for (const moveSurface of [this.moveZone, this.moveJoystick]) {
      if (!moveSurface) continue;
      moveSurface.addEventListener('pointerdown', (e) => this.onMoveDown(e));
      moveSurface.addEventListener('pointermove', (e) => this.onMoveMove(e));
      moveSurface.addEventListener('pointerup', (e) => this.onMoveEnd(e));
      moveSurface.addEventListener('pointercancel', (e) => this.onMoveEnd(e));
      moveSurface.addEventListener('lostpointercapture', (e) => this.onMoveEnd(e));
    }

    this.cameraJoystick.addEventListener('pointerdown', (e) => this.onCameraDown(e));
    this.cameraJoystick.addEventListener('pointermove', (e) => this.onCameraMove(e));
    this.cameraJoystick.addEventListener('pointerup', (e) => this.onCameraEnd(e));
    this.cameraJoystick.addEventListener('pointercancel', (e) => this.onCameraEnd(e));
    this.cameraJoystick.addEventListener('lostpointercapture', (e) => this.onCameraEnd(e));

    window.addEventListener('pointermove', (e) => {
      this.onMoveMove(e);
      this.onCameraMove(e);
    });
    // The pinch/swipe ends are forwarded at window level too: pinch pointers
    // hold no pointer capture, so a finger that drifts over HUD chrome delivers
    // its pointerup/pointercancel THERE, never to the canvas. Without this
    // forwarding that pointer stayed in pinchPointers forever and every later
    // single-finger touch was misread as a pinch against the stale phantom
    // point (the "camera locked after zooming once" bug: drags only zoomed).
    window.addEventListener('pointerup', (e) => {
      this.onMoveEnd(e);
      this.onCameraEnd(e);
      this.onPinchEnd(e);
      this.onSwipeLookEnd(e);
    });
    window.addEventListener('pointercancel', (e) => {
      this.onMoveEnd(e);
      this.onCameraEnd(e);
      this.onPinchEnd(e);
      this.onSwipeLookEnd(e);
    });
    window.addEventListener('blur', () => {
      this.releaseMove();
      this.releaseCamera();
      this.releasePinch();
      this.touchOwners.releaseAll();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.releaseMove();
        this.releaseCamera();
        this.releasePinch();
        this.touchOwners.releaseAll();
      }
    });

    this.canvas?.addEventListener('pointerdown', (e) => {
      this.onPinchDown(e);
      this.onSwipeLookDown(e);
    });
    this.canvas?.addEventListener('pointermove', (e) => {
      this.onPinchMove(e);
      this.onSwipeLookMove(e);
    });
    this.canvas?.addEventListener('pointerup', (e) => {
      this.onPinchEnd(e);
      this.onSwipeLookEnd(e);
    });
    this.canvas?.addEventListener('pointercancel', (e) => {
      this.onPinchEnd(e);
      this.onSwipeLookEnd(e);
    });

    // Tap-outside-to-dismiss: while the More modal is open, a press anywhere
    // outside the modal closes it. The toggle button manages its own state, so
    // a press on it is ignored here (otherwise the open tap would re-close it).
    document.addEventListener('pointerdown', (e) => {
      if (!this.active || !document.body.classList.contains('mobile-more-open')) return;
      const target = e.target as Element | null;
      if (
        target &&
        typeof target.closest === 'function' &&
        (target.closest('#mobile-extra-controls') || target.closest('#mobile-more'))
      )
        return;
      this.closeMoreModal();
    });

    this.bindButton('mobile-target-cycle', () => this.callbacks.onCycleTarget());
    this.bindButton('mobile-jump', () => this.callbacks.onJump(), { pressFirst: true });
    this.bindButton('mobile-interact', () => this.callbacks.onInteract());
    this.bindChatButton('mobile-chat');
    this.bindButton('mobile-menu', () => this.callbacks.onMenu());
    this.bindButton('mobile-social', () => this.callbacks.onSocial());
    this.bindButton('mobile-discord', () => this.callbacks.onDiscord());
    this.bindButton('mobile-donate', () => this.callbacks.onDonate());
    this.bindButton('mobile-emote', () => this.callbacks.onEmotes());
    this.bindButton('mobile-arena', () => this.callbacks.onArena());
    this.bindButton('mobile-valecup', () => this.callbacks.onValeCup());
    this.bindButton('mobile-quest', () => this.callbacks.onQuestLog());
    this.bindButton('mobile-char', () => this.callbacks.onCharacter());
    this.bindButton('mobile-bags', () => this.callbacks.onBags());
    this.bindButton('mobile-spellbook', () => this.callbacks.onSpellbook());
    this.bindButton('mobile-talents', () => this.callbacks.onTalents());
    this.bindButton('mobile-map', () => this.callbacks.onMap());
    this.bindButton('mobile-leaderboard', () => this.callbacks.onLeaderboard());
    this.bindButton('mobile-daily-rewards', () => this.callbacks.onDailyRewards());
    const nameplatesBtn = document.getElementById('mobile-nameplates');
    this.bindButton('mobile-nameplates', () => {
      const on = this.callbacks.onNameplates();
      nameplatesBtn?.classList.toggle('active', on);
    });
    const musicBtn = document.getElementById('mobile-music');
    this.bindButton('mobile-music', () => {
      const on = this.callbacks.onMusic();
      // mirror the desktop #mm-music control: a diagonal slash (.mm-muted) signals
      // "off", rather than dimming the note
      musicBtn?.classList.toggle('mm-muted', !on);
    });
    this.bindHapticsToggle('mobile-haptics');
    this.bindMenuCollapseToggle('mobile-menu-collapse-toggle');
    this.bindButton('mobile-more', () => {
      const open = !document.body.classList.contains('mobile-more-open');
      this.root?.classList.toggle('expanded', open);
      document.body.classList.toggle('mobile-more-open', open);
      // No inline positioning here: the drawer is centered by the stylesheet
      // (hud.mobile.css). The old inline left/top/transform write raced the Hud
      // window observer, whose show-time mobile clear wiped it on the FIRST
      // open of a session and dropped the drawer onto the (then broken)
      // stylesheet transform, so the first open landed half off-screen.
    });
  }

  private setActive(active: boolean): void {
    // Was the touch interface already active BEFORE this call? A redundant
    // re-activation (active was already true, e.g. a PHONE_TOUCH_QUERY threshold
    // crossing on a foldable resize while staying in touch) must NOT wipe an
    // in-progress composer draft; only a genuine desktop->touch transition resets it.
    const wasActive = this.active;
    this.active = active;
    document.body.classList.toggle('mobile-touch', active);
    if (!active) {
      this.root?.classList.remove('expanded');
      document.body.classList.remove(
        'mobile-more-open',
        'mobile-chat-open',
        'mobile-chatlog-peek',
        'mobile-chat-reply',
      );
      this.releaseMove();
      this.releaseCamera();
      this.releasePinch();
      this.touchOwners.releaseAll();
      // Dispose the idle-fade so the chrome un-dims and the timer stops: without
      // this a fade left in its dimmed state leaks past the flip to the desktop
      // interface (dispose() clears the mobile-chrome-idle class).
      this.chromeFade?.dispose();
      this.chromeFade = null;
    } else {
      // Reset any composer left open ONLY on a real transition INTO touch (not on a
      // redundant re-activation while already active, which would clear a draft the
      // player is typing). This clears input.value, so gate it on !wasActive.
      if (!wasActive) {
        document.body.classList.remove('mobile-chat-open', 'mobile-chat-reply');
        const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        if (input) {
          input.value = '';
          input.style.display = 'none';
          input.style.height = '';
          input.style.overflowY = '';
          input.blur();
        }
      }
      // Arm the idle-fade once for this activation (idempotent via ??=).
      this.chromeFade ??= startChromeFade(document.body);
    }
  }

  private bindButton(id: string, cb: () => void, opts: { pressFirst?: boolean } = {}): void {
    const button = document.getElementById(id);
    if (!button) return;
    const run = (e: Event) => {
      if (!this.active) return;
      e.preventDefault();
      triggerHaptic(HAPTIC_TAP, this.hapticsOn);
      if (button.closest('#mobile-extra-controls')) {
        this.closeMoreModal();
      }
      cb();
    };
    if (opts.pressFirst) {
      let suppressNextClick = false;
      button.addEventListener('pointerdown', (e) => {
        suppressNextClick = true;
        globalThis.setTimeout(() => {
          suppressNextClick = false;
        }, 700);
        run(e);
      });
      button.addEventListener('click', (e) => {
        if (suppressNextClick) {
          suppressNextClick = false;
          e.preventDefault();
          return;
        }
        run(e);
      });
      return;
    }
    // bindTouchTap, not a bare 'click': the browser only synthesizes click
    // for the PRIMARY pointer, so a click-bound button is dead while the
    // other thumb holds the joystick (see src/ui/touch_tap.ts).
    bindTouchTap(button, run);
  }

  private closeMoreModal(): void {
    document.getElementById('mobile-controls')?.classList.remove('expanded');
    document.body.classList.remove('mobile-more-open');
  }

  /** The haptics button is a stateful toggle, so it bypasses bindButton (no tray
   *  auto-close, no buzz on the press that turns buzzing off) and reflects state
   *  via aria-pressed + an .is-on class. */
  private bindHapticsToggle(id: string): void {
    const button = document.getElementById(id);
    if (!button) return;
    this.syncHapticsButton(button);
    bindTouchTap(button, (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.hapticsOn = !this.hapticsOn;
      saveHapticsEnabled(this.hapticsOn);
      this.syncHapticsButton(button);
      // confirm with a pulse only when enabling, so the player feels what they turned on
      if (this.hapticsOn) triggerHaptic(HAPTIC_CONFIRM, true);
    });
  }

  private syncHapticsButton(button: HTMLElement): void {
    button.classList.toggle('is-on', this.hapticsOn);
    button.setAttribute('aria-pressed', this.hapticsOn ? 'true' : 'false');
    const label = button.querySelector('.mobile-label');
    if (label)
      label.textContent = this.hapticsOn
        ? t('hudChrome.mobile.haptics')
        : t('hudChrome.mobile.hapticsOff');
  }

  /** The menu-cluster collapse handle: an always-visible arrow chip that shows or
   *  hides the five top-left menu buttons (Chat/Social/Quests/Settings/More).
   *  Like the haptics toggle it is a STATEFUL, persisted toggle reflected via
   *  aria-expanded, so it bypasses bindButton (no More-tray auto-close, no
   *  callback). It touches ONLY the mobile-menu-open body class the CSS reveal
   *  keys off, so the consumables bar and the action ring stay put. */
  private bindMenuCollapseToggle(id: string): void {
    const button = document.getElementById(id);
    if (!button) return;
    // Apply the persisted state up front so the arrow and <body> agree before the
    // first tap (the static markup ships collapsed; a stored expand re-opens it).
    this.syncMenuCollapseToggle(button);
    bindTouchTap(button, (e) => {
      if (!this.active) return;
      e.preventDefault();
      triggerHaptic(HAPTIC_TAP, this.hapticsOn);
      this.menuExpanded = !this.menuExpanded;
      saveMenuExpanded(this.menuExpanded);
      this.syncMenuCollapseToggle(button);
      button.blur();
    });
  }

  /** Reflect the collapse state: the mobile-menu-open body class the CSS reveal
   *  keys off, the arrow's aria-expanded, and its show/hide accessible name (both
   *  the aria-label and the title come from t(), matching guide/chrome.ts's menu
   *  toggle). */
  private syncMenuCollapseToggle(button: HTMLElement): void {
    document.body.classList.toggle('mobile-menu-open', this.menuExpanded);
    button.setAttribute('aria-expanded', this.menuExpanded ? 'true' : 'false');
    const label = this.menuExpanded
      ? t('hudChrome.mobile.hideMenuButtons')
      : t('hudChrome.mobile.showMenuButtons');
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  }

  /** The Chat button taps to open the keyboard composer, but a long press toggles
   * a read-only "peek" at the chat/combat log without raising the keyboard — so
   * touch players can follow whispers, party chat, loot and combat text while the
   * composer (and its keyboard) stays out of the way. */
  private bindChatButton(id: string): void {
    const button = document.getElementById(id);
    if (!button) return;
    const cancel = () => {
      if (this.chatPressTimer !== null) {
        clearTimeout(this.chatPressTimer);
        this.chatPressTimer = null;
      }
    };
    button.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.chatLongFired = false;
      cancel();
      this.chatPressTimer = setTimeout(() => {
        this.chatLongFired = true;
        this.chatPressTimer = null;
        this.toggleLogPeek();
      }, CHAT_LONG_PRESS_MS);
    });
    button.addEventListener('pointerup', (e) => {
      if (!this.active) return;
      e.preventDefault();
      cancel();
      if (!this.chatLongFired) this.tapChat();
    });
    button.addEventListener('pointercancel', cancel);
    button.addEventListener('pointerleave', cancel);
  }

  /** Toggle the read-only chat-log peek. Opening a peek closes the full chat first (so a
   *  peek and the open panel are never both up); opening the panel elsewhere clears it. */
  private toggleLogPeek(): void {
    const peeking = document.body.classList.toggle('mobile-chatlog-peek');
    if (peeking && document.body.classList.contains('mobile-chat-open')) {
      this.callbacks.onChatClose();
    }
  }

  /** The single top-left Chat button toggles the chat panel. Tapping it OPEN shows the
   *  centered read view: the log plus the composer bar above it, keyboard DOWN (tapping
   *  the composer bar raises the keyboard to type). Tapping it again CLOSES the panel;
   *  if the keyboard is up, closing drops it too (closeChat blurs the composer). */
  private tapChat(): void {
    if (document.body.classList.contains('mobile-chat-open')) {
      this.callbacks.onChatClose();
    } else {
      document.body.classList.remove('mobile-chatlog-peek');
      document.body.classList.add('mobile-chat-open');
      this.callbacks.onChatOpen();
    }
  }

  /** Classify a pointerdown target and record it in the ledger; see
   *  touch_router.ts's consumer contract. Every pointerdown handler that routes
   *  through the ledger calls this once, so a given pointerId gets exactly one
   *  owner for the lifetime of that touch. */
  private classifyTouch(e: PointerEvent): TouchOwner {
    const target = e.target as unknown as TouchRouterTarget | null;
    const owner = getTouchOwner(
      { target },
      {
        menuOpen: document.body.classList.contains('mobile-window-open'),
        // closest() so a touch landing on a DESCENDANT (the visible
        // #mobile-move-stick inside the joystick base) still classifies as
        // movement; identity alone would misroute it to 'ignored'.
        isMovementZone: (t) =>
          t === (this.moveZone as unknown as TouchRouterTarget | null) ||
          t === (this.moveJoystick as unknown as TouchRouterTarget | null) ||
          !!t?.closest('#mobile-move-zone') ||
          !!t?.closest('#mobile-move-joystick'),
        isCombatButton: (t) => isInteractiveHudElement(t),
        isCameraSurface: (t) => t === (this.canvas as unknown as TouchRouterTarget | null),
      },
    );
    this.touchOwners.set(e.pointerId, owner);
    return owner;
  }

  private onMoveDown(e: PointerEvent): void {
    if (!this.active || this.joyPointer !== null || !this.moveJoystick) return;
    if (this.classifyTouch(e) !== 'movement') return;
    e.preventDefault();
    // The wheel's RESTING center, read before any style.left/top override this
    // touch may apply (releaseMove clears both back to the CSS-authored rest
    // spot, so a fresh touchdown always reads it here). Used only to clamp
    // where the wheel is DRAWN below; never fed into the input math.
    const restRect = this.moveJoystick.getBoundingClientRect();
    const restCenterX = restRect.left + restRect.width / 2;
    const restCenterY = restRect.top + restRect.height / 2;
    this.joyPointer = e.pointerId;
    triggerHaptic(HAPTIC_JOYSTICK, this.hapticsOn);
    // The input origin IS the raw touch point, unclamped (see the origin note
    // above mapJoystickVector): a touchdown alone can never produce movement
    // intent, or it re-creates the v0.22.0 #1229 drift regression. layoutRadius
    // is the untransformed box (what style.left/top position, with .floating's
    // transform-origin: center keeping the scaled wheel centered on it);
    // renderedRadius includes the --joy-scale transform and drives the input
    // throw, so a resized wheel reaches full deflection exactly at its rim.
    const layoutRadius = Math.max(1, this.moveJoystick.offsetWidth / 2 || 61);
    const renderedRadius = Math.max(
      1,
      this.moveJoystick.getBoundingClientRect().width / 2 || layoutRadius,
    );
    this.moveOriginX = e.clientX;
    this.moveOriginY = e.clientY;
    this.moveRadius = renderedRadius;
    this.moveStickRadius = layoutRadius;
    this.moveAutorunLocked = false;
    this.syncMoveAutorunTarget('hidden');
    // Autorun is a latch from the previous joystick drag; a fresh grab is a new
    // movement intent, so it cancels the latch before steering.
    if (this.input.autorun) this.input.setAutorun(false);
    // The wheel's DRAWN position floats toward the thumb but is clamped to stay
    // within MOVE_JOYSTICK_FLOAT_RADIUS of its resting spot, so a touch anywhere
    // in the (much larger) move zone no longer teleports the visible wheel clear
    // across the screen; it just leans toward the thumb within a small radius.
    // Purely cosmetic: moveOriginX/Y above (the input math) is untouched.
    const floatDx = e.clientX - restCenterX;
    const floatDy = e.clientY - restCenterY;
    const floatDist = Math.hypot(floatDx, floatDy);
    const floatScale =
      floatDist > MOVE_JOYSTICK_FLOAT_RADIUS ? MOVE_JOYSTICK_FLOAT_RADIUS / floatDist : 1;
    const drawnCenterX = restCenterX + floatDx * floatScale;
    const drawnCenterY = restCenterY + floatDy * floatScale;
    this.moveJoystick.style.left = `${(drawnCenterX - layoutRadius).toFixed(1)}px`;
    this.moveJoystick.style.top = `${(drawnCenterY - layoutRadius).toFixed(1)}px`;
    this.moveJoystick.classList.add('floating', 'active');
    try {
      (this.moveZone ?? this.moveJoystick).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic test event */
    }
    this.onMoveMove(e);
  }

  private onMoveMove(e: PointerEvent): void {
    if (!this.active || e.pointerId !== this.joyPointer || !this.moveStick) return;
    // A window opening mid-drag ends the drag immediately (the same rule
    // swipe-look has): the joystick is hidden under the full-screen backdrop,
    // so a held thumb must not keep walking the character behind the modal.
    if (document.body.classList.contains('mobile-window-open')) {
      this.releaseMove();
      return;
    }
    e.preventDefault();
    const rawX = (e.clientX - this.moveOriginX) / this.moveRadius;
    const rawY = (e.clientY - this.moveOriginY) / this.moveRadius;
    const mag = Math.max(1, Math.hypot(rawX, rawY));
    const x = rawX / mag;
    const y = rawY / mag;
    // The stick translates in the wheel's PRE-transform units (the container's
    // --joy-scale transform scales the offset visually), so it uses the layout
    // radius while the input throw above used the rendered one.
    this.moveStick.style.transform = `translate(${(x * this.moveStickRadius * 0.46).toFixed(1)}px, ${(y * this.moveStickRadius * 0.46).toFixed(1)}px)`;
    const move = mapJoystickVector(x, y, this.moveDeadzone);
    const inAutorunTarget = isMoveAutorunPush(rawY);
    if (this.moveAutorunLocked && inAutorunTarget) {
      this.input.clearTouchMove();
      this.input.setAutorun(true);
      this.syncMoveAutorunTarget('locked');
      return;
    }
    if (this.moveAutorunLocked && !inAutorunTarget) {
      this.moveAutorunLocked = false;
      this.input.setAutorun(false);
    }
    if (inAutorunTarget) {
      this.moveAutorunLocked = true;
      this.input.clearTouchMove();
      this.input.setAutorun(true);
      this.syncMoveAutorunTarget('locked');
      return;
    }
    this.input.setTouchMove(move);
    const moving = move.forward || move.back || move.strafeLeft || move.strafeRight;
    if (moving && this.input.autorun) this.input.setAutorun(false);
    this.syncMoveAutorunTarget(isMoveAutorunNear(rawY) ? 'near' : 'hidden');
  }

  private onMoveEnd(e: PointerEvent): void {
    this.touchOwners.release(e.pointerId);
    if (e.pointerId !== this.joyPointer) return;
    e.preventDefault();
    this.releaseMove();
  }

  private releaseMove(): void {
    if (this.joyPointer !== null) {
      try {
        const moveSurface = this.moveZone ?? this.moveJoystick;
        if (moveSurface?.hasPointerCapture?.(this.joyPointer)) {
          moveSurface.releasePointerCapture(this.joyPointer);
        }
      } catch {
        /* capture may already be gone on mobile browser gesture changes */
      }
    }
    this.joyPointer = null;
    this.moveAutorunLocked = false;
    this.syncMoveAutorunTarget(this.input.autorun ? 'locked' : 'hidden');
    this.input.clearTouchMove();
    if (this.moveStick) this.moveStick.style.transform = '';
    if (this.moveJoystick) {
      this.moveJoystick.classList.remove('floating', 'active');
      this.moveJoystick.style.left = '';
      this.moveJoystick.style.top = '';
    }
  }

  private syncMoveAutorunTarget(state: 'hidden' | 'near' | 'locked'): void {
    this.autorunTarget?.classList.toggle('near', state === 'near' || state === 'locked');
    this.autorunTarget?.classList.toggle('locked', state === 'locked');
  }

  syncAutorun(on: boolean): void {
    this.moveAutorunLocked = false;
    this.syncMoveAutorunTarget(on ? 'locked' : 'hidden');
  }

  private onCameraDown(e: PointerEvent): void {
    if (!this.active || !this.cameraJoystickEnabled || this.lookPointer !== null) return;
    // Router priority: an open modal/menu claims every touch, so a joystick
    // press while a window is up must not start a drag (or buzz the haptics).
    if (document.body.classList.contains('mobile-window-open')) return;
    // The camera joystick is its own zone (a fixed on-screen control, not the
    // canvas), so it is not covered by getTouchOwner's movement/combat/camera-
    // surface classification; record it in the ledger directly as 'camera' so a
    // pointermove later reads back the same owner as the swipe-look path does.
    this.touchOwners.set(e.pointerId, 'camera');
    e.preventDefault();
    this.lookPointer = e.pointerId;
    this.cameraJoystick?.classList.add('active');
    this.cameraDownAt = this.now();
    this.cameraDownX = e.clientX;
    this.cameraDownY = e.clientY;
    this.cameraMoved = false;
    this.input.setTouchLook(true);
    triggerHaptic(HAPTIC_JOYSTICK, this.hapticsOn);
    try {
      this.cameraJoystick?.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic test event */
    }
    this.onCameraMove(e);
  }

  private onCameraMove(e: PointerEvent): void {
    if (
      !this.active ||
      e.pointerId !== this.lookPointer ||
      !this.cameraJoystick ||
      !this.cameraStick
    )
      return;
    // A window opening mid-drag ends the camera drag immediately: menuOpen means
    // every touch is now the modal's, so the joystick must stop steering the camera.
    if (document.body.classList.contains('mobile-window-open')) {
      this.releaseCamera();
      return;
    }
    e.preventDefault();
    if (
      Math.hypot(e.clientX - this.cameraDownX, e.clientY - this.cameraDownY) > RECENTER_TAP_MOVE_PX
    ) {
      this.cameraMoved = true;
    }
    const r = this.cameraJoystick.getBoundingClientRect();
    const radius = Math.max(1, r.width / 2);
    const rawX = (e.clientX - (r.left + radius)) / radius;
    const rawY = (e.clientY - (r.top + radius)) / radius;
    const mag = Math.max(1, Math.hypot(rawX, rawY));
    const x = rawX / mag;
    const y = rawY / mag;
    this.cameraStick.style.transform = `translate(${(x * radius * 0.42).toFixed(1)}px, ${(y * radius * 0.42).toFixed(1)}px)`;
    this.input.setTouchLookVector(mapLookVector(x, y));
  }

  private onCameraEnd(e: PointerEvent): void {
    this.touchOwners.release(e.pointerId);
    if (e.pointerId !== this.lookPointer) return;
    e.preventDefault();
    const now = this.now();
    const quickTap = !this.cameraMoved && now - this.cameraDownAt <= RECENTER_DOUBLE_TAP_MS;
    if (quickTap && isRecenterDoubleTap(this.lastCameraTapAt, now, this.cameraMoved)) {
      this.callbacks.onRecenterCamera();
      this.cameraJoystick?.classList.add('recentering');
      window.setTimeout(() => this.cameraJoystick?.classList.remove('recentering'), 220);
      this.lastCameraTapAt = 0;
    } else {
      this.lastCameraTapAt = quickTap ? now : 0;
    }
    this.releaseCamera();
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  private releaseCamera(): void {
    if (this.lookPointer !== null) {
      try {
        if (this.cameraJoystick?.hasPointerCapture?.(this.lookPointer)) {
          this.cameraJoystick.releasePointerCapture(this.lookPointer);
        }
      } catch {
        /* capture may already be gone on mobile browser gesture changes */
      }
    }
    this.lookPointer = null;
    this.cameraJoystick?.classList.remove('active');
    this.input.setTouchLook(false);
    this.input.setTouchLookVector({ x: 0, y: 0 });
    if (this.cameraStick) this.cameraStick.style.transform = '';
  }

  private onPinchDown(e: PointerEvent): void {
    if (!this.active || e.pointerType !== 'touch') return;
    // Router priority: an open modal/menu claims every touch, so a fresh
    // two-finger press while a window is up must not start tracking a pinch.
    if (document.body.classList.contains('mobile-window-open')) return;
    this.pinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinchPointers.size === 2) {
      this.releaseSwipeLook();
      this.pinchPrevDist = this.currentPinchDist();
    }
  }

  private onPinchMove(e: PointerEvent): void {
    if (!this.active || !this.pinchPointers.has(e.pointerId)) return;
    // A window opening mid-gesture ends the pinch immediately: menuOpen means
    // every touch is now the modal's, so the gesture must stop suppressing camera
    // swipes.
    if (document.body.classList.contains('mobile-window-open')) {
      this.releasePinch();
      return;
    }
    this.pinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinchPointers.size === 2 && this.pinchPrevDist !== null) {
      e.preventDefault();
      const cur = this.currentPinchDist();
      const zoomDelta = pinchZoomDelta(this.pinchPrevDist, cur);
      if (zoomDelta !== 0) {
        this.input.zoomBy(zoomDelta);
        this.pinchPrevDist = cur;
      }
    }
  }

  private onPinchEnd(e: PointerEvent): void {
    // Idempotent: the canvas handler and the window-level forwarder both call
    // this for a canvas pointerup, so only the first delete does any work.
    if (!this.pinchPointers.delete(e.pointerId)) return;
    // Re-baseline from the SURVIVING pair on a 3->2 transition: the old baseline
    // was measured between the original first two pointers (currentPinchDist
    // reads insertion order), so keeping it across a different surviving pair
    // applied one discontinuous zoom step on the next move.
    if (this.pinchPointers.size < 2) this.pinchPrevDist = null;
    else this.pinchPrevDist = this.currentPinchDist();
    // A pinch degrading to exactly one remaining finger hands that finger back
    // to camera drag (swipe-look), so the player can keep rotating without a
    // re-touch. Pinch pointers only ever come from canvas pointerdowns, so the
    // remaining finger is a legitimate camera-surface touch.
    if (
      this.pinchPointers.size !== 1 ||
      !this.active ||
      this.swipeLookPointer !== null ||
      this.lookPointer !== null ||
      document.body.classList.contains('mobile-window-open')
    )
      return;
    const remainingId = this.pinchPointers.keys().next().value;
    if (remainingId === undefined) return;
    const pos = this.pinchPointers.get(remainingId);
    if (!pos) return;
    this.touchOwners.set(remainingId, 'camera');
    this.swipeLookPointer = remainingId;
    this.swipeLookStartX = pos.x;
    this.swipeLookStartY = pos.y;
    this.swipeLookLastX = pos.x;
    this.swipeLookLastY = pos.y;
    this.swipeLookActive = false;
    this.swipeLookDownAt = this.now();
    this.swipeLookResync = true;
    this.swipeLookAdopted = true;
    try {
      this.canvas?.setPointerCapture(remainingId);
    } catch {
      /* synthetic test event */
    }
  }

  private releasePinch(): void {
    this.pinchPointers.clear();
    this.pinchPrevDist = null;
    this.releaseSwipeLook();
  }

  private currentPinchDist(): number {
    const pts = [...this.pinchPointers.values()];
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private onSwipeLookDown(e: PointerEvent): void {
    if (
      !this.active ||
      e.pointerType !== 'touch' ||
      this.swipeLookPointer !== null ||
      this.lookPointer !== null ||
      this.pinchPointers.size > 1
    )
      return;
    // Closes the gap where swipe-look could start over HUD chrome: a swipe that
    // begins on a button/window must not also nudge the camera.
    const target = e.target as unknown as TouchRouterTarget | null;
    const menuOpen = document.body.classList.contains('mobile-window-open');
    if (!isCameraDragAllowedAt(target, menuOpen)) return;
    this.touchOwners.set(e.pointerId, 'camera');
    this.swipeLookPointer = e.pointerId;
    this.swipeLookStartX = e.clientX;
    this.swipeLookStartY = e.clientY;
    this.swipeLookLastX = e.clientX;
    this.swipeLookLastY = e.clientY;
    this.swipeLookActive = false;
    this.swipeLookDownAt = this.now();
    try {
      this.canvas?.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic test event */
    }
  }

  private onSwipeLookMove(e: PointerEvent): void {
    if (
      !this.active ||
      e.pointerId !== this.swipeLookPointer ||
      this.pinchPointers.size > 1 ||
      this.touchOwners.get(e.pointerId) !== 'camera'
    )
      return;
    // A window opening mid-drag ends the swipe-look drag immediately.
    if (document.body.classList.contains('mobile-window-open')) {
      this.releaseSwipeLook();
      return;
    }
    // First move after a pinch-degrade adoption: the tracked position may be
    // stale, so resync the origin to the live finger instead of applying the
    // gap as a camera jump.
    if (this.swipeLookResync) {
      this.swipeLookResync = false;
      this.swipeLookStartX = e.clientX;
      this.swipeLookStartY = e.clientY;
      this.swipeLookLastX = e.clientX;
      this.swipeLookLastY = e.clientY;
      return;
    }
    const totalDx = e.clientX - this.swipeLookStartX;
    const totalDy = e.clientY - this.swipeLookStartY;
    if (!this.swipeLookActive) {
      if (Math.hypot(totalDx, totalDy) < SWIPE_LOOK_DEADZONE_PX) return;
      this.swipeLookActive = true;
      this.input.setTouchLook(true);
      this.input.setTouchLookVector({ x: 0, y: 0 });
    }
    e.preventDefault();
    const dx = e.clientX - this.swipeLookLastX;
    const dy = e.clientY - this.swipeLookLastY;
    this.swipeLookLastX = e.clientX;
    this.swipeLookLastY = e.clientY;
    this.input.applyTouchLookDelta(dx, dy);
  }

  private onSwipeLookEnd(e: PointerEvent): void {
    this.touchOwners.release(e.pointerId);
    if (e.pointerId !== this.swipeLookPointer) return;
    if (this.swipeLookActive) e.preventDefault();
    // Double-tap-to-recenter on the swipe-look path: the camera joystick is
    // opt-in (hidden by default, settings.mobileCameraJoystick), so this is
    // the recenter gesture every touch player has. A "tap" is a press that
    // never crossed the swipe deadzone (never became a drag); two of those in
    // quick succession recenter the camera, mirroring the joystick logic.
    const now = this.now();
    // A pinch remnant adopted mid-gesture is never a "tap": without this guard
    // two quick pinch releases could fire a surprise camera recenter.
    const quickTap =
      !this.swipeLookAdopted &&
      !this.swipeLookActive &&
      now - this.swipeLookDownAt <= RECENTER_DOUBLE_TAP_MS;
    if (quickTap && isRecenterDoubleTap(this.lastSwipeTapAt, now, this.swipeLookActive)) {
      this.callbacks.onRecenterCamera();
      this.lastSwipeTapAt = 0;
    } else {
      this.lastSwipeTapAt = quickTap ? now : 0;
    }
    this.releaseSwipeLook();
  }

  private releaseSwipeLook(): void {
    if (this.swipeLookPointer !== null) {
      try {
        if (this.canvas?.hasPointerCapture?.(this.swipeLookPointer)) {
          this.canvas.releasePointerCapture(this.swipeLookPointer);
        }
      } catch {
        /* capture may already be gone on mobile browser gesture changes */
      }
    }
    this.swipeLookPointer = null;
    if (this.swipeLookActive) {
      this.input.setTouchLook(false);
      this.input.setTouchLookVector({ x: 0, y: 0 });
    }
    this.swipeLookActive = false;
    this.swipeLookResync = false;
    this.swipeLookAdopted = false;
  }
}

export function mapLookVector(x: number, y: number, deadzone = DEADZONE): { x: number; y: number } {
  if (Math.hypot(x, y) < deadzone) return { x: 0, y: 0 };
  return { x: x * CAMERA_SENSITIVITY, y: y * CAMERA_SENSITIVITY };
}

export function pinchZoomDelta(
  prevDist: number,
  curDist: number,
  sensitivity = PINCH_ZOOM_SENSITIVITY,
  deadzonePx = PINCH_ZOOM_DEADZONE_PX,
): number {
  const delta = curDist - prevDist;
  const abs = Math.abs(delta);
  if (abs <= deadzonePx) return 0;
  const adjusted = abs - deadzonePx;
  return -Math.sign(delta) * adjusted * sensitivity;
}
