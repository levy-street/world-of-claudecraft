import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from '../src/game/input';
import { Keybinds } from '../src/game/keybinds';

type EventHandler = (event: unknown) => void;

function installStorage(): void {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
  });
}

function makeInput(keybinds = new Keybinds()) {
  vi.stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0',
  });
  const canvasListeners = new Map<string, EventHandler>();
  const windowListeners = new Map<string, EventHandler>();
  const canvas = {
    style: { cursor: '' },
    addEventListener: vi.fn((type: string, callback: EventHandler) => {
      canvasListeners.set(type, callback);
    }),
    requestPointerLock: vi.fn(),
  };
  vi.stubGlobal('window', {
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener: vi.fn((type: string, callback: EventHandler) => {
      windowListeners.set(type, callback);
    }),
  });
  vi.stubGlobal('document', {
    activeElement: null,
    body: { classList: { contains: () => false } },
    fullscreenElement: null,
    webkitFullscreenElement: null,
    pointerLockElement: null,
    hidden: false,
    addEventListener: vi.fn(),
    exitPointerLock: vi.fn(),
  });
  const callbacks = {
    onTab: vi.fn(),
    onTargetFriendly: vi.fn(),
    onCycleFriendly: vi.fn(),
    onPet: vi.fn(),
    onAbility: vi.fn(),
    onAbilityDown: vi.fn(),
    onAbilityUp: vi.fn(),
    onUiKey: vi.fn(),
    onEmoteWheel: vi.fn(),
    onClickPick: vi.fn(),
    onAttackMove: vi.fn(),
  };
  const input = new Input(canvas as unknown as HTMLCanvasElement, callbacks, keybinds);
  return { canvas, canvasListeners, windowListeners, callbacks, input };
}

beforeEach(() => installStorage());

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Input pointer keybind capture', () => {
  it('captures a mouse button with modifiers through the same one-shot callback as a key', () => {
    const { input, windowListeners } = makeInput();
    const captured = vi.fn();
    const preventDefault = vi.fn();
    const stopImmediatePropagation = vi.fn();

    input.captureNextKey(captured);
    windowListeners.get('mouseup')?.({
      button: 3,
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault,
      stopImmediatePropagation,
    });

    expect(captured).toHaveBeenCalledWith('Shift+Mouse4');
    expect(preventDefault).toHaveBeenCalled();
    expect(stopImmediatePropagation).toHaveBeenCalled();
  });

  it('captures either wheel direction without scrolling or zooming', () => {
    const { input, windowListeners } = makeInput();
    const captured = vi.fn();
    const preventDefault = vi.fn();
    const stopImmediatePropagation = vi.fn();

    input.captureNextKey(captured);
    windowListeners.get('wheel')?.({
      deltaY: -100,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault,
      stopImmediatePropagation,
    });

    expect(captured).toHaveBeenCalledWith('WheelUp');
    expect(preventDefault).toHaveBeenCalled();
    expect(stopImmediatePropagation).toHaveBeenCalled();
  });
});

describe('Input pointer keybind dispatch', () => {
  it('holds and releases a mouse-bound movement action', () => {
    const keybinds = new Keybinds();
    keybinds.bind('forward', 0, 'Mouse4');
    const { canvas, input, canvasListeners, windowListeners } = makeInput(keybinds);

    canvasListeners.get('mousedown')?.({
      button: 3,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
    });
    expect(input.readMoveInput().forward).toBe(true);

    windowListeners.get('mouseup')?.({
      type: 'mouseup',
      button: 3,
      target: canvas,
      preventDefault: vi.fn(),
    });
    expect(input.readMoveInput().forward).toBe(false);
  });

  it('preserves action-bar down/up semantics for a held mouse button', () => {
    const keybinds = new Keybinds();
    keybinds.bind('slot0', 0, 'Mouse4');
    const { canvas, canvasListeners, windowListeners, callbacks } = makeInput(keybinds);

    canvasListeners.get('mousedown')?.({
      button: 3,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
    });
    expect(callbacks.onAbilityDown).toHaveBeenCalledWith(0);
    expect(callbacks.onAbilityUp).not.toHaveBeenCalled();

    windowListeners.get('pointerup')?.({
      type: 'pointerup',
      button: 3,
      target: canvas,
      preventDefault: vi.fn(),
    });
    expect(callbacks.onAbilityUp).toHaveBeenCalledOnce();

    windowListeners.get('mouseup')?.({
      type: 'mouseup',
      button: 3,
      target: canvas,
      preventDefault: vi.fn(),
    });
    expect(callbacks.onAbilityUp).toHaveBeenCalledOnce();
  });

  it('fires a wheel-bound action as a complete tap and suppresses camera zoom', () => {
    const keybinds = new Keybinds();
    keybinds.bind('slot1', 0, 'WheelUp');
    const { input, canvasListeners, callbacks } = makeInput(keybinds);
    const start = input.camDist;
    const preventDefault = vi.fn();

    canvasListeners.get('wheel')?.({
      deltaY: -100,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault,
    });

    expect(callbacks.onAbilityDown).toHaveBeenCalledWith(1);
    expect(callbacks.onAbilityUp).toHaveBeenCalledWith(1);
    expect(input.camDist).toBe(start);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('keeps camera zoom for an unbound wheel direction', () => {
    const { input, canvasListeners, callbacks } = makeInput();
    const start = input.camDist;

    canvasListeners.get('wheel')?.({
      deltaY: 100,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
    });

    expect(input.camDist).toBeGreaterThan(start);
    expect(callbacks.onAbilityDown).not.toHaveBeenCalled();
    expect(callbacks.onAbilityUp).not.toHaveBeenCalled();
  });
});
