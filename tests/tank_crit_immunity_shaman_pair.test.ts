// Shaman arm of the tank crit-immunity suite (shared fight helper in
// tank_crit_immunity_util.ts). The Warspirit commitment is the STONEBOUND
// posture, not the spec: a Stonebound-imbued Enhancement shaman is the tank
// (armor, damage reduction, doubled threat, jolt taunt), so creatures cannot
// critically strike it, while a Galeheart shaman keeps eating 2x mob crits.

import { describe, expect, it } from 'vitest';
import { STONEBOUND_WEAPON_ID } from '../src/sim/combat/shaman_warspirit';
import { critsTaken } from './tank_crit_immunity_util';

describe('tank crit immunity vs mobs (shaman)', () => {
  it('pins the Stonebound aura id the immunity predicate checks', () => {
    // tank_crit_immunity.ts is a pure leaf and carries the id as a literal;
    // this pin fails if the Warspirit module ever renames the posture aura.
    expect(STONEBOUND_WEAPON_ID).toBe('rockbiter_weapon');
  });

  it('a Stonebound Enhancement shaman is never critically hit', () => {
    expect(
      critsTaken({ cls: 'shaman', spec: 'enhancement', imbue: 'rockbiter_weapon' }).crits,
    ).toBe(0);
  });

  it('a Galeheart Enhancement shaman still eats mob crits: the posture is the commitment', () => {
    expect(
      critsTaken({ cls: 'shaman', spec: 'enhancement', imbue: 'galeheart_weapon' }).crits,
    ).toBeGreaterThan(0);
  });
});
