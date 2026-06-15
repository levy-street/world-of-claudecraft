import { afterEach, describe, expect, it } from 'vitest';
import { isPhoneTouchDevice, mapJoystickVector, mapLookVector, MobileControls } from '../src/game/mobile_controls';
import type { Input, TouchMoveInput } from '../src/game/input';

describe('mapJoystickVector', () => {
  it('returns neutral inside the deadzone', () => {
    expect(mapJoystickVector(0, 0)).toEqual({ forward: false, back: false, strafeLeft: false, strafeRight: false });
    expect(mapJoystickVector(0.05, -0.08)).toEqual({ forward: false, back: false, strafeLeft: false, strafeRight: false });
  });

  it('maps cardinal movement directions', () => {
    expect(mapJoystickVector(0, -1)).toEqual({ forward: true, back: false, strafeLeft: false, strafeRight: false });
    expect(mapJoystickVector(0, 1)).toEqual({ forward: false, back: true, strafeLeft: false, strafeRight: false });
    expect(mapJoystickVector(-1, 0)).toEqual({ forward: false, back: false, strafeLeft: true, strafeRight: false });
    expect(mapJoystickVector(1, 0)).toEqual({ forward: false, back: false, strafeLeft: false, strafeRight: true });
  });

  it('maps diagonal movement directions', () => {
    expect(mapJoystickVector(0.7, -0.7)).toEqual({ forward: true, back: false, strafeLeft: false, strafeRight: true });
    expect(mapJoystickVector(-0.7, 0.7)).toEqual({ forward: false, back: true, strafeLeft: true, strafeRight: false });
  });
});

describe('isPhoneTouchDevice', () => {
  it('uses the phone touch media query', () => {
    const queries: string[] = [];
    const win = {
      matchMedia: (q: string) => {
        queries.push(q);
        return { matches: true };
      },
    } as unknown as Window;
    expect(isPhoneTouchDevice(win)).toBe(true);
    expect(queries[0]).toContain('pointer: coarse');
    expect(queries[0]).toContain('max-width: 940px');
    expect(queries[0]).toContain('max-height: 760px');
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
  style = { transform: '' };
  private captured = new Set<number>();

  constructor(private rect = { left: 0, top: 0, width: 100, height: 100 }) {
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

  closest(): Element | null {
    return null;
  }
}

class FakeMediaQueryList extends EventTarget {
  matches = true;
}

const previousGlobals = {
  document: globalThis.document,
  window: globalThis.window,
};

afterEach(() => {
  Object.defineProperty(globalThis, 'document', { value: previousGlobals.document, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: previousGlobals.window, configurable: true });
});

function installMobileControlDom(): { moveJoystick: FakeElement; cameraJoystick: FakeElement; windowTarget: EventTarget } {
  const elements = new Map<string, FakeElement>([
    ['mobile-controls', new FakeElement()],
    ['mobile-move-joystick', new FakeElement()],
    ['mobile-move-stick', new FakeElement()],
    ['mobile-camera-joystick', new FakeElement()],
    ['mobile-camera-stick', new FakeElement()],
  ]);
  const body = new FakeElement();
  const documentTarget = new EventTarget();
  const windowTarget = new EventTarget() as EventTarget & { matchMedia(query: string): FakeMediaQueryList };
  windowTarget.matchMedia = () => new FakeMediaQueryList();

  const documentFake = documentTarget as EventTarget & {
    body: FakeElement;
    getElementById(id: string): FakeElement | null;
  };
  documentFake.body = body;
  documentFake.getElementById = (id: string) => elements.get(id) ?? null;

  Object.defineProperty(globalThis, 'document', { value: documentFake, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: windowTarget, configurable: true });

  return {
    moveJoystick: elements.get('mobile-move-joystick')!,
    cameraJoystick: elements.get('mobile-camera-joystick')!,
    windowTarget,
  };
}

function pointerEvent(type: string, init: { pointerId: number; clientX?: number; clientY?: number }): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    clientX: { value: init.clientX ?? 0 },
    clientY: { value: init.clientY ?? 0 },
  });
  return event;
}

describe('MobileControls pointer lifecycle', () => {
  it('clears movement when the active pointer ends outside the joystick element', () => {
    const { moveJoystick, windowTarget } = installMobileControlDom();
    let lastMove: TouchMoveInput | null = null;
    let clearCount = 0;
    const input = {
      setTouchMove: (move: TouchMoveInput) => { lastMove = move; },
      clearTouchMove: () => { clearCount += 1; lastMove = null; },
      setTouchLook: () => {},
      setTouchLookVector: () => {},
    } as unknown as Input;
    const noop = () => {};

    new MobileControls(input, {
      onAttackNearest: noop,
      onTarget: noop,
      onInteract: noop,
      onChat: noop,
      onMenu: noop,
      onSocial: noop,
      onArena: noop,
      onSpellbook: noop,
      onMeters: noop,
      onMap: noop,
    }).start();

    moveJoystick.dispatchEvent(pointerEvent('pointerdown', { pointerId: 4, clientX: 100, clientY: 50 }));

    expect(lastMove).toEqual({ forward: false, back: false, strafeLeft: false, strafeRight: true });

    windowTarget.dispatchEvent(pointerEvent('pointerup', { pointerId: 4 }));

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
      setTouchLook: (active: boolean) => { touchLookActive = active; },
      setTouchLookVector: (look: { x: number; y: number }) => { lastLook = look; },
    } as unknown as Input;
    const noop = () => {};

    new MobileControls(input, {
      onAttackNearest: noop,
      onTarget: noop,
      onInteract: noop,
      onChat: noop,
      onMenu: noop,
      onSocial: noop,
      onArena: noop,
      onSpellbook: noop,
      onMeters: noop,
      onMap: noop,
    }).start();

    cameraJoystick.dispatchEvent(pointerEvent('pointerdown', { pointerId: 9, clientX: 50, clientY: 50 }));
    windowTarget.dispatchEvent(pointerEvent('pointermove', { pointerId: 9, clientX: 100, clientY: 50 }));

    expect(touchLookActive).toBe(true);
    expect(lastLook).toEqual({ x: 0.8, y: 0 });

    windowTarget.dispatchEvent(pointerEvent('pointercancel', { pointerId: 9 }));

    expect(touchLookActive).toBe(false);
    expect(lastLook).toEqual({ x: 0, y: 0 });
  });
});
