import { describe, expect, it } from 'vitest';
import { pointAlongCombatAim, resolveCombatAimIntent } from '../src/game/combat_aim';

describe('CombatAimIntent', () => {
  it('uses an arbitrarily distant cursor point only as a normalized direction', () => {
    const aim = resolveCombatAimIntent({
      player: { x: 4, z: 7 },
      facing: Math.PI,
      cursorPoint: { x: 4, z: 107 },
      useFacing: false,
    });

    expect(aim.source).toBe('cursor');
    expect(aim.angle).toBeCloseTo(0, 8);
    expect(aim.point).toEqual({ x: 4, z: 107 });
    expect(pointAlongCombatAim({ x: 4, z: 7 }, aim.angle, 35)).toEqual({ x: 4, z: 42 });
  });

  it('uses facing for RMB/Action Camera even when a cursor world point exists', () => {
    const aim = resolveCombatAimIntent({
      player: { x: 0, z: 0 },
      facing: Math.PI / 2,
      cursorPoint: { x: 0, z: 50 },
      useFacing: true,
    });

    expect(aim.source).toBe('facing');
    expect(aim.angle).toBeCloseTo(Math.PI / 2, 8);
  });

  it('falls back to current facing when no valid screen ray exists, never stale cursor aim', () => {
    const aim = resolveCombatAimIntent({
      player: { x: 3, z: 2 },
      facing: -Math.PI / 3,
      cursorPoint: null,
      useFacing: false,
    });

    expect(aim.source).toBe('facing');
    expect(aim.angle).toBeCloseTo(-Math.PI / 3, 8);
    expect(aim.point).toBeNull();
  });
});
