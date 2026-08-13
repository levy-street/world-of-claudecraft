// Player item lock (issue #3042): a player-toggled per-copy safety mark that
// refuses salvage, profession-craft reagent consumption, and vendor sell
// (single and bulk) until the player unlocks it again.
//
// Covers the pure core (isItemLocked, setItemLocked's in-place mutate vs.
// stack-split, countUnlockedItem/InSlots), the three protected-action
// boundaries end to end through a real Sim, and the save/load round trip.

import { describe, expect, it } from 'vitest';
import { BACKPACK_SLOTS } from '../src/sim/bags';
import { recipeById } from '../src/sim/content/recipes';
import {
  countUnlockedInSlots,
  countUnlockedItem,
  isItemLocked,
  removeUnlockedFromSlots,
  setItemLocked,
} from '../src/sim/item_lock';
import * as items from '../src/sim/items';
import { hasRecipeMaterials, resolveCraftForRecipe } from '../src/sim/professions/crafting';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, InvSlot, SimEvent } from '../src/sim/types';

function makeSim(seed = 11) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

function inventoryOf(sim: Sim, pid: number): InvSlot[] {
  return sim.players.get(pid)?.inventory ?? [];
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

function salvageResults(events: SimEvent[]) {
  return events.filter((e): e is Extract<SimEvent, { type: 'salvageResult' }> => {
    return e.type === 'salvageResult';
  });
}

/** Finish a started salvage cast (the enchant-family cast shape). */
function completeSalvageCastNow(sim: Sim, pid: number) {
  const p = (sim as unknown as { entities: Map<number, Entity> }).entities.get(pid)!;
  const meta = sim.players.get(pid)!;
  p.castingAbility = null;
  p.castRemaining = 0;
  ctxOf(sim).completeSalvageCast(p, meta);
}

const COMMON_WEAPON = 'eastbrook_arming_sword';
const JERKY_RECIPE = 'recipe_tough_jerky';
const JERKY_REAGENT = 'spider_leg';

// Stand a player at Trader Wilkes so the vendor proximity gate passes,
// mirroring items.test.ts's vendorPlayer helper.
function vendorPlayer(sim: Sim) {
  const pid = sim.addPlayer('warrior', 'Lockwright');
  const anySim = sim as unknown as { entities: Map<number, Entity>; rebucket(e: Entity): void };
  const wilkes = [...anySim.entities.values()].find(
    (e) => (e as unknown as { templateId?: string }).templateId === 'trader_wilkes',
  ) as Entity;
  const p = anySim.entities.get(pid) as Entity;
  p.pos.x = wilkes.pos.x + 2;
  p.pos.z = wilkes.pos.z;
  anySim.rebucket(p);
  const meta = sim.players.get(pid)!;
  meta.inventory.length = 0;
  return { pid, meta };
}

describe('isItemLocked', () => {
  it('true only when the payload explicitly carries locked: true', () => {
    expect(isItemLocked(undefined)).toBe(false);
    expect(isItemLocked({})).toBe(false);
    expect(isItemLocked({ locked: false })).toBe(false);
    expect(isItemLocked({ locked: true })).toBe(true);
    expect(isItemLocked({ signer: 'Ana', locked: true })).toBe(true);
  });
});

describe('countUnlockedItem / countUnlockedInSlots / removeUnlockedFromSlots', () => {
  it('counts and removes only unlocked units, leaving locked slots untouched', () => {
    const inv: InvSlot[] = [
      { itemId: 'bone_fragments', count: 5, instance: { locked: true } },
      { itemId: 'bone_fragments', count: 3 },
    ];
    expect(countUnlockedInSlots(inv, 'bone_fragments')).toBe(3);
    removeUnlockedFromSlots(inv, 'bone_fragments', 5);
    // Only 3 unlocked units existed; the locked slot is never touched even
    // though the request asked for more than the unlocked count could pay.
    expect(inv).toEqual([{ itemId: 'bone_fragments', count: 5, instance: { locked: true } }]);
  });

  it('countUnlockedItem mirrors the meta.inventory read and is 0 with no meta', () => {
    expect(countUnlockedItem(undefined, 'bone_fragments')).toBe(0);
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory.length = 0;
    meta.inventory.push(
      { itemId: 'bone_fragments', count: 2, instance: { locked: true } },
      { itemId: 'bone_fragments', count: 4 },
    );
    expect(countUnlockedItem(meta, 'bone_fragments')).toBe(4);
  });
});

describe('setItemLocked: the toggle command', () => {
  it('locks and unlocks a non-stackable slot (count 1) in place, no split', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: COMMON_WEAPON, count: 1 });

    const locked = setItemLocked(ctxOf(sim), COMMON_WEAPON, true, pid, 0);
    expect(locked).toEqual({ ok: true, itemId: COMMON_WEAPON, locked: true });
    expect(meta.inventory).toHaveLength(1);
    expect(isItemLocked(meta.inventory[0].instance)).toBe(true);

    const unlocked = setItemLocked(ctxOf(sim), COMMON_WEAPON, false, pid, 0);
    expect(unlocked).toEqual({ ok: true, itemId: COMMON_WEAPON, locked: false });
    expect(meta.inventory).toHaveLength(1);
    // Locked was the only field the payload ever carried, so unlocking clears
    // the instance back to a plain (mergeable-again) slot.
    expect(meta.inventory[0].instance).toBeUndefined();
  });

  it('locking one unit out of a stack splits it into its own slot', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: 'bone_fragments', count: 5 });

    const result = setItemLocked(ctxOf(sim), 'bone_fragments', true, pid, 0);
    expect(result).toEqual({ ok: true, itemId: 'bone_fragments', locked: true });
    const stacks = meta.inventory.filter((s) => s.itemId === 'bone_fragments');
    expect(stacks).toHaveLength(2);
    const [unlockedStack] = stacks.filter((s) => !isItemLocked(s.instance));
    const [lockedStack] = stacks.filter((s) => isItemLocked(s.instance));
    expect(unlockedStack.count).toBe(4);
    expect(lockedStack.count).toBe(1);
  });

  it('refuses no_bag_space when a split needs a fresh slot and bags are full', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: 'bone_fragments', count: 5 });
    // Fill every remaining slot with distinct plain stacks so no fresh slot
    // is free for the split.
    for (let i = 1; i < BACKPACK_SLOTS; i++) {
      meta.inventory.push({ itemId: `filler_${i}`, count: 1 });
    }
    expect(meta.inventory).toHaveLength(BACKPACK_SLOTS);

    const result = setItemLocked(ctxOf(sim), 'bone_fragments', true, pid, 0);
    expect(result).toEqual({
      ok: false,
      itemId: 'bone_fragments',
      locked: true,
      reason: 'no_bag_space',
    });
    // Nothing changed: still one plain stack of 5, no split slot minted.
    const stacks = meta.inventory.filter((s) => s.itemId === 'bone_fragments');
    expect(stacks).toEqual([{ itemId: 'bone_fragments', count: 5 }]);
  });

  it('refuses not_held for a missing, stale, or mismatched slot selection', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: COMMON_WEAPON, count: 1 });

    expect(setItemLocked(ctxOf(sim), COMMON_WEAPON, true, pid, 99)).toEqual({
      ok: false,
      itemId: COMMON_WEAPON,
      locked: true,
      reason: 'not_held',
    });
    expect(setItemLocked(ctxOf(sim), COMMON_WEAPON, true, pid, undefined)).toEqual({
      ok: false,
      itemId: COMMON_WEAPON,
      locked: true,
      reason: 'not_held',
    });
    // Slot 0 holds a different item id than requested.
    expect(setItemLocked(ctxOf(sim), 'bone_fragments', true, pid, 0)).toEqual({
      ok: false,
      itemId: 'bone_fragments',
      locked: true,
      reason: 'not_held',
    });
  });

  it('is a no-op success when the requested state already holds', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: COMMON_WEAPON, count: 1 });
    expect(setItemLocked(ctxOf(sim), COMMON_WEAPON, false, pid, 0)).toEqual({
      ok: true,
      itemId: COMMON_WEAPON,
      locked: false,
    });
    expect(meta.inventory[0].instance).toBeUndefined();
  });
});

describe('the lock, threaded through save/load', () => {
  it('survives serializeCharacter + addPlayer round trip', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: COMMON_WEAPON, count: 1, instance: { locked: true } });

    const state = sim.serializeCharacter(pid);
    const sim2 = new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true });
    const pid2 = sim2.addPlayer('warrior', 'Lockwright', { state: state ?? undefined });
    const loaded = inventoryOf(sim2, pid2).find((s) => s.itemId === COMMON_WEAPON);
    expect(loaded?.instance?.locked).toBe(true);
  });
});

describe('salvage refuses a locked copy', () => {
  it('denies with reason locked and consumes nothing', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: COMMON_WEAPON, count: 1, instance: { locked: true } });
    sim.drainEvents();

    sim.salvageItem(COMMON_WEAPON, pid, 0);
    completeSalvageCastNow(sim, pid);
    const results = salvageResults(sim.drainEvents());
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].reason).toBe('locked');
    expect(inventoryOf(sim, pid)).toHaveLength(1);
  });

  it('an unlocked copy salvages normally once the locked one is spared', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: COMMON_WEAPON, count: 1, instance: { locked: true } });
    meta.inventory.push({ itemId: COMMON_WEAPON, count: 1 });
    sim.drainEvents();

    // Named slot 1: the plain, unlocked copy.
    sim.salvageItem(COMMON_WEAPON, pid, 1);
    completeSalvageCastNow(sim, pid);
    const results = salvageResults(sim.drainEvents());
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    const left = inventoryOf(sim, pid).filter((s) => s.itemId === COMMON_WEAPON);
    expect(left).toHaveLength(1);
    expect(isItemLocked(left[0].instance)).toBe(true);
  });
});

describe('profession craft refuses a locked reagent', () => {
  it('hasRecipeMaterials is false when the only reagent copy is locked', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: JERKY_REAGENT, count: 1, instance: { locked: true } });
    const recipe = recipeById(JERKY_RECIPE)!;
    expect(hasRecipeMaterials(ctxOf(sim), recipe, pid)).toBe(false);
  });

  it('resolveCraftForRecipe denies reason locked (not insufficient_materials) and consumes nothing', () => {
    // The player holds the reagent in the required quantity in AGGREGATE, so
    // the denial must name the real cause (issue 3042 acceptance: "each
    // refused action surfaces a clear locked-item message"), not read as a
    // generic shortage the player cannot see is untrue.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: JERKY_REAGENT, count: 1, instance: { locked: true } });

    const recipe = recipeById(JERKY_RECIPE)!;
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('locked');
    // The locked reagent is untouched.
    expect(inventoryOf(sim, pid)).toEqual([
      { itemId: JERKY_REAGENT, count: 1, instance: { locked: true } },
    ]);
  });

  it('a genuine shortfall (no locked copy at all) still denies insufficient_materials', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory.length = 0;
    const recipe = recipeById(JERKY_RECIPE)!;
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
  });

  it('a mix of locked and unlocked reagents crafts using only the unlocked copy', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: JERKY_REAGENT, count: 1, instance: { locked: true } });
    meta.inventory.push({ itemId: JERKY_REAGENT, count: 1 });

    const recipe = recipeById(JERKY_RECIPE)!;
    expect(hasRecipeMaterials(ctxOf(sim), recipe, pid)).toBe(true);
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);
    expect(result.ok).toBe(true);
    const remainingReagent = inventoryOf(sim, pid).filter((s) => s.itemId === JERKY_REAGENT);
    expect(remainingReagent).toHaveLength(1);
    expect(isItemLocked(remainingReagent[0].instance)).toBe(true);
  });
});

describe('vendor sell refuses a locked copy', () => {
  it('sellItem on a named locked slot denies with the locked message', () => {
    const sim = makeSim();
    const { pid, meta } = vendorPlayer(sim);
    meta.inventory.push({ itemId: 'wolf_fang', count: 1, instance: { locked: true } });
    sim.drainEvents();

    items.sellItem(ctxOf(sim), 'wolf_fang', 1, pid, 0);
    expect(errorTexts(sim.drainEvents())).toContain('That item is locked and cannot be sold.');
    expect(inventoryOf(sim, pid)).toHaveLength(1);
    expect(meta.vendorBuyback).toHaveLength(0);
  });

  it('sellItem bulk sale clamps to unlocked copies and sells the rest', () => {
    const sim = makeSim();
    const { pid, meta } = vendorPlayer(sim);
    meta.inventory.push({ itemId: 'wolf_fang', count: 1, instance: { locked: true } });
    meta.inventory.push({ itemId: 'wolf_fang', count: 2 });
    sim.drainEvents();

    items.sellItem(ctxOf(sim), 'wolf_fang', 3, pid);
    const events = sim.drainEvents();
    expect(errorTexts(events)).not.toContain('That item is locked and cannot be sold.');
    const left = inventoryOf(sim, pid).filter((s) => s.itemId === 'wolf_fang');
    expect(left).toHaveLength(1);
    expect(isItemLocked(left[0].instance)).toBe(true);
    expect(left[0].count).toBe(1);
  });

  it('sellAllJunk skips a locked poor-quality item', () => {
    const sim = makeSim();
    const { pid, meta } = vendorPlayer(sim);
    // tangled_weed: kind junk, quality poor, junk-sweep eligible except for the lock.
    meta.inventory.push({ itemId: 'tangled_weed', count: 1, instance: { locked: true } });
    sim.drainEvents();

    items.sellAllJunk(ctxOf(sim), pid);
    const left = inventoryOf(sim, pid).filter((s) => s.itemId === 'tangled_weed');
    expect(left).toHaveLength(1);
  });
});
