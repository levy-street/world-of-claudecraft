// Inscription end to end (Masterwrought phase 06): the base catalog's own
// behavior arm, distinct from tests/inscription_catalog.test.ts, which pins
// the CONTENT shape and can say nothing about whether the ladder is playable.
// One real Sim walks the whole player-facing loop through the live command
// surface with no shortcuts: train at the Highwatch apothecary (free rung,
// tier gate, priced rung, charged exactly once), craft a rung-50 rare there
// with a real craft cast driven by real ticks, and collect the deed the rare
// output earns. The refusal arm closes the other side: the same craft away
// from an apothecary is refused, so "at the apothecary" is a gate rather
// than flavor.
//
// Deterministic: fixed seed, and every assertion is masterwork-proc AGNOSTIC
// (counting by ITEM ID holds on both rng branches; the scroll arm is immune
// anyway, slotless consumables cannot masterwork).

import { describe, expect, it } from 'vitest';
import { INSCRIPTION_RECIPES } from '../src/sim/content/recipes';
import { STATIONS } from '../src/sim/data';
import { craftCastDurationSec } from '../src/sim/professions/craft_cast_duration';
import { resolveCraft } from '../src/sim/professions/crafting';
import { stationsOfType } from '../src/sim/professions/stations';
import { TRAINING_FEE_BY_TIER } from '../src/sim/professions/training';
import type { Rng } from '../src/sim/rng';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { CRAFT_CAST_ID, type Entity, type SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const SEED = 4242;
// The free rung-0 tome and the rung-50 rare band the deed derives from.
const RUNG_0_RECIPE = 'recipe_silverleaf_primer';
const RUNG_50_RECIPE = 'recipe_sunpetal_grimoire';
const RUNG_50_OUTPUT = 'sunpetal_grimoire';
const RUNG_50_SCROLL_RECIPE = 'recipe_sunpetal_scroll';
const RUNG_50_SCROLL_OUTPUT = 'sunpetal_scroll';
// The shipped rung-50 reagent line (recipes.ts), pinned as literals here so a
// silent reagent re-author reds in the behavior arm too, not only the catalog.
const RUNG_50_REAGENTS: readonly { itemId: string; count: number }[] = [
  { itemId: 'sunpetal_herb', count: 2 },
  { itemId: 'arcane_essence', count: 2 },
  { itemId: 'glass_vial', count: 1 },
  { itemId: 'goldleaf_herb', count: 2 },
];

function recipeById(id: string) {
  const recipe = INSCRIPTION_RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`${id} missing from INSCRIPTION_RECIPES`);
  return recipe;
}

function makeSim(): Sim {
  return new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: false });
}

function playerOf(sim: Sim): { p: Entity; meta: PlayerMeta; pid: number } {
  const pid = sim.playerId;
  const meta = sim.players.get(pid);
  const p = sim.entities.get(pid);
  if (!meta || !p) throw new Error('player missing');
  return { p, meta, pid };
}

/** Stand the player on the Highwatch apothecary pad (the STATIONS row's own
 *  coordinate, seated on the terrain so nothing displaces them mid-cast). */
function teleportToApothecary(sim: Sim): void {
  const apothecary = stationsOfType(STATIONS, 'apothecary')[0];
  if (!apothecary) throw new Error('no apothecary station in STATIONS');
  const { p } = playerOf(sim);
  p.pos.x = apothecary.pos.x;
  p.pos.z = apothecary.pos.z;
  p.pos.y = terrainHeight(apothecary.pos.x, apothecary.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

/** Somewhere no crafting station stands (STATION_RADIUS is a few yards; this
 *  is hundreds away from every one of them). */
function teleportAwayFromEveryStation(sim: Sim): void {
  const { p } = playerOf(sim);
  const far = { x: -600, z: -600 };
  for (const station of STATIONS) {
    const dx = far.x - station.pos.x;
    const dz = far.z - station.pos.z;
    expect(Math.hypot(dx, dz), `${station.id} is too close to the away spot`).toBeGreaterThan(100);
  }
  p.pos.x = far.x;
  p.pos.z = far.z;
  p.pos.y = terrainHeight(far.x, far.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

function grantReagents(
  sim: Sim,
  pid: number,
  line: readonly { itemId: string; count: number }[],
  mult: number,
): void {
  for (const reagent of line) sim.addItem(reagent.itemId, reagent.count * mult, pid);
}

/** Copies of `itemId` held in bags, counted across plain stacks AND instanced
 *  copies: a masterwork proc grants an instance, so a plain-stack-only count
 *  would go quality-dependent and lose the whole point of the pin. */
function bagCount(meta: PlayerMeta, itemId: string): number {
  return meta.inventory.reduce((n, slot) => (slot.itemId === itemId ? n + slot.count : n), 0);
}

/** Advance real ticks until the craft cast resolves, or give up. Returns every
 *  event the run produced, so the caller can assert on the live emit too. */
function tickUntilCraftResolves(sim: Sim, maxTicks = 20 * 15): SimEvent[] {
  const collected: SimEvent[] = [];
  const { meta } = playerOf(sim);
  for (let i = 0; i < maxTicks; i++) {
    collected.push(...sim.tick());
    if (meta.lastCraftResult) return collected;
  }
  throw new Error('craft cast never resolved');
}

function craftResults(events: SimEvent[]): Extract<SimEvent, { type: 'craftResult' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'craftResult' }> => {
    return e.type === 'craftResult';
  });
}

describe('inscription training at the Highwatch apothecary', () => {
  it('states the rung-50 premise this suite drives (literals match the shipped recipe)', () => {
    // The reagent literals above are what the consume assertions grant and
    // count. Held against the shipped record so a re-authored line reds HERE,
    // naming the drift, instead of failing an unrelated-looking count later.
    expect(recipeById(RUNG_50_RECIPE).reagents).toEqual(RUNG_50_REAGENTS);
    expect(recipeById(RUNG_50_RECIPE).skillReq).toBe(50);
    expect(recipeById(RUNG_50_RECIPE).stationType).toBe('apothecary');
    expect(recipeById(RUNG_50_RECIPE).resultItemId).toBe(RUNG_50_OUTPUT);
    const rung0 = recipeById(RUNG_0_RECIPE);
    expect(rung0.skillReq).toBe(0);
    expect(rung0.stationType).toBe('apothecary');
  });

  it('teaches the rung-0 recipe for free, at the apothecary, through the live command', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    sim.tick(); // settle spawn
    teleportToApothecary(sim);
    meta.copper = 50_000;
    expect(meta.knownRecipes.has(RUNG_0_RECIPE)).toBe(false);

    sim.drainEvents();
    sim.trainRecipe(RUNG_0_RECIPE, pid);

    expect(meta.lastTrainResult?.ok, meta.lastTrainResult?.reason).toBe(true);
    // Rung 0 sits on training tier 0, which is free: the purse must not move.
    expect(meta.lastTrainResult?.fee).toBe(0);
    expect(TRAINING_FEE_BY_TIER[0]).toBe(0);
    expect(meta.copper).toBe(50_000);
    expect(meta.knownRecipes.has(RUNG_0_RECIPE)).toBe(true);
    const trained = sim
      .drainEvents()
      .filter((e): e is Extract<SimEvent, { type: 'trainResult' }> => e.type === 'trainResult');
    expect(trained.map((e) => [e.recipeId, e.ok])).toEqual([[RUNG_0_RECIPE, true]]);
  });

  it('gates the rung-50 recipe on craft skill, then charges 10000 copper exactly once', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    sim.tick();
    teleportToApothecary(sim);
    meta.copper = 50_000;

    // Tier gate first: at skill 0 the rare rung is refused, and a refusal must
    // not touch the purse (the fee is charged on the ok arm only).
    sim.trainRecipe(RUNG_50_RECIPE, pid);
    expect(meta.lastTrainResult?.ok).toBe(false);
    expect(meta.lastTrainResult?.reason).toBe('train_tier_unmet');
    expect(meta.knownRecipes.has(RUNG_50_RECIPE)).toBe(false);
    expect(meta.copper).toBe(50_000);

    meta.craftSkills.inscription = 50;
    sim.trainRecipe(RUNG_50_RECIPE, pid);
    expect(meta.lastTrainResult?.ok, meta.lastTrainResult?.reason).toBe(true);
    expect(meta.lastTrainResult?.fee).toBe(10_000);
    expect(meta.copper).toBe(40_000);
    expect(meta.knownRecipes.has(RUNG_50_RECIPE)).toBe(true);

    // Exactly once: a repeated command re-resolves to already-known and must
    // never re-charge (the resolveTrain deny-order doctrine).
    sim.trainRecipe(RUNG_50_RECIPE, pid);
    expect(meta.lastTrainResult?.ok).toBe(false);
    expect(meta.lastTrainResult?.reason).toBe('train_already_known');
    expect(meta.copper).toBe(40_000);
  });

  it('refuses training away from the apothecary even with the skill and the gold', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    sim.tick();
    teleportAwayFromEveryStation(sim);
    meta.copper = 50_000;
    meta.craftSkills.inscription = 50;

    sim.trainRecipe(RUNG_50_RECIPE, pid);
    expect(meta.lastTrainResult?.ok).toBe(false);
    expect(meta.lastTrainResult?.reason).toBe('train_out_of_range');
    expect(meta.knownRecipes.has(RUNG_50_RECIPE)).toBe(false);
    expect(meta.copper).toBe(50_000);
  });
});

describe('inscription rung-50 craft at the apothecary', () => {
  it('crafts the rare tome, consumes the exact reagent line, and lands the deed', () => {
    const sim = makeSim();
    const { p, meta, pid } = playerOf(sim);
    sim.tick();
    teleportToApothecary(sim);
    meta.copper = 50_000;
    meta.craftSkills.inscription = 50;
    sim.trainRecipe(RUNG_50_RECIPE, pid);
    expect(meta.lastTrainResult?.ok, meta.lastTrainResult?.reason).toBe(true);

    // Double the line, so the "consumed exactly" assertion below is decisive in
    // BOTH directions: granting exactly one line could only ever show that the
    // bags emptied, which over-consumption cannot be told apart from.
    grantReagents(sim, pid, RUNG_50_REAGENTS, 2);
    const hubBefore = meta.deedStats.counters.hubCraftsPerformed ?? 0;
    expect(meta.deedsEarned.has('prog_inscription_rare')).toBe(false);
    expect(bagCount(meta, RUNG_50_OUTPUT)).toBe(0);
    sim.drainEvents();

    sim.craftItem(RUNG_50_RECIPE, false, pid, 1);
    // A real cast, not an instant resolve: the command starts CRAFT_CAST_ID at
    // the recipe's own content band, and nothing has been consumed yet.
    expect(p.castingAbility).toBe(CRAFT_CAST_ID);
    expect(p.castRemaining).toBeCloseTo(craftCastDurationSec(recipeById(RUNG_50_RECIPE)), 5);
    expect(meta.lastCraftResult ?? null).toBeNull();

    const events = tickUntilCraftResolves(sim);

    expect(meta.lastCraftResult?.ok, meta.lastCraftResult?.reason).toBe(true);
    expect(meta.lastCraftResult?.itemId).toBe(RUNG_50_OUTPUT);
    expect(meta.lastCraftResult?.count).toBe(1);
    // Proc-agnostic: by item id, never by quality. A masterwork proc upgrades
    // the granted copy in place and would fail a quality pin on the lucky seed.
    expect(bagCount(meta, RUNG_50_OUTPUT)).toBe(1);
    // Exactly one line consumed: one line of each reagent survives.
    for (const reagent of RUNG_50_REAGENTS) {
      expect(bagCount(meta, reagent.itemId), `${reagent.itemId} left after one craft`).toBe(
        reagent.count,
      );
    }
    // The rare-tier milestone, granted by updateDeeds at the tick tail (the
    // craft's markVisited('craft_rare:inscription') plus markDeedsDirty).
    expect(meta.deedStats.visited.has('craft_rare:inscription')).toBe(true);
    expect(meta.deedsEarned.has('prog_inscription_rare')).toBe(true);
    expect(
      events.some((e) => e.type === 'deedUnlocked' && e.deedId === 'prog_inscription_rare'),
    ).toBe(true);
    // The station-bound craft counter (persisted key, station-bound meaning).
    expect(meta.deedStats.counters.hubCraftsPerformed).toBe(hubBefore + 1);
    // And the live emit agrees with the probe: one successful craftResult.
    expect(craftResults(events).map((e) => [e.ok, e.itemId])).toEqual([[true, RUNG_50_OUTPUT]]);
  });

  it('crafts the rung-50 scroll as a batch of two, and the rare mark fires for a consumable', () => {
    // The scroll half of the rung: resultCount 2 grants two copies from one
    // cast (the serpent-elixir batch shape), and a rare CONSUMABLE output
    // writes the same craft_rare mark the tome does, so either half of the
    // rung can land the milestone.
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    sim.tick();
    teleportToApothecary(sim);
    meta.copper = 50_000;
    meta.craftSkills.inscription = 50;
    sim.trainRecipe(RUNG_50_SCROLL_RECIPE, pid);
    expect(meta.lastTrainResult?.ok, meta.lastTrainResult?.reason).toBe(true);
    const line = recipeById(RUNG_50_SCROLL_RECIPE).reagents;
    grantReagents(sim, pid, line, 2);
    expect(meta.deedsEarned.has('prog_inscription_rare')).toBe(false);
    sim.drainEvents();

    sim.craftItem(RUNG_50_SCROLL_RECIPE, false, pid, 1);
    tickUntilCraftResolves(sim);

    expect(meta.lastCraftResult?.ok, meta.lastCraftResult?.reason).toBe(true);
    expect(meta.lastCraftResult?.count).toBe(2);
    expect(bagCount(meta, RUNG_50_SCROLL_OUTPUT)).toBe(2);
    // Exactly one line consumed even though the batch granted two.
    for (const reagent of line) {
      expect(bagCount(meta, reagent.itemId), `${reagent.itemId} left after one craft`).toBe(
        reagent.count,
      );
    }
    expect(meta.deedStats.visited.has('craft_rare:inscription')).toBe(true);
    expect(meta.deedsEarned.has('prog_inscription_rare')).toBe(true);
  });

  it('the batch craft spends exactly one rng draw (the masterwork proc), count-independent', () => {
    // The determinism contract for a multi-copy recipe: resultCount 2 grants
    // both copies through the signable-instance arm with ZERO extra draws, so
    // draw count can never become a function of batch size and fork the three
    // hosts. Same observer rig as the professions_crafting draw pin, driven
    // through resolveCraft directly so no other tick system draws inside the
    // counting window. This is the first multi-copy recipe with a draw pin;
    // the three prior pins all drive resultCount 1.
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    sim.tick();
    teleportToApothecary(sim);
    meta.copper = 50_000;
    meta.craftSkills.inscription = 50;
    sim.trainRecipe(RUNG_50_SCROLL_RECIPE, pid);
    expect(meta.lastTrainResult?.ok, meta.lastTrainResult?.reason).toBe(true);
    grantReagents(sim, pid, recipeById(RUNG_50_SCROLL_RECIPE).reagents, 1);

    let draws = 0;
    const rng: Rng = (sim as any).ctx.rng;
    rng.setObserver(() => {
      draws++;
    });
    const result = resolveCraft((sim as any).ctx, pid, RUNG_50_SCROLL_RECIPE);
    rng.setObserver(null);

    expect(result.ok, result.reason).toBe(true);
    expect(bagCount(meta, RUNG_50_SCROLL_OUTPUT)).toBe(2);
    // One draw, the masterwork proc roll: the per-copy signable-instance
    // grants downstream of it draw nothing, so the second copy costs zero.
    expect(draws).toBe(1);
  });

  it('lands the 50-skill deed through the LIVE gain path when a craft crosses the threshold', () => {
    // The catalog climb itself: skill 49, one rung-25 craft, and the gain
    // arm (CRAFT_SKILL_GAIN through gainCraftSkill) crosses 50, which the
    // deeds evaluator turns into prog_inscription_50 at the tick tail (this
    // is the one arm that drives the real skill-gain path instead of
    // assigning craftSkills directly).
    const RUNG_25_RECIPE = 'recipe_goldleaf_folio';
    const rung25 = recipeById(RUNG_25_RECIPE);
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    sim.tick();
    teleportToApothecary(sim);
    meta.copper = 50_000;
    meta.craftSkills.inscription = 49;
    sim.trainRecipe(RUNG_25_RECIPE, pid);
    expect(meta.lastTrainResult?.ok, meta.lastTrainResult?.reason).toBe(true);
    for (const reagent of rung25.reagents) sim.addItem(reagent.itemId, reagent.count, pid);
    expect(meta.deedsEarned.has('prog_inscription_50')).toBe(false);
    sim.drainEvents();

    sim.craftItem(RUNG_25_RECIPE, false, pid, 1);
    const events = tickUntilCraftResolves(sim);

    expect(meta.lastCraftResult?.ok, meta.lastCraftResult?.reason).toBe(true);
    // The LIVE gain arm really ran: 49 + CRAFT_SKILL_GAIN = 50, never assigned.
    expect(meta.craftSkills.inscription).toBe(50);
    expect(meta.deedsEarned.has('prog_inscription_50')).toBe(true);
    expect(
      events.some((e) => e.type === 'deedUnlocked' && e.deedId === 'prog_inscription_50'),
    ).toBe(true);
    // The Grandmaster sibling stays unearned at 50: the pair is two gates.
    expect(meta.deedsEarned.has('prog_grandmaster_inscription')).toBe(false);
  });

  it('refuses the same craft away from an apothecary with station_required', () => {
    const sim = makeSim();
    const { p, meta, pid } = playerOf(sim);
    sim.tick();
    teleportToApothecary(sim);
    meta.copper = 50_000;
    meta.craftSkills.inscription = 50;
    sim.trainRecipe(RUNG_50_RECIPE, pid);
    expect(meta.lastTrainResult?.ok, meta.lastTrainResult?.reason).toBe(true);
    grantReagents(sim, pid, RUNG_50_REAGENTS, 1);

    // Everything else is satisfied (recipe known, reagents held, skill met), so
    // the station really is the gate the refusal names.
    teleportAwayFromEveryStation(sim);
    sim.drainEvents();
    sim.craftItem(RUNG_50_RECIPE, false, pid, 1);

    expect(meta.lastCraftResult?.ok).toBe(false);
    expect(meta.lastCraftResult?.reason).toBe('station_required');
    // A start-gate denial is not a cast, and it spends nothing.
    expect(p.castingAbility).toBe(null);
    expect(bagCount(meta, RUNG_50_OUTPUT)).toBe(0);
    for (const reagent of RUNG_50_REAGENTS) {
      expect(bagCount(meta, reagent.itemId), `${reagent.itemId} untouched by the refusal`).toBe(
        reagent.count,
      );
    }
    expect(craftResults(sim.drainEvents()).map((e) => [e.ok, e.reason])).toEqual([
      [false, 'station_required'],
    ]);
  });
});
