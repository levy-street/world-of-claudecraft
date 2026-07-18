import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Input, TouchMoveInput } from '../src/game/input';
import { CHROME_FADE_IDLE_CLASS, CHROME_FADE_IDLE_MS } from '../src/game/mobile_chrome_fade';
import {
  CHAT_LONG_PRESS_MS,
  HAPTICS_STORE_KEY,
  interfaceModeFromSetting,
  isChatLongPress,
  isMoveAutorunNear,
  isMoveAutorunPush,
  isPhoneTouchDevice,
  isRecenterDoubleTap,
  loadHapticsEnabled,
  MOVE_AUTORUN_REVEAL_THRESHOLD,
  MOVE_AUTORUN_THRESHOLD,
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

describe('isMoveAutorunPush', () => {
  it('requires a strong upward push into the top joystick band', () => {
    expect(isMoveAutorunPush(-MOVE_AUTORUN_THRESHOLD)).toBe(true);
    expect(isMoveAutorunPush(-MOVE_AUTORUN_THRESHOLD + 0.01)).toBe(false);
    expect(isMoveAutorunPush(0)).toBe(false);
  });

  it('reveals the round target before the lock threshold', () => {
    expect(isMoveAutorunNear(-MOVE_AUTORUN_REVEAL_THRESHOLD)).toBe(true);
    expect(isMoveAutorunNear(-MOVE_AUTORUN_REVEAL_THRESHOLD + 0.01)).toBe(false);
    expect(isMoveAutorunPush(-MOVE_AUTORUN_REVEAL_THRESHOLD)).toBe(false);
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

describe('pinchZoomDelta', () => {
  it('ignores small two-finger distance jitter', () => {
    expect(pinchZoomDelta(120, 130)).toBe(0);
    expect(pinchZoomDelta(120, 109)).toBe(0);
  });

  it('zooms in when fingers spread apart and out when they pinch together', () => {
    expect(pinchZoomDelta(100, 150)).toBeCloseTo(-1.33);
    expect(pinchZoomDelta(150, 100)).toBeCloseTo(1.33);
  });
});

// (clampJoystickOrigin was removed: clamping the floating origin into the
// 132px capture zone, which cannot contain the 140/128px wheel, pinned the
// origin away from the thumb and made every off-center touchdown instantly
// walk the character: the issue #1229 drift. The origin is now the raw touch
// point; the integration tests below pin the new contract.)

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
  dataset: Record<string, string> = {};
  style: {
    transform: string;
    left: string;
    top: string;
    right: string;
    bottom: string;
    display: string;
    overflowY: string;
    height: string;
  } = {
    transform: '',
    left: '',
    top: '',
    right: '',
    bottom: '',
    display: '',
    overflowY: '',
    height: '',
  };
  offsetWidth = 122;
  // Textarea-ish props so #chat-input can back exitChatReply (value clear + blur) in
  // the fake DOM; harmless no-op defaults for every other element.
  value = '';
  blur(): void {}
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
    if (!this.captured.has(pointerId)) return;
    this.captured.delete(pointerId);
    // Real browsers dispatch lostpointercapture for both an explicit
    // releasePointerCapture() call and an implicit capture loss (spec
    // behavior), and do so as a separate task rather than re-entrantly within
    // the releasePointerCapture() call itself. The fake DOM previously stayed
    // silent here, which is why the pinch-vs-swipe-look echo regression
    // (releaseSwipeLook's own release tearing down a just-started pinch) went
    // uncaught: queue it with queueMicrotask so callers observe the same
    // non-reentrant timing as a real browser instead of synchronous recursion.
    queueMicrotask(() => {
      this.dispatchEvent(
        Object.defineProperties(
          new Event('lostpointercapture', { bubbles: true, cancelable: true }),
          {
            pointerId: { value: pointerId },
            pointerType: { value: 'touch' },
          },
        ),
      );
    });
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
  autorunTarget: FakeElement;
  cameraJoystick: FakeElement;
  jumpButton: FakeElement;
  moreButton: FakeElement;
  moreModal: FakeElement;
  emoteButton: FakeElement;
  discordButton: FakeElement;
  donateButton: FakeElement;
  windowTarget: EventTarget;
} {
  const autorunTarget = new FakeElement();
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
    ['mobile-autorun-target', autorunTarget],
    ['mobile-camera-joystick', new FakeElement()],
    ['mobile-camera-stick', new FakeElement()],
    ['mobile-jump', new FakeElement()],
    ['mobile-more', new FakeElement()],
    ['mobile-extra-controls', new FakeElement()],
    ['mobile-emote', new FakeElement()],
    ['mobile-discord', new FakeElement()],
    ['mobile-donate', new FakeElement()],
    // The chat composer, so exitChatReply (value clear + blur) is exercised in the
    // fake DOM: the setActive draft-survival test reads its .value.
    ['chat-input', new FakeElement()],
  ]);
  const body = new FakeElement();
  const documentTarget = new EventTarget();
  const windowTarget = new EventTarget() as EventTarget & {
    matchMedia(query: string): FakeMediaQueryList;
  };
  windowTarget.matchMedia = () => new FakeMediaQueryList();
  Object.defineProperties(windowTarget, {
    innerWidth: { value: 390, configurable: true },
    innerHeight: { value: 844, configurable: true },
  });
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
    autorunTarget,
    cameraJoystick: elements.get('mobile-camera-joystick')!,
    jumpButton: elements.get('mobile-jump')!,
    moreButton: elements.get('mobile-more')!,
    moreModal: elements.get('mobile-extra-controls')!,
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
    onChat: noop,
    onChatOpen: noop,
    onChatClose: noop,
    onMenu: noop,
    onSocial: noop,
    onDiscord: noop,
    onDonate: noop,
    onEmotes: noop,
    onArena: noop,
    onDungeonFinder: noop,
    onValeCup: noop,
    onQuestLog: noop,
    onCharacter: noop,
    onBags: noop,
    onCrafting: noop,
    onSpellbook: noop,
    onTalents: noop,
    onMap: noop,
    onLeaderboard: noop,
    onDailyRewards: noop,
    onDeeds: noop,
    onNameplates: () => false,
    onMusic: () => true,
    onRecenterCamera: noop,
    onGroundAimMove: () => false,
    onGroundAimTap: () => false,
  };
}

describe('MobileControls ground placement tap', () => {
  const inputWithoutLook = () =>
    ({
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
      applyTouchLookDelta: () => {},
      zoomBy: () => {},
    }) as unknown as Input;

  it('moves and commits an active reticle without turning the same drag into camera look', () => {
    const { canvas } = installMobileControlDom();
    const moves: Array<{ x: number; y: number }> = [];
    const taps: Array<{ x: number; y: number }> = [];
    const lookDeltas: Array<{ x: number; y: number }> = [];
    const callbacks = {
      ...mobileCallbacks(),
      onGroundAimMove: (x: number, y: number) => {
        moves.push({ x, y });
        return true;
      },
      onGroundAimTap: (x: number, y: number) => {
        taps.push({ x, y });
        return true;
      },
    };
    const input = inputWithoutLook();
    input.applyTouchLookDelta = (x: number, y: number) => lookDeltas.push({ x, y });
    new MobileControls(input, callbacks).start();

    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 70,
        pointerType: 'touch',
        clientX: 320,
        clientY: 180,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointerup', {
        pointerId: 70,
        pointerType: 'touch',
        clientX: 322,
        clientY: 181,
      }),
    );
    expect(taps).toEqual([{ x: 322, y: 181 }]);
    expect(moves).toEqual([{ x: 320, y: 180 }]);

    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 71,
        pointerType: 'touch',
        clientX: 200,
        clientY: 160,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 71,
        pointerType: 'touch',
        clientX: 260,
        clientY: 160,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointerup', {
        pointerId: 71,
        pointerType: 'touch',
        clientX: 260,
        clientY: 160,
      }),
    );
    expect(moves).toEqual([
      { x: 320, y: 180 },
      { x: 200, y: 160 },
      { x: 260, y: 160 },
    ]);
    expect(taps).toEqual([
      { x: 322, y: 181 },
      { x: 260, y: 160 },
    ]);
    expect(lookDeltas).toEqual([]);

    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 72,
        pointerType: 'touch',
        clientX: 300,
        clientY: 170,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointercancel', {
        pointerId: 72,
        pointerType: 'touch',
        clientX: 340,
        clientY: 170,
      }),
    );
    expect(taps).toHaveLength(2);
  });
});

describe('MobileControls setActive draft survival', () => {
  const noopInputForActive = () =>
    ({
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    }) as unknown as Input;

  it('keeps an in-progress composer draft on a redundant re-activation (only a real desktop->touch transition resets it)', () => {
    installMobileControlDom();
    // Force touch active for a real desktop->touch transition on start().
    setInterfaceMode('touch');
    const controls = new MobileControls(noopInputForActive(), mobileCallbacks());
    controls.start();
    // The initial activation (a genuine transition) reset the composer to empty.
    const chatInput = document.getElementById('chat-input') as unknown as { value: string };
    expect(chatInput).toBeTruthy();
    // The player starts typing a draft in the composer.
    chatInput.value = 'hello raid, on my way';
    // A redundant re-activation while ALREADY active (e.g. a foldable resize crossing
    // the PHONE_TOUCH_QUERY threshold but staying in touch): the draft must SURVIVE.
    controls.refreshInterfaceMode();
    expect(chatInput.value).toBe('hello raid, on my way');
  });

  it('resets the composer on a genuine desktop->touch transition (draft from a prior desktop session cleared)', () => {
    installMobileControlDom();
    // Start in desktop mode (not active), so the first refresh into touch is a real
    // transition that must clear a stray composer value.
    setInterfaceMode('desktop');
    const controls = new MobileControls(noopInputForActive(), mobileCallbacks());
    controls.start();
    const chatInput = document.getElementById('chat-input') as unknown as { value: string };
    chatInput.value = 'stale desktop draft';
    // Flip to touch: a genuine desktop->touch transition resets the composer.
    setInterfaceMode('touch');
    controls.refreshInterfaceMode();
    expect(chatInput.value).toBe('');
  });
});

describe('MobileControls pointer lifecycle', () => {
  it('engages autorun when the move joystick is pushed into the high round target', () => {
    const { autorunTarget, moveZone, windowTarget } = installMobileControlDom();
    let autorunOn = false;
    let clearCount = 0;
    const input = {
      get autorun() {
        return autorunOn;
      },
      setTouchMove: (move: TouchMoveInput) => {
        if (move.forward || move.back || move.strafeLeft || move.strafeRight) autorunOn = false;
      },
      clearTouchMove: () => {
        clearCount += 1;
      },
      setAutorun: (on: boolean) => {
        autorunOn = on;
        return autorunOn;
      },
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    moveZone.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 14, clientX: 100, clientY: 100 }),
    );
    moveZone.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 14, clientX: 100, clientY: 25 }),
    );

    expect(autorunOn).toBe(false);
    expect(autorunTarget.classList.contains('near')).toBe(true);
    expect(autorunTarget.classList.contains('locked')).toBe(false);

    moveZone.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 14, clientX: 100, clientY: -5 }),
    );

    expect(autorunOn).toBe(true);
    expect(autorunTarget.classList.contains('locked')).toBe(true);
    expect(clearCount).toBeGreaterThan(0);

    windowTarget.dispatchEvent(pointerEvent('pointerup', { pointerId: 14 }));

    expect(autorunOn).toBe(true);
    expect(autorunTarget.classList.contains('near')).toBe(true);
    expect(autorunTarget.classList.contains('locked')).toBe(true);

    moveZone.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 15, clientX: 100, clientY: 100 }),
    );

    expect(autorunOn).toBe(false);
    expect(autorunTarget.classList.contains('near')).toBe(false);
    expect(autorunTarget.classList.contains('locked')).toBe(false);
  });

  it('cancels a locked autorun when the same joystick drag leaves the target', () => {
    const { autorunTarget, moveZone } = installMobileControlDom();
    let autorunOn = false;
    const input = {
      get autorun() {
        return autorunOn;
      },
      setTouchMove: (move: TouchMoveInput) => {
        if (move.forward || move.back || move.strafeLeft || move.strafeRight) autorunOn = false;
      },
      clearTouchMove: () => {},
      setAutorun: (on: boolean) => {
        autorunOn = on;
        return autorunOn;
      },
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    moveZone.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 16, clientX: 100, clientY: 100 }),
    );
    moveZone.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 16, clientX: 100, clientY: -5 }),
    );
    expect(autorunOn).toBe(true);
    expect(autorunTarget.classList.contains('locked')).toBe(true);

    moveZone.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 16, clientX: 102, clientY: 84 }),
    );

    expect(autorunOn).toBe(false);
    expect(autorunTarget.classList.contains('near')).toBe(false);
    expect(autorunTarget.classList.contains('locked')).toBe(false);
  });

  it('syncs an external autorun reset into the round target UI', () => {
    const { autorunTarget } = installMobileControlDom();
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;

    const controls = new MobileControls(input, mobileCallbacks());
    controls.start();

    controls.syncAutorun(true);

    expect(autorunTarget.classList.contains('near')).toBe(true);
    expect(autorunTarget.classList.contains('locked')).toBe(true);

    autorunTarget.classList.add('near', 'locked');

    controls.syncAutorun(false);

    expect(autorunTarget.classList.contains('near')).toBe(false);
    expect(autorunTarget.classList.contains('locked')).toBe(false);
  });

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

  it('clamps the drawn wheel near its resting spot on a far touchdown, without drifting input', () => {
    const { moveZone, moveJoystick } = installMobileControlDom();
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

    // The wheel's resting rect (installMobileControlDom's FakeElement default)
    // is {left:0,top:0,width:100,height:100}, centered at (50,50). A touchdown
    // far from that center (deep in the zone's bottom-left corner) must still
    // read zero deflection at touchdown (the input origin is the raw touch
    // point, unclamped: the #1229 drift contract above), even though the wheel
    // is only DRAWN a small distance toward the thumb.
    moveZone.dispatchEvent(pointerEvent('pointerdown', { pointerId: 9, clientX: 8, clientY: 232 }));
    expect(lastMove).toEqual({
      forward: false,
      back: false,
      strafeLeft: false,
      strafeRight: false,
    });
    // The drawn wheel leans toward the thumb but stays within
    // MOVE_JOYSTICK_FLOAT_RADIUS of its resting center (50,50), nowhere near
    // the far-off touch point (8,232): it must not have teleported there.
    const left = Number.parseFloat(moveJoystick.style.left);
    const top = Number.parseFloat(moveJoystick.style.top);
    const layoutRadius = moveJoystick.offsetWidth / 2;
    const drawnCenterX = left + layoutRadius;
    const drawnCenterY = top + layoutRadius;
    const distFromRest = Math.hypot(drawnCenterX - 50, drawnCenterY - 50);
    expect(distFromRest).toBeLessThanOrEqual(48 + 0.5);
    expect(Math.hypot(drawnCenterX - 8, drawnCenterY - 232)).toBeGreaterThan(distFromRest);
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

  it('keeps the More drawer centered when opened', () => {
    const { moreButton, moreModal } = installMobileControlDom();
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;
    new MobileControls(input, mobileCallbacks()).start();

    moreButton.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));

    expect(moreModal.style.left).toBe('50%');
    expect(moreModal.style.top).toBe('50%');
    expect(moreModal.style.right).toBe('auto');
    expect(moreModal.style.bottom).toBe('auto');
    expect(moreModal.style.transform).toBe('translate(-50%, -50%)');
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

  it('resets swipe-look rotation when the browser silently drops pointer capture (iOS gesture interruption)', () => {
    // Regression test for issue #1892: iOS Safari can invalidate an active
    // touch's pointer capture (a system gesture, Control Center swipe, or an
    // alert) WITHOUT firing pointerup or pointercancel. If only those two
    // events reset swipe-look state, the camera is left permanently latched
    // into "rotate" mode (setTouchLook(true) never flips back), which reads
    // to the player as the camera getting stuck spinning or losing normal
    // rotate/zoom control. `lostpointercapture` is the one event guaranteed
    // to fire when capture is lost, so the canvas must reset on it exactly
    // like `moveSurface`/`cameraJoystick` already do (mobile_controls.ts).
    const { canvas } = installMobileControlDom();
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
      applyTouchLookDelta: () => {},
      zoomBy: () => {},
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 33,
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 33,
        pointerType: 'touch',
        clientX: 140,
        clientY: 120,
      }),
    );
    expect(lookActive).toEqual([true]);

    // No pointerup/pointercancel: the browser just drops capture.
    canvas.dispatchEvent(
      pointerEvent('lostpointercapture', { pointerId: 33, pointerType: 'touch' }),
    );

    expect(lookActive).toEqual([true, false]);
    expect(lookVectors.at(-1)).toEqual({ x: 0, y: 0 });

    // A fresh single-finger swipe afterward must rotate normally again, not
    // stay locked out.
    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 34,
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 34,
        pointerType: 'touch',
        clientX: 140,
        clientY: 120,
      }),
    );
    expect(lookActive).toEqual([true, false, true]);
  });

  it('cancels canvas swipe rotation when a second finger starts guarded pinch zoom', () => {
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
    expect(zooms).toHaveLength(2);
    expect(zooms[0]).toBeGreaterThan(0);
    expect(zooms[1]).toBeLessThan(0);
  });

  it('keeps a pinch alive when the takeover release echoes back as lostpointercapture', async () => {
    // Regression test: releaseSwipeLook() calls releasePointerCapture() on the
    // swipe-look pointer when a second finger lands (onPinchDown at size 2).
    // That explicit release also fires lostpointercapture per spec, exactly
    // like an implicit iOS capture loss. Without the releasingCaptureForPointer
    // guard, the canvas lostpointercapture handler (mobile_controls.ts:429)
    // treats that echo as a real capture loss and runs onPinchEnd for the
    // pointer that just became part of the pinch, deleting it from
    // pinchPointers and nulling pinchPrevDist: the pinch that just started is
    // dead on arrival and stays dead (only pointerdown re-adds a pointer).
    //
    // The fake DOM's releasePointerCapture() queues its lostpointercapture echo
    // with queueMicrotask to match real non-reentrant browser timing, so this
    // test must await a microtask tick before asserting: a synchronous body
    // returns before the echo (and thus the guard) ever runs, which is why an
    // earlier version of this test still passed with the guard's early-return
    // removed. Flushing the microtask queue here is what makes it decisive.
    const { canvas } = installMobileControlDom();
    const zooms: number[] = [];
    const lookActive: boolean[] = [];
    const input = {
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: (active: boolean) => {
        lookActive.push(active);
      },
      setTouchLookVector: () => {},
      applyTouchLookDelta: () => {},
      zoomBy: (delta: number) => {
        zooms.push(delta);
      },
    } as unknown as Input;

    new MobileControls(input, mobileCallbacks()).start();

    // First finger: starts swipe-look (moves past the deadzone so lookActive
    // latches true and pointer capture is actually held, matching the fake
    // DOM's captured-set guard on releasePointerCapture).
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
        clientX: 130,
        clientY: 100,
      }),
    );
    expect(lookActive).toEqual([true]);

    // Second finger lands: triggers the pinch takeover, which releases the
    // first finger's swipe-look capture and echoes lostpointercapture for it.
    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 42,
        pointerType: 'touch',
        clientX: 200,
        clientY: 100,
      }),
    );
    // Let the fake DOM's queued lostpointercapture echo actually fire before
    // asserting, otherwise the guard it exercises never runs and this test
    // would pass whether or not the production code has the fix.
    await Promise.resolve();
    expect(lookActive).toEqual([true, false]);

    // The pinch must survive the echo: a move on both fingers should still
    // register as a guarded pinch zoom, not be silently dropped.
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 41,
        pointerType: 'touch',
        clientX: 90,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 42,
        pointerType: 'touch',
        clientX: 210,
        clientY: 100,
      }),
    );

    expect(zooms.length).toBeGreaterThan(0);
  });

  it('does not zoom for small two-finger jitter', () => {
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
        pointerId: 23,
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 24,
        pointerType: 'touch',
        clientX: 200,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 23,
        pointerType: 'touch',
        clientX: 105,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 24,
        pointerType: 'touch',
        clientX: 196,
        clientY: 100,
      }),
    );

    expect(zooms).toEqual([]);
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

  it('ends an active pinch gesture when a window opens mid-gesture', () => {
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
        clientX: 80,
        clientY: 100,
      }),
    );
    expect(zooms).toHaveLength(1);

    // A window opens mid-gesture: the next move must stop tracking zoom.
    document.body.classList.add('mobile-window-open');
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 51,
        pointerType: 'touch',
        clientX: 220,
        clientY: 100,
      }),
    );

    expect(zooms).toHaveLength(1);

    // The pinch state was released, so even a further move from the surviving
    // pointer (post window-close) must not resume the gesture on its own.
    document.body.classList.remove('mobile-window-open');
    canvas.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 51,
        pointerType: 'touch',
        clientX: 240,
        clientY: 100,
      }),
    );
    expect(zooms).toHaveLength(1);
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

describe('MobileControls chrome idle-fade lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
    setInterfaceMode('auto');
  });

  const noopInput = () =>
    ({
      setTouchMove: () => {},
      clearTouchMove: () => {},
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    }) as unknown as Input;

  it('dims chrome after idle in touch mode, un-dims on the flip to desktop, and re-arms un-dimmed back in touch', () => {
    // startChromeFade reads the global setTimeout at call time, so install fake
    // timers before start() arms the fade.
    vi.useFakeTimers();
    installMobileControlDom();

    const controls = new MobileControls(noopInput(), mobileCallbacks());
    // The fake matchMedia reports matches:true, so auto resolves to touch: start()
    // arms the idle-fade against document.body.
    controls.start();

    // Idle long enough for the fade to dim the body chrome.
    vi.advanceTimersByTime(CHROME_FADE_IDLE_MS);
    expect(document.body.classList.contains(CHROME_FADE_IDLE_CLASS)).toBe(true);

    // Flip to the desktop interface: the dim must be cleared, not stranded.
    setInterfaceMode('desktop');
    controls.refreshInterfaceMode();
    expect(document.body.classList.contains(CHROME_FADE_IDLE_CLASS)).toBe(false);

    // And it must not creep back: no timer survives to re-dim in desktop mode.
    vi.advanceTimersByTime(CHROME_FADE_IDLE_MS * 2);
    expect(document.body.classList.contains(CHROME_FADE_IDLE_CLASS)).toBe(false);

    // Flip back to touch: the fade re-arms un-dimmed, then dims again after idle.
    setInterfaceMode('touch');
    controls.refreshInterfaceMode();
    expect(document.body.classList.contains(CHROME_FADE_IDLE_CLASS)).toBe(false);
    vi.advanceTimersByTime(CHROME_FADE_IDLE_MS);
    expect(document.body.classList.contains(CHROME_FADE_IDLE_CLASS)).toBe(true);
  });
});
