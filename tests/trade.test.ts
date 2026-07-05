// Direct unit tests for the extracted trade module (src/sim/social/trade.ts).
// The module is driven through a minimal fake SimContext (no full Sim): the
// inventory hub is a per-pid bag Map, players/entities are plain stubs. This
// proves the trade logic is decoupled and exercises the swap, the guards, the
// cancel path, and the updateTradesAndInvites invite-expiry + drift sweep.

import { describe, expect, it } from 'vitest';
import type { SimContext } from '../src/sim/sim_context';
import * as tradeMod from '../src/sim/social/trade';

function makeTradeCtx() {
  const players = new Map<number, any>();
  const entities = new Map<number, any>();
  const trades = new Map<number, any>();
  const tradeInvites = new Map<number, { fromPid: number; expires: number }>();
  const partyInvites = new Map<number, { fromPid: number; expires: number }>();
  const duelInvites = new Map<number, { fromPid: number; expires: number }>();
  const bags = new Map<number, Map<string, number>>();
  const events: any[] = [];
  let time = 0;
  const bag = (pid: number) => {
    let b = bags.get(pid);
    if (!b) {
      b = new Map();
      bags.set(pid, b);
    }
    return b;
  };
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
    emit: (ev: any) => events.push(ev),
    hasPendingSocialInvite: (tp: number) =>
      partyInvites.has(tp) || tradeInvites.has(tp) || duelInvites.has(tp),
    countItem: (itemId: string, pid?: number) => bag(pid!).get(itemId) ?? 0,
    addItem: (itemId: string, count: number, pid?: number) =>
      bag(pid!).set(itemId, (bag(pid!).get(itemId) ?? 0) + count),
    removeItem: (itemId: string, count: number, pid?: number) =>
      bag(pid!).set(itemId, Math.max(0, (bag(pid!).get(itemId) ?? 0) - count)),
  } as unknown as SimContext;
  function addPlayer(pid: number, name: string, x: number, copper: number) {
    // inventory/bags are the real PlayerMeta fields the capacity gate reads at
    // tradeConfirm (the swap simulation); the hub Map above stays the item store.
    players.set(pid, {
      entityId: pid,
      name,
      copper,
      inventory: [],
      bags: [null, null, null, null],
    });
    entities.set(pid, { id: pid, pos: { x, y: 0, z: 0 }, dead: false });
  }
  return {
    ctx,
    players,
    entities,
    trades,
    tradeInvites,
    partyInvites,
    events,
    addPlayer,
    bag,
    setTime: (t: number) => (time = t),
  };
}

describe('trade module (direct, no Sim)', () => {
  it('full trade: request/accept open a session; confirm swaps items + copper atomically', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 100);
    h.addPlayer(2, 'Borin', 3, 50);
    h.bag(1).set('wolf_fang', 3);
    h.bag(2).set('baked_bread', 2);

    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    expect(tradeMod.tradeFor(h.ctx, 1)).toBeTruthy();

    tradeMod.tradeSetOffer(h.ctx, [{ itemId: 'wolf_fang', count: 2 }], 30, 1);
    tradeMod.tradeSetOffer(h.ctx, [{ itemId: 'baked_bread', count: 1 }], 10, 2);
    tradeMod.tradeConfirm(h.ctx, 1);
    expect(tradeMod.tradeFor(h.ctx, 1)).toBeTruthy(); // not done until both confirm
    tradeMod.tradeConfirm(h.ctx, 2);

    expect(tradeMod.tradeFor(h.ctx, 1)).toBe(null); // session cleared
    expect(h.bag(1).get('wolf_fang')).toBe(1);
    expect(h.bag(2).get('wolf_fang')).toBe(2);
    expect(h.bag(1).get('baked_bread')).toBe(1);
    expect(h.bag(2).get('baked_bread')).toBe(1);
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
});
