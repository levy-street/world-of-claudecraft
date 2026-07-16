// Direct unit tests for the extracted trade module (src/sim/social/trade.ts).
// The module is driven through a minimal fake SimContext (no full Sim): players
// carry REAL bags-shaped PlayerMeta.inventory arrays (not a parallel bag Map), and
// the inventory hub callbacks (countFungibleItem/removeFungibleItem/addItem/
// addItemInstance/canAddItem) are thin wrappers over the real bags.ts capacity/
// stacking math, so these tests exercise the actual fungible/instance-aware
// inventory logic, not a mirrored stub. This proves the trade logic is decoupled
// and exercises the swap, the guards, the instance-payload path, the external
// (Claudium/$WOC) escrow lane, the cancel path, and the updateTradesAndInvites
// invite-expiry + drift sweep.

import { describe, expect, it, vi } from 'vitest';
import { bagCapacity, canAddItem as bagsCanAddItem } from '../src/sim/bags';
import type { SimContext } from '../src/sim/sim_context';
import * as tradeMod from '../src/sim/social/trade';
import type { ItemInstancePayload, TradeRailsView } from '../src/sim/types';

const OFFLINE_RAILS: TradeRailsView = {
  claudium: { available: false, balance: 0 },
  woc: { available: false, linked: false },
};

function makeTradeCtx() {
  const players = new Map<number, any>();
  const entities = new Map<number, any>();
  const trades = new Map<number, any>();
  const tradeInvites = new Map<number, { fromPid: number; expires: number }>();
  const partyInvites = new Map<number, { fromPid: number; expires: number }>();
  const duelInvites = new Map<number, { fromPid: number; expires: number }>();
  const events: any[] = [];
  const letters: any[] = [];
  const railsByPid = new Map<number, TradeRailsView>();
  const bumpDeedStat = vi.fn();
  let time = 0;

  const ctx = {
    get time() {
      return time;
    },
    players,
    entities,
    trades,
    tradeInvites,
    partyInvites,
    duelInvites,
    resolve: (pid?: number) => {
      const meta = players.get(pid!);
      const e = entities.get(pid!);
      return meta && e ? { meta, e } : null;
    },
    error: (pid: number, text: string) => events.push({ type: 'error', pid, text }),
    bumpDeedStat,
    emit: (ev: any) => events.push(ev),
    hasPendingSocialInvite: (tp: number) =>
      partyInvites.has(tp) || tradeInvites.has(tp) || duelInvites.has(tp),
    countItem: (itemId: string, pid?: number) => {
      const meta = players.get(pid!);
      if (!meta) return 0;
      let n = 0;
      for (const s of meta.inventory) if (s.itemId === itemId) n += s.count;
      return n;
    },
    // Fungible-only count/removal (#1165): excludes per-instance slots, mirroring
    // the real Sim hub exactly, so an instanced copy is never counted or consumed
    // as if it were a plain stack member.
    countFungibleItem: (itemId: string, pid?: number) => {
      const meta = players.get(pid!);
      if (!meta) return 0;
      let n = 0;
      for (const s of meta.inventory) if (s.itemId === itemId && !s.instance) n += s.count;
      return n;
    },
    addItem: (itemId: string, count: number, pid?: number) => {
      const meta = players.get(pid!);
      if (!meta) return;
      const stack = 20;
      let remaining = count;
      for (const s of meta.inventory) {
        if (remaining <= 0) break;
        if (s.itemId !== itemId || s.instance || s.count >= stack) continue;
        const take = Math.min(stack - s.count, remaining);
        s.count += take;
        remaining -= take;
      }
      while (remaining > 0) {
        const take = Math.min(stack, remaining);
        meta.inventory.push({ itemId, count: take });
        remaining -= take;
      }
    },
    addItemInstance: (itemId: string, instance: ItemInstancePayload, pid?: number) => {
      const meta = players.get(pid!);
      if (!meta) return;
      meta.inventory.push({ itemId, count: 1, instance });
    },
    removeItem: (itemId: string, count: number, pid?: number) => {
      const consumed: ItemInstancePayload[] = [];
      const meta = players.get(pid!);
      if (!meta) return consumed;
      for (let i = meta.inventory.length - 1; i >= 0 && count > 0; i--) {
        const s = meta.inventory[i];
        if (s.itemId !== itemId) continue;
        if (s.instance) consumed.push(s.instance);
        const take = Math.min(s.count, count);
        s.count -= take;
        count -= take;
        if (s.count <= 0) meta.inventory.splice(i, 1);
      }
      return consumed;
    },
    removeFungibleItem: (itemId: string, count: number, pid?: number) => {
      const meta = players.get(pid!);
      if (!meta) return;
      for (let i = meta.inventory.length - 1; i >= 0 && count > 0; i--) {
        const s = meta.inventory[i];
        if (s.itemId !== itemId || s.instance) continue;
        const take = Math.min(s.count, count);
        s.count -= take;
        count -= take;
        if (s.count <= 0) meta.inventory.splice(i, 1);
      }
    },
    canAddItem: (itemId: string, count: number, pid?: number) => {
      const meta = players.get(pid!);
      if (!meta) return false;
      return bagsCanAddItem(meta.inventory, bagCapacity(meta.bags), itemId, count);
    },
    tradeRails: (pid: number): TradeRailsView => railsByPid.get(pid) ?? OFFLINE_RAILS,
    tradeMailKey: (pid: number) => `char-${pid}`,
    sendTradeLetter: (
      recipientKey: string,
      recipientName: string,
      flavor: 'delivery' | 'refund',
      copper: number,
      items: any[],
    ) => letters.push({ recipientKey, recipientName, flavor, copper, items }),
  } as unknown as SimContext;

  function addPlayer(pid: number, name: string, x: number, copper: number) {
    // inventory/bags are the real PlayerMeta fields the capacity gate + the
    // fungible/instance hub above read; there is no separate parallel bag store.
    players.set(pid, {
      entityId: pid,
      name,
      copper,
      inventory: [],
      bags: [null, null, null, null],
    });
    entities.set(pid, { id: pid, pos: { x, y: 0, z: 0 }, dead: false });
  }

  // Direct grant helpers for test setup (bypass the sim's loot/deed side effects,
  // which this fake host never wires up).
  const give = (pid: number, itemId: string, count: number) =>
    (ctx as any).addItem(itemId, count, pid);
  const giveInstance = (pid: number, itemId: string, instance: ItemInstancePayload) =>
    (ctx as any).addItemInstance(itemId, instance, pid);
  const fillBags = (pid: number, capacity = 16) => {
    const meta = players.get(pid)!;
    let n = 0;
    while (meta.inventory.length < capacity) {
      meta.inventory.push({ itemId: `filler_${n++}`, count: 1 });
    }
  };
  const setRails = (pid: number, view: TradeRailsView) => railsByPid.set(pid, view);

  return {
    ctx,
    players,
    entities,
    trades,
    tradeInvites,
    partyInvites,
    events,
    letters,
    bumpDeedStat,
    addPlayer,
    give,
    giveInstance,
    fillBags,
    setRails,
    setTime: (t: number) => (time = t),
  };
}

describe('trade module (direct, no Sim)', () => {
  it('full trade: request/accept open a session; confirm swaps items + copper atomically', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 100);
    h.addPlayer(2, 'Borin', 3, 50);
    h.give(1, 'wolf_fang', 3);
    h.give(2, 'baked_bread', 2);

    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    expect(tradeMod.tradeFor(h.ctx, 1)).toBeTruthy();

    tradeMod.tradeSetOffer(h.ctx, [{ itemId: 'wolf_fang', count: 2 }], 30, 0, '0', 1);
    tradeMod.tradeSetOffer(h.ctx, [{ itemId: 'baked_bread', count: 1 }], 10, 0, '0', 2);
    tradeMod.tradeConfirm(h.ctx, 1);
    expect(tradeMod.tradeFor(h.ctx, 1)).toBeTruthy(); // not done until both confirm
    tradeMod.tradeConfirm(h.ctx, 2);

    expect(tradeMod.tradeFor(h.ctx, 1)).toBe(null); // session cleared
    expect((h.ctx as any).countItem('wolf_fang', 1)).toBe(1);
    expect((h.ctx as any).countItem('wolf_fang', 2)).toBe(2);
    expect((h.ctx as any).countItem('baked_bread', 1)).toBe(1);
    expect((h.ctx as any).countItem('baked_bread', 2)).toBe(1);
    expect(h.players.get(1).copper).toBe(100 - 30 + 10);
    expect(h.players.get(2).copper).toBe(50 - 10 + 30);
    expect(h.events.some((e) => e.type === 'tradeDone')).toBe(true);
  });

  it('rejects an out-of-range request and does not create an invite', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 999, 0);
    tradeMod.tradeRequest(h.ctx, 2, 1);
    expect(h.events.some((e) => e.type === 'error' && /too far away/.test(e.text))).toBe(true);
    expect(h.tradeInvites.has(2)).toBe(false);
  });

  it('a pending invitation blocks a second request', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    h.partyInvites.set(2, { fromPid: 9, expires: 999 });
    tradeMod.tradeRequest(h.ctx, 2, 1);
    expect(
      h.events.some((e) => e.type === 'error' && /already has a pending invitation/.test(e.text)),
    ).toBe(true);
    expect(h.tradeInvites.has(2)).toBe(false);
  });

  it('tradeCancel closes an open session and notifies both sides', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    tradeMod.tradeCancel(h.ctx, 1);
    expect(tradeMod.tradeFor(h.ctx, 1)).toBe(null);
    expect(h.events.filter((e) => e.type === 'log' && e.text === 'Trade cancelled.').length).toBe(
      2,
    );
  });

  it('updateTradesAndInvites expires stale invites and cancels drifted trades', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    // a stale invite in each map (expires < time = 0) is swept
    h.partyInvites.set(7, { fromPid: 1, expires: -1 });
    // an open trade whose parties have drifted out of range is cancelled
    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    expect(tradeMod.tradeFor(h.ctx, 1)).toBeTruthy();
    h.entities.get(2).pos.x = 999;
    tradeMod.updateTradesAndInvites(h.ctx);
    expect(h.partyInvites.has(7)).toBe(false);
    expect(tradeMod.tradeFor(h.ctx, 1)).toBe(null);
  });

  it('refuses a noMarketList item from a trade offer (fungible path)', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    h.give(1, 'alien_armor_plate', 1); // noVendorSell + noDiscard + noMarketList, NOT soulbound
    tradeMod.tradeSetOffer(h.ctx, [{ itemId: 'alien_armor_plate', count: 1 }], 0, 0, '0', 1);
    expect(tradeMod.tradeFor(h.ctx, 1)?.offerA.items.length).toBe(0);
  });

  it('refuses an instance row whose selector carries boundTo (character-bound copies never trade)', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    h.giveInstance(1, 'wolf_fang', { boundTo: 1 });
    tradeMod.tradeSetOffer(
      h.ctx,
      [{ itemId: 'wolf_fang', count: 1, instance: { boundTo: 1 } }],
      0,
      0,
      '0',
      1,
    );
    expect(tradeMod.tradeFor(h.ctx, 1)?.offerA.items.length).toBe(0);
  });

  it('trades an instanced copy and a fungible row of the same item together, preserving the payload (data-loss regression)', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    const instance: ItemInstancePayload = { signer: 'Ayla', rolled: { stats: { str: 5 } } };
    h.give(1, 'wolf_fang', 5);
    h.giveInstance(1, 'wolf_fang', instance);

    tradeMod.tradeSetOffer(
      h.ctx,
      [
        { itemId: 'wolf_fang', count: 1, instance },
        { itemId: 'wolf_fang', count: 2 },
      ],
      0,
      0,
      '0',
      1,
    );
    tradeMod.tradeSetOffer(h.ctx, [], 0, 0, '0', 2);
    tradeMod.tradeConfirm(h.ctx, 1);
    tradeMod.tradeConfirm(h.ctx, 2);

    const bInv = h.players.get(2).inventory;
    const instancedSlot = bInv.find((s: any) => s.itemId === 'wolf_fang' && s.instance);
    expect(instancedSlot?.instance).toEqual(instance);
    const plainSlot = bInv.find((s: any) => s.itemId === 'wolf_fang' && !s.instance);
    expect(plainSlot?.count).toBe(2);

    const aInv = h.players.get(1).inventory;
    expect(aInv.some((s: any) => s.instance)).toBe(false);
    expect(aInv.find((s: any) => s.itemId === 'wolf_fang')?.count).toBe(3);
  });

  it('refuses a fungible offer that only an instanced copy could cover (countFungibleItem gate)', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    h.give(1, 'wolf_fang', 2);
    h.giveInstance(1, 'wolf_fang', { signer: 'Ayla' });
    // 2 plain + 1 instanced = 3 physical copies, but only 2 are fungible
    tradeMod.tradeSetOffer(h.ctx, [{ itemId: 'wolf_fang', count: 3 }], 0, 0, '0', 1);
    expect(tradeMod.tradeFor(h.ctx, 1)?.offerA.items.length).toBe(0);
  });

  it('confirm-time revalidation: an instance row removed from bags between confirms fails the trade, closes it, and moves nothing (F6a)', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 100);
    h.addPlayer(2, 'Borin', 1, 50);
    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    const instance: ItemInstancePayload = { signer: 'Ayla', rolled: { stats: { str: 5 } } };
    h.giveInstance(1, 'wolf_fang', instance);
    h.give(2, 'baked_bread', 2);
    tradeMod.tradeSetOffer(h.ctx, [{ itemId: 'wolf_fang', count: 1, instance }], 0, 0, '0', 1);
    tradeMod.tradeSetOffer(h.ctx, [{ itemId: 'baked_bread', count: 1 }], 0, 0, '0', 2);
    tradeMod.tradeConfirm(h.ctx, 1);
    // the instanced copy vanishes from player 1's bags before the second confirm
    // (the class of change the deep-equal confirm-time revalidation guards against)
    h.players.get(1).inventory = h.players.get(1).inventory.filter((s: any) => !s.instance);

    tradeMod.tradeConfirm(h.ctx, 2);

    // session closed, both sides told, and nothing changed hands
    expect(tradeMod.tradeFor(h.ctx, 1)).toBe(null);
    expect(
      h.events.filter(
        (e) => e.type === 'error' && e.text === 'Trade failed: items or money no longer available.',
      ).length,
    ).toBe(2);
    expect(h.players.get(1).copper).toBe(100);
    expect(h.players.get(2).copper).toBe(50);
    expect(h.players.get(2).inventory.find((s: any) => s.itemId === 'baked_bread')?.count).toBe(2);
    expect(h.players.get(1).inventory.some((s: any) => s.itemId === 'baked_bread')).toBe(false);
    expect(h.letters).toHaveLength(0);
  });

  it('confirm-time revalidation: a full recipient fails the trade with the bag-space error, closes it, and moves nothing (F6a)', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    h.give(1, 'wolf_fang', 1);
    // player 2 offers nothing and their bags are full, so they cannot RECEIVE
    h.fillBags(2, 16);
    tradeMod.tradeSetOffer(h.ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 0, '0', 1);
    tradeMod.tradeSetOffer(h.ctx, [], 0, 0, '0', 2);
    tradeMod.tradeConfirm(h.ctx, 1);
    tradeMod.tradeConfirm(h.ctx, 2);

    expect(tradeMod.tradeFor(h.ctx, 1)).toBe(null);
    expect(
      h.events.filter((e) => e.type === 'error' && e.text === 'Trade failed: not enough bag space.')
        .length,
    ).toBe(2);
    // player 1 keeps their wolf_fang; player 2's full bags are untouched
    expect(h.players.get(1).inventory.find((s: any) => s.itemId === 'wolf_fang')?.count).toBe(1);
    expect(h.players.get(2).inventory.some((s: any) => s.itemId === 'wolf_fang')).toBe(false);
    expect(h.letters).toHaveLength(0);
  });

  it('single-$WOC-leg rule: a woc pledge is refused when the counterparty already offers woc (F1a)', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    const linked: TradeRailsView = {
      claudium: { available: false, balance: 0 },
      woc: { available: true, linked: true },
    };
    h.setRails(1, linked);
    h.setRails(2, linked);
    // player 1 pledges woc first
    tradeMod.tradeSetOffer(h.ctx, [], 0, 0, '2', 1);
    expect(tradeMod.tradeFor(h.ctx, 1)?.offerA.woc).toBe('2');
    // player 2 pledging woc second is the one refused (reverse-ordering hole)
    tradeMod.tradeSetOffer(h.ctx, [], 0, 0, '3', 2);
    expect(
      h.events.some(
        (e) => e.type === 'error' && e.text === 'Only one side of a trade can offer WOC.',
      ),
    ).toBe(true);
    expect(tradeMod.tradeFor(h.ctx, 1)?.offerB.woc).toBe('0');
  });

  it('single-$WOC-leg rule: confirm fails closed if both offers somehow carry woc (F1a belt)', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    // force a two-sided woc pledge straight onto the session (bypassing the set guard)
    const session = tradeMod.tradeFor(h.ctx, 1)!;
    session.offerA.woc = '2';
    session.offerB.woc = '3';
    tradeMod.tradeConfirm(h.ctx, 1);
    tradeMod.tradeConfirm(h.ctx, 2);
    expect(tradeMod.tradeFor(h.ctx, 1)).toBe(null);
    expect(
      h.events.filter(
        (e) => e.type === 'error' && e.text === 'Only one side of a trade can offer WOC.',
      ).length,
    ).toBe(2);
  });

  it('claudium pledge: refused with rails unavailable, clamped to the cached balance when available', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);

    tradeMod.tradeSetOffer(h.ctx, [], 0, 100, '0', 1);
    expect(
      h.events.some((e) => e.type === 'error' && e.text === 'Claudium trading is not available.'),
    ).toBe(true);
    expect(tradeMod.tradeFor(h.ctx, 1)?.offerA.claudium).toBe(0);

    h.setRails(1, {
      claudium: { available: true, balance: 40 },
      woc: { available: false, linked: false },
    });
    tradeMod.tradeSetOffer(h.ctx, [], 0, 100, '0', 1);
    expect(tradeMod.tradeFor(h.ctx, 1)?.offerA.claudium).toBe(40);
  });

  it('woc pledge: normalized when both linked, refused when the partner is unlinked, malformed strings silently zero', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);

    h.setRails(1, {
      claudium: { available: false, balance: 0 },
      woc: { available: true, linked: true },
    });
    h.setRails(2, {
      claudium: { available: false, balance: 0 },
      woc: { available: true, linked: true },
    });
    tradeMod.tradeSetOffer(h.ctx, [], 0, 0, '1.50', 1);
    expect(tradeMod.tradeFor(h.ctx, 1)?.offerA.woc).toBe('1.5');

    h.setRails(2, {
      claudium: { available: false, balance: 0 },
      woc: { available: true, linked: false },
    });
    tradeMod.tradeSetOffer(h.ctx, [], 0, 0, '1.50', 1);
    expect(
      h.events.some(
        (e) => e.type === 'error' && e.text === 'Your trade partner has no linked wallet.',
      ),
    ).toBe(true);
    expect(tradeMod.tradeFor(h.ctx, 1)?.offerA.woc).toBe('0');

    h.setRails(2, {
      claudium: { available: false, balance: 0 },
      woc: { available: true, linked: true },
    });
    const eventsBefore = h.events.length;
    for (const malformed of ['1e5', '-3', '0.0000000001', '']) {
      tradeMod.tradeSetOffer(h.ctx, [], 0, 0, malformed, 1);
      expect(tradeMod.tradeFor(h.ctx, 1)?.offerA.woc).toBe('0');
    }
    // malformed strings never reach the rails checks, so they raise no error either
    expect(h.events.length).toBe(eventsBefore);
  });

  it('external lane: confirming with a claudium pledge escrows bags/copper and parks the session in settling', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 100);
    h.addPlayer(2, 'Borin', 1, 50);
    h.give(1, 'wolf_fang', 3);
    h.give(2, 'baked_bread', 2);
    h.setRails(1, {
      claudium: { available: true, balance: 40 },
      woc: { available: false, linked: false },
    });
    h.setRails(2, {
      claudium: { available: false, balance: 0 },
      woc: { available: false, linked: false },
    });

    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    tradeMod.tradeSetOffer(h.ctx, [{ itemId: 'wolf_fang', count: 2 }], 30, 40, '0', 1);
    tradeMod.tradeSetOffer(h.ctx, [{ itemId: 'baked_bread', count: 1 }], 10, 0, '0', 2);
    tradeMod.tradeConfirm(h.ctx, 1);
    tradeMod.tradeConfirm(h.ctx, 2);

    const session = tradeMod.tradeFor(h.ctx, 1);
    expect(session?.phase).toBe('settling');
    expect(session?.charA).toEqual({ key: 'char-1', name: 'Ayla' });
    expect(session?.charB).toEqual({ key: 'char-2', name: 'Borin' });
    expect(session?.escrowA).toEqual({ items: [{ itemId: 'wolf_fang', count: 2 }], copper: 30 });
    expect(session?.escrowB).toEqual({ items: [{ itemId: 'baked_bread', count: 1 }], copper: 10 });
    expect(h.players.get(1).copper).toBe(70);
    expect(h.players.get(1).inventory.find((s: any) => s.itemId === 'wolf_fang')?.count).toBe(1);
    expect(h.players.get(2).copper).toBe(40);
    expect(h.players.get(2).inventory.find((s: any) => s.itemId === 'baked_bread')?.count).toBe(1);
    expect(h.events.some((e) => e.type === 'tradeSettle' && e.a === 1 && e.b === 2)).toBe(true);

    // a 'settling' session is past player cancellation: only the server's
    // settlement orchestrator may unwind it now.
    tradeMod.tradeCancel(h.ctx, 1);
    expect(tradeMod.tradeFor(h.ctx, 1)?.phase).toBe('settling');

    // drift and death are harmless while the goods are escrowed
    h.entities.get(2).pos.x = 999;
    h.entities.get(1).dead = true;
    tradeMod.updateTradesAndInvites(h.ctx);
    expect(tradeMod.tradeFor(h.ctx, 1)?.phase).toBe('settling');
  });

  it('tradeSettleComplete delivers goods crosswise (instance payload preserved), bumps the deed stat, and closes the session; a full recipient overflows to a delivery letter', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 100);
    h.addPlayer(2, 'Borin', 1, 50);
    const instance: ItemInstancePayload = { signer: 'Ayla', rolled: { stats: { str: 5 } } };
    h.giveInstance(1, 'wolf_fang', instance);
    h.give(2, 'baked_bread', 3);
    h.setRails(1, {
      claudium: { available: true, balance: 40 },
      woc: { available: false, linked: false },
    });

    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    tradeMod.tradeSetOffer(h.ctx, [{ itemId: 'wolf_fang', count: 1, instance }], 10, 40, '0', 1);
    tradeMod.tradeSetOffer(h.ctx, [{ itemId: 'baked_bread', count: 1 }], 0, 0, '0', 2);
    tradeMod.tradeConfirm(h.ctx, 1);
    tradeMod.tradeConfirm(h.ctx, 2);
    expect(tradeMod.tradeFor(h.ctx, 1)?.phase).toBe('settling');

    // player 2's bags are full: the incoming instanced copy cannot fit
    h.fillBags(2, 16);

    tradeMod.tradeSettleComplete(h.ctx, 1);

    expect(tradeMod.tradeFor(h.ctx, 1)).toBe(null);
    expect(h.events.filter((e) => e.type === 'tradeDone').length).toBe(2);
    expect(h.bumpDeedStat).toHaveBeenCalledTimes(2);
    // player 1 (Ayla) has room: the baked_bread lands directly in bags
    expect(h.players.get(1).inventory.find((s: any) => s.itemId === 'baked_bread')?.count).toBe(1);
    // player 2 (Borin) is full: nothing new was added to their bags
    expect(h.players.get(2).inventory.some((s: any) => s.itemId === 'wolf_fang')).toBe(false);
    expect(h.letters).toHaveLength(1);
    expect(h.letters[0]).toMatchObject({ recipientKey: 'char-2', flavor: 'delivery' });
    expect(h.letters[0].items).toEqual([{ itemId: 'wolf_fang', count: 1, instance }]);
  });

  it("tradeSettleFail('timeout') returns escrow to owners; an owner missing from ctx.players is refunded by letter to the captured key", () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 100);
    h.addPlayer(2, 'Borin', 1, 50);
    h.give(1, 'wolf_fang', 2);
    h.setRails(1, {
      claudium: { available: true, balance: 40 },
      woc: { available: false, linked: false },
    });

    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    tradeMod.tradeSetOffer(h.ctx, [{ itemId: 'wolf_fang', count: 2 }], 20, 40, '0', 1);
    tradeMod.tradeSetOffer(h.ctx, [], 5, 0, '0', 2);
    tradeMod.tradeConfirm(h.ctx, 1);
    tradeMod.tradeConfirm(h.ctx, 2);
    expect(tradeMod.tradeFor(h.ctx, 1)?.phase).toBe('settling');

    // player 2 leaves the world entirely before settlement resolves
    h.players.delete(2);

    tradeMod.tradeSettleFail(h.ctx, 1, 'timeout');

    expect(tradeMod.tradeFor(h.ctx, 1)).toBe(null);
    // player 1 (still online): refund lands directly in bags/copper
    expect(h.players.get(1).copper).toBe(100);
    expect(h.players.get(1).inventory.find((s: any) => s.itemId === 'wolf_fang')?.count).toBe(2);
    expect(
      h.events.some((e) => e.type === 'tradeSettleFailed' && e.pid === 1 && e.reason === 'timeout'),
    ).toBe(true);
    // player 2 (left): no event fires for a pid that no longer resolves; the
    // refund goes out as a letter to the captured character key instead.
    expect(h.events.some((e) => e.type === 'tradeSettleFailed' && e.pid === 2)).toBe(false);
    expect(h.letters.some((l) => l.recipientKey === 'char-2' && l.flavor === 'refund')).toBe(true);
  });

  it('tradeDecline removes the invite and notifies the requester; a decline with no invite is silent', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    tradeMod.tradeRequest(h.ctx, 2, 1);
    expect(h.tradeInvites.has(2)).toBe(true);

    tradeMod.tradeDecline(h.ctx, 2);
    expect(h.tradeInvites.has(2)).toBe(false);
    expect(
      h.events.some((e) => e.type === 'tradeDeclined' && e.pid === 1 && e.byName === 'Borin'),
    ).toBe(true);

    const before = h.events.length;
    tradeMod.tradeDecline(h.ctx, 2); // no invite left: silent
    expect(h.events.length).toBe(before);
  });
});

describe('normalizeWocAmount', () => {
  it('normalizes canonical decimal forms and rejects invalid/oversized ones', () => {
    expect(tradeMod.normalizeWocAmount('1.50')).toBe('1.5');
    expect(tradeMod.normalizeWocAmount('007')).toBe('7');
    expect(tradeMod.normalizeWocAmount('0')).toBe(null);
    expect(tradeMod.normalizeWocAmount('0.0')).toBe(null);
    expect(tradeMod.normalizeWocAmount('12345678901')).toBe(null); // too long
    expect(tradeMod.normalizeWocAmount('1.123456789')).toBe('1.123456789');
  });
});
