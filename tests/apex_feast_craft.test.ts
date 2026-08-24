// The apex feast tier end to end (masterwrought Phase 11k): the CRAFT half,
// driven through a real Sim with a real craft cast and real ticks. Its sibling
// tests/professions_feast.test.ts owns the placement and eating half; what
// lives here is everything that only happens at the moment a feast is COOKED.
//
// Three claims, and each one is a thing a targeted content pin cannot say:
//  1. THE PRESTIGE (deliverable 3), which this phase claims rather than builds:
//     an apex feast is rare-or-better, so professions/crafting.ts stamps the
//     crafted copy with its crafter's name. Asserted against the live grant,
//     never against the threshold helper, because the claim is that a player
//     really ends up holding a signed feast.
//  2. THE DEED (deliverable 4): the apex_feast craft mark is written at the
//     craft-credit arm, the deed evaluates at the tick tail, and both happen on
//     a real craft rather than on a hand-set mark.
//  3. THE DISCRIMINATOR: cooking the PARTY feast one rung down does neither of
//     those things to the deed, so the deed is about the apex tier rather than
//     about feasts in general.
//
// Deterministic: fixed seed, and every assertion is masterwork-proc AGNOSTIC
// (a feast is slot-less and stat-less, so the masterwork arm structurally
// cannot fire on one, which tests/item_instance_tooltip.test.ts pins).

import { describe, expect, it } from 'vitest';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, STATIONS } from '../src/sim/data';
import { APEX_FEAST_CRAFT_MARK } from '../src/sim/professions/feast';
import { stationsOfType } from '../src/sim/professions/stations';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const SEED = 8181;
const APEX_RECIPE = 'recipe_stonepot_feast';
const APEX_OUTPUT = 'stonepot_feast';
const PARTY_RECIPE = 'recipe_harvest_feast';
const PARTY_OUTPUT = 'harvest_feast';
const DEED_ID = 'prog_field_to_feast';

function recipeById(id: string) {
  const recipe = ALL_RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`${id} missing from ALL_RECIPES`);
  return recipe;
}

function playerOf(sim: Sim): { p: Entity; meta: PlayerMeta; pid: number } {
  const pid = sim.playerId;
  const meta = sim.players.get(pid);
  const p = sim.entities.get(pid);
  if (!meta || !p) throw new Error('player missing');
  return { p, meta, pid };
}

/** A cook standing at a kitchen, skilled to the cap, knowing `recipeId`, with
 *  exactly one line of its reagents in bags. Everything the resolve gates on is
 *  satisfied HERE so a failure downstream is about the phase's own code. */
function cookAt(recipeId: string): { sim: Sim; p: Entity; meta: PlayerMeta; pid: number } {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: false });
  const { p, meta, pid } = playerOf(sim);
  const kitchen = stationsOfType(STATIONS, 'kitchens')[0];
  if (!kitchen) throw new Error('no kitchens station in STATIONS');
  p.pos.x = kitchen.pos.x;
  p.pos.z = kitchen.pos.z;
  p.pos.y = terrainHeight(kitchen.pos.x, kitchen.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  meta.craftSkills.cooking = 125;
  meta.knownRecipes.add(recipeId);
  const recipe = recipeById(recipeId);
  for (const reagent of recipe.reagents) sim.addItem(reagent.itemId, reagent.count, pid);
  // The craft gold fee is charged at the resolve; a broke cook would be refused
  // for a reason that has nothing to do with what this suite is about.
  meta.copper = 100_000;
  return { sim, p, meta, pid };
}

function tickUntilCraftResolves(sim: Sim, maxTicks = 20 * 20): SimEvent[] {
  const collected: SimEvent[] = [];
  const { meta } = playerOf(sim);
  for (let i = 0; i < maxTicks; i++) {
    collected.push(...sim.tick());
    if (meta.lastCraftResult) return collected;
  }
  throw new Error('craft cast never resolved');
}

/** Every bag slot holding `itemId`, instanced copies included. */
function slotsOf(meta: PlayerMeta, itemId: string) {
  return meta.inventory.filter((s) => s.itemId === itemId);
}

describe('cooking an apex feast', () => {
  it('states the premise this suite drives, so a re-author reds HERE', () => {
    // The literals below are what every assertion rests on. Held against the
    // shipped record rather than restated, which is the difference between a
    // premise and a copy of one.
    const apex = recipeById(APEX_RECIPE);
    expect(apex.professionId).toBe('cooking');
    expect(apex.skillReq, 'the capstone rung').toBe(125);
    expect(apex.stationType).toBe('kitchens');
    expect(apex.resultItemId).toBe(APEX_OUTPUT);
    expect(ITEMS[APEX_OUTPUT].quality, 'rare-or-better is what makes it signable').toBe('epic');
    const party = recipeById(PARTY_RECIPE);
    expect(party.skillReq, 'the party rung, one below').toBe(100);
    expect(party.resultItemId).toBe(PARTY_OUTPUT);
  });

  it('signs the crafted copy with the cook, and grants the cross-packet deed', () => {
    const { sim, meta, pid } = cookAt(APEX_RECIPE);
    expect(meta.deedStats.visited.has(APEX_FEAST_CRAFT_MARK), 'not marked before').toBe(false);
    expect(meta.deedsEarned.has(DEED_ID), 'not earned before').toBe(false);

    // The four-arg form is REQUIRED to craft as a named player: a bare third
    // argument is a batch COUNT, never a pid (the retired heuristic that made
    // the two collide).
    sim.craftItem(APEX_RECIPE, false, pid, 1);
    const events = tickUntilCraftResolves(sim);
    expect(meta.lastCraftResult?.ok, meta.lastCraftResult?.reason).toBe(true);
    expect(meta.lastCraftResult?.itemId).toBe(APEX_OUTPUT);

    // THE PRESTIGE, asserted on the copy the player is actually holding: the
    // shipped craft-signing rule stamps any output whose def quality is
    // rare-or-better, and this phase's decision K2 keeps the feast above that
    // threshold precisely so the claim is true without new machinery.
    const held = slotsOf(meta, APEX_OUTPUT);
    expect(held, 'exactly one feast reached the bags').toHaveLength(1);
    expect(held[0].count).toBe(1);
    expect(held[0].instance?.signer, 'the crafted feast carries its cook').toBe(meta.name);

    // THE DEED, through the real evaluator at the tick tail rather than a
    // hand-set mark: the craft writes the visit, markDeedsDirty schedules the
    // evaluation, and updateDeeds grants.
    expect(meta.deedStats.visited.has(APEX_FEAST_CRAFT_MARK)).toBe(true);
    expect(meta.deedsEarned.has(DEED_ID)).toBe(true);
    expect(
      events.some((e) => e.type === 'deedUnlocked' && e.deedId === DEED_ID),
      'and the player was told',
    ).toBe(true);
  });

  it('the PARTY feast earns neither the mark nor the deed', () => {
    // The discriminator, and it is what stops the deed being "cook any feast".
    // Same station, same craft, one rung down: a cook who has only ever made
    // the party feast has not made an apex one.
    const { sim, meta, pid } = cookAt(PARTY_RECIPE);
    sim.craftItem(PARTY_RECIPE, false, pid, 1);
    tickUntilCraftResolves(sim);
    expect(meta.lastCraftResult?.ok, meta.lastCraftResult?.reason).toBe(true);
    expect(meta.lastCraftResult?.itemId).toBe(PARTY_OUTPUT);
    expect(meta.deedStats.visited.has(APEX_FEAST_CRAFT_MARK), 'no apex mark').toBe(false);
    expect(meta.deedsEarned.has(DEED_ID), 'no deed').toBe(false);
    // ...and yet the party feast IS signed, which is the half that makes the
    // discriminator meaningful: the two rungs differ on the DEED, never on the
    // signing rule, so this arm cannot pass merely because nothing was crafted.
    const held = slotsOf(meta, PARTY_OUTPUT);
    expect(held, 'the party feast reached the bags').toHaveLength(1);
    expect(held[0].instance?.signer).toBe(meta.name);
  });
});
