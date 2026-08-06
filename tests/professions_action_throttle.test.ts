// Craft Cast System Phase 5: shared action-throttle retirement suite.
// action_throttle.ts and CRAFT_THROTTLE_* are gone. craftThrottle on
// PlayerMeta stays inert for save stability. No production path returns
// reason 'throttled' for craft / enchant-family / tool recharge; casts pace.

import { describe, expect, it } from 'vitest';
import { resolveCraftForRecipe } from '../src/sim/professions/crafting';
import { resolveApplyEnchant, resolveDisenchant } from '../src/sim/professions/enchanting';
import { resolveSalvage } from '../src/sim/professions/salvage';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { completeRechargeCast } from './helpers/enchant_family_cast';

function makeSim(seed = 7): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function metaOf(sim: Sim): PlayerMeta {
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('player meta missing');
  return meta;
}

const RECIPE: ProfessionRecipeRecord = {
  id: 'test_recipe_throttle_retired',
  professionId: 'weaponcrafting',
  resultItemId: 'bone_fragments',
  resultCount: 1,
  reagents: [],
  skillReq: 0,
  itemLevelBudget: 1,
  level: 1,
};

function craftOnce(sim: Sim) {
  return resolveCraftForRecipe(sim.ctx, sim.playerId, RECIPE);
}

function disenchantOnce(sim: Sim) {
  sim.addItem('eastbrook_arming_sword', 1, sim.playerId);
  return resolveDisenchant(sim.ctx, sim.playerId, 'eastbrook_arming_sword');
}

function applyOnce(sim: Sim) {
  sim.addItem('eastbrook_arming_sword', 1, sim.playerId);
  sim.addItem('arcane_dust', 5, sim.playerId);
  return resolveApplyEnchant(
    sim.ctx,
    sim.playerId,
    'eastbrook_arming_sword',
    'enchant_weapon_might',
  );
}

function salvageOnce(sim: Sim) {
  sim.addItem('recruit_tunic', 1, sim.playerId);
  return resolveSalvage(sim.ctx, sim.playerId, 'recruit_tunic');
}

describe('shared action throttle retirement (Phase 5)', () => {
  it('PlayerMeta.craftThrottle is present and inert (never spent by resolvers)', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    expect(meta.craftThrottle).toEqual({ windowStart: 0, count: 0 });
    meta.craftThrottle = { windowStart: sim.ctx.time, count: 999 };
    for (let i = 0; i < 12; i++) expect(disenchantOnce(sim).ok).toBe(true);
    expect(applyOnce(sim).ok).toBe(true);
    expect(salvageOnce(sim).ok).toBe(true);
    expect(craftOnce(sim).ok).toBe(true);
    // No path stamps the inert field.
    expect(meta.craftThrottle.count).toBe(999);
  });

  it('craft and enchant-family resolvers never return reason throttled', () => {
    const sim = makeSim();
    for (let i = 0; i < 15; i++) {
      const r = craftOnce(sim);
      expect(r.ok).toBe(true);
      expect(r.reason).not.toBe('throttled');
    }
    for (let i = 0; i < 12; i++) {
      const r = disenchantOnce(sim);
      expect(r.ok).toBe(true);
      expect(r.reason).not.toBe('throttled');
    }
    expect(applyOnce(sim).reason).not.toBe('throttled');
    expect(salvageOnce(sim).reason).not.toBe('throttled');
  });

  it('sequential craft resolves exceed the old 10-per-window quota without throttled', () => {
    const sim = makeSim();
    for (let i = 0; i < 12; i++) {
      const r = craftOnce(sim);
      expect(r.ok).toBe(true);
      expect(r.reason).not.toBe('throttled');
    }
  });

  it('tool recharge never returns throttled when craftThrottle is exhausted', () => {
    const sim = makeSim();
    const events: { type: string; reason?: string; ok?: boolean }[] = [];
    const origEmit = sim.ctx.emit.bind(sim.ctx);
    sim.ctx.emit = (ev) => {
      events.push(ev as { type: string; reason?: string; ok?: boolean });
      origEmit(ev);
    };
    sim.addItem('copper_mining_pick', 1);
    sim.addItemInstance('gatherers_cache', { signer: metaOf(sim).name }, sim.playerId, 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    slot.durability = 0;
    sim.addItem('arcane_dust', 20);
    metaOf(sim).craftThrottle = { windowStart: 0, count: 1000 };
    sim.rechargeToolEffect('mining');
    completeRechargeCast(sim);
    expect(slot.durability).toBeGreaterThan(0);
    expect(sim.countItem('arcane_dust')).toBeLessThan(20);
    const rechargeResults = events.filter((e) => e.type === 'toolEffectResult');
    expect(rechargeResults.some((e) => e.ok === true)).toBe(true);
    expect(rechargeResults.every((e) => e.reason !== 'throttled')).toBe(true);
  });
});
