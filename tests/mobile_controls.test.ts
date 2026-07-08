import { afterEach, describe, expect, it } from 'vitest';
import type { Input, TouchMoveInput } from '../src/game/input';
import {
  CHAT_LONG_PRESS_MS,
  HAPTICS_STORE_KEY,
  interfaceModeFromSetting,
  isChatLongPress,
  isPhoneTouchDevice,
  isRecenterDoubleTap,
  loadHapticsEnabled,
  MobileControls,
  mapJoystickVector,
  mapLookVector,
  pinchZoomDelta,
  RECENTER_DOUBLE_TAP_MS,
  resolveTouchInterface,
  saveHapticsEnabled,
  setInterfaceMode,
  triggerHaptic,
  useTouchInterface,
} from '../src/game/mobile_controls';

describe('mapJoystickVector', () => {
  it('returns neutral inside the deadzone', () => {
    expect(mapJoystickVector(0, 0)).toEqual({
      forward: false,
      back: false,
      strafeLeft: false,
      strafeRight: false,
    });
    expect(mapJoystickVector(0.05, -0.08)).toEqual({
      forward: false,
      back: false,
      strafeLeft: false,
      strafeRight: false,
    });
  });

  it('maps cardinal movement directions', () => {
    expect(mapJoystickVector(0, -1)).toEqual({
      forward: true,
      back: false,
      strafeLeft: false,
      strafeRight: false,
    });
    expect(mapJoystickVector(0, 1)).toEqual({
      forward: false,
      back: true,
      strafeLeft: false,
      strafeRight: false,
    });
    expect(mapJoystickVector(-1, 0)).toEqual({
      forward: false,
      back: false,
      strafeLeft: true,
      strafeRight: false,
    });
    expect(mapJoystickVector(1, 0)).toEqual({
      forward: false,
      back: false,
      strafeLeft: false,
      strafeRight: true,
    });
  });

  it('maps diagonal movement directions', () => {
    expect(mapJoystickVector(0.7, -0.7)).toEqual({
      forward: true,
      back: false,
      strafeLeft: false,
      strafeRight: true,
    });
    expect(mapJoystickVector(-0.7, 0.7)).toEqual({
      forward: false,
      back: true,
      strafeLeft: true,
      strafeRight: false,
    });
  });

  it('honours a custom deadzone (Joystick Deadzone setting)', () => {
    // a small push that moves at the default deadzone stays neutral with a larger one
    const small = mapJoystickVector(0, -0.3);
    expect(small.forward).toBe(true);
    const wide = mapJoystickVector(0, -0.3, 0.4);
    expect(wide).toEqual({ forward: false, back: false, strafeLeft: false, strafeRight: false });
    // a tiny push that's neutral by default registers with a narrow deadzone
    const narrow = mapJoystickVector(0, -0.15, 0.1);
    expect(narrow.forward).toBe(true);
  });
});

describe('isPhoneTouchDevice', () => {
  it('detects a touch-primary device: a coarse primary pointer that cannot hover', () => {
    const queries: string[] = [];
    const win = {
      matchMedia: (q: string) => {
        queries.push(q);
        return { matches: true };
      },
    } as unknown as Window;
    expect(isPhoneTouchDevice(win)).toBe(true);
    // Keyed off the PRIMARY pointer (coarse + can't hover, or coarse on a phone-
    // sized viewport), not "any pointer is coarse" or a raw touch-point count, so
    // a desktop with a touch-capable peripheral stays desktop.
    expect(queries[0]).toContain('pointer: coarse');
    expect(queries[0]).toContain('hover: none');
    expect(queries[0]).toContain('max-width');
    expect(queries[0]).not.toContain('any-pointer');
  });

  it('keeps touch-only phones that misreport hover (Chromium/Samsung quirk) via the viewport net', () => {
    // Samsung (and some OnePlus) phones self-report a hovering virtual mouse, so
    // (hover: none) is false even on a genuine touch-only phone. The coarse-pointer
    // + small-viewport clauses recover them; assert the query carries that net so a
    // coarse primary pointer on a phone-sized screen still resolves to the touch UI.
    const queries: string[] = [];
    const win = {
      matchMedia: (q: string) => {
        queries.push(q);
        return { matches: true };
      },
    } as unknown as Window;
    isPhoneTouchDevice(win);
    expect(queries[0]).toContain('(pointer: coarse) and (max-width: 940px)');
    expect(queries[0]).toContain('(pointer: coarse) and (max-height: 760px)');
  });

  it('treats a mouse/trackpad desktop as non-phone (fine primary pointer that hovers)', () => {
    const win = {
      matchMedia: () => ({ matches: false }),
    } as unknown as Window;
    expect(isPhoneTouchDevice(win)).toBe(false);
  });

  it('ignores touch/pen capability on a non-touchscreen laptop (regression)', () => {
    // A Windows laptop with a precision touchpad or pen digitizer reports
    // navigator.maxTouchPoints > 0 and (any-pointer: coarse), yet its PRIMARY
    // pointer is a fine, hovering mouse on a large viewport, so none of the
    // coarse-primary-pointer clauses match and it stays on the desktop UI.
    const win = {
      matchMedia: () => ({ matches: false }),
    } as unknown as Window;
    expect(isPhoneTouchDevice(win)).toBe(false);
  });
});

describe('interface mode override', () => {
  afterEach(() => setInterfaceMode('auto'));

  it('maps the numeric interfaceMode setting (0 Auto, 1 Desktop, 2 Touch)', () => {
    expect(interfaceModeFromSetting(0)).toBe('auto');
    expect(interfaceModeFromSetting(1)).toBe('desktop');
    expect(interfaceModeFromSetting(2)).toBe('touch');
  });

  it('auto defers to device detection; explicit modes override it', () => {
    expect(resolveTouchInterface('auto', true)).toBe(true);
    expect(resolveTouchInterface('auto', false)).toBe(false);
    // A tablet (auto-detected as touch) whose player picked Desktop stays desktop.
    expect(resolveTouchInterface('desktop', true)).toBe(false);
    // A desktop whose player picked Touch gets the on-screen controls.
    expect(resolveTouchInterface('touch', false)).toBe(true);
  });

  it('useTouchInterface combines the persisted override with detection', () => {
    const touchWin = { matchMedia: () => ({ matches: true }) } as unknown as Window;
    const desktopWin = { matchMedia: () => ({ matches: false }) } as unknown as Window;
    setInterfaceMode('auto');
    expect(useTouchInterface(touchWin)).toBe(true);
    expect(useTouchInterface(desktopWin)).toBe(false);
    setInterfaceMode('desktop');
    expect(useTouchInterface(touchWin)).toBe(false);
    setInterfaceMode('touch');
    expect(useTouchInterface(desktopWin)).toBe(true);
  });
});

describe('isChatLongPress', () => {
  it('treats short presses as taps (open composer)', () => {
    expect(isChatLongPress(0)).toBe(false);
    expect(isChatLongPress(CHAT_LONG_PRESS_MS - 1)).toBe(false);
  });

  it('treats presses at or beyond the threshold as a long press (peek the log)', () => {
    expect(isChatLongPress(CHAT_LONG_PRESS_MS)).toBe(true);
    expect(isChatLongPress(CHAT_LONG_PRESS_MS + 500)).toBe(true);
  });
});

describe('isRecenterDoubleTap', () => {
  it('fires for a quick, stationary second tap', () => {
    expect(isRecenterDoubleTap(1000, 1000 + RECENTER_DOUBLE_TAP_MS - 50, false)).toBe(true);
  });

  it('ignores a tap that dragged the camera (a look, not a tap)', () => {
    expect(isRecenterDoubleTap(1000, 1100, true)).toBe(false);
  });

  it('ignores a slow second tap outside the double-tap window', () => {
    expect(isRecenterDoubleTap(1000, 1000 + RECENTER_DOUBLE_TAP_MS + 1, false)).toBe(false);
  });

  it('ignores the very first tap (no prior tap recorded)', () => {
    expect(isRecenterDoubleTap(0, 120, false)).toBe(false);
  });
});

describe('mapLookVector', () => {
  it('returns a neutral camera vector inside the deadzone', () => {
    expect(mapLookVector(0.02, 0.03)).toEqual({ x: 0, y: 0 });
  });

  it('keeps analog camera vector outside the deadzone', () => {
    const v = mapLookVector(0.45, -0.25);
    expect(v.x).toBeCloseTo(0.36);
    expect(v.y).toBeCloseTo(-0.2);
  });
});

// (clampJoystickOrigin was removed: clamping the floating origin into the
// 132px capture zone, which cannot contain the 140/128px wheel, pinned the
// origin away from the thumb and made every off-center touchdown instantly
// walk the character: the issue #1229 drift. The origin is now the raw touch
// point; the integration tests below pin the new contract.)

describe('pinchZoomDelta', () => {
  it('returns zero when the pinch distance is unchanged', () => {
    expect(pinchZoomDelta(120, 120)).toBe(0);
  });

  it('zooms in (negative delta) when the fingers spread apart', () => {
    expect(pinchZoomDelta(100, 150, 0.04)).toBeCloseTo(-2);
  });

  it('zooms out (positive delta) when the fingers pinch together', () => {
    expect(pinchZoomDelta(150, 100, 0.04)).toBeCloseTo(2);
  });

  it('scales the delta by the magnitude of the spread', () => {
    expect(pinchZoomDelta(100, 110, 0.04)).toBeCloseTo(-0.4);
    expect(pinchZoomDelta(100, 200, 0.04)).toBeCloseTo(-4);
  });
});

describe('haptics', () => {
  const makeStore = (initial: Record<string, string> = {}) => {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      map,
    };
  };

  it('defaults to enabled when nothing is stored or storage is missing', () => {
    expect(loadHapticsEnabled(makeStore())).toBe(true);
    expect(loadHapticsEnabled(null)).toBe(true);
  });

  it('round-trips the stored preference (only "0" disables)', () => {
    const store = makeStore();
    saveHapticsEnabled(false, store);
    expect(store.map.get(HAPTICS_STORE_KEY)).toBe('0');
    expect(loadHapticsEnabled(store)).toBe(false);
    saveHapticsEnabled(true, store);
    expect(store.map.get(HAPTICS_STORE_KEY)).toBe('1');
    expect(loadHapticsEnabled(store)).toBe(true);
  });

  it('vibrates only when enabled and the API exists', () => {
    const calls: Array<number | number[]> = [];
    const nav = {
      vibrate: (p: number | number[]) => {
        calls.push(p);
        return true;
      },
    };
    expect(triggerHaptic(10, true, nav)).toBe(true);
    expect(triggerHaptic(10, false, nav)).toBe(false); // disabled
    expect(triggerHaptic(10, true, {})).toBe(false); // no Vibration API
    expect(triggerHaptic(10, true, null)).toBe(false); // no navigator
    expect(calls).toEqual([10]);
  });

  it('swallows Vibration API exceptions', () => {
    const nav = {
      vibrate: () => {
        throw new Error('blocked');
      },
    };
    expect(triggerHaptic([12, 40, 12], true, nav)).toBe(false);
  });
});

class FakeClassList {
  private values = new Set<string>();

  add(...names: string[]): void {
    for (const name of names) this.values.add(name);
  }

  remove(...names: string[]): void {
    for (const name of names) this.values.delete(name);
  }

  contains(name: string): boolean {
    return this.values.has(name);
  }

  toggle(name: string, force?: boolean): boolean {
    const next = force ?? !this.values.has(name);
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }
}

class FakeElement extends EventTarget {
  classList = new FakeClassList();
  style = { transform: '', left: '', top: '' };
  offsetWidth = 122;
  private captured = new Set<number>();
  /** Selectors this element (or a simulated ancestor) matches, for closest();
   *  drives touch_router.ts's isInteractiveHudElement checks in tests. */
  matchedSelectors: string[] = [];

  constructor(
    private rect = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
  ) {
    super();
  }

  getBoundingClientRect(): DOMRect {
    return this.rect as DOMRect;
  }

  setPointerCapture(pointerId: number): void {
    this.captured.add(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.captured.delete(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.captured.has(pointerId);
  }

  closest(selector: string): FakeElement | null {
    return this.matchedSelectors.includes(selector) ? this : null;
  }

  querySelector(): Element | null {
    return null;
  }

  setAttribute(): void {}
}

class FakeMediaQueryList extends EventTarget {
  matches = true;
}

const previousGlobals = {
  document: globalThis.document,
  window: globalThis.window,
  navigator: globalThis.navigator,
};

afterEach(() => {
  Object.defineProperty(globalThis, 'document', {
    value: previousGlobals.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: previousGlobals.window,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: previousGlobals.navigator,
    configurable: true,
  });
});

function installMobileControlDom(): {
  canvas: FakeElement;
  moveZone: FakeElement;
  moveJoystick: FakeElement;
  cameraJoystick: FakeElement;
  jumpButton: FakeElement;
  emoteButton: FakeElement;
  discordButton: FakeElement;
  donateButton: FakeElement;
  windowTarget: EventTarget;
} {
  const elements = new Map<string, FakeElement>([
    [
      'game-canvas',
      new FakeElement({ left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844 }),
    ],
    ['mobile-controls', new FakeElement()],
    [
      'mobile-move-zone',
      new FakeElement({ left: 0, top: 0, right: 240, bottom: 240, width: 240, height: 240 }),
    ],
    ['mobile-move-joystick', new FakeElement()],
    ['mobile-move-stick', new FakeElement()],
    ['mobile-camera-joystick', new FakeElement()],
    ['mobile-camera-stick', new FakeElement()],
    ['mobile-jump', new FakeElement()],
    ['mobile-emote', new FakeElement()],
    ['mobile-discord', new FakeElement()],
    ['mobile-donate', new FakeElement()],
  ]);
  const body = new FakeElement();
  const documentTarget = new EventTarget();
  const windowTarget = new EventTarget() as EventTarget & {
    matchMedia(query: string): FakeMediaQueryList;
  };
  windowTarget.matchMedia = () => new FakeMediaQueryList();

  const documentFake = documentTarget as EventTarget & {
    body: FakeElement;
    visibilityState: DocumentVisibilityState;
    getElementById(id: string): FakeElement | null;
  };
  documentFake.body = body;
  documentFake.visibilityState = 'visible';
  documentFake.getElementById = (id: string) => elements.get(id) ?? null;

  Object.defineProperty(globalThis, 'document', { value: documentFake, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: windowTarget, configurable: true });

  return {
    canvas: elements.get('game-canvas')!,
    moveZone: elements.get('mobile-move-zone')!,
    moveJoystick: elements.get('mobile-move-joystick')!,
    cameraJoystick: elements.get('mobile-camera-joystick')!,
    jumpButton: elements.get('mobile-jump')!,
    emoteButton: elements.get('mobile-emote')!,
    discordButton: elements.get('mobile-discord')!,
    donateButton: elements.get('mobile-donate')!,
    windowTarget,
  };
}

function pointerEvent(
  type: string,
  init: { pointerId: number; clientX?: number; clientY?: number; pointerType?: string },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    clientX: { value: init.clientX ?? 0 },
    clientY: { value: init.clientY ?? 0 },
    pointerType: { value: init.pointerType ?? '' },
  });
  return event;
}

function mobileCallbacks() {
  const noop = () => {};
  return {
    onCycleTarget: noop,
    onJump: noop,
    onInteract: noop,
    onAutorun: () => false,
    onChat: noop,
    onMenu: noop,
    onSocial: noop,
    onDiscord: noop,
    onDonate: noop,
    onEmotes: noop,
    onArena: noop,
    onValeCup: noop,
    onQuestLog: noop,
    onCharacter: noop,
    onBags: noop,
    onSpellbook: noop,
    onTalents: noop,
    onMap: noop,
    onLeaderboard: noop,
    onDailyRewards: noop,
    onNameplates: () => false,
    onMusic: () => true,
    onRecenterCamera: noop,
  };
}

describe('MobileControls pointer lifecycle', () => {
  it('clears movement when the active pointer ends outside the joystick element', () => {
    const { moveZone, windowTarget } = installMobileControlDom();
    let lastMove: TouchMoveInput | null = null;
    let clearCount = 0;
    const input = {
      setTouchMove: (move: TouchMoveInput) => {
        lastMove = move;
      },
      clearTouchMove: () => {
        clearCount += 1;
        lastMove = null;
      },
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    moveZone.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 4, clientX: 100, clientY: 50 }),
    );
    moveZone.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 4, clientX: 160, clientY: 50 }),
    );

    expect(lastMove).toEqual({ forward: false, back: false, strafeLeft: false, strafeRight: true });

    windowTarget.dispatchEvent(pointerEvent('pointerup', { pointerId: 4 }));

    expect(clearCount).toBe(1);
    expect(lastMove).toBeNull();
  });

  it('still owns the touch as movement when the finger lands on a joystick DESCENDANT (the stick)', () => {
    const { moveZone } = installMobileControlDom();
    let lastMove: TouchMoveInput | null = null;
    const input = {
      setTouchMove: (move: TouchMoveInput) => {
        lastMove = move;
      },
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    // The visible stick (#mobile-move-stick) is a child of the joystick base, so
    // a thumb landing on it reports the stick as event.target, not the zone or
    // the joystick element. The router must classify it via closest(), not identity.
    const stickTarget = new FakeElement();
    stickTarget.matchedSelectors = ['#mobile-move-joystick'];
    const downEvent = pointerEvent('pointerdown', { pointerId: 5, clientX: 100, clientY: 50 });
    Object.defineProperty(downEvent, 'target', { value: stickTarget });
    moveZone.dispatchEvent(downEvent);
    moveZone.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 5, clientX: 160, clientY: 50 }),
    );

    expect(lastMove).toEqual({ forward: false, back: false, strafeLeft: false, strafeRight: true });
  });

  it('never starts a movement-joystick drag while a mobile window/menu is open', () => {
    const { moveZone } = installMobileControlDom();
    let lastMove: TouchMoveInput | null = null;
    let hapticCalls = 0;
    const input = {
      setTouchMove: (move: TouchMoveInput) => {
        lastMove = move;
      },
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;
    const nav = {
      vibrate: () => {
        hapticCalls += 1;
        return true;
      },
    };
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });

    new MobileControls(input, mobileCallbacks()).start();
    document.body.classList.add('mobile-window-open');

    moveZone.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 6, clientX: 100, clientY: 50 }),
    );
    moveZone.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 6, clientX: 160, clientY: 50 }),
    );

    expect(lastMove).toBeNull();
    expect(hapticCalls).toBe(0);
  });

  it('touchdown alone never produces movement intent: the origin IS the touch point', () => {
    const { moveZone } = installMobileControlDom();
    let lastMove: TouchMoveInput | null = null;
    const input = {
      setTouchMove: (move: TouchMoveInput) => {
        lastMove = move;
      },
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    // Deep in the zone's bottom-left corner, far from the wheel's home centre:
    // the shipped v0.22.0 clampJoystickOrigin pinned the origin into the
    // capture zone here (which cannot contain the wheel), reading an instant
    // back+strafe-left before any drag: the issue #1229 drift.
    moveZone.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, clientX: 8, clientY: 232 }));

    expect(lastMove).toEqual({
      forward: false,
      back: false,
      strafeLeft: false,
      strafeRight: false,
    });
  });

  it('captures touches on the wheel itself (its arc overhangs the capture zone)', () => {
    const { moveJoystick } = installMobileControlDom();
    let lastMove: TouchMoveInput | null = null;
    const input = {
      setTouchMove: (move: TouchMoveInput) => {
        lastMove = move;
      },
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    // The 140/128px wheel overhangs the fixed 132px zone; a touch on the
    // overhang targets the wheel, not the zone, and used to be a dead sliver
    // (the wheel had pointer-events: auto but no listeners).
    moveJoystick.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 8, clientX: 140, clientY: 60 }),
    );
    moveJoystick.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 8, clientX: 200, clientY: 60 }),
    );

    expect(lastMove).toEqual({ forward: false, back: false, strafeLeft: false, strafeRight: true });
  });

  it('a window opening mid-drag releases the joystick instead of walking blind', () => {
    const { moveZone } = installMobileControlDom();
    let lastMove: TouchMoveInput | null = null;
    let clearCount = 0;
    const input = {
      setTouchMove: (move: TouchMoveInput) => {
        lastMove = move;
      },
      clearTouchMove: () => {
        clearCount += 1;
        lastMove = null;
      },
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    moveZone.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 9, clientX: 100, clientY: 50 }),
    );
    moveZone.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 9, clientX: 160, clientY: 50 }),
    );
    expect(lastMove).toEqual({ forward: false, back: false, strafeLeft: false, strafeRight: true });

    // A bag/map/quest window opens under the held thumb: the joystick is now
    // beneath the full-screen backdrop, so the next move must end the drag
    // (the same abort camera swipe-look already had), not keep walking.
    document.body.classList.add('mobile-window-open');
    moveZone.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 9, clientX: 170, clientY: 50 }),
    );

    expect(clearCount).toBe(1);
    expect(lastMove).toBeNull();
  });

  it('keeps updating camera look when the active pointer moves outside the joystick element', () => {
    const { cameraJoystick, windowTarget } = installMobileControlDom();
    let touchLookActive = false;
    let lastLook = { x: 0, y: 0 };
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: (active: boolean) => {
        touchLookActive = active;
      },
      setTouchLookVector: (look: { x: number; y: number }) => {
        lastLook = look;
      },
    } as unknown as Input;

    const controls = new MobileControls(input, mobileCallbacks());
    controls.start();
    // The camera joystick is hidden/off by default; opt in for this test.
    controls.setCameraJoystickEnabled(true);

    cameraJoystick.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 9, clientX: 50, clientY: 50 }),
    );
    windowTarget.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 9, clientX: 100, clientY: 50 }),
    );

    expect(touchLookActive).toBe(true);
    expect(lastLook).toEqual({ x: 0.8, y: 0 });

    windowTarget.dispatchEvent(pointerEvent('pointercancel', { pointerId: 9 }));

    expect(touchLookActive).toBe(false);
    expect(lastLook).toEqual({ x: 0, y: 0 });
  });

  it('camera joystick is hidden/off by default: onCameraDown no-ops until enabled', () => {
    const { cameraJoystick } = installMobileControlDom();
    let touchLookActive = false;
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: (active: boolean) => {
        touchLookActive = active;
      },
      setTouchLookVector: () => {},
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    cameraJoystick.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 9, clientX: 50, clientY: 50 }),
    );

    expect(touchLookActive).toBe(false);
    expect(cameraJoystick.classList.contains('active')).toBe(false);
  });

  it('a fresh camera-joystick press while a mobile window/menu is already open no-ops', () => {
    const { cameraJoystick } = installMobileControlDom();
    let touchLookActive = false;
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: (active: boolean) => {
        touchLookActive = active;
      },
      setTouchLookVector: () => {},
    } as unknown as Input;

    const controls = new MobileControls(input, mobileCallbacks());
    controls.start();
    controls.setCameraJoystickEnabled(true);
    document.body.classList.add('mobile-window-open');

    cameraJoystick.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 46, clientX: 50, clientY: 50 }),
    );

    expect(touchLookActive).toBe(false);
    expect(cameraJoystick.classList.contains('active')).toBe(false);
  });

  it('fires the emote callback when the on-screen Emotes button is tapped', () => {
    const { emoteButton } = installMobileControlDom();
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;

    let emotes = 0;
    const callbacks = {
      ...mobileCallbacks(),
      onEmotes: () => {
        emotes += 1;
      },
    };
    new MobileControls(input, callbacks).start();

    emoteButton.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));

    expect(emotes).toBe(1);
  });

  it('fires the Discord callback when the on-screen Discord button is tapped', () => {
    const { discordButton } = installMobileControlDom();
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;

    let discord = 0;
    const callbacks = {
      ...mobileCallbacks(),
      onDiscord: () => {
        discord += 1;
      },
    };
    new MobileControls(input, callbacks).start();

    discordButton.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));

    expect(discord).toBe(1);
  });

  it('fires the Donate callback when the on-screen Donate button is tapped', () => {
    const { donateButton } = installMobileControlDom();
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;

    let donate = 0;
    const callbacks = {
      ...mobileCallbacks(),
      onDonate: () => {
        donate += 1;
      },
    };
    new MobileControls(input, callbacks).start();

    donateButton.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));

    expect(donate).toBe(1);
  });

  it('closes the open More modal when tapping outside it', () => {
    installMobileControlDom();
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;
    new MobileControls(input, mobileCallbacks()).start();

    // open the More modal, then a press outside it dismisses it
    document.body.classList.add('mobile-more-open');
    (document as unknown as EventTarget).dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 31, clientX: 10, clientY: 10 }),
    );

    expect(document.body.classList.contains('mobile-more-open')).toBe(false);
  });

  it('ignores an outside press while the More modal is closed', () => {
    installMobileControlDom();
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;
    new MobileControls(input, mobileCallbacks()).start();

    (document as unknown as EventTarget).dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 32, clientX: 10, clientY: 10 }),
    );

    expect(document.body.classList.contains('mobile-more-open')).toBe(false);
  });

  it('fires the Jump callback immediately on pointerdown without double-firing the generated click', () => {
    const { jumpButton } = installMobileControlDom();
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;

    let jumps = 0;
    const callbacks = {
      ...mobileCallbacks(),
      onJump: () => {
        jumps += 1;
      },
    };
    new MobileControls(input, callbacks).start();

    jumpButton.dispatchEvent(pointerEvent('pointerdown', { pointerId: 30, pointerType: 'touch' }));
    expect(jumps).toBe(1);

    jumpButton.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
    expect(jumps).toBe(1);
  });

  it('rotates the camera from a single-finger swipe on the game canvas', () => {
    const { canvas } = installMobileControlDom();
    const deltas: Array<{ dx: number; dy: number }> = [];
    const lookActive: boolean[] = [];
    const lookVectors: Array<{ x: number; y: number }> = [];
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: (active: boolean) => {
        lookActive.push(active);
      },
      setTouchLookVector: (look: { x: number; y: number }) => {
        lookVectors.push(look);
      },
      applyTouchLookDelta: (dx: number, dy: number) => {
        deltas.push({ dx, dy });
      },
      zoomBy: () => {},
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 12,
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 12,
        pointerType: 'touch',
        clientX: 103,
        clientY: 102,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 12,
        pointerType: 'touch',
        clientX: 122,
        clientY: 109,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 12,
        pointerType: 'touch',
        clientX: 140,
        clientY: 120,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointerup', {
        pointerId: 12,
        pointerType: 'touch',
        clientX: 140,
        clientY: 120,
      }),
    );

    expect(deltas).toEqual([
      { dx: 22, dy: 9 },
      { dx: 18, dy: 11 },
    ]);
    expect(lookActive).toEqual([true, false]);
    expect(lookVectors).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it('cancels canvas swipe rotation when a second finger starts pinch zoom', () => {
    const { canvas } = installMobileControlDom();
    const deltas: Array<{ dx: number; dy: number }> = [];
    const zooms: number[] = [];
    const lookActive: boolean[] = [];
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: (active: boolean) => {
        lookActive.push(active);
      },
      setTouchLookVector: () => {},
      applyTouchLookDelta: (dx: number, dy: number) => {
        deltas.push({ dx, dy });
      },
      zoomBy: (delta: number) => {
        zooms.push(delta);
      },
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 21,
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 21,
        pointerType: 'touch',
        clientX: 116,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 22,
        pointerType: 'touch',
        clientX: 200,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 21,
        pointerType: 'touch',
        clientX: 130,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 22,
        pointerType: 'touch',
        clientX: 220,
        clientY: 100,
      }),
    );

    expect(deltas).toEqual([{ dx: 16, dy: 0 }]);
    expect(lookActive).toEqual([true, false]);
    expect(zooms.length).toBeGreaterThan(0);
  });

  it('blocks swipe-look from starting over interactive HUD chrome (a button/window)', () => {
    const { canvas } = installMobileControlDom();
    const deltas: Array<{ dx: number; dy: number }> = [];
    const lookActive: boolean[] = [];
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: (active: boolean) => lookActive.push(active),
      setTouchLookVector: () => {},
      applyTouchLookDelta: (dx: number, dy: number) => deltas.push({ dx, dy }),
      zoomBy: () => {},
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    // A synthetic pointerdown target that reports as a mobile action-ring
    // button ancestor (simulates a finger landing on HUD chrome over the canvas).
    const buttonTarget = new FakeElement();
    buttonTarget.matchedSelectors = ['.mobile-action-slot'];
    const downEvent = pointerEvent('pointerdown', {
      pointerId: 40,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
    });
    Object.defineProperty(downEvent, 'target', { value: buttonTarget });
    canvas.dispatchEvent(downEvent);

    const moveEvent = pointerEvent('pointermove', {
      pointerId: 40,
      pointerType: 'touch',
      clientX: 140,
      clientY: 140,
    });
    canvas.dispatchEvent(moveEvent);

    expect(lookActive).toEqual([]);
    expect(deltas).toEqual([]);
  });

  it('blocks swipe-look from starting while a mobile window/menu is open', () => {
    const { canvas } = installMobileControlDom();
    const lookActive: boolean[] = [];
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: (active: boolean) => lookActive.push(active),
      setTouchLookVector: () => {},
      applyTouchLookDelta: () => {},
      zoomBy: () => {},
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();
    document.body.classList.add('mobile-window-open');

    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 41,
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 41,
        pointerType: 'touch',
        clientX: 140,
        clientY: 140,
      }),
    );

    expect(lookActive).toEqual([]);
  });

  it('ends an active swipe-look camera drag when a window opens mid-drag', () => {
    const { canvas } = installMobileControlDom();
    const lookActive: boolean[] = [];
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: (active: boolean) => lookActive.push(active),
      setTouchLookVector: () => {},
      applyTouchLookDelta: () => {},
      zoomBy: () => {},
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 42,
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 42,
        pointerType: 'touch',
        clientX: 130,
        clientY: 100,
      }),
    );
    expect(lookActive).toEqual([true]);

    // A window opens mid-drag: the next move must end the drag.
    document.body.classList.add('mobile-window-open');
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 42,
        pointerType: 'touch',
        clientX: 160,
        clientY: 100,
      }),
    );

    expect(lookActive).toEqual([true, false]);
  });

  it('ends an active camera-joystick drag when a window opens mid-drag', () => {
    const { cameraJoystick } = installMobileControlDom();
    const lookActive: boolean[] = [];
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: (active: boolean) => lookActive.push(active),
      setTouchLookVector: () => {},
    } as unknown as Input;

    const controls = new MobileControls(input, mobileCallbacks());
    controls.start();
    controls.setCameraJoystickEnabled(true);

    cameraJoystick.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 43, clientX: 50, clientY: 50 }),
    );
    expect(lookActive).toEqual([true]);

    document.body.classList.add('mobile-window-open');
    cameraJoystick.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 43, clientX: 80, clientY: 50 }),
    );

    expect(lookActive).toEqual([true, false]);
  });

  it('ends an active pinch-zoom gesture when a window opens mid-gesture', () => {
    const { canvas } = installMobileControlDom();
    const zooms: number[] = [];
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
      applyTouchLookDelta: () => {},
      zoomBy: (delta: number) => {
        zooms.push(delta);
      },
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 50,
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 51,
        pointerType: 'touch',
        clientX: 200,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 50,
        pointerType: 'touch',
        clientX: 90,
        clientY: 100,
      }),
    );
    expect(zooms.length).toBe(1);

    // A window opens mid-gesture: the next move must stop zooming.
    document.body.classList.add('mobile-window-open');
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 51,
        pointerType: 'touch',
        clientX: 220,
        clientY: 100,
      }),
    );

    expect(zooms.length).toBe(1);

    // The pinch state was released, so even a further move from the surviving
    // pointer (post window-close) must not resume zooming on its own.
    document.body.classList.remove('mobile-window-open');
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 51,
        pointerType: 'touch',
        clientX: 240,
        clientY: 100,
      }),
    );
    expect(zooms.length).toBe(1);
  });

  it('never starts tracking a fresh pinch while a mobile window/menu is open', () => {
    const { canvas } = installMobileControlDom();
    const zooms: number[] = [];
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
      applyTouchLookDelta: () => {},
      zoomBy: (delta: number) => {
        zooms.push(delta);
      },
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();
    document.body.classList.add('mobile-window-open');

    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 52,
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 53,
        pointerType: 'touch',
        clientX: 200,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 52,
        pointerType: 'touch',
        clientX: 90,
        clientY: 100,
      }),
    );

    expect(zooms).toEqual([]);
  });

  it('never lets a button-owned pointer become a camera drag even if it drifts onto the canvas', () => {
    const { canvas } = installMobileControlDom();
    const lookActive: boolean[] = [];
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: (active: boolean) => lookActive.push(active),
      setTouchLookVector: () => {},
      applyTouchLookDelta: () => {},
      zoomBy: () => {},
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    // pointerdown lands on a button (recorded as combatButton in the ledger)
    const buttonTarget = new FakeElement();
    buttonTarget.matchedSelectors = ['.mobile-btn'];
    const downEvent = pointerEvent('pointerdown', {
      pointerId: 44,
      pointerType: 'touch',
      clientX: 10,
      clientY: 10,
    });
    Object.defineProperty(downEvent, 'target', { value: buttonTarget });
    canvas.dispatchEvent(downEvent);

    // the same pointer then drifts far enough over the canvas to clear the
    // swipe deadzone; it must still never start a camera drag.
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 44,
        pointerType: 'touch',
        clientX: 60,
        clientY: 60,
      }),
    );

    expect(lookActive).toEqual([]);
  });

  it('releaseAll on window blur clears every tracked touch owner', () => {
    const { canvas, windowTarget } = installMobileControlDom();
    const lookActive: boolean[] = [];
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: (active: boolean) => lookActive.push(active),
      setTouchLookVector: () => {},
      applyTouchLookDelta: () => {},
      zoomBy: () => {},
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 45,
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 45,
        pointerType: 'touch',
        clientX: 130,
        clientY: 100,
      }),
    );
    expect(lookActive).toEqual([true]);

    (windowTarget as unknown as EventTarget).dispatchEvent(new Event('blur'));

    // Blur releases the active swipe-look drag (existing releaseSwipeLook
    // behavior; releaseCamera also unconditionally clears touch-look, hence the
    // second `false`) and clears the ledger so a stray late move for the same
    // pointerId cannot resume owning anything.
    expect(lookActive).toEqual([true, false, false]);
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 45,
        pointerType: 'touch',
        clientX: 160,
        clientY: 100,
      }),
    );
    expect(lookActive).toEqual([true, false, false]);
  });
});
