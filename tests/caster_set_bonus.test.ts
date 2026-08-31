// Caster lineage (the 2/4/6 retune): the 2-piece grants Int/Spi and HALF
// cast-pushback reduction (full immunity moved to the new raid tier's caster
// sets); the 4-piece, reached across tier-1 plus tier-2 pieces, grants +12
// spell power. It is NOT physical knockback resistance; that entity stat still
// works (the applyKnockback suite below pins it) but no shipped set grants it.
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

describe('caster lineage bonuses', () => {
  it('grants half pushback reduction at 2 pieces and spell power only at 4', () => {
    const two = aggregateSetBonuses(counts({ [SET_NECROMANCERS]: 2 }));
    expect(two.sp).toBe(0);
    expect(two.castPushbackReduction).toBe(0.5);
    expect(two.knockbackResistance).toBe(0); // spell pushback, never physical knockback
    // one piece: no tier yet
    const one = aggregateSetBonuses(counts({ [SET_NECROMANCERS]: 1 }));
    expect(one.sp).toBe(0);
    expect(one.castPushbackReduction).toBe(0);
  });

  it('folds the 4-piece +12 spell power into the wearer, across both tiers', () => {
    // Two tier-1 pieces plus two tier-2 pieces climb the SAME lineage ladder,
    // so the wearer reaches the 4-piece spell-power tier. No worn piece
    // carries flat spell power, so the wearer's spell power is exactly the
    // int-derived term plus the lineage +12 (an integer, so it commutes with
    // the rounding); a two-piece wearer has no flat term at all.
    const eq = {
      chest: 'necromancers_starshroud',
      feet: 'necromancers_soulsteps',
      helmet: 'soulflame_cowl',
      shoulder: 'soulflame_mantle',
    };
    const withSet = statsFor('mage', 20, eq);
    expect(withSet.castPushbackReduction).toBe(0.5);
    expect(withSet.spellPower).toBe(Math.round(withSet.stats.int * SPELL_POWER_PER_INT) + 12);
    const twoPieces = statsFor('mage', 20, {
      chest: 'necromancers_starshroud',
      feet: 'necromancers_soulsteps',
    });
    expect(twoPieces.spellPower).toBe(Math.round(twoPieces.stats.int * SPELL_POWER_PER_INT));
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
