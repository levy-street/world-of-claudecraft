import { describe, expect, it } from 'vitest';
import { DELVE_SHOPS } from '../src/sim/content/delves/shop';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { TOOL_EFFECT_IDS, TOOL_EFFECTS } from '../src/sim/content/professions';
import { VENDOR_ROW_GATES } from '../src/sim/content/vendor_row_gates';
import { GATHER_NODES, ITEMS, NPCS } from '../src/sim/data';
import { rodTierRequiredForZone } from '../src/sim/professions/fishing_zones';
import { MATERIAL_GRADES, yieldsFineGrade } from '../src/sim/professions/material_grades';
import {
  applyEffectBonus,
  applyToolEffectUse,
  BARE_HANDS_TOOL_TIER,
  bestOwnedAnyGatherToolTier,
  bestOwnedGatherToolFor,
  bestOwnedGatherToolTier,
  bestOwnedGatherToolTierOrNone,
  canGatherTier,
  canHarvestMonsterMaterial,
  depleteEffect,
  gatherToolTier,
  type HarvestOutcome,
  hasFishingImplement,
  isGatherToolUse,
  isOriginalCrafter,
  NO_TOOL_OWNED,
  RARITY_DURABILITY_BONUS,
  rarityLadderIndex,
  rarityRungForMaxDurability,
  ratchetCeilingForUse,
  resolveRechargeToolEffect,
  slotEffect,
  startingDurabilityFor,
} from '../src/sim/professions/tools';
import { wieldRequirementForTier } from '../src/sim/professions/wield_gate';
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

  it('the zone 1 hub stocks the tier-1 implements and NOT the rungs above them', () => {
    // Re-minted when Eastbrook stopped over-stocking. Wilkes used to carry the
    // whole nine-tool ladder, which put the top land tool of every trade on
    // the starting town's front counter; Eastbrook is entirely tier-1 ground,
    // so the higher rungs open nothing here and now live at the hubs whose own
    // veins need them (the arm below pins those). The tier-1 rows staying is
    // the load-bearing half: they are what the #2343 always-need-a-tool rule
    // and the gather quests' 20-copper story rest on.
    const eastbrook = [
      ...(NPCS.trader_wilkes.vendorItems ?? []),
      ...(NPCS.forgemistress_darva.vendorItems ?? []),
      ...(NPCS.weaver_ottilie.vendorItems ?? []),
      ...(NPCS.tinker_gizzel.vendorItems ?? []),
    ];
    for (const toolId of ['copper_mining_pick', 'handaxe', 'gathering_sickle']) {
      expect(eastbrook, `${toolId} must stay buyable in the first zone`).toContain(toolId);
    }
    for (const toolId of [
      'iron_mining_pick',
      'mithril_mining_pick',
      'felling_axe',
      'ironbark_axe',
      'bronze_sickle',
      'silverleaf_sickle',
    ]) {
      expect(eastbrook, `${toolId} is above Eastbrook's own node tier`).not.toContain(toolId);
    }
    // Wilkes keeps the WHOLE rod ladder as the one buy-ahead counter (R20):
    // fishing water has a tier of its own (professions/fishing_zones.ts), and
    // the hubs each stock the rung their own water needs (pinned below).
    expect(NPCS.trader_wilkes.vendorItems).toContain('ironreel_fishing_rod');
    expect(NPCS.trader_wilkes.vendorItems).toContain('silverstream_fishing_rod');
  });

  it('the zone 2 and zone 3 hubs stock the tool tiers their own nodes use (#2343)', () => {
    // Load-bearing content under the always-require-tool rule: without these
    // rows a toolless traveler could not gather anywhere outside Eastbrook.
    // The two ROD rows are load-bearing the same way (the no-strand story in
    // docs/design/professions-tuning-packet.md): each hub's own water demands that rung
    // (professions/fishing_zones.ts), so without the row the marsh or the
    // peaks would be the one place demanding a tool no local counter carries.
    // They are pinned HERE because two stale comments used to invite exactly
    // their deletion.
    const fenbridge = NPCS.provisioner_hale.vendorItems ?? [];
    for (const toolId of [
      'copper_mining_pick',
      'iron_mining_pick',
      'handaxe',
      'felling_axe',
      'gathering_sickle',
      'bronze_sickle',
      'ironreel_fishing_rod',
    ]) {
      expect(fenbridge).toContain(toolId);
    }
    const highwatch = NPCS.quartermaster_bree.vendorItems ?? [];
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
      'silverstream_fishing_rod',
    ]) {
      expect(highwatch).toContain(toolId);
    }
    // Cross-pin the no-strand story itself: the rod each hub stocks must
    // satisfy its own zone's water. The row pins above and the tier table in
    // tests/fishing_zones.test.ts were two independent literals a coordinated
    // retune could strand with both files green; this line ties them.
    for (const [rodId, zoneId] of [
      ['ironreel_fishing_rod', 'mirefen_marsh'],
      ['silverstream_fishing_rod', 'thornpeak_heights'],
    ] as const) {
      const use = ITEMS[rodId].use;
      if (!isGatherToolUse(use)) throw new Error(`${rodId} is not a gather tool`);
      expect(use.tier, `${rodId} covers ${zoneId}`).toBeGreaterThanOrEqual(
        rodTierRequiredForZone(zoneId),
      );
    }
  });

  it('the tier-1 implements are the 20-copper starter purchase the #2343 rule leans on', () => {
    // The rule's no-strand story (the guide's gatherIntro and toolsNote copy:
    // "20 copper at any zone hub") needs the entry tools to STAY trivial
    // one-time purchases. Literal buyValue pins so a price rebalance must
    // consciously touch this claim rather than drift past it.
    for (const toolId of [
      'copper_mining_pick',
      'handaxe',
      'gathering_sickle',
      'simple_fishing_pole',
    ] as const) {
      expect(ITEMS[toolId]?.buyValue, toolId).toBe(20);
    }
  });

  it('the tier-2 and tier-3 land tools are the 120 and 400 rungs above that', () => {
    // Literal pins for the same reason as the 20 above, and the gap they close
    // is real: every other assertion about these prices is either a
    // self-comparison against the def or a one-sided inequality, so raising
    // 120 to 200 and 400 to 900 leaves the whole suite green. The wiki tool
    // ladder regenerates from these defs and republishes them, so a silent
    // reprice ships as published copy.
    for (const toolId of ['iron_mining_pick', 'felling_axe', 'bronze_sickle'] as const) {
      expect(ITEMS[toolId]?.buyValue, toolId).toBe(120);
    }
    for (const toolId of ['mithril_mining_pick', 'ironbark_axe', 'silverleaf_sickle'] as const) {
      expect(ITEMS[toolId]?.buyValue, toolId).toBe(400);
    }
    // The ladder is monotone, and each rung is strictly above the one below:
    // an ordering regression that kept all three literals would be a different
    // bug, and this is the arm that would still catch it.
    expect(ITEMS.copper_mining_pick.buyValue).toBeLessThan(
      ITEMS.iron_mining_pick.buyValue as number,
    );
    expect(ITEMS.iron_mining_pick.buyValue).toBeLessThan(
      ITEMS.mithril_mining_pick.buyValue as number,
    );
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

// The toolless-state helpers behind the #2343 RuneScape rule (bare hands
// never gather a node, casting a line always needs tackle). Pure bag scans,
// distinct from the floored bestOwnedGatherToolTier that corpse harvesting
// and fishing synergy keep.
describe('toolless-state helpers (#2343)', () => {
  it('NO_TOOL_OWNED is 0, distinct from the bare-hands floor of 1', () => {
    expect(NO_TOOL_OWNED).toBe(0);
    expect(NO_TOOL_OWNED).not.toBe(BARE_HANDS_TOOL_TIER);
  });

  it('bestOwnedGatherToolTierOrNone reports 0 for empty bags and the best owned tier otherwise', () => {
    expect(bestOwnedGatherToolTierOrNone([], 'mining', ITEMS)).toBe(NO_TOOL_OWNED);
    const copper: InvSlot[] = [{ itemId: 'copper_mining_pick', count: 1 }];
    expect(bestOwnedGatherToolTierOrNone(copper, 'mining', ITEMS)).toBe(1);
    const copperAndMithril: InvSlot[] = [
      { itemId: 'copper_mining_pick', count: 1 },
      { itemId: 'mithril_mining_pick', count: 1 },
    ];
    expect(bestOwnedGatherToolTierOrNone(copperAndMithril, 'mining', ITEMS)).toBe(3);
    // A wrong-profession tool never counts: the picks lend logging nothing,
    // and unlike the floored helper the answer is "none", not tier 1.
    expect(bestOwnedGatherToolTierOrNone(copperAndMithril, 'logging', ITEMS)).toBe(NO_TOOL_OWNED);
  });

  it('hasFishingImplement accepts the simple pole and the tiered rods, never tackle-free bags', () => {
    expect(hasFishingImplement([], ITEMS)).toBe(false);
    // use.type 'fishing' (the pole) and a fishing-profession gatherTool (a
    // tiered rod) both satisfy the implement gate.
    expect(hasFishingImplement([{ itemId: 'simple_fishing_pole', count: 1 }], ITEMS)).toBe(true);
    expect(hasFishingImplement([{ itemId: 'ironreel_fishing_rod', count: 1 }], ITEMS)).toBe(true);
    // Derived over EVERY fishing implement the world ships, so a new rod
    // cannot arrive outside this gate by simply not being listed here.
    const tackle = Object.values(ITEMS).filter(
      (def) =>
        def.use?.type === 'fishing' ||
        (def.use?.type === 'gatherTool' && def.use.professionId === 'fishing'),
    );
    expect(tackle.length).toBe(5); // the pole plus four tiered rods
    for (const def of tackle) {
      expect(hasFishingImplement([{ itemId: def.id, count: 1 }], ITEMS), def.id).toBe(true);
    }
    // A non-fishing gatherTool is not tackle.
    expect(hasFishingImplement([{ itemId: 'copper_mining_pick', count: 1 }], ITEMS)).toBe(false);
  });
});

// Sim-level access gating (Professions 2.0): the gather-node system
// is live, so the old "using a tool is a safe no-op" placeholder pin retired
// into real outcome tests here (its useItem-no-op half re-homed in
// tests/professions_fishing.test.ts beside the rod-cast arm). Owned-best
// resolution scans bags (meta.inventory), no equip slot. Since #2343 (the
// RuneScape rule) bare hands never harvest a node, so EVERY node tier gates:
// a tier-1 vein needs a tier-1 tool, and requiredTier 1 on the denial means
// "no tool owned at all".
describe('sim-level node access gating (Professions 2.0)', () => {
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

  // Since R22 a tier-2+ land tool also has to WIELD: it sits inert until its
  // own profession counter reaches the requirement. Every rig below that
  // expects a granted tool to WORK raises that counter to the tool's own
  // requirement, derived from the def rather than a bare number, so a fixture
  // swapped to another tier stays honest. Rods are exempt from the gate.
  function makeWieldable(sim: Sim, pid: number, toolId: string) {
    const use = ITEMS[toolId]?.use;
    if (use?.type !== 'gatherTool' || use.professionId === 'fishing') return;
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing meta');
    meta.gatheringProficiency[use.professionId] = wieldRequirementForTier(use.tier);
  }

  // harvestNode starts a gather cast. The unlock arms tick the
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
    if (!sim.harvestNode(nodeId, undefined, pid)) return false;
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
      expect(sim.harvestNode(nodeId, undefined, pid)).toBe(false);
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
      expect(sim.harvestNode(T2_ORE, undefined, pid)).toBe(false);
    } finally {
      sim.rng.setObserver(null);
    }
    // The gate is rng-free, sits before both harvest draws, and never
    // starts the gather cast.
    expect(draws).toBe(0);
    expect(sim.entities.get(pid)?.castingAbility ?? null).toBe(null);
    // Exact field shape: text-free, personal, professionId present on the
    // node surface (the fixed interface contract).
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      { type: 'gatherDenied', pid, surface: 'node', professionId: 'mining', requiredTier: 2 },
    ]);
    // The denial never consumed the player's respawn timer or touched bags.
    expect(sim.nodeHarvestableByMeFor(T2_ORE, pid)).toBe(true);
    expect(meta.inventory).toEqual(invBefore);
    expect(sim.countItem('iron_ore', pid)).toBe(0);
  });

  it('#2343: a bare-hands harvest of a TIER-1 vein is denied too, requiredTier 1 meaning no tool owned', () => {
    const T1_ORE = 'ore_eastbrook_1';
    const { sim, pid } = simAtNode(T1_ORE);
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing meta');
    const invBefore = JSON.parse(JSON.stringify(meta.inventory));
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      expect(sim.harvestNode(T1_ORE, undefined, pid)).toBe(false);
    } finally {
      sim.rng.setObserver(null);
    }
    // Same rng-free, cast-free denial contract as the tier-2+ arms: the new
    // rule reuses the one tool gate, it does not add a second code path.
    expect(draws).toBe(0);
    expect(sim.entities.get(pid)?.castingAbility ?? null).toBe(null);
    // requiredTier is the node's tier (1): on a tier-1 node the toast reads
    // as "no tool owned", never a tier shortfall.
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      { type: 'gatherDenied', pid, surface: 'node', professionId: 'mining', requiredTier: 1 },
    ]);
    // The denial never consumed the player's respawn timer or touched bags.
    expect(sim.nodeHarvestableByMeFor(T1_ORE, pid)).toBe(true);
    expect(meta.inventory).toEqual(invBefore);
    expect(sim.countItem('copper_ore', pid)).toBe(0);
  });

  it('#2343: the copper (tier-1) pick in bags unlocks the same tier-1 vein (grant lands, timer set)', () => {
    const T1_ORE = 'ore_eastbrook_1';
    const { sim, pid } = simAtNode(T1_ORE);
    sim.addItem('copper_mining_pick', 1, pid);
    sim.drainEvents();
    expect(castAndComplete(sim, T1_ORE, pid)).toBe(true);
    expect(sim.countItem('copper_ore', pid)).toBeGreaterThanOrEqual(1);
    expect(sim.nodeHarvestableByMeFor(T1_ORE, pid)).toBe(false);
    expect(sim.drainEvents().some((e) => e.type === 'gatherDenied')).toBe(false);
  });

  it('the same player with the tier-2 pick in bags harvests the vein (grant lands, timer set)', () => {
    const { sim, pid } = simAtNode(T2_ORE);
    sim.addItem('iron_mining_pick', 1, pid);
    makeWieldable(sim, pid, 'iron_mining_pick'); // the tool must wield (R22)
    sim.drainEvents();
    expect(castAndComplete(sim, T2_ORE, pid)).toBe(true);
    expect(sim.countItem('iron_ore', pid)).toBeGreaterThanOrEqual(1);
    expect(sim.nodeHarvestableByMeFor(T2_ORE, pid)).toBe(false);
    expect(sim.drainEvents().some((e) => e.type === 'gatherDenied')).toBe(false);
  });

  it('a wrong-profession tool does not unlock a node: the tier-2 axe leaves the ore vein denied', () => {
    const { sim, pid } = simAtNode(T2_ORE);
    sim.addItem('felling_axe', 1, pid); // logging tier 2
    // The axe must wield (R22) here too: an inert axe would leave the ore vein
    // denied for the wrong reason, and the case is about the PROFESSION.
    makeWieldable(sim, pid, 'felling_axe');
    sim.drainEvents();
    expectDeniedDrawFreeNoCast(sim, T2_ORE, pid);
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      { type: 'gatherDenied', pid, surface: 'node', professionId: 'mining', requiredTier: 2 },
    ]);
    // Sanity arm: the same axe DOES unlock a tier-2 wood stand (ticked
    // through the cast to the grant).
    const wood = simAtNode(T2_WOOD);
    wood.sim.addItem('felling_axe', 1, wood.pid);
    makeWieldable(wood.sim, wood.pid, 'felling_axe'); // the tool must wield (R22)
    expect(castAndComplete(wood.sim, T2_WOOD, wood.pid)).toBe(true);
    expect(wood.sim.countItem('elderwood_log', wood.pid)).toBeGreaterThanOrEqual(1);
  });

  it('owned-best picks the highest tier among multiple owned tools of one profession', () => {
    const { sim, pid } = simAtNode(T3_ORE);
    for (const id of ['copper_mining_pick', 'iron_mining_pick', 'mithril_mining_pick']) {
      sim.addItem(id, 1, pid);
    }
    // The best of the three (the tier-3 pick) must wield (R22) for it to be the
    // one that opens the tier-3 vein below.
    makeWieldable(sim, pid, 'mithril_mining_pick');
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
    makeWieldable(tooled.sim, tooled.pid, 'bronze_sickle'); // the tool must wield (R22)
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
    // ACCEPTED CONSEQUENCE, pinned so it is a decision rather than a surprise:
    // this is the CORPSE-harvest gate's input, and it deliberately reads any
    // gathering tool, so the crafted rods raise what their owner can recover
    // from a corpse to tier 4 and tier 5. That follows the shipped rule (a
    // monster material has no owning profession, so any tool counts), and the
    // rods that reach it are a trainer-taught craft off a Thornpeak-gated
    // catch rather than a counter purchase.
    expect(bestOwnedAnyGatherToolTier([{ itemId: 'stormreel_fishing_rod', count: 1 }], ITEMS)).toBe(
      4,
    );
    expect(
      bestOwnedAnyGatherToolTier([{ itemId: 'tidewrought_fishing_rod', count: 1 }], ITEMS),
    ).toBe(5);
  });

  it('the tiered fishing rods are vendor gatherTool content, now off the pick pricing ladder', () => {
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
    // The rods and the picks USED to share one ladder by construction. They no
    // longer do, and the divergence is the assertion: the land tools were
    // repriced to 120 and 400 alongside the proficiency gate that paces the
    // node ladder they open, and the reason to raise a price there is the node
    // ladder itself, which fishing has none of. Rod pricing is the fishing
    // work's to move, not this one's, so the rods held at 60 and 150. Pinned
    // as a strict inequality rather than left implicit, so a later change that
    // silently re-couples them has to say so here.
    expect(ITEMS.ironreel_fishing_rod.buyValue).toBeLessThan(
      ITEMS.iron_mining_pick.buyValue as number,
    );
    expect(ITEMS.silverstream_fishing_rod.buyValue).toBeLessThan(
      ITEMS.mithril_mining_pick.buyValue as number,
    );
    // The rods are ungated for the same reason (content/vendor_row_gates.ts).
    expect(VENDOR_ROW_GATES.ironreel_fishing_rod).toBeUndefined();
    expect(VENDOR_ROW_GATES.silverstream_fishing_rod).toBeUndefined();
    const stock = NPCS.trader_wilkes.vendorItems ?? [];
    expect(stock).toContain('ironreel_fishing_rod');
    expect(stock).toContain('silverstream_fishing_rod');
    // The simple pole is untouched: not a gatherTool, effective tier 1 via
    // the bare-hands floor once it satisfies the #2343 implement gate (so a
    // pole in bags never changes any draw or catch sequence).
    expect(ITEMS.simple_fishing_pole.use).toEqual({ type: 'fishing' });
  });
});

describe('the one rarity ladder both bonuses read', () => {
  const bag = (...itemIds: string[]): InvSlot[] => itemIds.map((itemId) => ({ itemId, count: 1 }));

  it('indexes the ladder from common, and floors every off-ladder quality at it', () => {
    expect(rarityLadderIndex('common')).toBe(0);
    expect(rarityLadderIndex('uncommon')).toBe(1);
    expect(rarityLadderIndex('rare')).toBe(2);
    expect(rarityLadderIndex('epic')).toBe(3);
    expect(rarityLadderIndex('legendary')).toBe(4);
    // The two inputs a real def can present that are not on the ladder. Both
    // used to come back -1, which SUBTRACTED a rung from every consumer.
    expect(rarityLadderIndex('poor')).toBe(0);
    expect(rarityLadderIndex(undefined)).toBe(0);
  });

  it('pins the charge rung to a literal, so both sides cannot move together', () => {
    // Without this, every assertion phrased as `epic - common === BONUS * 3` is
    // a constant-self-comparison: changing 10 to 25 moves both sides and the
    // suite stays green. The reel-window constant is pinned the same way, via
    // the literal tick widths in tests/gathering_rhythm.test.ts.
    expect(RARITY_DURABILITY_BONUS).toBe(10);
  });

  it('the floor is load-bearing for charges, not just for the reel window', () => {
    // The same -1 would have minted a poor-quality tool's slot with FEWER
    // charges than a common one's. Asserted through the real consumer so the
    // floor cannot be removed from the ladder and left passing here.
    const common = startingDurabilityFor('gatherers_cache', 'common');
    expect(
      startingDurabilityFor('gatherers_cache', 'poor' as never),
      'a poor tool must not mint fewer charges than a common one',
    ).toBe(common);
    expect(startingDurabilityFor('gatherers_cache', 'epic')).toBe(
      common + RARITY_DURABILITY_BONUS * 3,
    );
  });

  it('resolves the best owned tool by TIER first, with rarity only as the tie-break', () => {
    // Tidewrought is tier 5 epic, stormreel tier 4 rare. Tier must win even
    // though both axes agree here, which is why the synthetic case below
    // exists.
    expect(bestOwnedGatherToolFor(bag('stormreel_fishing_rod'), 'fishing', ITEMS)).toEqual({
      tier: 4,
      ownedTier: 4,
      rarity: 'rare',
    });
    expect(
      bestOwnedGatherToolFor(
        bag('tidewrought_fishing_rod', 'stormreel_fishing_rod'),
        'fishing',
        ITEMS,
      ),
    ).toEqual({ tier: 5, ownedTier: 5, rarity: 'epic' });
    // Bag ORDER must not decide it: the same two rods the other way round.
    expect(
      bestOwnedGatherToolFor(
        bag('stormreel_fishing_rod', 'tidewrought_fishing_rod'),
        'fishing',
        ITEMS,
      ),
    ).toEqual({ tier: 5, ownedTier: 5, rarity: 'epic' });
  });

  it('prefers the higher tier even when the lower one is rarer', () => {
    // No shipped pair inverts the two axes, so this is the only way to show
    // tier is read FIRST rather than the comparison merely agreeing with
    // rarity everywhere. A local registry, never a mutation of ITEMS.
    const items: Record<string, ItemDef> = {
      plain_high: {
        id: 'plain_high',
        name: 'Plain High Pick',
        kind: 'tool',
        quality: 'common',
        use: { type: 'gatherTool', professionId: 'mining', tier: 5 },
        sellValue: 1,
      },
      shiny_low: {
        id: 'shiny_low',
        name: 'Shiny Low Pick',
        kind: 'tool',
        quality: 'legendary',
        use: { type: 'gatherTool', professionId: 'mining', tier: 2 },
        sellValue: 1,
      },
    };
    expect(bestOwnedGatherToolFor(bag('shiny_low', 'plain_high'), 'mining', items)).toEqual({
      tier: 5,
      ownedTier: 5,
      rarity: 'common',
    });
    // And WITHIN one tier, the rarer copy wins, which is the tie-break arm.
    const sameTier: Record<string, ItemDef> = {
      a: { ...items.plain_high, id: 'a' },
      b: {
        ...items.plain_high,
        id: 'b',
        quality: 'epic',
      },
    };
    expect(bestOwnedGatherToolFor(bag('a', 'b'), 'mining', sameTier).rarity).toBe('epic');
    expect(bestOwnedGatherToolFor(bag('b', 'a'), 'mining', sameTier).rarity).toBe('epic');
  });

  it('floors at bare hands with common rarity when no matching tool is carried', () => {
    // Matches bestOwnedGatherToolTier's own floor, and the rarity floor is
    // what keeps a toolless angler on the base reel window.
    // ownedTier is NO_TOOL_OWNED, not the floored tier: that distinction is
    // what lets one bag walk answer both the node gate's "a real tool" rule and
    // the bare-hands-tolerant surfaces.
    expect(bestOwnedGatherToolFor([], 'fishing', ITEMS)).toEqual({
      tier: BARE_HANDS_TOOL_TIER,
      ownedTier: NO_TOOL_OWNED,
      rarity: 'common',
    });
    // A pick is not a rod: a tool of ANOTHER profession never counts here.
    expect(bestOwnedGatherToolFor(bag('arcanite_mining_pick'), 'fishing', ITEMS)).toEqual({
      tier: BARE_HANDS_TOOL_TIER,
      ownedTier: NO_TOOL_OWNED,
      rarity: 'common',
    });
    // The tier it reports never disagrees with the tier-only scan every gate
    // still reads, which is what keeps a bonus axis from becoming a gate axis.
    for (const held of [[], bag('stormreel_fishing_rod'), bag('tidewrought_fishing_rod')]) {
      expect(bestOwnedGatherToolFor(held, 'fishing', ITEMS).tier).toBe(
        bestOwnedGatherToolTier(held, 'fishing', ITEMS),
      );
      expect(bestOwnedGatherToolFor(held, 'fishing', ITEMS).ownedTier).toBe(
        bestOwnedGatherToolTierOrNone(held, 'fishing', ITEMS),
      );
    }
  });
});

describe('crafted higher-tier base tools and monster-material gating (#1135)', () => {
  it('crafted tier-4 and tier-5 tools exist for each gathering profession, never sold for copper', () => {
    const mining = [ITEMS.thorium_mining_pick, ITEMS.arcanite_mining_pick];
    const logging = [ITEMS.ashwood_axe, ITEMS.elderwood_axe];
    const herbalism = [ITEMS.goldleaf_sickle, ITEMS.sunpetal_sickle];
    const fishing = [ITEMS.stormreel_fishing_rod, ITEMS.tidewrought_fishing_rod];
    // DERIVED, not hand-listed: every gatherTool above tier 3, whatever its
    // profession. The four lists are the readable statement of what that set
    // is today, and the cross-check is what makes a future crafted tool land
    // inside this guard instead of quietly outside it. The fishing rods did
    // exactly that until this change: nothing here would have caught a
    // crafted rod landing on a counter.
    const craftedFromContent = Object.values(ITEMS).filter(
      (def) => def.use?.type === 'gatherTool' && def.use.tier > 3,
    );
    const craftedIds = new Set(
      [...mining, ...logging, ...herbalism, ...fishing].map((item) => item.id),
    );
    expect([...craftedIds].sort()).toEqual(craftedFromContent.map((d) => d.id).sort());
    // THE CLAIM IS "NEVER FOR COPPER", NOT "NEVER ON A COUNTER". Marks are a
    // delve currency you can only earn by running the delve, so a Marks row is
    // a route through content rather than a shopping trip, and ruling 5 allows
    // it. Copper is the thing that would make the tool ladder buyable.
    //
    // The sweep below covers all THREE stock tables, not just NPCS. It used to
    // read NPCS[*].vendorItems alone, which was a hole rather than a
    // technicality: NPCS.heroic_quartermaster carries `vendorItems: undefined`
    // and keeps its real stock in HEROIC_VENDOR_STOCK, and the delve counters
    // keep theirs in DELVE_SHOPS, so BOTH were invisible here. A crafted tool
    // added to either would have passed this guard untouched.
    for (const npc of Object.values(NPCS)) {
      for (const stockedId of npc.vendorItems ?? []) {
        expect(craftedIds.has(stockedId), `${stockedId} on a copper counter`).toBe(false);
      }
    }
    // The heroic quartermaster's counter is Marks-priced too, but no tool is
    // stocked there (they live in the delve shop, see content/delves/shop.ts).
    for (const offer of HEROIC_VENDOR_STOCK) {
      expect(craftedIds.has(offer.itemId), `${offer.itemId} on the heroic counter`).toBe(false);
    }
    // The hole this guard could not see, now asserted from the other side: the
    // delve shop DOES stock every one of them, and every such row is priced in
    // Marks with no copper price anywhere on the def.
    const delveStocked = new Set(
      Object.values(DELVE_SHOPS).flatMap((entries) => entries.map((e) => e.itemId)),
    );
    for (const id of craftedIds) {
      expect(delveStocked.has(id), `${id} needs a Marks route`).toBe(true);
    }
    for (const [profession, tools] of [
      ['mining', mining],
      ['logging', logging],
      ['herbalism', herbalism],
      ['fishing', fishing],
    ] as const) {
      expect(tools.every(Boolean)).toBe(true);
      const tiers = tools.map((item) => gatherToolTier(item, profession));
      expect(tiers).toEqual([4, 5]);
      // Produced by a profession or bought with Marks, never with coin: no
      // buyValue is what makes "not for copper" true of the item itself, so a
      // future counter row cannot quietly price one.
      for (const item of tools) expect(item.buyValue).toBeUndefined();
    }
  });

  it('the copper sweep is non-vacuous: the counters it reads really do stock things', () => {
    // Without this, emptying vendorItems (or the guard reading the wrong field)
    // would leave the sweep above passing over nothing at all.
    const copperStocked = Object.values(NPCS).flatMap((npc) => npc.vendorItems ?? []);
    expect(copperStocked.length).toBeGreaterThan(10);
    expect(HEROIC_VENDOR_STOCK.length).toBeGreaterThan(0);
    expect(Object.values(DELVE_SHOPS).flat().length).toBeGreaterThan(0);
    // And a copper counter really does sell the LOWER tools, so "no tier-4/5
    // tool on a copper counter" is a boundary rather than "no tool anywhere".
    expect(copperStocked).toContain('copper_mining_pick');
    expect(ITEMS.copper_mining_pick.buyValue).toBeGreaterThan(0);
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
    const osmiumPick = gatherToolTier(ITEMS.thorium_mining_pick, 'mining') ?? -1;
    const glyphsteelPick = gatherToolTier(ITEMS.arcanite_mining_pick, 'mining') ?? -1;
    expect(osmiumPick).toBe(4);
    expect(glyphsteelPick).toBe(5);
    expect(canHarvestMonsterMaterial(osmiumPick, 3)).toBe(true);
    expect(canHarvestMonsterMaterial(osmiumPick, 4)).toBe(true);
    expect(canHarvestMonsterMaterial(osmiumPick, 5)).toBe(false);
    expect(canHarvestMonsterMaterial(glyphsteelPick, 5)).toBe(true);
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

  // The title used to say rarity was "separate from tier", which is two claims
  // and only one of them survived. GATING is what this pins, and that half is
  // permanent. The other half is now false twice over: rarity is a COARSENING
  // of tier rather than an independent axis (every shipped tool's rarity
  // follows its tier, and tiers 1 and 2 are both common), and it is no longer
  // inert, since it buys effect charges and a rod's reel window. The last arm
  // below asserts that it really does buy something, so this test cannot be
  // read as "rarity does nothing".
  it('rarity (quality) never affects GATING, for nodes or monster materials', () => {
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
    // And rarity is NOT inert, which is the half of the old title that died:
    // the same two rarities that change no gate above do change what a slotted
    // effect is worth. Stated here so a reader cannot take the gating pin as
    // proof that rarity does nothing at all.
    expect(startingDurabilityFor('gatherers_cache', 'rare')).toBeGreaterThan(
      startingDurabilityFor('gatherers_cache', 'uncommon'),
    );
  });
});

describe('tool effect slotting, on the axes the live harvest path has', () => {
  // The outcome shape follows resolveHarvest: units granted, and the effective
  // tool tier the FINE-GRADE comparison reads. There is no numeric quality and
  // no respawn-in-ticks on the live path, so there is none here either.
  const baseOutcome: HarvestOutcome = { quantity: 2, gradeToolTier: 3 };

  it('a quantity effect raises the units granted and nothing else', () => {
    const slot = slotEffect('gatherers_cache');
    expect(slot.durability).toBeGreaterThan(0);
    const bonused = applyEffectBonus(slot, baseOutcome);
    expect(bonused.quantity).toBe(baseOutcome.quantity + 1);
    expect(bonused.gradeToolTier).toBe(baseOutcome.gradeToolTier);
    // Pure: the input outcome is never mutated.
    expect(baseOutcome.quantity).toBe(2);
  });

  it('a quality effect raises the grade tool tier and nothing else', () => {
    const slot = slotEffect('artisans_eye');
    const bonused = applyEffectBonus(slot, baseOutcome);
    expect(bonused.gradeToolTier).toBe(baseOutcome.gradeToolTier + 1);
    expect(bonused.quantity).toBe(baseOutcome.quantity);
  });

  it('a quality effect over BARE HANDS misses the fine threshold by exactly one point', () => {
    // NO_TOOL_OWNED is 0 and the lowest gatherTier in the grade table is 1,
    // so the shipped bonus of 1 lands the effective tier ON the strict
    // threshold (1 > 1 is false) and a tool-less player can never mint a
    // fine grade. The margin is exactly ONE point: a future bonus-2 quality
    // effect would clear it and mint fine grades bare-handed, so if a bigger
    // bonus ever ships, the grade resolver needs a real-tool floor first.
    const slot = slotEffect('artisans_eye');
    const boosted = applyEffectBonus(slot, { quantity: 1, gradeToolTier: NO_TOOL_OWNED });
    const minGatherTier = Math.min(...Object.values(MATERIAL_GRADES).map((row) => row.gatherTier));
    expect(minGatherTier).toBe(1);
    expect(boosted.gradeToolTier).toBe(1);
    expect(yieldsFineGrade(minGatherTier, minGatherTier, boosted.gradeToolTier)).toBe(false);
    // The counterfactual that names the margin: one more point flips it.
    expect(yieldsFineGrade(minGatherTier, minGatherTier, boosted.gradeToolTier + 1)).toBe(true);
    // And the margin holds for EVERY quality effect the catalog carries, not
    // just the one this fixture names: the bonus is data (def.bonus), so a
    // new bonus-2 quality effect would be a pure content change that minted
    // fine grades bare-handed with the arm above still green.
    const qualityIds = TOOL_EFFECT_IDS.filter((id) => TOOL_EFFECTS[id].kind === 'quality');
    expect(qualityIds.length).toBeGreaterThan(0); // non-vacuity
    for (const id of qualityIds) {
      const over = applyEffectBonus(slotEffect(id), { quantity: 1, gradeToolTier: NO_TOOL_OWNED });
      expect(
        yieldsFineGrade(minGatherTier, minGatherTier, over.gradeToolTier),
        `${id} must not mint fine grades over bare hands`,
      ).toBe(false);
    }
  });

  it('the quality effect raises what comes OUT of a vein, never which veins open', () => {
    // The ruling this enforces: a slotted effect grants narrow bonuses that
    // never affect access. The grade tier it raises feeds yieldsFineGrade;
    // canGatherTier reads the player's real tool tier and never sees a slot,
    // so a tier-3 tool with Artisan's Eye still cannot open a tier-4 node.
    const slot = slotEffect('artisans_eye');
    const bonused = applyEffectBonus(slot, { quantity: 1, gradeToolTier: 3 });
    expect(bonused.gradeToolTier).toBe(4);
    expect(canGatherTier(3, 4)).toBe(false);
    // And the boosted number really would have opened it, so the arm above is
    // a separation rather than a coincidence.
    expect(canGatherTier(bonused.gradeToolTier, 4)).toBe(true);
  });

  it('the respawn-speed effect is deliberately inert, and the catalog still carries it', () => {
    // Springback Charm ships as content with no live behaviour: a respawn-speed
    // bonus points the endgame loop back at the starter zone. This pins the
    // decision, so re-enabling it has to happen here rather than by accident.
    const slot = slotEffect('quickening_charm');
    expect(TOOL_EFFECTS.quickening_charm.kind).toBe('respawnSpeed');
    expect(applyEffectBonus(slot, baseOutcome)).toEqual(baseOutcome);
  });

  it('the bonus stops once durability reaches 0, and the base tool is unaffected', () => {
    const slot = slotEffect('gatherers_cache');
    slot.durability = 0;
    expect(applyEffectBonus(slot, baseOutcome)).toEqual(baseOutcome);
    // The base tool's own tier/gating never reads the effect slot at all.
    expect(canGatherTier(1, 1)).toBe(true);
    expect(gatherToolTier(ITEMS.copper_mining_pick, 'mining')).toBe(1);
  });

  it('applyEffectBonus returns the outcome unchanged when no effect is slotted', () => {
    expect(applyEffectBonus(undefined, baseOutcome)).toEqual(baseOutcome);
  });

  it('re-slotting an effect resets it to full charges', () => {
    const slot = slotEffect('gatherers_cache', { toolRarity: 'rare' });
    for (let i = 0; i < 200; i++) depleteEffect(slot);
    expect(slot.durability).toBe(0);
    const fresh = slotEffect('gatherers_cache', { toolRarity: 'rare' });
    expect(fresh.durability).toBe(slot.maxDurability);
    expect(fresh.durability).toBeGreaterThan(0);
  });

  it('slotEffect defaults to always mode', () => {
    expect(slotEffect('gatherers_cache').confirmMode).toBe('always');
  });
});

describe('effect recharge with original-crafter discount (#1137, priced by R39, refilled by R30)', () => {
  // A hand-built one-tool inventory: the R30 re-derive reads the best owned
  // tool AT RECHARGE TIME, so every arm states its tool explicitly.
  const holding = (...itemIds: string[]): InvSlot[] =>
    itemIds.map((itemId) => ({ itemId, count: 1 }));

  it('isOriginalCrafter is true only when craftedBy matches the recharger', () => {
    const slot = slotEffect('gatherers_cache', { craftedBy: 'Alice' });
    expect(isOriginalCrafter(slot, 'Alice')).toBe(true);
    expect(isOriginalCrafter(slot, 'Bob')).toBe(false);
    const noIdentity = slotEffect('gatherers_cache');
    expect(isOriginalCrafter(noIdentity, 'Alice')).toBe(false);
  });

  it('the original crafter pays strictly fewer materials than a generic recharge of the same fill', () => {
    const slot = slotEffect('gatherers_cache', { craftedBy: 'Alice', toolRarity: 'epic' });
    slot.durability = 0;
    const inventory = holding('arcanite_mining_pick');
    const original = resolveRechargeToolEffect(inventory, 'mining', slot, 'Alice', {}, ITEMS);
    const generic = resolveRechargeToolEffect(inventory, 'mining', slot, 'Bob', {}, ITEMS);
    if (!original.ok || !generic.ok) throw new Error('both resolutions should price');
    expect(original.count).toBeLessThan(generic.count);
    // Same fill, same material: only the count moves with the discount.
    expect(original.materialItemId).toBe(generic.materialItemId);
    expect(original.newMax).toBe(generic.newMax);
  });

  it('a slot with no recorded crafter always prices at the generic rate', () => {
    const slot = slotEffect('artisans_eye', { toolRarity: 'epic' });
    slot.durability = 0;
    const inventory = holding('arcanite_mining_pick');
    const anonymous = resolveRechargeToolEffect(inventory, 'mining', slot, 'Anyone', {}, ITEMS);
    const knownCrafter = { ...slot, craftedBy: 'Alice' };
    const generic = resolveRechargeToolEffect(inventory, 'mining', knownCrafter, 'Bob', {}, ITEMS);
    expect(anonymous).toEqual(generic);
  });

  it('R39: the material identity is the disenchant ladder at the recharge-time tool rarity rung', () => {
    const slot = slotEffect('gatherers_cache', { toolRarity: 'common' });
    slot.durability = 0;
    // Shipped rungs: common pick -> dust, rare tier-4 -> essence, epic tier-5
    // -> shard. The SAME slot prices differently as the owned tool changes,
    // which is exactly the R30-resolves-the-rung contract.
    const atCommon = resolveRechargeToolEffect(
      holding('copper_mining_pick'),
      'mining',
      slot,
      'Anyone',
      {},
      ITEMS,
    );
    const atRare = resolveRechargeToolEffect(
      holding('thorium_mining_pick'),
      'mining',
      slot,
      'Anyone',
      {},
      ITEMS,
    );
    const atEpic = resolveRechargeToolEffect(
      holding('arcanite_mining_pick'),
      'mining',
      slot,
      'Anyone',
      {},
      ITEMS,
    );
    if (!atCommon.ok || !atRare.ok || !atEpic.ok) throw new Error('all three should price');
    expect(atCommon.materialItemId).toBe('arcane_dust');
    expect(atRare.materialItemId).toBe('arcane_essence');
    expect(atEpic.materialItemId).toBe('arcane_shard');
    // The count scales with the fill: a full fill runs restored / 10
    // materials, so the shipped rungs land on the R39 band's 2..5.
    expect(atCommon.count).toBe(2);
    expect(atRare.count).toBe(4);
    expect(atEpic.count).toBe(5);
  });

  it('R39: a partial fill prices only the charges actually restored', () => {
    const slot = slotEffect('gatherers_cache', { toolRarity: 'common' });
    slot.durability = 15; // 5 restored of the 20 max at the common rung
    const resolved = resolveRechargeToolEffect(
      holding('copper_mining_pick'),
      'mining',
      slot,
      'Anyone',
      {},
      ITEMS,
    );
    if (!resolved.ok) throw new Error('should price');
    expect(resolved.restored).toBe(5);
    expect(resolved.count).toBe(1); // ceil(5/10), floored at 1
  });

  it('R30: the FILL re-derives from the CURRENT best tool, so an inflated mint is one fill at most', () => {
    // Minted on a borrowed epic pick: 50 charges. The owner now holds only a
    // common pick, so the re-derived fill target is 20: while charges sit
    // above it the recharge refuses as tool_capped (the slot is not full, it
    // is beyond what this tool can fill), and once they spend to 12 a
    // recharge restores to 20, never back to 50. R47 keeps the CEILING at 50
    // so the price rung cannot fall with the carried tool.
    const slot = slotEffect('gatherers_cache', { toolRarity: 'epic' });
    expect(slot.maxDurability).toBe(50);
    slot.durability = 30;
    const inventory = holding('copper_mining_pick');
    const refused = resolveRechargeToolEffect(inventory, 'mining', slot, 'Anyone', {}, ITEMS);
    expect(refused).toEqual({ ok: false, reason: 'tool_capped' });
    slot.durability = 12;
    const resolved = resolveRechargeToolEffect(inventory, 'mining', slot, 'Anyone', {}, ITEMS);
    if (!resolved.ok) throw new Error('should price');
    expect(resolved.newMax).toBe(20);
    expect(resolved.ceiling).toBe(50);
    expect(resolved.materialItemId, 'billed at the ceiling rung, not the pick in hand').toBe(
      'arcane_shard',
    );
    expect(resolved.restored).toBe(8);
  });

  it('refuses with no real tool owned, and at-or-above the re-derived maximum', () => {
    const slot = slotEffect('gatherers_cache', { toolRarity: 'common' });
    slot.durability = 0;
    expect(resolveRechargeToolEffect([], 'mining', slot, 'Anyone', {}, ITEMS)).toEqual({
      ok: false,
      reason: 'no_tool',
    });
    const full = slotEffect('gatherers_cache', { toolRarity: 'common' });
    expect(
      resolveRechargeToolEffect(holding('copper_mining_pick'), 'mining', full, 'Anyone', {}, ITEMS),
    ).toEqual({ ok: false, reason: 'already_full' });
    expect(
      resolveRechargeToolEffect(
        holding('copper_mining_pick'),
        'skinning',
        slot,
        'Anyone',
        {},
        ITEMS,
      ),
    ).toEqual({ ok: false, reason: 'invalid_request' });
  });

  it('a ceiling the ladder cannot explain clamps into it instead of breaking the price', () => {
    // rarityRungForMaxDurability's two defensive arms, pinned because
    // pricing must never be the thing that breaks a load: a hand-edited or
    // legacy maxDurability above the ladder prices at the TOP rung (an
    // out-of-range index would resolve an undefined material id and strand
    // the slot), and one below the catalog base floors at common.
    const inflated = slotEffect('gatherers_cache');
    inflated.maxDurability = 90; // rung 7 by the raw math; ladder tops at 4
    inflated.durability = 0;
    const top = resolveRechargeToolEffect(
      holding('copper_mining_pick'),
      'mining',
      inflated,
      'Anyone',
      {},
      ITEMS,
    );
    if (!top.ok) throw new Error('should price');
    expect(top.materialItemId).toBe('arcane_shard'); // the ladder's top rung
    const corrupt = slotEffect('gatherers_cache');
    corrupt.maxDurability = 3; // below the catalog base: negative raw rung
    corrupt.durability = 0;
    const floored = resolveRechargeToolEffect(
      holding('copper_mining_pick'),
      'mining',
      corrupt,
      'Anyone',
      {},
      ITEMS,
    );
    if (!floored.ok) throw new Error('should price');
    expect(floored.materialItemId).toBe('arcane_dust'); // floored at common
    expect(rarityRungForMaxDurability('gatherers_cache', Number.NaN)).toBe(0);
  });

  it('ratchetCeilingForUse, directly: raise, equal no-op, lesser no-op', () => {
    // The R47 use-time arm's whole contract in one place: a better tool
    // RAISES the ceiling, an equal or lesser one writes NOTHING. The
    // command-path pins (gather_node_harvest.test.ts) prove the wiring; this
    // pins the mutator itself, so an unconditional-assignment mutation dies
    // here even if every fixture upstream happens to carry the bigger tool.
    const slot = slotEffect('gatherers_cache', { toolRarity: 'common' });
    expect(slot.maxDurability).toBe(startingDurabilityFor('gatherers_cache', 'common'));
    ratchetCeilingForUse(slot, 'epic');
    expect(slot.maxDurability).toBe(startingDurabilityFor('gatherers_cache', 'epic'));
    ratchetCeilingForUse(slot, 'epic');
    expect(slot.maxDurability).toBe(startingDurabilityFor('gatherers_cache', 'epic'));
    ratchetCeilingForUse(slot, 'common');
    expect(slot.maxDurability, 'a lesser tool never lowers the ceiling').toBe(
      startingDurabilityFor('gatherers_cache', 'epic'),
    );
    // The quality-less rungs ('poor', undefined) floor at common: a no-op
    // against any real ceiling.
    ratchetCeilingForUse(slot, undefined);
    expect(slot.maxDurability).toBe(startingDurabilityFor('gatherers_cache', 'epic'));
    // And durability is never touched: the ratchet prices, it does not fill.
    const partial = slotEffect('gatherers_cache', { toolRarity: 'common' });
    partial.durability = 7;
    ratchetCeilingForUse(partial, 'rare');
    expect(partial.durability).toBe(7);
  });

  it('resolution never mutates the slot; the caller owns the fill', () => {
    const slot = slotEffect('gatherers_cache', { craftedBy: 'Alice', toolRarity: 'common' });
    slot.durability = 3;
    const before = { ...slot };
    const resolved = resolveRechargeToolEffect(
      holding('copper_mining_pick'),
      'mining',
      slot,
      'Alice',
      {},
      ITEMS,
    );
    if (!resolved.ok) throw new Error('should price');
    expect(slot).toEqual(before);
  });
});

describe('always/prompt-on-use confirmation gate (#1138), the R42 apply-only half', () => {
  const baseOutcome: HarvestOutcome = { quantity: 2, gradeToolTier: 3 };

  it("'always' mode applies the bonus and NEVER spends: the settle belongs to the boundary", () => {
    // R42 split the old apply-and-deplete: this function is the pure apply
    // half, and the command boundary (completeGatherCast) spends the charge
    // only when the granted outcome differs from the same-draw base. A
    // hundred applications must therefore leave the counter untouched, or a
    // second spender has crept in beside the boundary's.
    const slot = slotEffect('gatherers_cache', { confirmMode: 'always' });
    const minted = slot.durability;
    for (let i = 0; i < 100; i++) {
      const result = applyToolEffectUse(slot, baseOutcome, i % 2 === 0);
      expect(result.applied).toBe(true);
      expect(result.outcome).toEqual(applyEffectBonus(slot, baseOutcome));
    }
    expect(slot.durability).toBe(minted);
  });

  it('a spent slot no longer applies: the boundary reads applied=false and never settles it', () => {
    const slot = slotEffect('gatherers_cache');
    slot.durability = 0;
    const result = applyToolEffectUse(slot, baseOutcome, true);
    expect(result.applied).toBe(false);
    expect(result.outcome).toEqual(baseOutcome);
  });

  it('prompt mode without confirmation applies no bonus', () => {
    const slot = slotEffect('gatherers_cache', { confirmMode: 'prompt' });
    const startingDurability = slot.durability;
    const result = applyToolEffectUse(slot, baseOutcome, false);
    expect(result.applied).toBe(false);
    expect(result.outcome).toEqual(baseOutcome);
    expect(slot.durability).toBe(startingDurability);
  });

  it('prompt mode with confirmed=true behaves like always mode for that one use', () => {
    const promptSlot = slotEffect('gatherers_cache', { confirmMode: 'prompt' });
    const promptResult = applyToolEffectUse(promptSlot, baseOutcome, true);

    const alwaysSlot = slotEffect('gatherers_cache', { confirmMode: 'always' });
    const alwaysResult = applyToolEffectUse(alwaysSlot, baseOutcome, true);

    expect(promptResult.applied).toBe(true);
    expect(promptResult).toEqual(alwaysResult);
    expect(promptSlot.durability).toBe(alwaysSlot.durability);
  });

  it('repeated unconfirmed prompt uses never change the slot', () => {
    const slot = slotEffect('artisans_eye', { confirmMode: 'prompt' });
    for (let i = 0; i < 100; i++) {
      const result = applyToolEffectUse(slot, baseOutcome, false);
      expect(result.applied).toBe(false);
      expect(result.outcome).toEqual(baseOutcome);
    }
    expect(slot.durability).toBe(TOOL_EFFECTS.artisans_eye.startingDurability);
  });

  it('applyToolEffectUse returns an unapplied no-op when there is no slot at all', () => {
    expect(applyToolEffectUse(undefined, baseOutcome, true)).toEqual({
      outcome: baseOutcome,
      applied: false,
    });
  });
});
