import { describe, expect, it } from 'vitest';
import {
  aggregateSetBonuses,
  ITEM_SETS,
  SET_BOUNDSTONE_VANGUARD,
  SET_CRIT_3PC_RATING,
  SET_CROWNFORGED,
  SET_DEATHLORD,
  SET_NECROMANCERS,
  SET_SOULFLAME,
  SET_STORMCALLERS,
  SET_WYRMSHADOW,
} from '../src/sim/content/item_sets';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob, createPlayer, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';
import { CAST_PUSHBACK_SEC, CHANNEL_PUSHBACK_FRACTION } from '../src/sim/types';
import { itemSetMemberCounts, itemSetTooltipModel } from '../src/ui/item_set_tooltip_view';

const counts = (m: Record<string, number>) => new Map(Object.entries(m));

function statsFor(cls: PlayerClass, level: number, equipment: Record<string, string>): Entity {
  const e = createPlayer(0, cls, { x: 0, y: 0, z: 0 }, '');
  e.level = level;
  recalcPlayerStats(e, cls, equipment as any, undefined, {});
  return e;
}

const dist2d = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

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
      sp: 0,
      crit: 0,
      critRating: 0,
      haste: 0,
      hasteRating: 0,
      hitRating: 0,
      castPushbackReduction: 0,
      knockbackResistance: 0,
      procs: [],
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
    expect(three.critRating).toBe(SET_CRIT_3PC_RATING);
  });

  it('caster sets: 2pc grants knockback resistance, 3pc grants tier stats', () => {
    const necro = aggregateSetBonuses(counts({ [SET_NECROMANCERS]: 3 }));
    expect(necro.knockbackResistance).toBe(1);
    expect(necro.int).toBe(10);
    expect(necro.sta).toBe(10);
    expect(necro.spi).toBe(0);
    expect(necro.castPushbackReduction).toBe(0);

    const soulflame = aggregateSetBonuses(counts({ [SET_SOULFLAME]: 3 }));
    expect(soulflame.knockbackResistance).toBe(1);
    expect(soulflame.int).toBe(15);
    expect(soulflame.spi).toBe(15);
    expect(soulflame.sta).toBe(0);

    const stormcallers = aggregateSetBonuses(counts({ [SET_STORMCALLERS]: 3 }));
    expect(stormcallers.knockbackResistance).toBe(1);
    expect(stormcallers.int).toBe(15);
    expect(stormcallers.spi).toBe(15);
    expect(stormcallers.sta).toBe(0);
  });

  it('knockback resistance max-combines across met tiers and clamps to 0..1', () => {
    const twoCasterSets = aggregateSetBonuses(
      counts({ [SET_NECROMANCERS]: 2, [SET_SOULFLAME]: 2 }),
    );
    expect(twoCasterSets.knockbackResistance).toBe(1);

    const clampSetId = '__test_knockback_clamp';
    ITEM_SETS[clampSetId] = {
      id: clampSetId,
      name: 'Clamp Test Set',
      bonuses: [
        {
          pieces: 2,
          effect: { castPushbackReduction: 2, knockbackResistance: 2 },
          text: 'Clamp test.',
        },
      ],
    };
    try {
      const clamped = aggregateSetBonuses(counts({ [clampSetId]: 2 }));
      expect(clamped.castPushbackReduction).toBe(1);
      expect(clamped.knockbackResistance).toBe(1);
    } finally {
      delete ITEM_SETS[clampSetId];
    }
  });

  it('every set definition lists ascending tiers ending at its authored cap', () => {
    for (const set of Object.values(ITEM_SETS)) {
      const pieces = set.bonuses.map((b) => b.pieces);
      // every epic (raid/dungeon) family carries 2-, 3-, and 4-piece tiers (the
      // 4-piece is a proc); the leveling haste kits deliberately carry the
      // single 3-piece tier.
      const expected = pieces.length === 1 ? '3' : '2,3,4';
      expect([pieces.join(','), set.id]).toEqual([expected, set.id]);
    }
  });
});

describe('item set tooltip model', () => {
  it('counts each set as its distinct equip slots (base + all heroic versions are one piece)', () => {
    const counts = itemSetMemberCounts();
    // The t2 sets are 5 slots (soulflame cloth is 4). The normal piece, its
    // auto-generated heroic variant, and any bespoke heroic raid piece for the
    // same slot all collapse to one member, so the "X/N" denominator reflects the
    // real number of collectible pieces (not the parallel heroic-variant ids).
    expect(counts.crownforged).toBe(4);
    expect(counts.nighttalon).toBe(4);
    expect(counts.soulflame).toBe(4);
    expect(counts.stormcallers).toBe(4);
    // Leveling haste kits: 3 pieces each.
    expect(counts.vale_arcanist).toBe(3);
    expect(counts.boundstone_vanguard).toBe(3);
    expect(counts.greyjaw_stalker).toBe(3);
  });

  it('keeps four-piece families at four and the Boundstone family at three', () => {
    const memberCounts = itemSetMemberCounts();
    expect({
      [SET_DEATHLORD]: memberCounts[SET_DEATHLORD],
      [SET_BOUNDSTONE_VANGUARD]: memberCounts[SET_BOUNDSTONE_VANGUARD],
    }).toEqual({
      [SET_DEATHLORD]: 4,
      [SET_BOUNDSTONE_VANGUARD]: 3,
    });
  });

  it('uses the authored member count, not the highest bonus threshold, as the header total', () => {
    const model = itemSetTooltipModel({
      itemSetId: SET_DEATHLORD,
      equippedPieces: 2,
      itemSetMembers: {
        [SET_DEATHLORD]: 4,
      },
    });
    expect(model?.totalPieces).toBe(4);
    expect(model?.bonusTiers.map((tier) => tier.pieces)).toEqual([2, 3, 4]);
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

  it('Crownforged (t2 strength, 4 pieces): the 4-set Hit bonus lands on the equipped hitRating', () => {
    // End-to-end (not just the pure set-bonus resolver): the +60 four-set Hit rides
    // through recalcPlayerStats onto e.hitRating, on top of the 20 + 20 the helm and
    // shoulder carry. Drop the `+ setEff.hitRating` term and this reds.
    const four = statsFor('warrior', 20, {
      helmet: 'crownforged_dreadhelm',
      shoulder: 'crownforged_warspaulders',
      gloves: 'crownforged_gauntlets',
      waist: 'crownforged_girdle',
    });
    expect(four.hitRating).toBe(20 + 20 + 60);
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

  it('normal and heroic Nythraxis armor pieces mix for set thresholds', () => {
    // A heroic helmet variant counts as the same set slot as its normal base, so
    // mixing it with three normal pieces still reaches the 3-piece Wraithfire
    // threshold (int +15, spi +15). Derive the expected primary totals from the
    // live item defs so the heroic-variant stat rescale stays the source of truth.
    const worn = {
      helmet: 'heroic_soulflame_cowl', // heroic helmet mixed with normal pieces
      shoulder: 'soulflame_mantle',
      gloves: 'soulflame_gloves',
      waist: 'soulflame_cord',
    };
    const base = statsFor('mage', 20, {});
    const mixed = statsFor('mage', 20, worn);
    const pieceInt = Object.values(worn).reduce((s, id) => s + (ITEMS[id].stats?.int ?? 0), 0);
    const pieceSpi = Object.values(worn).reduce((s, id) => s + (ITEMS[id].stats?.spi ?? 0), 0);
    expect(mixed.knockbackResistance).toBe(1);
    expect(mixed.stats.int).toBe(base.stats.int + pieceInt + 15); // +15 = 3pc Wraithfire int
    expect(mixed.stats.spi).toBe(base.stats.spi + pieceSpi + 15); // +15 = 3pc Wraithfire spi
  });

  it("Necromancer's (t1 caster): knockback resistance at 2pc, int/sta added at 3pc", () => {
    const base = statsFor('mage', 20, {});
    expect(statsFor('mage', 20, {}).castPushbackReduction).toBe(0);
    const two = statsFor('mage', 20, {
      chest: 'necromancers_starshroud',
      feet: 'necromancers_soulsteps',
    });
    expect(two.castPushbackReduction).toBe(0);
    expect(two.knockbackResistance).toBe(1);

    const three = statsFor('mage', 20, {
      chest: 'necromancers_starshroud',
      feet: 'necromancers_soulsteps',
      legs: 'necromancers_legwraps',
    });
    expect(three.castPushbackReduction).toBe(0);
    expect(three.knockbackResistance).toBe(1);
    expect(three.stats.int).toBe(base.stats.int + 11 + 8 + 13 + 10);
    expect(three.stats.sta).toBe(base.stats.sta + 10);
  });

  it('Soulflame and Stormcaller (t2 caster): int/spi added at 3pc', () => {
    const mageBase = statsFor('mage', 20, {});
    const soulflame = statsFor('mage', 20, {
      helmet: 'soulflame_cowl',
      shoulder: 'soulflame_mantle',
      gloves: 'soulflame_gloves',
    });
    expect(soulflame.knockbackResistance).toBe(1);
    expect(soulflame.stats.int).toBe(mageBase.stats.int + 11 + 9 + 8 + 15);
    expect(soulflame.stats.spi).toBe(mageBase.stats.spi + 15);

    const shamanBase = statsFor('shaman', 20, {});
    const stormcallers = statsFor('shaman', 20, {
      helmet: 'stormcallers_crown',
      shoulder: 'stormcallers_spaulders',
      gloves: 'stormcallers_handguards',
    });
    expect(stormcallers.knockbackResistance).toBe(1);
    expect(stormcallers.stats.int).toBe(shamanBase.stats.int + 10 + 8 + 8 + 15);
    expect(stormcallers.stats.spi).toBe(shamanBase.stats.spi + 15);
  });
});

describe('pushbackCast honors castPushbackReduction', () => {
  const sim = new Sim({ seed: 1, playerClass: 'mage' });
  const pushback = (reduction: number, channeling: boolean): Entity => {
    const p = sim.player;
    p.channeling = channeling;
    p.castTotal = 3;
    p.castRemaining = 1.5;
    // Synthetic coverage: no current item set grants cast-pushback reduction.
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

describe('knockback resistance from set bonuses', () => {
  it('prevents a forced mob knockback from displacing the player', () => {
    const sim = new Sim({ seed: 5150, playerClass: 'mage' });
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000;
    p.dodgeChance = 0;
    p.knockbackResistance = 1;
    p.pos.x = 2;
    p.pos.z = 0;
    p.pos.y = 0;

    const tmpl = MOBS.marrowlord_varkas;
    const saved = tmpl.knockback!.chance;
    tmpl.knockback!.chance = 1;
    try {
      const mob = createMob(900704, tmpl, p.level, { x: 0, y: 0, z: 0 });
      const startGap = dist2d(p.pos, mob.pos);
      let sawDamage = false;
      for (let i = 0; i < 80 && !sawDamage; i++) {
        const beforeHp = p.hp;
        (sim as any).mobSwing(mob, p);
        sawDamage = p.hp < beforeHp;
        p.hp = p.maxHp;
      }
      expect(sawDamage).toBe(true);
      expect(dist2d(p.pos, mob.pos)).toBe(startGap);
      expect(p.pos.x).toBe(2);
    } finally {
      tmpl.knockback!.chance = saved;
    }
  });
});
