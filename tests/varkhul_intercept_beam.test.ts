import { describe, expect, it } from 'vitest';
import {
  VARKHUL_INTERCEPT_BEAM_BLOCKED_DAMAGE_MAX_HP_HEROIC,
  VARKHUL_INTERCEPT_BEAM_BLOCKED_DAMAGE_MAX_HP_NORMAL,
  VARKHUL_INTERCEPT_BEAM_CAST_SECONDS,
  VARKHUL_INTERCEPT_BEAM_EVERY_SECONDS,
  VARKHUL_INTERCEPT_BEAM_FIRST_SECONDS,
  VARKHUL_INTERCEPT_BEAM_HALF_WIDTH,
  VARKHUL_INTERCEPT_BEAM_UNBLOCKED_DAMAGE_MAX_HP_HEROIC,
  VARKHUL_INTERCEPT_BEAM_UNBLOCKED_DAMAGE_MAX_HP_NORMAL,
  varkhulInterceptBeamBlocker,
  varkhulInterceptBeamDamageMaxHp,
} from '../src/sim/varkhul_intercept_beam';

const source = { x: 0, z: 0 };
const target = { x: 0, z: 20 };

describe('Varkhul intercept beam', () => {
  it('selects the first living body between Varkhul and the marked player', () => {
    const hit = varkhulInterceptBeamBlocker(source, target, 10, [
      { id: 14, x: 0.2, z: 14, dead: false },
      { id: 11, x: -0.3, z: 6, dead: false },
      { id: 12, x: 0, z: 4, dead: true },
      { id: 10, x: 0, z: 20, dead: false },
    ]);

    expect(VARKHUL_INTERCEPT_BEAM_HALF_WIDTH).toBe(1.35);
    expect(hit).toEqual({ blockerId: 11, x: 0, z: 6, progress: 0.3 });
  });

  it('rejects bodies outside the corridor and behind either endpoint', () => {
    expect(
      varkhulInterceptBeamBlocker(source, target, 10, [
        { id: 1, x: 1.36, z: 8, dead: false },
        { id: 2, x: 0, z: -2, dead: false },
        { id: 3, x: 0, z: 21, dead: false },
        { id: 10, x: 0, z: 10, dead: false },
      ]),
    ).toBeNull();
  });

  it('allows interception across the full corridor short of both endpoints', () => {
    expect(
      varkhulInterceptBeamBlocker(source, target, 10, [
        { id: 2, x: 0, z: 19.9, dead: false },
        { id: 1, x: 0, z: 0.1, dead: false },
      ]),
    ).toEqual({ blockerId: 1, x: 0, z: 0.1, progress: 0.005 });

    expect(
      varkhulInterceptBeamBlocker(source, target, 10, [{ id: 2, x: 0, z: 19.9, dead: false }]),
    ).toEqual({ blockerId: 2, x: 0, z: 19.9, progress: 0.995 });
  });

  it('uses player id as the deterministic tie break at equal beam progress', () => {
    expect(
      varkhulInterceptBeamBlocker(source, target, 10, [
        { id: 8, x: 0.5, z: 10, dead: false },
        { id: 4, x: -0.5, z: 10, dead: false },
      ]),
    ).toEqual({ blockerId: 4, x: 0, z: 10, progress: 0.5 });
  });

  it('recomputes the corridor from the marked player current position', () => {
    const candidates = [{ id: 4, x: 7, z: 7, dead: false }];
    expect(varkhulInterceptBeamBlocker(source, target, 10, candidates)).toBeNull();
    expect(varkhulInterceptBeamBlocker(source, { x: 14, z: 14 }, 10, candidates)).toEqual({
      blockerId: 4,
      x: 7,
      z: 7,
      progress: 0.5,
    });
  });

  it('pins the blocked and unblocked maximum-health damage on both difficulties', () => {
    expect(VARKHUL_INTERCEPT_BEAM_CAST_SECONDS).toBe(5);
    expect(VARKHUL_INTERCEPT_BEAM_FIRST_SECONDS).toBe(17);
    expect(VARKHUL_INTERCEPT_BEAM_EVERY_SECONDS).toBe(32);
    expect(VARKHUL_INTERCEPT_BEAM_BLOCKED_DAMAGE_MAX_HP_NORMAL).toBe(0.7);
    expect(VARKHUL_INTERCEPT_BEAM_BLOCKED_DAMAGE_MAX_HP_HEROIC).toBe(0.85);
    expect(VARKHUL_INTERCEPT_BEAM_UNBLOCKED_DAMAGE_MAX_HP_NORMAL).toBe(0.9);
    expect(VARKHUL_INTERCEPT_BEAM_UNBLOCKED_DAMAGE_MAX_HP_HEROIC).toBe(1.2);
    expect(varkhulInterceptBeamDamageMaxHp('normal', true)).toBe(0.7);
    expect(varkhulInterceptBeamDamageMaxHp('heroic', true)).toBe(0.85);
    expect(varkhulInterceptBeamDamageMaxHp('normal', false)).toBe(0.9);
    expect(varkhulInterceptBeamDamageMaxHp('heroic', false)).toBe(1.2);
  });
});
