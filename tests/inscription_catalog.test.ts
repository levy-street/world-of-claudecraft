// Inscription base catalog pins (Masterwrought phase 06): the six
// trainer-taught INSCRIPTION_RECIPES (src/sim/content/recipes.ts) and their
// crafted outputs (src/sim/content/profession_items.ts), one caster tome plus
// one buff scroll per rung. This suite owns the catalog's own shape the way
// tests/jewelcrafting_catalog.test.ts owns its nine: rung structure, the
// apothecary binding, the herb/ink reagent identity (dust/essence, NEVER
// shard), the two quality ladders (tomes uncommon/uncommon/rare, scrolls
// common/uncommon/rare), formula-exact tome budgets on the held-offhand line,
// and the ruling-R14 zero-rating rule. Economy (output strictly below input)
// and the foreign-bound station pin live in recipe_economy /
// professions_crafting_hub; the scroll/elixir family-payload mirror and the
// both-orders exclusivity live in tests/inscription_scroll_exclusivity.test.ts;
// none are restated here.
import { describe, expect, it } from 'vitest';
import { HEROIC_VENDOR_ITEMS } from '../src/sim/content/heroic_vendor';
import { CASTER_ALL } from '../src/sim/content/items';
import { WARFARE_ITEMS } from '../src/sim/content/pvp_honor';
import { INSCRIPTION_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import {
  expectedStatBudget,
  itemLevel,
  primaryStatBudget,
  primaryStatSum,
  QUALITY_ILVL_BONUS,
} from '../src/sim/item_level';
import { requiredLevelFor } from '../src/sim/item_level_req';
import { trainingFeeFor } from '../src/sim/professions/training';
import type { ItemDef } from '../src/sim/types';

// The cross-craft scaffolding convention (recipes.ts LADDER_RECIPES header):
// skillReq 0 -> level 10 / budget 10, 25 -> 15/16, 50 -> 20/20.
const CONVENTION: Record<number, { level: number; itemLevelBudget: number }> = {
  0: { level: 10, itemLevelBudget: 10 },
  25: { level: 15, itemLevelBudget: 16 },
  50: { level: 20, itemLevelBudget: 20 },
};

// TOME quality per rung (the phase 06 ledger's extension of the approved
// phase 05 deviation): uncommon at BOTH leveling rungs (common quality
// carries no primary-stat budget and held_offhand has no armor axis, so a
// common tome would carry literally nothing), rare exclusively at 50.
const TOME_QUALITY_BY_RUNG: Record<number, string> = { 0: 'uncommon', 25: 'uncommon', 50: 'rare' };

// SCROLL quality per rung mirrors the elixir ladder it alternates with
// (boar common, venomfire uncommon, serpent rare): quality does not gate a
// consumable's effect, so the common rung is fine here and is itself a pin
// that the tome deviation stays scoped to stat-bearing gear.
const SCROLL_QUALITY_BY_RUNG: Record<number, string> = { 0: 'common', 25: 'uncommon', 50: 'rare' };

// Formula-derived primary-stat budget per tome rung on the HELD offhand line
// (SLOT_STAT_MULT.offhand 0.75, occupiesHand defaulted true): pinned as
// literals so a silent item_budget retune cannot rebalance the catalog
// without this suite forcing a deliberate re-author.
const TOME_BUDGET_BY_RUNG: Record<number, number> = { 0: 3, 25: 5, 50: 10 };

// The herb ladder per rung: the pigment base every recipe of the rung mills.
// Three DISTINCT herbs (asserted below), the inscription sibling of the JC
// flux liveness control: a flattened one-herb table would be a re-author.
const HERB_BY_RUNG: Record<number, string> = {
  0: 'silverleaf_herb',
  25: 'goldleaf_herb',
  50: 'sunpetal_herb',
};

// The COMPLETE shipped reagent line per recipe, id and count, pinned as
// literals (the phase 05 QA mutation-probe-f lesson: without the exact table
// a silent herb or ink re-author passes every sim-side suite and only the
// guide-content cross-pin, which a routine wiki regen satisfies, would red).
const REAGENTS_BY_RECIPE: Record<string, Record<string, number>> = {
  recipe_silverleaf_primer: { silverleaf_herb: 3, arcane_dust: 2, glass_vial: 1 },
  recipe_silverleaf_scroll: { silverleaf_herb: 2, arcane_dust: 1, glass_vial: 1 },
  recipe_goldleaf_folio: { goldleaf_herb: 2, arcane_essence: 1, glass_vial: 1 },
  recipe_goldleaf_scroll: { goldleaf_herb: 1, arcane_essence: 1, glass_vial: 1 },
  recipe_sunpetal_grimoire: {
    sunpetal_herb: 2,
    arcane_essence: 2,
    glass_vial: 1,
    goldleaf_herb: 2,
  },
  recipe_sunpetal_scroll: { sunpetal_herb: 1, arcane_essence: 1, glass_vial: 1 },
};

// The one-time training fee per rung in copper (TRAINING_FEE_BY_TIER tiers
// 0/1/2, which is where skillReq 0/25/50 land through tierForSkill).
const FEE_BY_RUNG: Record<number, number> = { 0: 0, 25: 2500, 50: 10000 };

// Every rating key an ItemDef can carry (src/sim/types.ts). Ruling R14: the
// base-rung catalog is rating-free.
const RATING_KEYS = [
  'spellPower',
  'critRating',
  'hasteRating',
  'hitRating',
  'pvpOffenseRating',
  'pvpDefenseRating',
] as const;

const TOME_IDS = new Set(['silverleaf_primer', 'goldleaf_folio', 'sunpetal_grimoire']);
const SCROLL_IDS = new Set(['silverleaf_scroll', 'goldleaf_scroll', 'sunpetal_scroll']);

function output(recipe: (typeof INSCRIPTION_RECIPES)[number]): ItemDef {
  const def = ITEMS[recipe.resultItemId];
  expect(def, `${recipe.id} result ${recipe.resultItemId}`).toBeDefined();
  return def;
}

describe('inscription catalog shape', () => {
  it('ships exactly six recipes, one tome and one scroll per rung, on the convention pairs', () => {
    expect(INSCRIPTION_RECIPES).toHaveLength(6);
    const byRung = new Map<number, ItemDef[]>();
    for (const recipe of INSCRIPTION_RECIPES) {
      const convention = CONVENTION[recipe.skillReq];
      expect(convention, `${recipe.id} rung ${recipe.skillReq}`).toBeDefined();
      expect(recipe.level, `${recipe.id} level`).toBe(convention.level);
      expect(recipe.itemLevelBudget, `${recipe.id} budget`).toBe(convention.itemLevelBudget);
      const defs = byRung.get(recipe.skillReq) ?? [];
      defs.push(output(recipe));
      byRung.set(recipe.skillReq, defs);
    }
    expect([...byRung.keys()].sort((a, b) => a - b)).toEqual([0, 25, 50]);
    for (const [rung, defs] of byRung) {
      expect(defs.filter((d) => TOME_IDS.has(d.id)).length, `rung ${rung} tome`).toBe(1);
      expect(defs.filter((d) => SCROLL_IDS.has(d.id)).length, `rung ${rung} scroll`).toBe(1);
    }
  });

  it('every recipe is apothecary-bound, trainer-taught, inscription-home', () => {
    for (const recipe of INSCRIPTION_RECIPES) {
      expect(recipe.professionId, recipe.id).toBe('inscription');
      expect(recipe.stationType, recipe.id).toBe('apothecary');
      expect(recipe.acquisition, recipe.id).toEqual(['trainer']);
    }
  });

  it('batches only the rung-50 scroll (the serpent-elixir shape); all else single-output', () => {
    for (const recipe of INSCRIPTION_RECIPES) {
      const expected = recipe.id === 'recipe_sunpetal_scroll' ? 2 : 1;
      expect(recipe.resultCount, recipe.id).toBe(expected);
    }
  });

  it('mills EXACTLY its rung herb plus one ink vessel per recipe', () => {
    // Liveness for the herb table itself: three distinct herbs, or the ladder
    // was flattened.
    expect(new Set(Object.values(HERB_BY_RUNG)).size).toBe(3);
    for (const recipe of INSCRIPTION_RECIPES) {
      const shipped = Object.fromEntries(recipe.reagents.map((r) => [r.itemId, r.count]));
      expect(shipped[HERB_BY_RUNG[recipe.skillReq]], `${recipe.id} rung herb`).toBeGreaterThan(0);
      expect(shipped.glass_vial, `${recipe.id} ink vessel`).toBe(1);
    }
  });

  it('charges the tier training fee ladder 0 / 2500 / 10000 per rung', () => {
    // Liveness: the ladder really rises, or the table was flattened.
    expect(FEE_BY_RUNG[0]).toBe(0);
    expect(FEE_BY_RUNG[50]).toBeGreaterThan(FEE_BY_RUNG[25]);
    expect(FEE_BY_RUNG[25]).toBeGreaterThan(FEE_BY_RUNG[0]);
    for (const recipe of INSCRIPTION_RECIPES) {
      expect(trainingFeeFor(recipe), `${recipe.id} fee`).toBe(FEE_BY_RUNG[recipe.skillReq]);
    }
  });

  it('consumes EXACTLY the shipped reagent table, every line of every recipe', () => {
    expect(Object.keys(REAGENTS_BY_RECIPE)).toHaveLength(6);
    for (const recipe of INSCRIPTION_RECIPES) {
      const shipped = Object.fromEntries(recipe.reagents.map((r) => [r.itemId, r.count]));
      // Distinct-lines control: the object collapse above must not hide a
      // duplicated reagent line.
      expect(recipe.reagents.length, `${recipe.id} distinct lines`).toBe(
        Object.keys(shipped).length,
      );
      expect(shipped, recipe.id).toStrictEqual(REAGENTS_BY_RECIPE[recipe.id]);
    }
  });

  it('no recipe consumes arcane_shard or any fine grade; the dust/essence ink is really consumed', () => {
    const consumed = new Set(
      INSCRIPTION_RECIPES.flatMap((recipe) => recipe.reagents.map((r) => r.itemId)),
    );
    expect(consumed.has('arcane_shard')).toBe(false);
    // A fine grade beside its base double-counts one consumption pool
    // (material_grades disjointness); the catalog uses base herbs only.
    for (const id of consumed) {
      expect(id.startsWith('fine_'), `${id} is a fine grade`).toBe(false);
    }
    // Positive controls for both negative sweeps above.
    expect(consumed.has('arcane_dust')).toBe(true);
    expect(consumed.has('arcane_essence')).toBe(true);
    expect(ITEMS.fine_silverleaf_herb, 'fine grades exist to be excluded').toBeDefined();
    // Token-liveness control for the shard negative: if the shard id ever
    // renames, the exclusion above must fail here rather than go vacuous.
    expect(ITEMS.arcane_shard, 'the excluded shard id must stay live').toBeDefined();
  });
});

describe('inscription catalog outputs', () => {
  it('maps tome quality uncommon/uncommon/rare and scroll quality common/uncommon/rare', () => {
    let tomes = 0;
    let scrolls = 0;
    for (const recipe of INSCRIPTION_RECIPES) {
      const def = output(recipe);
      if (TOME_IDS.has(def.id)) {
        expect(def.quality, def.id).toBe(TOME_QUALITY_BY_RUNG[recipe.skillReq]);
        tomes += 1;
      } else {
        expect(def.quality, def.id).toBe(SCROLL_QUALITY_BY_RUNG[recipe.skillReq]);
        scrolls += 1;
      }
    }
    expect(tomes).toBe(3);
    expect(scrolls).toBe(3);
    // Rare stays exclusive to rung 50 on both ladders (the deed rare-tier
    // derivation keys off it).
    for (const recipe of INSCRIPTION_RECIPES) {
      if (output(recipe).quality === 'rare') expect(recipe.skillReq).toBe(50);
    }
  });

  it('each rung yields one HELD caster tome and one stackable scroll', () => {
    for (const recipe of INSCRIPTION_RECIPES) {
      const def = output(recipe);
      if (TOME_IDS.has(def.id)) {
        expect(def.kind, def.id).toBe('held_offhand');
        expect(def.slot, def.id).toBe('offhand');
        // HELD, not worn: a tome is carried in the hand, so it budgets on the
        // offhand slot line, and the two-hand exclusion applies.
        expect(
          (def as { occupiesHand?: false }).occupiesHand,
          `${def.id} held (occupiesHand defaulted)`,
        ).toBeUndefined();
        expect(def.stats?.armor, `${def.id} no armor axis`).toBeUndefined();
        expect((def as { armorType?: string }).armorType, def.id).toBeUndefined();
        expect(def.requiredClass, `${def.id} caster lock`).toEqual(CASTER_ALL);
      } else {
        expect(def.kind, def.id).toBe('scroll');
        expect((def as { slot?: string }).slot, `${def.id} slotless`).toBeUndefined();
        expect(def.stats, `${def.id} carries no stats`).toBeUndefined();
        expect(def.stackSize, `${def.id} default stack`).toBeUndefined();
        expect(def.requiredClass, `${def.id} usable by every class`).toBeUndefined();
        expect(def.elixir, `${def.id} carries the family payload`).toBeDefined();
      }
    }
    // The caster lock is the live six-class list, not a stale copy.
    expect(CASTER_ALL).toEqual(['mage', 'priest', 'warlock', 'shaman', 'paladin', 'druid']);
  });

  it('every tome carries EXACTLY its formula budget, derived at the recipe level', () => {
    let checked = 0;
    for (const recipe of INSCRIPTION_RECIPES) {
      const def = output(recipe);
      if (!TOME_IDS.has(def.id)) continue;
      const bonus = QUALITY_ILVL_BONUS[def.quality ?? 'common'];
      expect(bonus, `${def.id} quality bump`).toBeGreaterThan(0);
      const level = recipe.level + bonus;
      const formulaBudget = primaryStatBudget(level, def.quality, def.slot);
      expect(formulaBudget, `${def.id} formula budget`).toBe(TOME_BUDGET_BY_RUNG[recipe.skillReq]);
      expect(primaryStatSum(def), `${def.id} authored stats`).toBe(formulaBudget);
      expect(itemLevel(def), `${def.id} item level`).toBe(level);
      expect(expectedStatBudget(def), `${def.id} live source index`).toBe(formulaBudget);
      checked += 1;
    }
    expect(checked).toBe(3);
  });

  it('carries zero rating fields on every output (ruling R14, all six keys)', () => {
    for (const recipe of INSCRIPTION_RECIPES) {
      const def = output(recipe);
      for (const key of RATING_KEYS) {
        expect(def[key], `${def.id} must not carry ${key}`).toBeUndefined();
      }
    }
    // Positive controls, the jewelcrafting suite's reasoning inherited whole:
    // three distinct content-backed keys plus the WARFARE pvp pair prove the
    // vocabulary live, and the derived set proves the list is drawn from
    // RATING_KEYS. spellPower has no static exemplar; its liveness rests on
    // the type system (ItemDef has no index signature, so a renamed field is
    // a tsc error, not a silently-undefined read).
    expect(HEROIC_VENDOR_ITEMS.seal_of_the_nine_oaths.hitRating).toBeGreaterThan(0);
    expect(HEROIC_VENDOR_ITEMS.sutils_gambit.critRating).toBeGreaterThan(0);
    expect(HEROIC_VENDOR_ITEMS.zyzzs_deathless_signet.hasteRating).toBeGreaterThan(0);
    expect(WARFARE_ITEMS.furyforged_warhelm.pvpOffenseRating).toBeGreaterThan(0);
    expect(WARFARE_ITEMS.furyforged_warhelm.pvpDefenseRating).toBeGreaterThan(0);
    const liveKeys = new Set(
      [...Object.values(HEROIC_VENDOR_ITEMS), ...Object.values(WARFARE_ITEMS)].flatMap((def) =>
        RATING_KEYS.filter((key) => (def[key] ?? 0) > 0),
      ),
    );
    expect([...liveKeys].sort()).toEqual([
      'critRating',
      'hasteRating',
      'hitRating',
      'pvpDefenseRating',
      'pvpOffenseRating',
    ]);
  });

  it('derives equip level requirements from the recipe registration (rare tome gate only)', () => {
    for (const recipe of INSCRIPTION_RECIPES) {
      const def = output(recipe);
      if (TOME_IDS.has(def.id)) {
        // The jewelcrafting arm exactly: rare-and-up gates at the registered
        // recipe level, leveling greens stay ungated.
        const expected = def.quality === 'rare' ? 20 : 1;
        expect(requiredLevelFor(def), `${def.id} equip level`).toBe(expected);
      } else {
        // A scroll is consumed, not equipped, and nothing gates USE on this
        // value (meetsLevelRequirement is consulted only on the equip path):
        // requiredLevelFor here is metadata the tooltip and sort surfaces
        // read. It must agree with the BAND elixir the scroll alternates
        // with (derived, so a policy change moves both sources together).
        const bandElixir = {
          silverleaf_scroll: 'elixir_of_the_boar',
          goldleaf_scroll: 'venomfire_elixir',
          sunpetal_scroll: 'elixir_of_the_serpent',
        }[def.id];
        expect(bandElixir, `${def.id} has a band elixir`).toBeDefined();
        expect(requiredLevelFor(def), `${def.id} matches its band elixir`).toBe(
          requiredLevelFor(ITEMS[bandElixir as string]),
        );
      }
    }
    // Literal anchor so a global requiredLevelFor regression (everything 1,
    // or 0) cannot satisfy the derived equalities above: the rare band
    // really carries the level-20 registration.
    expect(requiredLevelFor(ITEMS.sunpetal_scroll)).toBe(20);
  });

  it('stocks no output at a vendor (crafted, never bought)', () => {
    for (const recipe of INSCRIPTION_RECIPES) {
      const def = output(recipe);
      expect(def.buyValue, `${def.id} must carry no buyValue`).toBeUndefined();
      expect(def.sellValue, `${def.id} sell value`).toBeGreaterThan(0);
    }
    // Anti-vacuity: buyValue is a live field some shipped item really sets.
    const vendorStocked = Object.values(ITEMS).filter((def) => (def.buyValue ?? 0) > 0);
    expect(vendorStocked.length).toBeGreaterThan(0);
  });

  it('every output has a catalog name row that byte-matches its def (Sheenleaf display register)', async () => {
    // The def name is the sim-side English source and the catalog row is what
    // t() renders; the two must agree byte for byte, including the id/display
    // split on the two silverleaf ids (frozen silverleaf ids, Sheenleaf
    // displays, matching silverleaf_herb whose display is Sheenleaf Herb).
    const { en } = await import('../src/ui/i18n.resolved.generated/en');
    const items = (en as unknown as { entities: { items: Record<string, { name?: string }> } })
      .entities.items;
    for (const recipe of INSCRIPTION_RECIPES) {
      const def = output(recipe);
      expect(items[def.id]?.name, `catalog row for ${def.id}`).toBe(def.name);
    }
    expect(items.silverleaf_primer?.name).toBe('Sheenleaf Primer');
    expect(items.silverleaf_scroll?.name).toBe('Sheenleaf Scroll');
    expect(items.sunpetal_grimoire?.name).toBe('Sunpetal Grimoire');
  });
});
