// Can a realm actually BOOTSTRAP its own crafting economy from nothing?
//
// This file exists because masterwrought Phase 11i shipped a recipe whose bill
// nobody could ever fill, and every suite in the repo was green on it. The apex
// fishing rod's draft bill named the Stillmere Salmon; the salmon exists only in
// the band-5 catch cells; band 5 takes a tier-6 rod; and the only tier-6 rod in
// the game is that recipe's own output. No player on a fresh realm could open
// the circuit, so the rod, the whole band-5 table, the capstone feast and the
// deed hanging off the rod would all have been permanently unreachable. A
// reviewer caught it by reading; nothing mechanical could.
//
// The reason nothing caught it is worth stating, because it decides the shape of
// the test. Every existing recipe guard is LOCAL: it checks that reagents are
// real items, that the bill costs less than the output, that the pattern is
// learnable, that the tiers line up. All of those are true of a closed circuit.
// The missing property is GLOBAL and it is a reachability question: starting
// from an empty realm, does a fixpoint of "what can be made" ever include this
// recipe's reagents?
//
// WHAT THIS MODELS, AND WHAT IT DELIBERATELY DOES NOT. Modelling every faucet in
// the game (drops, vendors, quests, chests, world bosses, the rift forge, mail)
// would be a second content catalog and would rot. It is also unnecessary: those
// faucets are all UNGATED by crafting, so treating them as freely available can
// only make the model MORE generous, never less, and a circuit that closes under
// a generous model is a real circuit. What the model does track exactly is the
// one place a gathered item's availability depends on a CRAFTED item, which is
// the tool ladder:
//
//   - a fishing catch that first appears in band B needs a rod whose tier
//     satisfies the shipped band gate (canGatherTier(tier, B + 1));
//   - a node material of tier T needs a tool of its profession at tier T;
//   - a FINE grade needs a tool STRICTLY ABOVE its base material's tier, which
//     is the gate the land family actually closes a circuit on (see below);
//   - a tool is either bought/dropped (free) or crafted, and a crafted tool
//     needs its own bill filled first.
//
// So the seed is "everything except crafted outputs and tool-gated gather
// products", the step is "a recipe whose reagents are all obtainable makes its
// output obtainable, and a newly obtainable tool unlocks the gather products its
// tier covers", and the fixpoint answers the question. A recipe left unreachable
// at the fixpoint is either a real deadlock or a faucet the model does not know
// about, and the failure message says which reagent so the reader can tell.
import { describe, expect, it } from 'vitest';
import { FARM_CROPS } from '../src/sim/content/farm_crops';
import { FISHING_TABLES_BY_BAND, RAW_COOKING_CATCH_IDS } from '../src/sim/content/items';
import { GATHERING_PROFESSIONS } from '../src/sim/content/professions';
import { ALL_RECIPES, HOE_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { farmingTeachingCeilingFor } from '../src/sim/professions/farming';
import { NODE_MATERIAL_TABLE, NODE_TYPE_BY_PROFESSION } from '../src/sim/professions/gathering';
import { baseMaterialFor, gatherMaterialTier } from '../src/sim/professions/material_grades';
import { canGatherTier } from '../src/sim/professions/tools';
import {
  canWieldGatherToolTier,
  WIELD_REQUIREMENT_BY_TIER,
  wieldRequirementForTier,
} from '../src/sim/professions/wield_gate';

/** Every item a recipe produces. Nothing here is free at the start of a realm. */
const CRAFTED_OUTPUTS = new Set(ALL_RECIPES.map((r) => r.resultItemId));

/** professionId -> tier, for every item that IS a gathering tool.
 *
 *  Built lazily rather than at module scope: ITEMS is assembled by
 *  src/sim/data.ts out of the content modules, so a module-scope read here
 *  races the barrel's own import order and comes back undefined.
 */
let toolsMemo: Map<string, { professionId: string; tier: number }> | null = null;
function tools(): Map<string, { professionId: string; tier: number }> {
  if (toolsMemo) return toolsMemo;
  toolsMemo = new Map();
  for (const [id, def] of Object.entries(ITEMS)) {
    const use = def.use;
    if (use && use.type === 'gatherTool') {
      toolsMemo.set(id, { professionId: use.professionId, tier: use.tier });
    }
  }
  return toolsMemo;
}

/**
 * The tool gate on a gathered item: which profession's tool, and what NODE TIER
 * that tool has to cover. Null for anything not gathered through a tool.
 *
 * Fishing is expressed in the same currency as the node professions on purpose.
 * A catch that first appears in band B is gated exactly like a node of tier
 * B + 1, which is the shipped band gate (see fishingRodBandFor), so one
 * canGatherTier comparison serves both families and neither can drift from the
 * engine's own rule.
 */
function toolGateFor(itemId: string): { professionId: string; nodeTier: number } | null {
  for (let band = 0; band < FISHING_TABLES_BY_BAND.length; band++) {
    for (const rows of Object.values(FISHING_TABLES_BY_BAND[band])) {
      if (rows.some((r) => r.itemId === itemId)) {
        // First band it appears in wins; band 0 is free water.
        return band === 0 ? null : { professionId: 'fishing', nodeTier: band + 1 };
      }
    }
  }
  // THE FINE GRADES FIRST, because they are where the LAND family can close a
  // circuit and they are invisible to the node table. Every crafted land tool
  // consumes one (the thorium pick takes fine_iron_ore, the arcanite pick
  // fine_thorium_ore, the two axes and the two sickles their own), and a fine
  // grade is deliberately NOT a node row: material_grades.ts says so in its own
  // header, "a fine grade is not a tenth node yield, it is a second grade of an
  // existing one". So the base-material loop below cannot see them, and before
  // this branch existed the fixpoint seeded all six FREE, which meant the model
  // treated the entire crafted land-tool ladder as unconditionally reachable at
  // exactly the point that ladder could deadlock.
  //
  // The gate is `gatherTier + 1` rather than `gatherTier` because yieldsFineGrade
  // requires the tool STRICTLY ABOVE the material, and canGatherTier is
  // toolTierCovers, a `>=` comparison. Adding one expresses "strictly above"
  // through the shipped comparator instead of re-implementing the rule here.
  const base = baseMaterialFor(itemId);
  if (base !== undefined) {
    for (const [professionId, nodeType] of Object.entries(NODE_TYPE_BY_PROFESSION)) {
      if (!nodeType) continue;
      for (const entry of Object.values(NODE_MATERIAL_TABLE[nodeType])) {
        if (entry.itemId === base) {
          return { professionId, nodeTier: Math.max(1, gatherMaterialTier(base) ?? 1) + 1 };
        }
      }
    }
  }
  // THE FARMING LADDER, the fourth gathering family and the last one this model
  // did not track (added by the Phase 11i QA). It matters for the same reason
  // the fine grades did: every hoe above the vendor rung is CRAFTED and its bill
  // consumes a crop, so the family has exactly the shape that can close a
  // circuit, and before this branch every crop and every fine crop twin was
  // seeded FREE.
  //
  // THE GATE IS THE PATCH TIER, and it is the one place farming differs from the
  // land trades in a way worth stating. Planting is what needs the tool: the
  // plant path drops any hoe below the bed's own tier, so a tier-N crop needs a
  // tier-N hoe. The FINE twin is NOT separately tool-gated the way a fine ORE is:
  // farming's fine grade is a skill-scaled roll per pick
  // (FARM_FINE_CHANCE_BASE plus the skill scale in professions/farming.ts), not
  // a yieldsFineGrade tool comparison, so the twin costs exactly what its base
  // crop costs and takes the SAME tier rather than tier + 1. Gating it a tier
  // high here would invent a requirement the engine does not have and could red
  // on content that really is reachable.
  //
  // The live ladder is legitimately OPEN and this branch proves it rather than
  // assuming it: garden_hoe is vendor stock at tier 1, the bronze hoe takes the
  // tier-1 fine wheat, the skysilver takes the tier-2 fine rice, and the osmium
  // takes a tier-3 twin, so each rung consumes the tier BELOW it exactly as the
  // rod ladder does.
  for (const crop of Object.values(FARM_CROPS)) {
    if (crop.produceItemId === itemId || crop.fineProduceItemId === itemId) {
      return { professionId: 'farming', nodeTier: crop.tier };
    }
  }
  for (const [professionId, nodeType] of Object.entries(NODE_TYPE_BY_PROFESSION)) {
    if (!nodeType) continue;
    for (const entry of Object.values(NODE_MATERIAL_TABLE[nodeType])) {
      if (entry.itemId === itemId) {
        // gatherMaterialTier, NOT material_tier.ts's materialTierForItem. The
        // two are different ladders and src/sim/professions/CLAUDE.md flags the
        // confusion by name: material_tier is the masterwork PRICE band, which
        // puts the Eastbrook yields at 0 and reads Mirefen's iron ore as 1 where
        // its node really is tier 2. Gating on it ran the land half of this
        // model a full tier loose, which is generous (no false red) but makes
        // the file's central claim, "what the model tracks exactly is the tool
        // ladder", true of fishing and only approximate of the land trades: a
        // crafted-tool circuit on mining, logging or herbalism would have
        // slipped the guard written for exactly that shape.
        return { professionId, nodeTier: Math.max(1, gatherMaterialTier(itemId) ?? 1) };
      }
    }
  }
  return null;
}

/** The best tool tier per profession the given owned set provides. */
function bestToolTiers(owned: ReadonlySet<string>): Map<string, number> {
  const best = new Map<string, number>();
  for (const [id, tool] of tools()) {
    if (!owned.has(id)) continue;
    best.set(tool.professionId, Math.max(best.get(tool.professionId) ?? 0, tool.tier));
  }
  return best;
}

/**
 * The fixpoint: everything a realm can eventually hold, starting from nothing
 * crafted and no tool-gated gather product, and closing under crafting.
 */
function reachableItems(
  billOverrides?: ReadonlyMap<string, readonly { itemId: string; count: number }[]>,
): { owned: Set<string>; seedSize: number; gatedSize: number } {
  const owned = new Set<string>();
  const gated = new Map<string, { professionId: string; nodeTier: number }>();
  for (const id of Object.keys(ITEMS)) {
    if (CRAFTED_OUTPUTS.has(id)) continue;
    const gate = toolGateFor(id);
    if (gate) gated.set(id, gate);
    else owned.add(id);
  }
  const seedSize = owned.size;
  const billFor = (recipe: (typeof ALL_RECIPES)[number]) =>
    billOverrides?.get(recipe.id) ?? recipe.reagents;
  // Bare hands and the starter rod: whatever tier a profession answers with no
  // tool at all is already covered by canGatherTier's own floor, so the loop
  // below re-asks it every round rather than hard-coding a starting tier.
  for (let round = 0; round < ALL_RECIPES.length + tools().size + 2; round++) {
    let grew = false;
    const tiers = bestToolTiers(owned);
    for (const [id, gate] of gated) {
      if (owned.has(id)) continue;
      if (canGatherTier(tiers.get(gate.professionId) ?? 0, gate.nodeTier)) {
        owned.add(id);
        grew = true;
      }
    }
    for (const recipe of ALL_RECIPES) {
      if (owned.has(recipe.resultItemId)) continue;
      if (billFor(recipe).every((g) => owned.has(g.itemId))) {
        owned.add(recipe.resultItemId);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return { owned, seedSize, gatedSize: gated.size };
}

describe('the crafting economy bootstraps from an empty realm', () => {
  it('the recipe graph is ACYCLIC: no output is, transitively, its own reagent', () => {
    // The cheap half, and the general one: it needs no faucet model at all,
    // because a cycle among crafted outputs is unreachable whatever else is
    // free. A recipe legitimately consuming the rung below it (the rod ladder
    // does exactly this) is a DAG edge, not a cycle.
    const producedBy = new Map<string, string[]>();
    for (const recipe of ALL_RECIPES) {
      const reagents = recipe.reagents.map((g) => g.itemId).filter((id) => CRAFTED_OUTPUTS.has(id));
      producedBy.set(recipe.resultItemId, [
        ...(producedBy.get(recipe.resultItemId) ?? []),
        ...reagents,
      ]);
    }
    const state = new Map<string, 'open' | 'done'>();
    const walk = (id: string, trail: string[]): void => {
      if (state.get(id) === 'done') return;
      expect(state.get(id), `crafting cycle: ${[...trail, id].join(' -> ')}`).not.toBe('open');
      state.set(id, 'open');
      for (const next of producedBy.get(id) ?? []) walk(next, [...trail, id]);
      state.set(id, 'done');
    };
    for (const id of producedBy.keys()) walk(id, []);
    // Non-vacuity: the graph really has crafted-to-crafted edges to walk, so a
    // producedBy that came out empty would not pass this by having nothing to
    // check. The rod ladder alone supplies three.
    const edges = [...producedBy.values()].reduce((n, list) => n + list.length, 0);
    expect(edges).toBeGreaterThan(20);
  });

  it('every recipe in the game is REACHABLE: no bill needs what its own output gates', () => {
    // The half that would have caught Phase 11i's deadlock. Under the fixpoint
    // the salmon never becomes obtainable (its only gate is the tier-6 rod), so
    // the rod's bill never fills, so the rod never becomes obtainable, and the
    // recipe reports here naming the reagent that stranded it.
    const { owned, seedSize, gatedSize } = reachableItems();
    const unreachable = ALL_RECIPES.filter(
      (r) => !r.reagents.every((g) => owned.has(g.itemId)),
    ).map((r) => {
      const missing = r.reagents.filter((g) => !owned.has(g.itemId)).map((g) => g.itemId);
      return `${r.id} cannot be crafted: ${missing.join(', ')} unobtainable`;
    });
    expect(unreachable).toEqual([]);
    // NON-VACUITY, and the first version of this got it wrong in a way worth
    // recording: it asserted `owned.size < Object.keys(ITEMS).length + 1`,
    // which cannot fail. Everything in `owned` comes from an ITEMS key, so the
    // inequality holds unconditionally, and the case it claimed to catch (a
    // fixpoint that seeded every id) is exactly the case it admits.
    //
    // The decisive form asks whether the fixpoint DID WORK: it must have started
    // from a proper subset (something was withheld) and it must have GROWN
    // (crafting and the tool ladder actually opened those gates).
    expect(ALL_RECIPES.length).toBeGreaterThan(100);
    expect(gatedSize, 'the model must withhold the tool-gated products').toBeGreaterThan(0);
    expect(seedSize, 'and the seed must be a proper subset of the answer').toBeLessThan(owned.size);
    // AND THE SEED AND THE GATED SET PARTITION THE NON-CRAFTED ITEMS, which is
    // the claim the two lines above only look like they make. Driven: under a
    // seed loop that withholds NOTHING (add every id unconditionally, the exact
    // scenario the comment names) both guards above still pass, because `gated`
    // is populated whether or not its ids were also seeded and crafted outputs
    // grow `owned` regardless. The sum is what actually catches it: a seed that
    // absorbs the gated ids overshoots the total.
    const nonCrafted = Object.keys(ITEMS).filter((id) => !CRAFTED_OUTPUTS.has(id)).length;
    expect(
      seedSize + gatedSize,
      'the seed and the gated set must PARTITION the non-crafted items',
    ).toBe(nonCrafted);
    expect(owned.has('clockreel_fishing_rod')).toBe(true);
  });

  it('the model is not vacuous: it really does gate the high catches behind rods', () => {
    // Guards the guard. Everything above passes trivially if toolGateFor never
    // finds a gate, or if the fixpoint seeds the whole item table, so pin the
    // gates the arms above depend on.
    expect(toolGateFor('raw_stillmere_salmon')).toEqual({ professionId: 'fishing', nodeTier: 6 });
    expect(toolGateFor('raw_hollowgill_sturgeon')).toEqual({
      professionId: 'fishing',
      nodeTier: 5,
    });
    expect(toolGateFor('raw_deepbarb_catfish')).toEqual({ professionId: 'fishing', nodeTier: 4 });
    // A band-0 catch is free water, not a gate.
    expect(toolGateFor('raw_mirror_trout')).toBeNull();
    // THE LAND HALF IS GATED TOO, and this is the arm that says so. Without the
    // fine-grade branch every crafted land tool was reachable from an empty
    // realm for free, so "the model tracks the tool ladder" was true of fishing
    // and empty of mining, logging and herbalism. A fine grade asks one tier
    // ABOVE its base, which is yieldsFineGrade's strictly-above rule read
    // through canGatherTier's >= comparator.
    expect(toolGateFor('fine_iron_ore')).toEqual({ professionId: 'mining', nodeTier: 3 });
    expect(toolGateFor('fine_thorium_ore')).toEqual({ professionId: 'mining', nodeTier: 4 });
    // The base material it upgrades from is gated one tier LOWER, so the pair
    // really does express a step rather than two copies of one number.
    expect(toolGateFor('iron_ore')).toEqual({ professionId: 'mining', nodeTier: 2 });
    expect(toolGateFor('thorium_ore')).toEqual({ professionId: 'mining', nodeTier: 3 });
    // The other two professions carry the same shape, so the branch is not a
    // mining special case.
    expect(toolGateFor('fine_elderwood_log')?.professionId).toBe('logging');
    expect(toolGateFor('fine_sunpetal_herb')?.professionId).toBe('herbalism');
    // AND THE FARMING LADDER, the fourth family. A crop and its fine twin take
    // the SAME tier, because farming's fine grade is a skill roll rather than a
    // tool comparison; that asymmetry with the land grades above is the whole
    // reason this branch is separate, so it is pinned rather than left implicit.
    expect(toolGateFor('vale_wheat')).toEqual({ professionId: 'farming', nodeTier: 1 });
    expect(toolGateFor('fine_vale_wheat')).toEqual({ professionId: 'farming', nodeTier: 1 });
    expect(toolGateFor('marsh_rice')).toEqual({ professionId: 'farming', nodeTier: 2 });
    expect(toolGateFor('fine_highland_barley')).toEqual({ professionId: 'farming', nodeTier: 3 });
    // The ladder really is climbed: the top hoe is only reachable because the
    // rungs below it are crafted first, which is the ordering a circuit inverts.
    // FIVE RUNGS SINCE masterwrought Phase 11j, and the list is derived rather
    // than typed for exactly the reason this arm went stale: it named
    // osmium_hoe as "the top hoe" and stayed green when a rung was added above
    // it, which is the same shape as the fishing arm below asserting its apex
    // by name. A new rung now joins this sweep with no edit here.
    const farmOwned = reachableItems().owned;
    const hoeRungs = HOE_RECIPES.map((r) => r.resultItemId);
    expect(hoeRungs, 'every crafted hoe rung, apex included').toEqual([
      'bronze_hoe',
      'skysilver_hoe',
      'osmium_hoe',
      'evergarden_hoe',
    ]);
    for (const id of hoeRungs) {
      expect(farmOwned.has(id), `${id} must be reachable`).toBe(true);
    }
    // And the ladder really is climbed rather than assumed: the top catch is
    // only obtainable in the fixpoint because the tier-6 rod becomes craftable
    // first, which is the ordering the deadlock inverted.
    const { owned } = reachableItems();
    expect(owned.has('clockreel_fishing_rod')).toBe(true);
    expect(owned.has('raw_stillmere_salmon')).toBe(true);
    for (const id of RAW_COOKING_CATCH_IDS) {
      expect(owned.has(id), `${id} must be reachable`).toBe(true);
    }
  });

  it('and it FAILS on the deadlock it was written for (the model, driven)', () => {
    // The decisive arm. The arms above assert a green fact about live content,
    // which is exactly the shape that can rot into a pin that cannot fail. So
    // re-run THE SAME FIXPOINT against the bill Phase 11i almost shipped, with
    // the band-5 salmon in the apex rod's own reagent list, and require that it
    // strands. If a future refactor makes the model generous enough to swallow
    // a closed circuit, this reds and the two arms above stop being trustworthy
    // at the same moment.
    //
    // "THE SAME FIXPOINT" IS LOAD-BEARING AND WAS BRIEFLY A LIE. The first draft
    // of this arm re-implemented the loop inline, which is the F11 defect one
    // level up: a fixture driving a copy of the rule instead of the rule, in the
    // very arm written to stop that. It would have kept proving the OLD model
    // strands the deadlock while the live one quietly stopped. reachableItems
    // takes a bill override now, so both arms run one implementation.
    const { owned } = reachableItems(
      new Map([
        [
          'recipe_clockreel_fishing_rod',
          [
            { itemId: 'glimmerfin_koi', count: 2 },
            { itemId: 'raw_hollowgill_sturgeon', count: 6 },
            { itemId: 'raw_stillmere_salmon', count: 4 },
            { itemId: 'tidewrought_fishing_rod', count: 1 },
          ],
        ],
      ]),
    );
    // Everything the circuit strands, and nothing else: the rod, the catch its
    // band pays, and the two rows that consume that catch.
    expect(owned.has('clockreel_fishing_rod')).toBe(false);
    expect(owned.has('raw_stillmere_salmon')).toBe(false);
    // The rung BELOW is untouched, which is what makes this a circuit rather
    // than the model refusing the whole rod family.
    expect(owned.has('tidewrought_fishing_rod')).toBe(true);
    expect(owned.has('raw_hollowgill_sturgeon')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// THE HOLE THE FIXPOINT ABOVE CANNOT SEE, closed at masterwrought Phase 11j
// ---------------------------------------------------------------------------
//
// `bestToolTiers` counts any tool the realm OWNS. The engine does not: every
// land gathering gate resolves through professions/wield_gate.ts
// `bestWieldableGatherToolTierOrNone`, which drops any tool the player's
// PROFICIENCY cannot wield. So the model is strictly more permissive than the
// game, and a tool whose wield requirement sits above its own profession's cap
// would be permanently unswingable in play while the fixpoint sailed past it.
//
// That is the unlearnable-at-150 finding one axis over. There, a recipe
// authored above its craft's cap was permanently unlearnable and no test could
// see it because there is no craft-time admission gate; here, a tool authored
// above its profession's cap would be permanently unwieldable and the
// reachability fixpoint cannot see it because the fixpoint models a REALM,
// which collectively holds every proficiency, rather than a player.
//
// This arm is deliberately NOT a change to the fixpoint's semantics. Making
// `bestToolTiers` wield-aware would need a proficiency to be wield-aware
// ABOUT, and a realm has no single proficiency. The checkable claim is the one
// that actually bites: every gathering tool must wield at its own profession's
// cap, because a player who has maxed the profession is the most capable
// wielder the game admits.
//
// It CALLS THE SHIPPED PREDICATES rather than re-deriving the thresholds. A
// fixture that re-implements wieldRequirementForTier would keep passing while
// the table under it moved, which is the defect this file's own clockreel arm
// was rewritten to avoid.
describe('every gathering tool is wieldable by the profession that owns it', () => {
  it('no shipped tool demands more proficiency than its profession can reach', () => {
    const unswingable: string[] = [];
    let checked = 0;
    let asserted = 0;
    for (const def of Object.values(ITEMS)) {
      const use = def.use;
      if (use?.type !== 'gatherTool') continue;
      checked += 1;
      // FISHING IS SKIPPED EXPLICITLY, and the comment this replaces was
      // wrong in a way worth recording: it said canWieldGatherToolTier
      // "encodes" the R22 rod exemption. It does not. That helper is a bare
      // `proficiency >= wieldRequirementForTier(tier)`; the exemption lives in
      // bestWieldableGatherToolTierOrNone and its any-profession sibling. Rods
      // passed here by cap ARITHMETIC (fishing caps at 200 against a tier-5
      // requirement of 100), so lowering fishing's cap under 100 would have red
      // this arm on a rung the engine never gates.
      if (use.professionId === 'fishing') continue;
      asserted += 1;
      const cap = GATHERING_PROFESSIONS[use.professionId].maxSkill;
      // THE LADDER MUST KNOW THIS TIER. wieldRequirementForTier returns 0 for
      // any tier outside WIELD_REQUIREMENT_BY_TIER, so it fails OPEN: a tier-6
      // LAND tool would read requirement 0 and sail through the wieldability
      // check below while shipping completely ungated. That is the precise
      // hazard docs/prd/masterwrought/brainstorm.md records as the reason a
      // gathering-wide apex-tier expansion is one change and not three, and
      // until now it was prose with no test behind it.
      expect(
        Object.hasOwn(WIELD_REQUIREMENT_BY_TIER, use.tier),
        `${def.id} is a tier-${use.tier} ${use.professionId} tool and the wield ` +
          `table has no row for that tier, so wieldRequirementForTier fails OPEN ` +
          `at 0 and the rung would ship UNGATED. Add the tier's row in the same ` +
          `change that adds the tool.`,
      ).toBe(true);
      if (!canWieldGatherToolTier(use.tier, cap)) {
        unswingable.push(
          `${def.id} is a tier-${use.tier} ${use.professionId} tool demanding ` +
            `${wieldRequirementForTier(use.tier)} proficiency, but ${use.professionId} ` +
            `caps at ${cap}: no player can ever swing it. Either lower the tier's ` +
            `wield requirement or raise the profession's cap, in the same change.`,
        );
      }
    }
    expect(unswingable).toEqual([]);
    // Non-vacuity, pinned AT the real count rather than under it. A floor set
    // well below the population is the trap tests/CLAUDE.md names: fourteen
    // tools could have left this sweep with the arm still green. Exact, so a
    // tool joining or leaving the roster is a deliberate edit here.
    expect(checked, 'every shipped gatherTool def, fishing included').toBe(25);
    // AND THE POPULATION THAT REACHES THE ASSERTIONS, which is the number the
    // line above does NOT bound (masterwrought Phase 11j QA): `checked` is
    // incremented before the fishing `continue`, so it counts the LOOP. A land
    // tool retyped to professionId 'fishing' would leave the sweep entirely
    // with `checked` still 25 and this arm still green, which is the shape of
    // hole this pin exists to close. Twenty land tools: five hoes, five picks,
    // five axes, five sickles.
    expect(asserted, 'the LAND tools that actually reach the assertions').toBe(20);
  });

  it("the apex hoe's cap is REACHABLE on the ground the rung below already works", () => {
    // The other half of "no table change was needed", and the half that had no
    // test. tests/professions_tool_gate.test.ts proves the knife-edge rule for
    // the wield ladder against the NODE professions' teaching ceilings, and
    // farming has no nodes: its ceilings come from the crop tier through
    // farmingTeachingCeilingFor. So the wield row reading 100 is only safe if
    // farming can actually REACH 100, and it can only reach it by working
    // ground the tier-4 hoe opens, since the tier-5 hoe is what 100 unlocks.
    //
    // A ceiling below the cap here would be the same dead-content shape as a
    // recipe above its craft's cap: the apex rung would exist, be craftable,
    // and never be swingable by anyone.
    //
    // SCOPE, so this is not read as covering the whole ladder: it closes the
    // TOP rung only. The lower hoe rungs are fine today and were checked by
    // hand rather than pinned (tier-1 crops teach to 50 against the tier-2
    // hoe's 40, tier-2 to 75 against 70, tier-3 to 100 against 85), so there is
    // no live hole below, but neither is there an arm.
    const cap = GATHERING_PROFESSIONS.farming.maxSkill;
    const topCropTier = Math.max(...Object.values(FARM_CROPS).map((crop) => crop.tier));
    expect(
      farmingTeachingCeilingFor(topCropTier),
      `tier-${topCropTier} crops must teach all the way to farming's cap, or the ` +
        `tier-5 hoe's wield requirement is unreachable and the rung is dead`,
    ).toBe(cap);
    expect(wieldRequirementForTier(5), 'and that cap IS the requirement').toBe(cap);
    // The rung below really does open that ground, so the climb is not
    // circular: planting a tier-N crop needs a tier-N hoe, and the hoe the apex
    // bill consumes is the one that must reach the top crop tier. The tool tier
    // is DERIVED from that bill rather than typed, so re-pointing it at a lower
    // rung reds here instead of leaving this sentence quietly false.
    const apexHoeBill = ALL_RECIPES.find((r) => r.id === 'recipe_evergarden_hoe');
    const rungBelow = apexHoeBill?.reagents
      .map((g) => ITEMS[g.itemId]?.use)
      .find((use) => use?.type === 'gatherTool' && use.professionId === 'farming');
    const rungBelowTier = rungBelow?.type === 'gatherTool' ? rungBelow.tier : 0;
    expect(rungBelowTier, 'the apex bill consumes a farming tool').toBeGreaterThan(0);
    expect(
      canGatherTier(rungBelowTier, topCropTier),
      'the rung this recipe consumes must plant the top crop tier',
    ).toBe(true);
  });

  it('the apex land rungs sit exactly ON their cap, which is the knife edge', () => {
    // The tier-5 land tools are the tight case and the reason this arm exists:
    // TIER5_TOOL_WIELD_PROFICIENCY is 100 and every land profession caps at
    // 100, so they wield at the cap and nowhere below it. Benign today, and
    // one edit to either number away from dead content, which is exactly what
    // the sweep above is here to red on.
    for (const id of [
      'arcanite_mining_pick',
      'elderwood_axe',
      'sunpetal_sickle',
      'evergarden_hoe',
    ]) {
      const use = ITEMS[id]?.use;
      expect(use?.type, `${id} must be a gather tool`).toBe('gatherTool');
      if (use?.type !== 'gatherTool') continue;
      const cap = GATHERING_PROFESSIONS[use.professionId].maxSkill;
      expect(wieldRequirementForTier(use.tier), `${id} wield requirement`).toBe(cap);
      expect(canWieldGatherToolTier(use.tier, cap), `${id} at the cap`).toBe(true);
      expect(canWieldGatherToolTier(use.tier, cap - 1), `${id} one below the cap`).toBe(false);
    }
  });
});
