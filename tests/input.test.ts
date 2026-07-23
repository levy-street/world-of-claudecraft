import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from '../src/game/input';
import { stopAutorunForInteraction } from '../src/game/interaction_autorun';
import { Keybinds } from '../src/game/keybinds';

function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
}

function makeInput(userAgent?: string) {
  vi.stubGlobal('navigator', {
    userAgent: userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0',
  });
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
        contains: (cls: string) =>
          (cls === 'game-active' && gameActive) || (cls === 'mobile-touch' && mobileTouch),
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
    onPet: vi.fn(),
    onAbility: vi.fn(),
    onAbilityDown: vi.fn(),
    onAbilityUp: vi.fn(),
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
    setGameActive: (active: boolean) => {
      gameActive = active;
    },
    setMobileTouch: (active: boolean) => {
      mobileTouch = active;
    },
  };
}

beforeEach(() => {
  installStorage();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Input camera zoom', () => {
  it('zooms the camera with the mouse wheel on desktop', () => {
    const { canvasListeners, input } = makeInput();
    const preventDefault = vi.fn();

    canvasListeners.get('wheel')?.({ deltaY: 100, preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(input.camDist).toBeCloseTo(13.4);
  });

  it('ignores canvas wheel zoom while the mobile touch HUD is active', () => {
    const { canvasListeners, input, setMobileTouch } = makeInput();
    const preventDefault = vi.fn();
    setMobileTouch(true);

    canvasListeners.get('wheel')?.({ deltaY: 100, preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(input.camDist).toBe(12);
  });
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

  it('setAutorun idempotently syncs external analog latches', () => {
    const { input } = makeInput();
    expect(input.setAutorun(true)).toBe(true);
    expect(input.readMoveInput().forward).toBe(true);
    expect(input.setAutorun(false)).toBe(false);
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

  it('preserves newer click-to-move intent when a delayed interaction succeeds', async () => {
    const { input } = makeInput();
    input.setAutorun(true);
    let resolveOutcome!: (succeeded: boolean) => void;
    const outcome = new Promise<boolean>((resolve) => {
      resolveOutcome = resolve;
    });
    const syncAutorun = vi.fn();
    const stopped = stopAutorunForInteraction(outcome, input, { syncAutorun });

    input.setClickMoveTarget({ x: 4, z: 2 }, 0.5);
    resolveOutcome(true);

    await expect(stopped).resolves.toBe(false);
    expect(input.clickMoveGoal).toEqual({ x: 4, z: 2 });
    expect(syncAutorun).not.toHaveBeenCalled();
  });

  it('still stops autorun when a held strafe is released before the interaction outcome', async () => {
    const { input } = makeInput();
    input.setAutorun(true);
    input.setTouchMove({ forward: false, back: false, strafeLeft: true, strafeRight: false });
    let resolveOutcome!: (succeeded: boolean) => void;
    const outcome = new Promise<boolean>((resolve) => {
      resolveOutcome = resolve;
    });
    const syncAutorun = vi.fn();
    const stopped = stopAutorunForInteraction(outcome, input, { syncAutorun });

    input.clearTouchMove();
    resolveOutcome(true);

    await expect(stopped).resolves.toBe(true);
    expect(input.autorun).toBe(false);
    expect(syncAutorun).toHaveBeenCalledWith(false);
  });

  it('keeps autorun running while the Escape menu is open, then keeps running after close', () => {
    // The classic complaint: autorun, then hit Escape to change a keybind or a
    // setting. In a classic MMO the world never pauses, so the open menu must let
    // the latched autorun keep driving the player forward (you keep running while
    // you use the menu), not strand them in place for the duration of the menu.
    const { input } = makeInput();
    input.toggleAutorun();
    expect(input.readMoveInput().forward).toBe(true);

    input.setSuspendMovement(true); // mirrors main.ts setting it while the game menu is open
    expect(input.autorun).toBe(true); // latch untouched by the menu
    expect(input.readMoveInput().forward).toBe(true); // keeps running while suspended

    input.setSuspendMovement(false); // menu closed
    expect(input.autorun).toBe(true);
    expect(input.readMoveInput().forward).toBe(true); // still running
  });

  it('still suppresses a held movement key while suspended (menu keystrokes do not leak)', () => {
    // Suspending movement must keep protecting the world from raw key holds while
    // a modal/chat is focused; only the deliberate autorun latch is allowed to
    // keep moving. With no autorun engaged, a held forward key produces no motion.
    const { input, windowListeners } = makeInput();
    windowListeners.get('keydown')!({ code: 'KeyW', repeat: false }); // hold forward
    expect(input.readMoveInput().forward).toBe(true);

    input.setSuspendMovement(true); // game menu / chat open
    expect(input.autorun).toBe(false);
    expect(input.readMoveInput().forward).toBe(false); // held key is suppressed
  });

  it('drops stale held forward and jump state when movement suspension begins', () => {
    const { input, windowListeners } = makeInput();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    windowListeners.get('keydown')!({ code: 'KeyW', repeat: false });
    windowListeners.get('keydown')!({ code: 'Space', repeat: false, preventDefault: vi.fn() });
    expect(input.readMoveInput().forward).toBe(true);
    expect(input.readMoveInput().jump).toBe(true);

    input.setSuspendMovement(true);
    input.setSuspendMovement(false);
    now += 1;

    expect(input.debugState().keys).toEqual([]);
    expect(input.readMoveInput().forward).toBe(false);
    expect(input.readMoveInput().jump).toBe(false);
  });

  it('keeps autorun latched when suspension clears stale held key state', () => {
    const { input, windowListeners } = makeInput();
    input.toggleAutorun();
    windowListeners.get('keydown')!({ code: 'Space', repeat: false, preventDefault: vi.fn() });

    input.setSuspendMovement(true);
    input.setSuspendMovement(false);

    expect(input.autorun).toBe(true);
    expect(input.readMoveInput().forward).toBe(true);
    expect(input.debugState().keys).toEqual([]);
  });
});

describe('Input pet bar chords', () => {
  it('dispatches onPet for the default Ctrl+Digit pet chords and cancels the browser default', () => {
    const { input, windowListeners, cb } = makeInput();
    void input;
    const cases: Array<[string, string]> = [
      ['Digit1', 'attack'],
      ['Digit2', 'stop'],
      ['Digit3', 'taunt'],
      ['Digit4', 'defensive'],
      ['Digit5', 'aggressive'],
    ];
    for (const [code, action] of cases) {
      const preventDefault = vi.fn();
      windowListeners.get('keydown')!({ code, ctrlKey: true, repeat: false, preventDefault });
      expect(cb.onPet).toHaveBeenCalledWith(action);
      // The chord carries Ctrl, so the browser accelerator default is cancelled.
      expect(preventDefault).toHaveBeenCalled();
    }
  });

  it('does not fire a pet action for a bare digit (that stays an action-bar slot)', () => {
    const { input, windowListeners, cb } = makeInput();
    void input;
    windowListeners.get('keydown')!({ code: 'Digit1', repeat: false, preventDefault: vi.fn() });
    expect(cb.onPet).not.toHaveBeenCalled();
    expect(cb.onAbilityDown).toHaveBeenCalledWith(0); // Digit1 -> action bar slot 0
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
    input.setClickMoveTarget({ x: 3, z: 0 }, 0.5, 42, [
      { x: 1, z: 0 },
      { x: 3, z: 0 },
    ]);
    input.advanceClickMoveWaypoint();
    input.rerouteClickMoveTarget({ x: 8, z: 0 }, [
      { x: 5, z: 0 },
      { x: 8, z: 0 },
    ]);
    expect(input.clickMovePulse).toBe(1);
    expect(input.clickMoveGoal).toEqual({ x: 8, z: 0 });
    expect(input.clickMoveTarget).toEqual({ x: 5, z: 0 });
    expect(input.clickMovePathIndex).toBe(0);
  });

  it('clears path state when click-to-move stops', () => {
    const { input } = makeInput();
    input.setClickMoveTarget({ x: 3, z: 0 }, 0.5, null, [
      { x: 1, z: 0 },
      { x: 3, z: 0 },
    ]);
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

  it('does not request pointer lock for a quick right-click with sub-threshold jitter (#116)', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { canvas, canvasListeners, windowListeners } = makeInput();

    // A real click jitters a few pixels well under CAMERA_DRAG_START_DISTANCE
    // and releases before CAMERA_DRAG_START_MS: it must stay a click, never a
    // drag, so the browser pointer-capture banner is never shown.
    canvasListeners.get('mousedown')!({
      button: 2,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });
    now += 30;
    windowListeners.get('mousemove')!({ movementX: 3, movementY: 2 });
    now += 30;
    windowListeners.get('mouseup')!({ button: 2, clientX: 103, clientY: 102, target: canvas });

    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it('requests pointer lock the instant a press becomes an active drag (before any rotation)', () => {
    const { canvas, canvasListeners, windowListeners } = makeInput();

    canvasListeners.get('mousedown')!({ button: 2, clientX: 100, clientY: 100 });
    windowListeners.get('mousemove')!({ movementX: 10, movementY: 5 });
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    // This move crosses the drag threshold: lock must engage on the SAME frame so
    // rotation never begins with a free cursor that can escape the window.
    windowListeners.get('mousemove')!({ movementX: 4, movementY: 0 });
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);

    // Continuing the drag does not re-request (avoids re-showing the banner).
    windowListeners.get('mousemove')!({ movementX: 1, movementY: 0 });
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('requests pointer lock in Mouse Camera mode too (regression: cursor used to escape there)', () => {
    const { canvas, input, canvasListeners, windowListeners } = makeInput();
    input.setMouseCameraEnabled(true);

    canvasListeners.get('mousedown')!({
      button: 0,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });
    windowListeners.get('mousemove')!({ movementX: 10, movementY: 5 });
    windowListeners.get('mousemove')!({ movementX: 4, movementY: 0 });

    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('does not request pointer lock when "Lock Cursor While Rotating" is off', () => {
    const { canvas, input, canvasListeners, windowListeners } = makeInput();
    input.setLockCursorOnRotate(false);

    canvasListeners.get('mousedown')!({ button: 2, clientX: 100, clientY: 100 });
    windowListeners.get('mousemove')!({ movementX: 10, movementY: 5 });
    windowListeners.get('mousemove')!({ movementX: 4, movementY: 0 });
    windowListeners.get('mousemove')!({ movementX: 2, movementY: 0 });

    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it('requests pointer lock while browser fullscreen is active', () => {
    const { canvas, canvasListeners, windowListeners } = makeInput();
    (globalThis as any).document.fullscreenElement =
      (globalThis as any).document.documentElement ?? canvas;

    canvasListeners.get('mousedown')!({ button: 2, clientX: 100, clientY: 100 });
    windowListeners.get('mousemove')!({ movementX: 19, movementY: 0 });
    windowListeners.get('mousemove')!({ movementX: 1, movementY: 0 });

    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('on Firefox, requests pointer lock synchronously from mousedown for the camera-look button (#1834)', () => {
    // Firefox denies requestPointerLock() when it is deferred to a later
    // mousemove once the drag threshold is crossed, so on Firefox the request
    // must happen inside the mousedown handler itself, before any movement.
    const { canvas, canvasListeners } = makeInput(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    );

    canvasListeners.get('mousedown')!({
      button: 2,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });

    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('on Firefox, does not request pointer lock on mousedown for the click-to-move button', () => {
    const { canvas, input, canvasListeners } = makeInput(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    );
    input.setClickMoveMouseButton(0);

    canvasListeners.get('mousedown')!({
      button: 0,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });

    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it('on Firefox in classic camera mode, requests pointer lock synchronously for a LEFT drag too (blocking regression #1840)', () => {
    // Classic mode still lets either button start a camera drag (leftDown ||
    // rightDown in onMouseMove); the synchronous Firefox request must cover
    // left, not only the mode's nominal look button (right, in classic mode).
    const { canvas, canvasListeners } = makeInput(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    );

    canvasListeners.get('mousedown')!({
      button: 0,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });

    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('on Firefox in Mouse Camera mode, requests pointer lock synchronously for button 0', () => {
    const { canvas, input, canvasListeners } = makeInput(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    );
    input.setMouseCameraEnabled(true);

    canvasListeners.get('mousedown')!({
      button: 0,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });

    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('on Firefox in Mouse Camera mode, requests pointer lock synchronously for a RIGHT drag too (blocking regression #1840)', () => {
    const { canvas, input, canvasListeners } = makeInput(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    );
    input.setMouseCameraEnabled(true);

    canvasListeners.get('mousedown')!({
      button: 2,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });

    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('on Firefox, does not request pointer lock on mousedown when "Lock Cursor While Rotating" is off', () => {
    const { canvas, input, canvasListeners } = makeInput(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    );
    input.setLockCursorOnRotate(false);

    canvasListeners.get('mousedown')!({
      button: 2,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });

    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it('on Firefox, a pointerlockerror alone starts the forced-unlock cooldown (review followup on #2131)', () => {
    // A denied requestPointerLock() is itself the strongest evidence we are in
    // Firefox's post-forced-unlock cooldown, even when the pointerlockchange
    // handler never got a chance to record it (e.g. the drag flags were
    // already cleared, such as by a blur ordering ahead of the unlock event).
    // The pointerlockerror handler must record forcedUnlockAt too, so the very
    // next synchronous mousedown request during the cooldown is skipped
    // instead of firing again and getting denied a second time.
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { canvas, documentListeners, canvasListeners } = makeInput(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    );

    canvasListeners.get('mousedown')!({
      button: 2,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);

    documentListeners.get('pointerlockerror')!({});

    now += 200;
    canvasListeners.get('mousedown')!({
      button: 2,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('on Chrome, does not request pointer lock synchronously on mousedown (deferred path keeps #116 fixed)', () => {
    const { canvas, canvasListeners } = makeInput(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    );

    canvasListeners.get('mousedown')!({
      button: 2,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });

    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it('exits pointer lock if the async grant lands after mouseup already released (should-fix regression #1840)', () => {
    // A fast click can beat requestPointerLock()'s async resolution: mouseup
    // runs first (nothing to release yet, since pointerLockElement is still
    // null), then the grant lands late via pointerlockchange with no button
    // held. Without the pointerlockchange guard the canvas would stay locked
    // with no drag active until the next press/release cycle.
    const { canvas, documentListeners, canvasListeners, windowListeners } = makeInput(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    );

    canvasListeners.get('mousedown')!({
      button: 2,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);

    windowListeners.get('mouseup')!({ button: 2, clientX: 100, clientY: 100, target: canvas });
    expect((globalThis as any).document.exitPointerLock).not.toHaveBeenCalled();

    (globalThis as any).document.pointerLockElement = canvas;
    documentListeners.get('pointerlockchange')!({});

    expect((globalThis as any).document.exitPointerLock).toHaveBeenCalledTimes(1);
  });

  it('keeps the lock when the grant lands while the button is still held', () => {
    const { canvas, documentListeners, canvasListeners } = makeInput(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    );

    canvasListeners.get('mousedown')!({
      button: 2,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });

    (globalThis as any).document.pointerLockElement = canvas;
    documentListeners.get('pointerlockchange')!({});

    expect((globalThis as any).document.exitPointerLock).not.toHaveBeenCalled();
  });

  it('does not rotate the camera before the drag threshold, so short sloppy clicks stay stable', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { canvas, input, cb, canvasListeners, windowListeners } = makeInput();
    const yaw = input.camYaw;
    const pitch = input.camPitch;

    canvasListeners.get('mousedown')!({
      button: 0,
      clientX: 120,
      clientY: 160,
      preventDefault: vi.fn(),
    });
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
    const now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { canvas, input, canvasListeners, windowListeners } = makeInput();
    const yaw = input.camYaw;

    canvasListeners.get('mousedown')!({
      button: 2,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });
    windowListeners.get('mousemove')!({ movementX: 10, movementY: 5 });
    windowListeners.get('mousemove')!({ movementX: 4, movementY: 0 });
    expect(input.isCameraDragActive()).toBe(true);
    // The threshold-crossing movement is still discarded (no rotation jump), but
    // the lock now engages on this frame so the cursor is captured immediately.
    expect(input.camYaw).toBe(yaw);
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);

    windowListeners.get('mousemove')!({ movementX: 2, movementY: 0 });
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(input.camYaw).toBeCloseTo(yaw - 2 * 0.0045);
  });

  it('starts camera drag by hold duration even with small pointer movement', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { input, canvasListeners, windowListeners } = makeInput();
    const yaw = input.camYaw;

    canvasListeners.get('mousedown')!({
      button: 2,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });
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

    canvasListeners.get('mousedown')!({
      button: 0,
      clientX: 120,
      clientY: 160,
      preventDefault: vi.fn(),
    });
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

    canvasListeners.get('mousedown')!({
      button: 2,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });
    now += 281;
    windowListeners.get('mousemove')!({ movementX: 1, movementY: 0 });
    expect(input.isCameraDragActive()).toBe(true);
    expect(input.camYaw).toBe(yaw);
    // Lock engages on the activation frame (the click timer has expired).
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);

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

    canvasListeners.get('mousedown')!({
      button: 2,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });
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

  it('ignores repeated Escape keydown events so holding the menu key cannot retoggle', () => {
    const { cb, windowListeners } = makeInput();

    windowListeners.get('keydown')!({ code: 'Escape', repeat: false });
    windowListeners.get('keydown')!({ code: 'Escape', repeat: true });

    expect(cb.onUiKey).toHaveBeenCalledTimes(1);
    expect(cb.onUiKey).toHaveBeenCalledWith('escape');
  });
});

describe('Input Discord keybind', () => {
  it("dispatches onUiKey('discord') for the default U key", () => {
    const { cb, windowListeners } = makeInput();

    windowListeners.get('keydown')!({ code: 'KeyU', repeat: false });

    expect(cb.onUiKey).toHaveBeenCalledWith('discord');
  });

  it('is a normal interface key: suppressed while a modal blocks game keys', () => {
    const { cb, windowListeners } = makeInput();
    (cb as any).canUseGameKeys = vi.fn(() => false);

    windowListeners.get('keydown')!({ code: 'KeyU', repeat: false });

    expect(cb.onUiKey).not.toHaveBeenCalled();
  });
});

describe('Input Book of Deeds keybind', () => {
  it("dispatches onUiKey('deeds') for the default Shift+Z chord", () => {
    const { cb, windowListeners } = makeInput();

    windowListeners.get('keydown')!({ code: 'KeyZ', repeat: false, shiftKey: true });

    expect(cb.onUiKey).toHaveBeenCalledWith('deeds');
  });

  it('bare KeyZ no longer reaches deeds (Damage Meters owns the letter now)', () => {
    const { cb, windowListeners } = makeInput();

    windowListeners.get('keydown')!({ code: 'KeyZ', repeat: false });

    expect(cb.onUiKey).not.toHaveBeenCalledWith('deeds');
  });

  it('is a normal interface key: suppressed while a modal blocks game keys', () => {
    const { cb, windowListeners } = makeInput();
    (cb as any).canUseGameKeys = vi.fn(() => false);

    windowListeners.get('keydown')!({ code: 'KeyZ', repeat: false, shiftKey: true });

    expect(cb.onUiKey).not.toHaveBeenCalled();
  });
});

describe('Input chat keybind', () => {
  it("dispatches onUiKey('chat') for the default Enter key", () => {
    const { cb, windowListeners } = makeInput();

    windowListeners.get('keydown')!({ code: 'Enter', repeat: false, preventDefault: vi.fn() });

    expect(cb.onUiKey).toHaveBeenCalledWith('chat');
  });

  it('cancels the default action so the newly-focused composer does not also see this keydown as a newline', () => {
    // Regression: opening chat focuses the composer textarea as a side effect
    // of this very keydown. Left un-prevented, the browser still delivers the
    // follow-up keypress/input (and its default newline insertion) to
    // whichever element is now focused, so Enter both opened chat AND typed a
    // newline into it before the placeholder was ever visible.
    const { windowListeners } = makeInput();
    const preventDefault = vi.fn();

    windowListeners.get('keydown')!({ code: 'Enter', repeat: false, preventDefault });

    expect(preventDefault).toHaveBeenCalled();
  });

  it('does not cancel a focused button own Enter activation when it also opens chat', () => {
    // A focused button (e.g. a HUD button reached via Tab) still activates on
    // Enter today; only the composer-newline case needs its default cancelled.
    const { cb, windowListeners } = makeInput();
    (globalThis as any).document.activeElement = { tagName: 'BUTTON' };
    const preventDefault = vi.fn();

    windowListeners.get('keydown')!({ code: 'Enter', repeat: false, preventDefault });

    expect(cb.onUiKey).toHaveBeenCalledWith('chat');
    expect(preventDefault).not.toHaveBeenCalled();
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
  function walkAndDrag(
    button: number,
    windowListeners: Map<string, (e: any) => void>,
    canvasListeners: Map<string, (e: any) => void>,
    documentListeners: Map<string, (e: any) => void>,
  ) {
    windowListeners.get('keydown')!({ code: 'KeyW', repeat: false }); // hold forward
    canvasListeners.get('mousedown')!({ button }); // press camera button
    windowListeners.get('mousemove')!({ movementX: 19, movementY: 0 }); // drag activates
    windowListeners.get('mousemove')!({ movementX: 1, movementY: 0 }); // drag → pointer lock
    (globalThis as any).document.pointerLockElement = (globalThis as any).document; // lock engaged
    windowListeners.get('mouseup')!({ button }); // release → exitPointerLock
    (globalThis as any).document.pointerLockElement = null; // lock ends
    documentListeners.get('pointerlockchange')!({}); // browser fires change
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
    expect(input.readMoveInput().jump).toBe(true); // still inside the latch window
    now.mockReturnValue(1140);
    expect(input.readMoveInput().jump).toBe(true);
    now.mockReturnValue(1200);
    expect(input.readMoveInput().jump).toBe(false); // latch expired
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

  it('stays open when its own modal state suspends movement', () => {
    // Regression (v0.20.0): the open emote wheel counts toward hud.isModalOpen(),
    // which main.ts feeds into setSuspendMovement every frame. The stale-input
    // clear then closed the wheel one frame after the bound key opened it, so
    // the X hotkey wheel flashed and vanished. Held wheel keys are never stale:
    // onKeyUp is not modal-gated and releaseCapture covers focus loss.
    const { cb, input, windowListeners } = makeInput();

    windowListeners.get('keydown')!({ code: 'KeyX', repeat: false, preventDefault: vi.fn() });
    expect(cb.onEmoteWheel).toHaveBeenCalledWith(true);

    input.setSuspendMovement(true); // mirrors the frame loop reacting to the open wheel
    expect(cb.onEmoteWheel).not.toHaveBeenCalledWith(false); // wheel stays open

    windowListeners.get('keyup')!({ code: 'KeyX', preventDefault: vi.fn() });
    expect(cb.onEmoteWheel).toHaveBeenCalledWith(false); // release still closes it
  });

  it('resumes held movement after the wheel closes instead of going stale', () => {
    // Classic flow: run with W held, flick X to emote, keep running. The
    // wheel-caused suspension must not clear the still-held movement keys.
    const { input, windowListeners } = makeInput();

    windowListeners.get('keydown')!({ code: 'KeyW', repeat: false });
    windowListeners.get('keydown')!({ code: 'KeyX', repeat: false, preventDefault: vi.fn() });
    input.setSuspendMovement(true); // the open wheel is the modal that suspends
    expect(input.readMoveInput().forward).toBe(false); // movement frozen while the wheel is up

    windowListeners.get('keyup')!({ code: 'KeyX', preventDefault: vi.fn() });
    input.setSuspendMovement(false); // wheel closed, modal gone

    expect(input.readMoveInput().forward).toBe(true); // W never went stale
  });
});

describe('Input modifier combos', () => {
  it('fires the bare action-bar slot, but not when a modifier is held', () => {
    const { windowListeners, cb } = makeInput();
    windowListeners.get('keydown')!({ code: 'Digit1', repeat: false }); // slot0 = Attack
    expect(cb.onAbilityDown).toHaveBeenLastCalledWith(0);
    cb.onAbilityDown.mockClear();
    // Shift+1 is a distinct, unbound chord: it must NOT fire bare slot 0.
    windowListeners.get('keydown')!({ code: 'Digit1', repeat: false, shiftKey: true });
    expect(cb.onAbilityDown).not.toHaveBeenCalled();
  });

  it('dispatches a slot bound to Shift+1 only on the Shift chord', () => {
    // persist a Shift+1 binding, then build the Input so its Keybinds loads it
    const kb = new Keybinds();
    expect(kb.bind('slot5', 0, 'Shift+Digit1')).toBe(true);
    const { windowListeners, cb } = makeInput();
    windowListeners.get('keydown')!({ code: 'Digit1', repeat: false, shiftKey: true });
    expect(cb.onAbilityDown).toHaveBeenLastCalledWith(5);
    cb.onAbilityDown.mockClear();
    // bare 1 still drives its own slot, unaffected by the modified binding
    windowListeners.get('keydown')!({ code: 'Digit1', repeat: false });
    expect(cb.onAbilityDown).toHaveBeenLastCalledWith(0);
  });

  it('keeps movement working while a modifier is held (Shift+W still walks)', () => {
    const { input, windowListeners } = makeInput();
    windowListeners.get('keydown')!({ code: 'KeyW', repeat: false, shiftKey: true });
    expect(input.readMoveInput().forward).toBe(true);
  });

  it('ignores a lone modifier keypress', () => {
    const { input, cb, windowListeners } = makeInput();
    windowListeners.get('keydown')!({ code: 'ShiftLeft', repeat: false });
    expect(cb.onAbilityDown).not.toHaveBeenCalled();
    expect(cb.onUiKey).not.toHaveBeenCalled();
    expect(input.readMoveInput().forward).toBe(false);
  });

  it('still polls a movement key even if storage holds a stray modifier combo for it', () => {
    // Defensive: bind() strips modifiers from held actions, but hand-edited or
    // corrupt storage could carry one. The per-frame poll must still match the
    // bare physical key so movement cannot silently wedge.
    localStorage.setItem('woc_keybinds', JSON.stringify({ forward: ['Shift+KeyW', null] }));
    const { input, windowListeners } = makeInput();
    windowListeners.get('keydown')!({ code: 'KeyW', repeat: false });
    expect(input.readMoveInput().forward).toBe(true);
  });

  it('fires a held action and a distinct edge chord on the same press', () => {
    // KeyX is the held emote-wheel key; also bind Shift+X to an ability slot.
    // One Shift+X press must open the wheel (held, bare key) AND fire the slot
    // (edge, full chord): the intentional held+edge co-fire.
    const kb = new Keybinds();
    expect(kb.bind('slot3', 0, 'Shift+KeyX')).toBe(true);
    const { windowListeners, cb } = makeInput();
    windowListeners.get('keydown')!({
      code: 'KeyX',
      repeat: false,
      shiftKey: true,
      preventDefault: vi.fn(),
    });
    expect(cb.onEmoteWheel).toHaveBeenLastCalledWith(true); // held fired
    expect(cb.onAbilityDown).toHaveBeenLastCalledWith(3); // edge chord fired
  });

  it('folds Cmd/Meta into the chord, so Cmd+1 does not fire bare slot 0', () => {
    // Bind Meta+1 to a slot; capture and dispatch both read e.metaKey, so the
    // Cmd chord fires its own slot and never steals the bare-1 slot.
    const kb = new Keybinds();
    expect(kb.bind('slot7', 0, 'Meta+Digit1')).toBe(true);
    const { windowListeners, cb } = makeInput();
    windowListeners.get('keydown')!({ code: 'Digit1', repeat: false, metaKey: true });
    expect(cb.onAbilityDown).toHaveBeenLastCalledWith(7);
    cb.onAbilityDown.mockClear();
    // bare 1 still drives slot 0, unaffected by the Cmd binding
    windowListeners.get('keydown')!({ code: 'Digit1', repeat: false });
    expect(cb.onAbilityDown).toHaveBeenLastCalledWith(0);
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
    input.applyTouchLookDelta(0, 20);
    const normal = input.camPitch - base;

    input.setTouchInvertLook(true);
    input.camPitch = base;
    input.applyTouchLookDelta(0, 20);
    expect(input.camPitch - base).toBeCloseTo(-normal);
  });

  it('scales the swipe-drag yaw noticeably above raw look sensitivity', () => {
    const { input } = makeInput();
    const baseYaw = input.camYaw;
    input.applyTouchLookDelta(100, 0);
    const dragYawDelta = Math.abs(input.camYaw - baseYaw);
    const rawYawDelta = 100 * 0.0045; // BASE_LOOK_SENS, mirrored here since it is not exported

    expect(dragYawDelta).toBeGreaterThan(rawYawDelta * 1.5);
  });
});
