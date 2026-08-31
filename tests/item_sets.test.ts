import { describe, expect, it } from 'vitest';
import { SET_ENGINE_BONUSES } from '../src/sim/content/ignivar_set_bonuses';
import {
  aggregateSetBonuses,
  ITEM_SETS,
  SET_BOUNDSTONE_VANGUARD,
  SET_CRIT_3PC_RATING,
  SET_CROWNFORGED,
  SET_DEATHLORD,
  SET_HASTE_3PC_RATING,
  SET_HIT_4PC_RATING,
  SET_NECROMANCERS,
  SET_NIGHTTALON,
  SET_SOULFLAME,
  SET_STORMCALLERS,
  SET_WYRMSHADOW,
} from '../src/sim/content/item_sets';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob, createPlayer, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';
import { CAST_PUSHBACK_SEC, CHANNEL_PUSHBACK_FRACTION } from '../src/sim/types';
import {
  equippedSetTooltipPieces,
  itemSetMemberCounts,
  itemSetTooltipModel,
} from '../src/ui/item_set_tooltip_view';

const counts = (m: Record<string, number>) => new Map(Object.entries(m));

function statsFor(cls: PlayerClass, level: number, equipment: Record<string, string>): Entity {
  const e = createPlayer(0, cls, { x: 0, y: 0, z: 0 }, '');
  e.level = level;
  recalcPlayerStats(e, cls, equipment as any, undefined, {});
  return e;
}

const dist2d = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe('heroic set item identity', () => {
  it('shares the normal set id and carries the heroic variant marker', () => {
    // This line uses the auto-generated heroic_<base> variants (heroic_variants.ts),
    // marked via heroicOf, not the PTR-era bespoke <base>_heroic pieces with a
    // standalone heroic flag.
    expect(ITEMS.heroic_crownforged_dreadhelm.set).toBe(ITEMS.crownforged_dreadhelm.set);
    expect(ITEMS.heroic_crownforged_dreadhelm.set).toBe('crownforged');
    expect(ITEMS.heroic_crownforged_dreadhelm.heroicOf).toBe('crownforged_dreadhelm');
  });
});

describe('aggregateSetBonuses (the lineage ladder)', () => {
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
      healPower: 0,
      crit: 0,
      critRating: 0,
      haste: 0,
      hasteRating: 0,
      hitRating: 0,
      castPushbackReduction: 0,
      knockbackResistance: 0,
      pvpOffenseRating: 0,
      pvpDefenseRating: 0,
      ccDurationReduction: 0,
      procs: [],
    });
  });

  it('one tier-1 piece plus one tier-2 piece reach the lineage 2-piece tier', () => {
    // The load-bearing lineage behavior: deathlord and crownforged climb ONE
    // ladder, so 1 + 1 pieces meet the 2-piece threshold together.
    const eff = aggregateSetBonuses(counts({ [SET_DEATHLORD]: 1, [SET_CROWNFORGED]: 1 }));
    expect(eff.str).toBe(10);
    expect(eff.sta).toBe(10);
    expect(eff.ap).toBe(0); // the 4-piece tier is not met
  });

  it('the shared lineage table applies exactly once, never per member family', () => {
    // 3 + 3 pieces = 6: all three tiers, with single-application magnitudes
    // (str 10, not 10 per family).
    const eff = aggregateSetBonuses(counts({ [SET_DEATHLORD]: 3, [SET_CROWNFORGED]: 3 }));
    expect(eff.str).toBe(10);
    expect(eff.sta).toBe(10);
    expect(eff.ap).toBe(25);
    expect(eff.hasteRating).toBe(SET_HASTE_3PC_RATING);
    expect(eff.hitRating).toBe(SET_HIT_4PC_RATING);
    expect(eff.procs.map((p) => p.id).sort()).toEqual(['set_bonesplinter', 'set_gravemight']);
  });

  it('strength lineage: stats at 2, attack power and Gravemight at 4', () => {
    const two = aggregateSetBonuses(counts({ [SET_DEATHLORD]: 2 }));
    expect(two.str).toBe(10);
    expect(two.sta).toBe(10);
    expect(two.ap).toBe(0);
    const four = aggregateSetBonuses(counts({ [SET_DEATHLORD]: 4 }));
    expect(four.str).toBe(10); // 2-piece tier still active (tiers stack)
    expect(four.ap).toBe(25);
    expect(four.procs.map((p) => p.id)).toEqual(['set_gravemight']);
  });

  it('agility lineage: agi and crit at 2, attack power and Fangrush at 4', () => {
    const two = aggregateSetBonuses(counts({ [SET_WYRMSHADOW]: 2 }));
    expect(two.agi).toBe(10);
    expect(two.critRating).toBe(SET_CRIT_3PC_RATING);
    expect(two.ap).toBe(0);
    const four = aggregateSetBonuses(counts({ [SET_NIGHTTALON]: 4 }));
    expect(four.ap).toBe(25);
    expect(four.procs.map((p) => p.id)).toEqual(['set_fangrush']);
  });

  it('caster lineage: int/spi and HALF pushback at 2, spell power and Clearcasting at 4', () => {
    // Full pushback immunity moved to the new raid tier's caster and healer
    // 2-piece bonuses in the retune; the incumbents keep 50%.
    for (const setId of [SET_NECROMANCERS, SET_SOULFLAME, SET_STORMCALLERS]) {
      const two = aggregateSetBonuses(counts({ [setId]: 2 }));
      expect(two.int, setId).toBe(10);
      expect(two.spi, setId).toBe(10);
      expect(two.castPushbackReduction, setId).toBe(0.5);
      expect(two.knockbackResistance, setId).toBe(0);
      expect(two.sp, setId).toBe(0);
    }
    // 2 + 2 pieces across the tiers reach the lineage 4-piece tier together.
    const four = aggregateSetBonuses(counts({ [SET_NECROMANCERS]: 2, [SET_SOULFLAME]: 2 }));
    expect(four.sp).toBe(12);
    expect(four.castPushbackReduction).toBe(0.5); // no higher pushback tier exists
    expect(four.procs.map((p) => p.id)).toEqual(['set_clearcasting']);
  });

  it('caster lineage capstone: haste and Soulblaze at 6 pieces', () => {
    const six = aggregateSetBonuses(counts({ [SET_NECROMANCERS]: 3, [SET_STORMCALLERS]: 3 }));
    expect(six.hasteRating).toBe(SET_HASTE_3PC_RATING);
    expect(six.hitRating).toBe(0); // healer-facing lineage: no Hit in the capstone
    expect(six.procs.map((p) => p.id).sort()).toEqual(['set_clearcasting', 'set_soulblaze']);
  });

  it('pushback and knockback clamp to 0..1 in the resolver', () => {
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
      // The seven epic families share their lineage's 2/4/6 ladder; the
      // leveling haste kits deliberately carry the single 3-piece tier; the
      // WARFARE families are 2/4/7 (see tests/warfare_balance_harness.test.ts);
      // the Crucible tier sets break at 2/4 (the engine-registered ids in
      // content/ignivar_set_bonuses.ts; tests/ignivar_loot.test.ts owns the
      // per-wave rollout ledger for them).
      const expected = set.id.startsWith('warfare_')
        ? '2,4,7'
        : set.lineage !== undefined
          ? '2,4,6'
          : SET_ENGINE_BONUSES[set.id] !== undefined
            ? '2,4'
            : '3';
      expect([pieces.join(','), set.id]).toEqual([expected, set.id]);
    }
  });

  it('every lineage member shares the identical bonuses array', () => {
    const byLineage = new Map<string, object>();
    for (const set of Object.values(ITEM_SETS)) {
      if (set.lineage === undefined) continue;
      const shared = byLineage.get(set.lineage);
      if (shared === undefined) byLineage.set(set.lineage, set.bonuses);
      else expect(set.bonuses, set.id).toBe(shared); // same reference, not a copy
    }
    expect([...byLineage.keys()].sort()).toEqual([
      'agility_lineage',
      'caster_lineage',
      'strength_lineage',
    ]);
  });
});

describe('item set tooltip model (lineage-aware)', () => {
  it('lineage families read the slot UNION across their lineage as the total', () => {
    const memberCounts = itemSetMemberCounts();
    // Each lineage unions to exactly seven wearable slots (four plus four
    // with one overlapping slot), so every member family reads X/7.
    expect(memberCounts.deathlord).toBe(7);
    expect(memberCounts.crownforged).toBe(7);
    expect(memberCounts.wyrmshadow).toBe(7);
    expect(memberCounts.nighttalon).toBe(7);
    expect(memberCounts.necromancers).toBe(7);
    expect(memberCounts.soulflame).toBe(7);
    expect(memberCounts.stormcallers).toBe(7);
    // Leveling haste kits stay per-family: 3 pieces each.
    expect(memberCounts.vale_arcanist).toBe(3);
    expect(memberCounts.boundstone_vanguard).toBe(3);
    expect(memberCounts.greyjaw_stalker).toBe(3);
  });

  it('keeps non-lineage families at their own member count', () => {
    const memberCounts = itemSetMemberCounts();
    expect(memberCounts[SET_BOUNDSTONE_VANGUARD]).toBe(3);
  });

  it('uses the authored member count as the header total and shows the 2/4/6 tiers', () => {
    const model = itemSetTooltipModel({
      itemSetId: SET_DEATHLORD,
      equippedPieces: 2,
      itemSetMembers: {
        [SET_DEATHLORD]: 7,
      },
    });
    expect(model?.totalPieces).toBe(7);
    expect(model?.bonusTiers.map((tier) => tier.pieces)).toEqual([2, 4, 6]);
    expect(model?.bonusTiers.map((tier) => tier.active)).toEqual([true, false, false]);
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

  it('equippedSetTooltipPieces counts worn pieces across the whole lineage', () => {
    const worn = [
      'deathlord_warplate', // strength lineage
      'crownforged_dreadhelm', // strength lineage, other family
      'nighttalon_crown', // agility lineage: never counted for a strength set
      null,
      'oath_of_the_round_table', // no set tag
    ];
    expect(equippedSetTooltipPieces(SET_DEATHLORD, worn)).toBe(2);
    expect(equippedSetTooltipPieces(SET_CROWNFORGED, worn)).toBe(2);
    expect(equippedSetTooltipPieces(SET_NIGHTTALON, worn)).toBe(1);
    expect(equippedSetTooltipPieces(SET_BOUNDSTONE_VANGUARD, worn)).toBe(0);
  });
});

describe('recalcPlayerStats applies equipped set bonuses (real raid/dungeon gear)', () => {
  it('Deathlord (strength lineage): stats at 2 pieces, attack power at 4', () => {
    const base = statsFor('warrior', 20, {});
    // 2 pieces: the lineage 2-piece stat tier, no flat AP yet. Warrior AP =
    // str*2 + bonusAp.
    const two = statsFor('warrior', 20, {
      chest: 'deathlord_warplate',
      legs: 'deathlord_legguards',
    });
    const twoItemStr = 8 + 8; // warplate + legguards
    expect(two.stats.str).toBe(base.stats.str + twoItemStr + 10);
    expect(two.attackPower).toBe(two.stats.str * 2);
    // 4 pieces: the flat +25 attack power joins.
    const four = statsFor('warrior', 20, {
      chest: 'deathlord_warplate',
      legs: 'deathlord_legguards',
      feet: 'deathlord_sabatons',
      helmet: 'deathlords_dread_visage',
    });
    expect(four.attackPower).toBe(four.stats.str * 2 + 25);
  });

  it('Wyrmshadow (agility lineage): 1% crit at 2 pieces rides the rating conversion', () => {
    const two = statsFor('rogue', 20, {
      chest: 'wyrmshadow_harness',
      feet: 'wyrmshadow_treads',
    });
    expect(two.critRating).toBe(SET_CRIT_3PC_RATING);
    expect(two.critChance).toBeCloseTo(0.05 + two.stats.agi * 0.0005 + 0.01);
  });

  it('Crownforged pieces carry crit seeds now, and 4 lineage pieces pay no Hit', () => {
    // The Hit program flip: the authored t2 seeds became critRating 20, so the
    // heroic variants derive crit primaries too, and the only Hit the old
    // stack provides is the 6-piece capstone.
    const four = statsFor('warrior', 20, {
      helmet: 'crownforged_dreadhelm',
      shoulder: 'crownforged_warspaulders',
      gloves: 'crownforged_gauntlets',
      waist: 'crownforged_girdle',
    });
    expect(four.critRating).toBe(20 + 20); // helm + shoulder seeds
    expect(four.hitRating).toBe(0);
    expect(four.attackPower).toBe(four.stats.str * 2 + 25); // lineage 4-piece
  });

  it('six strength pieces across both families light the capstone', () => {
    const six = statsFor('warrior', 20, {
      helmet: 'crownforged_dreadhelm',
      shoulder: 'crownforged_warspaulders',
      gloves: 'crownforged_gauntlets',
      waist: 'crownforged_girdle',
      chest: 'deathlord_warplate',
      legs: 'deathlord_legguards',
    });
    expect(six.hitRating).toBe(SET_HIT_4PC_RATING);
    expect(six.hasteRating).toBe(SET_HASTE_3PC_RATING);
  });

  it('Nighttalon (agility lineage, 2 pieces): crit seeds plus the 2-piece tier, no AP', () => {
    const two = statsFor('rogue', 20, {
      helmet: 'nighttalon_crown',
      shoulder: 'nighttalon_shoulderguards',
    });
    // Rogue AP = str + agi + bonusAp; no flat AP below the 4-piece tier.
    expect(two.attackPower - (two.stats.str + two.stats.agi)).toBe(0);
    // Two flipped 20-crit seeds plus the lineage 2-piece crit rating.
    expect(two.critRating).toBe(20 + 20 + SET_CRIT_3PC_RATING);
  });

  it('normal and heroic pieces mix for lineage thresholds', () => {
    // A heroic helmet variant counts as the same set slot as its normal base,
    // so mixing it with three normal pieces still reaches the lineage 4-piece
    // tier (spell power 12). Derive the expected primary totals from the live
    // item defs so the heroic-variant stat rescale stays the source of truth.
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
    expect(mixed.castPushbackReduction).toBe(0.5);
    expect(mixed.stats.int).toBe(base.stats.int + pieceInt + 10); // lineage 2-piece int
    expect(mixed.stats.spi).toBe(base.stats.spi + pieceSpi + 10); // lineage 2-piece spi
    expect(mixed.spellPower).toBe(Math.round(mixed.stats.int * 0.5) + 12); // lineage 4-piece
  });

  it("Necromancer's (caster lineage): int/spi and half pushback at 2 pieces", () => {
    const base = statsFor('mage', 20, {});
    expect(statsFor('mage', 20, {}).castPushbackReduction).toBe(0);
    const worn = {
      chest: 'necromancers_starshroud',
      feet: 'necromancers_soulsteps',
    };
    const two = statsFor('mage', 20, worn);
    const pieceInt = Object.values(worn).reduce((s, id) => s + (ITEMS[id].stats?.int ?? 0), 0);
    const pieceSpi = Object.values(worn).reduce((s, id) => s + (ITEMS[id].stats?.spi ?? 0), 0);
    expect(two.castPushbackReduction).toBe(0.5);
    expect(two.knockbackResistance).toBe(0);
    expect(two.stats.int).toBe(base.stats.int + pieceInt + 10);
    expect(two.stats.spi).toBe(base.stats.spi + pieceSpi + 10);
  });
});

describe('pushbackCast honors castPushbackReduction', () => {
  const sim = new Sim({ seed: 1, playerClass: 'mage' });
  const pushback = (reduction: number, channeling: boolean): Entity => {
    const p = sim.player;
    p.channeling = channeling;
    p.castTotal = 3;
    p.castRemaining = 1.5;
    // Set directly to cover the whole reduction curve; the caster lineage
    // 2-piece grants 0.5 (see the end-to-end suite below).
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

describe('caster lineage 2-piece: damage delays a cast half as much (end to end)', () => {
  // Runs the REAL inbound path: dealDamage's spell-pushback block fires
  // ctx.pushbackCast on every landed hit against a casting target, and the
  // lineage 2-piece castPushbackReduction of 0.5 halves the delay (full
  // immunity moved to the new raid tier's caster sets in the retune).
  const castThenHit = (equipSet: boolean) => {
    const sim = new Sim({ seed: 77, playerClass: 'mage' });
    sim.setPlayerLevel(20);
    if (equipSet) {
      for (const id of ['necromancers_starshroud', 'necromancers_soulsteps']) {
        sim.addItem(id, 1);
        sim.equipItem(id);
      }
    }
    const p = sim.player;
    expect(p.castPushbackReduction).toBe(equipSet ? 0.5 : 0);
    const mob = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead)!;
    mob.pos = { x: p.pos.x + 5, y: p.pos.y, z: p.pos.z };
    mob.prevPos = { ...mob.pos };
    (sim as any).rebucket(mob);
    sim.targetEntity(mob.id);
    p.resource = p.maxResource;
    sim.castAbility('fireball');
    expect(p.castingAbility).toBe('fireball');
    const rem0 = p.castRemaining;
    (sim as any).dealDamage(mob, p, 10, false, 'physical', 'Claw', 'hit', true);
    return { p, rem0 };
  };

  it('with 2 Mournweave pieces the delay is halved', () => {
    const { p, rem0 } = castThenHit(true);
    expect(p.castingAbility).toBe('fireball'); // still casting
    expect(p.castRemaining).toBeCloseTo(rem0 + CAST_PUSHBACK_SEC * 0.5, 9);
  });

  it('without the set the same hit delays the cast in full (control)', () => {
    const { p, rem0 } = castThenHit(false);
    expect(p.castRemaining).toBeCloseTo(rem0 + CAST_PUSHBACK_SEC, 9);
  });
});

describe('knockback resistance (the aggregate stat, set synthetically)', () => {
  it('prevents a forced mob knockback from displacing the player', () => {
    // No shipped set grants knockbackResistance; this pins the engine mechanic
    // behind the stat.
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
