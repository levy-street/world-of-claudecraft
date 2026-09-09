// Intentional Gathering PR4: live-Sim integration for the one explicit
// tracked gathering goal (sim.ts trackGatheringRecipe/trackGatheringCommission/
// clearGatheringGoal/gatheringGoalFor). Every expectation below is worked by
// hand against the real recipe content and a real two-player Sim; nothing
// here re-derives its answer from the module under test.

import { describe, expect, it } from 'vitest';
import { recipeById } from '../src/sim/content/recipes';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { runCraft } from './helpers/enchant_family_cast';

const SWORD_RECIPE = 'recipe_eastbrook_arming_sword'; // wolf_fang 2, bone_fragments 4, smithing_flux 6

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function entityOf(sim: Sim, pid: number): Entity {
  const entity = sim.ctx.entities.get(pid);
  if (!entity) throw new Error(`missing entity ${pid}`);
  return entity;
}

function makeTwoPlayerSim(seed = 7) {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, noPlayer: true });
  const requester = sim.addPlayer('warrior', 'Ayla');
  const crafter = sim.addPlayer('warrior', 'Borin');
  const re = entityOf(sim, requester);
  const ce = entityOf(sim, crafter);
  ce.pos.x = re.pos.x + 2;
  ce.pos.z = re.pos.z;
  return { sim, requester, crafter };
}

function grantOneCraftOf(sim: Sim, recipeId: string, pid: number) {
  const recipe = recipeById(recipeId);
  if (!recipe) throw new Error(`missing recipe ${recipeId}`);
  for (const reagent of recipe.reagents) sim.addItem(reagent.itemId, reagent.count, pid);
}

describe('trackGatheringRecipe: a count above what is currently craftable', () => {
  it('tracks a collecting goal with an exact, hand-computed material bill', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantOneCraftOf(sim, SWORD_RECIPE, pid); // exactly 1 craft's worth: 2/4/6

    expect(sim.trackGatheringRecipe(SWORD_RECIPE, 3, pid)).toBe(true);
    const view = sim.gatheringGoalFor(pid);
    expect(view).not.toBeNull();
    expect(view?.goal).toEqual({ kind: 'recipe', recipeId: SWORD_RECIPE, count: 3 });
    expect(view?.status).toBe('collecting');
    expect(view?.reason).toBeNull();
    // Only craft 1 is fully payable: material for craft 2 runs out.
    expect(view?.payableCrafts).toBe(1);
    expect(view?.storageRestricted).toBe(false);
    expect(view?.materials).toEqual([
      {
        itemId: 'wolf_fang',
        required: 6,
        carried: 2,
        stored: 0,
        reachable: 2,
        missing: 4,
        inaccessible: 0,
      },
      {
        itemId: 'bone_fragments',
        required: 12,
        carried: 4,
        stored: 0,
        reachable: 4,
        missing: 8,
        inaccessible: 0,
      },
      {
        itemId: 'smithing_flux',
        required: 18,
        carried: 6,
        stored: 0,
        reachable: 6,
        missing: 12,
        inaccessible: 0,
      },
    ]);
  });

  it('reaches ready once every reagent is fully covered', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantOneCraftOf(sim, SWORD_RECIPE, pid);

    expect(sim.trackGatheringRecipe(SWORD_RECIPE, 1, pid)).toBe(true);
    const view = sim.gatheringGoalFor(pid);
    expect(view?.status).toBe('ready');
    expect(view?.payableCrafts).toBe(1);
  });
});

describe('replacing or clearing a goal never touches harvest preference', () => {
  it('preference survives track, replace, and clear', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setHarvestPreference('wolf_fang', pid);
    const before = sim.harvestPreferenceFor(pid);
    expect(before).toEqual({ kind: 'material', itemId: 'wolf_fang' });

    grantOneCraftOf(sim, SWORD_RECIPE, pid);
    sim.trackGatheringRecipe(SWORD_RECIPE, 1, pid);
    expect(sim.harvestPreferenceFor(pid)).toEqual(before);

    sim.trackGatheringRecipe(SWORD_RECIPE, 2, pid); // replace
    expect(sim.harvestPreferenceFor(pid)).toEqual(before);

    sim.clearGatheringGoal(pid);
    expect(sim.harvestPreferenceFor(pid)).toEqual(before);
    expect(sim.gatheringGoalFor(pid)).toBeNull();
  });
});

describe('malformed track requests preserve the previous goal', () => {
  it('an out-of-range or non-integer count leaves the existing goal untouched and refuses', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    expect(sim.trackGatheringRecipe(SWORD_RECIPE, 5, pid)).toBe(true);

    for (const badCount of [0, 51, Number.NaN, 2.5, -1]) {
      expect(sim.trackGatheringRecipe(SWORD_RECIPE, badCount, pid)).toBe(false);
      expect(sim.gatheringGoalFor(pid)?.goal).toEqual({
        kind: 'recipe',
        recipeId: SWORD_RECIPE,
        count: 5,
      });
    }
  });

  it('an unknown recipe id leaves the existing goal untouched and refuses', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    expect(sim.trackGatheringRecipe(SWORD_RECIPE, 2, pid)).toBe(true);
    expect(sim.trackGatheringRecipe('qa_no_such_recipe', 2, pid)).toBe(false);
    expect(sim.gatheringGoalFor(pid)?.goal).toEqual({
      kind: 'recipe',
      recipeId: SWORD_RECIPE,
      count: 2,
    });
  });
});

describe('trackGatheringCommission: wrong-player and open-order refusal', () => {
  it('refuses an order still open (nobody has accepted it yet)', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    sim.openCommissionOrder(SWORD_RECIPE, 'open', undefined, requester);
    const orderId = sim.commissionOrdersFor(requester)[0].id;

    expect(sim.trackGatheringCommission(orderId, crafter)).toBe(false);
    expect(sim.gatheringGoalFor(crafter)).toBeNull();
  });

  it('refuses an order accepted by a different player', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: false, noPlayer: true });
    const requester = sim.addPlayer('warrior', 'Ayla');
    const crafter = sim.addPlayer('warrior', 'Borin');
    const bystander = sim.addPlayer('warrior', 'Carys');
    sim.openCommissionOrder(SWORD_RECIPE, 'open', undefined, requester);
    const orderId = sim.commissionOrdersFor(requester)[0].id;
    sim.acceptCommissionOrder(orderId, crafter);

    expect(sim.trackGatheringCommission(orderId, bystander)).toBe(false);
    expect(sim.gatheringGoalFor(bystander)).toBeNull();
    // The real accepter can still track it.
    expect(sim.trackGatheringCommission(orderId, crafter)).toBe(true);
  });

  it('preserves a previously tracked goal when a bad commission track is attempted', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    grantOneCraftOf(sim, SWORD_RECIPE, crafter);
    sim.trackGatheringRecipe(SWORD_RECIPE, 1, crafter);
    sim.openCommissionOrder(SWORD_RECIPE, 'open', undefined, requester);
    const orderId = sim.commissionOrdersFor(requester)[0].id;

    expect(sim.trackGatheringCommission(orderId, crafter)).toBe(false); // still open
    expect(sim.gatheringGoalFor(crafter)?.goal).toEqual({
      kind: 'recipe',
      recipeId: SWORD_RECIPE,
      count: 1,
    });
  });
});

describe('an accepted commission goal follows the order to its real terminal status', () => {
  it('delivered: the real accept/craft/deliver flow settles the tracked goal to delivered', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    sim.openCommissionOrder(SWORD_RECIPE, 'open', undefined, requester);
    const orderId = sim.commissionOrdersFor(requester)[0].id;
    sim.acceptCommissionOrder(orderId, crafter);
    expect(sim.trackGatheringCommission(orderId, crafter)).toBe(true);

    // Freshly accepted, no materials yet: falls through to the ordinary
    // material projection (count 1), not a stopped/terminal view.
    expect(sim.gatheringGoalFor(crafter)?.status).toBe('collecting');

    grantOneCraftOf(sim, SWORD_RECIPE, crafter);
    runCraft(sim, SWORD_RECIPE, true, crafter, 1);
    sim.deliverCommissionOrder(orderId, crafter);
    expect(sim.commissionOrderBoard.find((o) => o.id === orderId)?.status).toBe('delivered');

    const view = sim.gatheringGoalFor(crafter);
    expect(view?.status).toBe('delivered');
    expect(view?.reason).toBeNull();
    expect(view?.materials).toEqual([]);
    expect(view?.payableCrafts).toBe(0);
  });

  it('cancelled and expired: any terminal order status the board reaches is reflected verbatim', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    sim.openCommissionOrder(SWORD_RECIPE, 'open', undefined, requester);
    const orderId = sim.commissionOrdersFor(requester)[0].id;
    sim.acceptCommissionOrder(orderId, crafter);
    sim.trackGatheringCommission(orderId, crafter);

    const order = sim.commissionOrderBoard.find((o) => o.id === orderId);
    if (!order) throw new Error('missing order');
    order.status = 'cancelled';
    expect(sim.gatheringGoalFor(crafter)?.status).toBe('cancelled');

    order.status = 'expired';
    expect(sim.gatheringGoalFor(crafter)?.status).toBe('expired');
  });
});

describe('reload never resurrects a live commission binding from a saved numeric id', () => {
  it('a reload stays unavailable, even against a still-live board; an explicit re-Track works', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    sim.openCommissionOrder(SWORD_RECIPE, 'open', undefined, requester);
    const staleOrderId = sim.commissionOrdersFor(requester)[0].id;
    sim.acceptCommissionOrder(staleOrderId, crafter);
    expect(sim.trackGatheringCommission(staleOrderId, crafter)).toBe(true);

    const saved = sim.serializeCharacter(crafter);
    expect(saved?.gatheringGoal).toEqual({
      kind: 'commission',
      recipeId: SWORD_RECIPE,
      orderId: staleOrderId,
      count: 1,
    });

    sim.removePlayer(crafter);
    const reloadedPid = sim.addPlayer('warrior', 'Borin', { state: saved ?? undefined });
    // The saved goal is restored, but never the live order binding: the exact
    // same order id, now bound to a different (departed) identity, reads
    // unavailable rather than silently reconnecting.
    const reloadedView = sim.gatheringGoalFor(reloadedPid);
    expect(reloadedView?.goal).toEqual({
      kind: 'commission',
      recipeId: SWORD_RECIPE,
      orderId: staleOrderId,
      count: 1,
    });
    expect(reloadedView?.status).toBe('unavailable');
    expect(reloadedView?.reason).toBe('commission_unavailable');

    // A fresh accepted order for the reloaded identity can be tracked
    // explicitly, superseding the stale saved selection.
    sim.openCommissionOrder(SWORD_RECIPE, 'open', undefined, requester);
    const freshOrderId = sim.commissionOrdersFor(requester)[0].id;
    expect(freshOrderId).not.toBe(staleOrderId);
    sim.acceptCommissionOrder(freshOrderId, reloadedPid);
    expect(sim.trackGatheringCommission(freshOrderId, reloadedPid)).toBe(true);
    expect(sim.gatheringGoalFor(reloadedPid)?.goal).toEqual({
      kind: 'commission',
      recipeId: SWORD_RECIPE,
      orderId: freshOrderId,
      count: 1,
    });
  });
});

describe('serialization never carries the derived view, cache, or live order binding', () => {
  it('serializes exactly the compact selection, nothing else', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantOneCraftOf(sim, SWORD_RECIPE, pid);
    sim.trackGatheringRecipe(SWORD_RECIPE, 4, pid);
    sim.gatheringGoalFor(pid); // populate the derived cache before serializing

    const saved = sim.serializeCharacter(pid);
    expect(saved?.gatheringGoal).toEqual({
      kind: 'recipe',
      recipeId: SWORD_RECIPE,
      count: 4,
    });
    expect(Object.keys(saved?.gatheringGoal ?? {})).toEqual(['kind', 'recipeId', 'count']);
  });

  it('omits the key entirely while no goal is tracked', () => {
    const sim = makeSim();
    const saved = sim.serializeCharacter(sim.playerId);
    expect(saved && 'gatheringGoal' in saved).toBe(false);
  });
});

describe('primary vs explicit pid isolation', () => {
  it('tracking an explicit pid never affects the primary player’s own goal', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim(); // primary === requester
    expect(sim.playerId).toBe(requester);

    grantOneCraftOf(sim, SWORD_RECIPE, crafter);
    expect(sim.trackGatheringRecipe(SWORD_RECIPE, 1, crafter)).toBe(true);
    expect(sim.gatheringGoal).toBeNull(); // primary (requester) untouched
    expect(sim.gatheringGoalFor(crafter)?.goal).toEqual({
      kind: 'recipe',
      recipeId: SWORD_RECIPE,
      count: 1,
    });

    grantOneCraftOf(sim, SWORD_RECIPE, requester);
    expect(sim.trackGatheringRecipe(SWORD_RECIPE, 2)).toBe(true); // defaults to primaryId
    expect(sim.gatheringGoal?.goal).toEqual({
      kind: 'recipe',
      recipeId: SWORD_RECIPE,
      count: 2,
    });
    // The crafter's own goal is unchanged by the primary's track.
    expect(sim.gatheringGoalFor(crafter)?.goal).toEqual({
      kind: 'recipe',
      recipeId: SWORD_RECIPE,
      count: 1,
    });
  });
});

describe('goal reads mutate nothing: inventory, bank, vault, and rng stay untouched', () => {
  it('repeated gatheringGoalFor reads draw no rng and never mutate holdings', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantOneCraftOf(sim, SWORD_RECIPE, pid);
    sim.trackGatheringRecipe(SWORD_RECIPE, 5, pid);

    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing meta');
    const inventorySnapshot = structuredClone(meta.inventory);
    const bankSnapshot = structuredClone(meta.bank);
    const vaultSnapshot = structuredClone(meta.vault);

    const draws: number[] = [];
    sim.ctx.rng.setObserver((v) => draws.push(v));
    sim.gatheringGoalFor(pid);
    sim.gatheringGoalFor(pid);
    sim.gatheringGoalFor(pid);
    sim.ctx.rng.setObserver(null);

    expect(draws).toEqual([]);
    expect(meta.inventory).toEqual(inventorySnapshot);
    expect(meta.bank).toEqual(bankSnapshot);
    expect(meta.vault).toEqual(vaultSnapshot);
  });
});
