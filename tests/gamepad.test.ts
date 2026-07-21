import { afterEach, describe, expect, it, vi } from 'vitest';
import { type GamepadCallbacks, GamepadManager } from '../src/game/gamepad';
import { GamepadBindings } from '../src/game/gamepad_bindings';
import { GP, STANDARD_BUTTON_COUNT } from '../src/game/gamepad_map';
import type { Input } from '../src/game/input';

const originalNavigator = globalThis.navigator;

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
});

function gamepadWithPressed(...pressed: number[]): Gamepad {
  const pressedSet = new Set(pressed);
  return {
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: STANDARD_BUTTON_COUNT }, (_, index) => ({
      pressed: pressedSet.has(index),
      touched: pressedSet.has(index),
      value: pressedSet.has(index) ? 1 : 0,
    })),
    connected: true,
    id: 'test gamepad',
    index: 0,
    mapping: 'standard',
    timestamp: 0,
    vibrationActuator: null,
  } as unknown as Gamepad;
}

describe('GamepadManager', () => {
  it('reports each button rising edge once for the APM meter', () => {
    let pad = gamepadWithPressed();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { getGamepads: () => [pad] },
    });

    const onInputEdge = vi.fn();
    const input = {
      applyGamepadLook: vi.fn(),
      setGamepadMove: vi.fn(),
      triggerGamepadJump: vi.fn(),
    } as unknown as Input;
    const callbacks = {
      onAction: vi.fn(),
      onInputEdge,
      isPointerMode: () => false,
    } satisfies GamepadCallbacks;
    const manager = new GamepadManager(input, new GamepadBindings(), callbacks);
    (manager as unknown as { index: number | null }).index = 0;

    manager.poll(1 / 60);
    pad = gamepadWithPressed(GP.A);
    manager.poll(1 / 60);
    manager.poll(1 / 60);
    pad = gamepadWithPressed();
    manager.poll(1 / 60);
    pad = gamepadWithPressed(GP.A);
    manager.poll(1 / 60);

    expect(onInputEdge).toHaveBeenCalledTimes(2);
  });
});

describe('GamepadManager window focus', () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    let pad = gamepadWithPressed();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { getGamepads: () => [pad] },
    });
    const onInputEdge = vi.fn();
    const onAction = vi.fn();
    const setGamepadMove = vi.fn();
    const clearGamepadMove = vi.fn();
    const input = {
      applyGamepadLook: vi.fn(),
      setGamepadMove,
      clearGamepadMove,
      triggerGamepadJump: vi.fn(),
    } as unknown as Input;
    const callbacks = {
      onAction,
      onInputEdge,
      isPointerMode: () => false,
    } satisfies GamepadCallbacks;
    const manager = new GamepadManager(input, new GamepadBindings(), callbacks);
    (manager as unknown as { index: number | null }).index = 0;
    return {
      manager,
      onInputEdge,
      onAction,
      setGamepadMove,
      clearGamepadMove,
      setPad: (p: Gamepad) => {
        pad = p;
      },
    };
  }

  it('takes no pad input while the window is unfocused', () => {
    const { manager, onInputEdge, onAction, setGamepadMove, clearGamepadMove, setPad } = setup();
    vi.stubGlobal('document', { hasFocus: () => false });

    manager.poll(1 / 60);
    setPad(gamepadWithPressed(GP.A));
    manager.poll(1 / 60);

    expect(onInputEdge).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
    expect(setGamepadMove).not.toHaveBeenCalled();
    expect(clearGamepadMove).toHaveBeenCalled();
  });

  it('does not fire a stale edge for a button held across a refocus', () => {
    const { manager, onInputEdge, setPad } = setup();
    let focused = false;
    vi.stubGlobal('document', { hasFocus: () => focused });

    setPad(gamepadWithPressed(GP.A));
    manager.poll(1 / 60); // pressed while unfocused: consumed, never dispatched
    focused = true;
    manager.poll(1 / 60); // still held on refocus: no rising edge
    expect(onInputEdge).not.toHaveBeenCalled();

    setPad(gamepadWithPressed());
    manager.poll(1 / 60);
    setPad(gamepadWithPressed(GP.A));
    manager.poll(1 / 60); // a fresh press after the refocus dispatches normally
    expect(onInputEdge).toHaveBeenCalledTimes(1);
  });

  it('resumes movement and edges once the window regains focus', () => {
    const { manager, onInputEdge, setGamepadMove, setPad } = setup();
    let focused = false;
    vi.stubGlobal('document', { hasFocus: () => focused });

    manager.poll(1 / 60);
    focused = true;
    setPad(gamepadWithPressed(GP.A));
    manager.poll(1 / 60);

    expect(onInputEdge).toHaveBeenCalledTimes(1);
    expect(setGamepadMove).toHaveBeenCalled();
  });
});

function padWithId(id: string): Gamepad {
  return { ...gamepadWithPressed(), id } as unknown as Gamepad;
}

function stubInput(): Input {
  return {
    applyGamepadLook: vi.fn(),
    setGamepadMove: vi.fn(),
    triggerGamepadJump: vi.fn(),
    clearGamepadMove: vi.fn(),
    toggleAutorun: vi.fn(),
  } as unknown as Input;
}

describe('GamepadManager brand detection', () => {
  it('reports generic when no pad is connected', () => {
    const manager = new GamepadManager(stubInput(), new GamepadBindings(), {
      onAction: vi.fn(),
      onInputEdge: vi.fn(),
      isPointerMode: () => false,
    });
    expect(manager.getKind()).toBe('generic');
  });

  it('detects the brand of an already-connected pad on start() and notifies', () => {
    const pad = padWithId('DualSense Wireless Controller (Vendor: 054c Product: 0ce6)');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { getGamepads: () => [pad] },
    });
    // start() attaches window listeners; stub them so the Node env has no DOM.
    const originalWindow = (globalThis as { window?: unknown }).window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });

    const onConnectionChange = vi.fn();
    const manager = new GamepadManager(stubInput(), new GamepadBindings(), {
      onAction: vi.fn(),
      onInputEdge: vi.fn(),
      isPointerMode: () => false,
      onConnectionChange,
    });
    manager.start();

    expect(manager.getKind()).toBe('playstation');
    expect(onConnectionChange).toHaveBeenCalledTimes(1);

    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  });

  it('sets the kind on connect and resets it to generic on disconnect (both notify)', () => {
    const onConnectionChange = vi.fn();
    const manager = new GamepadManager(stubInput(), new GamepadBindings(), {
      onAction: vi.fn(),
      onInputEdge: vi.fn(),
      isPointerMode: () => false,
      onConnectionChange,
    });
    const pad = padWithId('Pro Controller (Vendor: 057e Product: 2009)');

    (manager as unknown as { onConnect(e: { gamepad: Gamepad }): void }).onConnect({
      gamepad: pad,
    });
    expect(manager.getKind()).toBe('nintendo');
    expect(manager.isConnected()).toBe(true);

    (manager as unknown as { onDisconnect(e: { gamepad: Gamepad }): void }).onDisconnect({
      gamepad: pad,
    });
    expect(manager.getKind()).toBe('generic');
    expect(manager.isConnected()).toBe(false);
    expect(onConnectionChange).toHaveBeenCalledTimes(2);
  });

  it('ignores a second pad connecting while one is already active (no hijack, no notify)', () => {
    const onConnectionChange = vi.fn();
    const manager = new GamepadManager(stubInput(), new GamepadBindings(), {
      onAction: vi.fn(),
      onInputEdge: vi.fn(),
      isPointerMode: () => false,
      onConnectionChange,
    });
    const mgr = manager as unknown as { onConnect(e: { gamepad: Gamepad }): void };
    const first = {
      ...padWithId('Xbox Wireless Controller (Vendor: 045e Product: 02fd)'),
      index: 0,
    };
    const second = {
      ...padWithId('DualSense Wireless Controller (Vendor: 054c Product: 0ce6)'),
      index: 1,
    };
    mgr.onConnect({ gamepad: first as Gamepad });
    expect(manager.getKind()).toBe('xbox');
    onConnectionChange.mockClear();
    mgr.onConnect({ gamepad: second as Gamepad });
    // The active pad and its brand are unchanged, and no re-label fires.
    expect(manager.getKind()).toBe('xbox');
    expect(onConnectionChange).not.toHaveBeenCalled();
  });

  it('ignores a non-active pad disconnecting (kind + notify untouched)', () => {
    const onConnectionChange = vi.fn();
    const manager = new GamepadManager(stubInput(), new GamepadBindings(), {
      onAction: vi.fn(),
      onInputEdge: vi.fn(),
      isPointerMode: () => false,
      onConnectionChange,
    });
    const mgr = manager as unknown as {
      onConnect(e: { gamepad: Gamepad }): void;
      onDisconnect(e: { gamepad: Gamepad }): void;
    };
    const active = {
      ...padWithId('Xbox Wireless Controller (Vendor: 045e Product: 02fd)'),
      index: 0,
    };
    mgr.onConnect({ gamepad: active as Gamepad });
    onConnectionChange.mockClear();
    const other = { ...padWithId('DualSense Wireless Controller'), index: 3 };
    mgr.onDisconnect({ gamepad: other as Gamepad });
    expect(manager.getKind()).toBe('xbox');
    expect(manager.isConnected()).toBe(true);
    expect(onConnectionChange).not.toHaveBeenCalled();
  });

  it('resets the detected kind to generic on stop()', () => {
    const pad = padWithId('Xbox Wireless Controller (Vendor: 045e Product: 02fd)');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { getGamepads: () => [pad] },
    });
    const originalWindow = (globalThis as { window?: unknown }).window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });

    const manager = new GamepadManager(stubInput(), new GamepadBindings(), {
      onAction: vi.fn(),
      onInputEdge: vi.fn(),
      isPointerMode: () => false,
    });
    manager.start();
    expect(manager.getKind()).toBe('xbox');
    manager.stop();
    expect(manager.getKind()).toBe('generic');

    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  });
});
