// Intentional Gathering PR4: the per-player derived-projection cache
// (professions/gathering_goal_projection.ts). Verifies the five-tick gate
// itself: an unchanged read reuses the exact same object, a goal replace
// forces a fresh one immediately, and every relevant mutation family
// (a real bag grant, a real bank deposit, a real vault deposit, a real
// lock toggle, a name change, a known-recipe change, a daily stamp) is
// invisible within the window and recomputed once it passes. Bank/vault/lock
// mutations drive the REAL Sim command paths (bankDeposit/vaultDeposit/
// setItemLocked), never a direct field push: those commands already bump the
// wireRev/bankWireRev/vaultWireRev signals the cache signature reads
// (quest_credit.ts onInventoryChangedForQuests, bank.ts bumpBankWireRev,
// materials_vault.ts bumpVaultWireRev), so a hand-pushed slot or stock value
// would exercise a state no real player action can produce.

import { describe, expect, it } from 'vitest';
import { recipeById } from '../src/sim/content/recipes';
import { GATHERING_GOAL_REFRESH_TICKS } from '../src/sim/professions/gathering_goal_projection';
import { Sim } from '../src/sim/sim';

const SWORD_RECIPE = 'recipe_eastbrook_arming_sword'; // wolf_fang 2, bone_fragments 4, smithing_flux 6
const TRAINER_RECIPE = 'recipe_stormreel_fishing_rod'; // acquisition: trainer, no combo requirement
const DAILY_RECIPE = 'recipe_quickening_catalyst'; // acquisition: trainer, oncePerDay

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function grantOneCraftOf(sim: Sim, recipeId: string, pid: number) {
  const recipe = recipeById(recipeId);
  if (!recipe) throw new Error(`missing recipe ${recipeId}`);
  for (const reagent of recipe.reagents) sim.addItem(reagent.itemId, reagent.count, pid);
}

function passRefreshWindow(sim: Sim) {
  for (let i = 0; i < GATHERING_GOAL_REFRESH_TICKS; i++) sim.tick();
}

// Relocate the first banker NPC onto the player (the vault_wire.test.ts /
// bank_wire.test.ts idiom): nearBanker is a dist2d check, and moving the NPC
// (which has no wander AI) avoids pushing the player into a collider.
function bringBankerToPlayer(sim: Sim, pid: number) {
  const banker = sim.entities.get(sim.bankerIds[0]);
  const p = sim.entities.get(pid);
  if (!banker || !p) throw new Error('missing banker or player');
  banker.pos = { ...p.pos };
  banker.prevPos = { ...banker.pos };
}

describe('unchanged reads reuse the exact same object', () => {
  it('repeated reads within the window return the identical reference', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantOneCraftOf(sim, SWORD_RECIPE, pid);
    sim.trackGatheringRecipe(SWORD_RECIPE, 5, pid);

    const first = sim.gatheringGoalFor(pid);
    const second = sim.gatheringGoalFor(pid);
    const third = sim.gatheringGoalFor(pid);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});

describe('a goal change forces a fresh object immediately', () => {
  it('replacing the tracked recipe/quantity never returns the old object', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantOneCraftOf(sim, SWORD_RECIPE, pid);
    sim.trackGatheringRecipe(SWORD_RECIPE, 1, pid);
    const first = sim.gatheringGoalFor(pid);

    sim.trackGatheringRecipe(SWORD_RECIPE, 2, pid);
    const second = sim.gatheringGoalFor(pid);

    expect(second).not.toBe(first);
    expect(second?.goal).toEqual({ kind: 'recipe', recipeId: SWORD_RECIPE, count: 2 });
  });

  it('clearing the goal never returns the old object on the next track', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantOneCraftOf(sim, SWORD_RECIPE, pid);
    sim.trackGatheringRecipe(SWORD_RECIPE, 1, pid);
    const first = sim.gatheringGoalFor(pid);

    sim.clearGatheringGoal(pid);
    expect(sim.gatheringGoalFor(pid)).toBeNull();

    sim.trackGatheringRecipe(SWORD_RECIPE, 1, pid);
    const second = sim.gatheringGoalFor(pid);
    expect(second).not.toBe(first);
  });
});

describe('a real bag grant recomputes only after the five-tick gate passes', () => {
  it('sim.addItem is invisible within the window, then recomputes', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantOneCraftOf(sim, SWORD_RECIPE, pid); // exactly 1 craft's worth
    sim.trackGatheringRecipe(SWORD_RECIPE, 2, pid);
    const before = sim.gatheringGoalFor(pid);
    expect(before?.materials.find((m) => m.itemId === 'wolf_fang')?.missing).toBe(2);

    sim.addItem('wolf_fang', 2, pid); // now enough wolf_fang for both crafts
    expect(sim.gatheringGoalFor(pid)).toBe(before);

    passRefreshWindow(sim);
    const after = sim.gatheringGoalFor(pid);
    expect(after).not.toBe(before);
    expect(after?.materials.find((m) => m.itemId === 'wolf_fang')?.missing).toBe(0);
  });
});

describe('a real bank deposit recomputes only after the five-tick gate passes', () => {
  it('moves carried units into stored (never manufactures extra ownership)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    bringBankerToPlayer(sim, pid);
    grantOneCraftOf(sim, SWORD_RECIPE, pid);
    sim.addItem('wolf_fang', 2, pid); // 4 carried total: exactly what count=2 needs
    sim.trackGatheringRecipe(SWORD_RECIPE, 2, pid);
    const before = sim.gatheringGoalFor(pid);
    expect(before?.materials.find((m) => m.itemId === 'wolf_fang')).toMatchObject({
      required: 4,
      carried: 4,
      stored: 0,
      reachable: 4,
      missing: 0,
      inaccessible: 0,
    });

    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing meta');
    const idx = meta.inventory.findIndex((s) => s.itemId === 'wolf_fang');
    sim.bankDeposit(idx, 2, pid); // real command: carries 2 of the 4 into the bank
    expect(sim.gatheringGoalFor(pid)).toBe(before); // still within the window

    passRefreshWindow(sim);
    const after = sim.gatheringGoalFor(pid);
    expect(after).not.toBe(before);
    // Total owned units are unchanged (4): 2 moved from carried to the bank, not
    // duplicated. The bank never feeds `reachable` for crafting, so the same 4
    // units that were fully reachable before are only half-reachable now.
    expect(after?.materials.find((m) => m.itemId === 'wolf_fang')).toMatchObject({
      required: 4,
      carried: 2,
      stored: 2,
      reachable: 2,
      missing: 0,
      inaccessible: 2,
    });
  });
});

describe('a real vault deposit recomputes only after the five-tick gate passes', () => {
  it('moves physical units into drawable storage (never manufactures extra units)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    bringBankerToPlayer(sim, pid);
    grantOneCraftOf(sim, SWORD_RECIPE, pid);
    sim.addItem('wolf_fang', 2, pid); // 4 carried total: exactly what count=2 needs
    sim.trackGatheringRecipe(SWORD_RECIPE, 2, pid);
    const before = sim.gatheringGoalFor(pid);
    expect(before?.materials.find((m) => m.itemId === 'wolf_fang')).toMatchObject({
      required: 4,
      carried: 4,
      stored: 0,
      reachable: 4,
      missing: 0,
    });

    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing meta');
    // Precondition, not the mutation under test: the vault must be unlocked
    // before any deposit is admitted (materials_vault.ts vaultDeposit).
    meta.vault.upgrades = 1;
    const idx = meta.inventory.findIndex((s) => s.itemId === 'wolf_fang');
    sim.vaultDeposit(idx, 2, pid); // real command: carries 2 of the 4 into the vault
    expect(sim.gatheringGoalFor(pid)).toBe(before); // still within the window

    passRefreshWindow(sim);
    const after = sim.gatheringGoalFor(pid);
    expect(after).not.toBe(before);
    // Total owned/reachable units are unchanged (4 required, 0 missing, fully
    // reachable): the vault, unlike the bank, still feeds `reachable`, so
    // moving half the stack there just changes WHERE the units live.
    expect(after?.materials.find((m) => m.itemId === 'wolf_fang')).toMatchObject({
      required: 4,
      carried: 2,
      stored: 2,
      reachable: 4,
      missing: 0,
      inaccessible: 0,
    });
  });
});

describe('a real lock toggle recomputes only after the five-tick gate passes', () => {
  it('sim.setItemLocked is invisible within the window, then recomputes', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantOneCraftOf(sim, SWORD_RECIPE, pid);
    sim.trackGatheringRecipe(SWORD_RECIPE, 1, pid);
    const before = sim.gatheringGoalFor(pid);
    expect(before?.status).toBe('ready');

    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing meta');
    const idx = meta.inventory.findIndex((s) => s.itemId === 'wolf_fang');
    sim.setItemLocked('wolf_fang', true, pid, idx); // real command, exact slot named
    expect(sim.gatheringGoalFor(pid)).toBe(before);

    passRefreshWindow(sim);
    const after = sim.gatheringGoalFor(pid);
    expect(after).not.toBe(before);
    expect(after?.status).toBe('collecting');
    const row = after?.materials.find((m) => m.itemId === 'wolf_fang');
    expect(row).toMatchObject({ carried: 2, reachable: 0, missing: 0, inaccessible: 2 });
  });
});

describe('a name change recomputes only after the five-tick gate passes', () => {
  it('renaming the crafter (the self-signed discount input) is invisible within the window', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantOneCraftOf(sim, SWORD_RECIPE, pid);
    sim.trackGatheringRecipe(SWORD_RECIPE, 1, pid);
    const before = sim.gatheringGoalFor(pid);

    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing meta');
    meta.name = `${meta.name}-renamed`;
    expect(sim.gatheringGoalFor(pid)).toBe(before);

    passRefreshWindow(sim);
    const after = sim.gatheringGoalFor(pid);
    expect(after).not.toBe(before);
    expect(after?.status).toBe(before?.status);
  });
});

describe('a known-recipe change recomputes only after the five-tick gate passes', () => {
  it('learning a trainer-gated recipe mid-track is invisible within the window, then recomputes', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantOneCraftOf(sim, TRAINER_RECIPE, pid);
    sim.trackGatheringRecipe(TRAINER_RECIPE, 1, pid);
    const before = sim.gatheringGoalFor(pid);
    expect(before?.status).toBe('unavailable');
    expect(before?.reason).toBe('recipe_unavailable');

    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing meta');
    meta.knownRecipes.add(TRAINER_RECIPE);
    expect(sim.gatheringGoalFor(pid)).toBe(before);

    passRefreshWindow(sim);
    const after = sim.gatheringGoalFor(pid);
    expect(after).not.toBe(before);
    expect(after?.status).toBe('ready');
    expect(after?.reason).toBeNull();
  });
});

describe('a daily-limit stamp recomputes only after the five-tick gate passes', () => {
  it('stamping the oncePerDay recipe as already-crafted today is invisible within the window', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing meta');
    meta.knownRecipes.add(DAILY_RECIPE);
    grantOneCraftOf(sim, DAILY_RECIPE, pid);

    sim.trackGatheringRecipe(DAILY_RECIPE, 1, pid);
    const before = sim.gatheringGoalFor(pid);
    expect(before?.status).toBe('ready');

    meta.craftDaily = { date: '', crafted: new Set([DAILY_RECIPE]) };
    expect(sim.gatheringGoalFor(pid)).toBe(before);

    passRefreshWindow(sim);
    const after = sim.gatheringGoalFor(pid);
    expect(after).not.toBe(before);
    expect(after?.status).toBe('unavailable');
    expect(after?.reason).toBe('daily_limit');
  });
});
