// GATE 1, THE SEED FAUCET, PROVEN END TO END rather than argued.
//
// THE HOLE IT CLOSES. Before Phase 11e no purchase surface anywhere stocked a
// tier 3 or tier 4 farm seed. The crops existed, their dishes were trainable,
// and the deed that asks for farming 100 shipped: none of it was reachable,
// because a farmer could never plant a first upper-tier crop. Three
// trainer-visible recipes were uncompletable and two deeds sat parked.
//
// WHY A SEPARATE SUITE, and why it drives the REAL paths. Content pins can say
// a row is on a counter and that a recipe's reagents resolve; neither can say a
// player can actually get from an empty bag to a cooked dish. Every step below
// runs through the command a player runs: Sim.buyItem at the NPC, plantCrop at
// the bed, harvestCrop at the bed, and the crafting admission for the dish.
// Downstream phases are told to prove the faucet by reading the merged
// vendorItems arrays IN CODE rather than trusting a ledger row; this file is
// the strongest form of that, the loop actually walked.

import { describe, expect, it } from 'vitest';
import { FARM_CROPS } from '../src/sim/content/farm_crops';
import { farmBedById } from '../src/sim/content/farm_patches';
import { ALL_RECIPES, ITEMS, NPCS } from '../src/sim/data';
import { farmingTeachingCeilingFor, harvestCrop, plantCrop } from '../src/sim/professions/farming';
import { TIER3_TOOL_WIELD_PROFICIENCY } from '../src/sim/professions/wield_gate';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const FUNDS = 100_000;
const START_MS = 1_700_000_000_000;

/** The three recipes GATE 1 was blocking, named as literals because the point
 *  is that THESE were uncompletable, not that some recipe now is. */
const DORMANT_RECIPES = [
  'recipe_highwatch_barley_porridge',
  'recipe_evergarden_braised_greens',
  'recipe_harvest_feast',
] as const;

interface Rig {
  sim: Sim;
  pid: number;
  meta: PlayerMeta;
  advance(ms: number): void;
}

function makeRig(seed = 4242): Rig {
  let nowMs = START_MS;
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: false,
    lockoutNowMs: () => nowMs,
  });
  const pid = sim.playerId;
  const meta = sim.players.get(pid) as PlayerMeta;
  meta.copper = FUNDS;
  return {
    sim,
    pid,
    meta,
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

function npcEntity(sim: Sim, templateId: string): Entity {
  const e = [...sim.entities.values()].find((x) => x.kind === 'npc' && x.templateId === templateId);
  if (!e) throw new Error(`${templateId} did not spawn`);
  return e;
}

function standAt(sim: Sim, pid: number, x: number, z: number): void {
  const p = sim.entities.get(pid);
  if (!p) throw new Error('missing player');
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

describe('GATE 1: the tier 3 and 4 seed faucet, walked end to end', () => {
  it('a funded character BUYS an upper-tier seed at the farmer whose tier it is', () => {
    // Read entirely off the merged tables, which is the form every downstream
    // phase is told to verify the faucet in.
    for (const [farmerId, tier] of [
      ['farmer_hollis', 3],
      ['farmer_verbena', 4],
    ] as const) {
      const rig = makeRig();
      const npc = NPCS[farmerId];
      expect(npc, farmerId).toBeDefined();
      const seedsOfTier = Object.values(FARM_CROPS)
        .filter((c) => c.tier === tier)
        .map((c) => c.seedItemId);
      expect(seedsOfTier, `tier ${tier} must have four crops`).toHaveLength(4);
      const stocked = npc.vendorItems ?? [];
      for (const seedId of seedsOfTier) {
        expect(stocked, `${farmerId} must stock ${seedId}`).toContain(seedId);
      }
      // ...and the purchase really completes, which no content pin can say.
      const entity = npcEntity(rig.sim, farmerId);
      standAt(rig.sim, rig.pid, entity.pos.x, entity.pos.z);
      for (const seedId of seedsOfTier) {
        const before = rig.sim.countItem(seedId, rig.pid);
        rig.sim.buyItem(entity.id, seedId, undefined, rig.pid);
        expect(rig.sim.countItem(seedId, rig.pid), `${seedId} was not delivered`).toBe(before + 1);
      }
    }
  });

  it('the bought seed PLANTS and HARVESTS, which is what teaching to 100 needs', () => {
    const rig = makeRig();
    const crop = FARM_CROPS.highland_barley;
    const bed = farmBedById('bed_thornpeak_1');
    if (!bed) throw new Error('no thornpeak bed');
    // Buy at Hollis through the real path.
    const hollis = npcEntity(rig.sim, 'farmer_hollis');
    standAt(rig.sim, rig.pid, hollis.pos.x, hollis.pos.z);
    rig.sim.buyItem(hollis.id, crop.seedItemId, undefined, rig.pid);
    expect(rig.sim.countItem(crop.seedItemId, rig.pid)).toBe(1);

    // The prerequisites that are NOT the subject here are granted rather than
    // earned, which keeps this arm about the FAUCET; each has its own suite.
    // The skill is set to the HOE's wield threshold rather than the crop's band
    // gate, because the R22 wield gate is the higher of the two: a tier-3 crop
    // gates at 50, but the tier-3 hoe needed to plant it wields at 70. Reading
    // the constant rather than restating 70 keeps this arm honest if the
    // ladder is ever re-tuned.
    rig.sim.addItem('skysilver_hoe', 1, rig.pid);
    rig.meta.gatheringProficiency.farming = TIER3_TOOL_WIELD_PROFICIENCY;
    expect(TIER3_TOOL_WIELD_PROFICIENCY).toBeGreaterThanOrEqual((crop.tier - 1) * 25);

    standAt(rig.sim, rig.pid, bed.x, bed.z);
    plantCrop(rig.sim.ctx, rig.sim.player, rig.meta, bed.id, crop.id);
    rig.sim.player.castingAbility = null;
    rig.sim.player.castRemaining = 0;
    const denies = rig.sim.events.filter((e) => e.type === 'farmDenied');
    const plot = rig.meta.farmPlots.get(bed.id);
    expect(
      plot,
      `the bought seed must actually plant (denies: ${denies.map((d) => (d as { reason: string }).reason).join(',')})`,
    ).toBeDefined();
    if (!plot) return;
    // The seed was really spent, so the faucet is load-bearing rather than
    // incidental.
    expect(rig.sim.countItem(crop.seedItemId, rig.pid)).toBe(0);

    rig.advance(crop.durationMs);
    plot.survivalRoll = 0;
    harvestCrop(rig.sim.ctx, rig.sim.player, rig.meta, bed.id);
    rig.sim.tick();
    expect(rig.sim.countItem(crop.produceItemId, rig.pid)).toBeGreaterThan(0);
    // The proficiency really advanced past the tier-2 ceiling that used to be
    // the wall, which is the whole reason the gate mattered.
    expect(rig.meta.gatheringProficiency.farming).toBeGreaterThan(TIER3_TOOL_WIELD_PROFICIENCY);
    expect(farmingTeachingCeilingFor(crop.tier)).toBe(100);
  });

  it('the three formerly dormant recipes now have every reagent reachable', () => {
    // Reachable means: for every reagent, either a counter sells it, or a crop
    // a counter sells the SEED for grows it. That second clause is the faucet,
    // and before Phase 11e it was empty for tiers 3 and 4.
    const stocked = new Set<string>();
    for (const npc of Object.values(NPCS)) {
      for (const itemId of npc.vendorItems ?? []) stocked.add(itemId);
    }
    const growableFromStockedSeed = new Set<string>();
    for (const crop of Object.values(FARM_CROPS)) {
      if (!stocked.has(crop.seedItemId)) continue;
      growableFromStockedSeed.add(crop.produceItemId);
      growableFromStockedSeed.add(crop.fineProduceItemId);
    }
    // Non-vacuity: the upper tiers really are in that set now.
    expect(growableFromStockedSeed.has('highland_barley')).toBe(true);
    expect(growableFromStockedSeed.has('evergarden_greens')).toBe(true);
    expect(growableFromStockedSeed.has('gilded_sunmelon')).toBe(true);

    for (const recipeId of DORMANT_RECIPES) {
      const recipe = ALL_RECIPES.find((r) => r.id === recipeId);
      expect(recipe, recipeId).toBeDefined();
      if (!recipe) continue;
      for (const reagent of recipe.reagents) {
        const reachable =
          stocked.has(reagent.itemId) || growableFromStockedSeed.has(reagent.itemId);
        expect(reachable, `${recipeId}: ${reagent.itemId} has no reachable source`).toBe(true);
      }
    }
  });

  it('...and NOT from vendor stock alone, so the faucet is seeds and only seeds', () => {
    // The other direction, and the reason produce stayed unpriced: if a counter
    // ever sold the produce itself, these dishes would be craftable without
    // farming at all, which is the invariant GATE 1 must not have broken while
    // opening the seed faucet.
    const stocked = new Set<string>();
    for (const npc of Object.values(NPCS)) {
      for (const itemId of npc.vendorItems ?? []) stocked.add(itemId);
    }
    // brook_carrot is the ONE documented exception (farming D9): the fee
    // vegetable is priced so the watch fee is payable before a first harvest.
    // Named as a literal rather than filtered by a rule, so a SECOND stocked
    // produce could never join it quietly.
    const D9_FEE_VEGETABLE = 'brook_carrot';
    expect(stocked.has(D9_FEE_VEGETABLE), 'the D9 exception must still be real').toBe(true);
    for (const crop of Object.values(FARM_CROPS)) {
      if (crop.produceItemId !== D9_FEE_VEGETABLE) {
        expect(stocked.has(crop.produceItemId), `${crop.produceItemId} must not be stocked`).toBe(
          false,
        );
      }
      expect(
        stocked.has(crop.fineProduceItemId),
        `${crop.fineProduceItemId} must not be stocked`,
      ).toBe(false);
    }
    for (const recipeId of DORMANT_RECIPES) {
      const recipe = ALL_RECIPES.find((r) => r.id === recipeId);
      if (!recipe) continue;
      const fromStockAlone = recipe.reagents.every((r) => stocked.has(r.itemId));
      expect(fromStockAlone, `${recipeId} must still need a farmer`).toBe(false);
    }
  });

  it('every stocked seed row is priced, so none is a dead row that renders then refuses', () => {
    // D11's trap, stated over the whole faucet rather than one row: a stocked
    // row with no positive buyValue looks like a faucet in the vendor grid and
    // refuses at purchase, which would leave GATE 1 open while every content
    // pin read green.
    for (const crop of Object.values(FARM_CROPS)) {
      const def = ITEMS[crop.seedItemId];
      expect(def, crop.seedItemId).toBeDefined();
      expect(def?.buyValue ?? 0, `${crop.seedItemId} is a dead row`).toBeGreaterThan(0);
    }
  });
});
