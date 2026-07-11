// Caster tier-set 2-piece: grants +20 spell power (mirroring the +40 attack power
// the melee 2-sets give) AND 100% knockback resistance that ACTUALLY stops knockback
// (the bug: one applyKnockback caller passed a raw distance, so casters were still
// shoved and their casts interrupted; resistance is now applied centrally).
import { describe, expect, it } from 'vitest';
import { aggregateSetBonuses, SET_NECROMANCERS } from '../src/sim/content/item_sets';
import { MOBS } from '../src/sim/data';
import { createMob, createPlayer, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { type Entity, type PlayerClass, SPELL_POWER_PER_INT } from '../src/sim/types';

const counts = (m: Record<string, number>) => new Map(Object.entries(m));

function statsFor(cls: PlayerClass, level: number, equipment: Record<string, string>): Entity {
  const e = createPlayer(0, cls, { x: 0, y: 0, z: 0 }, '');
  e.level = level;
  recalcPlayerStats(e, cls, equipment as any, undefined, {});
  return e;
}

describe('caster set 2-piece bonus', () => {
  it('grants +20 spell power and 100% knockback resistance at 2 pieces', () => {
    const two = aggregateSetBonuses(counts({ [SET_NECROMANCERS]: 2 }));
    expect(two.sp).toBe(20);
    expect(two.knockbackResistance).toBe(1);
    // one piece: no 2-piece bonus yet
    const one = aggregateSetBonuses(counts({ [SET_NECROMANCERS]: 1 }));
    expect(one.sp).toBe(0);
    expect(one.knockbackResistance).toBe(0);
  });

  it('folds the +20 spell power into the wearer, on top of gear', () => {
    const eq = { chest: 'necromancers_starshroud', feet: 'necromancers_soulsteps' };
    const withSet = statsFor('mage', 20, eq);
    expect(withSet.knockbackResistance).toBe(1);
    // Neither piece carries flat spell power, so the wearer's spell power is
    // exactly the int-derived term plus the 2-piece flat +20 (an integer, so it
    // commutes with the rounding); a one-piece wearer has no flat term at all.
    // Together these pin that recalcPlayerStats actually folds the set bonus.
    expect(withSet.spellPower).toBe(Math.round(withSet.stats.int * SPELL_POWER_PER_INT) + 20);
    const onePiece = statsFor('mage', 20, { chest: 'necromancers_starshroud' });
    expect(onePiece.spellPower).toBe(Math.round(onePiece.stats.int * SPELL_POWER_PER_INT));
  });
});

describe('knockback resistance is honored (the fix)', () => {
  it('a fully-resistant target is not displaced and moves when resistance is removed', () => {
    const sim = new Sim({ seed: 7, playerClass: 'mage' });
    const p = sim.player;
    const src = createMob((sim as any).nextId++, MOBS.wild_boar, 5, {
      x: p.pos.x - 3,
      y: p.pos.y,
      z: p.pos.z,
    });

    // 100% resist: the shove is zeroed centrally, so the caster never moves.
    p.knockbackResistance = 1;
    const before = { x: p.pos.x, z: p.pos.z };
    const movedResisted = (sim as any).applyKnockback(src, p, 6);
    expect(movedResisted).toBe(0);
    expect(p.pos.x).toBe(before.x);
    expect(p.pos.z).toBe(before.z);

    // 0% resist: the same shove now displaces the target.
    p.knockbackResistance = 0;
    const movedUnresisted = (sim as any).applyKnockback(src, p, 6);
    expect(movedUnresisted).toBeGreaterThan(0);
    expect(p.pos.x === before.x && p.pos.z === before.z).toBe(false);
  });
});
