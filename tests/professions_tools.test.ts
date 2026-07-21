import { describe, expect, it } from 'vitest';
import { TOOL_EFFECTS } from '../src/sim/content/professions';
import { GATHER_NODES, ITEMS, NPCS } from '../src/sim/data';
import {
  applyEffectBonus,
  BARE_HANDS_TOOL_TIER,
  bestOwnedAnyGatherToolTier,
  bestOwnedGatherToolTier,
  canGatherTier,
  canHarvestMonsterMaterial,
  depleteEffect,
  gatherToolTier,
  type HarvestOutcome,
  isGatherToolUse,
  isOriginalCrafter,
  rechargeCost,
  rechargeEffect,
  resolveToolEffectUse,
  slotEffect,
} from '../src/sim/professions/tools';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { InvSlot, ItemDef } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

describe('gathering tool tier gating (#1123)', () => {
  it('a tier-1 tool cannot gather a tier-2 or higher node', () => {
    expect(canGatherTier(1, 1)).toBe(true);
    expect(canGatherTier(1, 2)).toBe(false);
    expect(canGatherTier(1, 3)).toBe(false);
  });

  it('a tier-2 tool can gather both tier-1 and tier-2 nodes, but not tier-3', () => {
    expect(canGatherTier(2, 1)).toBe(true);
    expect(canGatherTier(2, 2)).toBe(true);
    expect(canGatherTier(2, 3)).toBe(false);
  });

  it('a tier-3 tool can gather every tier at or below it', () => {
    expect(canGatherTier(3, 1)).toBe(true);
    expect(canGatherTier(3, 2)).toBe(true);
    expect(canGatherTier(3, 3)).toBe(true);
  });

  it('vendor-sold base tools exist for each gathering profession at 3 tiers', () => {
    const mining = [ITEMS.copper_mining_pick, ITEMS.iron_mining_pick, ITEMS.mithril_mining_pick];
    const logging = [ITEMS.handaxe, ITEMS.felling_axe, ITEMS.ironbark_axe];
    const herbalism = [ITEMS.gathering_sickle, ITEMS.bronze_sickle, ITEMS.silverleaf_sickle];
    for (const [profession, tools] of [
      ['mining', mining],
      ['logging', logging],
      ['herbalism', herbalism],
    ] as const) {
      expect(tools.every(Boolean)).toBe(true);
      const tiers = tools.map((item) => gatherToolTier(item, profession));
      expect(tiers).toEqual([1, 2, 3]);
    }
  });

  it('the base tools are actually stocked by Trader Wilkes', () => {
    const stock = NPCS.trader_wilkes.vendorItems ?? [];
    for (const toolId of [
      'copper_mining_pick',
      'iron_mining_pick',
      'mithril_mining_pick',
      'handaxe',
      'felling_axe',
      'ironbark_axe',
      'gathering_sickle',
      'bronze_sickle',
      'silverleaf_sickle',
    ]) {
      expect(stock).toContain(toolId);
    }
  });

  it('a base tool never becomes unusable, because this repo has no durability mechanic', () => {
    const pick = ITEMS.copper_mining_pick;
    // ItemDef (src/sim/types.ts) carries no durability field anywhere in this repo,
    // so simulating repeated gathers cannot reduce or exhaust a tool's usability:
    // there is nothing on the item shape a "gather" could decrement.
    expect(pick).not.toHaveProperty('durability');
    expect(isGatherToolUse(pick.use)).toBe(true);
    for (let i = 0; i < 1000; i++) {
      // Repeated simulated gathers: the item object is never mutated.
      expect(gatherToolTier(pick, 'mining')).toBe(1);
    }
    expect(pick).not.toHaveProperty('durability');
  });

  it('gatherToolTier returns undefined for a non-tool item, a mismatched profession, and a differently-used tool', () => {
    expect(gatherToolTier(ITEMS.worn_sword, 'mining')).toBeUndefined();
    expect(gatherToolTier(ITEMS.copper_mining_pick, 'logging')).toBeUndefined();
    // simple_fishing_pole has kind: 'tool' and a use, but not a gatherTool use,
    // exercising the !isGatherToolUse(item.use) branch specifically.
    expect(isGatherToolUse(ITEMS.simple_fishing_pole.use)).toBe(false);
    expect(gatherToolTier(ITEMS.simple_fishing_pole, 'mining')).toBeUndefined();
  });
});

// Sim-level access gating (Professions 2.0 Phase 12): the gather-node system
// is live, so the old "using a tool is a safe no-op" placeholder pin retired
// into real outcome tests here (its useItem-no-op half re-homed in
// tests/professions_fishing.test.ts beside the rod-cast arm). Owned-best
// resolution scans bags (meta.inventory), no equip slot; bare hands floor to
// tier 1, so only the NEW tier-2+ veins ever gate.
describe('sim-level node access gating (Professions 2.0 Phase 12)', () => {
  const T2_ORE = 'ore_mirefen_t2';
  const T3_ORE = 'ore_thornpeak_t3';
  const T2_WOOD = 'wood_thornpeak_t2';

  function simAtNode(nodeId: string, seed = 42) {
    const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Prospector');
    const node = GATHER_NODES.find((n) => n.id === nodeId);
    if (!node) throw new Error(`missing node ${nodeId}`);
    const p = sim.entities.get(pid);
    if (!p) throw new Error(`missing entity ${pid}`);
    p.pos.x = node.pos.x;
    p.pos.z = node.pos.z;
    p.pos.y = terrainHeight(node.pos.x, node.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    return { sim, pid };
  }

  // Phase 12b: harvestNode starts a gather cast. The unlock arms tick the
  // REAL loop through to the grant (mobs despawned first: mob damage cancels
  // a gather cast), and every deny arm pins that the denial is rng-free AND
  // starts no cast (deny-is-rng-free holds at cast START).
  function despawnMobs(sim: Sim) {
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob') continue;
      e.dead = true;
      e.hp = 0;
      e.aiState = 'dead';
      e.respawnTimer = 9999;
      e.corpseTimer = 9999;
      e.inCombat = false;
    }
  }

  function castAndComplete(sim: Sim, nodeId: string, pid: number): boolean {
    despawnMobs(sim);
    if (!sim.harvestNode(nodeId, pid)) return false;
    const p = sim.entities.get(pid);
    if (!p) throw new Error('missing entity');
    for (let i = 0; i < 80 && p.castingAbility; i++) sim.tick();
    if (p.castingAbility) throw new Error('gather cast never completed');
    sim.tick(); // drain the completion tick's queued proficiency grant
    return true;
  }

  function expectDeniedDrawFreeNoCast(sim: Sim, nodeId: string, pid: number) {
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      expect(sim.harvestNode(nodeId, pid)).toBe(false);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(draws).toBe(0);
    expect(sim.entities.get(pid)?.castingAbility ?? null).toBe(null);
  }

  it('a bare-hands harvest of a tier-2 vein is denied: no rng, no timer, no grant, one exact event', () => {
    const { sim, pid } = simAtNode(T2_ORE);
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing meta');
    const invBefore = JSON.parse(JSON.stringify(meta.inventory));
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      expect(sim.harvestNode(T2_ORE, pid)).toBe(false);
    } finally {
      sim.rng.setObserver(null);
    }
    // The gate is rng-free, sits before both harvest draws, and never
    // starts the Phase 12b gather cast.
    expect(draws).toBe(0);
    expect(sim.entities.get(pid)?.castingAbility ?? null).toBe(null);
    // Exact field shape: text-free, personal, professionId present on the
    // node surface (the fixed Phase 12 interface contract).
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      { type: 'gatherDenied', pid, surface: 'node', professionId: 'mining', requiredTier: 2 },
    ]);
    // The denial never consumed the player's respawn timer or touched bags.
    expect(sim.nodeHarvestableByMeFor(T2_ORE, pid)).toBe(true);
    expect(meta.inventory).toEqual(invBefore);
    expect(sim.countItem('iron_ore', pid)).toBe(0);
  });

  it('the same player with the tier-2 pick in bags harvests the vein (grant lands, timer set)', () => {
    const { sim, pid } = simAtNode(T2_ORE);
    sim.addItem('iron_mining_pick', 1, pid);
    sim.drainEvents();
    expect(castAndComplete(sim, T2_ORE, pid)).toBe(true);
    expect(sim.countItem('iron_ore', pid)).toBeGreaterThanOrEqual(1);
    expect(sim.nodeHarvestableByMeFor(T2_ORE, pid)).toBe(false);
    expect(sim.drainEvents().some((e) => e.type === 'gatherDenied')).toBe(false);
  });

  it('a wrong-profession tool does not unlock a node: the tier-2 axe leaves the ore vein denied', () => {
    const { sim, pid } = simAtNode(T2_ORE);
    sim.addItem('felling_axe', 1, pid); // logging tier 2
    sim.drainEvents();
    expectDeniedDrawFreeNoCast(sim, T2_ORE, pid);
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      { type: 'gatherDenied', pid, surface: 'node', professionId: 'mining', requiredTier: 2 },
    ]);
    // Sanity arm: the same axe DOES unlock a tier-2 wood stand (ticked
    // through the cast to the grant).
    const wood = simAtNode(T2_WOOD);
    wood.sim.addItem('felling_axe', 1, wood.pid);
    expect(castAndComplete(wood.sim, T2_WOOD, wood.pid)).toBe(true);
    expect(wood.sim.countItem('elderwood_log', wood.pid)).toBeGreaterThanOrEqual(1);
  });

  it('owned-best picks the highest tier among multiple owned tools of one profession', () => {
    const { sim, pid } = simAtNode(T3_ORE);
    for (const id of ['copper_mining_pick', 'iron_mining_pick', 'mithril_mining_pick']) {
      sim.addItem(id, 1, pid);
    }
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing meta');
    expect(bestOwnedGatherToolTier(meta.inventory, 'mining', ITEMS)).toBe(3);
    expect(castAndComplete(sim, T3_ORE, pid)).toBe(true);
    expect(sim.countItem('thorium_ore', pid)).toBeGreaterThanOrEqual(1);
  });

  it('an owned tool one tier short still denies, and the event carries the real node tier (3)', () => {
    const { sim, pid } = simAtNode(T3_ORE);
    sim.addItem('iron_mining_pick', 1, pid); // mining tier 2 at a tier-3 vein
    sim.drainEvents();
    expectDeniedDrawFreeNoCast(sim, T3_ORE, pid);
    // requiredTier must be the node's tier, not a constant: every other deny
    // pin in the suite reads 2, so this arm is the guard against a
    // hardcoded-2 (or viewer-tier-plus-1) regression lying in the toast.
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      { type: 'gatherDenied', pid, surface: 'node', professionId: 'mining', requiredTier: 3 },
    ]);
  });

  it('the herbalism arm denies and unlocks through the real harvestNode like the others', () => {
    const T2_HERB = 'herb_mirefen_t2';
    const bare = simAtNode(T2_HERB);
    bare.sim.drainEvents();
    expectDeniedDrawFreeNoCast(bare.sim, T2_HERB, bare.pid);
    expect(bare.sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      {
        type: 'gatherDenied',
        pid: bare.pid,
        surface: 'node',
        professionId: 'herbalism',
        requiredTier: 2,
      },
    ]);
    const tooled = simAtNode(T2_HERB);
    tooled.sim.addItem('bronze_sickle', 1, tooled.pid); // herbalism tier 2
    tooled.sim.drainEvents();
    expect(castAndComplete(tooled.sim, T2_HERB, tooled.pid)).toBe(true);
    expect(tooled.sim.countItem('goldleaf_herb', tooled.pid)).toBeGreaterThanOrEqual(1);
    expect(tooled.sim.drainEvents().some((e) => e.type === 'gatherDenied')).toBe(false);
  });

  it('mixed-profession bags resolve per profession: mining tier 3 never lends logging its tier', () => {
    const { sim, pid } = simAtNode(T2_WOOD);
    sim.addItem('mithril_mining_pick', 1, pid); // mining tier 3
    sim.addItem('handaxe', 1, pid); // logging tier 1
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing meta');
    expect(bestOwnedGatherToolTier(meta.inventory, 'mining', ITEMS)).toBe(3);
    expect(bestOwnedGatherToolTier(meta.inventory, 'logging', ITEMS)).toBe(1);
    sim.drainEvents();
    expectDeniedDrawFreeNoCast(sim, T2_WOOD, pid);
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      { type: 'gatherDenied', pid, surface: 'node', professionId: 'logging', requiredTier: 2 },
    ]);
  });

  it('bestOwnedGatherToolTier: the bare-hands floor, an items-lookup miss, and non-tool slots', () => {
    expect(BARE_HANDS_TOOL_TIER).toBe(1);
    expect(bestOwnedGatherToolTier([], 'mining', ITEMS)).toBe(BARE_HANDS_TOOL_TIER);
    const junk: InvSlot[] = [
      // An id with no ITEMS row (a stale save slot) must fall through, not throw.
      { itemId: 'no_such_item_id', count: 1 },
      { itemId: 'baked_bread', count: 5 },
    ];
    expect(bestOwnedGatherToolTier(junk, 'mining', ITEMS)).toBe(BARE_HANDS_TOOL_TIER);
    const tools: InvSlot[] = [
      { itemId: 'copper_mining_pick', count: 1 },
      { itemId: 'mithril_mining_pick', count: 1 },
      { itemId: 'iron_mining_pick', count: 1 },
    ];
    expect(bestOwnedGatherToolTier(tools, 'mining', ITEMS)).toBe(3);
    expect(bestOwnedGatherToolTier(tools, 'logging', ITEMS)).toBe(BARE_HANDS_TOOL_TIER);
  });

  it('bestOwnedAnyGatherToolTier: the max across every gathering profession, floored at 1', () => {
    expect(bestOwnedAnyGatherToolTier([], ITEMS)).toBe(BARE_HANDS_TOOL_TIER);
    const mixed: InvSlot[] = [
      { itemId: 'handaxe', count: 1 }, // logging 1
      { itemId: 'iron_mining_pick', count: 1 }, // mining 2
    ];
    expect(bestOwnedAnyGatherToolTier(mixed, ITEMS)).toBe(2);
    // Fishing rods are gatherTool items too, so they count for the any-tool max.
    expect(
      bestOwnedAnyGatherToolTier([{ itemId: 'silverstream_fishing_rod', count: 1 }], ITEMS),
    ).toBe(3);
  });

  it('the tiered fishing rods are vendor gatherTool content on the exact pick pricing ladder', () => {
    expect(gatherToolTier(ITEMS.ironreel_fishing_rod, 'fishing')).toBe(2);
    expect(gatherToolTier(ITEMS.silverstream_fishing_rod, 'fishing')).toBe(3);
    expect(ITEMS.ironreel_fishing_rod).toMatchObject({
      kind: 'tool',
      quality: 'common',
      buyValue: 60,
      sellValue: 10,
    });
    expect(ITEMS.silverstream_fishing_rod).toMatchObject({
      kind: 'tool',
      quality: 'uncommon',
      buyValue: 150,
      sellValue: 25,
    });
    // Same ladder as the tier-2/3 picks, by construction not coincidence.
    expect(ITEMS.ironreel_fishing_rod.buyValue).toBe(ITEMS.iron_mining_pick.buyValue);
    expect(ITEMS.silverstream_fishing_rod.buyValue).toBe(ITEMS.mithril_mining_pick.buyValue);
    const stock = NPCS.trader_wilkes.vendorItems ?? [];
    expect(stock).toContain('ironreel_fishing_rod');
    expect(stock).toContain('silverstream_fishing_rod');
    // The simple pole is untouched: not a gatherTool, effective tier 1 via
    // the bare-hands floor (band 0 stays reachable with pole or bare hands).
    expect(ITEMS.simple_fishing_pole.use).toEqual({ type: 'fishing' });
  });
});

describe('crafted higher-tier base tools and monster-material gating (#1135)', () => {
  it('crafted tier-4 and tier-5 tools exist for each gathering profession, never vendor-sold', () => {
    const mining = [ITEMS.thorium_mining_pick, ITEMS.arcanite_mining_pick];
    const logging = [ITEMS.ashwood_axe, ITEMS.elderwood_axe];
    const herbalism = [ITEMS.goldleaf_sickle, ITEMS.sunpetal_sickle];
    const craftedIds = new Set([...mining, ...logging, ...herbalism].map((item) => item.id));
    // Direct scan of every NPC's vendorItems list, not just the buyValue
    // convention: makes the "never vendor-sold" claim self-contained instead
    // of leaning on buyValue and vendorItems always staying in lockstep.
    for (const npc of Object.values(NPCS)) {
      for (const stockedId of npc.vendorItems ?? []) {
        expect(craftedIds.has(stockedId)).toBe(false);
      }
    }
    for (const [profession, tools] of [
      ['mining', mining],
      ['logging', logging],
      ['herbalism', herbalism],
    ] as const) {
      expect(tools.every(Boolean)).toBe(true);
      const tiers = tools.map((item) => gatherToolTier(item, profession));
      expect(tiers).toEqual([4, 5]);
      // Crafted tools are produced by a profession, not bought: no vendor price.
      for (const item of tools) expect(item.buyValue).toBeUndefined();
    }
  });

  it('a tier-3 tool cannot access a tier-4 monster material, a tier-4 tool can', () => {
    expect(canHarvestMonsterMaterial(3, 4)).toBe(false);
    expect(canHarvestMonsterMaterial(4, 4)).toBe(true);
  });

  it('canHarvestMonsterMaterial follows the same at-or-below-tier semantics as canGatherTier', () => {
    for (let toolTier = 1; toolTier <= 5; toolTier++) {
      for (let materialTier = 1; materialTier <= 5; materialTier++) {
        expect(canHarvestMonsterMaterial(toolTier, materialTier)).toBe(
          canGatherTier(toolTier, materialTier),
        );
      }
    }
  });

  it('a crafted tier-4/5 tool gates monster materials the same way a vendor tier-1/2/3 tool gates nodes', () => {
    const thorium = gatherToolTier(ITEMS.thorium_mining_pick, 'mining') ?? -1;
    const arcanite = gatherToolTier(ITEMS.arcanite_mining_pick, 'mining') ?? -1;
    expect(thorium).toBe(4);
    expect(arcanite).toBe(5);
    expect(canHarvestMonsterMaterial(thorium, 3)).toBe(true);
    expect(canHarvestMonsterMaterial(thorium, 4)).toBe(true);
    expect(canHarvestMonsterMaterial(thorium, 5)).toBe(false);
    expect(canHarvestMonsterMaterial(arcanite, 5)).toBe(true);
  });

  it('infinite durability holds for crafted tiers too, not just vendor tiers', () => {
    const crafted: [ItemDef, number][] = [
      [ITEMS.thorium_mining_pick, 4],
      [ITEMS.arcanite_mining_pick, 5],
    ];
    for (const [item, tier] of crafted) {
      expect(item).not.toHaveProperty('durability');
      expect(isGatherToolUse(item.use)).toBe(true);
      for (let i = 0; i < 1000; i++) {
        // Repeated simulated gathers never mutate or exhaust the item.
        expect(gatherToolTier(item, 'mining')).toBe(tier);
      }
      expect(item).not.toHaveProperty('durability');
    }
  });

  it('rarity (quality) is separate from tier and never affects gating, for nodes or monster materials', () => {
    const commonTierThree: ItemDef = {
      id: 'test_common_tier3_pick',
      name: 'Test Common Tier-3 Pick',
      kind: 'tool',
      quality: 'common',
      use: { type: 'gatherTool', professionId: 'mining', tier: 3 },
      sellValue: 1,
    };
    const epicTierThree: ItemDef = {
      id: 'test_epic_tier3_pick',
      name: 'Test Epic Tier-3 Pick',
      kind: 'tool',
      quality: 'epic',
      use: { type: 'gatherTool', professionId: 'mining', tier: 3 },
      sellValue: 1,
    };
    expect(commonTierThree.quality).not.toBe(epicTierThree.quality);
    const commonTier = gatherToolTier(commonTierThree, 'mining') ?? -1;
    const epicTier = gatherToolTier(epicTierThree, 'mining') ?? -1;
    expect(commonTier).toBe(epicTier);
    for (const nodeOrMaterialTier of [1, 2, 3, 4, 5]) {
      expect(canGatherTier(commonTier, nodeOrMaterialTier)).toBe(
        canGatherTier(epicTier, nodeOrMaterialTier),
      );
      expect(canHarvestMonsterMaterial(commonTier, nodeOrMaterialTier)).toBe(
        canHarvestMonsterMaterial(epicTier, nodeOrMaterialTier),
      );
    } // Real vendor (uncommon, tier 3) and crafted (rare, tier 4) tools also
    // carry different rarities: confirm the rarity difference is real, so the
    // tier-only gating check above is meaningful and not vacuously true.
    expect(ITEMS.mithril_mining_pick.quality).toBe('uncommon');
    expect(ITEMS.thorium_mining_pick.quality).toBe('rare');
  });
});

describe('tool effect slotting with durability and depletion (#1136)', () => {
  const baseOutcome: HarvestOutcome = { quantity: 2, quality: 1, respawnTicks: 100 };

  it('a slotted quantity effect bonus applies to the outcome while durability remains', () => {
    const slot = slotEffect('gatherers_cache');
    expect(slot.durability).toBeGreaterThan(0);
    const bonused = applyEffectBonus(slot, baseOutcome);
    expect(bonused.quantity).toBe(baseOutcome.quantity + 1);
    expect(bonused.quality).toBe(baseOutcome.quality);
    expect(bonused.respawnTicks).toBe(baseOutcome.respawnTicks);
    // Pure: the input outcome is never mutated.
    expect(baseOutcome.quantity).toBe(2);
  });

  it('a slotted quality effect bonus applies to the outcome while durability remains', () => {
    const slot = slotEffect('artisans_eye');
    const bonused = applyEffectBonus(slot, baseOutcome);
    expect(bonused.quality).toBe(baseOutcome.quality + 1);
    expect(bonused.quantity).toBe(baseOutcome.quantity);
  });

  it('a slotted respawn-speed effect bonus shortens the respawn timer', () => {
    const slot = slotEffect('quickening_charm');
    const bonused = applyEffectBonus(slot, baseOutcome);
    expect(bonused.respawnTicks).toBe(baseOutcome.respawnTicks - 1);
  });

  it('the bonus no longer applies once durability reaches 0, but the base tool is unaffected', () => {
    const slot = slotEffect('gatherers_cache');
    slot.durability = 0;
    const outcome = applyEffectBonus(slot, baseOutcome);
    expect(outcome).toEqual(baseOutcome);
    // The base tool's own tier/gating never reads the effect slot at all: it
    // keeps working at its tier regardless of the effect's durability.
    expect(canGatherTier(1, 1)).toBe(true);
    expect(gatherToolTier(ITEMS.copper_mining_pick, 'mining')).toBe(1);
  });

  it('applyEffectBonus returns the outcome unchanged when no effect is slotted', () => {
    expect(applyEffectBonus(undefined, baseOutcome)).toEqual(baseOutcome);
  });

  // Tool rarity 'epic' vs target rarity 'rare' is a one-tier gap, which the
  // rarity-scaled consumption curve (#1139) rolls at 60% (see
  // professions_effect_consumption.test.ts for the full curve coverage); used
  // here purely as a non-trivial, non-0/100% probability to exercise the
  // probabilistic depletion mechanics themselves.
  const TOOL_RARITY = 'epic';
  const TARGET_RARITY = 'rare';

  it('depleteEffect decrements durability only on a losing roll, via Rng, deterministically under a fixed seed', () => {
    const runSequence = (seed: number): number[] => {
      const rng = new Rng(seed);
      const slot = slotEffect('gatherers_cache');
      const history: number[] = [];
      for (let i = 0; i < 30; i++) {
        depleteEffect(slot, TOOL_RARITY, TARGET_RARITY, rng);
        history.push(slot.durability);
      }
      return history;
    };
    const a = runSequence(12345);
    const b = runSequence(12345);
    expect(a).toEqual(b);
    // Same starting durability under a different seed can produce a different
    // sequence (the roll is probabilistic), proving depletion is not a flat -1.
    const c = runSequence(99999);
    expect(a).not.toEqual(c);
    // Durability never goes negative across enough uses.
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
    // At a 60% chance, 200 draws almost always exhaust a 20-charge effect.
    const runToZero = (seed: number): number[] => {
      const rng = new Rng(seed);
      const slot = slotEffect('gatherers_cache');
      const history: number[] = [];
      for (let i = 0; i < 200; i++) {
        depleteEffect(slot, TOOL_RARITY, TARGET_RARITY, rng);
        history.push(slot.durability);
      }
      return history;
    };
    expect(runToZero(12345).at(-1)).toBe(0);
  });

  it('depleteEffect is a no-op once durability is already 0', () => {
    const rng = new Rng(1);
    const slot = slotEffect('artisans_eye');
    slot.durability = 0;
    depleteEffect(slot, TOOL_RARITY, TARGET_RARITY, rng);
    expect(slot.durability).toBe(0);
  });

  it('re-slotting an effect resets it to full durability', () => {
    const slot = slotEffect('quickening_charm');
    const rng = new Rng(7);
    for (let i = 0; i < 50; i++) depleteEffect(slot, TOOL_RARITY, TARGET_RARITY, rng);
    expect(slot.durability).toBe(0);
    const fresh = slotEffect('quickening_charm');
    expect(fresh.durability).toBeGreaterThan(0);
  });

  it('depleteEffect always spends a charge against an equal-or-higher rarity target', () => {
    const rng = new Rng(2024);
    const slot = slotEffect('gatherers_cache');
    const before = slot.durability;
    const spent = depleteEffect(slot, 'rare', 'rare', rng);
    expect(spent).toBe(true);
    expect(slot.durability).toBe(before - 1);
  });

  it('slotEffect defaults to always mode', () => {
    expect(slotEffect('gatherers_cache').confirmMode).toBe('always');
  });
});

describe('effect recharge with original-crafter discount (#1137)', () => {
  it('isOriginalCrafter is true only when craftedBy matches the recharger', () => {
    const slot = slotEffect('gatherers_cache', { craftedBy: 'player_alice' });
    expect(isOriginalCrafter(slot, 'player_alice')).toBe(true);
    expect(isOriginalCrafter(slot, 'player_bob')).toBe(false);
    const noIdentity = slotEffect('gatherers_cache');
    expect(isOriginalCrafter(noIdentity, 'player_alice')).toBe(false);
  });

  it('recharging via the original crafter costs strictly less than a generic recharge, in materials and time', () => {
    const original = slotEffect('gatherers_cache', { craftedBy: 'player_alice' });
    const generic = slotEffect('gatherers_cache', { craftedBy: 'player_alice' });
    const costOriginal = rechargeCost(original, 'player_alice');
    const costGeneric = rechargeCost(generic, 'player_bob');
    expect(costOriginal.materials).toBeLessThan(costGeneric.materials);
    expect(costOriginal.ticks).toBeLessThan(costGeneric.ticks);
  });

  it('an effect slotted with no recorded crafter always pays the generic (higher) rate', () => {
    const slot = slotEffect('artisans_eye');
    const cost = rechargeCost(slot, 'player_anyone');
    const genericFromKnownCrafter = rechargeCost(
      slotEffect('artisans_eye', { craftedBy: 'player_alice' }),
      'player_bob',
    );
    expect(cost).toEqual(genericFromKnownCrafter);
  });

  it('a successful recharge restores durability to full and the bonus resumes applying', () => {
    const slot = slotEffect('gatherers_cache', { craftedBy: 'player_alice' });
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) depleteEffect(slot, 'epic', 'rare', rng);
    expect(slot.durability).toBe(0);
    const baseOutcome: HarvestOutcome = { quantity: 2, quality: 1, respawnTicks: 100 };
    expect(applyEffectBonus(slot, baseOutcome)).toEqual(baseOutcome);

    const cost = rechargeCost(slot, 'player_alice');
    const result = rechargeEffect(slot, 'player_alice', cost.materials);
    expect(result.success).toBe(true);
    expect(slot.durability).toBe(20);
    // craftedBy is left untouched by a recharge.
    expect(slot.craftedBy).toBe('player_alice');
    const bonused = applyEffectBonus(slot, baseOutcome);
    expect(bonused.quantity).toBe(baseOutcome.quantity + 1);
  });

  it('a recharge fails, and does not mutate the slot, when insufficient materials are provided', () => {
    const slot = slotEffect('gatherers_cache', { craftedBy: 'player_alice' });
    slot.durability = 0;
    const cost = rechargeCost(slot, 'player_alice');
    const result = rechargeEffect(slot, 'player_alice', cost.materials - 1);
    expect(result.success).toBe(false);
    expect(slot.durability).toBe(0);
  });

  it('the generic recharger still succeeds when providing the (higher) generic cost', () => {
    const slot = slotEffect('quickening_charm', { craftedBy: 'player_alice' });
    slot.durability = 0;
    const cost = rechargeCost(slot, 'player_bob');
    const result = rechargeEffect(slot, 'player_bob', cost.materials);
    expect(result.success).toBe(true);
    expect(slot.durability).toBe(20);
  });
});

describe('always/prompt-on-use confirmation gate (#1138)', () => {
  const baseOutcome: HarvestOutcome = { quantity: 2, quality: 1, respawnTicks: 100 };
  // Same non-trivial, non-0/100% rarity gap used in the #1136 depletion suite
  // above, so the consumption-curve roll being probabilistic here too.
  const TOOL_RARITY = 'epic';
  const TARGET_RARITY = 'rare';

  it("'always' mode is byte-for-byte identical to #1136's baseline behavior, confirmed or not", () => {
    const runOld = (seed: number) => {
      const rng = new Rng(seed);
      const slot = slotEffect('gatherers_cache');
      const history: { outcome: HarvestOutcome; depleted: boolean }[] = [];
      for (let i = 0; i < 30; i++) {
        const outcome = applyEffectBonus(slot, baseOutcome);
        const depleted = depleteEffect(slot, TOOL_RARITY, TARGET_RARITY, rng);
        history.push({ outcome, depleted });
      }
      return { history, finalDurability: slot.durability };
    };
    const runNew = (seed: number, confirmed: boolean) => {
      const rng = new Rng(seed);
      const slot = slotEffect('gatherers_cache', { confirmMode: 'always' });
      const history: { outcome: HarvestOutcome; depleted: boolean }[] = [];
      for (let i = 0; i < 30; i++) {
        const result = resolveToolEffectUse(
          slot,
          baseOutcome,
          TOOL_RARITY,
          TARGET_RARITY,
          rng,
          confirmed,
        );
        expect(result.applied).toBe(true);
        history.push({ outcome: result.outcome, depleted: result.depleted });
      }
      return { history, finalDurability: slot.durability };
    };
    const old1 = runOld(12345);
    expect(runNew(12345, true)).toEqual(old1);
    // confirmed is ignored entirely in 'always' mode: false behaves the same.
    expect(runNew(12345, false)).toEqual(old1);
  });

  it('prompt mode without confirmation applies no bonus and consumes no charge', () => {
    const rng = new Rng(1);
    const slot = slotEffect('gatherers_cache', { confirmMode: 'prompt' });
    const startingDurability = slot.durability;
    const result = resolveToolEffectUse(slot, baseOutcome, TOOL_RARITY, TARGET_RARITY, rng, false);
    expect(result.applied).toBe(false);
    expect(result.depleted).toBe(false);
    expect(result.outcome).toEqual(baseOutcome);
    expect(slot.durability).toBe(startingDurability);
  });

  it('prompt mode with confirmed=true behaves like always mode for that one use', () => {
    const seed = 42;
    const rngPrompt = new Rng(seed);
    const promptSlot = slotEffect('gatherers_cache', { confirmMode: 'prompt' });
    const promptResult = resolveToolEffectUse(
      promptSlot,
      baseOutcome,
      TOOL_RARITY,
      TARGET_RARITY,
      rngPrompt,
      true,
    );

    const rngAlways = new Rng(seed);
    const alwaysSlot = slotEffect('gatherers_cache', { confirmMode: 'always' });
    const alwaysResult = resolveToolEffectUse(
      alwaysSlot,
      baseOutcome,
      TOOL_RARITY,
      TARGET_RARITY,
      rngAlways,
      true,
    );

    expect(promptResult.applied).toBe(true);
    expect(promptResult).toEqual(alwaysResult);
    expect(promptSlot.durability).toBe(alwaysSlot.durability);
  });

  it('repeated unconfirmed prompt uses never deplete the slot, across many draws', () => {
    const rng = new Rng(7);
    const slot = slotEffect('artisans_eye', { confirmMode: 'prompt' });
    for (let i = 0; i < 100; i++) {
      const result = resolveToolEffectUse(
        slot,
        baseOutcome,
        TOOL_RARITY,
        TARGET_RARITY,
        rng,
        false,
      );
      expect(result.applied).toBe(false);
      expect(result.outcome).toEqual(baseOutcome);
    }
    expect(slot.durability).toBe(TOOL_EFFECTS.artisans_eye.startingDurability);
  });

  it('resolveToolEffectUse returns an unapplied no-op when there is no slot at all', () => {
    const rng = new Rng(1);
    expect(
      resolveToolEffectUse(undefined, baseOutcome, TOOL_RARITY, TARGET_RARITY, rng, true),
    ).toEqual({
      outcome: baseOutcome,
      depleted: false,
      applied: false,
    });
  });
});
