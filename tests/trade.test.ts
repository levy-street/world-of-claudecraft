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
    bumpDeedStat: () => {},
    emit: (ev: any) => events.push(ev),
    hasPendingSocialInvite: (tp: number) =>
      partyInvites.has(tp) || tradeInvites.has(tp) || duelInvites.has(tp),
    countItem: (itemId: string, pid?: number) => bag(pid!).get(itemId) ?? 0,
    // This fake bag store has no per-instance concept, so every held copy is
    // fungible: countFungibleItem/removeFungibleItem mirror countItem/removeItem.
    countFungibleItem: (itemId: string, pid?: number) => bag(pid!).get(itemId) ?? 0,
    addItem: (itemId: string, count: number, pid?: number) =>
      bag(pid!).set(itemId, (bag(pid!).get(itemId) ?? 0) + count),
    removeItem: (itemId: string, count: number, pid?: number) =>
      bag(pid!).set(itemId, Math.max(0, (bag(pid!).get(itemId) ?? 0) - count)),
    removeFungibleItem: (itemId: string, count: number, pid?: number) =>
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

  // A dedicated fake ctx factory, not the shared makeTradeCtx bag store: this one
  // models real per-slot inventory arrays with instanced payloads explicitly,
  // mirroring how removePreferFungible/addItemInstance behave on the real Sim
  // (src/sim/items.ts), so the trade payload-preservation fix and the capacity
  // gate (src/sim/social/trade.ts removeOffer/grantOffer/fitsAfterSwap) are exercised end
  // to end. countFungibleItem/removeItem/countItem honor `s.count` and only
  // treat `!s.instance` slots as fungible, matching the real sim.ts contract.
  function makeInstancedTradeCtx(inv1: any[], inv2: any[]) {
    const players = new Map<number, any>();
    const entities = new Map<number, any>();
    const trades = new Map<number, any>();
    const tradeInvites = new Map<number, { fromPid: number; expires: number }>();
    const partyInvites = new Map<number, { fromPid: number; expires: number }>();
    const duelInvites = new Map<number, { fromPid: number; expires: number }>();
    const events: any[] = [];
    players.set(1, {
      entityId: 1,
      name: 'Ayla',
      copper: 0,
      inventory: inv1,
      bags: [null, null, null, null],
    });
    players.set(2, {
      entityId: 2,
      name: 'Borin',
      copper: 0,
      inventory: inv2,
      bags: [null, null, null, null],
    });
    entities.set(1, { id: 1, pos: { x: 0, y: 0, z: 0 }, dead: false });
    entities.set(2, { id: 2, pos: { x: 1, y: 0, z: 0 }, dead: false });
    const ctx = {
      time: 0,
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
      bumpDeedStat: () => {},
      emit: (ev: any) => events.push(ev),
      hasPendingSocialInvite: (tp: number) =>
        partyInvites.has(tp) || tradeInvites.has(tp) || duelInvites.has(tp),
      countItem: (itemId: string, pid?: number) =>
        players
          .get(pid!)
          .inventory.filter((s: any) => s.itemId === itemId)
          .reduce((sum: number, s: any) => sum + s.count, 0),
      countFungibleItem: (itemId: string, pid?: number) =>
        players
          .get(pid!)
          .inventory.filter((s: any) => s.itemId === itemId && !s.instance)
          .reduce((sum: number, s: any) => sum + s.count, 0),
      removeFungibleItem: (itemId: string, count: number, pid?: number) => {
        const inv = players.get(pid!).inventory;
        let remaining = count;
        for (let i = inv.length - 1; i >= 0 && remaining > 0; i--) {
          if (inv[i].itemId !== itemId || inv[i].instance) continue;
          const take = Math.min(inv[i].count, remaining);
          inv[i].count -= take;
          remaining -= take;
        }
        for (let i = inv.length - 1; i >= 0; i--) {
          if (inv[i].itemId === itemId && !inv[i].instance && inv[i].count <= 0) inv.splice(i, 1);
        }
      },
      addItem: (itemId: string, count: number, pid?: number) => {
        const inv = players.get(pid!).inventory;
        inv.push({ itemId, count });
      },
      addItemInstance: (itemId: string, inst: any, pid?: number) => {
        players.get(pid!).inventory.push({ itemId, count: 1, instance: inst });
      },
      removeItem: (itemId: string, count: number, pid?: number) => {
        const inv = players.get(pid!).inventory;
        const removed: any[] = [];
        for (let i = inv.length - 1; i >= 0 && removed.length < count; i--) {
          if (inv[i].itemId !== itemId || !inv[i].instance) continue;
          removed.push(inv[i].instance);
          inv.splice(i, 1);
        }
        return removed;
      },
    } as unknown as SimContext;
    return { ctx, players, events };
  }

  it('preserves an instanced item payload (enchant/signature/rolled quality) across a swap', () => {
    const instance = { signer: 'Ayla', rolled: { quality: 'epic' } };
    // pid 1 holds exactly one instanced copy of 'wolf_fang' (no plain copies).
    const { ctx, players } = makeInstancedTradeCtx(
      [{ itemId: 'wolf_fang', count: 1, instance }],
      [],
    );

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 1);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(players.get(1).inventory).toHaveLength(0);
    expect(players.get(2).inventory).toHaveLength(1);
    // The bug this pins: a naive removeItem+addItem swap re-grants a PLAIN copy
    // and silently drops `instance`, destroying the enchant/signature/quality.
    expect(players.get(2).inventory[0].instance).toEqual(instance);
  });

  it('rejects a trade that would push the receiver over bag capacity via an instanced grant', () => {
    // Reproduces the capacity-gate hole the fitsAfterSwap fix closes: the
    // receiver is already at full (16-slot) capacity, one of those slots is a
    // partial plain wolf_fang stack. addStacked/countFit would let a receive
    // "stack" onto that partial slot, but the real transfer grants an
    // instanced copy via addItemInstance, which never merges and always takes
    // a fresh slot, so the receiver would end up over capacity.
    const instance = { signer: 'Borin' };
    const receiverInv = [
      { itemId: 'wolf_fang', count: 1 }, // partial plain stack (room to stack, but not a free slot)
      ...Array.from({ length: 15 }, (_, i) => ({ itemId: `filler_${i}`, count: 1 })),
    ];
    const { ctx, players, events } = makeInstancedTradeCtx(
      [{ itemId: 'wolf_fang', count: 1, instance }],
      receiverInv,
    );
    expect(players.get(2).inventory).toHaveLength(16);

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 1);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    // Trade must be rejected, not silently overflow the receiver to 17 slots.
    expect(players.get(2).inventory).toHaveLength(16);
    expect(players.get(1).inventory).toHaveLength(1);
    expect(events.some((e) => e.type === 'error' && /not enough bag space/.test(e.text))).toBe(
      true,
    );
  });

  it('splits a mixed offer between the giver’s plain and instanced copies in one transfer', () => {
    // Covers the untested arm: an offer count partly satisfied by plain copies
    // and partly by an instanced one, so the swap's plainCount and
    // instance arms both fire in the same call.
    const instance = { signer: 'Ayla' };
    const { ctx, players } = makeInstancedTradeCtx(
      [
        { itemId: 'wolf_fang', count: 1 },
        { itemId: 'wolf_fang', count: 1, instance },
      ],
      [],
    );

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 2 }], 0, 1);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(players.get(1).inventory).toHaveLength(0);
    expect(players.get(2).inventory).toHaveLength(2);
    const plain = players.get(2).inventory.find((s: any) => !s.instance);
    const instanced = players.get(2).inventory.find((s: any) => s.instance);
    expect(plain?.count).toBe(1);
    expect(instanced?.instance).toEqual(instance);
  });

  it('keeps full payloads (signer/charges/rolled/enchant/boundTo) for instances in both directions', () => {
    // The phase acceptance criterion end to end: side A's offer mixes a plain
    // copy with a fully-loaded instanced copy while side B offers a different
    // instanced item in the SAME trade, so tradeConfirm's second offer leg
    // (offerB, b to a) moves an instance too, and every payload field
    // (signer, charges, rolled incl. the Phase 2 masterwork marker, the enchant
    // marker, boundTo) must land intact on the right receiver's granted item.
    const instA = {
      signer: 'Ayla',
      charges: { lifesteal: 2 },
      rolled: { stats: { atk: 3 }, masterwork: true },
      enchant: 'flame_weapon',
      boundTo: 1,
    };
    const instB = {
      signer: 'Borin',
      charges: { warmth: 5 },
      rolled: { stats: { sta: 2 }, masterwork: true },
      enchant: 'hearth_ward',
      boundTo: 2,
    };
    const { ctx, players } = makeInstancedTradeCtx(
      [
        { itemId: 'wolf_fang', count: 1 },
        { itemId: 'wolf_fang', count: 1, instance: instA },
      ],
      [{ itemId: 'baked_bread', count: 1, instance: instB }],
    );

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 2 }], 0, 1);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'baked_bread', count: 1 }], 0, 2);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    // b to a: the instanced bread lands on A with its whole payload.
    expect(players.get(1).inventory).toHaveLength(1);
    expect(players.get(1).inventory[0].itemId).toBe('baked_bread');
    expect(players.get(1).inventory[0].instance).toEqual(instB);
    // a to b: one plain fang plus the instanced fang carrying instA, not instB.
    expect(players.get(2).inventory).toHaveLength(2);
    const plain = players.get(2).inventory.find((s: any) => !s.instance);
    const instanced = players.get(2).inventory.find((s: any) => s.instance);
    expect(plain?.itemId).toBe('wolf_fang');
    expect(plain?.count).toBe(1);
    expect(instanced?.itemId).toBe('wolf_fang');
    expect(instanced?.instance).toEqual(instA);
  });

  it('swaps same-itemId instances across the trade, not back to their owners', () => {
    // The sequencing hazard this pins: tradeConfirm used to run the a-to-b
    // transfer to completion (granting into b's bag) before removing b's give,
    // so with the SAME itemId on both sides b's removal (highest-index-first,
    // exactly where addItemInstance pushes) consumed the copy a had just
    // granted and sent it straight back: the trade "completed" with both
    // signatures unmoved.
    const instA = { signer: 'Ayla', rolled: { masterwork: true } };
    const instB = { signer: 'Borin', rolled: { masterwork: true } };
    const { ctx, players } = makeInstancedTradeCtx(
      [{ itemId: 'wolf_fang', count: 1, instance: instA }],
      [{ itemId: 'wolf_fang', count: 1, instance: instB }],
    );

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 1);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 2);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(players.get(1).inventory).toHaveLength(1);
    expect(players.get(1).inventory[0].instance).toEqual(instB);
    expect(players.get(2).inventory).toHaveLength(1);
    expect(players.get(2).inventory[0].instance).toEqual(instA);
  });

  it('routes the instanced copy across when plain copies of the same item flow the other way', () => {
    // Sibling of the swap pin above: a offers two plain fangs, b offers their
    // signed one. Granting a's plain copies first used to inflate b's fungible
    // stock, so b's removal spared the instance and a received a plain copy
    // back instead of the signed one.
    const instB = { signer: 'Borin', enchant: 'flame_weapon' };
    const { ctx, players } = makeInstancedTradeCtx(
      [{ itemId: 'wolf_fang', count: 2 }],
      [{ itemId: 'wolf_fang', count: 1, instance: instB }],
    );

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 2 }], 0, 1);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 2);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(players.get(1).inventory).toHaveLength(1);
    expect(players.get(1).inventory[0].instance).toEqual(instB);
    const bPlain = players.get(2).inventory.filter((s: any) => !s.instance);
    expect(bPlain.reduce((n: number, s: any) => n + s.count, 0)).toBe(2);
    expect(players.get(2).inventory.some((s: any) => s.instance)).toBe(false);
  });

  it('spares the instanced copy when the giver has enough plain stock to cover the offer', () => {
    // removePreferFungible must CHOOSE here: the giver holds two plain copies
    // plus one signed copy and offers two, so the signed copy stays home with
    // its payload and the receiver gets plain ones only. A regression to
    // bag-order removal (eating the instance first) passes the mixed-offer
    // test above but fails this pin.
    const instance = { signer: 'Ayla' };
    const { ctx, players } = makeInstancedTradeCtx(
      [
        { itemId: 'wolf_fang', count: 2 },
        { itemId: 'wolf_fang', count: 1, instance },
      ],
      [],
    );

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 2 }], 0, 1);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(players.get(1).inventory).toHaveLength(1);
    expect(players.get(1).inventory[0].instance).toEqual(instance);
    expect(players.get(2).inventory).toHaveLength(1);
    expect(players.get(2).inventory[0].count).toBe(2);
    expect(players.get(2).inventory[0].instance).toBeUndefined();
  });

  it('leaves both inventories untouched by an offer plus cancel (no escrow)', () => {
    // Offers are declarative session state: items only move inside
    // tradeConfirm's swap. This pins that contract so a future escrow refactor
    // must consciously add the return path for instanced payloads.
    const instance = { signer: 'Ayla', enchant: 'flame_weapon' };
    const inv1 = [{ itemId: 'wolf_fang', count: 1, instance }];
    const inv2 = [{ itemId: 'baked_bread', count: 2 }];
    const { ctx, players } = makeInstancedTradeCtx(inv1, inv2);
    const snap1 = JSON.parse(JSON.stringify(inv1));
    const snap2 = JSON.parse(JSON.stringify(inv2));

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 1);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeCancel(ctx, 2);

    expect(tradeMod.tradeFor(ctx, 1)).toBe(null);
    expect(players.get(1).inventory).toEqual(snap1);
    expect(players.get(2).inventory).toEqual(snap2);
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
