// The upper-tier SEED channels (masterwrought Phase 11f, deliverable 5) and
// the identity guard that bounds them.
//
// THE GUARD IS THE POINT OF THIS FILE, and it is the most important thing the
// phase pins. Seeds dropping from endgame content must never make farming's top
// tiers conditional on raiding: farming's whole thesis is that it converts
// logins into progress for a player who keeps no raid schedule. So the drop and
// marks rows this phase adds are ADDITIVE REACH, and that is asserted from both
// sides, which is masterwrought R18 read in the reverse direction:
//
//   (1) every upper-tier seed is obtainable by a character who never enters a
//       raid, a rift or a heroic five-man (the copper counters Phase 11e built),
//       driven through the REAL purchase path rather than read off a list; and
//   (2) the new loot and quartermaster rows actually yield the seed, so the
//       reach is real and not decorative.
//
// Phase 11e owns the copper floor and this phase does not touch it: no vendor
// seed row is added, re-priced or removed here. Arm (1) READS those rows to
// confirm they still hold; tests/farmer_vendor_purchase.test.ts owns their own
// contract.
//
// Every seed set below is DERIVED from FARM_CROPS. A count pasted from a
// document stops spanning its own domain the first time a crop is added, and
// then this suite passes over a seed with no route while still claiming to
// cover every one.
import { describe, expect, it } from 'vitest';
import { FARM_CROPS } from '../src/sim/content/farm_crops';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, MOBS, NPCS } from '../src/sim/data';
import { addRiftClearGearLoot, FARM_RIFT_DROP_ITEM_IDS } from '../src/sim/rift/progression';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';

const upperSeeds = Object.values(FARM_CROPS)
  .filter((crop) => crop.tier >= 3)
  .map((crop) => crop.seedItemId)
  .sort();
const tierFourSeeds = Object.values(FARM_CROPS)
  .filter((crop) => crop.tier === 4)
  .map((crop) => crop.seedItemId)
  .sort();

describe('THE IDENTITY GUARD: farming never becomes conditional on raiding', () => {
  it('every upper-tier seed is BUYABLE for copper by a character who never raids', () => {
    // Driven through the real vendor purchase, at a farmer counter, with no
    // instance ever entered: this is the arm that would fail if a later phase
    // "cleaned up" a copper row now that the marks counter carries one too.
    expect(upperSeeds.length, 'the sweep must run over a non-empty set').toBe(8);
    const farmerCounters = Object.values(NPCS).filter((npc) => npc.vendorItems?.length);
    const stockedAnywhere = new Set(farmerCounters.flatMap((npc) => npc.vendorItems ?? []));
    for (const seedId of upperSeeds) {
      expect(stockedAnywhere.has(seedId), `${seedId} has no copper counter`).toBe(true);
      const def = ITEMS[seedId];
      // D11: a stocked row without a positive buyValue renders and then
      // refuses, which is the trap that makes "stocked" and "purchasable"
      // different claims.
      expect(typeof def.buyValue, `${seedId} buyValue`).toBe('number');
      expect(def.buyValue, `${seedId} must carry a positive copper price`).toBeGreaterThan(0);
    }
  });

  it('buys one for copper end to end, with no instance entered and no marks held', () => {
    const sim = new Sim({ seed: 21, playerClass: 'warrior' });
    const pid = sim.playerId;
    const meta = (sim as unknown as { players: Map<number, { copper: number }> }).players.get(
      pid,
    ) as { copper: number };
    meta.copper = 100_000;
    const seedId = upperSeeds[0];
    const vendor = Object.values(NPCS).find((npc) => npc.vendorItems?.includes(seedId));
    expect(vendor, `${seedId} has no stocking NPC`).toBeDefined();
    const npcEntity = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === vendor?.id,
    ) as Entity;
    expect(npcEntity, `${vendor?.id} is not placed in the world`).toBeDefined();
    const player = sim.entities.get(pid) as Entity;
    player.pos.x = npcEntity.pos.x;
    player.pos.z = npcEntity.pos.z;
    player.pos.y = npcEntity.pos.y;
    player.prevPos = { ...player.pos };
    sim.rebucket(player);
    sim.drainEvents();

    const before = sim.countItem(seedId, pid);
    sim.buyItem(npcEntity.id, seedId, undefined, pid);
    expect(sim.countItem(seedId, pid), `${seedId} purchase`).toBe(before + 1);
    // The whole claim, stated: this character holds zero Heroic Marks and has
    // entered no instance, and still walked away with an upper-tier seed.
    expect(sim.countItem('heroic_mark', pid)).toBe(0);
    // CLAIMED instances, not the pre-created slot roster: a slot exists from
    // world build, a CLAIM is what "entered a dungeon" actually means, and it
    // is the same predicate rollLoot's heroic arm resolves.
    expect(sim.instances.filter((i) => i.partyKey !== null)).toEqual([]);
    expect(sim.riftInstances.filter((i) => i.partyKey !== null)).toEqual([]);
  });

  it('the drop and marks rows YIELD the seed, so the added reach is real', () => {
    // Arm (2). Without this the guard above would pass over channels that
    // exist on paper and shed nothing.
    const raidSeedEntries = MOBS.nythraxis_scourge_of_thornpeak.loot.filter(
      (entry) => entry.rollGroup === 'nythraxis_farm' && ITEMS[entry.itemId ?? '']?.kind === 'junk',
    );
    expect(raidSeedEntries.map((e) => e.itemId).sort()).toEqual(tierFourSeeds);

    const riftSeeds = (FARM_RIFT_DROP_ITEM_IDS as readonly string[]).filter(
      (id) => ITEMS[id]?.kind === 'junk',
    );
    expect([...riftSeeds].sort()).toEqual(upperSeeds);

    const marksSeeds = HEROIC_VENDOR_STOCK.map((o) => o.itemId).filter((id) =>
      upperSeeds.includes(id),
    );
    expect([...marksSeeds].sort()).toEqual(upperSeeds);

    // And the rift arm really pays them out, not just lists them: a bounded
    // deterministic sweep over winning clears must see every seed land.
    const seen = new Set<string>();
    for (let s = 1; s <= 5000; s++) {
      const boss = { loot: { copper: 0, items: [] }, lootable: false } as unknown as Entity;
      const ctx = { rng: new Rng(s) } as unknown as SimContext;
      addRiftClearGearLoot(ctx, boss, 25);
      for (const slot of boss.loot?.items ?? []) {
        if (slot.itemId && upperSeeds.includes(slot.itemId)) seen.add(slot.itemId);
      }
    }
    expect([...seen].sort(), 'every upper seed must be reachable through the rift pick').toEqual(
      upperSeeds,
    );
  });

  it('keeps the seeds tradable and market-listable, never soulbound endgame currency', () => {
    // The other half of not making farming raid-conditional: a raider who
    // pulls a seed can sell it to a farmer who never raids, so the drop feeds
    // the same economy the counters do.
    for (const seedId of upperSeeds) {
      const def = ITEMS[seedId];
      expect(def.kind, seedId).toBe('junk');
      expect(def.soulbound ?? false, `${seedId} must stay tradable`).toBe(false);
      expect(def.noMarketList ?? false, `${seedId} must stay listable`).toBe(false);
    }
  });

  it('masterwrought R18: every farm PRODUCE item stays market-listable junk, never a slot tax', () => {
    // masterwrought R18 read at its own level: professions are needed through
    // their OUTPUT, never through a character slot, and the mechanical form of
    // that is that a raider buys grain the way a raider already buys an herb.
    // Produce that went soulbound or unlistable would make farming the only
    // route to its own output, which is the compulsion this rule forbids.
    const produce = Object.values(FARM_CROPS).flatMap((crop) => [
      crop.produceItemId,
      crop.fineProduceItemId,
    ]);
    expect(produce.length, 'the produce family').toBeGreaterThanOrEqual(24);
    for (const id of produce) {
      const def = ITEMS[id];
      expect(def, id).toBeDefined();
      expect(def.kind, id).toBe('junk');
      expect(def.soulbound ?? false, `${id} must stay tradable`).toBe(false);
      expect(def.noMarketList ?? false, `${id} must stay listable`).toBe(false);
    }
  });

  it('masterwrought R18: the tier 1 and 2 seeds stay vendor-stocked, so the on-ramp never needs the endgame', () => {
    const starterSeeds = Object.values(FARM_CROPS)
      .filter((crop) => crop.tier <= 2)
      .map((crop) => crop.seedItemId);
    expect(starterSeeds.length, 'the starter seeds').toBeGreaterThan(0);
    const stocked = new Set(Object.values(NPCS).flatMap((npc) => npc.vendorItems ?? []));
    for (const id of starterSeeds) {
      expect(stocked.has(id), `${id} must stay on a counter`).toBe(true);
      expect(ITEMS[id].buyValue, `${id} price`).toBeGreaterThan(0);
    }
  });

  it('masterwrought R18 and D24: farming rows are ADDED beside the herb line, never substituted for it', () => {
    // The displacement guardrail, in the one form that actually bites: every
    // shipped herb must still have a live consumer. A phase that "made room"
    // for produce by pulling an herb out of a bill would strand that herb with
    // no buyer, which is precisely what herbalism must never lose. Derived
    // from the item catalog, so a new herb joins the claim by existing.
    // BASE herbs only, and the exclusion is a FINDING recorded rather than a
    // convenience: the three fine_* herb twins have no recipe consumer at all
    // on the merged tree today, which predates this phase and is farming's
    // own fine-twin question, not a displacement caused here. Scoping to the
    // base line keeps the arm about what masterwrought R18 protects; widening it would red
    // on inherited state and teach the next reader to loosen it.
    const herbIds = Object.keys(ITEMS).filter(
      (id) => id.endsWith('_herb') && !id.startsWith('fine_'),
    );
    expect(herbIds.length, 'the base herb line').toBeGreaterThanOrEqual(3);
    for (const id of herbIds) {
      const consumers = ALL_RECIPES.filter((r) => r.reagents.some((g) => g.itemId === id));
      expect(consumers.length, `${id} lost every consumer`).toBeGreaterThan(0);
    }
    // And the alchemy line specifically: every alchemy recipe that consumes
    // farm output must ALSO still consume an herb, so produce joined the bill
    // rather than replacing what was there.
    const herbSet = new Set(herbIds);
    const farmIds = new Set(
      Object.values(FARM_CROPS).flatMap((crop) => [
        crop.seedItemId,
        crop.produceItemId,
        crop.fineProduceItemId,
      ]),
    );
    const alchemyWithFarm = ALL_RECIPES.filter(
      (r) => r.professionId === 'alchemy' && r.reagents.some((g) => farmIds.has(g.itemId)),
    );
    for (const recipe of alchemyWithFarm) {
      expect(
        recipe.reagents.some((g) => herbSet.has(g.itemId)),
        `${recipe.id} took farm output without keeping an herb`,
      ).toBe(true);
    }
  });

  it('adds no vendor row and no copper price of its own: Phase 11e owns the floor', () => {
    // A confirmation arm, not a re-derivation. The two farmers' upper-seed
    // stock is 11e's deliverable and this phase must leave it exactly as found,
    // so the shape is pinned here as a literal the phase did not author: four
    // tier-3 seeds at Hollis and four tier-4 at Verbena, at the two derived
    // price points.
    const hollis = NPCS.farmer_hollis?.vendorItems ?? [];
    const verbena = NPCS.farmer_verbena?.vendorItems ?? [];
    const tierThree = Object.values(FARM_CROPS)
      .filter((crop) => crop.tier === 3)
      .map((crop) => crop.seedItemId);
    for (const id of tierThree) expect(hollis, `${id} at farmer_hollis`).toContain(id);
    for (const id of tierFourSeeds) expect(verbena, `${id} at farmer_verbena`).toContain(id);
    for (const id of tierThree) expect(ITEMS[id].buyValue, `${id} tier-3 price`).toBe(32);
    for (const id of tierFourSeeds) expect(ITEMS[id].buyValue, `${id} tier-4 price`).toBe(64);
  });
});
