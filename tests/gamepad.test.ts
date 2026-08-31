import { afterEach, describe, expect, it, vi } from 'vitest';
import { CROSS_HOTBAR_EXPANDED_SET, CROSS_HOTBAR_PRIMARY_SET } from '../src/game/cross_hotbar';
import { CrossHotbarBindings } from '../src/game/cross_hotbar_bindings';
import {
  cancelPadFocus,
  clearPadFocus,
  hasPadFocus,
  moveDpadFocus,
  setPadNavSpansWindows,
  syncStandalonePadFocus,
} from '../src/game/dpad_focus_nav';
import { type GamepadCallbacks, GamepadManager } from '../src/game/gamepad';
import { GamepadBindings } from '../src/game/gamepad_bindings';
import {
  AXIS,
  applyRadialDeadzone,
  GAMEPAD_CANCEL,
  GAMEPAD_CONFIRM,
  GAMEPAD_ZOOM_IN,
  GAMEPAD_ZOOM_OUT,
  GAMEPAD_ZOOM_STEP,
  GP,
  STANDARD_BUTTON_COUNT,
} from '../src/game/gamepad_map';
import { Input, type InputCallbacks } from '../src/game/input';
import { markPadActivity } from '../src/game/input_hint_mode';
import { Keybinds } from '../src/game/keybinds';

// Every export still runs for real; three are wrapped because the module keeps the
// state behind them private: the whole-screen d-pad switch (leaving it on is exactly
// what a missing arrange-mode teardown looks like), and the pad's HUD selection,
// which has no DOM to hold it in this env.
vi.mock('../src/game/dpad_focus_nav', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/game/dpad_focus_nav')>();
  return {
    ...actual,
    cancelPadFocus: vi.fn(actual.cancelPadFocus),
    moveDpadFocus: vi.fn(actual.moveDpadFocus),
    setPadNavSpansWindows: vi.fn(actual.setPadNavSpansWindows),
    clearPadFocus: vi.fn(actual.clearPadFocus),
    hasPadFocus: vi.fn(actual.hasPadFocus),
    syncStandalonePadFocus: vi.fn(actual.syncStandalonePadFocus),
  };
});

vi.mock('../src/game/input_hint_mode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/game/input_hint_mode')>();
  return { ...actual, markPadActivity: vi.fn(actual.markPadActivity) };
});

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
    const onCastRelease = vi.fn();
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
      onCastRelease,
      onInputEdge,
      isPointerMode: () => false,
    } satisfies GamepadCallbacks;
    const bindings = new GamepadBindings();
    const manager = new GamepadManager(input, bindings, callbacks);
    (manager as unknown as { index: number | null }).index = 0;
    return {
      manager,
      bindings,
      onInputEdge,
      onAction,
      onCastRelease,
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

  it('releases a held cast when the window loses focus', () => {
    const { manager, bindings, onCastRelease, setPad } = setup();
    let focused = true;
    vi.stubGlobal('document', { hasFocus: () => focused });
    bindings.bind(GP.A, 'slot6');

    manager.poll(1 / 60);
    setPad(gamepadWithPressed(GP.A));
    manager.poll(1 / 60);
    focused = false;
    manager.poll(1 / 60);

    expect(onCastRelease).toHaveBeenCalledExactlyOnceWith({ kind: 'slot', slot: 6 });
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

  it('uses a live glyph override and returns to automatic detection when cleared', () => {
    const onConnectionChange = vi.fn();
    const manager = new GamepadManager(stubInput(), new GamepadBindings(), {
      onAction: vi.fn(),
      onInputEdge: vi.fn(),
      isPointerMode: () => false,
      onConnectionChange,
    });
    (manager as unknown as { onConnect(e: { gamepad: Gamepad }): void }).onConnect({
      gamepad: padWithId('DualSense Wireless Controller (Vendor: 054c Product: 0ce6)'),
    });
    onConnectionChange.mockClear();

    manager.setKindOverride('xbox');
    expect(manager.getKind()).toBe('xbox');
    expect(onConnectionChange).toHaveBeenCalledTimes(1);

    manager.setKindOverride('xbox');
    expect(onConnectionChange).toHaveBeenCalledTimes(1);

    manager.setKindOverride(null);
    expect(manager.getKind()).toBe('playstation');
    expect(onConnectionChange).toHaveBeenCalledTimes(2);
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

  it('reclassifies an active pad when its id becomes informative on a later poll', () => {
    let pad = padWithId('');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { getGamepads: () => [pad] },
    });

    const onConnectionChange = vi.fn();
    const manager = new GamepadManager(stubInput(), new GamepadBindings(), {
      onAction: vi.fn(),
      onInputEdge: vi.fn(),
      isPointerMode: () => false,
      onConnectionChange,
    });
    (manager as unknown as { index: number | null }).index = 0;

    manager.poll(1 / 60);
    expect(manager.getKind()).toBe('generic');
    expect(onConnectionChange).not.toHaveBeenCalled();

    pad = padWithId('Xbox Wireless Controller (Vendor: 045e Product: 02fd)');
    manager.poll(1 / 60);
    manager.poll(1 / 60);

    expect(manager.getKind()).toBe('xbox');
    expect(onConnectionChange).toHaveBeenCalledTimes(1);
  });

  it('does not repaint labels for late detection while an override owns the glyph family', () => {
    let pad = padWithId('');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { getGamepads: () => [pad] },
    });
    const onConnectionChange = vi.fn();
    const manager = new GamepadManager(stubInput(), new GamepadBindings(), {
      onAction: vi.fn(),
      onInputEdge: vi.fn(),
      isPointerMode: () => false,
      onConnectionChange,
    });
    (manager as unknown as { index: number | null }).index = 0;
    manager.setKindOverride('xbox');
    onConnectionChange.mockClear();

    pad = padWithId('DualSense Wireless Controller (Vendor: 054c Product: 0ce6)');
    manager.poll(1 / 60);

    expect(manager.getKind()).toBe('xbox');
    expect(onConnectionChange).not.toHaveBeenCalled();
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

// The desktop shell cannot see gamepad input: a pad is polled inside the
// renderer and never reaches the window as an OS event, so a pad-only session
// looks idle to the machine and the display can sleep mid-fight. The poll
// therefore says so out loud, but ONLY on real input: firing for a connected
// but motionless pad would defeat every idle timer on the machine for as long
// as a pad is plugged in.
describe('GamepadManager: onActivity', () => {
  function padWith(pressed: number[] = [], axes: number[] = [0, 0, 0, 0]): Gamepad {
    const pad = gamepadWithPressed(...pressed);
    (pad as unknown as { axes: number[] }).axes = axes;
    return pad;
  }

  function rig(pointerMode = false) {
    const onActivity = vi.fn();
    const input = {
      applyGamepadLook: vi.fn(),
      clearGamepadMove: vi.fn(),
      setGamepadLookActive: vi.fn(),
      setGamepadMove: vi.fn(),
      triggerGamepadJump: vi.fn(),
    } as unknown as Input;
    const callbacks = {
      onAction: vi.fn(),
      onInputEdge: vi.fn(),
      isPointerMode: () => pointerMode,
      onActivity,
    } satisfies GamepadCallbacks;
    const manager = new GamepadManager(input, new GamepadBindings(), callbacks);
    (manager as unknown as { index: number | null }).index = 0;
    return { manager, onActivity };
  }

  function stubPad(pad: Gamepad): void {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { getGamepads: () => [pad] },
    });
  }

  const stickAxes = (axis: number, value: number): number[] => {
    const axes = [0, 0, 0, 0];
    axes[axis] = value;
    return axes;
  };

  // This suite runs in the node environment (no DOM), but the pointer-mode
  // cursor and the focus gate both read one. The stub is exactly the surface
  // the manager touches, and the teardown puts the globals back so the DOM-free
  // tests around it keep running DOM-free.
  function installDocumentStub(focused: boolean): () => void {
    const makeEl = () => ({
      className: '',
      style: {} as Record<string, string>,
      setAttribute: () => {},
      appendChild: () => {},
      remove: () => {},
    });
    const hadDocument = 'document' in globalThis;
    const hadWindow = 'window' in globalThis;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: makeEl,
        body: makeEl(),
        hasFocus: () => focused,
        // UI navigation queries these; an empty HUD is the right shape here (the
        // cases care about the activity signal, not about what gets focused).
        querySelectorAll: () => [],
        activeElement: null,
      },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { innerWidth: 1280, innerHeight: 720 },
    });
    return () => {
      if (!hadDocument) Reflect.deleteProperty(globalThis, 'document');
      if (!hadWindow) Reflect.deleteProperty(globalThis, 'window');
    };
  }

  it('fires on a button edge alone (no stick moved at all)', () => {
    stubPad(padWith([GP.A]));
    const { manager, onActivity } = rig();
    manager.poll(1 / 60);
    expect(onActivity).toHaveBeenCalledTimes(1);
  });

  it('fires on left-stick movement alone (no button pressed)', () => {
    stubPad(padWith([], stickAxes(AXIS.LEFT_Y, -1)));
    const { manager, onActivity } = rig();
    manager.poll(1 / 60);
    expect(onActivity).toHaveBeenCalledTimes(1);
  });

  it('fires on right-stick look alone (camera-only, the classic idle-timeout case)', () => {
    stubPad(padWith([], stickAxes(AXIS.RIGHT_X, 1)));
    const { manager, onActivity } = rig();
    manager.poll(1 / 60);
    expect(onActivity).toHaveBeenCalledTimes(1);
  });

  it('fires on each remaining movement direction alone (every flag feeds the predicate)', () => {
    // Per-arm coverage: one axis, one direction, no buttons, so a flag dropped
    // from the `acted` OR cannot hide behind a sibling arm or a button edge.
    const arms: Array<[string, number, number]> = [
      ['back', AXIS.LEFT_Y, 1],
      ['strafe left', AXIS.LEFT_X, -1],
      ['strafe right', AXIS.LEFT_X, 1],
    ];
    for (const [label, axis, value] of arms) {
      stubPad(padWith([], stickAxes(axis, value)));
      const { manager, onActivity } = rig();
      manager.poll(1 / 60);
      expect(onActivity, `${label} alone must count as activity`).toHaveBeenCalledTimes(1);
    }
  });

  it('fires on a UI navigation step while a window is open', () => {
    // UI navigation returns before the movement/look arms, so it needs its own
    // signal: a player stepping through the bags with the d-pad is still present.
    // The STICK no longer counts here: it drives no cursor since the software
    // pointer was removed (navigation is focus-driven), so only a real d-pad or
    // button edge is activity.
    const restore = installDocumentStub(true);
    try {
      stubPad(padWith([GP.DPAD_DOWN]));
      const { manager, onActivity } = rig(true);
      manager.poll(1 / 60);
      expect(onActivity).toHaveBeenCalledTimes(1);
      // A still pad in the same mode is silent.
      stubPad(padWith());
      const idle = rig(true);
      idle.manager.poll(1 / 60);
      expect(idle.onActivity).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('does not count a deflected stick as activity while navigating the UI', () => {
    // The software cursor is gone, so a stick push in UI navigation genuinely
    // does nothing and must not report the player as present.
    const restore = installDocumentStub(true);
    try {
      stubPad(padWith([], stickAxes(AXIS.LEFT_X, 1)));
      const { manager, onActivity } = rig(true);
      manager.poll(1 / 60);
      expect(onActivity).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('fires AT MOST once per poll, however much happened that frame', () => {
    // Several edges plus both sticks in one frame is one notify, not five: the
    // shell only needs to hear that the player is there.
    stubPad(padWith([GP.A, GP.B, GP.X], [1, -1, 1, -1]));
    const { manager, onActivity } = rig();
    manager.poll(1 / 60);
    expect(onActivity).toHaveBeenCalledTimes(1);
  });

  it('stays silent for a connected pad nobody is touching', () => {
    // Connection alone is not activity: this is the state a pad sits in for
    // hours while its owner reads a quest log or walks away.
    stubPad(padWith());
    const { manager, onActivity } = rig();
    for (let i = 0; i < 5; i++) manager.poll(1 / 60);
    expect(onActivity).not.toHaveBeenCalled();
  });

  it('stays silent for a held-still button after its edge frame', () => {
    const pad = padWith([GP.A]);
    stubPad(pad);
    const { manager, onActivity } = rig();
    manager.poll(1 / 60);
    expect(onActivity).toHaveBeenCalledTimes(1);
    // the same button still down: no new edge, no new activity
    manager.poll(1 / 60);
    manager.poll(1 / 60);
    expect(onActivity).toHaveBeenCalledTimes(1);
  });

  it('stays silent while the window is unfocused, in both poll modes', () => {
    // The focus gate returns before every dispatch, so it must suppress this
    // for free: a background window is not the window the OS should stay awake
    // for, and pad state is consumed there without firing anything.
    const restore = installDocumentStub(false);
    try {
      for (const pointerMode of [false, true]) {
        stubPad(padWith([GP.A], [1, -1, 1, -1]));
        const { manager, onActivity } = rig(pointerMode);
        manager.poll(1 / 60);
        manager.poll(1 / 60);
        expect(onActivity, `pointerMode=${pointerMode}`).not.toHaveBeenCalled();
      }
    } finally {
      restore();
    }
  });

  it('drives the poll with no notifier at all (the callback is optional)', () => {
    // main.ts on the web build hands the manager a no-op notifier, but the
    // callback itself is optional and every other host (tests, the editor)
    // omits it: the poll must not depend on it existing.
    stubPad(padWith([GP.A], [1, -1, 0, 0]));
    const input = {
      applyGamepadLook: vi.fn(),
      clearGamepadMove: vi.fn(),
      setGamepadLookActive: vi.fn(),
      setGamepadMove: vi.fn(),
      triggerGamepadJump: vi.fn(),
    } as unknown as Input;
    const manager = new GamepadManager(input, new GamepadBindings(), {
      onAction: vi.fn(),
      onInputEdge: vi.fn(),
      isPointerMode: () => false,
    } satisfies GamepadCallbacks);
    (manager as unknown as { index: number | null }).index = 0;
    expect(() => manager.poll(1 / 60)).not.toThrow();
  });
});

// The cross hotbar turns the two triggers into modifiers: holding one lights
// eight slots (the d-pad and face diamonds), and those presses cast action-bar
// slots instead of the buttons' own flat bindings. With the setting off, every
// button must behave exactly as it did before the cross hotbar existed.
describe('GamepadManager cross hotbar', () => {
  // Own the DOM globals poll() and stop() read (the focus gate and the connect
  // listeners), the same way withRealInput above does, so these cases do not
  // inherit whatever an earlier suite left on globalThis.
  afterEach(() => vi.unstubAllGlobals());

  // The per-character storage namespace, matching the other cross-hotbar suites.
  const CROSS_HOTBAR_SCOPE = 'char:test';

  function setupCrossHotbar(enabled: boolean) {
    let windowFocused = true;
    vi.stubGlobal('document', {
      hasFocus: () => windowFocused,
      // Cursor mode builds the virtual pointer element on entry.
      createElement: () => ({ className: '', style: {}, setAttribute: vi.fn() }),
      body: { appendChild: vi.fn() },
      // UI navigation queries these; an empty HUD means every move falls back to
      // nudging the cursor, which is the behaviour these cases care about.
      querySelectorAll: () => [],
      activeElement: null,
    });
    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible', display: 'block' }));
    // Kept by reference so a case can deliver a real pad event through whatever
    // start() registered, instead of reaching for the private handler.
    const windowStub = {
      innerWidth: 1920,
      innerHeight: 1080,
      addEventListener: vi.fn<(type: string, handler: unknown) => void>(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('window', windowStub);
    let pad = gamepadWithPressed();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { getGamepads: () => [pad] },
    });
    const onAction = vi.fn();
    const onConnectionChange = vi.fn();
    const onCrossHotbar = vi.fn();
    const onCrossHotbarCast = vi.fn();
    const onCastRelease = vi.fn();
    const onCrossHotbarEdit = vi.fn();
    const onOpenSpellbook = vi.fn();
    const onInputEdge = vi.fn();
    const onGroundAimStick = vi.fn();
    const onGroundAimCommit = vi.fn();
    const onGroundAimSnap = vi.fn();
    const cancelGroundAim = vi.fn();
    // Which cell the bar reports as focused, driven per case; null is "focus is
    // somewhere else", which arranging must ignore.
    let focusedCell: number | null = null;
    const triggerGamepadJump = vi.fn();
    let groundAimActive = false;
    const input = {
      applyGamepadLook: vi.fn(),
      setGamepadLookActive: vi.fn(),
      setGamepadMove: vi.fn(),
      clearGamepadMove: vi.fn(),
      triggerGamepadJump,
      toggleAutorun: vi.fn(),
      setAutorun: vi.fn(),
      zoomBy: vi.fn(),
    } as unknown as Input & Record<string, ReturnType<typeof vi.fn>>;
    let pointerMode = false;
    const bindings = new GamepadBindings();
    const manager = new GamepadManager(input, bindings, {
      onAction,
      onInputEdge,
      isPointerMode: () => pointerMode,
      isGroundAimActive: () => groundAimActive,
      onGroundAimStick,
      onGroundAimCommit,
      onGroundAimSnap,
      cancelGroundAim,
      onConnectionChange,
      onCrossHotbar,
      onCrossHotbarCast,
      onCastRelease,
      onCrossHotbarEdit,
      onOpenSpellbook,
      focusedCrossHotbarCell: () => focusedCell,
    } satisfies GamepadCallbacks);
    const xhb = new CrossHotbarBindings(CROSS_HOTBAR_SCOPE);
    // Seed a known bar so a cell's action is predictable: cell N holds ability aN.
    // Reset first: seedOnce is a no-op on an already-seeded bar, and this Node has
    // a real localStorage, so a layout persisted by an earlier case would survive.
    xhb.reset();
    xhb.seedOnce(Array.from({ length: 32 }, (_, i) => ({ type: 'ability' as const, id: `a${i}` })));
    manager.setCrossHotbarBindings(xhb);
    (manager as unknown as { index: number | null }).index = 0;
    manager.setCrossHotbar(enabled);
    return {
      manager,
      bindings,
      xhb,
      input,
      onAction,
      onConnectionChange,
      onCrossHotbarCast,
      onCastRelease,
      onCrossHotbar,
      onCrossHotbarEdit,
      onOpenSpellbook,
      onInputEdge,
      onGroundAimStick,
      onGroundAimCommit,
      onGroundAimSnap,
      cancelGroundAim,
      triggerGamepadJump,
      focus: (cell: number | null) => {
        focusedCell = cell;
      },
      // Put a spellbook row under focus. Draggable because that is the flag the
      // spellbook sets once isAbilityActionBarEligible has passed.
      focusSpell: (abilityId: string | null) => {
        if (abilityId === null) {
          Reflect.deleteProperty(globalThis, 'document');
          return;
        }
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: {
            activeElement: {
              draggable: true,
              getAttribute: (name: string) => (name === 'data-ability-id' ? abilityId : null),
            },
            // The focus stepper runs on the same press; it finds nothing to move to.
            querySelectorAll: () => [],
          },
        });
      },
      press: (...buttons: number[]) => {
        pad = gamepadWithPressed(...buttons);
        manager.poll(1 / 60);
      },
      // One idle poll of an arbitrary length, for the time-based paths.
      poll: (dt: number) => {
        pad = gamepadWithPressed();
        manager.poll(dt);
      },
      setWindowFocused: (on: boolean) => {
        windowFocused = on;
      },
      // Push the left stick past the deadzone for one poll.
      move: () => {
        pad = gamepadWithPressed();
        (pad as unknown as { axes: number[] }).axes = [0, -1, 0, 0];
        manager.poll(1 / 60);
      },
      setPointerMode: (on: boolean) => {
        pointerMode = on;
      },
      setGroundAimActive: (on: boolean) => {
        groundAimActive = on;
      },
      setAxes: (axes: number[]) => {
        pad = gamepadWithPressed();
        (pad as unknown as { axes: number[] }).axes = axes;
      },
      // Unplug a pad the way the browser reports it: through the listener start()
      // put on window, so a case cannot pass against a handler nothing wires up.
      // Throws if start() was never called, which is the honest failure.
      disconnectPad: (padIndex: number) => {
        const registered = windowStub.addEventListener.mock.calls.find(
          ([type]) => type === 'gamepaddisconnected',
        );
        const handler = registered?.[1] as (e: { gamepad: { index: number } }) => void;
        handler({ gamepad: { index: padIndex } });
      },
    };
  }

  it('casts the action on the cell for a left-trigger d-pad press', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.LT);
    h.press(GP.LT, GP.DPAD_UP);
    // D-pad up is the first cell of the left half.
    expect(h.onCrossHotbarCast).toHaveBeenCalledWith({ type: 'ability', id: 'a0' });
    // The bar owns its actions, so nothing goes out as an action-bar slot.
    expect(h.onAction).not.toHaveBeenCalled();
  });

  it('releases a cross hotbar cast with the press-time action', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.RT);
    h.press(GP.RT, GP.A);
    const action = h.onCrossHotbarCast.mock.calls[0]?.[0];
    h.press(GP.RT);

    expect(h.onCastRelease).toHaveBeenCalledExactlyOnceWith({ kind: 'xhb', action });
    expect(h.onCastRelease.mock.calls[0]?.[0].action).toBe(action);
  });

  it('keeps the press-time action after its trigger is released first', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.RT);
    h.press(GP.RT, GP.A);
    const action = h.onCrossHotbarCast.mock.calls[0]?.[0];
    h.press(GP.A);
    expect(h.onCastRelease).not.toHaveBeenCalled();
    h.press();

    expect(h.onCastRelease).toHaveBeenCalledExactlyOnceWith({ kind: 'xhb', action });
  });

  it('ignores a falling edge without a recorded cast', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.Y);
    h.press();

    expect(h.onCastRelease).not.toHaveBeenCalled();
  });

  it('releases a flat slot binding when the cross hotbar is off', () => {
    const h = setupCrossHotbar(false);
    h.bindings.bind(GP.DPAD_UP, 'slot5');
    h.press(GP.DPAD_UP);
    h.press();

    expect(h.onAction).toHaveBeenCalledWith('slot5');
    expect(h.onCastRelease).toHaveBeenCalledExactlyOnceWith({ kind: 'slot', slot: 5 });
  });

  it('releases a held cast when pointer mode takes the pad', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.RT);
    h.press(GP.RT, GP.A);
    const action = h.onCrossHotbarCast.mock.calls[0]?.[0];
    h.setPointerMode(true);
    h.press(GP.RT, GP.A);

    expect(h.onCastRelease).toHaveBeenCalledExactlyOnceWith({ kind: 'xhb', action });
  });

  it('releases all held casts in press order when the active pad disappears', () => {
    const h = setupCrossHotbar(true);
    h.manager.start();
    h.press(GP.RT);
    h.press(GP.RT, GP.A);
    h.press(GP.RT, GP.A, GP.X);
    const actions = h.onCrossHotbarCast.mock.calls.map(([action]) => action);
    h.disconnectPad(0);
    h.press();
    h.press();

    expect(h.onCastRelease.mock.calls.map(([hold]) => hold)).toEqual([
      { kind: 'xhb', action: actions[0] },
      { kind: 'xhb', action: actions[1] },
    ]);
  });

  it('releases a held cast when the virtual mouse takes the pad', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.RT);
    h.press(GP.RT, GP.A);
    const action = h.onCrossHotbarCast.mock.calls[0]?.[0];
    h.press(GP.RT, GP.A, GP.LB);
    h.press(GP.RT, GP.A, GP.LB, GP.R3);
    h.press(GP.RT, GP.A, GP.LB, GP.R3);

    expect(h.onCastRelease).toHaveBeenCalledExactlyOnceWith({ kind: 'xhb', action });
  });

  it('reaches the second eight through the right trigger', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.RT);
    h.press(GP.RT, GP.A);
    expect(h.onCrossHotbarCast).toHaveBeenCalledWith({ type: 'ability', id: 'a15' });
  });

  it('resolves a trigger and a button pressed in the same poll', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.LT, GP.DPAD_UP);
    expect(h.onCrossHotbarCast).toHaveBeenCalledWith({ type: 'ability', id: 'a0' });
  });

  it('never fires a trigger own flat binding while the cross hotbar is on', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.LT);
    h.press(GP.RT);
    // The default flat layout puts slot4 on LT and slot3 on RT.
    expect(h.onAction).not.toHaveBeenCalledWith('slot4');
    expect(h.onAction).not.toHaveBeenCalledWith('slot3');
  });

  it('swaps to the second set when the opposite trigger is tapped', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.LT);
    h.press(GP.LT, GP.RT);
    h.press(GP.LT);
    h.press(GP.LT, GP.DPAD_UP);
    expect(h.onCrossHotbarCast).toHaveBeenCalledWith({ type: 'ability', id: 'a16' });
    expect(h.onCrossHotbarCast).not.toHaveBeenCalledWith({ type: 'ability', id: 'a0' });
  });

  it('stays on the primary set when the double bar is switched off', () => {
    const h = setupCrossHotbar(true);
    h.manager.setCrossHotbarExpand(false);
    h.press(GP.LT);
    h.press(GP.LT, GP.RT);
    h.press(GP.LT);
    h.press(GP.LT, GP.DPAD_UP);
    expect(h.onCrossHotbarCast).toHaveBeenCalledWith({ type: 'ability', id: 'a0' });
    expect(h.onCrossHotbarCast).not.toHaveBeenCalledWith({ type: 'ability', id: 'a16' });
  });

  it('fires no action-bar slot from any button while the bar is on', () => {
    // Not just the diamond: the bumpers carried slot1 and slot2, so reaching for
    // one as a modifier cast a spell on the way in. With the bar on it owns every
    // ability, and the whole set is one trigger away.
    const h = setupCrossHotbar(true);
    h.press(GP.LB);
    h.press();
    h.press(GP.RB);
    expect(h.onAction).not.toHaveBeenCalledWith('slot2');
    expect(h.onAction).not.toHaveBeenCalledWith('slot1');
  });

  it('keeps a non-slot binding on a button the bar does not claim', () => {
    // The rule is about action-bar slots specifically: a system verb still fires,
    // or turning the bar on would silently disarm half the pad.
    const h = setupCrossHotbar(true);
    h.bindings.bind(GP.LB, 'map');
    h.press(GP.LB);
    expect(h.onAction).toHaveBeenCalledWith('map');
  });

  it('toggles the virtual mouse on LB + right-stick-click, either order', () => {
    // FFXIV's own chord. Order-independent so a player cannot half-press it.
    const h = setupCrossHotbar(true);
    const mode = () => (h.manager as unknown as { mouseMode: boolean }).mouseMode;
    h.press(GP.LB);
    h.press(GP.LB, GP.R3);
    expect(mode()).toBe(true);
    h.press();
    // and back off, pressed the other way round
    h.press(GP.R3);
    h.press(GP.R3, GP.LB);
    expect(mode()).toBe(false);
  });

  it('gives the triggers to the pointer in mouse mode, not the cross hotbar', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.LB);
    h.press(GP.LB, GP.R3); // mouse mode on
    h.press();
    h.press(GP.LT);
    // LT is a click now, so the cross hotbar must never report an armed half.
    const armed = h.onCrossHotbar.mock.calls.filter((c: unknown[]) => c[0] !== null);
    expect(armed).toEqual([]);
  });

  it('stops driving the world while the pointer owns the pad', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.LB);
    h.press(GP.LB, GP.R3);
    (h.input.setGamepadMove as ReturnType<typeof vi.fn>).mockClear();
    h.press();
    expect(h.input.clearGamepadMove).toHaveBeenCalled();
    expect(h.input.setGamepadMove).not.toHaveBeenCalled();
  });

  it('navigates the HUD WITHOUT taking the world away', () => {
    // The d-pad steps through menus while the character keeps playing: movement
    // and the camera must still be driven on the very same poll. An earlier
    // version suspended the world whenever the d-pad was used, which meant a
    // player could not walk and read a window at the same time.
    const h = setupCrossHotbar(true);
    h.press(GP.DPAD_UP);
    expect(h.input.setGamepadMove).toHaveBeenCalled();
    expect(h.input.applyGamepadLook).toHaveBeenCalled();
    expect(h.input.clearGamepadMove).not.toHaveBeenCalled();
  });

  it('leaves a d-pad press alone while a trigger is held (that is the hotbar)', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.LT);
    h.press(GP.LT, GP.DPAD_UP);
    // The cross hotbar took it: the first cell of the left half.
    expect(h.onCrossHotbarCast).toHaveBeenCalledWith({ type: 'ability', id: 'a0' });
  });

  it('never casts an action-bar slot from a bare diamond press', () => {
    const h = setupCrossHotbar(true);
    // A button that casts one ability bare and a DIFFERENT one under a trigger is
    // the random-cast problem; the whole set is a trigger away, so bare presses of
    // a cross-hotbar button never reach a slot.
    h.press(GP.DPAD_UP);
    // A bare d-pad press cycles targets now, so assert on the SLOT specifically
    // rather than on silence: the rule is about abilities, not about the button
    // being inert.
    for (const call of h.onAction.mock.calls) {
      expect(String(call[0]).startsWith('slot')).toBe(false);
    }
  });

  it('keeps the SYSTEM verbs on the diamond buttons when no trigger is held', () => {
    const h = setupCrossHotbar(true);
    // B is 'cancel' by default, which is not a slot, so a bare press still works.
    h.press(GP.B);
    expect(h.onAction).toHaveBeenCalledWith('cancel');
  });

  it('keeps a remapped Jump on a bare face button while the cross hotbar is on', () => {
    const h = setupCrossHotbar(true);
    h.bindings.bind(GP.A, 'jump');

    h.press(GP.A);

    expect(h.triggerGamepadJump).toHaveBeenCalledOnce();
  });

  it('keeps a remapped Jump on a bare d-pad button while the cross hotbar is on', () => {
    const h = setupCrossHotbar(true);
    h.bindings.bind(GP.DPAD_UP, 'jump');

    h.press(GP.DPAD_UP);

    expect(h.triggerGamepadJump).toHaveBeenCalledOnce();
    expect(h.onAction).not.toHaveBeenCalledWith('targetNpcPrev');
  });

  it('opens bags from View and keeps interface cycling on right-stick click', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.BACK);
    expect(h.onAction).toHaveBeenCalledWith('bags');
    h.press();
    h.press(GP.R3);
    expect(h.onAction).toHaveBeenCalledWith('cycleHud');
  });

  it('swaps the standing set on the right bumper', () => {
    // The bar has two sets and, before this, the only way to the second was
    // tapping the opposite trigger mid-hold. The bumper is the standing switch.
    const h = setupCrossHotbar(true);
    expect(h.manager.getCrossHotbarSet()).toBe(CROSS_HOTBAR_PRIMARY_SET);
    h.press(GP.RB);
    expect(h.onCrossHotbar).toHaveBeenLastCalledWith(null, CROSS_HOTBAR_EXPANDED_SET);
    expect(h.manager.getCrossHotbarSet()).toBe(CROSS_HOTBAR_EXPANDED_SET);
    h.press();
    h.press(GP.RB);
    expect(h.onCrossHotbar).toHaveBeenLastCalledWith(null, CROSS_HOTBAR_PRIMARY_SET);
    expect(h.manager.getCrossHotbarSet()).toBe(CROSS_HOTBAR_PRIMARY_SET);
  });

  it('interacts on confirm when no interface control is focused', () => {
    // The console-MMO reading of the bottom button: confirm what is focused, and
    // with nothing focused talk to (or loot) what is targeted. Pressing "back" to
    // start a conversation is the thing every console player gets wrong once.
    const h = setupCrossHotbar(true);
    h.press(GP.A);
    expect(h.onAction).toHaveBeenCalledWith('interact');
  });

  it('cycles targets on the bare d-pad, and only outside the HUD', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.DPAD_RIGHT);
    h.press();
    h.press(GP.DPAD_LEFT);
    expect(h.onAction).toHaveBeenCalledWith('target');
    expect(h.onAction).toHaveBeenCalledWith('targetPrev');
  });

  it('suppresses a slot a player REMAPPED onto a diamond button too', () => {
    const h = setupCrossHotbar(true);
    h.bindings.bind(GP.B, 'slot9');
    h.press(GP.B);
    expect(h.onAction).not.toHaveBeenCalledWith('slot9');
  });

  it('preserves the flat layout exactly when the cross hotbar is off', () => {
    const h = setupCrossHotbar(false);
    // The triggers ship unbound (they are the cross hotbar's modifiers), so with
    // the cross hotbar OFF they simply do nothing until a player remaps them.
    h.press(GP.LT);
    expect(h.onAction).not.toHaveBeenCalled();
    // With the cross hotbar OFF a diamond button DOES fire whatever it is bound to,
    // slot or not: the suppression above exists only to protect the cross hotbar.
    h.bindings.bind(GP.DPAD_UP, 'slot5');
    h.press(GP.LT, GP.DPAD_UP);
    expect(h.onAction).toHaveBeenCalledWith('slot5');
    h.press();
    h.press(GP.Y); // jump lives on the top face button now (Triangle on PS)
    expect(h.triggerGamepadJump).toHaveBeenCalled();
    expect(h.onCrossHotbar).not.toHaveBeenCalled();
  });

  it('tells the overlay when the hotbar opens, swaps sets, and closes', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.LT);
    expect(h.onCrossHotbar).toHaveBeenLastCalledWith('left', 0);
    h.press(GP.LT, GP.RT);
    expect(h.onCrossHotbar).toHaveBeenLastCalledWith('left', 1);
    h.press();
    expect(h.onCrossHotbar).toHaveBeenLastCalledWith(null, 0);
    expect(h.onCrossHotbar).toHaveBeenCalledTimes(3);
  });

  it('does not re-notify the overlay on an unchanged hold', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.LT);
    h.press(GP.LT);
    h.press(GP.LT);
    expect(h.onCrossHotbar).toHaveBeenCalledTimes(1);
  });

  it('re-announces the armed layer after a glyph-family repaint', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.LT);
    h.onCrossHotbar.mockClear();

    h.manager.setKindOverride('xbox');

    expect(h.onConnectionChange).toHaveBeenCalledOnce();
    expect(h.onCrossHotbar).toHaveBeenLastCalledWith('left', 0);
  });

  it('restores the expanded standing set after a glyph-family repaint', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.RB);
    h.onCrossHotbar.mockClear();

    h.manager.setKindOverride('xbox');

    expect(h.onCrossHotbar).toHaveBeenLastCalledWith(null, CROSS_HOTBAR_EXPANDED_SET);
  });

  it('does not re-announce the cross hotbar when it is disabled or disconnected', () => {
    const disabled = setupCrossHotbar(false);
    disabled.manager.setKindOverride('xbox');
    expect(disabled.onCrossHotbar).not.toHaveBeenCalled();

    const disconnected = setupCrossHotbar(true);
    (disconnected.manager as unknown as { index: number | null }).index = null;
    disconnected.manager.setKindOverride('xbox');
    expect(disconnected.onCrossHotbar).not.toHaveBeenCalled();
  });

  it('auto-focuses a window the moment it opens, once', () => {
    // A pad player should already be inside the window, not have to press a
    // direction to get in. Edge-detected: it must not re-grab focus every poll.
    const h = setupCrossHotbar(true);
    const focused: string[] = [];
    const btn = {
      focus: () => focused.push('focus'),
      classList: { add: () => {}, remove: () => {} },
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        right: 10,
        bottom: 10,
        width: 10,
        height: 10,
      }),
      hasAttribute: () => false,
    };
    const dialog = {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        right: 99,
        bottom: 99,
        width: 99,
        height: 99,
      }),
      querySelectorAll: () => [btn],
    };
    const baseDoc = (globalThis as unknown as { document: Record<string, unknown> }).document;
    (globalThis as unknown as { document: Record<string, unknown> }).document = {
      ...baseDoc,
      querySelectorAll: (sel: string) => (sel.includes('dialog') ? [dialog] : [btn]),
      activeElement: null,
    };
    h.setPointerMode(true);
    h.press();
    h.press();
    expect(focused).toEqual(['focus']);
  });

  it('drops the pad pointer when the window closes', () => {
    // It used to hang in mid-air over a surface that was no longer there.
    const h = setupCrossHotbar(true);
    const removed: string[] = [];
    const btn = {
      focus: () => {},
      classList: { add: () => {}, remove: (c: string) => removed.push(c) },
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        right: 10,
        bottom: 10,
        width: 10,
        height: 10,
      }),
      hasAttribute: () => false,
    };
    const dialog = {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        right: 99,
        bottom: 99,
        width: 99,
        height: 99,
      }),
      querySelectorAll: () => [btn],
    };
    const baseDoc = (globalThis as unknown as { document: Record<string, unknown> }).document;
    (globalThis as unknown as { document: Record<string, unknown> }).document = {
      ...baseDoc,
      querySelectorAll: (sel: string) => (sel.includes('dialog') ? [dialog] : [btn]),
      activeElement: null,
    };
    h.setPointerMode(true);
    h.press(); // window opens, focus lands inside it
    h.setPointerMode(false);
    // The drop is no longer decided on the closing frame: the pad waits a few
    // frames for the window to hand focus back. With nothing to return to
    // (activeElement stays null) it still gives up, just not instantly.
    for (let i = 0; i < 20; i++) h.press();
    expect(removed).toContain('pad-focus');
  });

  it('returns the selection to the opener instead of dropping it', () => {
    // The whole point: closing a window puts the cursor back on the thing the
    // player opened it from, not in the middle of the screen.
    const h = setupCrossHotbar(true);
    const added: string[] = [];
    const opener = {
      focus: () => {},
      classList: { add: (c: string) => added.push(c), remove: () => {} },
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        right: 10,
        bottom: 10,
        width: 10,
        height: 10,
      }),
      hasAttribute: () => false,
    };
    const baseDoc = (globalThis as unknown as { document: Record<string, unknown> }).document;
    (globalThis as unknown as { document: Record<string, unknown> }).document = {
      ...baseDoc,
      // No window is open any more, and focus has come back to the opener.
      querySelectorAll: (sel: string) => (sel.includes('dialog') ? [] : [opener]),
      activeElement: opener,
      body: {},
    };
    h.setPointerMode(true);
    h.press();
    h.setPointerMode(false);
    h.press();
    expect(added).toContain('pad-focus');
  });

  it('closes the hotbar when a HUD window takes the pad into cursor mode', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.LT);
    h.setPointerMode(true);
    h.press(GP.LT);
    expect(h.onCrossHotbar).toHaveBeenLastCalledWith(null, 0);
  });

  it('closes the hotbar when the setting is turned off mid-hold', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.LT);
    h.manager.setCrossHotbar(false);
    expect(h.onCrossHotbar).toHaveBeenLastCalledWith(null, 0);
    // The trigger is still physically down, but its flat binding takes over again
    // only on the NEXT press, never as a phantom edge from the release.
    h.press(GP.LT);
    expect(h.onAction).not.toHaveBeenCalledWith('slot4');
  });

  it('closes the hotbar when the pad is stopped', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.LT);
    h.manager.stop();
    expect(h.onCrossHotbar).toHaveBeenLastCalledWith(null, 0);
  });

  it('keeps the standing set through a release, so opening a window never undoes it', () => {
    // A release runs on every poll while a window is open. The standing set is the
    // switch the player leaves flipped, not part of the hold, so it has to survive
    // one; the bar and the overlay must also still agree afterwards.
    const h = setupCrossHotbar(true);
    h.press(GP.RB);
    h.setPointerMode(true);
    h.press();
    h.press();
    expect(h.onCrossHotbar).toHaveBeenLastCalledWith(null, CROSS_HOTBAR_EXPANDED_SET);
    h.setPointerMode(false);
    h.press(GP.LT);
    expect(h.onCrossHotbar).toHaveBeenLastCalledWith('left', CROSS_HOTBAR_EXPANDED_SET);
    // Cell 0 of the SECOND set, which is where the player left the bar.
    h.press(GP.LT, GP.DPAD_UP);
    expect(h.onCrossHotbarCast).toHaveBeenCalledWith({ type: 'ability', id: 'a16' });
  });

  it('does not re-notify the overlay on the polls after a release', () => {
    const h = setupCrossHotbar(true);
    h.press(GP.LT);
    h.setPointerMode(true);
    h.press(GP.LT);
    const closed = h.onCrossHotbar.mock.calls.length;
    h.press(GP.LT);
    h.press(GP.LT);
    expect(h.onCrossHotbar).toHaveBeenCalledTimes(closed);
  });

  describe('ground aim placement', () => {
    it('blocks the virtual mouse and arrange chords while placement is active', () => {
      const mouse = setupCrossHotbar(true);
      mouse.setGroundAimActive(true);
      mouse.press(GP.LB);
      mouse.press(GP.LB, GP.R3);
      expect((mouse.manager as unknown as { mouseMode: boolean }).mouseMode).toBe(false);

      const edit = setupCrossHotbar(true);
      edit.setGroundAimActive(true);
      edit.press(GP.LB);
      edit.press(GP.LB, GP.Y);
      expect(edit.onCrossHotbarEdit).not.toHaveBeenCalled();
    });

    it('steers with the deadzoned left stick and stops autorun once on entry', () => {
      const h = setupCrossHotbar(true);
      h.setGroundAimActive(true);
      h.setAxes([0.5, -1, 0, 0]);

      h.manager.poll(0.25);
      h.manager.poll(0.25);

      expect(h.input.clearGamepadMove).toHaveBeenCalledTimes(2);
      expect(h.input.setAutorun).toHaveBeenCalledExactlyOnceWith(false);
      expect(h.onGroundAimStick).toHaveBeenCalledTimes(2);
      const expected = applyRadialDeadzone(0.5, -1, 0.18);
      expect(h.onGroundAimStick.mock.calls[0]?.[0]).toBeCloseTo(expected.x);
      expect(h.onGroundAimStick.mock.calls[0]?.[1]).toBeCloseTo(expected.y);
      expect(h.onGroundAimStick.mock.calls[0]?.[2]).toBe(0.25);
    });

    it('stops autorun again after placement exits and re-enters', () => {
      const h = setupCrossHotbar(true);
      h.setGroundAimActive(true);
      h.press();
      h.setGroundAimActive(false);
      h.press();
      h.setGroundAimActive(true);
      h.press();

      expect(h.input.setAutorun).toHaveBeenCalledTimes(2);
      expect(h.input.setAutorun).toHaveBeenNthCalledWith(1, false);
      expect(h.input.setAutorun).toHaveBeenNthCalledWith(2, false);
    });

    it('marks diagonal placement steering just outside the radial deadzone as pad input', () => {
      const h = setupCrossHotbar(true);
      h.setGroundAimActive(true);
      h.setAxes([0.13, 0.13, 0, 0]);
      vi.mocked(markPadActivity).mockClear();

      h.manager.poll(0.25);

      expect(h.onGroundAimStick.mock.calls[0]?.[0]).not.toBe(0);
      expect(h.onGroundAimStick.mock.calls[0]?.[1]).not.toBe(0);
      expect(markPadActivity).toHaveBeenCalledTimes(1);
    });

    it('keeps right-stick camera look active during placement', () => {
      const h = setupCrossHotbar(true);
      h.setGroundAimActive(true);
      h.setAxes([0, 0, 1, -0.5]);

      h.manager.poll(0.25);

      expect(h.input.applyGamepadLook).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
      expect(h.input.setGamepadLookActive).toHaveBeenCalledWith(true);
    });

    it('snaps on bare d-pad right without targeting', () => {
      const h = setupCrossHotbar(true);
      h.setGroundAimActive(true);

      h.press(GP.DPAD_RIGHT);

      expect(h.onGroundAimSnap).toHaveBeenCalledExactlyOnceWith(1);
      expect(h.onAction).not.toHaveBeenCalledWith('target');
    });

    it('snaps left and consumes vertical d-pad presses', () => {
      const h = setupCrossHotbar(true);
      h.setGroundAimActive(true);

      h.press(GP.DPAD_LEFT);
      h.press();
      h.press(GP.DPAD_UP);
      h.press();
      h.press(GP.DPAD_DOWN);

      expect(h.onGroundAimSnap).toHaveBeenCalledExactlyOnceWith(-1);
      expect(h.onAction).not.toHaveBeenCalled();
    });

    it('commits on bare confirm and cancels on bare cancel', () => {
      const h = setupCrossHotbar(true);
      h.setGroundAimActive(true);

      h.press(GP.A);
      h.press();
      h.press(GP.B);

      expect(h.onGroundAimCommit).toHaveBeenCalledTimes(1);
      expect(h.cancelGroundAim).toHaveBeenCalledTimes(1);
    });

    it('uses remapped confirm and cancel bindings once per rising edge', () => {
      const h = setupCrossHotbar(true);
      h.bindings.bind(GP.X, GAMEPAD_CONFIRM);
      h.bindings.bind(GP.Y, GAMEPAD_CANCEL);
      h.setGroundAimActive(true);

      h.press(GP.X);
      h.press(GP.X);
      h.press();
      h.press(GP.Y);
      h.press(GP.Y);

      expect(h.onGroundAimCommit).toHaveBeenCalledTimes(1);
      expect(h.cancelGroundAim).toHaveBeenCalledTimes(1);
    });

    it('keeps cross-hotbar casting live while a trigger is held', () => {
      const h = setupCrossHotbar(true);
      h.setGroundAimActive(true);

      h.press(GP.LT);
      h.press(GP.LT, GP.A);

      expect(h.onCrossHotbarCast).toHaveBeenCalledWith({ type: 'ability', id: 'a7' });
    });

    it('resolves a trigger and diamond that rise in the same poll', () => {
      const h = setupCrossHotbar(true);
      h.setGroundAimActive(true);

      h.press(GP.LT, GP.A);

      expect(h.onCrossHotbarCast).toHaveBeenCalledWith({ type: 'ability', id: 'a7' });
      expect(h.onGroundAimCommit).not.toHaveBeenCalled();
    });

    it('cancels placement before direct jump and autorun actions', () => {
      const h = setupCrossHotbar(true);
      h.setGroundAimActive(true);

      h.press(GP.Y);
      h.press();
      h.press(GP.L3);

      expect(h.cancelGroundAim).toHaveBeenCalledTimes(2);
      expect(h.triggerGamepadJump).toHaveBeenCalledTimes(1);
      expect(h.input.toggleAutorun).toHaveBeenCalledTimes(1);
    });

    it('cancels placement on window blur and active-pad disconnect', () => {
      const blurred = setupCrossHotbar(true);
      blurred.setGroundAimActive(true);
      blurred.setWindowFocused(false);
      blurred.press();
      expect(blurred.cancelGroundAim).toHaveBeenCalledTimes(1);

      const disconnected = setupCrossHotbar(true);
      disconnected.setGroundAimActive(true);
      disconnected.manager.start();
      disconnected.disconnectPad(0);
      expect(disconnected.cancelGroundAim).toHaveBeenCalledTimes(1);
    });

    it('cancels placement when the manager stops', () => {
      const h = setupCrossHotbar(true);
      h.setGroundAimActive(true);

      h.manager.stop();

      expect(h.cancelGroundAim).toHaveBeenCalledTimes(1);
    });

    it('defers to pointer navigation while a HUD window is open', () => {
      const h = setupCrossHotbar(true);
      h.setGroundAimActive(true);
      h.setPointerMode(true);
      vi.mocked(moveDpadFocus).mockClear();

      h.press(GP.DPAD_RIGHT);

      expect(moveDpadFocus).toHaveBeenCalledWith('right');
      expect(h.onGroundAimSnap).not.toHaveBeenCalled();
      expect(h.input.clearGamepadMove).toHaveBeenCalled();
    });

    it('keeps placement chords blocked while pointer mode handles the poll', () => {
      const h = setupCrossHotbar(true);
      h.setGroundAimActive(true);
      h.setPointerMode(true);

      h.press(GP.LB);
      h.press(GP.LB, GP.R3);
      h.press();
      h.press(GP.LB);
      h.press(GP.LB, GP.Y);

      expect((h.manager as unknown as { mouseMode: boolean }).mouseMode).toBe(false);
      expect(h.onCrossHotbarEdit).not.toHaveBeenCalled();
    });
  });

  it('retries the one-time seed on a timer, never once per poll', () => {
    // Each ask rebuilds the Controller options panel, so a per-poll retry made its
    // own dropdowns unclickable for as long as the bar stayed empty.
    const h = setupCrossHotbar(true);
    h.xhb.reset();
    h.onConnectionChange.mockClear();
    for (let i = 0; i < 12; i++) h.press();
    expect(h.onConnectionChange).not.toHaveBeenCalled();
    h.poll(1);
    expect(h.onConnectionChange).toHaveBeenCalledTimes(1);
    h.poll(0.5);
    expect(h.onConnectionChange).toHaveBeenCalledTimes(1);
    h.poll(0.5);
    expect(h.onConnectionChange).toHaveBeenCalledTimes(2);
  });

  it('stops retrying the moment the bar is seeded', () => {
    const h = setupCrossHotbar(true);
    h.xhb.reset();
    h.onConnectionChange.mockClear();
    h.poll(1);
    expect(h.onConnectionChange).toHaveBeenCalledTimes(1);
    h.xhb.seedOnce([{ type: 'ability', id: 'a0' }]);
    for (let i = 0; i < 5; i++) h.poll(1);
    expect(h.onConnectionChange).toHaveBeenCalledTimes(1);
  });

  it('gives up on a bar that never fills instead of asking all session', () => {
    const h = setupCrossHotbar(true);
    h.xhb.reset();
    h.onConnectionChange.mockClear();
    for (let i = 0; i < 60; i++) h.poll(1);
    const asks = h.onConnectionChange.mock.calls.length;
    expect(asks).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) h.poll(1);
    expect(h.onConnectionChange).toHaveBeenCalledTimes(asks);
  });
  describe('cross hotbar arrange mode', () => {
    // focusSpell installs a document global; drop it so a later case in this file
    // sees the plain-Node environment the rest of the suite assumes.
    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'document');
    });

    const enterEdit = (h: ReturnType<typeof setupCrossHotbar>) => {
      h.press(GP.LB);
      h.press(GP.LB, GP.Y);
      h.press();
    };

    it('opens and closes on the bumper plus top face button', () => {
      const h = setupCrossHotbar(true);
      enterEdit(h);
      // The third argument is what is in hand, which is nothing on the way in.
      expect(h.onCrossHotbarEdit).toHaveBeenLastCalledWith(true, null, null);
      enterEdit(h);
      expect(h.onCrossHotbarEdit).toHaveBeenLastCalledWith(false, null, null);
    });

    it('moves an action onto another cell', () => {
      const h = setupCrossHotbar(true);
      enterEdit(h);
      h.focus(0);
      h.press(GP.A);
      h.press();
      h.focus(3);
      h.press(GP.A);
      h.press();
      expect(h.xhb.setActions(0)[3]).toEqual({ type: 'ability', id: 'a0' });
      // A move is a SWAP: what was on the target went where the action came from.
      expect(h.xhb.setActions(0)[0]).toEqual({ type: 'ability', id: 'a3' });
    });

    it('casts nothing while arranging', () => {
      // The whole point of a mode: a press that would fire the ability being moved
      // has to stay silent.
      const h = setupCrossHotbar(true);
      enterEdit(h);
      h.focus(0);
      h.press(GP.LT);
      h.press(GP.LT, GP.DPAD_UP);
      expect(h.onCrossHotbarCast).not.toHaveBeenCalled();
    });

    it('clears the focused cell with cancel', () => {
      const h = setupCrossHotbar(true);
      enterEdit(h);
      h.focus(2);
      h.press(GP.B);
      expect(h.xhb.setActions(0)[2]).toBeNull();
    });

    it('leaves the bar alone when nothing on it is focused', () => {
      const h = setupCrossHotbar(true);
      enterEdit(h);
      h.focus(null);
      h.press(GP.A);
      h.press();
      h.press(GP.B);
      expect(h.xhb.setActions(0)[0]).toEqual({ type: 'ability', id: 'a0' });
    });

    it('drops the pad selection the moment the player moves', () => {
      // Pressing confirm out of instinct while running should not activate
      // whatever the cursor was left resting on, so moving puts it away.
      const h = setupCrossHotbar(true);
      const removed: string[] = [];
      const marked = {
        focus: () => {},
        classList: { add: () => {}, remove: (c: string) => removed.push(c) },
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 10,
          bottom: 10,
          width: 10,
          height: 10,
        }),
        hasAttribute: () => false,
      };
      const baseDoc = (globalThis as unknown as { document: Record<string, unknown> }).document;
      const doc = {
        ...baseDoc,
        querySelectorAll: (sel: string) => (sel.includes('dialog') ? [] : [marked]),
        // Nothing focused yet, so the first d-pad step lands on (and marks) it.
        activeElement: null as unknown,
        body: {},
      };
      (globalThis as unknown as { document: Record<string, unknown> }).document = doc;
      marked.focus = () => {
        doc.activeElement = marked;
      };
      h.setPointerMode(false);
      h.press(GP.DPAD_DOWN); // the pad marks what it stepped onto
      h.move();
      expect(removed).toContain('pad-focus');
      Reflect.deleteProperty(globalThis, 'document');
    });

    it('still lets confirm drive the HUD while arranging', () => {
      // Arrange mode swallowed confirm along with the casts, which left the player
      // unable to press anything (the spellbook included) once the mode was on.
      const h = setupCrossHotbar(true);
      enterEdit(h);
      h.focus(null);
      h.focusSpell(null);
      h.press(GP.A);
      expect(h.onCrossHotbarCast).not.toHaveBeenCalled();
      // Consumed by the focus stepper rather than dropped on the floor.
      expect(h.onAction).not.toHaveBeenCalledWith('slot0');
    });

    it('picks a spell up with a window open, where the poll used to bail out', () => {
      // With a window up the poll returned before dispatch, so confirm on a
      // spellbook row did nothing at all: the one press the whole flow needs.
      const h = setupCrossHotbar(true);
      enterEdit(h);
      h.setPointerMode(true);
      h.focusSpell('mortal_strike');
      h.press(GP.A);
      h.press();
      h.setPointerMode(false);
      h.focusSpell(null);
      h.focus(7);
      h.press(GP.A);
      h.press();
      expect(h.xhb.setActions(0)[7]).toEqual({ type: 'ability', id: 'mortal_strike' });
    });

    it('opens the spellbook when confirm lands on an empty cell', () => {
      // "Put something here" is what an empty cell means; answering with nothing
      // left no way in at all.
      const h = setupCrossHotbar(true);
      enterEdit(h);
      h.xhb.bind(0, 6, null);
      h.focus(6);
      h.press(GP.A);
      expect(h.onOpenSpellbook).toHaveBeenCalled();
    });

    it('does not jump on the way into arrange mode', () => {
      // The chord's completing button must not also fire its own binding, or
      // every trip into arrange mode makes the character hop.
      const h = setupCrossHotbar(true);
      enterEdit(h);
      expect(h.triggerGamepadJump).not.toHaveBeenCalled();
    });

    it('picks an ability out of the spellbook and drops it on a cell', () => {
      // The other half of arranging: slot-to-slot moves what is already there,
      // this is how something NEW reaches the bar.
      const h = setupCrossHotbar(true);
      enterEdit(h);
      h.focusSpell('mortal_strike');
      h.press(GP.A);
      h.press();
      h.focusSpell(null);
      h.focus(5);
      h.press(GP.A);
      h.press();
      expect(h.xhb.setActions(0)[5]).toEqual({ type: 'ability', id: 'mortal_strike' });
    });

    it('leaves a spellbook row alone outside arrange mode', () => {
      const h = setupCrossHotbar(true);
      h.focusSpell('mortal_strike');
      h.focus(5);
      h.press(GP.A);
      h.press();
      expect(h.xhb.setActions(0)[5]).toEqual({ type: 'ability', id: 'a5' });
    });

    it('leaves arrange mode when the bar is switched off mid-arrange', () => {
      // The chord out of the mode is gated on the bar being ON, so switching it off
      // while arranging used to take the only exit away with the player inside.
      const h = setupCrossHotbar(true);
      enterEdit(h);
      h.focus(0);
      h.press(GP.A);
      h.press();
      vi.mocked(setPadNavSpansWindows).mockClear();
      h.manager.setCrossHotbar(false);
      expect(h.onCrossHotbarEdit).toHaveBeenLastCalledWith(false, null, null);
      expect(setPadNavSpansWindows).toHaveBeenLastCalledWith(false);
      // Really over: a confirm on another cell no longer moves what was in hand.
      h.focus(3);
      h.press(GP.A);
      h.press();
      expect(h.xhb.setActions(0)[3]).toEqual({ type: 'ability', id: 'a3' });
    });

    it('leaves arrange mode when the pad is stopped', () => {
      const h = setupCrossHotbar(true);
      enterEdit(h);
      vi.mocked(setPadNavSpansWindows).mockClear();
      h.manager.stop();
      expect(h.onCrossHotbarEdit).toHaveBeenLastCalledWith(false, null, null);
      expect(setPadNavSpansWindows).toHaveBeenLastCalledWith(false);
    });

    it('leaves arrange mode when the active pad is unplugged', () => {
      // The fourth way out, and the only one no human action follows: a pad that
      // dies mid-arrange leaves the HUD drawing a mode nothing can now exit, and
      // the action in hand nowhere at all.
      const h = setupCrossHotbar(true);
      h.manager.start();
      enterEdit(h);
      h.focus(0);
      h.press(GP.A);
      h.press();
      h.disconnectPad(0);
      expect(h.onCrossHotbarEdit).toHaveBeenLastCalledWith(false, null, null);
      // What was in hand went back on the cell it came off.
      expect(h.xhb.setActions(0)[0]).toEqual({ type: 'ability', id: 'a0' });
    });

    it('stays in arrange mode when a different pad is unplugged', () => {
      // Only the ACTIVE pad's loss ends the mode: a second controller leaving
      // must not cancel the arrange the player is still in the middle of.
      const h = setupCrossHotbar(true);
      h.manager.start();
      enterEdit(h);
      h.disconnectPad(1);
      expect(h.onCrossHotbarEdit).toHaveBeenLastCalledWith(true, null, null);
    });

    it('leaves arrange mode when the window loses focus', () => {
      const h = setupCrossHotbar(true);
      enterEdit(h);
      h.setWindowFocused(false);
      h.press();
      expect(h.onCrossHotbarEdit).toHaveBeenLastCalledWith(false, null, null);
    });

    it('does nothing at all when the player never entered the mode', () => {
      const h = setupCrossHotbar(true);
      h.focus(2);
      h.press(GP.B);
      expect(h.xhb.setActions(0)[2]).toEqual({ type: 'ability', id: 'a2' });
    });
  });
});

// The pad's HUD selection is state that a press has to be able to LEAVE. Cancel is
// that press, and the grace the pad allows a closing window to hand focus back is a
// wall-clock budget, not a frame count, so it means the same on a 30 fps handheld
// and a 144 Hz desktop.
describe('GamepadManager pad focus handover', () => {
  // Own the DOM globals poll() reads, the same way the cross-hotbar suite does, so
  // these cases do not inherit an unfocused window from an earlier one.
  afterEach(() => vi.unstubAllGlobals());

  function setupFocus(pointerMode: () => boolean) {
    vi.stubGlobal('document', {
      hasFocus: () => true,
      querySelectorAll: () => [],
      activeElement: null,
    });
    let pad = gamepadWithPressed();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { getGamepads: () => [pad] },
    });
    const onAction = vi.fn();
    const input = {
      applyGamepadLook: vi.fn(),
      clearGamepadMove: vi.fn(),
      setGamepadLookActive: vi.fn(),
      setGamepadMove: vi.fn(),
      triggerGamepadJump: vi.fn(),
    } as unknown as Input;
    const callbacks = {
      onAction,
      onInputEdge: vi.fn(),
      isPointerMode: pointerMode,
    } satisfies GamepadCallbacks;
    const manager = new GamepadManager(input, new GamepadBindings(), callbacks);
    (manager as unknown as { index: number | null }).index = 0;
    vi.mocked(clearPadFocus).mockClear();
    vi.mocked(cancelPadFocus).mockClear();
    vi.mocked(syncStandalonePadFocus).mockClear();
    return {
      manager,
      input,
      onAction,
      press: (...buttons: number[]) => {
        pad = gamepadWithPressed(...buttons);
      },
      moveForward: () => {
        pad = gamepadWithPressed();
        (pad as unknown as { axes: number[] }).axes = [0, -1, 0, 0];
      },
    };
  }

  it('spends the focus-return grace in seconds, so one long frame ends it', () => {
    let pointerMode = true;
    const h = setupFocus(() => pointerMode);
    h.manager.poll(1 / 60);
    pointerMode = false;
    h.manager.poll(1 / 60); // the closing edge: nothing restored focus, so the wait starts
    expect(clearPadFocus).not.toHaveBeenCalled();
    h.manager.poll(0.25);
    expect(clearPadFocus).toHaveBeenCalledTimes(1);
  });

  it('checks standalone death controls without suspending ghost movement', () => {
    const h = setupFocus(() => false);
    h.moveForward();
    h.manager.poll(1 / 60);
    expect(h.input.setGamepadMove).toHaveBeenCalled();
    // Entering corpse range with the stick still held must not arm and
    // immediately clear the prompt. It waits until the player stops moving.
    expect(syncStandalonePadFocus).not.toHaveBeenCalled();

    h.press();
    h.manager.poll(1 / 60);
    expect(syncStandalonePadFocus).toHaveBeenCalledTimes(1);
  });

  it('does not let movement dismiss a required death selection', () => {
    const h = setupFocus(() => false);
    h.moveForward();
    h.manager.poll(1 / 60);

    expect(cancelPadFocus).toHaveBeenCalledTimes(1);
    expect(clearPadFocus).not.toHaveBeenCalled();
  });

  it('marks the pad active before focusing a newly visible death action', () => {
    const h = setupFocus(() => false);
    const order: string[] = [];
    vi.mocked(markPadActivity).mockImplementationOnce(() => order.push('activity'));
    vi.mocked(syncStandalonePadFocus).mockImplementationOnce(() => {
      order.push('standalone');
      return false;
    });

    h.press(GP.A);
    h.manager.poll(1 / 60);
    expect(order).toEqual(['activity', 'standalone']);
  });

  it('keeps waiting across the short frames a high refresh rate delivers', () => {
    let pointerMode = true;
    const h = setupFocus(() => pointerMode);
    h.manager.poll(1 / 144);
    pointerMode = false;
    h.manager.poll(1 / 144);
    // Twelve frames at 144 Hz is 83 ms, well inside the grace the old frame count spent.
    for (let i = 0; i < 12; i++) h.manager.poll(1 / 144);
    expect(clearPadFocus).not.toHaveBeenCalled();
    for (let i = 0; i < 20; i++) h.manager.poll(1 / 144);
    expect(clearPadFocus).toHaveBeenCalledTimes(1);
  });

  it('drops the pad selection on cancel instead of clearing the target under it', () => {
    const h = setupFocus(() => false);
    vi.mocked(hasPadFocus).mockReturnValueOnce(true);
    h.press(GP.B);
    h.manager.poll(1 / 60);
    expect(cancelPadFocus).toHaveBeenCalledTimes(1);
    expect(h.onAction).not.toHaveBeenCalledWith(GAMEPAD_CANCEL);
  });

  it('passes cancel through to the host once the pad holds no selection', () => {
    const h = setupFocus(() => false);
    h.press(GP.B);
    h.manager.poll(1 / 60);
    expect(clearPadFocus).not.toHaveBeenCalled();
    expect(h.onAction).toHaveBeenCalledWith(GAMEPAD_CANCEL);
  });
});
