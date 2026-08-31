import { describe, expect, it } from 'vitest';
import {
  pointInVarkhulFrontal,
  VARKHUL_FRONTAL_CAST_SECONDS,
  VARKHUL_FRONTAL_HALF_ANGLE,
  VARKHUL_FRONTAL_RANGE,
  varkhulFrontalDamageMaxHp,
} from '../src/sim/varkhul_frontal';

describe('Varkhul Forgefather frontal', () => {
  it('pins the broad two-and-a-half-second actionable cone', () => {
    expect(VARKHUL_FRONTAL_CAST_SECONDS).toBe(2.5);
    expect(VARKHUL_FRONTAL_RANGE).toBe(42);
    expect(VARKHUL_FRONTAL_HALF_ANGLE).toBeCloseTo((Math.PI * 7) / 18, 8);
  });

  it('includes the exact cone edge and excludes points behind or beyond it', () => {
    const edge = VARKHUL_FRONTAL_HALF_ANGLE;
    expect(
      pointInVarkhulFrontal({ x: 0, z: 0 }, 0, { x: Math.sin(edge) * 20, z: Math.cos(edge) * 20 }),
    ).toBe(true);
    expect(
      pointInVarkhulFrontal({ x: 0, z: 0 }, 0, { x: Math.sin(edge) * 42, z: Math.cos(edge) * 42 }),
    ).toBe(true);
    const outsideEdge = edge + 0.001;
    expect(
      pointInVarkhulFrontal({ x: 0, z: 0 }, 0, {
        x: Math.sin(outsideEdge) * 20,
        z: Math.cos(outsideEdge) * 20,
      }),
    ).toBe(false);
    expect(pointInVarkhulFrontal({ x: 0, z: 0 }, 0, { x: 0, z: 42.01 })).toBe(false);
    expect(pointInVarkhulFrontal({ x: 0, z: 0 }, 0, { x: 0, z: -5 })).toBe(false);
  });

  it('deals 65 percent on Normal and 90 percent on Heroic', () => {
    expect(varkhulFrontalDamageMaxHp('normal')).toBe(0.65);
    expect(varkhulFrontalDamageMaxHp('heroic')).toBe(0.9);
  });
});
