// The Phase 12c shared action throttle (src/sim/professions/action_throttle.ts):
// crafting, disenchant, enchant-apply, and salvage all draw from ONE
// 10-per-60s pacing budget (the historical PlayerMeta.craftThrottle field, its
// name kept to spare save/wire/pin churn), so mixing action kinds can never
// multiply a player's paced output. Denials never spend budget; the window
// resets itself against sim time.

import { describe, expect, it } from 'vitest';
import {
  CRAFT_THROTTLE_MAX_PER_WINDOW,
  CRAFT_THROTTLE_WINDOW_SECONDS,
  recordAction,
  withinActionThrottle,
} from '../src/sim/professions/action_throttle';
import { resolveCraftForRecipe } from '../src/sim/professions/crafting';
import { resolveApplyEnchant, resolveDisenchant } from '../src/sim/professions/enchanting';
import { resolveSalvage } from '../src/sim/professions/salvage';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { type PlayerMeta, Sim } from '../src/sim/sim';

function makeSim(seed = 7): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function metaOf(sim: Sim): PlayerMeta {
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('player meta missing');
  return meta;
}

// Reagent-free synthetic recipe (the archetype_ceiling.test.ts pattern), so a
// craft attempt needs no inventory staging and the only success gate in play
// is the throttle itself.
const RECIPE: ProfessionRecipeRecord = {
  id: 'test_recipe_shared_throttle',
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

// Each staging helper grants exactly what one attempt consumes, so a denied
// attempt leaves the staged goods behind (asserted where it matters).
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

describe('shared action throttle (Phase 12c)', () => {
  it('pins the shared budget constants via the throttle module', () => {
    // Pinned to literals so a re-tune of either constant cannot pass
    // silently; read THROUGH action_throttle.ts so the re-export itself is
    // pinned too (the module is the seam every paced resolver consumes).
    expect(CRAFT_THROTTLE_MAX_PER_WINDOW).toBe(10);
    expect(CRAFT_THROTTLE_WINDOW_SECONDS).toBe(60);
  });

  it('window-reset semantics: full at the boundary, and recordAction spends exactly one unit', () => {
    // A minimal synthetic meta: withinActionThrottle/recordAction read only
    // the craftThrottle field.
    const meta = { craftThrottle: { windowStart: 0, count: 10 } } as PlayerMeta;
    // One tick shy of the boundary: still the old (exhausted) window.
    expect(withinActionThrottle(meta, CRAFT_THROTTLE_WINDOW_SECONDS - 0.05)).toBe(false);
    // AT the boundary (>=): the window rolls over and the budget refills.
    expect(withinActionThrottle(meta, CRAFT_THROTTLE_WINDOW_SECONDS)).toBe(true);
    expect(meta.craftThrottle).toEqual({ windowStart: CRAFT_THROTTLE_WINDOW_SECONDS, count: 0 });
    recordAction(meta);
    expect(meta.craftThrottle.count).toBe(1);
  });

  it('10 mixed actions exhaust the ONE shared budget; the 11th is denied throttled for EVERY kind', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    // 7 crafts + 1 disenchant + 1 enchant-apply + 1 salvage = 10 successes
    // drawn from one budget, not one budget per action kind.
    for (let i = 0; i < 7; i++) expect(craftOnce(sim).ok).toBe(true);
    expect(disenchantOnce(sim).ok).toBe(true);
    expect(applyOnce(sim).ok).toBe(true);
    expect(salvageOnce(sim).ok).toBe(true);
    expect(meta.craftThrottle.count).toBe(CRAFT_THROTTLE_MAX_PER_WINDOW);

    // All four deny arms fire on the shared exhaustion, and a denial never
    // spends budget (the count stays exactly at the cap throughout).
    expect(craftOnce(sim).reason).toBe('throttled');
    expect(disenchantOnce(sim).reason).toBe('throttled');
    expect(applyOnce(sim).reason).toBe('throttled');
    expect(salvageOnce(sim).reason).toBe('throttled');
    expect(meta.craftThrottle.count).toBe(CRAFT_THROTTLE_MAX_PER_WINDOW);
  });

  it('the 60s window rollover restores all four action kinds', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    for (let i = 0; i < CRAFT_THROTTLE_MAX_PER_WINDOW; i++) expect(craftOnce(sim).ok).toBe(true);
    expect(craftOnce(sim).reason).toBe('throttled');
    meta.craftThrottle.windowStart -= CRAFT_THROTTLE_WINDOW_SECONDS;
    expect(craftOnce(sim).ok).toBe(true);
    expect(disenchantOnce(sim).ok).toBe(true);
    expect(applyOnce(sim).ok).toBe(true);
    expect(salvageOnce(sim).ok).toBe(true);
    // The rollover reset the count before the four fresh successes above.
    expect(meta.craftThrottle.count).toBe(4);
  });

  it('a craft-exhausted budget blocks disenchant, consuming nothing (cross-pair decisive arm)', () => {
    const sim = makeSim();
    for (let i = 0; i < CRAFT_THROTTLE_MAX_PER_WINDOW; i++) expect(craftOnce(sim).ok).toBe(true);
    const denied = disenchantOnce(sim);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('throttled');
    // The staged sword survives the denial and no material was granted.
    expect(sim.countItem('eastbrook_arming_sword', sim.playerId)).toBe(1);
    expect(sim.countItem('arcane_dust', sim.playerId)).toBe(0);
  });

  it('a salvage-exhausted budget blocks craft (the reverse cross-pair direction)', () => {
    const sim = makeSim();
    for (let i = 0; i < CRAFT_THROTTLE_MAX_PER_WINDOW; i++) expect(salvageOnce(sim).ok).toBe(true);
    const denied = craftOnce(sim);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('throttled');
  });
});
