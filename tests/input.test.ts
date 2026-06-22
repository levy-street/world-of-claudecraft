import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from '../src/game/input';
import { Keybinds } from '../src/game/keybinds';

function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
}

function makeInput() {
  const canvasListeners = new Map<string, (event: any) => void>();
  const windowListeners = new Map<string, (event: any) => void>();
  const documentListeners = new Map<string, (event: any) => void>();
  const requestPointerLock = vi.fn();
  const exitPointerLock = vi.fn();
  let gameActive = true;
  let mobileTouch = false;
  const canvas = {
    style: { cursor: '' },
    addEventListener: vi.fn((type: string, cb: (event: any) => void) => {
      canvasListeners.set(type, cb);
    }),
    requestPointerLock,
  };
  (globalThis as any).window = {
    addEventListener: vi.fn((type: string, cb: (event: any) => void) => {
      windowListeners.set(type, cb);
    }),
  };
  (globalThis as any).document = {
    activeElement: null,
    body: {
      classList: {
        contains: (cls: string) => (cls === 'game-active' && gameActive) || (cls === 'mobile-touch' && mobileTouch),
      },
    },
    fullscreenElement: null,
    webkitFullscreenElement: null,
    pointerLockElement: null,
    hidden: false,
    addEventListener: vi.fn((type: string, cb: (event: any) => void) => {
      documentListeners.set(type, cb);
    }),
    exitPointerLock,
  };
  const cb = {
    onTab: vi.fn(),
    onTargetFriendly: vi.fn(),
    onCycleFriendly: vi.fn(),
    onAbility: vi.fn(),
    onUiKey: vi.fn(),
    onEmoteWheel: vi.fn(),
    onClickPick: vi.fn(),
    onAttackMove: vi.fn(),
  };
  const input = new Input(canvas as any, cb, new Keybinds());
  return {
    canvas,
    canvasListeners,
    windowListeners,
    documentListeners,
    cb,
    input,
    setGameActive: (active: boolean) => { gameActive = active; },
    setMobileTouch: (active: boolean) => { mobileTouch = active; },
  };
}

beforeEach(() => {
  installStorage();
  vi.restoreAllMocks();
});

describe('Input autorun', () => {
  it('toggleAutorun flips state and feeds forward into readMoveInput', () => {
    const { input } = makeInput();
    expect(input.autorun).toBe(false);
    expect(input.toggleAutorun()).toBe(true);
    expect(input.autorun).toBe(true);
    expect(input.readMoveInput().forward).toBe(true);
    expect(input.toggleAutorun()).toBe(false);
    expect(input.readMoveInput().forward).toBe(false);
  });

  it('a forward touch-move cancels autorun (classic tap-to-stop)', () => {
    const { input } = makeInput();
    input.toggleAutorun();
    input.setTouchMove({ forward: true, back: false, strafeLeft: false, strafeRight: false });
    expect(input.autorun).toBe(false);
  });

  it('a strafe-only touch-move keeps autorun engaged', () => {
    const { input } = makeInput();
    input.toggleAutorun();
    input.setTouchMove({ forward: false, back: false, strafeLeft: true, strafeRight: false });
    expect(input.autorun).toBe(true);
    expect(input.readMoveInput().forward).toBe(true);
  });

  it('opening the Escape menu pauses but does not cancel autorun, and it resumes on close', () => {
    // The classic complaint: autorun, then hit Escape to change a keybind or a
    // setting. Suspending movement (the open menu) must only pause forward motion
    // for that frame, never clear the autorun latch, so closing the menu resumes
    // the run instead of stranding the player.
    const { input } = makeInput();
    input.toggleAutorun();
    expect(input.readMoveInput().forward).toBe(true);

    input.suspendMovement = true; // mirrors main.ts setting it while the game menu is open
    expect(input.autorun).toBe(true); // latch survives the menu
    expect(input.readMoveInput().forward).toBe(false); // held still while suspended

    input.suspendMovement = false; // menu closed
    expect(input.autorun).toBe(true);
    expect(input.readMoveInput().forward).toBe(true); // run resumes
  });
});

describe('Input click-to-move marker pulses', () => {
  it('increments the pulse id for every accepted click-move target', () => {
    const { input } = makeInput();
    expect(input.clickMovePulse).toBe(0);
    input.setClickMoveTarget({ x: 1, z: 2 }, 0.5);
    expect(input.clickMovePulse).toBe(1);
    expect(input.clickMovePulseTarget).toEqual({ x: 1, z: 2 });
    input.setClickMoveTarget({ x: 2, z: 3 }, 0.5);
    expect(input.clickMovePulse).toBe(2);
    expect(input.clickMovePulseTarget).toEqual({ x: 2, z: 3 });
  });

  it('stores and advances pathfound click-move waypoints', () => {
    const { input } = makeInput();
    input.setClickMoveTarget({ x: 3, z: 0 }, 0.5, null, [
      { x: 1, z: 0 },
      { x: 2, z: 0 },
      { x: 3, z: 0 },
    ]);
    expect(input.clickMoveGoal).toEqual({ x: 3, z: 0 });
    expect(input.clickMoveTarget).toEqual({ x: 1, z: 0 });
    expect(input.isClickMoveFinalWaypoint()).toBe(false);
    expect(input.advanceClickMoveWaypoint()).toBe(true);
    expect(input.clickMoveTarget).toEqual({ x: 2, z: 0 });
    expect(input.advanceClickMoveWaypoint()).toBe(true);
    expect(input.clickMoveTarget).toEqual({ x: 3, z: 0 });
    expect(input.isClickMoveFinalWaypoint()).toBe(true);
    expect(input.advanceClickMoveWaypoint()).toBe(false);
  });

  it('reroutes an active click-move path without pulsing the marker', () => {
    const { input } = makeInput();
    input.setClickMoveTarget({ x: 3, z: 0 }, 0.5, 42, [{ x: 1, z: 0 }, { x: 3, z: 0 }]);
    input.advanceClickMoveWaypoint();
    input.rerouteClickMoveTarget({ x: 8, z: 0 }, [{ x: 5, z: 0 }, { x: 8, z: 0 }]);
    expect(input.clickMovePulse).toBe(1);
    expect(input.clickMoveGoal).toEqual({ x: 8, z: 0 });
    expect(input.clickMoveTarget).toEqual({ x: 5, z: 0 });
    expect(input.clickMovePathIndex).toBe(0);
  });

  it('clears path state when click-to-move stops', () => {
    const { input } = makeInput();
    input.setClickMoveTarget({ x: 3, z: 0 }, 0.5, null, [{ x: 1, z: 0 }, { x: 3, z: 0 }]);
    input.clearClickMove();
    expect(input.clickMoveTarget).toBeNull();
    expect(input.clickMoveGoal).toBeNull();
    expect(input.clickMovePath).toEqual([]);
    expect(input.clickMovePathIndex).toBe(0);
  });
});

describe('Input pointer lock', () => {
  it('does not request pointer lock for a plain right click', () => {
    const { canvas, canvasListeners } = makeInput();

    canvasListeners.get('mousedown')!({ button: 2 });

    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it('requests pointer lock after mouse movement becomes an active drag', () => {
    const { canvas, canvasListeners, windowListeners } = makeInput();

    canvasListeners.get('mousedown')!({ button: 2, clientX: 100, clientY: 100 });
    windowListeners.get('mousemove')!({ movementX: 10, movementY: 5 });
    windowListeners.get('mousemove')!({ movementX: 4, movementY: 0 });
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    windowListeners.get('mousemove')!({ movementX: 1, movementY: 0 });

    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('uses normal mouse dragging instead of pointer lock while browser fullscreen is active', () => {
    const { canvas, canvasListeners, windowListeners } = makeInput();
    (globalThis as any).document.fullscreenElement = (globalThis as any).document.documentElement ?? canvas;

    canvasListeners.get('mousedown')!({ button: 2, clientX: 100, clientY: 100 });
    windowListeners.get('mousemove')!({ movementX: 19, movementY: 0 });
    windowListeners.get('mousemove')!({ movementX: 1, movementY: 0 });

    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it('does not rotate the camera before the drag threshold, so short sloppy clicks stay stable', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { canvas, input, cb, canvasListeners, windowListeners } = makeInput();
    const yaw = input.camYaw;
    const pitch = input.camPitch;

    canvasListeners.get('mousedown')!({ button: 0, clientX: 120, clientY: 160, preventDefault: vi.fn() });
    now += 40;
    windowListeners.get('mousemove')!({ movementX: 12, movementY: 3 });
    expect(input.isCameraDragActive()).toBe(false);
    expect(input.camYaw).toBe(yaw);
    expect(input.camPitch).toBe(pitch);

    now += 40;
    windowListeners.get('mouseup')!({ button: 0, clientX: 132, clientY: 163, target: canvas });
    expect(cb.onClickPick).toHaveBeenCalledWith(120, 160, 0);
  });

  it('starts camera drag by distance but discards the threshold-crossing movement', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { canvas, input, canvasListeners, windowListeners } = makeInput();
    const yaw = input.camYaw;

    canvasListeners.get('mousedown')!({ button: 2, clientX: 100, clientY: 100, preventDefault: vi.fn() });
    windowListeners.get('mousemove')!({ movementX: 10, movementY: 5 });
    windowListeners.get('mousemove')!({ movementX: 4, movementY: 0 });
    expect(input.isCameraDragActive()).toBe(true);
    expect(input.camYaw).toBe(yaw);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();

    windowListeners.get('mousemove')!({ movementX: 2, movementY: 0 });
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(input.camYaw).toBeCloseTo(yaw - 2 * 0.0045);
  });

  it('starts camera drag by hold duration even with small pointer movement', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { input, canvasListeners, windowListeners } = makeInput();
    const yaw = input.camYaw;

    canvasListeners.get('mousedown')!({ button: 2, clientX: 100, clientY: 100, preventDefault: vi.fn() });
    now += 150;
    windowListeners.get('mousemove')!({ movementX: 1, movementY: 0 });
    expect(input.isCameraDragActive()).toBe(true);
    expect(input.camYaw).toBe(yaw);

    windowListeners.get('mousemove')!({ movementX: 2, movementY: 0 });
    expect(input.camYaw).toBeCloseTo(yaw - 2 * 0.0045);
  });

  it('does not camera-drag with the mouse button bound to click-to-move', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { canvas, input, cb, canvasListeners, windowListeners } = makeInput();
    input.setClickMoveMouseButton(0);
    const yaw = input.camYaw;

    canvasListeners.get('mousedown')!({ button: 0, clientX: 120, clientY: 160, preventDefault: vi.fn() });
    now += 180;
    windowListeners.get('mousemove')!({ movementX: 40, movementY: 12 });
    expect(input.isCameraDragActive()).toBe(false);
    expect(input.camYaw).toBe(yaw);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();

    windowListeners.get('mouseup')!({ button: 0, clientX: 160, clientY: 172, target: canvas });
    expect(cb.onClickPick).toHaveBeenCalledWith(120, 160, 0);
  });

  it('allows the click-to-move mouse button to camera-drag after the click timer expires', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { canvas, input, cb, canvasListeners, windowListeners } = makeInput();
    input.setClickMoveMouseButton(2);
    const yaw = input.camYaw;

    canvasListeners.get('mousedown')!({ button: 2, clientX: 100, clientY: 100, preventDefault: vi.fn() });
    now += 281;
    windowListeners.get('mousemove')!({ movementX: 1, movementY: 0 });
    expect(input.isCameraDragActive()).toBe(true);
    expect(input.camYaw).toBe(yaw);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();

    windowListeners.get('mousemove')!({ movementX: 2, movementY: 0 });
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(input.camYaw).toBeCloseTo(yaw - 2 * 0.0045);

    windowListeners.get('mouseup')!({ button: 2, clientX: 103, clientY: 100, target: canvas });
    expect(cb.onClickPick).not.toHaveBeenCalled();
  });

  it('keeps camera drag available on the unbound mouse button', () => {
    const { canvas, input, canvasListeners, windowListeners } = makeInput();
    input.setClickMoveMouseButton(0);
    const yaw = input.camYaw;

    canvasListeners.get('mousedown')!({ button: 2, clientX: 100, clientY: 100, preventDefault: vi.fn() });
    windowListeners.get('mousemove')!({ movementX: 19, movementY: 0 });
    expect(input.isCameraDragActive()).toBe(true);
    expect(input.camYaw).toBe(yaw);
    windowListeners.get('mousemove')!({ movementX: 2, movementY: 0 });

    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(input.camYaw).toBeCloseTo(yaw - 2 * 0.0045);
  });
});

describe('Input context menu guard', () => {
  it('suppresses the native context menu while the game is active', () => {
    const { documentListeners } = makeInput();
    const preventDefault = vi.fn();

    documentListeners.get('contextmenu')!({
      target: { tagName: 'DIV', closest: () => null },
      preventDefault,
    });

    expect(preventDefault).toHaveBeenCalled();
  });

  it('does not suppress native context menus before entering the game', () => {
    const { documentListeners, setGameActive } = makeInput();
    const preventDefault = vi.fn();
    setGameActive(false);

    documentListeners.get('contextmenu')!({
      target: { tagName: 'DIV', closest: () => null },
      preventDefault,
    });

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('keeps native context menus available in editable controls', () => {
    const { documentListeners } = makeInput();
    const preventDefault = vi.fn();

    documentListeners.get('contextmenu')!({
      target: { tagName: 'INPUT', closest: () => null },
      preventDefault,
    });

    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe('Input mobile selection guard', () => {
  it('suppresses text selection during active mobile gameplay', () => {
    const { documentListeners, setMobileTouch } = makeInput();
    const preventDefault = vi.fn();
    setMobileTouch(true);

    documentListeners.get('selectstart')!({
      target: { tagName: 'DIV', closest: () => null },
      preventDefault,
    });

    expect(preventDefault).toHaveBeenCalled();
  });

  it('does not suppress selection before entering the game', () => {
    const { documentListeners, setGameActive, setMobileTouch } = makeInput();
    const preventDefault = vi.fn();
    setGameActive(false);
    setMobileTouch(true);

    documentListeners.get('selectstart')!({
      target: { tagName: 'DIV', closest: () => null },
      preventDefault,
    });

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('does not suppress selection on desktop', () => {
    const { documentListeners } = makeInput();
    const preventDefault = vi.fn();

    documentListeners.get('selectstart')!({
      target: { tagName: 'DIV', closest: () => null },
      preventDefault,
    });

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('keeps selection available in editable mobile controls', () => {
    const { documentListeners, setMobileTouch } = makeInput();
    const preventDefault = vi.fn();
    setMobileTouch(true);

    documentListeners.get('selectstart')!({
      target: { tagName: 'TEXTAREA', closest: () => null },
      preventDefault,
    });

    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe('Input Escape handling', () => {
  it('dispatches Escape even when modal UI blocks game keys', () => {
    const { cb, windowListeners } = makeInput();
    (cb as any).canUseGameKeys = vi.fn(() => false);

    windowListeners.get('keydown')!({ code: 'Escape', repeat: false });
    windowListeners.get('keydown')!({ code: 'KeyB', repeat: false });

    expect(cb.onUiKey).toHaveBeenCalledTimes(1);
    expect(cb.onUiKey).toHaveBeenCalledWith('escape');
  });
});

describe('Input Space handling', () => {
  it('prevents native Space button activation while preserving jump input', () => {
    const { input, windowListeners } = makeInput();
    (globalThis as any).document.activeElement = { tagName: 'BUTTON' };
    const preventDefault = vi.fn();

    windowListeners.get('keydown')!({ code: 'Space', repeat: false, preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(input.readMoveInput().jump).toBe(true);
  });
});

describe('Input attack move', () => {
  it('reserves only the attack-move key and keeps other movement keys working', () => {
    const { input, cb, windowListeners, canvasListeners } = makeInput();
    input.setAttackMoveEnabled(true);
    canvasListeners.get('mouseenter')!({});

    windowListeners.get('keydown')!({ code: 'KeyW', repeat: false });
    windowListeners.get('keydown')!({ code: 'KeyD', repeat: false });
    expect(input.readMoveInput().forward).toBe(true);
    expect(input.readMoveInput().turnRight).toBe(true);

    const preventDefault = vi.fn();
    windowListeners.get('keydown')!({ code: 'KeyA', repeat: false, preventDefault });

    expect(cb.onAttackMove).toHaveBeenCalledTimes(1);
    expect(input.readMoveInput().turnLeft).toBe(false);
    expect(input.readMoveInput().forward).toBe(true);
  });
});

describe('Input movement is not cancelled by a camera drag', () => {
  // Discord regression: walking with W (or any held key) then right/left-drag to
  // look around and releasing the button stopped movement, because exiting
  // pointer lock cleared the held keyboard keys.
  function walkAndDrag(button: number, windowListeners: Map<string, (e: any) => void>, canvasListeners: Map<string, (e: any) => void>, documentListeners: Map<string, (e: any) => void>) {
    windowListeners.get('keydown')!({ code: 'KeyW', repeat: false });        // hold forward
    canvasListeners.get('mousedown')!({ button });                           // press camera button
    windowListeners.get('mousemove')!({ movementX: 19, movementY: 0 });      // drag activates
    windowListeners.get('mousemove')!({ movementX: 1, movementY: 0 });       // drag → pointer lock
    (globalThis as any).document.pointerLockElement = (globalThis as any).document; // lock engaged
    windowListeners.get('mouseup')!({ button });                             // release → exitPointerLock
    (globalThis as any).document.pointerLockElement = null;                  // lock ends
    documentListeners.get('pointerlockchange')!({});                         // browser fires change
  }

  it('keeps walking forward after a right-drag ends', () => {
    const { input, windowListeners, canvasListeners, documentListeners } = makeInput();
    walkAndDrag(2, windowListeners, canvasListeners, documentListeners);
    expect(input.readMoveInput().forward).toBe(true);
  });

  it('keeps walking forward after a left-drag ends', () => {
    const { input, windowListeners, canvasListeners, documentListeners } = makeInput();
    walkAndDrag(0, windowListeners, canvasListeners, documentListeners);
    expect(input.readMoveInput().forward).toBe(true);
  });

  it('still forgets held keys on focus loss so movement cannot stick', () => {
    const { input, windowListeners } = makeInput();
    windowListeners.get('keydown')!({ code: 'KeyW', repeat: false });
    windowListeners.get('blur')!({});
    expect(input.readMoveInput().forward).toBe(false);
  });
});
describe('keyboard jump latch', () => {
  // A spacebar tap can be physically pressed and released entirely inside one
  // 50ms server-input window (or sim-tick gap), so the instantaneous key-held
  // read used to silently drop it: "every now and then jump stops working".
  // A keydown must latch the jump briefly, exactly like triggerTouchJump.
  it('latches a quick Space tap so a read after keyup still sees the jump', () => {
    const { input, windowListeners } = makeInput();
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    windowListeners.get('keydown')!({ code: 'Space', repeat: false, preventDefault: () => {} });
    windowListeners.get('keyup')!({ code: 'Space' }); // released almost immediately
    now.mockReturnValue(1010);
    expect(input.readMoveInput().jump).toBe(true);   // still inside the latch window
    now.mockReturnValue(1140);
    expect(input.readMoveInput().jump).toBe(true);
    now.mockReturnValue(1200);
    expect(input.readMoveInput().jump).toBe(false);  // latch expired
    now.mockRestore();
  });

  it('a held Space keeps jumping past the latch window', () => {
    const { input, windowListeners } = makeInput();
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    windowListeners.get('keydown')!({ code: 'Space', repeat: false, preventDefault: () => {} });
    now.mockReturnValue(5000); // long past any latch, key still physically held
    expect(input.readMoveInput().jump).toBe(true);
    windowListeners.get('keyup')!({ code: 'Space' });
    now.mockReturnValue(5200); // released and latch expired
    expect(input.readMoveInput().jump).toBe(false);
    now.mockRestore();
  });
});

describe('touch jump', () => {
  it('jump is off until the touch button arms it', () => {
    const { input } = makeInput();
    expect(input.readMoveInput().jump).toBe(false);
  });

  it('triggerTouchJump latches briefly so non-sim movement reads cannot consume it', () => {
    const { input } = makeInput();
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    input.triggerTouchJump();
    expect(input.readMoveInput().jump).toBe(true);
    expect(input.readMoveInput().jump).toBe(true);
    now.mockReturnValue(1219);
    expect(input.readMoveInput().jump).toBe(true);
    now.mockReturnValue(1221);
    expect(input.readMoveInput().jump).toBe(false);
    now.mockRestore();
  });
});

describe('Input emote wheel hold', () => {
  it('opens on the held binding and closes when the key is released', () => {
    const { windowListeners, cb } = makeInput();
    const preventDefault = vi.fn();

    windowListeners.get('keydown')!({ code: 'KeyX', repeat: false, preventDefault });
    expect(cb.onEmoteWheel).toHaveBeenLastCalledWith(true);
    expect(preventDefault).toHaveBeenCalled();

    windowListeners.get('keyup')!({ code: 'KeyX', preventDefault });
    expect(cb.onEmoteWheel).toHaveBeenLastCalledWith(false);
  });

  it('closes the wheel on focus loss', () => {
    const { windowListeners, cb } = makeInput();
    windowListeners.get('keydown')!({ code: 'KeyX', repeat: false, preventDefault: vi.fn() });

    windowListeners.get('blur')!({});

    expect(cb.onEmoteWheel).toHaveBeenLastCalledWith(false);
  });
});

describe('Input touch invert-look', () => {
  it('reverses the touch joystick pitch when inverted, leaving yaw alone', () => {
    const { input } = makeInput();
    input.setTouchLook(true);
    input.setTouchLookVector({ x: 1, y: 1 });

    const startPitch = input.camPitch;
    const startYaw = input.camYaw;
    input.updateTouchLook(1 / 60);
    const upDelta = input.camPitch - startPitch;
    const yawDelta = input.camYaw - startYaw;
    expect(upDelta).toBeGreaterThan(0); // default: stick up raises pitch

    input.setTouchInvertLook(true);
    input.camPitch = startPitch;
    input.camYaw = startYaw;
    input.updateTouchLook(1 / 60);
    expect(input.camPitch - startPitch).toBeCloseTo(-upDelta);
    // yaw is unaffected by the invert toggle
    expect(input.camYaw - startYaw).toBeCloseTo(yawDelta);
  });

  it('also inverts the swipe-look delta path', () => {
    const { input } = makeInput();
    const base = input.camPitch;
    input.applyTouchLookDelta(0, 100);
    const normal = input.camPitch - base;

    input.setTouchInvertLook(true);
    input.camPitch = base;
    input.applyTouchLookDelta(0, 100);
    expect(input.camPitch - base).toBeCloseTo(-normal);
  });
});
