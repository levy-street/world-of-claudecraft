// Caster tier-set 2-piece: grants Intellect (mirroring the Strength and Agility
// the melee 2-sets give) AND 100% cast-pushback immunity: damage taken never
// delays the wearer's cast timer (castPushbackReduction 1 makes pushbackCast a
// no-op). It is NOT physical knockback resistance; that entity stat still works
// (the applyKnockback suite below pins it) but no shipped set grants it.
//
// The tier grants the ATTRIBUTE, not flat Spell Power, for the same reason the
// melee sets stopped granting flat attack power: a derived grant bypasses the
// budget the attribute would have been priced by. Spell Power costs two budget
// points per point at SPELL_POWER_PER_INT, so the old flat +20 priced this one
// tier at more than two epic chest pieces. tests/set_bonus_budget.test.ts owns
// that rule; this file pins that recalcPlayerStats folds the tier at all.
import { describe, expect, it } from 'vitest';
import { aggregateSetBonuses, SET_INT_2PC, SET_NECROMANCERS } from '../src/sim/content/item_sets';
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
  it('grants Intellect and 100% cast-pushback immunity at 2 pieces', () => {
    const two = aggregateSetBonuses(counts({ [SET_NECROMANCERS]: 2 }));
    expect(two.int).toBe(SET_INT_2PC);
    expect(two.sp).toBe(0); // the attribute, never flat Spell Power
    expect(two.castPushbackReduction).toBe(1);
    expect(two.knockbackResistance).toBe(0); // spell pushback, never physical knockback
    // one piece: no 2-piece bonus yet
    const one = aggregateSetBonuses(counts({ [SET_NECROMANCERS]: 1 }));
    expect(one.int).toBe(0);
    expect(one.castPushbackReduction).toBe(0);
  });

  it('folds the 2-piece Intellect into the wearer, on top of gear', () => {
    const eq = { chest: 'necromancers_starshroud', feet: 'necromancers_soulsteps' };
    const withSet = statsFor('mage', 20, eq);
    const onePiece = statsFor('mage', 20, { chest: 'necromancers_starshroud' });
    expect(withSet.castPushbackReduction).toBe(1);
    // Neither piece carries flat spell power, so the wearer's spell power is
    // exactly the int-derived term, and the set Intellect is already inside
    // stats.int. Pinning BOTH the Intellect delta and the derived spell power is
    // what proves recalcPlayerStats folded the set bonus rather than the items:
    // the two-piece wearer carries the second item's 8 Intellect plus the tier.
    expect(withSet.stats.int).toBe(onePiece.stats.int + 8 + SET_INT_2PC);
    expect(withSet.spellPower).toBe(Math.round(withSet.stats.int * SPELL_POWER_PER_INT));
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
