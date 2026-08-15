import { afterEach, describe, expect, it, vi } from 'vitest';
import { type GamepadCallbacks, GamepadManager } from '../src/game/gamepad';
import { GamepadBindings } from '../src/game/gamepad_bindings';
import {
  GAMEPAD_ZOOM_IN,
  GAMEPAD_ZOOM_OUT,
  GAMEPAD_ZOOM_STEP,
  GP,
  STANDARD_BUTTON_COUNT,
} from '../src/game/gamepad_map';
import { Input, type InputCallbacks } from '../src/game/input';
import { Keybinds } from '../src/game/keybinds';

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
      setGamepadLookActive: vi.fn(),
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

// Camera zoom has no free default slot (all 13 bindable buttons are already
// claimed), so it is a pad-only, opt-in action a player rebinds explicitly.
// GamepadManager.dispatch() must resolve it straight against Input.zoomBy
// rather than the host's onAction callback (there is no keybind for zoom).
describe('GamepadManager zoom dispatch', () => {
  function setupZoom(action: string) {
    let pad = gamepadWithPressed();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { getGamepads: () => [pad] },
    });
    const zoomBy = vi.fn();
    const onAction = vi.fn();
    const input = {
      applyGamepadLook: vi.fn(),
      setGamepadLookActive: vi.fn(),
      setGamepadMove: vi.fn(),
      triggerGamepadJump: vi.fn(),
      zoomBy,
    } as unknown as Input;
    const bindings = new GamepadBindings();
    bindings.bind(GP.A, action);
    const callbacks = {
      onAction,
      onInputEdge: vi.fn(),
      isPointerMode: () => false,
    } satisfies GamepadCallbacks;
    const manager = new GamepadManager(input, bindings, callbacks);
    (manager as unknown as { index: number | null }).index = 0;
    return {
      manager,
      zoomBy,
      onAction,
      setPad: (p: Gamepad) => {
        pad = p;
      },
    };
  }

  it('zoomIn pulls the camera closer by the wheel step, never reaching onAction', () => {
    const { manager, zoomBy, onAction, setPad } = setupZoom(GAMEPAD_ZOOM_IN);
    manager.poll(1 / 60);
    setPad(gamepadWithPressed(GP.A));
    manager.poll(1 / 60);
    expect(zoomBy).toHaveBeenCalledExactlyOnceWith(-GAMEPAD_ZOOM_STEP);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('zoomOut pushes the camera away by the same magnitude', () => {
    const { manager, zoomBy, onAction, setPad } = setupZoom(GAMEPAD_ZOOM_OUT);
    manager.poll(1 / 60);
    setPad(gamepadWithPressed(GP.A));
    manager.poll(1 / 60);
    expect(zoomBy).toHaveBeenCalledExactlyOnceWith(GAMEPAD_ZOOM_STEP);
    expect(onAction).not.toHaveBeenCalled();
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
      setGamepadLookActive: vi.fn(),
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
    setGamepadLookActive: vi.fn(),
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

// Regression coverage for the bug where right-stick look only ever orbited the
// free camera: it never set any "look active" signal, so Input.isMouselookActive()
// stayed false for gamepad input and gameplay facing (main.ts's
// `mouselook ? input.camYaw : null`) was never derived from the stick, freezing
// the character's heading for a controller-only player. These tests use a real
// Input (not a mock), since the bug is in the real isMouselookActive() contract,
// not just in whether GamepadManager calls a method.
describe('GamepadManager right-stick turning', () => {
  function inputCallbacks(): InputCallbacks {
    return {
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
    } as unknown as InputCallbacks;
  }

  // Builds a real Input + GamepadManager pair behind the minimal DOM stubs the
  // Input constructor touches (window/document/canvas), mirroring the pattern
  // already used above for brand detection, and restores the globals after.
  function withRealInput(
    run: (input: Input, manager: GamepadManager, setPad: (p: Gamepad) => void) => void,
  ): void {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalDocument = (globalThis as { document?: unknown }).document;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        innerWidth: 1920,
        innerHeight: 1080,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        activeElement: null,
        body: { classList: { contains: () => false } },
        pointerLockElement: null,
        hidden: false,
        hasFocus: () => true,
        addEventListener: vi.fn(),
        exitPointerLock: vi.fn(),
      },
    });
    let pad = gamepadWithPressed();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { getGamepads: () => [pad] },
    });
    const canvas = {
      style: { cursor: '' },
      addEventListener: vi.fn(),
      requestPointerLock: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const input = new Input(canvas, inputCallbacks(), new Keybinds());
    const manager = new GamepadManager(input, new GamepadBindings(), {
      onAction: vi.fn(),
      onInputEdge: vi.fn(),
      isPointerMode: () => false,
    });
    (manager as unknown as { index: number | null }).index = 0;
    try {
      run(input, manager, (p) => {
        pad = p;
      });
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
    }
  }

  function padWithRightStick(x: number, y = 0): Gamepad {
    return { ...gamepadWithPressed(), axes: [0, 0, x, y] } as unknown as Gamepad;
  }

  it('is not mouselook-active while the right stick sits centered', () => {
    withRealInput((input, manager) => {
      manager.poll(1 / 60);
      expect(input.isMouselookActive()).toBe(false);
    });
  });

  it('drives player facing when the right stick is pushed sideways', () => {
    withRealInput((input, manager, setPad) => {
      const before = input.camYaw;
      setPad(padWithRightStick(0.8, 0));
      manager.poll(1 / 60);

      // Before the fix: isMouselookActive() stayed false for gamepad input, so
      // main.ts never adopted camYaw as the player's facing no matter how far
      // the stick was pushed. camYaw itself already moved (the pre-existing
      // free-camera orbit), which is exactly why this bug was easy to miss:
      // the camera visibly turns, but the character never does.
      expect(input.camYaw).not.toBe(before);
      expect(input.isMouselookActive()).toBe(true);

      // What main.ts's resolveMove()/renderFacingOverride() do with this state:
      // while mouselook is active, gameplay facing tracks camYaw exactly.
      const mouselook = input.isMouselookActive();
      const facing: number | null = mouselook ? input.camYaw : null;
      expect(facing).toBe(input.camYaw);
    });
  });

  it('releases mouselook once the stick returns to center (no stuck turn)', () => {
    withRealInput((input, manager, setPad) => {
      setPad(padWithRightStick(0.8, 0));
      manager.poll(1 / 60);
      expect(input.isMouselookActive()).toBe(true);

      setPad(gamepadWithPressed());
      manager.poll(1 / 60);
      expect(input.isMouselookActive()).toBe(false);
    });
  });
});
