import { describe, expect, it } from 'vitest';
import { Input } from '../src/game/input';
import { Keybinds } from '../src/game/keybinds';
import { ClientWorld } from '../src/net/online';
import { normalizeMoveFacing, parseMoveInputFrame, sanitizeMoveInput } from '../src/sim/move_input';

describe('movement input sanitizing', () => {
  it('accepts compact websocket flags and long controller flags', () => {
    expect(sanitizeMoveInput({ f: 1, turnRight: true, sr: 1 })).toEqual({
      forward: true,
      back: false,
      turnLeft: false,
      turnRight: true,
      strafeLeft: false,
      strafeRight: true,
      jump: false,
    });
  });

  it('rejects truthy non-protocol values and non-finite facing', () => {
    const parsed = parseMoveInputFrame({
      t: 'input',
      mi: { f: '1', b: {}, tl: true, tr: 1, sl: 0, sr: false, j: 'true' },
      facing: Infinity,
    });

    expect(parsed.moveInput).toEqual({
      forward: false,
      back: false,
      turnLeft: true,
      turnRight: true,
      strafeLeft: false,
      strafeRight: false,
      jump: false,
    });
    expect(parsed.facing).toBeNull();
  });

  it('preserves accumulated finite facing values', () => {
    const parsed = parseMoveInputFrame({ t: 'input', mi: {}, facing: Math.PI * 3 });

    expect(parsed.facing).toBeCloseTo(Math.PI * 3);
  });

  it('rejects huge finite facing values', () => {
    const parsed = parseMoveInputFrame({ t: 'input', mi: {}, facing: 1e9 });

    expect(parsed.facing).toBeNull();
  });

  it('normalizes accumulated local yaw without looping', () => {
    expect(normalizeMoveFacing(Math.PI * 401)).toBeCloseTo(Math.PI);
    expect(normalizeMoveFacing(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('agent movement channel', () => {
  it('lets controller movement win over held keyboard state without mutating the stored intent', () => {
    const input: any = Object.create(Input.prototype);
    input.keys = new Set<string>();
    input.leftDown = false;
    input.rightDown = false;
    input.autorun = false;
    input.suspendMovement = false;
    input.keybinds = new Keybinds();
    input.controllerMoveInput = null;
    input.controllerFacing = null;
    input.touchMove = { forward: false, back: false, strafeLeft: false, strafeRight: false };
    input.gamepadMove = { forward: false, back: false, strafeLeft: false, strafeRight: false };

    input.keys.add('KeyW');
    expect(input.readMoveInput().forward).toBe(true);

    input.setControllerMoveInput({ strafeLeft: true }, 8);
    input.setControllerMoveInput({ forward: true });

    expect(input.controllerFacingOverride()).toBe(8);

    const first = input.readMoveInput();
    first.forward = false;

    expect(input.readMoveInput()).toEqual({
      forward: true,
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
      jump: false,
    });
    expect(input.controllerFacingOverride()).toBe(8);

    input.clearControllerMoveInput();
    expect(input.readMoveInput().forward).toBe(true);
    expect(input.controllerFacingOverride()).toBeNull();
  });

  it('sanitizes ClientWorld movement before it reaches the websocket sender', () => {
    const client: any = Object.create(ClientWorld.prototype);
    client.moveInput = {
      forward: false,
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
      jump: false,
    };
    client.mouselookFacing = null;

    client.setMoveInput({ f: '1', forward: true, sr: 1, jump: 'yes' }, Number.NaN);

    expect(client.moveInput).toEqual({
      forward: true,
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: true,
      jump: false,
    });
    expect(client.mouselookFacing).toBeNull();

    client.setMouselookFacing(Math.PI * 401);

    expect(client.mouselookFacing).toBeCloseTo(Math.PI);
  });
});
