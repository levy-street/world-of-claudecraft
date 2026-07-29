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
  const windowListenerSets = new Map<string, Set<EventHandler>>();
  const addWindowListener = vi.fn((type: string, callback: EventHandler) => {
    let listeners = windowListenerSets.get(type);
    if (!listeners) {
      listeners = new Set();
      windowListenerSets.set(type, listeners);
    }
    listeners.add(callback);
    windowListeners.set(type, callback);
  });
  const removeWindowListener = vi.fn((type: string, callback: EventHandler) => {
    const listeners = windowListenerSets.get(type);
    listeners?.delete(callback);
    const remaining = listeners ? Array.from(listeners) : [];
    const latest = remaining[remaining.length - 1];
    if (latest) windowListeners.set(type, latest);
    else windowListeners.delete(type);
  });
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
    addEventListener: addWindowListener,
    removeEventListener: removeWindowListener,
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
  return {
    canvas,
    canvasListeners,
    windowListeners,
    addWindowListener,
    removeWindowListener,
    callbacks,
    input,
  };
}

beforeEach(() => installStorage());

afterEach(() => {
  vi.useRealTimers();
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
    const { input, windowListeners, addWindowListener, removeWindowListener } = makeInput();
    const captured = vi.fn();
    const preventDefault = vi.fn();
    const stopImmediatePropagation = vi.fn();

    expect(addWindowListener).not.toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      expect.anything(),
    );
    input.captureNextKey(captured);
    expect(addWindowListener).toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      expect.objectContaining({ capture: true, passive: false }),
    );
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
    expect(removeWindowListener).toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      expect.anything(),
    );
  });

  it('defers primary-button cancellation until Back or Close receives its click', () => {
    vi.useFakeTimers();
    const { input, windowListeners } = makeInput();
    const captured = vi.fn();
    const clickAction = vi.fn();
    const mouseDownStop = vi.fn();
    const mouseUpPrevent = vi.fn();
    const mouseUpStop = vi.fn();
    const clickPrevent = vi.fn();
    const clickStop = vi.fn();

    input.captureNextKey(captured);
    windowListeners.get('mousedown')?.({
      button: 0,
      target: {},
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: mouseDownStop,
    });
    windowListeners.get('mouseup')?.({
      button: 0,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: mouseUpPrevent,
      stopImmediatePropagation: mouseUpStop,
    });

    expect(captured).not.toHaveBeenCalled();
    expect(mouseDownStop).not.toHaveBeenCalled();
    expect(mouseUpPrevent).not.toHaveBeenCalled();
    expect(mouseUpStop).not.toHaveBeenCalled();

    windowListeners.get('click')?.({
      button: 0,
      preventDefault: clickPrevent,
      stopImmediatePropagation: clickStop,
    });
    if (clickStop.mock.calls.length === 0) clickAction();

    expect(clickAction).toHaveBeenCalledOnce();
    expect(clickPrevent).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(captured).toHaveBeenCalledWith(null);
  });

  it('does not let a deferred cancellation overwrite a capture started by that click', () => {
    vi.useFakeTimers();
    const { input, windowListeners } = makeInput();
    const firstCapture = vi.fn();
    const secondCapture = vi.fn();

    input.captureNextKey(firstCapture);
    windowListeners.get('mouseup')?.({
      button: 0,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });
    windowListeners.get('click')?.({
      button: 0,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });
    input.captureNextKey(secondCapture);
    vi.runAllTimers();

    expect(firstCapture).not.toHaveBeenCalled();
    windowListeners.get('keydown')?.({
      repeat: false,
      code: 'KeyK',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
    });
    expect(secondCapture).toHaveBeenCalledWith('KeyK');
  });

  it('installs and removes the configured wheel listener as bindings change', () => {
    const keybinds = new Keybinds();
    const { windowListeners, addWindowListener, removeWindowListener } = makeInput(keybinds);

    expect(windowListeners.has('wheel')).toBe(false);
    expect(keybinds.bind('slot1', 0, 'WheelUp')).toBe(true);
    expect(addWindowListener).toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      expect.objectContaining({ capture: true, passive: false }),
    );
    expect(windowListeners.has('wheel')).toBe(true);

    keybinds.reset();
    expect(removeWindowListener).toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      expect.anything(),
    );
    expect(windowListeners.has('wheel')).toBe(false);
  });
});

describe('Input pointer keybind dispatch', () => {
  it('holds and releases a mouse-bound movement action', () => {
    const keybinds = new Keybinds();
    keybinds.bind('forward', 0, 'Mouse4');
    const { canvas, input, windowListeners } = makeInput(keybinds);

    windowListeners.get('mousedown')?.({
      button: 3,
      target: canvas,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
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
    const { windowListeners, callbacks } = makeInput(keybinds);
    const hudButton = {};

    windowListeners.get('mousedown')?.({
      button: 3,
      target: hudButton,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    expect(callbacks.onAbilityDown).toHaveBeenCalledWith(0);
    expect(callbacks.onAbilityUp).not.toHaveBeenCalled();

    windowListeners.get('pointerup')?.({
      type: 'pointerup',
      button: 3,
      target: hudButton,
      preventDefault: vi.fn(),
    });
    expect(callbacks.onAbilityUp).toHaveBeenCalledOnce();

    windowListeners.get('mouseup')?.({
      type: 'mouseup',
      button: 3,
      target: hudButton,
      preventDefault: vi.fn(),
    });
    expect(callbacks.onAbilityUp).toHaveBeenCalledOnce();
  });

  it('replaces a configured wheel listener with the capture listener while armed', () => {
    const keybinds = new Keybinds();
    keybinds.bind('slot1', 0, 'WheelUp');
    const { input, windowListeners, removeWindowListener, callbacks } = makeInput(keybinds);
    const captured = vi.fn();

    input.captureNextKey(captured);
    expect(removeWindowListener).toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      expect.anything(),
    );
    windowListeners.get('wheel')?.({
      deltaY: -100,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });

    expect(captured).toHaveBeenCalledWith('WheelUp');
    expect(callbacks.onAbilityDown).not.toHaveBeenCalled();
    expect(callbacks.onAbilityUp).not.toHaveBeenCalled();
  });

  it('lets an unbound primary button reach the canvas fallback', () => {
    const { canvas, canvasListeners, windowListeners } = makeInput();
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();
    const event = {
      button: 0,
      target: canvas,
      clientX: 10,
      clientY: 20,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault,
      stopPropagation,
    };

    windowListeners.get('mousedown')?.(event);
    if (stopPropagation.mock.calls.length === 0) canvasListeners.get('mousedown')?.(event);

    expect(stopPropagation).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('fires a wheel-bound action as a complete tap and suppresses camera zoom', () => {
    const keybinds = new Keybinds();
    keybinds.bind('slot1', 0, 'WheelUp');
    const { input, windowListeners, callbacks } = makeInput(keybinds);
    const start = input.camDist;
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    windowListeners.get('wheel')?.({
      deltaY: -100,
      target: {},
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault,
      stopPropagation,
    });

    expect(callbacks.onAbilityDown).toHaveBeenCalledWith(1);
    expect(callbacks.onAbilityUp).toHaveBeenCalledWith(1);
    expect(input.camDist).toBe(start);
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
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
