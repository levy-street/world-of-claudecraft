// THE PROVISIONER FIREWALL (masterwrought R17, created by Phase 11f under the
// packet ruling qr-R17-SWEEP): farm produce feeds the CONSUMABLE professions
// at every rung and NEVER the gear chain, the Perfecting materials, or
// recipe_quickening_catalyst.
//
// THE RULING ID IS VERBATIM and must never take the masterwrought prefix a
// blanket R-sweep would give it: four packet docs cite this file by the exact
// string qr-R17-SWEEP, including the two that tell Phase 11h to EXTEND it, and
// a prefixed copy is a grep that finds the docs and not the file.
//
// ONE FILE FOR ONE INVARIANT, deliberately, and this is the reason it exists as
// its own suite rather than as arms bolted onto a phase's test: masterwrought R17 is a
// standing rule several later phases extend, and a sibling file per phase would
// let the carve-out shape fork. A phase that widens the firewall EXTENDS this
// file.
//
// WHY masterwrought R17 EXISTS AT ALL, so the sweep below reads as a fence and not as
// bookkeeping. Routing produce into gear would push against the packet's power
// envelope and, worse, would put a wall-clock-gated input in front of
// recipe_quickening_catalyst, the one gate that paces the entire packet: a
// crafter would then wait on a crop timer to advance the gear chain. That is
// the compulsion failure the packet designs against, so the exclusion is
// asserted as a SWEEP over the merged table rather than left to review.
//
// THE ONE CARVE-OUT, scoped by TEXT and recorded as a clarification beside masterwrought R17
// rather than a change to it: the gathering-tool HOE ladder may consume a fine
// farm twin. A hoe has no equip slot, contests no item-level budget and has no
// masterwrought R5 interaction, so it is not gear in masterwrought R17's sense, and the shipped
// recipe_osmium_hoe already consumes fine_highland_barley under farming's
// deviation (ad). The carve-out is a predicate here, not an id list, so it
// cannot quietly widen.
import { describe, expect, it } from 'vitest';
import { FARM_CROPS } from '../src/sim/content/farm_crops';
import {
  ALL_RECIPES,
  APEX_ARMOR_RECIPES,
  APEX_GEAR_RECIPES,
  INTERMEDIATE_RECIPES,
} from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';

/** Every item farming produces: seeds, base produce, and the fine twins. The
 *  whole family, derived from the crop catalog, so a new crop is inside the
 *  firewall the moment it ships rather than when someone remembers. */
const FARM_ITEM_IDS = new Set(
  Object.values(FARM_CROPS).flatMap((crop) => [
    crop.seedItemId,
    crop.produceItemId,
    crop.fineProduceItemId,
  ]),
);

/** The Perfecting and chase materials masterwrought R17 names. Spelled as literals because
 *  they are the RULE's own subject: deriving them from a table would let the
 *  fence move whenever that table did, which is the opposite of what a standing
 *  ruling wants. */
const PERFECTING_MATERIAL_IDS = ['wyrmfall_core', 'sundered_essence', 'makers_ember'];

/** The gear-intermediate families masterwrought R17 names by word. Matched on the OUTPUT id
 *  so a new billet or plating joins by being named like one. */
const GEAR_INTERMEDIATE_WORDS = ['billet', 'plating', 'cording', 'bolt', 'setting', 'chassis'];

const CATALYST_ID = 'recipe_quickening_catalyst';

/** The carve-out, as a predicate: a gathering TOOL output, which today is the
 *  hoe ladder. Never an id list. */
const isGatheringToolRecipe = (resultItemId: string): boolean => resultItemId.endsWith('_hoe');

/** THE SECOND CARVE-OUT, added by Phase 11g and scoped exactly like the first:
 *  a CONSUMABLE-profession intermediate is not a gear intermediate.
 *
 *  WHY IT IS NEEDED RATHER THAN A HOLE IN masterwrought R17. R17 fences produce
 *  out of the GEAR chain, and INTERMEDIATE_RECIPES is a MIXED table: nine of
 *  its ten rows feed gear (billet, plating, cording, bolt, setting, chassis,
 *  lucent reagent, sablewax vellum, and the pacing gate), and one is
 *  recipe_seasoned_stock, a cooking intermediate whose output is a food reagent
 *  that every apex DISH flows through. Sweeping the whole table treated that
 *  cooking row as gear, so the sweep was broader than the rule it enforces.
 *  Phase 11g's masterwrought DECISION C puts marsh_rice and bog_beet in that
 *  bill, which is R17-COMPLIANT by R17's own text: produce feeds the consumable
 *  professions.
 *
 *  THE PACING GATE IS DELIBERATELY EXCLUDED FROM THE CARVE-OUT, and this is the
 *  load-bearing half. recipe_quickening_catalyst carries professionId 'alchemy',
 *  so a bare consumable predicate would exempt the one row masterwrought R17
 *  most exists to protect: the gate that paces the whole packet. It keeps its
 *  own dedicated arm above, and it stays inside this sweep too, so the
 *  protection is not resting on a single assertion. */
const isConsumableIntermediate = (recipe: { id: string; professionId: string }): boolean =>
  (recipe.professionId === 'cooking' || recipe.professionId === 'alchemy') &&
  recipe.id !== CATALYST_ID;

/** The gear chain masterwrought R17 fences, as ONE expression both the sweep and
 *  the carve-out scoping arm read. Hoisted rather than repeated: while the two
 *  disagreed, the sweep applied the consumable carve-out across all four
 *  sources and the scoping arm only measured it over INTERMEDIATE_RECIPES, so a
 *  cooking or alchemy row arriving in APEX_GEAR_RECIPES or matching a gear word
 *  would have been silently exempted with the scoping arm still green. */
function gearChainRecipes() {
  return [
    ...INTERMEDIATE_RECIPES,
    ...APEX_ARMOR_RECIPES,
    ...APEX_GEAR_RECIPES,
    ...ALL_RECIPES.filter((r) =>
      GEAR_INTERMEDIATE_WORDS.some((word) => r.resultItemId.includes(word)),
    ),
  ];
}

describe('masterwrought R17: the provisioner firewall', () => {
  it('sweeps a non-empty farm family and a non-empty recipe table', () => {
    // The vacuity floor for every arm below. Both sides are derived, so a
    // catalog rename that emptied either would otherwise make the whole file
    // pass over nothing.
    expect(FARM_ITEM_IDS.size, 'the farm item family').toBeGreaterThanOrEqual(36);
    expect(ALL_RECIPES.length, 'the merged recipe table').toBeGreaterThan(100);
    for (const id of FARM_ITEM_IDS) {
      expect(ITEMS[id], `${id} must be a real ItemDef`).toBeDefined();
    }
    for (const id of PERFECTING_MATERIAL_IDS) {
      expect(ITEMS[id], `${id} must be a real ItemDef`).toBeDefined();
    }
  });

  it('keeps every farm item out of recipe_quickening_catalyst, the packet pacing gate', () => {
    const catalyst = ALL_RECIPES.find((r) => r.id === CATALYST_ID);
    expect(catalyst, 'the pacing gate must exist for this arm to mean anything').toBeDefined();
    for (const reagent of catalyst?.reagents ?? []) {
      expect(
        FARM_ITEM_IDS.has(reagent.itemId),
        `${reagent.itemId} is farm output and must never pace the gear chain`,
      ).toBe(false);
    }
    // Non-vacuity: the gate really consumes something, so an emptied bill
    // cannot pass this by having nothing to check.
    expect(catalyst?.reagents.length ?? 0).toBeGreaterThan(0);
  });

  it('keeps every farm item out of the Perfecting and chase materials', () => {
    // Both directions. A farm item may not be a reagent of a recipe that
    // OUTPUTS one of these, and none of these may itself be a farm item.
    const perfecting = new Set(PERFECTING_MATERIAL_IDS);
    for (const id of PERFECTING_MATERIAL_IDS) {
      expect(FARM_ITEM_IDS.has(id), `${id} must not be farm output`).toBe(false);
    }
    // THE SECOND LOOP WALKS ZERO RECIPES TODAY, measured at the 11f QA and
    // stated so nobody reads it as a live check: no shipped recipe OUTPUTS a
    // Perfecting material (they are drops, which is the whole point of a chase
    // material). It is a FORWARD guard, kept because the day one becomes
    // craftable is exactly the day this must already be watching. Deliberately
    // given no non-vacuity floor, unlike the arms above: a floor here would red
    // today and the honest fix would be to delete the loop, which would leave
    // the rule unguarded at the moment it starts mattering.
    const perfectingRecipes = ALL_RECIPES.filter((r) => perfecting.has(r.resultItemId));
    expect(
      perfectingRecipes.length,
      'if this is no longer zero, give this loop a real non-vacuity floor',
    ).toBe(0);
    for (const recipe of perfectingRecipes) {
      for (const reagent of recipe.reagents) {
        expect(
          FARM_ITEM_IDS.has(reagent.itemId),
          `${recipe.id} makes a Perfecting material out of farm output (${reagent.itemId})`,
        ).toBe(false);
      }
    }
  });

  it('keeps every farm item out of the gear intermediates and the apex gear bills', () => {
    // The three gear-chain tables masterwrought R17 names, swept together. The hoe carve-out
    // is applied here rather than by excluding a recipe id, so it stays scoped
    // to what a gathering tool actually is.
    const gearRecipes = gearChainRecipes();
    expect(gearRecipes.length, 'the gear-chain sweep must be non-empty').toBeGreaterThan(20);
    for (const recipe of gearRecipes) {
      if (isGatheringToolRecipe(recipe.resultItemId)) continue;
      if (isConsumableIntermediate(recipe)) continue;
      for (const reagent of recipe.reagents) {
        expect(
          FARM_ITEM_IDS.has(reagent.itemId),
          `${recipe.id} puts farm output (${reagent.itemId}) into the gear chain`,
        ).toBe(false);
      }
    }
    // THE PACING GATE IS STILL SWEPT HERE, stated as its own assertion rather
    // than left to be inferred from the predicate: recipe_quickening_catalyst
    // is professionId 'alchemy', so if the carve-out above ever loses its
    // CATALYST_ID clause this arm stops covering it and only the dedicated
    // catalyst arm remains. Proving the gate survives BOTH carve-outs is what
    // keeps the second one from quietly becoming the hole it is not.
    const sweptIds = gearRecipes
      .filter((r) => !isGatheringToolRecipe(r.resultItemId) && !isConsumableIntermediate(r))
      .map((r) => r.id);
    expect(sweptIds, 'the pacing gate must stay inside the gear sweep').toContain(CATALYST_ID);
  });

  it('the consumable-intermediate carve-out is REAL and stays scoped to slotless food reagents', () => {
    // The same three-part proof the hoe carve-out carries, because a carve-out
    // nobody tests is prose. (1) It is load-bearing: a recipe really does ride
    // it today. (2) It never reaches an equippable, which is the whole reason
    // masterwrought R17 does not count a food reagent as gear. (3) It never
    // covers the pacing gate.
    // Measured over the SAME list the sweep exempts from, not just over
    // INTERMEDIATE_RECIPES: the carve-out is applied to every gear-chain source,
    // so scoping it over one of the four would leave the other three unwatched.
    const carved = gearChainRecipes().filter((r) => isConsumableIntermediate(r));
    expect(
      carved.map((r) => r.id),
      'the consumable intermediates',
    ).toEqual(['recipe_seasoned_stock']);
    const riding = carved.filter((r) => r.reagents.some((g) => FARM_ITEM_IDS.has(g.itemId)));
    expect(
      riding.map((r) => r.id),
      'the carve-out must be load-bearing, not a standing exemption over nothing',
    ).toEqual(['recipe_seasoned_stock']);
    for (const recipe of carved) {
      expect(
        ITEMS[recipe.resultItemId]?.slot,
        `${recipe.resultItemId} must have no equip slot`,
      ).toBeUndefined();
    }
    expect(
      carved.map((r) => r.id),
      'the pacing gate must never ride the consumable carve-out',
    ).not.toContain(CATALYST_ID);
    // And the gate really is consumable-professioned, which is the fact that
    // makes the exclusion above necessary rather than decorative. If this ever
    // flips, the CATALYST_ID clause can be retired instead of left standing.
    expect(
      ALL_RECIPES.find((r) => r.id === CATALYST_ID)?.professionId,
      'the pacing gate is alchemy, which is why the carve-out excludes it by id',
    ).toBe('alchemy');
  });

  it('the hoe carve-out is REAL and stays scoped to gathering tools', () => {
    // Without this the exclusion above would be untestable prose: the arm has
    // to prove the carve-out is actually load-bearing (a hoe really does
    // consume a fine twin today) and that it covers nothing else. If the hoe
    // ladder ever stopped consuming farm output, this reds and the carve-out
    // can be retired rather than left standing over nothing.
    const hoeRecipes = ALL_RECIPES.filter((r) => isGatheringToolRecipe(r.resultItemId));
    expect(hoeRecipes.length, 'the hoe ladder').toBeGreaterThan(0);
    const carvedOut = hoeRecipes.filter((r) => r.reagents.some((g) => FARM_ITEM_IDS.has(g.itemId)));
    // EVERY hoe, not merely one. A "at least one" floor survives the mutation
    // that matters: take a single rung of the ladder off farm output and the
    // carve-out is silently exempting a recipe that no longer needs exempting,
    // while two siblings keep the arm green. Measured at the 11f QA: the whole
    // shipped ladder consumes a fine twin today, so the exact equality is the
    // honest claim and it is what kills that partial mutation.
    expect(carvedOut.length, 'every hoe in the ladder consumes farm output').toBe(
      hoeRecipes.length,
    );
    // And the carve-out never reaches an equippable: a gathering tool has no
    // slot, which is the whole reason masterwrought R17 does not count it as gear.
    for (const recipe of hoeRecipes) {
      expect(
        ITEMS[recipe.resultItemId]?.slot,
        `${recipe.resultItemId} must have no equip slot`,
      ).toBeUndefined();
    }
  });

  it('produce DOES feed the consumable professions, which is the positive half of masterwrought R17', () => {
    // The rule is not only an exclusion. A firewall with nothing behind it
    // would be satisfied by farming having no consumer at all, which is the
    // exact hole masterwrought R17 was written to fill (the shipped cooking tree used 17
    // reagents and not one was a grain or a vegetable). So the sweep asserts
    // the consumable side is real, and at more than one rung.
    const consumerRecipes = ALL_RECIPES.filter(
      (r) =>
        (r.professionId === 'cooking' || r.professionId === 'alchemy') &&
        r.reagents.some((g) => FARM_ITEM_IDS.has(g.itemId)),
    );
    expect(consumerRecipes.length, 'produce must have consumable buyers').toBeGreaterThan(5);
    const rungs = new Set(consumerRecipes.map((r) => r.skillReq));
    expect(rungs.size, 'produce feeds cooking at more than one rung').toBeGreaterThan(1);
    // The Phase 11f half of the same claim: the climb put produce consumers on
    // the UPPER rungs, which is what masterwrought R17's "at every rung" was missing before.
    expect(
      [...rungs].filter((rung) => rung >= 75).length,
      'produce must feed a rung at or above 75 after the Phase 11f climb',
    ).toBeGreaterThan(0);
  });
});
