import { afterEach, expect, it, vi } from 'vitest';
import { GamepadManager } from '../src/game/gamepad';
import { GamepadBindings } from '../src/game/gamepad_bindings';
import { GP, STANDARD_BUTTON_COUNT } from '../src/game/gamepad_map';
import type { Input } from '../src/game/input';

afterEach(() => vi.unstubAllGlobals());

it('consumes vehicle edges and held buttons without class actions, movement or camera orbit', () => {
  let pressed: number[] = [];
  const pad = {
    axes: [0.5, 0, 1, 1],
    connected: true,
    id: 'test',
    index: 0,
    mapping: 'standard',
    get buttons() {
      return Array.from({ length: STANDARD_BUTTON_COUNT }, (_, i) => ({
        pressed: pressed.includes(i),
        value: pressed.includes(i) ? 1 : 0,
      }));
    },
  };
  vi.stubGlobal('navigator', { getGamepads: () => [pad] });
  const input = {
    clearGamepadMove: vi.fn(),
    setGamepadLookActive: vi.fn(),
    setAutorun: vi.fn(),
    applyGamepadLook: vi.fn(),
    setGamepadMove: vi.fn(),
    triggerGamepadJump: vi.fn(),
  };
  const cb = {
    onInputEdge: vi.fn(),
    onAction: vi.fn(),
    isPointerMode: () => false,
    isVehicleActive: () => true,
    isGroundAimActive: () => true,
    onVehicleSlot: vi.fn(),
    onVehicleExit: vi.fn(),
    onGroundAimCommit: vi.fn(),
    cancelGroundAim: vi.fn(),
    onGroundAimStick: vi.fn(),
    onGroundAimSnap: vi.fn(),
  };
  const manager = new GamepadManager(input as unknown as Input, new GamepadBindings(), cb);
  (manager as unknown as { index: number }).index = 0;
  for (const button of [GP.LB, GP.RB, GP.X, GP.A, GP.B, GP.BACK, GP.START, GP.L3, GP.LT]) {
    pressed = [];
    manager.poll(1 / 60);
    pressed = [button];
    manager.poll(1 / 60);
    manager.poll(1 / 60);
  }
  expect(cb.onVehicleSlot.mock.calls).toEqual([[0], [1], [2]]);
  expect(cb.onGroundAimCommit).toHaveBeenCalledTimes(1);
  expect(cb.cancelGroundAim).toHaveBeenCalledTimes(1);
  expect(cb.onVehicleExit).toHaveBeenCalledTimes(1);
  expect(cb.onAction.mock.calls).toEqual([['escape']]);
  expect(input.applyGamepadLook).not.toHaveBeenCalled();
  expect(input.setGamepadMove).not.toHaveBeenCalled();
  expect(input.triggerGamepadJump).not.toHaveBeenCalled();
  expect(cb.onGroundAimStick).toHaveBeenCalled();
});

it("hands the turret seat's own buttons over before the saved bindings (Y slams, LB arms)", () => {
  let pressed: number[] = [];
  const pad = {
    axes: [0, 0, 0, 0],
    connected: true,
    id: 'test',
    index: 0,
    mapping: 'standard',
    get buttons() {
      return Array.from({ length: STANDARD_BUTTON_COUNT }, (_, i) => ({
        pressed: pressed.includes(i),
        value: pressed.includes(i) ? 1 : 0,
      }));
    },
  };
  vi.stubGlobal('navigator', { getGamepads: () => [pad] });
  const input = {
    clearGamepadMove: vi.fn(),
    setGamepadLookActive: vi.fn(),
    setAutorun: vi.fn(),
    applyGamepadLook: vi.fn(),
    setGamepadMove: vi.fn(),
    triggerGamepadJump: vi.fn(),
  };
  // The turret owns the ground aim but is not the release cannon's vehicle seat.
  const cb = {
    onInputEdge: vi.fn(),
    onAction: vi.fn(),
    isPointerMode: () => false,
    isVehicleActive: () => false,
    isGroundAimActive: () => true,
    onGroundAimCommit: vi.fn(),
    cancelGroundAim: vi.fn(),
    onGroundAimStick: vi.fn(),
    onGroundAimSnap: vi.fn(),
    onSeatButton: vi.fn((button: number) => button === GP.Y || button === GP.LB),
  };
  const manager = new GamepadManager(input as unknown as Input, new GamepadBindings(), cb);
  (manager as unknown as { index: number }).index = 0;
  for (const button of [GP.Y, GP.LB, GP.A, GP.B]) {
    pressed = [];
    manager.poll(1 / 60);
    pressed = [button];
    manager.poll(1 / 60);
  }
  expect(cb.onSeatButton.mock.calls.map(([b]) => b)).toEqual([GP.Y, GP.LB, GP.A, GP.B]);
  // Y never jumps (nor cancels the aim on its way), A fires, B disarms.
  expect(input.triggerGamepadJump).not.toHaveBeenCalled();
  expect(cb.onAction).not.toHaveBeenCalled();
  expect(cb.onGroundAimCommit).toHaveBeenCalledTimes(1);
  expect(cb.cancelGroundAim).toHaveBeenCalledTimes(1);
});
