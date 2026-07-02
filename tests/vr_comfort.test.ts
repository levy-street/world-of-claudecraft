import { describe, expect, it } from 'vitest';
import {
  initialSnapTurnState,
  pollSnapTurn,
  quatToYaw,
  tickSnapTurnCooldown,
  VR_SNAP_COOLDOWN_S,
  VR_SNAP_TURN_RAD,
  vrLocomotionFacing,
} from '../src/render/vr_comfort';

describe('pollSnapTurn', () => {
  it('fires once per stick flick and re-arms after neutral', () => {
    const state = initialSnapTurnState();
    expect(pollSnapTurn(0, state)).toBe(0);
    expect(pollSnapTurn(0.9, state)).toBe(-VR_SNAP_TURN_RAD);
    expect(pollSnapTurn(0.9, state)).toBe(0);
    expect(pollSnapTurn(0, state)).toBe(0);
    tickSnapTurnCooldown(state, VR_SNAP_COOLDOWN_S + 0.01);
    expect(pollSnapTurn(-0.9, state)).toBe(VR_SNAP_TURN_RAD);
  });

  it('respects cooldown', () => {
    const state = initialSnapTurnState();
    expect(pollSnapTurn(0.9, state)).toBe(-VR_SNAP_TURN_RAD);
    state.armed = true;
    state.cooldown = 0.1;
    expect(pollSnapTurn(0.9, state)).toBe(0);
    tickSnapTurnCooldown(state, 0.2);
    expect(pollSnapTurn(0.9, state)).toBe(-VR_SNAP_TURN_RAD);
  });
});

describe('quatToYaw', () => {
  it('extracts yaw from a Y-axis rotation quaternion', () => {
    const yaw = Math.PI / 4;
    const half = yaw / 2;
    expect(quatToYaw(0, Math.sin(half), 0, Math.cos(half))).toBeCloseTo(yaw, 5);
  });
});

describe('vrLocomotionFacing', () => {
  it('combines headset yaw and snap offset', () => {
    expect(vrLocomotionFacing(0.5, 0.25)).toBeCloseTo(0.75, 5);
  });
});
