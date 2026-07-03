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
