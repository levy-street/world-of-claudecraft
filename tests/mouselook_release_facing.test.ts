import { describe, expect, it } from 'vitest';
import { mouselookReleaseFacing } from '../src/game/mouselook_release';

// Bug: holding right-mouse to rotate the camera, then briefly releasing, left the
// character a fraction of a turn behind the camera. Facing is only committed to
// the sim while mouselook is active (facing = camYaw each tick); the final slice
// of mouse motion since the last tick is dropped the instant mouselook turns off,
// so the model settles back to a stale facing and the camera later backtracks.
// The release frame must commit the final camera yaw exactly once.
describe('mouselookReleaseFacing', () => {
  it('commits the camera yaw on the mouselook falling edge', () => {
    expect(mouselookReleaseFacing(true, false, 1.23)).toBe(1.23);
  });

  it('returns null while mouselook stays engaged', () => {
    expect(mouselookReleaseFacing(true, true, 1.23)).toBeNull();
  });

  it('returns null while mouselook stays disengaged', () => {
    expect(mouselookReleaseFacing(false, false, 1.23)).toBeNull();
  });

  it('returns null on the rising edge (engaging, not releasing)', () => {
    expect(mouselookReleaseFacing(false, true, 1.23)).toBeNull();
  });

  it('passes a negative / wrapped yaw through unchanged on release', () => {
    expect(mouselookReleaseFacing(true, false, -2.5)).toBe(-2.5);
  });

  it('commits only on the edge: a held release does not re-fire next frame', () => {
    // frame N: release edge -> commit
    expect(mouselookReleaseFacing(true, false, 0.7)).toBe(0.7);
    // frame N+1: still disengaged -> no further commit (caller keeps prev=false)
    expect(mouselookReleaseFacing(false, false, 0.7)).toBeNull();
  });
});
