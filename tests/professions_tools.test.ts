import { describe, expect, it } from 'vitest';
import { ITEMS, NPCS } from '../src/sim/data';
import {
  canGatherTier,
  canHarvestMonsterMaterial,
  gatherToolTier,
  isGatherToolUse,
} from '../src/sim/professions/tools';
import { Sim } from '../src/sim/sim';
import type { ItemDef } from '../src/sim/types';

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
    // so a base gathering tool can never be exhausted by gathering.
    expect(isGatherToolUse(pick.use)).toBe(true);
    expect(gatherToolTier(pick, 'mining')).toBe(1);
  });

  it('gatherToolTier returns undefined for a non-tool item, a mismatched profession, and a differently-used tool', () => {
    expect(gatherToolTier(ITEMS.worn_sword, 'mining')).toBeUndefined();
    expect(gatherToolTier(ITEMS.copper_mining_pick, 'logging')).toBeUndefined();
    // simple_fishing_pole has kind: 'tool' and a use, but not a gatherTool use,
    // exercising the !isGatherToolUse(item.use) branch specifically.
    expect(isGatherToolUse(ITEMS.simple_fishing_pole.use)).toBe(false);
    expect(gatherToolTier(ITEMS.simple_fishing_pole, 'mining')).toBeUndefined();
  });

  it('using a gathering tool is a safe no-op until the gather-node system lands', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.addItem('copper_mining_pick', 1, pid);
    expect(() => sim.useItem('copper_mining_pick', pid)).not.toThrow();
    expect(sim.countItem('copper_mining_pick', pid)).toBe(1);
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
      // gatherToolTier is a pure read of static item data (src/sim/types.ts's
      // ItemDef has no durability field at all), so a single read already
      // proves it can never be mutated or exhausted; repeating the same pure
      // call would test nothing further.
      expect(gatherToolTier(item, 'mining')).toBe(tier);
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
    // gatherToolTier reads only `use.tier`, never `quality`: two items that
    // differ solely in rarity resolve to the identical tier, so every gating
    // call downstream (canGatherTier / canHarvestMonsterMaterial) is already
    // provably identical for the two without needing to re-call them (doing
    // so would just compare f(x, y) to f(x, y), which can never fail).
    expect(gatherToolTier(commonTierThree, 'mining')).toBe(3);
    expect(gatherToolTier(epicTierThree, 'mining')).toBe(3);
    // Real vendor (uncommon, tier 3) and crafted (rare, tier 4) tools also
    // carry different rarities: confirm the rarity difference is real, so the
    // tier-only gating check above is meaningful and not vacuously true.
    expect(ITEMS.mithril_mining_pick.quality).toBe('uncommon');
    expect(ITEMS.thorium_mining_pick.quality).toBe('rare');
  });
});
