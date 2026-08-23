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
import { FISHING_TABLES_BY_BAND, RAW_COOKING_CATCH_IDS } from '../src/sim/content/items';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { NODE_MATERIAL_TABLE, NODE_TYPE_BY_PROFESSION } from '../src/sim/professions/gathering';
import { materialTierForItem } from '../src/sim/professions/material_tier';
import { canGatherTier } from '../src/sim/professions/tools';

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
  for (const [professionId, nodeType] of Object.entries(NODE_TYPE_BY_PROFESSION)) {
    if (!nodeType) continue;
    for (const entry of Object.values(NODE_MATERIAL_TABLE[nodeType])) {
      if (entry.itemId === itemId) {
        return { professionId, nodeTier: Math.max(1, materialTierForItem(itemId)) };
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
function reachableItems(): Set<string> {
  const owned = new Set<string>();
  const gated = new Map<string, { professionId: string; nodeTier: number }>();
  for (const id of Object.keys(ITEMS)) {
    if (CRAFTED_OUTPUTS.has(id)) continue;
    const gate = toolGateFor(id);
    if (gate) gated.set(id, gate);
    else owned.add(id);
  }
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
      if (recipe.reagents.every((g) => owned.has(g.itemId))) {
        owned.add(recipe.resultItemId);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return owned;
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
    const owned = reachableItems();
    const unreachable = ALL_RECIPES.filter(
      (r) => !r.reagents.every((g) => owned.has(g.itemId)),
    ).map((r) => {
      const missing = r.reagents.filter((g) => !owned.has(g.itemId)).map((g) => g.itemId);
      return `${r.id} cannot be crafted: ${missing.join(', ')} unobtainable`;
    });
    expect(unreachable).toEqual([]);
    // Non-vacuity: an empty ALL_RECIPES would satisfy the line above by having
    // nothing to strand, and so would a fixpoint that seeded every item id.
    expect(ALL_RECIPES.length).toBeGreaterThan(100);
    expect(owned.size).toBeLessThan(Object.keys(ITEMS).length + 1);
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
    // And the ladder really is climbed rather than assumed: the top catch is
    // only obtainable in the fixpoint because the tier-6 rod becomes craftable
    // first, which is the ordering the deadlock inverted.
    const owned = reachableItems();
    expect(owned.has('clockreel_fishing_rod')).toBe(true);
    expect(owned.has('raw_stillmere_salmon')).toBe(true);
    for (const id of RAW_COOKING_CATCH_IDS) {
      expect(owned.has(id), `${id} must be reachable`).toBe(true);
    }
  });

  it('and it FAILS on the deadlock it was written for (the model, driven)', () => {
    // The decisive arm. The arms above assert a green fact about live content,
    // which is exactly the shape that can rot into a pin that cannot fail. So
    // re-run the same fixpoint against the bill Phase 11i almost shipped, with
    // the band-5 salmon in the apex rod's own reagent list, and require that it
    // strands. If a future refactor makes the model generous enough to swallow
    // a closed circuit, this reds and the two arms above stop being trustworthy
    // at the same moment.
    const owned = new Set<string>();
    const gated = new Map<string, { professionId: string; nodeTier: number }>();
    const draftReagents = new Map<string, { itemId: string; count: number }[]>();
    for (const recipe of ALL_RECIPES) draftReagents.set(recipe.id, [...recipe.reagents]);
    draftReagents.set('recipe_clockreel_fishing_rod', [
      { itemId: 'glimmerfin_koi', count: 2 },
      { itemId: 'raw_hollowgill_sturgeon', count: 6 },
      { itemId: 'raw_stillmere_salmon', count: 4 },
      { itemId: 'tidewrought_fishing_rod', count: 1 },
    ]);
    for (const id of Object.keys(ITEMS)) {
      if (CRAFTED_OUTPUTS.has(id)) continue;
      const gate = toolGateFor(id);
      if (gate) gated.set(id, gate);
      else owned.add(id);
    }
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
        if ((draftReagents.get(recipe.id) ?? []).every((g) => owned.has(g.itemId))) {
          owned.add(recipe.resultItemId);
          grew = true;
        }
      }
      if (!grew) break;
    }
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
