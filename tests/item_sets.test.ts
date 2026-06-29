import { describe, expect, it } from 'vitest';
import {
  aggregateSetBonuses,
  ITEM_SETS,
  SET_CROWNFORGED,
  SET_DEATHLORD,
  SET_NECROMANCERS,
  SET_NIGHTTALON,
  SET_WYRMSHADOW,
} from '../src/sim/content/item_sets';
import { createPlayer, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';
import { CAST_PUSHBACK_SEC, CHANNEL_PUSHBACK_FRACTION } from '../src/sim/types';
import { itemSetTooltipModel } from '../src/ui/item_set_tooltip_view';

const counts = (m: Record<string, number>) => new Map(Object.entries(m));

function statsFor(cls: PlayerClass, level: number, equipment: Record<string, string>): Entity {
  const e = createPlayer(0, cls, { x: 0, y: 0, z: 0 }, '');
  e.level = level;
  recalcPlayerStats(e, cls, equipment as any);
  return e;
}

describe('aggregateSetBonuses (pure resolver)', () => {
  it('grants nothing below the 2-piece threshold', () => {
    const eff = aggregateSetBonuses(counts({ [SET_DEATHLORD]: 1 }));
    expect(eff).toEqual({
      str: 0,
      agi: 0,
      sta: 0,
      int: 0,
      spi: 0,
      ap: 0,
      crit: 0,
      castPushbackReduction: 0,
    });
  });

  it('strength set: 2pc grants AP, 3pc additionally grants str+sta (tiers stack)', () => {
    const two = aggregateSetBonuses(counts({ [SET_DEATHLORD]: 2 }));
    expect(two.ap).toBe(40);
    expect(two.str).toBe(0);
    const three = aggregateSetBonuses(counts({ [SET_DEATHLORD]: 3 }));
    expect(three.ap).toBe(40); // 2pc bonus still active
    expect(three.str).toBe(15);
    expect(three.sta).toBe(15);
  });

  it('agility set: 2pc grants AP, 3pc additionally grants agi+crit', () => {
    const two = aggregateSetBonuses(counts({ [SET_WYRMSHADOW]: 2 }));
    expect(two.ap).toBe(40);
    const three = aggregateSetBonuses(counts({ [SET_WYRMSHADOW]: 3 }));
    expect(three.ap).toBe(40);
    expect(three.agi).toBe(15);
    expect(three.crit).toBeCloseTo(0.02);
  });

  it('caster set: 2pc = 50% pushback reduction, 3pc = 100% (max-combine, never sums past 1)', () => {
    expect(aggregateSetBonuses(counts({ [SET_NECROMANCERS]: 2 })).castPushbackReduction).toBe(0.5);
    expect(aggregateSetBonuses(counts({ [SET_NECROMANCERS]: 3 })).castPushbackReduction).toBe(1);
  });

  it('every set definition lists ascending 2- and 3-piece tiers', () => {
    for (const set of Object.values(ITEM_SETS)) {
      expect(set.bonuses.map((b) => b.pieces)).toEqual([2, 3]);
    }
  });
});

describe('item set tooltip model', () => {
  it('uses the authored member count, not the highest bonus threshold, as the header total', () => {
    const model = itemSetTooltipModel({
      itemSetId: SET_DEATHLORD,
      equippedPieces: 2,
      itemSetMembers: {
        [SET_DEATHLORD]: 4,
      },
    });
    expect(model?.totalPieces).toBe(4);
    expect(model?.bonusTiers.map((tier) => tier.pieces)).toEqual([2, 3]);
  });

  it('hides bonus tiers that cannot be reached by the currently authored set pieces', () => {
    const model = itemSetTooltipModel({
      itemSetId: SET_CROWNFORGED,
      equippedPieces: 2,
      itemSetMembers: {
        [SET_CROWNFORGED]: 2,
      },
    });
    expect(model?.totalPieces).toBe(2);
    expect(model?.bonusTiers.map((tier) => tier.pieces)).toEqual([2]);
  });
});

describe('recalcPlayerStats applies equipped set bonuses (real raid/dungeon gear)', () => {
  it('Deathlord (t1 strength): flat AP at 2pc, str/sta added at 3pc', () => {
    const base = statsFor('warrior', 20, {});
    // 2 pieces: +40 AP, no set str yet. Warrior AP = str*2 + bonusAp.
    const two = statsFor('warrior', 20, {
      chest: 'deathlord_warplate',
      legs: 'deathlord_legguards',
    });
    expect(two.attackPower).toBe(two.stats.str * 2 + 40);
    // 3 pieces: set adds +15 str / +15 sta on top of the item stats.
    const three = statsFor('warrior', 20, {
      chest: 'deathlord_warplate',
      legs: 'deathlord_legguards',
      feet: 'deathlord_sabatons',
    });
    const itemStr = 8 + 8 + 7; // warplate + legguards + sabatons
    expect(three.stats.str).toBe(base.stats.str + itemStr + 15);
    expect(three.attackPower).toBe(three.stats.str * 2 + 40);
  });

  it('Wyrmshadow (t1 agility): crit gains the flat 2% at 3pc on top of agi-derived crit', () => {
    const three = statsFor('rogue', 20, {
      chest: 'wyrmshadow_harness',
      feet: 'wyrmshadow_treads',
      legs: 'wyrmshadow_legguards',
    });
    expect(three.critChance).toBeCloseTo(0.05 + three.stats.agi * 0.0005 + 0.02);
  });

  it('Nighttalon (t2 agility, 2 pieces): reaches the 2-piece +40 AP bonus', () => {
    const base = statsFor('rogue', 20, {});
    const two = statsFor('rogue', 20, {
      helmet: 'nighttalon_crown',
      shoulder: 'nighttalon_shoulderguards',
    });
    // Rogue AP = str + agi + bonusAp; the only set bonus at 2pc is +40 AP.
    expect(two.attackPower - (two.stats.str + two.stats.agi)).toBe(40);
    expect(two.attackPower).toBeGreaterThan(base.attackPower);
  });

  it("Necromancer's (t1 caster): castPushbackReduction reflects equipped piece count", () => {
    expect(statsFor('mage', 20, {}).castPushbackReduction).toBe(0);
    expect(
      statsFor('mage', 20, {
        chest: 'necromancers_starshroud',
        feet: 'necromancers_soulsteps',
      }).castPushbackReduction,
    ).toBe(0.5);
    expect(
      statsFor('mage', 20, {
        chest: 'necromancers_starshroud',
        feet: 'necromancers_soulsteps',
        legs: 'necromancers_legwraps',
      }).castPushbackReduction,
    ).toBe(1);
  });
});

describe('pushbackCast honors castPushbackReduction', () => {
  const sim = new Sim({ seed: 1, playerClass: 'mage' });
  const pushback = (reduction: number, channeling: boolean): Entity => {
    const p = sim.player;
    p.channeling = channeling;
    p.castTotal = 3;
    p.castRemaining = 1.5;
    p.castPushbackReduction = reduction;
    (sim as any).pushbackCast(p);
    return p;
  };

  it('full pushback with no reduction (cast delayed by CAST_PUSHBACK_SEC)', () => {
    expect(pushback(0, false).castRemaining).toBeCloseTo(1.5 + CAST_PUSHBACK_SEC);
  });

  it('half pushback at 50% reduction', () => {
    expect(pushback(0.5, false).castRemaining).toBeCloseTo(1.5 + CAST_PUSHBACK_SEC * 0.5);
  });

  it('immune at 100% reduction (cast untouched)', () => {
    expect(pushback(1, false).castRemaining).toBe(1.5);
  });

  it('scales channel pushback too', () => {
    const full = pushback(0, true).castRemaining;
    expect(full).toBeCloseTo(1.5 - 3 * CHANNEL_PUSHBACK_FRACTION);
    expect(pushback(1, true).castRemaining).toBe(1.5); // immune channel
  });
});
