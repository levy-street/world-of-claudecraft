import { describe, expect, it } from 'vitest';
import { TOOL_EFFECTS } from '../src/sim/content/professions';
import { ITEMS, NPCS } from '../src/sim/data';
import {
  applyEffectBonus,
  canGatherTier,
  canHarvestMonsterMaterial,
  depleteEffect,
  gatherToolTier,
  type HarvestOutcome,
  isGatherToolUse,
  resolveToolEffectUse,
  slotEffect,
} from '../src/sim/professions/tools';
import { Rng } from '../src/sim/rng';
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

  it('depleteEffect decrements durability only on a losing roll, via Rng, deterministically under a fixed seed', () => {
    const runSequence = (seed: number): number[] => {
      const rng = new Rng(seed);
      const slot = slotEffect('gatherers_cache');
      const history: number[] = [];
      for (let i = 0; i < 30; i++) {
        depleteEffect(slot, rng);
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
    // At a 50% chance, 30 draws almost always exhaust a 20-charge effect.
    const runToZero = (seed: number): number[] => {
      const rng = new Rng(seed);
      const slot = slotEffect('gatherers_cache');
      const history: number[] = [];
      for (let i = 0; i < 200; i++) {
        depleteEffect(slot, rng);
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
    depleteEffect(slot, rng);
    expect(slot.durability).toBe(0);
  });

  it('re-slotting an effect resets it to full durability', () => {
    const slot = slotEffect('quickening_charm');
    const rng = new Rng(7);
    for (let i = 0; i < 50; i++) depleteEffect(slot, rng);
    expect(slot.durability).toBe(0);
    const fresh = slotEffect('quickening_charm');
    expect(fresh.durability).toBeGreaterThan(0);
  });

  it('slotEffect defaults to always mode', () => {
    expect(slotEffect('gatherers_cache').confirmMode).toBe('always');
  });
});

describe('always/prompt-on-use confirmation gate (#1138)', () => {
  const baseOutcome: HarvestOutcome = { quantity: 2, quality: 1, respawnTicks: 100 };

  it("'always' mode is byte-for-byte identical to #1136's baseline behavior, confirmed or not", () => {
    const runOld = (seed: number) => {
      const rng = new Rng(seed);
      const slot = slotEffect('gatherers_cache');
      const history: { outcome: HarvestOutcome; depleted: boolean }[] = [];
      for (let i = 0; i < 30; i++) {
        const outcome = applyEffectBonus(slot, baseOutcome);
        const depleted = depleteEffect(slot, rng);
        history.push({ outcome, depleted });
      }
      return { history, finalDurability: slot.durability };
    };
    const runNew = (seed: number, confirmed: boolean) => {
      const rng = new Rng(seed);
      const slot = slotEffect('gatherers_cache', 'always');
      const history: { outcome: HarvestOutcome; depleted: boolean }[] = [];
      for (let i = 0; i < 30; i++) {
        const result = resolveToolEffectUse(slot, baseOutcome, rng, confirmed);
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
    const slot = slotEffect('gatherers_cache', 'prompt');
    const startingDurability = slot.durability;
    const result = resolveToolEffectUse(slot, baseOutcome, rng, false);
    expect(result.applied).toBe(false);
    expect(result.depleted).toBe(false);
    expect(result.outcome).toEqual(baseOutcome);
    expect(slot.durability).toBe(startingDurability);
  });

  it('prompt mode with confirmed=true behaves like always mode for that one use', () => {
    const seed = 42;
    const rngPrompt = new Rng(seed);
    const promptSlot = slotEffect('gatherers_cache', 'prompt');
    const promptResult = resolveToolEffectUse(promptSlot, baseOutcome, rngPrompt, true);

    const rngAlways = new Rng(seed);
    const alwaysSlot = slotEffect('gatherers_cache', 'always');
    const alwaysResult = resolveToolEffectUse(alwaysSlot, baseOutcome, rngAlways, true);

    expect(promptResult.applied).toBe(true);
    expect(promptResult).toEqual(alwaysResult);
    expect(promptSlot.durability).toBe(alwaysSlot.durability);
  });

  it('repeated unconfirmed prompt uses never deplete the slot, across many draws', () => {
    const rng = new Rng(7);
    const slot = slotEffect('artisans_eye', 'prompt');
    for (let i = 0; i < 100; i++) {
      const result = resolveToolEffectUse(slot, baseOutcome, rng, false);
      expect(result.applied).toBe(false);
      expect(result.outcome).toEqual(baseOutcome);
    }
    expect(slot.durability).toBe(TOOL_EFFECTS.artisans_eye.startingDurability);
  });

  it('resolveToolEffectUse returns an unapplied no-op when there is no slot at all', () => {
    const rng = new Rng(1);
    expect(resolveToolEffectUse(undefined, baseOutcome, rng, true)).toEqual({
      outcome: baseOutcome,
      depleted: false,
      applied: false,
    });
  });
});
