import { describe, expect, it } from 'vitest';
import {
  ACTION_COMBAT_CONE_HALF_ANGLE,
  abilityUsesActionCombatAim,
  selectActionCombatTarget,
} from '../src/sim/combat/action_combat_targeting';
import { ABILITIES } from '../src/sim/data';

const origin = { x: 0, z: 0 };

describe('action combat targeting', () => {
  it('prefers the target closest to the aim ray before raw distance', () => {
    const selected = selectActionCombatTarget({
      origin,
      aim: { x: 0, z: 10 },
      fallbackFacing: 0,
      maxRange: 30,
      candidates: [
        { id: 1, pos: { x: 1, z: 2 } },
        { id: 2, pos: { x: 0, z: 8 } },
      ],
    });
    expect(selected?.id).toBe(2);
  });

  it('rejects targets behind, beside, too near, or out of range', () => {
    const selected = selectActionCombatTarget({
      origin,
      aim: { x: 0, z: 10 },
      fallbackFacing: 0,
      minRange: 3,
      maxRange: 10,
      candidates: [
        { id: 1, pos: { x: 0, z: -4 } },
        { id: 2, pos: { x: 4, z: 0 } },
        { id: 3, pos: { x: 0, z: 2 } },
        { id: 4, pos: { x: 0, z: 11 } },
      ],
    });
    expect(selected).toBeNull();
    expect(ACTION_COMBAT_CONE_HALF_ANGLE).toBeLessThan(Math.PI / 2);
  });

  it('uses entity id as a deterministic final tie-break', () => {
    const selected = selectActionCombatTarget({
      origin,
      aim: { x: 0, z: 0 },
      fallbackFacing: 0,
      maxRange: 10,
      candidates: [
        { id: 9, pos: { x: 0, z: 5 } },
        { id: 3, pos: { x: 0, z: 5 } },
      ],
    });
    expect(selected?.id).toBe(3);
  });

  it('only enables aim substitution for offensive entity targets', () => {
    expect(abilityUsesActionCombatAim(ABILITIES.fireball)).toBe(true);
    expect(abilityUsesActionCombatAim(ABILITIES.holy_shock)).toBe(true);
    expect(abilityUsesActionCombatAim(ABILITIES.healing_touch)).toBe(false);
    expect(abilityUsesActionCombatAim(ABILITIES.flamestrike)).toBe(false);
    expect(abilityUsesActionCombatAim(ABILITIES.unleash_weapon)).toBe(false);
  });
});
