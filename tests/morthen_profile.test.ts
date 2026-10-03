import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  applyMorthenProfile,
  MORTHEN_SOLO_DAMAGE_MULT,
  MORTHEN_SOLO_HP_MULT,
  morthenLevel,
} from '../src/sim/graveyard_shift/morthen_profile';
import { mobBaseStats } from '../src/sim/mob_base_stats';

// A bare entity at Morthen's level stands in for the run owner after the
// recalc's no-gear pass.
function owner(hp = 200, maxHp = 400) {
  const e = createMob(1, MOBS.forest_wolf, morthenLevel(), { x: 0, y: 0, z: 0 });
  e.kind = 'player';
  e.hp = hp;
  e.maxHp = maxHp;
  e.attackPower = 99;
  e.spellPower = 99;
  e.critChance = 0.3;
  return e;
}

describe('Morthen profile (pure)', () => {
  it('lays the template under the solo multipliers over whatever the base pass left', () => {
    const e = owner();
    applyMorthenProfile(e, 200, 400, 'rage', 0);
    const base = mobBaseStats(MOBS.morthen, morthenLevel());
    expect(e.maxHp).toBe(base.maxHp * MORTHEN_SOLO_HP_MULT);
    expect(e.weapon).toEqual({
      min: base.weapon.min * MORTHEN_SOLO_DAMAGE_MULT,
      max: base.weapon.max * MORTHEN_SOLO_DAMAGE_MULT,
      speed: base.weapon.speed,
    });
    expect(e.stats.armor).toBe(base.armor);
    expect([e.attackPower, e.spellPower, e.critChance]).toEqual([0, 0, 0.05]);
  });

  it('carries the health fraction from the pool before the recalc', () => {
    const e = owner();
    applyMorthenProfile(e, 100, 400, 'rage', 0);
    expect(e.hp).toBe(Math.round(e.maxHp * 0.25));
  });

  it('keeps a dead owner at zero', () => {
    const e = owner();
    e.dead = true;
    applyMorthenProfile(e, 0, 400, 'rage', 0);
    expect(e.hp).toBe(0);
  });
});
