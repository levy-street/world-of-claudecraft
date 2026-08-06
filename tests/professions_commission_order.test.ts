// Commission order board (Professions 2.0, issue #1298): a lightweight job
// board layered on top of the Maker's Bond bind-on-trade primitive (#2207,
// pinned in tests/professions_commissions.test.ts). Covers open/cancel/
// accept/deliver, the deny orders, the per-viewer projection, the retention
// sweep, determinism, the ClientWorld send shapes, and one live-GameServer
// wire arc. Harness modeled on tests/professions_commissions.test.ts.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import {
  acceptCommissionOrder,
  cancelCommissionOrder,
  commissionOrdersFor,
  deliverCommissionOrder,
  openCommissionOrder,
  updateCommissionOrders,
} from '../src/sim/professions/commission_order';
import { craftItem as craftItemMod } from '../src/sim/professions/crafting';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, InvSlot, SimEvent } from '../src/sim/types';
import { completeCraftCast } from './helpers/enchant_family_cast';

const SWORD_RECIPE = 'recipe_eastbrook_arming_sword';
const SWORD = 'eastbrook_arming_sword'; // weapon, commission-eligible
const POTION_RECIPE = 'recipe_minor_healing_potion';

function recipeOf(id: string): ProfessionRecipeRecord {
  const recipe = ALL_RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`missing recipe ${id}`);
  return recipe;
}

function grantReagents(sim: Sim, recipeId: string, pid: number, crafts = 1): void {
  const recipe = recipeOf(recipeId);
  for (const reagent of recipe.reagents) {
    sim.addItem(reagent.itemId, reagent.count * crafts, pid);
  }
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

function entityOf(sim: Sim, pid: number): Entity {
  const entity = sim.ctx.entities.get(pid);
  if (!entity) throw new Error(`missing entity ${pid}`);
  return entity;
}

function metaOf(sim: Sim, pid: number): PlayerMeta {
  const meta = sim.players.get(pid);
  if (!meta) throw new Error(`missing player meta ${pid}`);
  return meta;
}

function slotsOf(sim: Sim, pid: number, itemId: string): InvSlot[] {
  return metaOf(sim, pid).inventory.filter((s) => s.itemId === itemId);
}

function countDraws<T>(sim: Sim, fn: () => T): { result: T; draws: number } {
  let draws = 0;
  sim.ctx.rng.setObserver(() => {
    draws += 1;
  });
  try {
    return { result: fn(), draws };
  } finally {
    sim.ctx.rng.setObserver(null);
  }
}

function orderResultEvents(events: SimEvent[]) {
  return events.filter((e) => e.type === 'commissionOrderResult') as Array<{
    type: 'commissionOrderResult';
    action: string;
    ok: boolean;
    orderId?: number;
    itemId?: string;
    reason?: string;
    pid?: number;
  }>;
}

// ---------------------------------------------------------------------------
// 1. Opening an order.
// ---------------------------------------------------------------------------
describe('openCommissionOrder', () => {
  it('opens an eligible recipe with scope "open" and no escrow charged', () => {
    const { sim, requester } = makeTwoPlayerSim();
    const before = metaOf(sim, requester).copper;
    const result = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    expect(result.ok).toBe(true);
    expect(result.orderId).toBeDefined();
    expect(metaOf(sim, requester).copper).toBe(before);
    const order = sim.commissionOrderBoard.find((o) => o.id === result.orderId);
    expect(order).toMatchObject({
      requesterId: requester,
      recipeId: SWORD_RECIPE,
      itemId: SWORD,
      scope: 'open',
      status: 'open',
    });
  });

  it('denies unknown_recipe for a bogus recipe id', () => {
    const { sim, requester } = makeTwoPlayerSim();
    const result = openCommissionOrder(sim.ctx, 'qa_no_such_recipe', 'open', undefined, requester);
    expect(result).toEqual({ ok: false, reason: 'unknown_recipe' });
  });

  it('denies not_commission_eligible for a non-equipment recipe (a potion)', () => {
    const { sim, requester } = makeTwoPlayerSim();
    const result = openCommissionOrder(sim.ctx, POTION_RECIPE, 'open', undefined, requester);
    expect(result).toEqual({ ok: false, reason: 'not_commission_eligible' });
  });

  it('scope "crafter" resolves the named player and denies unknown_crafter otherwise', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const ok = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'crafter', 'Borin', requester);
    expect(ok.ok).toBe(true);
    const order = sim.commissionOrderBoard.find((o) => o.id === ok.orderId);
    expect(order?.crafterId).toBe(crafter);
    expect(order?.crafterName).toBe('Borin');
    const deny = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'crafter', 'Nobody', requester);
    expect(deny).toEqual({ ok: false, reason: 'unknown_crafter' });
  });

  it('denies self_crafter when a "crafter" scope order names the requester themselves', () => {
    const { sim, requester } = makeTwoPlayerSim();
    const result = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'crafter', 'Ayla', requester);
    expect(result).toEqual({ ok: false, reason: 'self_crafter' });
  });

  it('caps a requester at 5 simultaneous open orders: the 6th denies too_many_open', () => {
    const { sim, requester } = makeTwoPlayerSim();
    for (let i = 0; i < 5; i++) {
      expect(openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester).ok).toBe(
        true,
      );
    }
    const sixth = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    expect(sixth).toEqual({ ok: false, reason: 'too_many_open' });
  });

  it('draws no rng', () => {
    const { sim, requester } = makeTwoPlayerSim();
    const { result, draws } = countDraws(sim, () =>
      openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester),
    );
    expect(result.ok).toBe(true);
    expect(draws).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Cancelling an order.
// ---------------------------------------------------------------------------
describe('cancelCommissionOrder', () => {
  it('cancels the caller’s own open order', () => {
    const { sim, requester } = makeTwoPlayerSim();
    const { orderId } = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    const result = cancelCommissionOrder(sim.ctx, orderId as number, requester);
    expect(result).toEqual({ ok: true, orderId });
    expect(sim.commissionOrderBoard.find((o) => o.id === orderId)?.status).toBe('cancelled');
  });

  it('denies unknown_order for a bogus id', () => {
    const { sim, requester } = makeTwoPlayerSim();
    expect(cancelCommissionOrder(sim.ctx, 999999, requester)).toEqual({
      ok: false,
      orderId: 999999,
      reason: 'unknown_order',
    });
  });

  it('denies not_your_order when a different player tries to cancel it', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const { orderId } = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    const result = cancelCommissionOrder(sim.ctx, orderId as number, crafter);
    expect(result).toEqual({ ok: false, orderId, reason: 'not_your_order' });
  });

  it('denies order_not_open once the order has been accepted', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const { orderId } = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    acceptCommissionOrder(sim.ctx, orderId as number, crafter);
    const result = cancelCommissionOrder(sim.ctx, orderId as number, requester);
    expect(result).toEqual({ ok: false, orderId, reason: 'order_not_open' });
  });
});

// ---------------------------------------------------------------------------
// 3. Accepting an order.
// ---------------------------------------------------------------------------
describe('acceptCommissionOrder', () => {
  it('an "open" scope order admits any crafter but the requester', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const { orderId } = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    const result = acceptCommissionOrder(sim.ctx, orderId as number, crafter);
    expect(result).toEqual({ ok: true, orderId });
    const order = sim.commissionOrderBoard.find((o) => o.id === orderId);
    expect(order?.status).toBe('accepted');
    expect(order?.acceptedBy).toBe(crafter);
    expect(order?.acceptedByName).toBe('Borin');
  });

  it('denies self_order when the requester tries to accept their own order', () => {
    const { sim, requester } = makeTwoPlayerSim();
    const { orderId } = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    const result = acceptCommissionOrder(sim.ctx, orderId as number, requester);
    expect(result).toEqual({ ok: false, orderId, reason: 'self_order' });
  });

  it('a "crafter" scope order denies not_eligible_crafter for anyone but the named target', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const stranger = sim.addPlayer('mage', 'Stranger');
    const { orderId } = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'crafter', 'Borin', requester);
    const denied = acceptCommissionOrder(sim.ctx, orderId as number, stranger);
    expect(denied).toEqual({ ok: false, orderId, reason: 'not_eligible_crafter' });
    const accepted = acceptCommissionOrder(sim.ctx, orderId as number, crafter);
    expect(accepted).toEqual({ ok: true, orderId });
  });

  it('denies order_not_open on a second accept attempt (replay safety)', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const stranger = sim.addPlayer('mage', 'Stranger');
    const { orderId } = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    expect(acceptCommissionOrder(sim.ctx, orderId as number, crafter).ok).toBe(true);
    const second = acceptCommissionOrder(sim.ctx, orderId as number, stranger);
    expect(second).toEqual({ ok: false, orderId, reason: 'order_not_open' });
  });
});

// ---------------------------------------------------------------------------
// 4. Delivering an order: the actual bind-on-trade handoff.
// ---------------------------------------------------------------------------
describe('deliverCommissionOrder', () => {
  function acceptedOrder(sim: Sim, requester: number, crafter: number): number {
    const { orderId } = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    acceptCommissionOrder(sim.ctx, orderId as number, crafter);
    return orderId as number;
  }

  it('stamps boundTo on the requester’s copy and removes it from the crafter’s bags', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const orderId = acceptedOrder(sim, requester, crafter);
    grantReagents(sim, SWORD_RECIPE, crafter);
    const craft = craftItemMod(sim.ctx, SWORD_RECIPE, true, crafter);
    expect(craft.ok).toBe(true);
    completeCraftCast(sim, crafter);
    const result = deliverCommissionOrder(sim.ctx, orderId, crafter);
    expect(result).toEqual({ ok: true, orderId, itemId: SWORD });
    expect(slotsOf(sim, crafter, SWORD)).toHaveLength(0);
    const received = slotsOf(sim, requester, SWORD);
    expect(received).toHaveLength(1);
    expect(received[0].instance?.boundTo).toBe(requester);
    expect(received[0].instance?.bindOnTrade).toBe(true);
    expect(sim.commissionOrderBoard.find((o) => o.id === orderId)?.status).toBe('delivered');
  });

  it('denies not_crafted when the crafter holds no unbound commissioned copy', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const orderId = acceptedOrder(sim, requester, crafter);
    const result = deliverCommissionOrder(sim.ctx, orderId, crafter);
    expect(result).toEqual({ ok: false, orderId, itemId: SWORD, reason: 'not_crafted' });
  });

  it('denies order_not_accepted before the order has been accepted', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const { orderId } = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    const result = deliverCommissionOrder(sim.ctx, orderId as number, crafter);
    expect(result).toEqual({ ok: false, orderId, reason: 'order_not_accepted' });
  });

  it('denies not_your_acceptance for a crafter who never accepted this order', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const stranger = sim.addPlayer('mage', 'Stranger');
    const orderId = acceptedOrder(sim, requester, crafter);
    const result = deliverCommissionOrder(sim.ctx, orderId, stranger);
    expect(result).toEqual({ ok: false, orderId, reason: 'not_your_acceptance' });
  });

  it('denies deliver_out_of_range when the requester has wandered off', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const orderId = acceptedOrder(sim, requester, crafter);
    grantReagents(sim, SWORD_RECIPE, crafter);
    craftItemMod(sim.ctx, SWORD_RECIPE, true, crafter);
    completeCraftCast(sim, crafter);
    entityOf(sim, requester).pos.x += 9999;
    const result = deliverCommissionOrder(sim.ctx, orderId, crafter);
    expect(result).toEqual({ ok: false, orderId, itemId: SWORD, reason: 'deliver_out_of_range' });
    expect(slotsOf(sim, crafter, SWORD)).toHaveLength(1);
  });

  it('a bound-but-not-armed copy (the pre-#2207 shape) does not satisfy delivery either', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const orderId = acceptedOrder(sim, requester, crafter);
    // A plain (never-commissioned) copy: not eligible to deliver.
    sim.addItem(SWORD, 1, crafter);
    const result = deliverCommissionOrder(sim.ctx, orderId, crafter);
    expect(result).toEqual({ ok: false, orderId, itemId: SWORD, reason: 'not_crafted' });
  });

  it('draws no rng', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const orderId = acceptedOrder(sim, requester, crafter);
    grantReagents(sim, SWORD_RECIPE, crafter);
    craftItemMod(sim.ctx, SWORD_RECIPE, true, crafter);
    completeCraftCast(sim, crafter);
    const { result, draws } = countDraws(sim, () =>
      deliverCommissionOrder(sim.ctx, orderId, crafter),
    );
    expect(result.ok).toBe(true);
    expect(draws).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. The per-viewer projection.
// ---------------------------------------------------------------------------
describe('commissionOrdersFor (the per-viewer projection)', () => {
  it("shows the requester's own order, and an open-board order to every viewer", () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const bystander = sim.addPlayer('mage', 'Bystander');
    openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    const mine = commissionOrdersFor(sim.ctx, requester);
    expect(mine).toHaveLength(1);
    expect(mine[0].mine).toBe(true);
    expect(mine[0].mineToCraft).toBe(false);
    const board = commissionOrdersFor(sim.ctx, crafter);
    expect(board).toHaveLength(1);
    expect(board[0].mine).toBe(false);
    expect(board[0].mineToCraft).toBe(false);
    expect(commissionOrdersFor(sim.ctx, bystander)).toHaveLength(1);
  });

  it('a "crafter"-scoped order is visible only to its target and the requester, not a bystander', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const bystander = sim.addPlayer('mage', 'Bystander');
    openCommissionOrder(sim.ctx, SWORD_RECIPE, 'crafter', 'Borin', requester);
    expect(commissionOrdersFor(sim.ctx, requester)).toHaveLength(1);
    const forCrafter = commissionOrdersFor(sim.ctx, crafter);
    expect(forCrafter).toHaveLength(1);
    expect(forCrafter[0].mineToCraft).toBe(true);
    expect(commissionOrdersFor(sim.ctx, bystander)).toHaveLength(0);
  });

  it('an accepted order keeps showing to its crafter as mineToCraft even off the open board', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const bystander = sim.addPlayer('mage', 'Bystander');
    const { orderId } = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    acceptCommissionOrder(sim.ctx, orderId as number, crafter);
    expect(commissionOrdersFor(sim.ctx, bystander)).toHaveLength(0); // left the open board
    const mine = commissionOrdersFor(sim.ctx, crafter);
    expect(mine).toHaveLength(1);
    expect(mine[0].mineToCraft).toBe(true);
    expect(mine[0].status).toBe('accepted');
  });

  it('newest first', () => {
    const { sim, requester } = makeTwoPlayerSim();
    const first = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    const second = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    const rows = commissionOrdersFor(sim.ctx, requester);
    expect(rows.map((r) => r.id)).toEqual([second.orderId, first.orderId]);
  });
});

// ---------------------------------------------------------------------------
// 6. The retention sweep.
// ---------------------------------------------------------------------------
describe('updateCommissionOrders (the retention sweep)', () => {
  it('expires a stale open order past 24 sim-hours and prunes it after the retain window', () => {
    const { sim, requester } = makeTwoPlayerSim();
    const { orderId } = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    const order = sim.commissionOrderBoard.find((o) => o.id === orderId);
    if (!order) throw new Error('missing order');
    order.openedAt = sim.ctx.time - 24 * 3600 - 1;
    updateCommissionOrders(sim.ctx);
    expect(sim.commissionOrderBoard.find((o) => o.id === orderId)?.status).toBe('expired');
    const expired = sim.commissionOrderBoard.find((o) => o.id === orderId);
    if (!expired) throw new Error('missing order');
    expired.settledAt = sim.ctx.time - 10 * 60 - 1;
    updateCommissionOrders(sim.ctx);
    expect(sim.commissionOrderBoard.find((o) => o.id === orderId)).toBeUndefined();
  });

  it('prunes a cancelled order once past the retain window, keeps it before', () => {
    const { sim, requester } = makeTwoPlayerSim();
    const { orderId } = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    cancelCommissionOrder(sim.ctx, orderId as number, requester);
    updateCommissionOrders(sim.ctx);
    expect(sim.commissionOrderBoard.find((o) => o.id === orderId)).toBeDefined();
    const order = sim.commissionOrderBoard.find((o) => o.id === orderId);
    if (!order) throw new Error('missing order');
    order.settledAt = sim.ctx.time - 10 * 60 - 1;
    updateCommissionOrders(sim.ctx);
    expect(sim.commissionOrderBoard.find((o) => o.id === orderId)).toBeUndefined();
  });

  it('leaves an accepted (non-terminal) order alone regardless of age', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    const { orderId } = openCommissionOrder(sim.ctx, SWORD_RECIPE, 'open', undefined, requester);
    acceptCommissionOrder(sim.ctx, orderId as number, crafter);
    const order = sim.commissionOrderBoard.find((o) => o.id === orderId);
    if (!order) throw new Error('missing order');
    order.openedAt = sim.ctx.time - 999 * 3600;
    updateCommissionOrders(sim.ctx);
    expect(sim.commissionOrderBoard.find((o) => o.id === orderId)?.status).toBe('accepted');
  });
});

// ---------------------------------------------------------------------------
// 7. The Sim facade: personal text-free events.
// ---------------------------------------------------------------------------
describe('the Sim facade emits the personal text-free commissionOrderResult event', () => {
  it('open/accept/deliver each carry their own action tag and pid', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    sim.drainEvents();
    sim.openCommissionOrder(SWORD_RECIPE, 'open', undefined, requester);
    let events = orderResultEvents(sim.drainEvents());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'open', ok: true, pid: requester });
    const orderId = events[0].orderId as number;

    sim.acceptCommissionOrder(orderId, crafter);
    events = orderResultEvents(sim.drainEvents());
    expect(events).toHaveLength(1);
    // itemId is resolved off the live board for open/cancel/accept too (not
    // just deliver's own DeliverOrderResult), so the client can render "You
    // accept the commission order for {item}." without a second lookup.
    expect(events[0]).toMatchObject({
      type: 'commissionOrderResult',
      action: 'accept',
      ok: true,
      orderId,
      itemId: SWORD,
      pid: crafter,
    });
    expect(events[0].reason).toBeUndefined();

    grantReagents(sim, SWORD_RECIPE, crafter);
    sim.craftItem(SWORD_RECIPE, true, crafter, 1);
    completeCraftCast(sim, crafter);
    sim.drainEvents();
    sim.deliverCommissionOrder(orderId, crafter);
    events = orderResultEvents(sim.drainEvents());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'commissionOrderResult',
      action: 'deliver',
      ok: true,
      orderId,
      itemId: SWORD,
      pid: crafter,
    });
    expect(events[0].reason).toBeUndefined();
  });

  it('a cancel deny carries the reason and no error toast (single-surface rule)', () => {
    const { sim, requester, crafter } = makeTwoPlayerSim();
    sim.drainEvents();
    sim.cancelCommissionOrder(999999, crafter);
    const events = orderResultEvents(sim.drainEvents());
    expect(events).toEqual([
      {
        type: 'commissionOrderResult',
        action: 'cancel',
        ok: false,
        orderId: 999999,
        reason: 'unknown_order',
        pid: crafter,
      },
    ]);
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
    void requester;
  });
});

// ---------------------------------------------------------------------------
// 8. Determinism.
// ---------------------------------------------------------------------------
describe('determinism: the order-board arc replays byte-identically', () => {
  it('two same-seed sims running the same open/accept/craft/deliver sequence agree', () => {
    const run = () => {
      const sim = new Sim({ seed: 55, playerClass: 'warrior', autoEquip: false, noPlayer: true });
      const requester = sim.addPlayer('warrior', 'Ayla');
      const crafter = sim.addPlayer('warrior', 'Borin');
      entityOf(sim, crafter).pos.x = entityOf(sim, requester).pos.x + 2;
      entityOf(sim, crafter).pos.z = entityOf(sim, requester).pos.z;
      sim.openCommissionOrder(SWORD_RECIPE, 'open', undefined, requester);
      const orderId = sim.commissionOrderBoard[0].id;
      sim.acceptCommissionOrder(orderId, crafter);
      grantReagents(sim, SWORD_RECIPE, crafter);
      sim.craftItem(SWORD_RECIPE, true, crafter, 1);
      completeCraftCast(sim, crafter);
      sim.deliverCommissionOrder(orderId, crafter);
      for (let i = 0; i < 40; i++) sim.tick();
      return JSON.stringify({
        inv: metaOf(sim, requester).inventory,
        board: sim.commissionOrderBoard,
      });
    };
    expect(run()).toBe(run());
  });
});

// ---------------------------------------------------------------------------
// 9. The wire: ClientWorld send shapes.
// ---------------------------------------------------------------------------
describe('ClientWorld command send shapes', () => {
  function clientWithCapture(): { client: ClientWorld; sent: Record<string, unknown>[] } {
    const client = Object.create(ClientWorld.prototype) as ClientWorld;
    (client as unknown as { spectating: null }).spectating = null;
    const sent: Record<string, unknown>[] = [];
    (client as unknown as { rawCmd(p: Record<string, unknown>): void }).rawCmd = (p) =>
      sent.push(p);
    return { client, sent };
  }

  it('openCommissionOrder omits the crafter field for scope "open"', () => {
    const { client, sent } = clientWithCapture();
    client.openCommissionOrder(SWORD_RECIPE, 'open');
    expect(sent).toEqual([{ cmd: 'open_commission_order', recipe: SWORD_RECIPE, scope: 'open' }]);
  });

  it('openCommissionOrder carries the crafter name for scope "crafter"', () => {
    const { client, sent } = clientWithCapture();
    client.openCommissionOrder(SWORD_RECIPE, 'crafter', 'Borin');
    expect(sent).toEqual([
      { cmd: 'open_commission_order', recipe: SWORD_RECIPE, scope: 'crafter', crafter: 'Borin' },
    ]);
  });

  it('cancel/accept/deliver each send their order id', () => {
    const { client, sent } = clientWithCapture();
    client.cancelCommissionOrder(7);
    client.acceptCommissionOrder(7);
    client.deliverCommissionOrder(7);
    expect(sent).toEqual([
      { cmd: 'cancel_commission_order', order: 7 },
      { cmd: 'accept_commission_order', order: 7 },
      { cmd: 'deliver_commission_order', order: 7 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 10. Live GameServer arc: open -> accept -> craft -> deliver over the wire.
// ---------------------------------------------------------------------------
describe('live GameServer: the commission order board over the real wire', () => {
  type WireMsg = { t: string; list?: SimEvent[]; self?: Record<string, unknown> };

  function fakeWs(): { sent: WireMsg[]; ws: unknown } {
    const sent: WireMsg[] = [];
    return {
      sent,
      ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) },
    };
  }

  function joinServer(
    server: GameServer,
    fc: ReturnType<typeof fakeWs>,
    id: number,
    name: string,
  ): ClientSession {
    const session = server.join(fc.ws as never, id, id, name, 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    return session;
  }

  function placeAt(server: GameServer, pid: number, pos: { x: number; z: number }): void {
    const entity = entityOf(server.sim, pid);
    entity.pos.x = pos.x;
    entity.pos.z = pos.z;
    entity.prevPos = { ...entity.pos };
  }

  function routeTick(server: GameServer): void {
    // Profession crafts are cast-paced: flush every player's craft cast after
    // the command tick so the online arc still sees a completed craft.
    (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(server.sim.tick());
    for (const pid of server.sim.players.keys()) {
      completeCraftCast(server.sim, pid);
    }
    (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(server.sim.tick());
  }

  function broadcast(server: GameServer): void {
    (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();
  }

  function cmd(server: GameServer, session: ClientSession, body: Record<string, unknown>): void {
    server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));
  }

  function lastCorderFrom(sent: WireMsg[], fromIdx: number): unknown {
    for (let i = sent.length - 1; i >= fromIdx; i--) {
      const m = sent[i];
      if (m.t === 'snap' && m.self && 'corder' in m.self) return m.self.corder;
    }
    return undefined;
  }

  it('runs the full arc: open -> accept -> craft -> deliver, both viewers converge on corder', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const fb = fakeWs();
    const sa = joinServer(server, fa, 901, 'Requester');
    const sb = joinServer(server, fb, 902, 'Crafter');
    placeAt(server, sa.pid, { x: 0, z: 150 });
    placeAt(server, sb.pid, { x: 2, z: 150 });

    cmd(server, sa, { cmd: 'open_commission_order', recipe: SWORD_RECIPE, scope: 'open' });
    routeTick(server);
    const order = server.sim.commissionOrderBoard[0];
    expect(order).toBeDefined();
    expect(order.recipeId).toBe(SWORD_RECIPE);

    broadcast(server);
    const boardForCrafter = lastCorderFrom(fb.sent, 0) as Array<{ id: number; status: string }>;
    expect(boardForCrafter?.some((o) => o.id === order.id && o.status === 'open')).toBe(true);

    cmd(server, sb, { cmd: 'accept_commission_order', order: order.id });
    routeTick(server);
    expect(server.sim.commissionOrderBoard.find((o) => o.id === order.id)?.status).toBe('accepted');

    broadcast(server);
    const boardForRequester = lastCorderFrom(fa.sent, 0) as Array<{ id: number; status: string }>;
    expect(boardForRequester?.some((o) => o.id === order.id && o.status === 'accepted')).toBe(true);

    for (const reagent of recipeOf(SWORD_RECIPE).reagents) {
      server.sim.addItem(reagent.itemId, reagent.count, sb.pid);
    }
    cmd(server, sb, { cmd: 'craft_item', recipe: SWORD_RECIPE, commission: true });
    routeTick(server);
    expect(server.sim.players.get(sb.pid)?.inventory.some((s) => s.itemId === SWORD)).toBe(true);

    // The crafter's arm removes the delivered copy directly from
    // PlayerMeta.inventory (no addItem/removeItem call), so the flush/negative-
    // control pattern from professions_commissions.test.ts proves
    // commissionOrderResult is what re-diffs their inv on the NEXT snapshot.
    broadcast(server);
    const deliverFrom = fb.sent.length;
    cmd(server, sb, { cmd: 'deliver_commission_order', order: order.id });
    routeTick(server);
    expect(server.sim.commissionOrderBoard.find((o) => o.id === order.id)?.status).toBe(
      'delivered',
    );
    expect(server.sim.players.get(sb.pid)?.inventory.some((s) => s.itemId === SWORD)).toBe(false);
    const requesterSword = server.sim.players
      .get(sa.pid)
      ?.inventory.find((s) => s.itemId === SWORD);
    expect(requesterSword?.instance?.boundTo).toBe(sa.pid);

    broadcast(server);
    const lastInvFrom = (fromIdx: number) => {
      for (let i = fb.sent.length - 1; i >= fromIdx; i--) {
        const m = fb.sent[i];
        if (m.t === 'snap' && m.self && 'inv' in m.self) return m.self.inv as InvSlot[];
      }
      return null;
    };
    const crafterInv = lastInvFrom(deliverFrom);
    expect(
      crafterInv,
      'commissionOrderResult re-diffed the crafter’s heavy inv mirror',
    ).not.toBeNull();
    expect(crafterInv?.some((s) => s.itemId === SWORD)).toBe(false);
  });
});
