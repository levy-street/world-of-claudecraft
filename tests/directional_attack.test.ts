import { describe, expect, it } from 'vitest';
import {
  entityCombatRadius,
  PLAYER_MELEE_CONE_HALF_ANGLE,
  playerAttackResolution,
  selectFirstTargetOnSegment,
  selectMeleeConeTargets,
} from '../src/sim/combat/directional_attack';
import { ABILITIES } from '../src/sim/data';

const candidate = (id: number, x: number, z: number, scale = 1) => ({
  id,
  pos: { x, z },
  scale,
});

describe('directional attack resolution', () => {
  it('classifies every authored ability into one explicit player resolution category', () => {
    const categories = new Set([
      'meleeCone',
      'ballisticProjectile',
      'directionalHitscan',
      'groundArea',
      'selfArea',
      'support',
      'lockOnActivation',
    ]);

    for (const ability of Object.values(ABILITIES)) {
      expect(categories.has(playerAttackResolution(ability)), ability.id).toBe(true);
    }
    expect(playerAttackResolution(ABILITIES.whirlwind)).toBe('selfArea');
    expect(playerAttackResolution(ABILITIES.charge)).toBe('lockOnActivation');
    expect(playerAttackResolution(ABILITIES.sport_shoulder)).toBe('lockOnActivation');
    expect(playerAttackResolution(ABILITIES.bloodhook)).toBe('lockOnActivation');
  });

  it('selects at most three melee targets in the 120-degree facing cone', () => {
    const selected = selectMeleeConeTargets({
      origin: { x: 0, z: 0 },
      facing: 0,
      range: 5,
      candidates: [
        candidate(9, 0, 4),
        candidate(4, 1, 3),
        candidate(7, -1, 3),
        candidate(2, 2, 3),
        candidate(1, 0, -2),
      ],
    });

    expect(PLAYER_MELEE_CONE_HALF_ANGLE).toBeCloseTo(Math.PI / 3, 8);
    expect(selected.map((entry) => entry.id)).toEqual([9, 4, 7]);
  });

  it('orders melee candidates by center-line angle, distance, then entity id', () => {
    const selected = selectMeleeConeTargets({
      origin: { x: 0, z: 0 },
      facing: 0,
      range: 8,
      candidates: [candidate(8, 0, 5), candidate(3, 0, 5), candidate(4, 0, 3)],
    });

    expect(selected.map((entry) => entry.id)).toEqual([4, 3, 8]);
  });

  it('selects the first hostile intersecting the aim segment, not a hard target farther away', () => {
    const selected = selectFirstTargetOnSegment({
      origin: { x: 0, z: 0 },
      angle: 0,
      maxDistance: 35,
      projectileRadius: 0.2,
      candidates: [candidate(20, 0, 24), candidate(10, 0, 8)],
    });

    expect(selected?.id).toBe(10);
  });

  it('clamps gameplay body radii to 0.5..2.0 yards', () => {
    expect(entityCombatRadius({ scale: 0.1 })).toBe(0.5);
    expect(entityCombatRadius({ scale: 2 })).toBe(1);
    expect(entityCombatRadius({ scale: 10 })).toBe(2);
  });
});
