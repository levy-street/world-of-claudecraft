// Masterwrought crafted mid-band wearability windows and the level-20 shelf.
//
// The measured fault: rare-and-above quality derives requiredLevel from item
// SOURCE level (src/sim/item_level_req.ts), a crafted item's source level IS
// recipe.level (the ALL_RECIPES bump in src/sim/item_level.ts), and every
// rung-50/75 gear recipe shipped level 20, so every crafted rare required
// character level 20 to wear, where the epic shelf obsoletes it on arrival.
// The fix moves recipe.level on the EQUIPPABLE rung-50/75 outputs (50 -> 15,
// 75 -> 17) and nothing else: stats stay authored, the level-20 shelf stays
// byte-identical, and the acceptance is the WINDOW, not the literal (a future
// nudge inside the window is not this suite's business; the exact per-row
// levels are pinned by the catalog suites and tests/item_level.test.ts).
//
// The scope below is DERIVED from ALL_RECIPES, never hand-listed, so a new
// rung-50/75 gear recipe authored at level 20 reds the window arm by name.
import { describe, expect, it } from 'vitest';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, MOBS } from '../src/sim/data';
import { isItemLevelEligible, itemLevel, itemSourceLevel } from '../src/sim/item_level';
import { requiredLevelFor } from '../src/sim/item_level_req';
import type { ItemDef } from '../src/sim/types';

// The one shared-source skip (the sweep's full verdict, recorded in the Phase
// 11o ledger): gravewyrm_bone_quiver is a rung-50 equippable output whose def
// ALSO drops from Korzul the Gravewyrm (level 20), so its source level is
// drop-dominated and its recipe.level is pinned AT that source by the 11l
// trophy convention (tests/item_level.test.ts TROPHY_RECIPE_LEVELS). Moving
// the recipe would not move the gate; the row stays at 20 on purpose. The
// premise is asserted below so a removed drop forces a re-derivation here.
const SHARED_SOURCE_SKIP = new Set(['gravewyrm_bone_quiver']);

interface BandRow {
  recipe: (typeof ALL_RECIPES)[number];
  def: ItemDef;
}

function equippableOutputs(skillReq: number): BandRow[] {
  return ALL_RECIPES.filter((r) => r.skillReq === skillReq)
    .map((recipe) => ({ recipe, def: ITEMS[recipe.resultItemId] }))
    .filter((row): row is BandRow => !!row.def && isItemLevelEligible(row.def));
}

describe('crafted wearability: the mid-band windows (masterwrought Phase 11o)', () => {
  const band50 = equippableOutputs(50);
  const band75 = equippableOutputs(75);

  it('derives a non-vacuous equippable set per band', () => {
    // 17 movers + the shared-source skip + the three 11l trophy outputs at 50;
    // exactly the two grandfathered rares at 75. Floors near the live counts
    // so a filter regression cannot quietly empty a band.
    expect(band50.length).toBeGreaterThanOrEqual(21);
    expect(band75.length).toBeGreaterThanOrEqual(2);
    // The DECISIVE-row split, pinned: the window bound can only fail for
    // level-gated qualities (rare and up; the three uncommon trophy rows are
    // ungated and pass at any level), so the number of rows the window arm
    // really checks is itself a pin.
    const gated = new Set(['rare', 'epic', 'legendary']);
    expect(band50.filter(({ def }) => gated.has(def.quality ?? 'common')).length).toBe(18);
    expect(band75.filter(({ def }) => gated.has(def.quality ?? 'common')).length).toBe(2);
  });

  it('every skip-list member really has a non-crafted source (the skip cannot hide a miss)', () => {
    expect([...SHARED_SOURCE_SKIP].sort()).toEqual(['gravewyrm_bone_quiver']);
    const korzul = MOBS.korzul_the_gravewyrm;
    expect(korzul, 'the skip premise names a live mob').toBeTruthy();
    expect(
      (korzul.loot ?? []).some((l) => l.itemId === 'gravewyrm_bone_quiver'),
      'gravewyrm_bone_quiver must still drop from Korzul, or the skip needs re-deriving',
    ).toBe(true);
    // The drop keeps the gate at the boss level; the crafted route cannot and
    // must not move it.
    expect(requiredLevelFor(ITEMS.gravewyrm_bone_quiver)).toBe(20);
  });

  it('every rung-50 equippable output is wearable at or before level 16', () => {
    for (const { recipe, def } of band50) {
      if (SHARED_SOURCE_SKIP.has(def.id)) continue;
      expect(
        requiredLevelFor(def),
        `${def.id}: requiredLevel derives from recipe.level ${recipe.level} ` +
          `(quality ${def.quality ?? 'common'}, ${recipe.id}); a rung-50 craft ` +
          'must be wearable by 16',
      ).toBeLessThanOrEqual(16);
    }
  });

  it('every rung-75 equippable output is wearable at or before level 18', () => {
    for (const { recipe, def } of band75) {
      if (SHARED_SOURCE_SKIP.has(def.id)) continue;
      expect(
        requiredLevelFor(def),
        `${def.id}: requiredLevel derives from recipe.level ${recipe.level} ` +
          `(quality ${def.quality ?? 'common'}, ${recipe.id}); a rung-75 craft ` +
          'must be wearable by 18',
      ).toBeLessThanOrEqual(18);
    }
  });
});

describe('crafted wearability: the level-20 shelf is unmoved (masterwrought R5 safety)', () => {
  // The apex outputs, derived from the def flag rather than a hand list, each
  // still gate at exactly 20: the re-level touched nothing above the mid band,
  // so Phase 15 inherits no re-measurement. The id set is pinned exactly so a
  // silent membership change reds rather than diluting the claim.
  it('every masterwrought apex equippable still requires level 20, exact set', () => {
    const apex = Object.values(ITEMS)
      .filter((d) => d.masterwrought && isItemLevelEligible(d))
      .map((d) => d.id)
      .sort();
    expect(apex).toEqual([
      'barksong_handguards',
      'briarstep_jerkin',
      'duskforged_bulwark',
      'duskforged_warblade',
      'fenbloom_breeches',
      'forgefold_legguards',
      'gyrelens_array',
      'prismglass_loop',
      'ridgebreaker',
      'spiritweld_girdle',
      'sunspun_handwraps',
      'sunspun_leggings',
      'sunspun_vestments',
      'voidbound_grimoire',
      'wardspeaker_sabatons',
      'warhewn_signet',
      'wyrmfall_pendant',
    ]);
    for (const id of apex) {
      expect(requiredLevelFor(ITEMS[id]), `${id} apex gate`).toBe(20);
      // The ilvl half of the shelf claim: apex recipes register level 25 and
      // epic adds 6, so the derived item level is 31, byte-unmoved.
      expect(itemLevel(ITEMS[id]), `${id} apex item level`).toBe(31);
    }
  });

  it('the drop-sourced same-slot rares the hub pieces were budgeted against keep their gate', () => {
    // These share the movers' slots but derive their source from level-20
    // dungeon loot (and the combo craft path; the source index takes the max),
    // so the re-level must not have moved them, on either axis.
    for (const id of ['boundstone_helm', 'gravewyrm_gauntlets', 'gravewyrm_mantle'] as const) {
      expect(requiredLevelFor(ITEMS[id]), `${id} gate`).toBe(20);
      expect(itemLevel(ITEMS[id]), `${id} item level`).toBe(23);
    }
  });

  it('every gated equippable sourced at 20 or above still gates at 20 (heroic, raid, vendor included)', () => {
    // The category-free form of the shelf claim: whatever the source
    // (dungeon and heroic loot, the raid, the marks and honor counters, the
    // apex recipes), a rare-or-better equippable whose source level sits at
    // or past the level cap derives requiredLevel exactly 20. The re-level
    // only ever LOWERED crafted sources below 20, so this whole population
    // is byte-unmoved. The membership count is pinned EXACTLY: for a row
    // with no explicit requiredLevel the gate below is arithmetic on the
    // same source read as the filter, so a source dropping under 20 would
    // exit the population instead of redding; the exact count is what makes
    // a single silent exit loud (re-pin deliberately when content ships).
    const gated = new Set(['rare', 'epic', 'legendary']);
    const shelf = Object.values(ITEMS).filter(
      (d) =>
        isItemLevelEligible(d) &&
        gated.has(d.quality ?? 'common') &&
        (itemSourceLevel(d.id) ?? 0) >= 20,
    );
    // Re-pinned 266 -> 454 at the eighth v0.41.0 sync (2026-08-30): the
    // release's Ignivar span ships 188 new gated equippables sourced at or
    // past the cap (the Crucible set roster, the raid drop tables, the
    // Thronebane-band legendaries), every one deriving the same level-20
    // gate the sweep below asserts; no packet row moved.
    expect(shelf.length).toBe(454);
    for (const def of shelf) {
      expect(requiredLevelFor(def), `${def.id} shelf gate`).toBe(20);
    }
  });
});
