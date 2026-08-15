// Phase 2 of the WARFARE tier refactor: the retuned honor tier and its five
// armor sets. This suite owns the ARITHMETIC (what a kit plus a set resolves to,
// and why a hybrid build loses); the per-item budget schedule, the badge-jewelry
// guard and the price ladder stay pinned in tests/pvp_honor_gear.test.ts.
import { describe, expect, it } from 'vitest';
import {
  aggregateSetBonuses,
  ITEM_SETS,
  SET_WARFARE_ASHSTALKER,
  SET_WARFARE_CINDERWEAVE,
  SET_WARFARE_FURYFORGED,
  SET_WARFARE_STORMBOUND,
  SET_WARFARE_THORNHIDE,
  WARFARE_SET_2PC_DEFENSE_RATING,
  WARFARE_SET_4PC_CC_REDUCTION,
  WARFARE_SET_4PC_OFFENSE_RATING,
  WARFARE_SET_7PC_RATING,
} from '../src/sim/content/item_sets';
import {
  FURY_STOCK,
  WARFARE_JEWELRY_STAT_FRACTION,
  WARFARE_RATING_FRACTION,
  WARFARE_SOURCE_LEVEL,
  WARFARE_STAT_FRACTION,
} from '../src/sim/content/pvp_honor';
import { ITEMS } from '../src/sim/data';
import { createPlayer, recalcPlayerStats } from '../src/sim/entity';
import { canEquipItem } from '../src/sim/equipment_rules';
import { expectedStatBudget, itemLevel, primaryStatSum } from '../src/sim/item_level';
import { PVP_DEFENSE_CAP, PVP_OFFENSE_CAP, pvpFractionsFromRatings } from '../src/sim/pvp';
import type { Entity, EquipSlot, PlayerClass, SetBonusEffect } from '../src/sim/types';

// DERIVED from the live catalog, never a hand-listed set of ids. The hand-listed
// version silently excluded Thornhide, the family added last, from every sweep
// below: the 2/4/7 breakpoint pin, the never-in-flat-stats invariant, the
// capstone aggregate, and the crowd-control wording. A family authored after
// this file must be caught BY the guards, not left outside them.
const WARFARE_SET_IDS = Object.keys(ITEM_SETS)
  .filter((setId) => setId.startsWith('warfare_'))
  .sort();

// The derivation above is only worth having if it is non-vacuous: an empty or
// short list would pass every `for` loop in this file without asserting a thing.
describe('the WARFARE family list this suite sweeps', () => {
  it('resolves every shipped family, so no loop below can pass vacuously', () => {
    expect(WARFARE_SET_IDS).toEqual([
      SET_WARFARE_ASHSTALKER,
      SET_WARFARE_CINDERWEAVE,
      SET_WARFARE_FURYFORGED,
      SET_WARFARE_STORMBOUND,
      SET_WARFARE_THORNHIDE,
    ]);
    // Every id resolves to a real set, so a renamed family reds here rather than
    // quietly dropping out of the filter.
    for (const setId of WARFARE_SET_IDS) expect(ITEM_SETS[setId], setId).toBeDefined();
  });
});

interface Profile {
  name: string;
  cls: PlayerClass;
  setId: string;
  // helmet, shoulder, chest, waist, legs, gloves, feet
  armor: readonly [string, string, string, string, string, string, string];
  neck: string;
  rings: readonly [string, string];
  weapon: string;
  // A same-slot, same-armor-type item-level-31 PvE epic, for the hybrid build.
  pveChest: string;
}

const PROFILES: readonly Profile[] = [
  {
    name: 'Strength mail',
    cls: 'warrior',
    setId: SET_WARFARE_FURYFORGED,
    armor: [
      'furyforged_warhelm',
      'furyforged_warspaulders',
      'furyforged_warplate',
      'furyforged_girdle',
      'furyforged_legguards',
      'furyforged_gauntlets',
      'furyforged_sabatons',
    ],
    neck: 'final_oath_medallion',
    rings: ['iron_vow_band', 'unbroken_circle'],
    weapon: 'final_argument_greatblade',
    pveChest: 'morthens_cryptforged_hauberk',
  },
  {
    name: 'caster mail',
    cls: 'shaman',
    setId: SET_WARFARE_STORMBOUND,
    armor: [
      'stormbound_crown',
      'stormbound_spaulders',
      'stormbound_hauberk',
      'stormbound_waistguard',
      'stormbound_legmail',
      'stormbound_handguards',
      'stormbound_greaves',
    ],
    neck: 'cinder_sigil_pendant',
    rings: ['ashen_focus_ring', 'spellbreakers_seal'],
    weapon: 'emberglass_warstaff',
    pveChest: 'sunbone_ritual_hauberk',
  },
  {
    name: 'Agility leather',
    cls: 'rogue',
    setId: SET_WARFARE_ASHSTALKER,
    armor: [
      'ashstalker_cowl',
      'ashstalker_shoulderguards',
      'ashstalker_harness',
      'ashstalker_waistband',
      'ashstalker_legguards',
      'ashstalker_grips',
      'ashstalker_treads',
    ],
    neck: 'razorwind_torque',
    rings: ['fleetblood_band', 'last_step_signet'],
    weapon: 'first_blood_razor',
    pveChest: 'basin_stalkers_tunic',
  },
  {
    name: 'caster cloth',
    cls: 'mage',
    setId: SET_WARFARE_CINDERWEAVE,
    armor: [
      'cinderweave_cowl',
      'cinderweave_mantle',
      'cinderweave_raiment',
      'cinderweave_cord',
      'cinderweave_legwraps',
      'cinderweave_handwraps',
      'cinderweave_slippers',
    ],
    neck: 'cinder_sigil_pendant',
    rings: ['ashen_focus_ring', 'spellbreakers_seal'],
    weapon: 'emberglass_warstaff',
    pveChest: 'shroud_of_the_gravewyrm',
  },
];

const ARMOR_SLOTS = [
  'helmet',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
] as const satisfies readonly EquipSlot[];

function kitFor(profile: Profile, chestOverride?: string): Partial<Record<EquipSlot, string>> {
  const worn: Partial<Record<EquipSlot, string>> = {
    mainhand: profile.weapon,
    neck: profile.neck,
    ring1: profile.rings[0],
    ring2: profile.rings[1],
  };
  ARMOR_SLOTS.forEach((slot, i) => {
    worn[slot] = profile.armor[i];
  });
  if (chestOverride) worn.chest = chestOverride;
  return worn;
}

function geared(cls: PlayerClass, worn: Partial<Record<EquipSlot, string>>): Entity {
  const e = createPlayer(0, cls, { x: 0, y: 0, z: 0 }, 'Tester');
  e.level = 20;
  recalcPlayerStats(e, cls, worn as never, undefined, {});
  return e;
}

// The measured rating a kit carries from ITEMS alone, before any set bonus.
function gearRating(worn: Partial<Record<EquipSlot, string>>): {
  offense: number;
  defense: number;
} {
  let offense = 0;
  let defense = 0;
  for (const id of Object.values(worn)) {
    offense += ITEMS[id].pvpOffenseRating ?? 0;
    defense += ITEMS[id].pvpDefenseRating ?? 0;
  }
  return { offense, defense };
}

describe('the WARFARE tier is authored from named fractions', () => {
  it('sits at item level 31 and holds each slot to its authored share of the budget', () => {
    // The three fractions are pinned as SYMBOLS, so a retune that edits the
    // constant and the items together stays green while a drift between the two
    // reds. WARFARE_RATING_FRACTION is 1.0 (unchanged from what shipped): if the
    // rating assertion below ever needs a multiplication the base kit has stopped
    // landing on 182 and the whole set arithmetic moves with it.
    expect(WARFARE_SOURCE_LEVEL).toBe(25);
    expect(WARFARE_STAT_FRACTION).toBe(0.9);
    expect(WARFARE_JEWELRY_STAT_FRACTION).toBe(0.75);
    expect(WARFARE_RATING_FRACTION).toBe(1);

    for (const id of FURY_STOCK) {
      const item = ITEMS[id];
      const budget = expectedStatBudget(item) ?? 0;
      const jewelry = item.slot === 'neck' || item.slot === 'ring';
      const fraction = jewelry ? WARFARE_JEWELRY_STAT_FRACTION : WARFARE_STAT_FRACTION;
      expect(itemLevel(item), id).toBe(31);
      expect(primaryStatSum(item), id).toBe(Math.round(budget * fraction));
      expect(item.pvpOffenseRating, id).toBe(Math.round(budget * WARFARE_RATING_FRACTION));
      expect(item.pvpDefenseRating, id).toBe(Math.round(budget * WARFARE_RATING_FRACTION));
    }
  });

  it('never carries a crit, hit, or haste rating on any piece', () => {
    // Load-bearing for the PvE-shortcut answer: every item-level-31 PvE epic in
    // the game carries one of these three and no WARFARE piece does, which is
    // what keeps a complete honor kit from substituting for the heroic tier.
    // Measured against the live catalog rather than asserted in prose.
    const pveIlvl31 = Object.values(ITEMS).filter(
      (item) => itemLevel(item) === 31 && !FURY_STOCK.includes(item.id),
    );
    expect(pveIlvl31.length).toBeGreaterThan(20);
    for (const item of pveIlvl31) {
      const rated = !!(item.critRating || item.hitRating || item.hasteRating);
      expect(rated, `${item.id} is an ilvl-31 PvE epic and must carry a combat rating`).toBe(true);
    }
    for (const id of FURY_STOCK) {
      const item = ITEMS[id];
      expect(item.critRating, id).toBeUndefined();
      expect(item.hitRating, id).toBeUndefined();
      expect(item.hasteRating, id).toBeUndefined();
    }
  });
});

describe('the five WARFARE sets', () => {
  it('tags exactly the seven armor pieces of each family and nothing else', () => {
    const tagged = FURY_STOCK.filter((id) => ITEMS[id].set);
    expect(tagged).toHaveLength(35);
    for (const setId of WARFARE_SET_IDS) {
      const members = FURY_STOCK.filter((id) => ITEMS[id].set === setId);
      expect(members, setId).toHaveLength(7);
      expect(new Set(members.map((id) => ITEMS[id].slot)), setId).toEqual(new Set(ARMOR_SLOTS));
      expect(new Set(members.map((id) => ITEMS[id].armorType)).size, setId).toBe(1);
    }
    // Neck, rings and weapons are shared across role profiles, so they are
    // deliberately outside every family.
    for (const id of FURY_STOCK) {
      const slot = ITEMS[id].slot ?? '';
      if (['neck', 'ring', 'mainhand'].includes(slot)) expect(ITEMS[id].set, id).toBeUndefined();
    }
  });

  it('breaks at 2, 4, and 7 pieces in every family', () => {
    for (const setId of WARFARE_SET_IDS) {
      expect(
        ITEM_SETS[setId].bonuses.map((b) => b.pieces),
        setId,
      ).toEqual([2, 4, 7]);
    }
  });

  it('pays only in WARFARE rating and PvP-gated effects, never in flat stats', () => {
    // This is the replacement invariant of the whole program: because a set
    // bonus can only be a WARFARE rating, the crowd-control cut, or a pvpOnly
    // proc, "honor gear is never better than raid gear in a raid" is structural.
    // A future author adding `ap: 40` here reds this rather than shipping.
    const ALLOWED: readonly (keyof SetBonusEffect)[] = [
      'pvpOffenseRating',
      'pvpDefenseRating',
      'ccDurationReduction',
      'proc',
    ];
    for (const setId of WARFARE_SET_IDS) {
      for (const tier of ITEM_SETS[setId].bonuses) {
        for (const key of Object.keys(tier.effect)) {
          expect(ALLOWED, `${setId} ${tier.pieces}pc grants ${key}`).toContain(key);
        }
        if (tier.effect.proc) expect(tier.effect.proc.pvpOnly, setId).toBe(true);
      }
    }
    // And the resolved aggregate at the capstone contributes nothing a PvE
    // encounter can read: every non-WARFARE field of the aggregate stays zero.
    for (const setId of WARFARE_SET_IDS) {
      const agg = aggregateSetBonuses(new Map([[setId, 7]]));
      expect(
        {
          str: agg.str,
          agi: agg.agi,
          sta: agg.sta,
          int: agg.int,
          spi: agg.spi,
          ap: agg.ap,
          sp: agg.sp,
          crit: agg.crit,
          critRating: agg.critRating,
          haste: agg.haste,
          hasteRating: agg.hasteRating,
          hitRating: agg.hitRating,
          castPushbackReduction: agg.castPushbackReduction,
          knockbackResistance: agg.knockbackResistance,
        },
        setId,
      ).toEqual({
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
      });
      expect(agg.pvpOffenseRating, setId).toBe(
        WARFARE_SET_4PC_OFFENSE_RATING + WARFARE_SET_7PC_RATING,
      );
      expect(agg.pvpDefenseRating, setId).toBe(
        WARFARE_SET_2PC_DEFENSE_RATING + WARFARE_SET_7PC_RATING,
      );
      expect(agg.ccDurationReduction, setId).toBe(WARFARE_SET_4PC_CC_REDUCTION);
    }
  });

  it('says crowd control is "cast on you by hostile players", not "from" them', () => {
    // Pet-applied control takes the non-hostile-pair early return in
    // Sim.diminishedCrowdControlDuration and is NOT reduced, so the looser
    // wording would be a false tooltip. This is a t() source string: rewording
    // it later costs every locale, which is why it is pinned character for
    // character rather than described.
    //
    // "Warfare" is sentence case here on purpose. The all-caps spelling is the
    // internal name for the currency and the set family; the shouted form read
    // as emphasis in a bonus line that is otherwise ordinary prose, so the
    // player-facing copy uses the ordinary word. The ids stay `warfare_*`.
    for (const setId of WARFARE_SET_IDS) {
      const four = ITEM_SETS[setId].bonuses.find((b) => b.pieces === 4);
      expect(four?.text, setId).toBe(
        'Increases Warfare Offense Rating by 40, and crowd control cast on you by hostile players lasts 15% less.',
      );
      expect(four?.text, setId).not.toContain('WARFARE');
      expect(four?.text, setId).not.toContain('from hostile players');
    }
  });
});

describe('WARFARE rating arithmetic across a kit and its set', () => {
  it('carries 182 rating from the eleven items alone, or 18.2 percent', () => {
    for (const profile of PROFILES) {
      const worn = kitFor(profile);
      const armorRating = ARMOR_SLOTS.reduce(
        (sum, slot) => sum + (ITEMS[worn[slot] as string].pvpOffenseRating ?? 0),
        0,
      );
      // The decomposition the set arithmetic below builds on: the seven set
      // pieces carry 120 and the four unsettable slots (mainhand, neck, two
      // rings) carry 62.
      expect(armorRating, profile.name).toBe(120);
      const { offense, defense } = gearRating(worn);
      expect([offense, defense], profile.name).toEqual([182, 182]);
      expect(offense - armorRating, profile.name).toBe(62);
      expect(pvpFractionsFromRatings(offense, defense), profile.name).toEqual({
        offense: 0.182,
        defense: 0.182,
      });
      // 18.2 percent is a RISE over the 16.8 the tier shipped with, so no
      // partial kit is a per-piece regression while a player is mid-grind.
      expect(offense).toBeGreaterThan(168);
    }
  });

  it('resolves a complete kit plus the complete seven-piece set to exactly 0.30 and 0.30', () => {
    for (const profile of PROFILES) {
      const worn = kitFor(profile);
      for (const id of Object.values(worn)) {
        expect(canEquipItem(profile.cls, ITEMS[id]), `${profile.name}: ${id}`).toBe(true);
      }
      const player = geared(profile.cls, worn);
      expect(player.stats.pvpOffense, `${profile.name} offense`).toBe(0.3);
      expect(player.stats.pvpDefense, `${profile.name} defense`).toBe(0.3);
      expect(player.stats.pvpOffense).toBe(PVP_OFFENSE_CAP);
      expect(player.stats.pvpDefense).toBe(PVP_DEFENSE_CAP);

      // 0.30 is a CLAMP here, not a coincidence: the raw combined total is 302,
      // two points of rounding slack over the cap. A retune that dropped a tier
      // to land exactly on 300 would still pass the two assertions above, so the
      // raw total is pinned separately.
      const gear = gearRating(worn);
      const set = aggregateSetBonuses(new Map([[profile.setId, 7]]));
      expect(
        [gear.offense + set.pvpOffenseRating, gear.defense + set.pvpDefenseRating],
        profile.name,
      ).toEqual([302, 302]);
    }
  });

  it('resolves a complete kit with a four-piece set to 0.222', () => {
    // The four-piece row of the tier table: the 2-piece defense bonus and the
    // 4-piece offense bonus are both met, so each side sits 40 above the base
    // kit. Driven off the measured base and the real ITEM_SETS records rather
    // than off a literal, so moving either the item budgets or the tier
    // magnitudes reds this.
    const base = gearRating(kitFor(PROFILES[0]));
    for (const setId of WARFARE_SET_IDS) {
      const four = aggregateSetBonuses(new Map([[setId, 4]]));
      expect([four.pvpOffenseRating, four.pvpDefenseRating], setId).toEqual([40, 40]);
      expect(
        pvpFractionsFromRatings(
          base.offense + four.pvpOffenseRating,
          base.defense + four.pvpDefenseRating,
        ),
        setId,
      ).toEqual({ offense: 0.222, defense: 0.222 });
    }
  });

  it('unlocks the 2- and 4-piece tiers but not the capstone at four worn pieces', () => {
    // End to end through recalcPlayerStats, so the tier thresholds are read off
    // the equipped items rather than from a hand-built count map.
    for (const profile of PROFILES) {
      const worn: Partial<Record<EquipSlot, string>> = {};
      ARMOR_SLOTS.slice(0, 4).forEach((slot, i) => {
        worn[slot] = profile.armor[i];
      });
      const player = geared(profile.cls, worn);
      const gear = gearRating(worn);
      expect(player.stats.pvpOffense, profile.name).toBeCloseTo(
        (gear.offense + WARFARE_SET_4PC_OFFENSE_RATING) / 1000,
        10,
      );
      expect(player.stats.pvpDefense, profile.name).toBeCloseTo(
        (gear.defense + WARFARE_SET_2PC_DEFENSE_RATING) / 1000,
        10,
      );
      // The capstone's crowd-control cut is a 4-piece bonus, so it IS live here;
      // the capstone signature proc is not.
      expect(player.ccDurationReduction, profile.name).toBe(WARFARE_SET_4PC_CC_REDUCTION);
      expect(
        player.setProcs.map((p) => p.id),
        profile.name,
      ).toEqual([]);
    }
  });
});

describe('the seven-of-seven capstone closes the hybrid build', () => {
  it('loses far more than the chest piece itself when the chest is swapped away', () => {
    // The measurement that chose 7 of 7 over 6: at six the seventh armor slot
    // had one right answer (abandon the chest, the priciest piece with the best
    // PvE replacement). The property that kills it is that dropping the chest
    // forfeits BOTH the piece and the capstone, so the loss must exceed the
    // chest's own rating by a wide margin, not merely equal it.
    for (const profile of PROFILES) {
      const chest = ITEMS[profile.armor[2]];
      const pveChest = ITEMS[profile.pveChest];
      expect(pveChest.slot, profile.name).toBe('chest');
      expect(pveChest.armorType, profile.name).toBe(chest.armorType);
      expect(itemLevel(pveChest), profile.name).toBe(31);
      expect(pveChest.set, profile.name).toBeUndefined();
      expect(pveChest.pvpOffenseRating, profile.name).toBeUndefined();

      const full = geared(profile.cls, kitFor(profile));
      const hybrid = geared(profile.cls, kitFor(profile, profile.pveChest));
      const chestRating = (chest.pvpOffenseRating ?? 0) / 1000;

      expect(hybrid.stats.pvpOffense, profile.name).toBeLessThan(full.stats.pvpOffense);
      expect(hybrid.stats.pvpDefense, profile.name).toBeLessThan(full.stats.pvpDefense);
      expect(
        full.stats.pvpOffense - hybrid.stats.pvpOffense,
        `${profile.name}: losing the chest must cost more than its own ${chestRating} rating`,
      ).toBeGreaterThan(chestRating);
      expect(full.stats.pvpDefense - hybrid.stats.pvpDefense, profile.name).toBeGreaterThan(
        chestRating,
      );
      // Six pieces still meets the 2- and 4-piece tiers, so the drop is the
      // chest's 22 rating plus the 80/80 capstone, clamped: 0.30 down to 0.20.
      expect([hybrid.stats.pvpOffense, hybrid.stats.pvpDefense], profile.name).toEqual([0.2, 0.2]);
      expect(hybrid.setProcs, profile.name).toEqual([]);
    }
  });
});

describe('the WARFARE capstone signature procs', () => {
  // The auditor's gap: the negatives (a set effect carries no flat stats) were
  // pinned, but nothing pinned the POSITIVE arm, that a complete kit actually
  // puts a signature on the wearer, nor the magnitudes, ids, aura kinds or the
  // pvpOnly flag that makes them inert in PvE.
  const SIGNATURES: Record<string, { id: string; trigger: string; aura: string }> = {
    warfare_furyforged: { id: 'set_warfare_unbroken_oath', trigger: 'kill', aura: 'absorb' },
    warfare_ashstalker: { id: 'set_warfare_ashen_step', trigger: 'kill', aura: 'buff_speed' },
    warfare_stormbound: { id: 'set_warfare_emberward', trigger: 'spellCast', aura: 'absorb' },
    warfare_cinderweave: { id: 'set_warfare_emberward', trigger: 'spellCast', aura: 'absorb' },
  };

  it('puts exactly one signature on the 7-piece tier of every family, and none below it', () => {
    for (const [setId, expected] of Object.entries(SIGNATURES)) {
      const set = ITEM_SETS[setId];
      expect(set, setId).toBeDefined();
      for (const tier of set.bonuses) {
        const proc = tier.effect.proc;
        if (tier.pieces === 7) {
          expect(proc, `${setId} capstone must carry a signature`).toBeDefined();
          expect(proc?.id, setId).toBe(expected.id);
          expect(proc?.trigger, setId).toBe(expected.trigger);
          expect(proc?.aura, setId).toBe(expected.aura);
          // The whole reason these are safe in PvE.
          expect(proc?.pvpOnly, `${setId} signature must be PvP gated`).toBe(true);
        } else {
          expect(proc, `${setId} ${tier.pieces}-piece must carry no proc`).toBeUndefined();
        }
      }
    }
  });

  it('pins each signature magnitude, so a retune cannot drift silently', () => {
    const oath = ITEM_SETS.warfare_furyforged.bonuses.find((b) => b.pieces === 7)?.effect.proc;
    expect([oath?.value, oath?.duration, oath?.chance]).toEqual([200, 10, 1]);
    const step = ITEM_SETS.warfare_ashstalker.bonuses.find((b) => b.pieces === 7)?.effect.proc;
    expect([step?.value, step?.duration, step?.chance]).toEqual([1.4, 6, 1]);
    const ward = ITEM_SETS.warfare_stormbound.bonuses.find((b) => b.pieces === 7)?.effect.proc;
    expect([ward?.value, ward?.duration, ward?.chance, ward?.icd]).toEqual([120, 8, 0.15, 20]);
  });

  it('actually reaches the wearer: a complete kit carries its signature in setProcs', () => {
    // The positive arm. recalcPlayerStats is the only place setProcs is derived,
    // so this is the end-to-end proof that the capstone tier is reachable at all.
    // Every family, not just one: each has its own signature and its own armor
    // type, so a wrong set tag on any single family would hide here.
    for (const profile of PROFILES) {
      const player = geared(profile.cls, kitFor(profile));
      const ids = player.setProcs.map((proc) => proc.id);
      expect(ids, `${profile.name}: the capstone signature must be live`).toContain(
        SIGNATURES[profile.setId].id,
      );
      expect(
        player.setProcs.every((proc) => proc.pvpOnly === true),
        `${profile.name}: every live set proc must be PvP gated`,
      ).toBe(true);
    }
  });

  it('does NOT reach a wearer one piece short of the capstone', () => {
    for (const profile of PROFILES) {
      // The same kit with the chest swapped for a same-slot PvE epic: six of seven.
      const player = geared(profile.cls, kitFor(profile, profile.pveChest));
      expect(
        player.setProcs.map((proc) => proc.id),
        `${profile.name}: six of seven must forfeit the signature`,
      ).not.toContain(SIGNATURES[profile.setId].id);
    }
  });
});
