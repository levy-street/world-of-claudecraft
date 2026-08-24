// THE PROVISIONING SUPPLY LINE (Phase 11g): farm produce is a real reagent
// family at the rungs players actually level through.
//
// THE GROUNDING FACT, and the reason this phase was additive rather than a
// rebalance. Before it the entire cooking tree used 17 distinct reagents and
// NOT ONE was a vegetable or a grain: spider_leg, cooking_salt, game_meat,
// prime_cut, the three herbs, ashwood_log, the six raw fish, seasoned_stock,
// quickening_catalyst and wyrmfall_core. Farming was not competing for a slot
// in a full pantry, it was filling a class that had never existed, which is
// what made "add, never substitute" cheap to honor: nothing had to move over.
//
// THIS FILE OWNS THE CROSS-PACKET RULE THE PHASE CREATES, and it is deliberately
// NOT a second copy of the masterwrought R17 firewall. That fence lives in
// tests/provisioner_firewall.test.ts under its own one-file-for-one-invariant
// rule (this phase EXTENDED it with the consumable-intermediate carve-out
// rather than forking its carve-out shape here). What this file asserts is the
// positive claim: produce reaches the leveling ladder, at a gate a player can
// actually clear, as an accent rather than a body, and without costing
// herbalism, fishing or skinning a single reagent.
//
// EVERY SET BELOW IS DERIVED FROM THE LIVE TABLES, never from a hand list, so a
// later roster widening (Phase 11e took the crop ladder from eight crops to
// twelve without touching a line of this shape) is covered by existing.
import { describe, expect, it } from 'vitest';
import { FARM_CROPS, farmCropSkillThreshold } from '../src/sim/content/farm_crops';
import { RAW_COOKING_CATCH_IDS } from '../src/sim/content/items';
import { ALL_RECIPES, FARM_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, STATIONS } from '../src/sim/data';
import { requiredReagentCountFor, resolveCraft } from '../src/sim/professions/crafting';
import { stationsOfType } from '../src/sim/professions/stations';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { materialCostMultiplier } from '../src/sim/professions/wheel';
import { Sim } from '../src/sim/sim';

/** Every farm PRODUCE id and its fine twin, derived from the crop catalog. The
 *  seed ids are deliberately NOT here: a seed is the input side of the farming
 *  loop and is vendor-stocked at EVERY tier, so folding it in would let a
 *  recipe satisfy "consumes produce" by consuming a vendor good. (This read
 *  "tiers 1 to 3" until masterwrought Phase 11h checked it: Phase 11e's GATE 1
 *  stocked all four tier-4 seeds at farmer_verbena too, so the exclusion is
 *  broader than the note claimed, never narrower.) */
const PRODUCE_IDS: ReadonlySet<string> = new Set(
  Object.values(FARM_CROPS).flatMap((crop) => [crop.produceItemId, crop.fineProduceItemId]),
);

/** The tier a produce id belongs to, resolved through the catalog rather than
 *  parsed out of the id. Returns undefined for anything that is not produce. */
function produceTier(itemId: string): number | undefined {
  for (const crop of Object.values(FARM_CROPS)) {
    if (crop.produceItemId === itemId || crop.fineProduceItemId === itemId) return crop.tier;
  }
  return undefined;
}

/** The economy unit basis, the same rule tests/recipe_economy.test.ts reads:
 *  buyValue when the def carries a positive one, else sellValue. */
function reagentUnitValue(itemId: string): number {
  const def = ITEMS[itemId];
  if (!def) throw new Error(`reagent ${itemId} has no ItemDef`);
  return typeof def.buyValue === 'number' && def.buyValue > 0 ? def.buyValue : def.sellValue;
}

const produceConsumers = (): ProfessionRecipeRecord[] =>
  ALL_RECIPES.filter((r) => r.reagents.some((g) => PRODUCE_IDS.has(g.itemId)));

const LEVELING_RUNGS = [0, 25, 50] as const;

describe('the provisioning supply line: derivation floors', () => {
  it('sweeps a non-empty produce family and a non-empty recipe table', () => {
    // The vacuity floor every arm below rests on. Both sides are derived, so a
    // catalog rename that emptied either would otherwise make this whole file
    // pass over nothing.
    expect(PRODUCE_IDS.size, 'the produce family (base plus fine twins)').toBeGreaterThanOrEqual(
      24,
    );
    expect(Object.keys(FARM_CROPS).length, 'the crop roster').toBeGreaterThanOrEqual(12);
    expect(ALL_RECIPES.length, 'the merged recipe table').toBeGreaterThan(100);
    for (const id of PRODUCE_IDS) {
      expect(ITEMS[id], `${id} must be a real ItemDef`).toBeDefined();
      // The TIER is knowable, so pin the band rather than mere definedness: a
      // resolver that returned a constant would satisfy toBeDefined for every
      // id while making the tier gate below meaningless.
      expect(produceTier(id), `${id} tier`).toBeGreaterThanOrEqual(1);
      expect(produceTier(id), `${id} tier`).toBeLessThanOrEqual(4);
    }
    // And the roster really spans all four tiers, so the gate arm is exercised
    // across the whole band rather than over one repeated value.
    expect(
      new Set(Object.values(FARM_CROPS).map((c) => c.tier)),
      'the roster must span every tier',
    ).toEqual(new Set([1, 2, 3, 4]));
  });
});

describe('masterwrought R17 RULE 1: the tier gate', () => {
  it('no recipe asks for produce gated above its own rung', () => {
    // THE WHOLE ANSWER to "obtainable at the tier where the recipe unlocks": a
    // crop's plant gate must sit at or below the recipe's skillReq, so a player
    // levelling both skills together is never blocked by the pantry.
    //
    // DERIVED BY CALLING farmCropSkillThreshold, never by re-typing its
    // (tier - 1) * 25 arithmetic. A re-typed copy compared against itself is a
    // constant-self-comparison and would pass even if the shipped band math
    // changed underneath it.
    const consumers = produceConsumers();
    expect(
      consumers.length,
      'produce must have consumers for this sweep to mean anything',
    ).toBeGreaterThan(20);
    let checked = 0;
    for (const recipe of consumers) {
      for (const reagent of recipe.reagents) {
        const tier = produceTier(reagent.itemId);
        if (tier === undefined) continue;
        checked += 1;
        expect(
          farmCropSkillThreshold(tier),
          `${recipe.id} takes ${reagent.itemId} (tier ${tier}) at skillReq ${recipe.skillReq}`,
        ).toBeLessThanOrEqual(recipe.skillReq);
      }
    }
    // The floor is set ABOVE the pre-phase count (33), not merely above zero:
    // at 25 this could not have noticed a total revert of the phase.
    expect(checked, 'the reagent-level sweep must cover the whole live table').toBeGreaterThan(40);
  });

  it('the gate really is the shipped band math, tier by tier', () => {
    // Non-vacuity for the arm above: if farmCropSkillThreshold ever returned a
    // constant the sweep would pass over nothing meaningful, so pin what the
    // four tiers actually gate at.
    expect(farmCropSkillThreshold(1)).toBe(0);
    expect(farmCropSkillThreshold(2)).toBe(25);
    expect(farmCropSkillThreshold(3)).toBe(50);
    expect(farmCropSkillThreshold(4)).toBe(75);
  });
});

describe('masterwrought R17: rung coverage on the leveling ladder', () => {
  // THE FIRST ARM IS SUBSUMED BY THE SECOND, deliberately and with the reason
  // recorded: `outside` is a subset of all produce consumers, so the thesis arm
  // below can only pass if this one does, and this one can never fail alone.
  // It is kept because the phase's acceptance list states the two claims
  // SEPARATELY (coverage at every rung, and a consumer outside FARM_RECIPES at
  // every rung), and a reader checking the weaker claim should find it asserted
  // rather than inferred. It costs one cheap sweep and gives the simpler failure
  // message when both break together.
  it('cooking and alchemy each consume produce at skillReq 0, 25 and 50', () => {
    for (const craft of ['cooking', 'alchemy'] as const) {
      for (const rung of LEVELING_RUNGS) {
        const rows = produceConsumers().filter(
          (r) => r.professionId === craft && r.skillReq === rung,
        );
        expect(
          rows.map((r) => r.id),
          `${craft} must consume produce at rung ${rung}`,
        ).not.toHaveLength(0);
      }
    }
  });

  it('THE SUPPLY LINE IS REAL, NOT SELF-REFERENTIAL: a consumer outside FARM_RECIPES at every rung', () => {
    // THIS IS THE PHASE'S THESIS and the arm that goes red if a future edit
    // quietly walks it back. Farming feeding farming's own dishes proves
    // nothing: before this phase every produce-consuming row in the game was
    // one farming wrote for itself, plus the hoe ladder. What makes a supply
    // LINE is a buyer on a ladder somebody else built.
    const farmOwnIds = new Set(FARM_RECIPES.map((r) => r.id));
    const outside = produceConsumers().filter((r) => !farmOwnIds.has(r.id));
    for (const craft of ['cooking', 'alchemy'] as const) {
      for (const rung of LEVELING_RUNGS) {
        const rows = outside.filter((r) => r.professionId === craft && r.skillReq === rung);
        expect(
          rows.map((r) => r.id),
          `${craft} rung ${rung} needs a produce consumer farming did not write`,
        ).not.toHaveLength(0);
      }
    }
    // And the set really excludes something, so the filter above is doing work
    // rather than passing everything through.
    expect(farmOwnIds.size, 'FARM_RECIPES must be non-empty').toBeGreaterThan(10);
    expect(
      produceConsumers().filter((r) => farmOwnIds.has(r.id)).length,
      'farming rows must still be produce consumers too',
    ).toBeGreaterThan(5);
  });
});

/** Every cooking row carrying a raw fish. Hoisted so the two arms below cannot
 *  drift: while each derived its own copy, the second one silently lost the
 *  non-empty floor the first has. */
const fishRows = (): ProfessionRecipeRecord[] =>
  ALL_RECIPES.filter(
    (r) =>
      r.professionId === 'cooking' && r.reagents.some((g) => RAW_COOKING_CATCH_IDS.has(g.itemId)),
  );

/** The crop family a produce id belongs to (base and fine twin share one). */
function cropFamily(itemId: string): string {
  for (const crop of Object.values(FARM_CROPS)) {
    if (crop.produceItemId === itemId || crop.fineProduceItemId === itemId) return crop.id;
  }
  return itemId;
}

describe('masterwrought R17: fish dishes stay fish-forward', () => {
  it('the shipped raw-catch set is exactly these ten', () => {
    // THE FISH SET COMES FROM THE SHIPPED CONTENT EXPORT, not a copy, so this
    // and the list tests/recipe_economy.test.ts sweeps cannot diverge: both rest
    // on RAW_COOKING_CATCH_IDS.
    //
    // ITS OWN ARM ON PURPOSE. This membership pin is a literal, so Phase 11i
    // (which owns fishing) had to edit it when it added its catches. Keeping it
    // out of the fish-forward arm meant that edit reddened THIS line rather
    // than making the mechanic arm look broken, and that is exactly what
    // happened: the three high-band catches below arrived here and nowhere
    // else. The SWEEPS below needed no edit at all; a new catch joins them by
    // existing, which is the property this split was for.
    expect([...RAW_COOKING_CATCH_IDS].sort()).toEqual([
      'glimmerfin_koi',
      'raw_bog_eel',
      'raw_deepbarb_catfish',
      'raw_frostgill_trout',
      'raw_hollowgill_sturgeon',
      'raw_marsh_pike',
      'raw_mirror_trout',
      'raw_river_perch',
      'raw_stillmere_salmon',
      'raw_stonescale_carp',
    ]);
  });

  it('every cooking row carrying a raw fish keeps more fish than produce', () => {
    // Stated as a mechanic rather than a taste: a chowder taking a root is
    // still a fish dish; a fish row whose vegetables outnumber its fish is not.
    const rows = fishRows();
    expect(rows.length, 'the fish-dish sweep must be non-empty').toBeGreaterThan(4);
    const fishRowsList = rows;
    let withProduce = 0;
    for (const recipe of fishRowsList) {
      const fish = recipe.reagents
        .filter((g) => RAW_COOKING_CATCH_IDS.has(g.itemId))
        .reduce((t, g) => t + g.count, 0);
      const produce = recipe.reagents
        .filter((g) => PRODUCE_IDS.has(g.itemId))
        .reduce((t, g) => t + g.count, 0);
      if (produce > 0) withProduce += 1;
      expect(
        fish,
        `${recipe.id}: fish ${fish} must outnumber produce ${produce} on a fish dish`,
      ).toBeGreaterThan(produce);
    }
    // NON-VACUITY, and it is the whole point of this arm: the strictly-greater
    // comparison is trivially true on a fish row carrying no produce at all, so
    // without this floor the sweep would stay green if the phase were reverted.
    expect(
      withProduce,
      'at least one fish dish must actually carry produce, or this arm proves nothing',
    ).toBeGreaterThanOrEqual(2);
  });

  it('at most one crop family joins a fish row', () => {
    const rows = fishRows();
    expect(rows.length, 'the fish-dish sweep must be non-empty').toBeGreaterThan(4);
    const familiesOn = (recipe: ProfessionRecipeRecord): Set<string> =>
      new Set(
        recipe.reagents.filter((g) => PRODUCE_IDS.has(g.itemId)).map((g) => cropFamily(g.itemId)),
      );
    for (const recipe of rows) {
      expect(
        familiesOn(recipe).size,
        `${recipe.id} may take at most one crop family beside its fish`,
      ).toBeLessThanOrEqual(1);
    }
    // NON-VACUITY, and this arm needed it more than its sibling did: "at most
    // one" is trivially true of the ZERO families a produce-free fish row has,
    // and most fish rows are produce-free by design (the rung controls). Without
    // this floor the loop would make no real assertion at all if the phase were
    // reverted, and would still be green.
    expect(
      rows.filter((r) => familiesOn(r).size === 1).length,
      'at least two fish rows must actually carry a crop family',
    ).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// THE ROWS THIS PHASE TOUCHED, and everything pinned per-row.
// ---------------------------------------------------------------------------

/** The nine shipped rows Phase 11g put produce into, with the EXACT produce
 *  entries authored. A literal on purpose: the derived sweeps above prove the
 *  rules hold over whatever ships, and this proves what actually shipped. A
 *  phase that walked one row back would keep every derived arm green as long as
 *  the other rungs still had a member; only this table sees it. */
const TOUCHED_ROWS: ReadonlyArray<{
  readonly id: string;
  readonly produce: ReadonlyArray<readonly [string, number]>;
  /** Every NON-produce reagent as shipped, so masterwrought R18's "add, never
   *  substitute" is a fact about each row and not just about three herb totals.
   *  Totals alone can be gamed by moving a reagent between rows; this closes it
   *  for the herb, fish, meat and salt lines at once. */
  readonly untouched: ReadonlyArray<readonly [string, number]>;
  /** The EXACT shipped reagent sequence, produce interleaved where it was
   *  authored. Added at the Phase 11g QA (qr-11G-ORDER) because the arm below
   *  claimed this coverage and did not have it: it pinned the produce entries
   *  and the non-produce entries as two separate ordered lists, which leaves
   *  the INTERLEAVING free, and then spelled the full order out for two rows
   *  only. A mutation moving vale_wheat to the end of the skewer, the exact
   *  example that arm's own comment names, passed this whole file. (It reddened
   *  the wiki-regen freshness diff in tests/guide.test.ts, because
   *  content.generated.ts carries the arrays verbatim, so the tree caught it;
   *  but that is an incidental guard in another file over a surface a row can
   *  leave, not the pin this file says it holds.) */
  readonly order: ReadonlyArray<string>;
}> = [
  {
    id: 'recipe_hunters_game_skewer',
    order: ['game_meat', 'vale_wheat', 'cooking_salt'],
    produce: [['vale_wheat', 1]],
    untouched: [
      ['game_meat', 2],
      ['cooking_salt', 1],
    ],
  },
  {
    id: 'recipe_goldleaf_game_stew',
    order: ['game_meat', 'vale_wheat', 'bog_beet', 'goldleaf_herb', 'cooking_salt'],
    produce: [
      ['vale_wheat', 2],
      ['bog_beet', 1],
    ],
    untouched: [
      ['game_meat', 3],
      ['goldleaf_herb', 1],
      ['cooking_salt', 1],
    ],
  },
  {
    id: 'recipe_frostgill_chowder',
    order: ['raw_frostgill_trout', 'brook_carrot', 'silverleaf_herb', 'cooking_salt'],
    produce: [['brook_carrot', 1]],
    untouched: [
      ['raw_frostgill_trout', 2],
      ['silverleaf_herb', 2],
      ['cooking_salt', 2],
    ],
  },
  {
    id: 'recipe_silvered_carp_supper',
    order: [
      'raw_stonescale_carp',
      'raw_mirror_trout',
      'marsh_rice',
      'goldleaf_herb',
      'cooking_salt',
    ],
    produce: [['marsh_rice', 2]],
    untouched: [
      ['raw_stonescale_carp', 3],
      ['raw_mirror_trout', 1],
      ['goldleaf_herb', 1],
      ['cooking_salt', 1],
    ],
  },
  {
    id: 'recipe_marlows_grand_roast',
    order: [
      'prime_cut',
      'game_meat',
      'highland_barley',
      'frost_gourd',
      'sunpetal_herb',
      'cooking_salt',
    ],
    produce: [
      ['highland_barley', 2],
      ['frost_gourd', 2],
    ],
    untouched: [
      ['prime_cut', 1],
      ['game_meat', 4],
      ['sunpetal_herb', 1],
      ['cooking_salt', 2],
    ],
  },
  {
    id: 'recipe_elixir_of_the_boar',
    order: ['venom_gland', 'vale_wheat', 'silverleaf_herb', 'glass_vial'],
    produce: [['vale_wheat', 1]],
    untouched: [
      ['venom_gland', 2],
      ['silverleaf_herb', 2],
      ['glass_vial', 1],
    ],
  },
  {
    id: 'recipe_venomfire_elixir',
    order: ['venom_gland', 'bog_beet', 'goldleaf_herb', 'glass_vial'],
    produce: [['bog_beet', 2]],
    untouched: [
      ['venom_gland', 3],
      ['goldleaf_herb', 1],
      ['glass_vial', 1],
    ],
  },
  {
    id: 'recipe_elixir_of_the_serpent',
    order: ['pristine_venom_gland', 'venom_gland', 'frost_gourd', 'sunpetal_herb', 'glass_vial'],
    produce: [['frost_gourd', 1]],
    untouched: [
      ['pristine_venom_gland', 1],
      ['venom_gland', 2],
      ['sunpetal_herb', 1],
      ['glass_vial', 1],
    ],
  },
  {
    id: 'recipe_seasoned_stock',
    order: [
      'prime_cut',
      'game_meat',
      'marsh_rice',
      'bog_beet',
      'cooking_salt',
      'quickening_catalyst',
    ],
    produce: [
      ['marsh_rice', 2],
      ['bog_beet', 2],
    ],
    untouched: [
      ['prime_cut', 1],
      ['game_meat', 3],
      ['cooking_salt', 2],
      ['quickening_catalyst', 1],
    ],
  },
];

function requireRecipe(id: string): ProfessionRecipeRecord {
  const recipe = ALL_RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`recipe ${id} missing`);
  return recipe;
}

/** EVERY row the accent rule governs, derived rather than listed: a consumable
 *  row that consumes produce and that farming did not write.
 *
 *  THE TWO EXCLUSIONS ARE THE RULE'S OWN SCOPE, not convenience. Farming's own
 *  dishes are excluded because they OWN the body role, which is the premise the
 *  rule rests on (the hearth loaf's wheat 3 IS the loaf). The hoe ladder is
 *  excluded because it is not a consumable row at all; it rides masterwrought
 *  R17's separate gathering-tool carve-out and takes a fine twin at count 4.
 *  Neither exclusion can widen quietly: both are structural, and the floor
 *  below fails if the derived set ever shrinks. */
function accentGovernedRows(): ProfessionRecipeRecord[] {
  const farmOwnIds = new Set(FARM_RECIPES.map((r) => r.id));
  return ALL_RECIPES.filter(
    (r) =>
      (r.professionId === 'cooking' || r.professionId === 'alchemy') &&
      !farmOwnIds.has(r.id) &&
      r.reagents.some((g) => PRODUCE_IDS.has(g.itemId)),
  );
}

/** RULE 2 AS ONE EXPRESSION, read by BOTH sweeps below and by the positive
 *  control (qr-11G-ACCENT, Phase 11g QA). It used to be written out three
 *  times: inline in the COUNT sweep, inline in the VALUE sweep, and a third
 *  time as a local `accentOk` helper inside the control. A control that drives
 *  its own copy of a rule proves the copy can say no, never the enforcer, so an
 *  edit to either sweep's operator would have left the control green. Now the
 *  control drives exactly what ships.
 *
 *  THE TWO HALVES USE DIFFERENT OPERATORS ON PURPOSE, and the asymmetry is the
 *  packet's rather than an oversight: RULE 2 says the crop's count stays
 *  "strictly below" the row's largest non-produce COUNT, but its share of
 *  inputValue stays "at or below" the reference reagent's share.
 *
 *  THE VALUE HALF'S REFERENCE IS THE DOMINANT NON-PRODUCE REAGENT BY
 *  CONTRIBUTION, which is what "the body" means when a bill is priced, and it
 *  is a RECORDED READING rather than the only possible one. See the VALUE arm
 *  below for what the alternative reading would refuse. */
function accentVerdict(
  nonProduce: ReadonlyArray<readonly [string, number]>,
  produceId: string,
  produceCount: number,
): {
  countOk: boolean;
  valueOk: boolean;
  capOk: boolean;
  largestCount: number;
  dominant: number;
  value: number;
} {
  const largestCount = Math.max(...nonProduce.map(([, n]) => n));
  const dominant = Math.max(...nonProduce.map(([id, n]) => n * reagentUnitValue(id)));
  const value = produceCount * reagentUnitValue(produceId);
  return {
    countOk: produceCount < largestCount,
    valueOk: value <= dominant,
    // THE ABSOLUTE ACCENT CAP, folded in at the Phase 11g QA (qr-11G-CAP). It
    // used to sit inline in the COUNT sweep, outside this expression, so the
    // control below could not exercise it and it had no rejection proof at all.
    // It is an INDEPENDENT bound rather than a restatement of countOk: on a row
    // whose largest non-produce count is 5, a crop at 4 clears countOk and is
    // stopped only here. "A shipped ladder row takes 1 or 2" is the packet's
    // own wording, so 2 is the number.
    capOk: produceCount <= 2,
    largestCount,
    dominant,
    value,
  };
}

/** The non-produce bill of a live row, in the shape accentVerdict reads. */
const nonProduceBill = (recipe: ProfessionRecipeRecord): ReadonlyArray<readonly [string, number]> =>
  recipe.reagents
    .filter((g) => !PRODUCE_IDS.has(g.itemId))
    .map((g) => [g.itemId, g.count] as const);

describe('masterwrought R17 RULE 2: the accent rule', () => {
  it('every touched row carries exactly the produce entries this phase authored', () => {
    expect(TOUCHED_ROWS.length, 'the touched-row table').toBe(9);
    for (const row of TOUCHED_ROWS) {
      const recipe = requireRecipe(row.id);
      const actual = recipe.reagents
        .filter((g) => PRODUCE_IDS.has(g.itemId))
        .map((g) => [g.itemId, g.count]);
      expect(actual, `${row.id} produce entries`).toEqual(row.produce.map(([id, n]) => [id, n]));
    }
  });

  it('the accent rule governs a real, non-empty set of rows', () => {
    // The floor under both arms below. The set is derived, so a later phase's
    // rows join it by existing rather than by somebody remembering to extend a
    // list.
    //
    // THE FLOOR MOVES WITH THE SET, and the Phase 11h QA is why it says so
    // rather than leaving the number where 11g put it. Phase 11g wrote this
    // floor at NINE against a set of exactly nine, so it was tight. Phase 11h
    // nearly doubled the set to SEVENTEEN (its three role plates, its three
    // flasks and its two capstones all joined by existing) and left the floor
    // at nine, which meant all eight of the new rows could have dropped out of
    // the sweep with this arm still green. That matters more here than the
    // usual vacuity case: BOTH of Phase 11h's recorded deviations from settled
    // rulings (the flask grain at 1, the capstones at 2 plus 1) are justified
    // by this sweep governing those rows, so a sweep that stopped covering them
    // would retire the justification silently.
    const rows = accentGovernedRows();
    expect(rows.length, 'the accent-governed sweep').toBeGreaterThanOrEqual(17);
    // And the two exclusions really exclude: farming's own dishes and the hoe
    // ladder are OUT, which is what makes the sweep a rule about shipped ladder
    // rows rather than about every produce consumer in the game.
    const ids = rows.map((r) => r.id);
    expect(ids, 'farming own dishes are excluded').not.toContain('recipe_vale_hearth_loaf');
    expect(ids, 'the hoe ladder is excluded').not.toContain('recipe_bronze_hoe');
    expect(ids, 'the Phase 11g rows are included').toContain('recipe_marlows_grand_roast');
    expect(ids, 'the choke point is included').toContain('recipe_seasoned_stock');
    // ONE NAMED ROW PER PHASE 11h FAMILY, because a bare count cannot say WHICH
    // seventeen: the three families reached the sweep by three different routes
    // (a rung-100 food row, a rung-100 daily-gated flask, a rung-125 capstone),
    // so a walk-back that removed any one family alone is named here.
    expect(ids, 'the Phase 11h role plates are included').toContain('recipe_stonepot_stew');
    expect(ids, 'the Phase 11h flasks are included').toContain('recipe_ironhusk_flask');
    expect(ids, 'the Phase 11h capstones are included').toContain('recipe_laden_hearth');
  });

  it('the accent rule actually REJECTS a violating row (the positive control)', () => {
    // Without this, both arms below could be tautologies over a shipped table
    // that happens to satisfy them: nothing would prove the predicate can ever
    // say no. The synthetic row is the exact substitution this phase refused,
    // brook_carrot 1 on the rung-0 skewer's real non-produce bill.
    // DRIVEN THROUGH accentVerdict, the same expression both sweeps below read,
    // rather than a local re-implementation of it (qr-11G-ACCENT).
    //
    // The bill is derived from the LIVE skewer rather than typed out, so a
    // future re-price of game_meat or cooking_salt moves this control with the
    // row instead of leaving it asserting against a bill that stopped shipping.
    const skewerBill = nonProduceBill(requireRecipe('recipe_hunters_game_skewer'));
    expect(
      skewerBill.map(([id]) => id),
      'the control drives the live rung-0 bill',
    ).toEqual(['game_meat', 'cooking_salt']);
    // REJECTED on value: brook_carrot contributes 16 against a dominant of 8.
    const carrot = accentVerdict(skewerBill, 'brook_carrot', 1);
    expect(carrot.valueOk, `carrot ${carrot.value} against dominant ${carrot.dominant}`).toBe(
      false,
    );
    // ACCEPTED: the binder the phase used instead, 4 against 8.
    const wheat = accentVerdict(skewerBill, 'vale_wheat', 1);
    expect(wheat.countOk && wheat.valueOk).toBe(true);
    // REJECTED on count: two wheat ties game_meat's 2 rather than staying under.
    const twoWheat = accentVerdict(skewerBill, 'vale_wheat', 2);
    expect(twoWheat.countOk, `two wheat against largest count ${twoWheat.largestCount}`).toBe(
      false,
    );
    // BOTH HALVES REJECT INDEPENDENTLY, asserted per dimension rather than
    // through one combined boolean: without this a predicate that had lost its
    // value half entirely would still fail the carrot case on count and look
    // healthy. The carrot passes on COUNT (1 is under 2) and fails only on
    // value; the two wheat pass on VALUE (8 is at the dominant 8) and fail only
    // on count. So each case isolates exactly one half.
    expect(carrot.countOk, 'the carrot case must isolate the VALUE half').toBe(true);
    expect(twoWheat.valueOk, 'the two-wheat case must isolate the COUNT half').toBe(true);

    // THE SECOND AUTHORED REFUSAL, driven rather than left as prose
    // (qr-11G-BOAR, Phase 11g QA). The comment on the VALUE arm below records
    // that brook_carrot was refused on TWO rows, the rung-0 skewer and
    // recipe_elixir_of_the_boar, but only the skewer was ever driven. The boar
    // is the sharper of the two: its dominant reagent is 12, not 8, so it is
    // the row that says the refusal is not an artifact of one unusually cheap
    // bill. Derived from the live row for the same reason as the skewer.
    const boarBill = nonProduceBill(requireRecipe('recipe_elixir_of_the_boar'));
    const boarCarrot = accentVerdict(boarBill, 'brook_carrot', 1);
    expect(
      boarCarrot.valueOk,
      `boar carrot ${boarCarrot.value} against dominant ${boarCarrot.dominant}`,
    ).toBe(false);
    expect(boarCarrot.dominant, 'the boar is the dearer of the two refusals').toBe(12);
    expect(accentVerdict(boarBill, 'vale_wheat', 1).valueOk, 'the binder it took instead').toBe(
      true,
    );

    // THE CAP HALF, which had no rejection proof at all until it moved into
    // accentVerdict (qr-11G-CAP). Driven on a synthetic bill whose largest
    // non-produce count is 5, because that is the only shape where the cap and
    // the count half disagree: a crop at 3 clears countOk and must still be
    // refused as a body-sized helping.
    const roomyBill = [['game_meat', 5]] as const;
    const three = accentVerdict(roomyBill, 'vale_wheat', 3);
    expect(three.countOk, 'three under a largest count of five clears the COUNT half').toBe(true);
    expect(three.capOk, 'but the absolute accent cap must still refuse it').toBe(false);
    expect(accentVerdict(roomyBill, 'vale_wheat', 2).capOk, 'two is the cap, not over it').toBe(
      true,
    );
  });

  it('a crop is a seasoning and never the body, by COUNT', () => {
    // A crop's count stays STRICTLY below the row's largest non-produce count.
    // Farming's own dishes own the body role (the hearth loaf takes wheat 3,
    // the barley bannock takes barley 4); a shipped ladder row takes 1 or 2.
    //
    // SWEPT, NOT LISTED. This used to iterate TOUCHED_ROWS, which made RULE 2 a
    // fact about nine rows instead of a standing rule: Phases 11h, 11i and 11k
    // all add produce to shipped rows by the packet's own ownership section, and
    // every one of them could have made a crop the body with this file green.
    for (const recipe of accentGovernedRows()) {
      const bill = nonProduceBill(recipe);
      for (const reagent of recipe.reagents) {
        if (!PRODUCE_IDS.has(reagent.itemId)) continue;
        const verdict = accentVerdict(bill, reagent.itemId, reagent.count);
        expect(
          verdict.countOk,
          `${recipe.id}: ${reagent.itemId} at ${reagent.count} must stay under the row's largest non-produce count ${verdict.largestCount}`,
        ).toBe(true);
        expect(verdict.capOk, `${recipe.id}: ${reagent.itemId} is an accent`).toBe(true);
      }
    }
  });

  it('a crop is a seasoning and never the body, by VALUE', () => {
    // The value half, and the reading is recorded because the rule names a
    // single reagent and a row can have several: the reference is the row's
    // DOMINANT non-produce reagent by share of inputValue, which is what "the
    // body" means when a bill is priced. That reading is the one masterwrought
    // DECISION C is executable under: the settled seasoned stock takes
    // marsh_rice 2 plus bog_beet 2 (16 each) against a quickening_catalyst
    // worth 50, and a largest-COUNT reading would have measured it against
    // game_meat's 12 and forbidden the decision's own authored counts.
    //
    // IT STILL HAS TEETH, and the phase proved it in authoring rather than
    // claiming it: brook_carrot was REFUSED on recipe_hunters_game_skewer and
    // on recipe_elixir_of_the_boar because its farming D9 buyValue of 16 puts
    // it above those rows' dominant reagents (8 and 12), which is exactly this
    // arm firing. Both rows took vale_wheat at 4 instead.
    //
    // THE PRICES THAT STORY RESTS ON ARE PINNED, because reagentUnitValue sits
    // on BOTH sides of the comparison: a repricing would move the bound and the
    // contribution together and the recorded refusal would evaporate silently.
    expect(reagentUnitValue('brook_carrot'), 'the D9 fee vegetable').toBe(16);
    expect(reagentUnitValue('vale_wheat'), 'the binder that replaced it').toBe(4);
    expect(reagentUnitValue('game_meat')).toBe(4);
    expect(reagentUnitValue('venom_gland')).toBe(6);
    // THE OPERATOR IS at-or-below ON PURPOSE, and the difference from the COUNT
    // arm's strictly-below is the contract's, not an oversight: RULE 2 says the
    // crop's count stays "strictly below" but its share of inputValue stays "at
    // or below". A crop that exactly ties the dominant reagent's contribution
    // still is not the body, so tightening this to strictly-below would enforce
    // something the packet never ruled. ONE ROW TIES SINCE masterwrought Phase
    // 11h and it is the reason the operator matters rather than a curiosity:
    // recipe_laden_hearth's fine_evergarden_greens contributes 1 x 320 against
    // a dominant of 2 x sunpetal_herb = 320, exactly equal, so it ships only
    // because the contract says at-or-below. (Before 11h the closest was the
    // chowder at 16 against 20.) A phase that tightened this to strictly-below
    // would now refuse a settled capstone bill.
    // Swept, not listed, for the same reason as the COUNT arm above, and routed
    // through accentVerdict so the control above drives this exact expression.
    const ties: string[] = [];
    for (const recipe of accentGovernedRows()) {
      const bill = nonProduceBill(recipe);
      for (const reagent of recipe.reagents) {
        if (!PRODUCE_IDS.has(reagent.itemId)) continue;
        const verdict = accentVerdict(bill, reagent.itemId, reagent.count);
        expect(
          verdict.valueOk,
          `${recipe.id}: ${reagent.itemId} contributes ${verdict.value} and must not exceed the row's dominant non-produce reagent at ${verdict.dominant}`,
        ).toBe(true);
        if (verdict.value === verdict.dominant) ties.push(`${recipe.id}/${reagent.itemId}`);
      }
    }
    // THE TIE IS ASSERTED, not only described (added at the Phase 11h QA). The
    // paragraph above says the at-or-below operator is load-bearing rather than
    // hypothetical BECAUSE exactly one shipped row ties, and until now nothing
    // checked that a tie still exists. A retune that removed it would leave the
    // operator choice untested and this comment quietly false, which is the same
    // rot the packet keeps finding in its own records. Listed by id, so the
    // maintainer decision this feeds (masterwrought R17 RULE 2's value-half
    // reading) is costed against a set rather than a count.
    expect(ties.sort(), 'exactly one shipped row ties the dominant reagent').toEqual([
      'recipe_laden_hearth/fine_evergarden_greens',
    ]);
  });

  it('THE VALUE HALF IS A RECORDED READING, and this is what the other one refuses', () => {
    // THE READING IS OPEN AND IT IS THE MAINTAINER'S (qr-11G-RULE2, surfaced at
    // the Phase 11g QA). The packet text reads "its share of inputValue stays at
    // or below THAT REAGENT'S share", where "that reagent" grammatically names
    // the row's largest non-produce reagent BY COUNT, the same reference the
    // count half uses. The shipped arm above instead measures against the
    // DOMINANT non-produce reagent by contribution.
    //
    // The phase recorded that the count reading makes settled DECISION C
    // unexecutable. That is true and it is NOT the whole blast radius, which is
    // why this arm exists rather than a sentence in a doc: the count reading
    // refuses FIVE produce entries across THREE shipped rows, and two of those
    // rows are DECISION B's, not DECISION C's. Measured here so the maintainer's
    // choice is costed rather than argued, and so that adopting the other
    // reading is a known edit to a known list instead of a discovery.
    //
    // THE COST GREW AT masterwrought Phase 11h, from FIVE entries across THREE
    // shipped rows to NINE across SEVEN, and the phase surfaced that rather than
    // quietly re-pinning it. The four new ones were all APEX rows: each of the
    // three role plates took a tier-3 crop worth 30 against a count reference
    // of 16 (game_meat 4), and recipe_laden_hearth's fine_evergarden_greens is
    // worth 320 against a reference of 80 (prime_cut 4). Everything the flasks
    // and the alchemy capstone added clears BOTH readings, because those bills
    // are priced by sunpetal_herb at the same count that carries the reference.
    //
    // THEN IT SHRANK AT masterwrought Phase 11i, nine entries across seven rows
    // back to SIX across FOUR, and the shrink was a SIDE EFFECT rather than an
    // intent, which is exactly why it is written down here. 11i appended a
    // uniform Raw Deepbarb Catfish row at count 4 to the three role plates.
    // Four TIES game_meat's 4, which was the plates' count reference, and this
    // arm's tie-break takes the most permissive tied reagent, so the reference
    // moves from game_meat's 16 to the catfish's 56 and the tier-3 crop at 30
    // now clears the count reading it used to fail. Nothing about the crops
    // moved; a non-produce reagent arrived beside them and changed what they
    // are measured against.
    //
    // THE OPEN DECISION IS THEREFORE CHEAPER THAN 11h COSTED IT, and that is
    // the finding: adopting the count reading is now an edit to FOUR shipped
    // rows, not seven, and none of the three plates 11h-GATE-A and -B settled
    // is among them any more. It also means the cost is not monotone: a later
    // phase adding a high-count non-produce reagent to a row can retire a
    // refusal without touching a crop, so this list must be re-measured
    // whenever any governed bill changes, never carried forward.
    const refusedUnderCountReading: string[] = [];
    for (const recipe of accentGovernedRows()) {
      const nonProduce = recipe.reagents.filter((g) => !PRODUCE_IDS.has(g.itemId));
      const largestCount = Math.max(...nonProduce.map((g) => g.count));
      // The count reading is ambiguous when several reagents TIE on count, so
      // take the most permissive tied reference: a row refused even under the
      // kindest tie-break is refused under every reading of it.
      const countReference = Math.max(
        ...nonProduce
          .filter((g) => g.count === largestCount)
          .map((g) => g.count * reagentUnitValue(g.itemId)),
      );
      for (const reagent of recipe.reagents) {
        if (!PRODUCE_IDS.has(reagent.itemId)) continue;
        if (reagent.count * reagentUnitValue(reagent.itemId) > countReference) {
          refusedUnderCountReading.push(`${recipe.id}/${reagent.itemId}`);
        }
      }
    }
    // The ROW count is stated separately from the entry list, because the cost
    // of the open decision is "how many shipped bills would have to be edited",
    // and five entries across three rows is a very different bill from nine
    // across SEVEN. (Nine entries over seven rows rather than nine:
    // recipe_marlows_grand_roast and recipe_seasoned_stock contribute two
    // entries each.)
    //
    // COUNTED OFF THE LITERAL ABOVE, not off the derived list (Phase 11h QA).
    // Derived from `refusedUnderCountReading` this could not fail: the toEqual
    // one line up has already pinned that list to the nine literal keys, whose
    // distinct row count is seven by inspection. Counting the LITERAL instead
    // makes it the checksum it was meant to be, in the same shape as the
    // alchemy herb map and total in tests/provisioning_supply_line_apex.test.ts:
    // a careless edit that adds a tenth key on a new row now has to move this
    // number too.
    const REFUSED_UNDER_COUNT_READING = [
      'recipe_elixir_of_the_serpent/frost_gourd',
      'recipe_laden_hearth/fine_evergarden_greens',
      'recipe_marlows_grand_roast/frost_gourd',
      'recipe_marlows_grand_roast/highland_barley',
      'recipe_seasoned_stock/bog_beet',
      'recipe_seasoned_stock/marsh_rice',
    ];
    expect(refusedUnderCountReading.sort()).toEqual(REFUSED_UNDER_COUNT_READING);
    expect(
      new Set(REFUSED_UNDER_COUNT_READING.map((k) => k.split('/')[0])).size,
      'shipped rows the count reading would force an edit to',
    ).toBe(4);
    // THE THREE PLATES ARE PINNED OUT, not merely absent. An entry leaving this
    // list is the interesting direction (it makes the open decision look
    // cheaper), so the mechanism that retired them is asserted rather than
    // trusted: the catfish ties game_meat on count and beats it on value, which
    // is the whole reason the crops now clear.
    for (const plate of [
      'recipe_stonepot_stew',
      'recipe_warspice_skewers',
      'recipe_sageleaf_chowder',
    ]) {
      const bill = requireRecipe(plate).reagents;
      const meat = bill.find((g) => g.itemId === 'game_meat');
      const fish = bill.find((g) => g.itemId === 'raw_deepbarb_catfish');
      expect(fish?.count, `${plate} fish count ties the old reference`).toBe(meat?.count);
      expect(
        (fish?.count ?? 0) * reagentUnitValue('raw_deepbarb_catfish'),
        `${plate} fish value beats the old reference`,
      ).toBeGreaterThan((meat?.count ?? 0) * reagentUnitValue('game_meat'));
      expect(refusedUnderCountReading.some((k) => k.startsWith(`${plate}/`))).toBe(false);
    }
    // And the shipped reading accepts every one of them, so the two really do
    // disagree rather than this list being an artifact of how it was computed.
    for (const key of refusedUnderCountReading) {
      const [recipeId, itemId] = key.split('/');
      const recipe = requireRecipe(recipeId);
      const entry = recipe.reagents.find((g) => g.itemId === itemId);
      expect(entry, `${key} must exist`).toBeDefined();
      expect(
        accentVerdict(nonProduceBill(recipe), itemId, entry?.count ?? 0).valueOk,
        `${key} must be accepted by the SHIPPED reading`,
      ).toBe(true);
    }
  });
});

describe('masterwrought R18 and farming D24: the displacement guard', () => {
  it('herbalism loses nothing: the three herb totals are unchanged', () => {
    // THE PIN THAT MAKES "HERBALISM LOSES NOTHING" A FACT INSTEAD OF A PROMISE.
    // Predicted before the edits and observed after: this phase adds reagents
    // and reduces none, so all three totals had to stand still. BASE herbs
    // only, matching the scope tests/farm_seed_channels.test.ts already uses
    // and for the same recorded reason: the three fine_* herb twins have no
    // recipe consumer anywhere on the merged tree, which predates this phase.
    const totals: Record<string, number> = {};
    for (const herb of ['silverleaf_herb', 'goldleaf_herb', 'sunpetal_herb']) {
      totals[herb] = ALL_RECIPES.reduce(
        (sum, r) =>
          sum + r.reagents.filter((g) => g.itemId === herb).reduce((t, g) => t + g.count, 0),
        0,
      );
    }
    // RE-MEASURED AT masterwrought Phase 11i, and the direction is the whole
    // point: every total ROSE or held, none fell. 11i adds three cooking rows
    // that consume herbs (goldleaf 2 on the rung-75 dish, sunpetal 2 on the
    // rung-100 dish and 1 on the capstone feast) and reduces nothing anywhere,
    // so goldleaf goes 27 to 29 and sunpetal 39 to 42 while silverleaf holds.
    // RE-MEASURED AGAIN AT masterwrought Phase 11k, which is the first phase to
    // RETIRE a herb-consuming row, so the direction had to be checked rather
    // than assumed: it cut 11i's capstone feast (sunpetal 1) and minted three
    // apex feasts carrying sunpetal 1 each, so the line goes 42 to 44. The rule
    // is the reason the seasonings are on the new bill at all: RULE 3 forbids
    // reducing any herb, fish, meat or salt count ANYWHERE, so a replacement
    // row must carry what the row it replaces carried.
    // RE-MEASURED AT Masterwrought phase 11l, the trophy economy: two of the
    // ten trophy consumer rows carry goldleaf (the Valefire Lantern's 2, the
    // Healing Potion's 1) and none carries silverleaf or sunpetal, so goldleaf
    // goes 29 to 32 while the other two hold. Pure additions again: nothing
    // was reduced anywhere.
    // The claim this arm makes has never been "the numbers do not move"; it is
    // "herbalism loses nothing", and a total that only ever climbs is what says
    // so.
    expect(totals).toEqual({
      silverleaf_herb: 28,
      goldleaf_herb: 32,
      sunpetal_herb: 44,
    });
  });

  it('and neither does fishing, skinning or the salt line: the other three totals', () => {
    // RULE 3 says no herb, FISH, MEAT or salt count is ever reduced ANYWHERE.
    // The herb arm above pinned one third of that globally and the touched-row
    // bills pinned the rest on nine rows, which left a reduction on an UNTOUCHED
    // row passing this file. These three totals close it on the same terms.
    const totalFor = (ids: ReadonlySet<string> | readonly string[]): number => {
      const set = ids instanceof Set ? ids : new Set(ids);
      return ALL_RECIPES.reduce(
        (sum, r) =>
          sum + r.reagents.filter((g) => set.has(g.itemId)).reduce((t, g) => t + g.count, 0),
        0,
      );
    };
    expect(totalFor(['game_meat']), 'the skinning meat line').toBe(28);
    expect(totalFor(['prime_cut']), 'the rare harvest specimen').toBe(12);
    // 39 since masterwrought Phase 11i: its three cooking rows take salt 2 each.
    // 43 since Phase 11k: minus the retired capstone's 2, plus 2 on each of the
    // three apex feasts that replace it.
    expect(totalFor(['cooking_salt']), 'the salt line').toBe(43);
    // 77 since 11i, which is the largest single move any line here has taken and
    // is the phase's whole point: fishing fed only its own rod ladder before it.
    // 95 since Phase 11k: the three apex feasts each carry the WHOLE high-band
    // ladder at the counts 11i's retired capstone carried (catfish 4, sturgeon
    // 3, salmon 2, nine fish a craft), so retiring that row cost the line 9 and
    // the three replacements paid 27.
    expect(totalFor(RAW_COOKING_CATCH_IDS), 'the whole fishing line').toBe(95);
    // PER CATCH, NOT ONLY THE SUM (qr-11G-FISH, Phase 11g QA). The other three
    // lines above are single ids, so their totals ARE per-id and a reduction
    // cannot hide inside them. The fishing line is seven ids under one number,
    // which is the same gameability the per-row bills were added to close one
    // level down: cutting the marsh pike and adding a river perch keeps 30.
    // Phase 11i owned fishing and edited this map when it added its catches,
    // which is the wanted behavior and the reason RAW_COOKING_CATCH_IDS keeps
    // its own membership arm rather than being folded in here.
    //
    // WHAT 11i MOVED, AND THE DIRECTION IS THE CLAIM: every one of the six
    // SHIPPED common catches holds its exact demand, glimmerfin_koi RISES from
    // 6 to 8 (the apex rod rung takes two more), and the three new ids arrive.
    // Not one number fell, which is R18's add-never-substitute stated as
    // arithmetic over the whole merged table rather than per row.
    //
    // THE SPLIT BETWEEN THE STURGEON AND THE SALMON IS THE DEADLOCK FIX, and it
    // is the one place in this map where the shape is a correctness answer
    // rather than a balance one. The apex rod's draft bill took sturgeon 6 plus
    // salmon 4, and that was a closed circuit: the salmon exists only in the
    // band-5 cells, band 5 takes the tier-6 rod, and the rod is that recipe's
    // own output, so nobody could ever have opened it. The whole bill moved
    // onto the band-4 sturgeon (6 to 10), which is why the sturgeon reads 17
    // and the salmon 2.
    //
    // SO THE SALMON'S ONLY CONSUMER IS NOW THE CAPSTONE FEAST, at 2, and that
    // is correct rather than thin: the band-5 catch is a REWARD for owning the
    // apex rod, never an input to it, and the deepest table on the ladder
    // should pay into the deepest plate on it. The WHOLE-LINE total is
    // unchanged at 77 across the change, which is the arithmetic reason a
    // sum-only pin could not have seen any of this and the per-catch map can.
    //
    // PHASE 11k MOVED THE THREE HIGH-BAND ROWS AND NOTHING ELSE, which is the
    // direction claim again: it retired 11i's capstone feast (catfish 4,
    // sturgeon 3, salmon 2) and minted three rows carrying the same three
    // counts each, so catfish goes 26 to 34, sturgeon 17 to 23, and salmon 2 to
    // 6. The salmon now has THREE consumers rather than one, which is what
    // makes the retirement safe: a cut that left it at zero would have reddened
    // the demand arm of tests/gathering_supply_coverage.test.ts for real, since
    // the band-5 catch has no fine grade to substitute through.
    const perCatch: Record<string, number> = {
      glimmerfin_koi: 8,
      raw_bog_eel: 4,
      raw_deepbarb_catfish: 34,
      raw_frostgill_trout: 4,
      raw_hollowgill_sturgeon: 23,
      raw_marsh_pike: 2,
      raw_mirror_trout: 1,
      raw_river_perch: 2,
      raw_stillmere_salmon: 6,
      raw_stonescale_carp: 11,
    };
    // The pre-11i demands, spelled out so "nothing fell" is a checked claim
    // rather than a reading of the map above. A later phase that trims a
    // shipped catch to make room for a new one reds HERE, which is precisely
    // the substitution the totals alone cannot see.
    const DEMAND_BEFORE_11I: Record<string, number> = {
      glimmerfin_koi: 6,
      raw_bog_eel: 4,
      raw_frostgill_trout: 4,
      raw_marsh_pike: 2,
      raw_mirror_trout: 1,
      raw_river_perch: 2,
      raw_stonescale_carp: 11,
    };
    for (const [id, before] of Object.entries(DEMAND_BEFORE_11I)) {
      expect(perCatch[id], `${id} may never fall below its pre-11i demand`).toBeGreaterThanOrEqual(
        before,
      );
    }
    for (const [id, count] of Object.entries(perCatch)) {
      expect(totalFor([id]), `${id} demand across the merged table`).toBe(count);
    }
    // The two halves check each other: the per-id map must account for the whole
    // pinned line and for every shipped catch, so neither can drift alone.
    expect(
      Object.values(perCatch).reduce((t, n) => t + n, 0),
      'the per-catch map must account for the whole fishing line',
    ).toBe(95);
    expect(Object.keys(perCatch).sort(), 'every shipped catch is accounted for').toEqual(
      [...RAW_COOKING_CATCH_IDS].sort(),
    );
  });

  it('and no touched row lost a herb, fish, meat or salt entry to make room', () => {
    // Totals alone can be gamed by moving a reagent between rows, so the exact
    // non-produce bill of every touched row is pinned too. This is the arm that
    // makes masterwrought R18's "ADD, never substitute" checkable per row.
    for (const row of TOUCHED_ROWS) {
      const recipe = requireRecipe(row.id);
      const actual = recipe.reagents
        .filter((g) => !PRODUCE_IDS.has(g.itemId))
        .map((g) => [g.itemId, g.count]);
      expect(actual, `${row.id} non-produce bill`).toEqual(row.untouched.map(([id, n]) => [id, n]));
    }
  });

  it('and the reagent ORDER on every touched row, which is what a player reads', () => {
    // The two halves above pin the produce entries and the non-produce entries
    // separately, so the INTERLEAVING between them is unpinned by both: moving
    // vale_wheat to the end of the skewer satisfies each of them. Reagent order
    // is the order the crafting window and the wiki render, and every bill here
    // was deliberately composed to read body, then vegetables, then salt.
    //
    // PINNED ON ALL NINE ROWS (qr-11G-ORDER, Phase 11g QA). This arm previously
    // asserted only the SORTED id set and the length here, then spelled the full
    // order out for two rows, so seven rows kept the interleaving free and the
    // skewer that the paragraph above names as the motivating example was one of
    // them. A mutation moving vale_wheat to the end of that bill passed this
    // whole file. The two spelled-out rows are gone rather than kept beside the
    // table: the per-row `order` field asserts strictly more than they did, and
    // a duplicated pin is one more thing to update in two places.
    for (const row of TOUCHED_ROWS) {
      const recipe = requireRecipe(row.id);
      expect(
        recipe.reagents.map((g) => g.itemId),
        `${row.id} reagent ORDER`,
      ).toEqual([...row.order]);
      // The order table and the two count tables must describe the same bill, so
      // a row whose `order` was updated without its counts (or the reverse)
      // cannot pass by having the halves disagree.
      const merged = new Map<string, number>();
      for (const [id, n] of [...row.untouched, ...row.produce]) merged.set(id, n);
      expect([...row.order].sort(), `${row.id} order table vs count tables`).toEqual(
        [...merged.keys()].sort(),
      );
      expect(row.order.length, `${row.id} reagent count`).toBe(merged.size);
    }
  });
});

describe('the touched rows stay gold-negative and stay off the gear chain', () => {
  it('every touched bill vendors strictly below its input value', () => {
    // SAFE BY CONSTRUCTION and re-run anyway: adding a reagent raises
    // inputValue and cannot touch outputValue, which is resultCount times the
    // output def's sellValue, and this phase changed no output def and no
    // resultCount. Every touched margin therefore widened monotonically.
    for (const row of TOUCHED_ROWS) {
      const recipe = requireRecipe(row.id);
      const input = recipe.reagents.reduce((t, g) => t + g.count * reagentUnitValue(g.itemId), 0);
      const outDef = ITEMS[recipe.resultItemId];
      expect(outDef, `${row.id} output def`).toBeDefined();
      const output = outDef.sellValue * recipe.resultCount;
      expect(output, `${row.id}: output ${output} vs input ${input}`).toBeLessThan(input);
    }
  });

  it('every touched row belongs to a CONSUMABLE profession', () => {
    // The scoped statement about this phase's own diff. The standing
    // masterwrought R17 fence (produce never reaches recipe_quickening_catalyst,
    // a gear intermediate, or a Perfecting material) lives in
    // tests/provisioner_firewall.test.ts, which this phase EXTENDED rather than
    // copied: that file's header requires one file for that invariant so the
    // carve-out shape cannot fork.
    for (const row of TOUCHED_ROWS) {
      const recipe = requireRecipe(row.id);
      expect(['cooking', 'alchemy'], `${row.id} profession`).toContain(recipe.professionId);
      expect(
        ITEMS[recipe.resultItemId]?.slot,
        `${row.id} must not output an equippable`,
      ).toBeUndefined();
    }
  });

  it('no rung moved: every touched row keeps the skillReq it shipped with', () => {
    // RETITLED at the Phase 11g QA (qr-11G-TITLE). It read "this phase minted no
    // recipe row and no rung moved" and asserted only the rungs, so half the
    // title was a claim this arm does not make. The row-count half IS covered,
    // and deliberately elsewhere under the one-file-for-one-invariant rule:
    // tests/ladder_crafting.test.ts pins LADDER_RECIPES at 54 with its per-craft
    // and per-rung shape, and tests/recipe_economy.test.ts pins the ten
    // INTERMEDIATE_RECIPES ids exactly. Duplicating either here would give the
    // shape two homes; naming them gives the reader the same certainty.
    const expected: Record<string, number> = {
      recipe_hunters_game_skewer: 0,
      recipe_goldleaf_game_stew: 25,
      recipe_frostgill_chowder: 25,
      recipe_silvered_carp_supper: 50,
      recipe_marlows_grand_roast: 50,
      recipe_elixir_of_the_boar: 0,
      recipe_venomfire_elixir: 25,
      recipe_elixir_of_the_serpent: 50,
      recipe_seasoned_stock: 75,
    };
    for (const row of TOUCHED_ROWS) {
      expect(requireRecipe(row.id).skillReq, `${row.id} rung`).toBe(expected[row.id]);
    }
  });
});

// ---------------------------------------------------------------------------
// THE CRAFT ITSELF, DRIVEN THROUGH THE REAL SIM (qr-11G-CRAFTABLE, Phase 11g QA)
// ---------------------------------------------------------------------------

/** The one rig both arms below share. Reaching into Sim internals is the
 *  established idiom for a craft harness in this tree (tests/professions_crafting.test.ts
 *  does the same); it is confined here so neither arm re-hand-rolls it. */
type CraftHarness = { sim: Sim; pid: number };

function craftRig(recipe: ProfessionRecipeRecord): CraftHarness {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
  const pid = sim.playerId;
  const meta = (sim as unknown as { players: Map<number, Record<string, unknown>> }).players.get(
    pid,
  );
  if (!meta) throw new Error('player meta missing');
  (meta.knownRecipes as Set<string>).add(recipe.id);
  // The rung the row unlocks at, so the 75 intermediate is reachable too.
  (meta.craftSkills as Record<string, number>)[recipe.professionId] = recipe.skillReq;
  if (recipe.stationType) {
    const station = stationsOfType(STATIONS, recipe.stationType)[0];
    const entity = (
      sim as unknown as { entities: Map<number, Record<string, unknown>> }
    ).entities.get(pid);
    if (!entity) throw new Error('player entity missing');
    entity.pos = { ...(station.pos as Record<string, number>) };
    entity.prevPos = { ...(entity.pos as Record<string, number>) };
  }
  return { sim, pid };
}

const runCraft = (rig: CraftHarness, recipe: ProfessionRecipeRecord) =>
  resolveCraft((rig.sim as unknown as { ctx: never }).ctx, rig.pid, recipe.id);

describe('every touched bill still CRAFTS, not just type-checks', () => {
  // WHY THIS EXISTS. Every arm above reads tables. A bill can satisfy all of
  // them and still refuse at the counter, because resolveCraft is what decides
  // whether a reagent list is actually consumable, and this phase changed nine
  // reagent lists. Two of the nine were already driven through the sim, and
  // only incidentally: recipe_elixir_of_the_serpent rides the #1149 multi-copy
  // signing regression and recipe_silvered_carp_supper rides the deeds
  // playthrough. BOTH of those went red and needed a hand-added grant when this
  // phase grew their bills, which is the evidence that the other seven, which
  // no test crafts at all, were the ones worth covering.
  //
  // THE GRANT IS DERIVED FROM THE LIVE REAGENT LIST, which is the whole point:
  // a hand-written grant list does not self-heal, which is exactly why those
  // two suites had to be edited. This one grows with the bill.
  it.each(TOUCHED_ROWS.map((row) => row.id))('%s crafts from its live bill', (recipeId) => {
    const recipe = requireRecipe(recipeId);
    const rig = craftRig(recipe);
    for (const reagent of recipe.reagents) {
      for (let i = 0; i < reagent.count; i++) rig.sim.addItem(reagent.itemId, 1, rig.pid);
    }

    const result = runCraft(rig, recipe);

    expect(result.ok, `${recipe.id} must craft from its own reagent list`).toBe(true);
    expect(rig.sim.countItem(recipe.resultItemId, rig.pid), `${recipe.id} output`).toBe(
      recipe.resultCount,
    );
    // EVERY reagent is drawn on, which is the half that says the produce really
    // entered the bill rather than sitting in it decoratively: a reagent the
    // craft ignored would be left in the bag untouched.
    //
    // THE EXPECTED LEFTOVER IS NOT ZERO, and finding that out is why this arm
    // is worth having. recipe_seasoned_stock sits at skillReq 75, so a crafter
    // AT that rung earns the #1134 specialization discount and the craft
    // consumes 2 of the 3 game_meat rather than all three. The expectation is
    // therefore DERIVED through requiredReagentCountFor, the same rule the
    // production path applies, instead of assuming a full draw. Cross-source
    // rather than self-comparing: the required count comes from the pricing
    // rule and the leftover from what resolveCraft actually spent.
    const craftSkills = { [recipe.professionId]: recipe.skillReq };
    // AND THE MULTIPLIER ITSELF, pinned at BOTH SIDES OF THE THRESHOLD (Phase
    // 11h QA fix-round review). Everything below runs requiredReagentCountFor on
    // both sides, so a retune of the shipped discount moves the expectation and
    // the observation together and this arm stays green through it. Pinned at
    // two skill levels rather than one because this file sweeps the LEVELING
    // rungs as well as the 75 one: below the specialization threshold there is
    // no discount at all, and a single 0.8 pin here reds on every rung-0 row.
    // The pair pins the constant AND the threshold's position.
    const craft = recipe.professionId;
    expect(
      materialCostMultiplier({ [craft]: 100 }, craft),
      'the shipped specialization discount is 20 percent at or above the threshold',
    ).toBe(0.8);
    expect(
      materialCostMultiplier({ [craft]: 50 }, craft),
      'and there is no discount below it',
    ).toBe(1);
    for (const reagent of recipe.reagents) {
      const required = requiredReagentCountFor(
        false,
        reagent,
        craftSkills,
        recipe.professionId,
      ).count;
      // NO `required > 0` FLOOR HERE (Phase 11h QA). One used to sit on this
      // line and it could never fail: requiredReagentCountFor returns
      // `count: Math.max(1, ...)` by construction, so the floor restated the
      // implementation instead of testing it. The identical floor was retired
      // from tests/provisioning_supply_line_apex.test.ts at this phase's own
      // review round and this copy, in the sibling file the same phase edited,
      // was missed. The assertion below is the one with teeth: it compares what
      // the pricing rule REQUIRED against what resolveCraft actually SPENT.
      expect(
        rig.sim.countItem(reagent.itemId, rig.pid),
        `${recipe.id} must consume ${required} of its ${reagent.itemId}`,
      ).toBe(reagent.count - required);
    }
  });

  it.each(TOUCHED_ROWS.map((row) => row.id))(
    '%s REFUSES when only its produce is missing',
    (recipeId) => {
      // The non-vacuity half, and it is not decoration: every arm in this file
      // would pass if resolveCraft ignored reagents entirely, and so would the
      // nine cases above. Granting everything EXCEPT the produce must refuse.
      const recipe = requireRecipe(recipeId);
      const rig = craftRig(recipe);
      for (const reagent of recipe.reagents) {
        if (PRODUCE_IDS.has(reagent.itemId)) continue;
        for (let i = 0; i < reagent.count; i++) rig.sim.addItem(reagent.itemId, 1, rig.pid);
      }

      expect(runCraft(rig, recipe).ok, `${recipe.id} must REFUSE without its produce`).toBe(false);
    },
  );
});
