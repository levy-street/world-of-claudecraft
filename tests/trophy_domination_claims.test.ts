// The TROPHY_RECIPES header's domination and exclusion claims, RECOMPUTED.
//
// The 11l-RUNG EXCLUSION RECORD in src/sim/content/recipes.ts explains, one
// trophy id at a time, why a junk drop got no consumer recipe: either no
// uncrafted item of the right register sits in its value band, or every one that
// does is strictly dominated by a row the trainer already teaches. Those are
// numeric selections over ALL_RECIPES and ITEMS, and nothing checked them,
// because the outcome each one asserts is the ABSENCE of a row. The header says
// so itself about the weapon band: "the counts below were measured 2026-08-24
// and no test pins them, so re-derive them when a weapon lands in the band."
// This file is that re-derivation, so a stronger uncrafted in-band weapon reds
// here instead of leaving a paragraph of prose quietly false.
//
// It is the sibling of tests/helpers/adopted_trophy_ids.test.ts, which pins the
// derivation of WHICH trophies were adopted; this pins the reasoning behind the
// ones that were not.
//
// ONE CLAIM IS ALREADY STALE and is pinned as a live census with the
// contradiction named rather than quietly re-worded: see the jewelcrafting arm.
import { describe, expect, it } from 'vitest';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';

/** Everything a shipped recipe produces, trophy rows included: the header's own
 *  "uncrafted" predicate (recipeForResultItem) read over the merged table. */
const CRAFTED = new Set(ALL_RECIPES.map((r) => r.resultItemId));

/** Uncrafted, and authored: a generated heroic variant is not an authorable
 *  trophy output, and counting them would drift the census with generation. */
function uncrafted(def: ItemDef): boolean {
  return !CRAFTED.has(def.id) && def.heroicOf === undefined && def.heroic !== true;
}

/** The header's band shape: strictly above the trophy's sellValue, at most the
 *  rung's crafted-output ceiling. */
function inBand(def: ItemDef, trophyValue: number, ceiling: number): boolean {
  return def.sellValue > trophyValue && def.sellValue <= ceiling;
}

/** The dps derivation the header prints, and the one item_level.ts uses. */
function dps(def: ItemDef): number {
  return def.weapon ? (def.weapon.min + def.weapon.max) / 2 / def.weapon.speed : 0;
}

/** A caster weapon carries a caster primary or spell power; everything else in
 *  the band is a physical row. The header splits the weapon census this way. */
function isCasterWeapon(def: ItemDef): boolean {
  return (def.stats?.int ?? 0) > 0 || (def.stats?.spi ?? 0) > 0 || (def.spellPower ?? 0) > 0;
}

function pool(predicate: (def: ItemDef) => boolean): ItemDef[] {
  return Object.values(ITEMS)
    .filter((def) => uncrafted(def) && predicate(def))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

describe('the chipped tusk weaponcrafting exclusion, recomputed', () => {
  // "of the 25 uncrafted weapons with sellValue in (15, 460], the 18 physical
  // rows are strictly dominated by the trainer's OWN rung-25 row
  // recipe_whetted_iron_dirk ... The 7 caster rows have no rung-25 comparand,
  // since weaponcrafting serves casters only at rung 50, where
  // recipe_elderwood_battle_staff dominates all seven."
  const band = () => pool((d) => d.kind === 'weapon' && inBand(d, 15, 460));

  it('the band still holds 25 weapons, 18 physical and 7 caster', () => {
    const weapons = band();
    expect(weapons.length, 'uncrafted weapons in (15, 460]').toBe(25);
    expect(weapons.filter((d) => !isCasterWeapon(d)).length, 'physical rows').toBe(18);
    // The caster half by ID, not just by count: the split is what decides which
    // comparand each row is judged against, so a row crossing it must be seen.
    expect(weapons.filter(isCasterWeapon).map((d) => d.id)).toEqual([
      'apprentice_staff',
      'corpse_candle_focus',
      'drovers_staff',
      'fenreed_staff',
      'hickory_shortstaff',
      'staff_of_drowned_prayers',
      'voss_sanctified_mace',
    ]);
  });

  it('no in-band PHYSICAL row reaches the trainer dirk, on the header numbers', () => {
    const dirk = ITEMS.whetted_iron_dirk;
    // The comparand's own figures, pinned as literals: the claim is about THIS
    // dirk, and a retune of it silently rewrites the whole exclusion.
    expect(dps(dirk).toFixed(1), 'dirk dps').toBe('11.1');
    expect(dirk.stats, 'dirk stats').toEqual({ agi: 5, sta: 2 });
    expect(dirk.requiredClass, 'the dirk carries no class lock').toBeUndefined();
    expect(CRAFTED.has(dirk.id), 'the dirk is the trainer row it claims to be').toBe(true);
    const stronger = band()
      .filter((d) => !isCasterWeapon(d) && dps(d) >= dps(dirk))
      .map((d) => `${d.id} (${dps(d).toFixed(2)} dps)`);
    expect(
      stronger,
      `these uncrafted physical weapons now match or beat the dirk: ${stronger.join(', ')}`,
    ).toEqual([]);
  });

  it('no in-band CASTER row reaches the rung-50 battle staff', () => {
    const staff = ITEMS.elderwood_battle_staff;
    expect(staff.quality, 'the staff is the rare rung-50 row').toBe('rare');
    expect(staff.stats, 'staff stats').toEqual({ int: 9, spi: 4 });
    expect(dps(staff).toFixed(2), 'staff dps').toBe('8.33');
    expect(staff.requiredClass, 'the staff carries no class lock').toBeUndefined();
    const stronger = band()
      .filter((d) => isCasterWeapon(d) && dps(d) >= dps(staff))
      .map((d) => `${d.id} (${dps(d).toFixed(2)} dps)`);
    expect(stronger, `these uncrafted caster weapons now match the staff`).toEqual([]);
    // Non-vacuity: the sweep really ran over caster rows with real weapons, so
    // an empty result is a comparison and not an empty set.
    expect(
      band()
        .filter(isCasterWeapon)
        .every((d) => dps(d) > 0),
    ).toBe(true);
  });
});

describe('the cracked fetish inscription exclusion, recomputed', () => {
  // "its one in-register uncrafted output, valefire_lantern ... is strictly
  // dominated by the trainer's OWN rows recipe_goldleaf_folio and
  // recipe_silverleaf_primer ... No other uncrafted caster offhand sits in
  // (14, 178]".
  const CASTER_LOCK = ['mage', 'priest', 'warlock', 'shaman', 'paladin', 'druid'];

  it('exactly one uncrafted CASTER offhand sits in the band', () => {
    const inBandOffhands = pool((d) => d.kind === 'held_offhand' && inBand(d, 14, 178));
    const caster = inBandOffhands.filter(
      (d) => (d.stats?.int ?? 0) > 0 || (d.stats?.spi ?? 0) > 0 || (d.spellPower ?? 0) > 0,
    );
    expect(
      caster.map((d) => d.id),
      'in-register uncrafted offhands',
    ).toEqual(['valefire_lantern']);
    // The register filter is what narrows it, not the band: the hunter quiver
    // the header names IS in the band and is excluded by register, so a test
    // that dropped the register check would read two and still look right.
    expect(inBandOffhands.map((d) => d.id).sort()).toEqual([
      'moggers_hide_quiver',
      'valefire_lantern',
    ]);
    expect(ITEMS.moggers_hide_quiver.requiredClass, 'the quiver is hunter-locked').toEqual([
      'hunter',
    ]);
  });

  it('the lantern is strictly dominated by both trainer rows, axis by axis', () => {
    const lantern = ITEMS.valefire_lantern;
    const folio = ITEMS.goldleaf_folio;
    const primer = ITEMS.silverleaf_primer;
    for (const [name, dominator] of [
      ['folio', folio],
      ['primer', primer],
    ] as const) {
      expect(CRAFTED.has(dominator.id), `${name} is a trainer row`).toBe(true);
      expect(dominator.slot, `${name} slot`).toBe(lantern.slot);
      expect(dominator.quality, `${name} quality`).toBe(lantern.quality);
      expect(dominator.requiredClass, `${name} lock`).toEqual(CASTER_LOCK);
      // MORE stats and CHEAPER, which is the "strictly dominated" the header
      // claims: the lantern's only winning axis is its own sellValue.
      const sum = (d: ItemDef) => (d.stats?.int ?? 0) + (d.stats?.spi ?? 0);
      expect(sum(dominator), `${name} out-stats the lantern`).toBeGreaterThan(sum(lantern));
      expect(dominator.sellValue, `${name} is cheaper`).toBeLessThan(lantern.sellValue);
    }
    expect(lantern.requiredClass, 'the lantern lock').toEqual(CASTER_LOCK);
  });
});

describe('the bogiron nugget armorcrafting exclusion, recomputed', () => {
  // "hobnail_boots ... is strictly dominated by the trainer's OWN rung-0 row
  // recipe_coppermail_sabatons ... No other uncrafted mail foot sits in
  // (12, 100]".
  it('exactly one uncrafted mail foot sits in the band, and the sabatons beat it', () => {
    const inBandFeet = pool(
      (d) =>
        d.kind === 'armor' &&
        (d as { armorType?: string }).armorType === 'mail' &&
        d.slot === 'feet' &&
        inBand(d, 12, 100),
    );
    expect(inBandFeet.map((d) => d.id)).toEqual(['hobnail_boots']);
    const boots = ITEMS.hobnail_boots;
    const sabatons = ITEMS.coppermail_sabatons;
    expect(CRAFTED.has(sabatons.id), 'the sabatons are a trainer row').toBe(true);
    expect(sabatons.slot).toBe(boots.slot);
    expect((sabatons as { armorType?: string }).armorType).toBe(
      (boots as { armorType?: string }).armorType,
    );
    expect(sabatons.quality).toBe(boots.quality);
    expect(sabatons.stats?.armor ?? 0, 'sabatons armour').toBeGreaterThan(boots.stats?.armor ?? 0);
    // Neither carries a stat, so armour is the whole comparison and the
    // domination is total rather than one-axis.
    for (const stat of ['str', 'agi', 'sta', 'int', 'spi'] as const) {
      expect(boots.stats?.[stat] ?? 0, `boots ${stat}`).toBe(0);
      expect(sabatons.stats?.[stat] ?? 0, `sabatons ${stat}`).toBe(0);
    }
  });
});

describe('the jewelcrafting exclusion, recomputed: the header is now STALE', () => {
  it('the neck and ring census no longer matches the header, and is pinned live', () => {
    // The header claims "the uncrafted neck and ring pool is 25 items: 9 honor
    // pieces at sellValue 0 and 16 above 600 ... nothing in (25, 460]". The
    // live tree answers a bigger pool and one row inside the band, because
    // content shipped after the record was written. This arm does NOT re-word
    // the header (that is a content decision): it pins the live census so the
    // drift is visible in a run rather than sitting in prose, and so the next
    // move of it is deliberate. OPEN FINDING for the maintainer: the
    // jewelcrafting exclusion's stated ground no longer holds.
    const jewelry = pool((d) => d.kind === 'armor' && (d.slot === 'neck' || d.slot === 'ring'));
    expect(jewelry.length, 'uncrafted neck and ring pool').toBe(34);
    expect(jewelry.filter((d) => d.sellValue === 0).length, 'honor pieces at 0').toBe(9);
    expect(jewelry.filter((d) => d.sellValue > 600).length, 'pieces above 600').toBe(24);
    // The header says NOTHING sits here. One row does.
    expect(
      jewelry.filter((d) => inBand(d, 25, 460)).map((d) => d.id),
      'uncrafted neck/ring inside the rung ceiling band the header calls empty',
    ).toEqual(['mother_of_pearl']);
    expect(ITEMS.mother_of_pearl.sellValue, 'the in-band row value').toBe(50);
  });
});
