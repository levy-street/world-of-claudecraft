// Direct unit tests for the extracted trade module (src/sim/social/trade.ts).
// The module is driven through a minimal fake SimContext (no full Sim): the
// inventory hub is a per-pid bag Map, players/entities are plain stubs. This
// proves the trade logic is decoupled and exercises the swap, the guards, the
// cancel path, and the updateTradesAndInvites invite-expiry + drift sweep.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as bagsMod from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import { canStackInstancePayloads } from '../src/sim/item_instance_merge';
import * as questCredit from '../src/sim/quests/quest_credit';
import type { SimContext } from '../src/sim/sim_context';
import * as tradeMod from '../src/sim/social/trade';
import { cloneItemInstancePayload } from '../src/sim/types';
import { bareClient } from './helpers/bare_client';

function makeTradeCtx() {
  const players = new Map<number, any>();
  const entities = new Map<number, any>();
  const trades = new Map<number, any>();
  const tradeInvites = new Map<number, { fromPid: number; expires: number }>();
  const partyInvites = new Map<number, { fromPid: number; expires: number }>();
  const duelInvites = new Map<number, { fromPid: number; expires: number }>();
  const events: any[] = [];
  let time = 0;
  // A thin Map-like view over the player's real `inventory` array (the
  // PlayerMeta shape), not a second, independent store: trade.ts's removal
  // path (removeVendorSellUnits, BUG #9) walks meta.inventory directly to
  // track each removed unit's craftedRecipeId marker, so this fake ctx has
  // to keep the SAME one source of truth a real Sim does, or the walk finds
  // nothing to remove. One plain (non-instanced) slot per itemId is enough
  // for this fake's documented simplification: every held copy is fungible.
  const bag = (pid: number) => {
    const inv: { itemId: string; count: number }[] = players.get(pid)!.inventory;
    return {
      get: (itemId: string): number | undefined => inv.find((s) => s.itemId === itemId)?.count,
      set: (itemId: string, count: number): void => {
        const slot = inv.find((s) => s.itemId === itemId);
        if (slot) slot.count = count;
        else inv.push({ itemId, count });
      },
    };
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

  it('tradeClose ends the session without calling it a cancellation', () => {
    // Same teardown, different sentence, and the sentence is the entire reason
    // it exists: a $WOC sale ends the window by SUCCEEDING, and telling both
    // players it was cancelled contradicts the payment they were just shown.
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    tradeMod.tradeClose(h.ctx, 1);
    expect(tradeMod.tradeFor(h.ctx, 1), 'the session must actually end').toBe(null);
    const logs = h.events.filter((e) => e.type === 'log');
    expect(logs.filter((e) => e.text === 'Trade window closed.').length, 'both sides').toBe(2);
    expect(
      logs.some((e) => e.text === 'Trade cancelled.'),
      'never the cancel wording',
    ).toBe(false);
  });

  it('tradeClose on no session is a no-op, not a stray message', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    tradeMod.tradeClose(h.ctx, 1);
    expect(h.events.filter((e) => e.type === 'log').length).toBe(0);
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
      addItem: (
        itemId: string,
        count: number,
        pid?: number,
        opts?: { craftedRecipeId?: string },
      ) => {
        const inv = players.get(pid!).inventory;
        const slot: any = { itemId, count };
        if (opts?.craftedRecipeId !== undefined) slot.craftedRecipeId = opts.craftedRecipeId;
        inv.push(slot);
      },
      // Merge-aware like the real Sim.addItemInstance (identical-payload
      // stacking): byte-equal mergeable payloads share a stack up to the
      // item's REAL cap (stackSizeOf: tools and charms cap at 1, so a charm
      // copy always takes its own slot); everything else takes a fresh slot.
      // The crafted marker keys the merge AND lands on the granted slot, the
      // same two rules the real hub applies, so an instanced copy's crafting
      // provenance is observable on arrival instead of being washed off by
      // the fake.
      addItemInstance: (
        itemId: string,
        inst: any,
        pid?: number,
        _count?: number,
        opts?: { craftedRecipeId?: string },
      ) => {
        const inv = players.get(pid!).inventory;
        const target = inv.find(
          (s: any) =>
            s.itemId === itemId &&
            s.count < bagsMod.stackSizeOf(ITEMS[s.itemId]) &&
            s.craftedRecipeId === opts?.craftedRecipeId &&
            canStackInstancePayloads(s.instance, inst),
        );
        if (target) target.count += 1;
        else
          inv.push({
            itemId,
            count: 1,
            instance: inst,
            ...(opts?.craftedRecipeId === undefined
              ? {}
              : { craftedRecipeId: opts.craftedRecipeId }),
          });
      },
      // Per-unit payload returns like the real Sim.removeItem:
      // one entry per unit consumed, cloned while the slot survives.
      removeItem: (itemId: string, count: number, pid?: number) => {
        const inv = players.get(pid!).inventory;
        const removed: any[] = [];
        let remaining = count;
        for (let i = inv.length - 1; i >= 0 && remaining > 0; i--) {
          const s = inv[i];
          if (s.itemId !== itemId || !s.instance) continue;
          const take = Math.min(s.count, remaining);
          for (let u = 0; u < take; u++) {
            const finalUnitOfSlot = take >= s.count && u === take - 1;
            removed.push(finalUnitOfSlot ? s.instance : cloneItemInstancePayload(s.instance));
          }
          s.count -= take;
          remaining -= take;
          if (s.count <= 0) inv.splice(i, 1);
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

  it('ships a foreign or unsigned charm copy before the seller: own self-signed goes last', () => {
    // The copy-choice fix (the phase 12 QA hand-off): removePreferFungible
    // used to walk highest-index-first signer-blind, so trading "one charm"
    // could ship the seller's discount-bearing self-signed copy while a
    // foreign copy sat beside it. Ayla (pid 1) holds her own signed copy
    // ABOVE a foreign-signed one: the foreign copy must cross. Pinned on a
    // real charm id: the predicate is scoped to use.type 'toolEffect'.
    const selfSigned = { signer: 'Ayla' };
    const foreign = { signer: 'Cedric' };
    const { ctx, players } = makeInstancedTradeCtx(
      [
        { itemId: 'gatherers_cache', count: 1, instance: foreign },
        { itemId: 'gatherers_cache', count: 1, instance: selfSigned },
      ],
      [],
    );

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'gatherers_cache', count: 1 }], 0, 1);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(players.get(1).inventory).toHaveLength(1);
    expect(players.get(1).inventory[0].instance).toEqual(selfSigned);
    expect(players.get(2).inventory).toHaveLength(1);
    expect(players.get(2).inventory[0].instance).toEqual(foreign);
  });

  it('a self-signed charm still ships when it is all the seller holds', () => {
    // Deprioritized, never spared: the second pass takes it, so an offer the
    // clamp accepted can never fail the removal.
    const selfSigned = { signer: 'Ayla' };
    const { ctx, players } = makeInstancedTradeCtx(
      [{ itemId: 'gatherers_cache', count: 1, instance: selfSigned }],
      [],
    );

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'gatherers_cache', count: 1 }], 0, 1);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(players.get(1).inventory).toHaveLength(0);
    expect(players.get(2).inventory).toHaveLength(1);
    expect(players.get(2).inventory[0].instance).toEqual(selfSigned);
  });

  it('a two-charm offer drains the foreign copy first, then the self-signed remainder', () => {
    // The two-pass partial fill: pass one takes the foreign copy, `left`
    // carries into pass two, which finishes on the self-signed copy. Both
    // cross in one transfer; the grants arm cannot under-ship.
    const selfSigned = { signer: 'Ayla' };
    const foreign = { signer: 'Cedric' };
    const { ctx, players } = makeInstancedTradeCtx(
      [
        { itemId: 'gatherers_cache', count: 1, instance: selfSigned },
        { itemId: 'gatherers_cache', count: 1, instance: foreign },
      ],
      [],
    );

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'gatherers_cache', count: 2 }], 0, 1);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(players.get(1).inventory).toHaveLength(0);
    const arrived = players.get(2).inventory.map((s: any) => s.instance);
    // ORDER pinned, not membership (the fix-round review): charms land in
    // distinct receiver slots in grant order, so a swapped pass pair would
    // ship the self-signed copy first and this line reds.
    expect(arrived).toEqual([foreign, selfSigned]);
  });

  it('signed NON-charm equipment keeps the plain highest-index walk (no deprioritization)', () => {
    // The scope pin: crafting signs every rare-or-better output and every
    // masterwork proc, and for equipment the seller's signature is the very
    // thing the buyer trades for (a commission, a masterwork sale). The
    // predicate must not reroute those: a non-toolEffect item ships
    // highest-index-first exactly as before, self-signed included.
    const selfSigned = { signer: 'Ayla', rolled: { power: 3 } };
    const foreign = { signer: 'Cedric' };
    const { ctx, players } = makeInstancedTradeCtx(
      [
        { itemId: 'wolf_fang', count: 1, instance: foreign },
        { itemId: 'wolf_fang', count: 1, instance: selfSigned },
      ],
      [],
    );

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 1);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    // Highest index first: the freshly-signed self copy crosses, the foreign
    // one stays, the pre-deprioritize order for everything but charms.
    expect(players.get(1).inventory).toHaveLength(1);
    expect(players.get(1).inventory[0].instance).toEqual(foreign);
    expect(players.get(2).inventory).toHaveLength(1);
    expect(players.get(2).inventory[0].instance).toEqual(selfSigned);
  });

  it('charm copies never merge (stack 1): the premise that keeps the two-pass capacity-neutral', () => {
    // The load-bearing premise of the coupling closure: charms are kind
    // 'tool' (stack size 1), so EVERY arriving charm copy costs exactly one
    // fresh receiver slot regardless of which signer's copy the two-pass
    // ships, and the copy-choice order cannot move a swap across the
    // capacity boundary. If this pin ever fails (a future stackable charm),
    // the fitsAfterSwap mirror stops being defence-in-depth and becomes
    // load-bearing: re-derive the mergeable-payload overflow scenario before
    // widening anything.
    expect(bagsMod.stackSizeOf(ITEMS.gatherers_cache)).toBe(1);
    expect(bagsMod.stackSizeOf(ITEMS.artisans_eye)).toBe(1);

    // And behaviorally: a receiver holding a byte-equal same-signer stack
    // still absorbs the arrival into its OWN slot, never a merge.
    const foreign = { signer: 'Cedric' };
    const { ctx, players } = makeInstancedTradeCtx(
      [{ itemId: 'gatherers_cache', count: 1, instance: foreign }],
      [{ itemId: 'gatherers_cache', count: 1, instance: { signer: 'Cedric' } }],
    );
    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'gatherers_cache', count: 1 }], 0, 1);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);
    const stacks = players.get(2).inventory.filter((s: any) => s.itemId === 'gatherers_cache');
    expect(stacks).toHaveLength(2);
    expect(stacks.every((s: any) => s.count === 1)).toBe(true);
  });

  it('refuses a charm swap into a full receiver: one slot per copy, both walk orders agree', () => {
    // Capacity arm over the deprioritized item class: the receiver is at
    // full capacity, and since a charm arrival always needs a fresh slot
    // (premise pin above), the model must refuse whichever copy the
    // two-pass would ship.
    const selfSigned = { signer: 'Ayla' };
    const foreign = { signer: 'Cedric' };
    const receiverInv = Array.from({ length: 16 }, (_, i) => ({
      itemId: `filler_${i}`,
      count: 1,
    }));
    const { ctx, players, events } = makeInstancedTradeCtx(
      [
        { itemId: 'gatherers_cache', count: 1, instance: selfSigned },
        { itemId: 'gatherers_cache', count: 1, instance: foreign },
      ],
      receiverInv,
    );
    expect(players.get(2).inventory).toHaveLength(16);

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'gatherers_cache', count: 1 }], 0, 1);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(players.get(2).inventory).toHaveLength(16);
    expect(players.get(1).inventory).toHaveLength(2);
    expect(events.some((e) => e.type === 'error' && /not enough bag space/.test(e.text))).toBe(
      true,
    );
  });

  it('fitsAfterSwap runs the removal walk ITSELF, never a second model of it (source pin)', () => {
    // The QA round replaced the model's re-description of the walk (which
    // had drifted three times: #2139, #2605, then the fungible-first-vs-
    // pinned-copy overflow) with the walk itself: the capacity gate calls
    // shippedOfferUnits over scratch copies for BOTH the gives and the
    // receives, and removeOffer routes through the SAME function, so the
    // modeled copies equal the shipped copies by construction. The guard is
    // structural because a behavioral arm can only catch the drifts someone
    // already thought of. Comment-stripped so prose cannot satisfy it.
    const src = readFileSync(join(__dirname, '../src/sim/social/trade.ts'), 'utf8').replace(
      /\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
      '',
    );
    const start = src.indexOf('const fitsAfterSwap = (');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('fitsAfterSwap(metaA', start);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    // Both sides of the swap resolve through the one walk definition: the
    // gives leave a scratch of the receiver's own bags, the receives are the
    // giver's walk over the giver's scratch. Each walk names its RECIPIENT
    // and shares tradeConfirm's ONE memoized clock read (the BoP party-trade
    // window resolves the soulbound skip against both). Whitespace-collapsed:
    // the second call wraps across lines.
    const flatBody = body.replace(/\s+/g, ' ');
    expect(flatBody).toContain(
      'shippedOfferUnits(ctx, gives, meta.entityId, giver.entityId, scratchOwn, nowMsFor)',
    );
    expect(flatBody).toContain(
      'shippedOfferUnits( ctx, receives, giver.entityId, meta.entityId, scratchGiver, nowMsFor, )',
    );
    // Exactly two walk calls, and the model must CONSUME the second one's
    // return: a fork that keeps both calls but iterates its own hand-rolled
    // walk (presence pins alone cannot see that) fails the count, the
    // consumption pin, or the no-second-index-walk negative below.
    expect(body.match(/shippedOfferUnits\(/g)).toHaveLength(2);
    expect(body).toContain('for (const g of shipped)');
    expect(body).not.toMatch(/for \(let i = [^;]*inventory\.length - 1/);
    // The arrival is landed unit by unit with the boundTo stamp arm, keyed on
    // payload AND marker (the merge key addStacked really uses).
    expect(body).toContain('addStacked(scratchOwn, g.itemId, 1, arrival, u.craftedRecipeId)');
    expect(body).toContain('boundTo: meta.entityId');
    // And the LIVE removal consumes the same walk, so the pin above cannot be
    // satisfied by a fork: removeOffer must delegate to shippedOfferUnits.
    const removeStart = src.indexOf('function removeOffer(');
    expect(removeStart).toBeGreaterThan(-1);
    const removeBody = src.slice(removeStart, src.indexOf('function grantOffer(', removeStart));
    // Whitespace-insensitive: the call wraps across lines since gaining toPid.
    expect(removeBody.replace(/\s+/g, ' ')).toContain('shippedOfferUnits( ctx, items, fromPid,');
  });

  it('sellerSignedCharmDeprioritize scopes to charms and a resolved seller name', () => {
    // The predicate builder is the single definition both removeOffer and
    // fitsAfterSwap consume; its three refusal arms are the scope contract.
    expect(tradeMod.sellerSignedCharmDeprioritize(undefined, 'gatherers_cache')).toBeUndefined();
    expect(tradeMod.sellerSignedCharmDeprioritize('Ayla', 'wolf_fang')).toBeUndefined();
    const pred = tradeMod.sellerSignedCharmDeprioritize('Ayla', 'gatherers_cache');
    expect(pred).toBeDefined();
    expect(pred?.({ signer: 'Ayla' })).toBe(true);
    expect(pred?.({ signer: 'Cedric' })).toBe(false);
    expect(pred?.({})).toBe(false);
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

  // #2605 review (Rubsey/OSSBrain): fitsAfterSwap must bucket the plain
  // (fungible) receive by craftedRecipeId, the same way grantOffer grants it,
  // or the capacity simulation can see room in an existing marker-free stack
  // that the real grant (addStacked, keyed on the marker) cannot merge into,
  // underpredicting the receiver's slot usage and overflowing their bags.
  it('rejects a trade that would push the receiver over bag capacity via a crafted-provenance plain grant', () => {
    const receiverInv = [
      { itemId: 'wolf_fang', count: 1 }, // marker-free plain stack (room to stack under a naive fit)
      ...Array.from({ length: 15 }, (_, i) => ({ itemId: `filler_${i}`, count: 1 })),
    ];
    const { ctx, players, events } = makeInstancedTradeCtx(
      [{ itemId: 'wolf_fang', count: 1, craftedRecipeId: 'recipe_wolf_fang' }],
      receiverInv,
    );
    expect(players.get(2).inventory).toHaveLength(16);

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 1);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    // Trade must be rejected, not silently overflow the receiver to 17 slots
    // by assuming the crafted-marker grant merges into the marker-free stack.
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

  it('keeps full payloads (signer/charges/rolled/enchant) for instances in both directions', () => {
    // The acceptance criterion end to end: side A's offer mixes a plain
    // copy with a fully-loaded instanced copy while side B offers a different
    // instanced item in the SAME trade, so tradeConfirm's second offer leg
    // (offerB, b to a) moves an instance too, and every payload field
    // (signer, charges, rolled incl. the masterwork marker, the enchant
    // marker) must land intact on the right receiver's granted item. boundTo is
    // deliberately NOT set here: Professions 2.0 made boundTo the
    // trade-lock marker, so a copy carrying it can no longer be offered at all
    // (that behavior lives in professions_typed_reagents.test.ts's bind-on-trade
    // suite); a freely tradeable instance never carries boundTo.
    const instA = {
      signer: 'Ayla',
      charges: { lifesteal: 2 },
      rolled: { stats: { atk: 3 }, masterwork: true },
      enchant: 'flame_weapon',
    };
    const instB = {
      signer: 'Borin',
      charges: { warmth: 5 },
      rolled: { stats: { sta: 2 }, masterwork: true },
      enchant: 'hearth_ward',
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

  it('trades partial counted stacks both directions with payload survival and conservation', () => {
    // Side A offers 4 wolf_fang covered by 2 plain units plus 2 units of a
    // count-3 signed stack; side B offers a count-2 signed bread stack. Every
    // unit must land with its payload and the per-item unit totals conserve.
    const { ctx, players, events } = makeInstancedTradeCtx(
      [
        { itemId: 'wolf_fang', count: 2 },
        { itemId: 'wolf_fang', count: 3, instance: { signer: 'Ayla' } },
      ],
      [
        { itemId: 'wolf_fang', count: 1, instance: { signer: 'Ayla' } },
        { itemId: 'baked_bread', count: 2, instance: { signer: 'Borin' } },
      ],
    );

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 4 }], 0, 1);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'baked_bread', count: 2 }], 0, 2);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);
    expect(events.some((e) => e.type === 'error')).toBe(false);

    // A keeps one signed fang and receives the signed bread as ONE merged stack.
    const invA = players.get(1).inventory;
    expect(invA.find((s: any) => s.itemId === 'wolf_fang')).toEqual({
      itemId: 'wolf_fang',
      count: 1,
      instance: { signer: 'Ayla' },
    });
    const breadA = invA.filter((s: any) => s.itemId === 'baked_bread');
    expect(breadA).toHaveLength(1);
    expect(breadA[0].count).toBe(2);
    expect(breadA[0].instance).toEqual({ signer: 'Borin' });

    // B receives 2 plain fangs plus 2 signed units merged into their own
    // byte-equal signed stack (1 + 2 = 3); the bread left entirely.
    const invB = players.get(2).inventory;
    expect(invB.some((s: any) => s.itemId === 'baked_bread')).toBe(false);
    const plainB = invB.find((s: any) => s.itemId === 'wolf_fang' && !s.instance);
    const signedB = invB.filter((s: any) => s.itemId === 'wolf_fang' && s.instance);
    expect(plainB?.count).toBe(2);
    expect(signedB).toHaveLength(1);
    expect(signedB[0].count).toBe(3);
    expect(signedB[0].instance).toEqual({ signer: 'Ayla' });

    // Unit conservation across both sides: 6 fangs and 2 breads, before and after.
    const units = (itemId: string) =>
      [...players.get(1).inventory, ...players.get(2).inventory]
        .filter((s: any) => s.itemId === itemId)
        .reduce((n: number, s: any) => n + s.count, 0);
    expect(units('wolf_fang')).toBe(6);
    expect(units('baked_bread')).toBe(2);
  });

  it('stages the offer as PER-COPY slots carrying the payloads the swap will move', () => {
    // The old normalization stripped every staged slot to id plus count, so
    // the counterparty's window (and the $WOC directed-offer fingerprint fed
    // from it) could never see WHICH copy was on the table. Staging now
    // previews the swap's own selection walk (plain first, then instanced,
    // highest index first) and records the per-copy payloads it picks.
    const { ctx, players } = makeInstancedTradeCtx(
      [
        { itemId: 'wolf_fang', count: 1 },
        { itemId: 'wolf_fang', count: 1, instance: { signer: 'Ayla' } },
      ],
      [],
    );
    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 2 }], 0, 1);
    const session = tradeMod.tradeFor(ctx, 1);
    const staged = (session!.a === 1 ? session!.offerA : session!.offerB).items;
    expect(staged).toEqual([
      { itemId: 'wolf_fang', count: 1 },
      { itemId: 'wolf_fang', count: 1, instance: { signer: 'Ayla' } },
    ]);
    // The staged payload is the preview's own clone, never an alias of the
    // live bag copy: mutating it must not reach the bags.
    (staged[1].instance as { signer: string }).signer = 'Tampered';
    expect(players.get(1).inventory[1].instance.signer).toBe('Ayla');
  });

  it('groups staged units by copy identity, in the selection order', () => {
    const { ctx } = makeInstancedTradeCtx(
      [
        { itemId: 'wolf_fang', count: 2, instance: { signer: 'Ayla' } },
        { itemId: 'wolf_fang', count: 1, instance: { signer: 'Borin' } },
      ],
      [],
    );
    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 3 }], 0, 1);
    const session = tradeMod.tradeFor(ctx, 1);
    const staged = (session!.a === 1 ? session!.offerA : session!.offerB).items;
    // Highest index first: the Borin copy sits above the Ayla stack, and the
    // two identical Ayla units group back into one slot.
    expect(staged).toEqual([
      { itemId: 'wolf_fang', count: 1, instance: { signer: 'Borin' } },
      { itemId: 'wolf_fang', count: 2, instance: { signer: 'Ayla' } },
    ]);
  });

  it('falls back to the generic walk when a staged copy left the bags before confirm', () => {
    // Bags can change between staging and confirm; offerCovered re-validates
    // the per-id totals, and a missing pinned copy must not fail the trade
    // (the pre-preview behavior: SOME eligible copy moves). The staged
    // display was stale for exactly the window the player changed their own
    // bags, which is the honesty level the gold trade always had.
    const { ctx, players, events } = makeInstancedTradeCtx(
      [
        { itemId: 'wolf_fang', count: 1 },
        { itemId: 'wolf_fang', count: 1, instance: { signer: 'Ayla' } },
      ],
      [],
    );
    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    // Stage ONE fang: the preview pins the PLAIN copy (plain-first walk).
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 1);
    // The plain copy then leaves the bags outside the trade's sight.
    const invA = players.get(1).inventory;
    invA.splice(
      invA.findIndex((s: any) => s.itemId === 'wolf_fang' && !s.instance),
      1,
    );
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);
    expect(events.some((e: any) => e.type === 'error')).toBe(false);
    // The signed copy crossed instead of the vanished plain one.
    expect(players.get(2).inventory).toEqual([
      { itemId: 'wolf_fang', count: 1, instance: { signer: 'Ayla' } },
    ]);
    expect(players.get(1).inventory.filter((s: any) => s.itemId === 'wolf_fang')).toHaveLength(0);
  });

  it('ships the PINNED signed copy when a plain twin lands in the bags before confirm', () => {
    // Every other case here leaves the pinned walk and the generic one
    // agreeing, because both are plain-first over the same unchanged bags, so
    // nothing so far can tell which one ran. This one separates them: the
    // preview pinned the signed copy (it was the only copy held) and a plain
    // copy then arrived ABOVE it. The generic walk is plain-first and would
    // ship that newcomer, handing the buyer a copy the window never showed.
    const signed = { signer: 'Ayla', rolled: { quality: 'epic' } };
    const { ctx, players, events } = makeInstancedTradeCtx(
      [{ itemId: 'wolf_fang', count: 1, instance: signed }],
      [],
    );
    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 1);
    const session = tradeMod.tradeFor(ctx, 1);
    expect(
      (session!.a === 1 ? session!.offerA : session!.offerB).items,
      'the preview pinned the signed copy',
    ).toEqual([{ itemId: 'wolf_fang', count: 1, instance: signed }]);
    // A loot drop lands a plain copy of the same id above it, in the window
    // between staging and confirm.
    players.get(1).inventory.push({ itemId: 'wolf_fang', count: 1 });

    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(players.get(2).inventory).toEqual([{ itemId: 'wolf_fang', count: 1, instance: signed }]);
    expect(players.get(1).inventory, 'the newcomer stayed home').toEqual([
      { itemId: 'wolf_fang', count: 1 },
    ]);
  });

  it('refuses the swap when the PINNED instanced copy cannot fit, whatever the plain stock says', () => {
    // The capacity model must budget the copies the removal will actually
    // ship. The preview pinned the SIGNED copy (the only one held at staging);
    // a plain twin then lands in the giver's bags. A fungible-first model sees
    // one plain unit merging into the receiver's partial plain stack and
    // passes the gate, but the swap ships the pinned signed copy, which can
    // never merge into a plain stack and needs a seventeenth slot the
    // receiver does not have.
    const signed = { signer: 'Ayla', rolled: { quality: 'epic' } };
    const filler = Array.from({ length: 15 }, (_, i) => ({ itemId: `filler_${i}`, count: 1 }));
    const { ctx, players, events } = makeInstancedTradeCtx(
      [{ itemId: 'wolf_fang', count: 1, instance: signed }],
      [...filler, { itemId: 'wolf_fang', count: 1 }],
    );
    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 1);
    players.get(1).inventory.push({ itemId: 'wolf_fang', count: 1 });

    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(
      events.some((e) => e.type === 'error' && String(e.text).includes('not enough bag space')),
      'the capacity gate must refuse the unmergeable pinned arrival',
    ).toBe(true);
    expect(players.get(2).inventory, 'the receiver stayed at capacity').toHaveLength(16);
    expect(players.get(1).inventory, 'nothing left the giver').toHaveLength(2);
  });

  it('frees the instanced give its OWN slot in the model, so a full-bag swap completes', () => {
    // The GIVES half of the same rework: the old model removed gives by item
    // id (removeStacked, highest-index-first over any slot), so with a plain
    // stack sitting ABOVE the pinned instanced give it freed a plain unit
    // and left the instanced slot occupied in scratch, over-counting a full
    // giver's slots and refusing a swap that really fits. The walk frees the
    // exact staged slot.
    const signedA = { signer: 'Ayla' };
    const signedB = { signer: 'Borin' };
    const filler = Array.from({ length: 14 }, (_, i) => ({ itemId: `filler_${i}`, count: 1 }));
    const { ctx, players, events } = makeInstancedTradeCtx(
      [...filler, { itemId: 'wolf_fang', count: 1, instance: signedA }],
      [{ itemId: 'baked_bread', count: 1, instance: signedB }],
    );
    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 1);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'baked_bread', count: 1 }], 0, 2);
    // A plain stack lands ABOVE the pinned copy, filling the giver to 16/16.
    players.get(1).inventory.push({ itemId: 'wolf_fang', count: 2 });

    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(
      events.filter((e) => e.type === 'error'),
      'the swap must fit',
    ).toEqual([]);
    expect(
      players.get(1).inventory.some((s: { itemId: string }) => s.itemId === 'baked_bread'),
      'the bread arrived in the slot the give freed',
    ).toBe(true);
    expect(players.get(2).inventory, 'the pinned signed copy crossed, not a plain unit').toEqual([
      { itemId: 'wolf_fang', count: 1, instance: signedA },
    ]);
    expect(
      players
        .get(1)
        .inventory.find(
          (s: { itemId: string; instance?: unknown }) => s.itemId === 'wolf_fang' && !s.instance,
        )?.count,
      'the plain stack stayed whole',
    ).toBe(2);
  });

  it('ships the pinned CRAFTED copy, never the payload-equal unmarked twin above it', () => {
    // The crafted marker is the third leg of copy identity, so a payload-equal
    // twin differing only in provenance is a DIFFERENT copy: shipping it
    // launders the crafting provenance the disenchant anti-farming gate reads
    // and breaks the directed-rail fingerprint. Marker-blind, the removal walks
    // highest-index-first straight onto the twin that arrived after staging.
    const payload = { signer: 'Ayla' };
    const { ctx, players, events } = makeInstancedTradeCtx(
      [
        {
          itemId: 'wolf_fang',
          count: 1,
          instance: { ...payload },
          craftedRecipeId: 'recipe_fang',
        },
      ],
      [],
    );
    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 1);
    const session = tradeMod.tradeFor(ctx, 1);
    expect((session!.a === 1 ? session!.offerA : session!.offerB).items).toEqual([
      { itemId: 'wolf_fang', count: 1, instance: payload, craftedRecipeId: 'recipe_fang' },
    ]);
    // The twin arrives at the HIGHER index, which is exactly where a
    // marker-blind walk looks first.
    players.get(1).inventory.push({ itemId: 'wolf_fang', count: 1, instance: { ...payload } });

    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(players.get(2).inventory).toEqual([
      { itemId: 'wolf_fang', count: 1, instance: payload, craftedRecipeId: 'recipe_fang' },
    ]);
    expect(players.get(1).inventory).toEqual([
      { itemId: 'wolf_fang', count: 1, instance: payload },
    ]);
    expect(players.get(1).inventory[0].craftedRecipeId).toBeUndefined();
  });

  it('ships the pinned UNMARKED copy, never the payload-equal crafted twin above it', () => {
    // The other direction, and the one that would forge provenance rather
    // than lose it: a marker-blind walk hands the buyer a crafted copy the
    // seller never staged, which reads as a legitimately crafted item on
    // every surface that inspects it.
    const payload = { signer: 'Ayla' };
    const { ctx, players, events } = makeInstancedTradeCtx(
      [{ itemId: 'wolf_fang', count: 1, instance: { ...payload } }],
      [],
    );
    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 1);
    const session = tradeMod.tradeFor(ctx, 1);
    const staged = (session!.a === 1 ? session!.offerA : session!.offerB).items;
    expect(staged).toEqual([{ itemId: 'wolf_fang', count: 1, instance: payload }]);
    expect(staged[0].craftedRecipeId).toBeUndefined();
    players.get(1).inventory.push({
      itemId: 'wolf_fang',
      count: 1,
      instance: { ...payload },
      craftedRecipeId: 'recipe_fang',
    });

    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(players.get(2).inventory).toEqual([
      { itemId: 'wolf_fang', count: 1, instance: payload },
    ]);
    expect(players.get(2).inventory[0].craftedRecipeId, 'no provenance was forged').toBeUndefined();
    expect(players.get(1).inventory).toEqual([
      { itemId: 'wolf_fang', count: 1, instance: payload, craftedRecipeId: 'recipe_fang' },
    ]);
  });

  it('accepts a trade that fits only by merging into a byte-equal receiver stack', () => {
    // The receiver is slot-full, but one slot is a byte-equal signed stack
    // with room: the capacity gate must model the merge and accept
    // (the older one-fresh-slot-per-instanced-unit model refused this).
    const { ctx, players, events } = makeInstancedTradeCtx(
      [{ itemId: 'wolf_fang', count: 1, instance: { signer: 'Ayla' } }],
      [
        { itemId: 'wolf_fang', count: 1, instance: { signer: 'Ayla' } },
        ...Array.from({ length: 15 }, (_, i) => ({ itemId: `filler_${i}`, count: 1 })),
      ],
    );
    expect(players.get(2).inventory).toHaveLength(16);

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 1);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(players.get(1).inventory).toHaveLength(0);
    expect(players.get(2).inventory).toHaveLength(16);
    const merged = players.get(2).inventory.find((s: any) => s.itemId === 'wolf_fang');
    expect(merged.count).toBe(2);
    expect(merged.instance).toEqual({ signer: 'Ayla' });
  });

  it('still refuses at full capacity when the byte-equal twin bears charges (never merged)', () => {
    const charged = { signer: 'Ayla', charges: { zap: 1 } };
    const { ctx, players, events } = makeInstancedTradeCtx(
      [{ itemId: 'wolf_fang', count: 1, instance: { ...charged, charges: { zap: 1 } } }],
      [
        { itemId: 'wolf_fang', count: 1, instance: { ...charged, charges: { zap: 1 } } },
        ...Array.from({ length: 15 }, (_, i) => ({ itemId: `filler_${i}`, count: 1 })),
      ],
    );

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 1);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(events.some((e) => e.type === 'error' && /not enough bag space/.test(e.text))).toBe(
      true,
    );
    expect(players.get(1).inventory).toHaveLength(1);
    expect(players.get(2).inventory).toHaveLength(16);
  });

  it('models per-copy slots of ONE id against a shared fungible budget (no double-count)', () => {
    // The fix-round blocker: stagedOfferSlots splits one line into per-copy
    // slots, and a per-slot capacity pass re-counted the same giver stock
    // (two slots of one id each claimed the single plain unit, the model
    // predicted one arrival slot where the grant needs two, and the receiver
    // overflowed past the gate). One plain plus one signed fang need TWO
    // receiver slots; with one free slot the trade must refuse.
    const giver = [
      { itemId: 'wolf_fang', count: 1 },
      { itemId: 'wolf_fang', count: 1, instance: { signer: 'Ayla' } },
    ];
    const receiverFull = Array.from({ length: 15 }, (_, i) => ({
      itemId: `filler_${i}`,
      count: 1,
    }));
    {
      const { ctx, players, events } = makeInstancedTradeCtx(structuredClone(giver), [
        ...structuredClone(receiverFull),
      ]);
      tradeMod.tradeRequest(ctx, 2, 1);
      tradeMod.tradeAccept(ctx, 2);
      tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 2 }], 0, 1);
      tradeMod.tradeConfirm(ctx, 1);
      tradeMod.tradeConfirm(ctx, 2);
      expect(events.some((e) => e.type === 'error' && /not enough bag space/.test(e.text))).toBe(
        true,
      );
      expect(players.get(1).inventory, 'nothing left the giver').toHaveLength(2);
      expect(players.get(2).inventory, 'nothing overflowed in').toHaveLength(15);
    }
    // The positive control: two free slots fit the same offer.
    {
      const { ctx, players, events } = makeInstancedTradeCtx(
        structuredClone(giver),
        structuredClone(receiverFull).slice(0, 14),
      );
      tradeMod.tradeRequest(ctx, 2, 1);
      tradeMod.tradeAccept(ctx, 2);
      tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 2 }], 0, 1);
      tradeMod.tradeConfirm(ctx, 1);
      tradeMod.tradeConfirm(ctx, 2);
      expect(events.some((e) => e.type === 'error')).toBe(false);
      expect(players.get(2).inventory).toHaveLength(16);
    }
  });

  it('fires the quest hook ONCE per transfer batch, not per staged slot or per id', () => {
    // The hook is a whole-log recompute that emits only deltas, and every
    // fire after the removal loop sees the same final state, so one call
    // carries everything and the call COUNT is the only observable. Per-copy
    // staging can split one id across several slots; neither the slot count
    // nor the id count may multiply the recompute. Staging itself is a
    // preview: no fire.
    const instance = { signer: 'Ayla' };
    const { ctx, players } = makeInstancedTradeCtx(
      [
        { itemId: 'wolf_fang', count: 1 },
        { itemId: 'wolf_fang', count: 1, instance },
        { itemId: 'baked_bread', count: 1 },
      ],
      [],
    );
    let fired = 0;
    (ctx as any).onInventoryChangedForQuests = () => fired++;
    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(
      ctx,
      [
        { itemId: 'wolf_fang', count: 2 },
        { itemId: 'baked_bread', count: 1 },
      ],
      0,
      1,
    );
    expect(fired, 'staging is a preview, not an inventory change').toBe(0);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);
    expect(players.get(2).inventory).toHaveLength(3);
    expect(fired, 'one batch fire for two ids across three staged slots').toBe(1);
  });

  it('emits the batch quest deltas in QUEST-LOG order, not in the offer line order', () => {
    // What the single batch fire trades away: the retired per-line fires
    // walked the log once per offer line, so the first line's id reported
    // first. One fire after the whole removal walks the log ONCE, so the
    // order is the log's. Wired to the REAL hook rather than a counter, since
    // the order under test is the shipped walk's, not a fixture's idea of it.
    const { ctx, players, events } = makeInstancedTradeCtx(
      [
        { itemId: 'copper_ore', count: 1 },
        { itemId: 'game_meat', count: 1 },
      ],
      [],
    );
    const meta = players.get(1);
    meta.wireRev = 0;
    meta.counters = { questProgress: 0 };
    // The log runs OPPOSITE to the offer lines staged below: kitchens
    // (game_meat) is logged first, forge (copper_ore) is offered first.
    meta.questLog = new Map([
      [
        'q_prof_workorder_kitchens',
        { questId: 'q_prof_workorder_kitchens', state: 'active', counts: [1] },
      ],
      [
        'q_prof_workorder_forge',
        { questId: 'q_prof_workorder_forge', state: 'active', counts: [1] },
      ],
    ]);
    (ctx as any).onInventoryChangedForQuests = (m: any) =>
      questCredit.onInventoryChangedForQuests(ctx, m);

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(
      ctx,
      [
        { itemId: 'copper_ore', count: 1 },
        { itemId: 'game_meat', count: 1 },
      ],
      0,
      1,
    );
    const session = tradeMod.tradeFor(ctx, 1);
    const staged = (session!.a === 1 ? session!.offerA : session!.offerB).items;
    expect(
      staged.map((s) => s.itemId),
      'the offer line order the reordering is measured against',
    ).toEqual(['copper_ore', 'game_meat']);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(
      events.filter((e) => e.type === 'questProgress').map((e) => e.questId),
      'log order, not offer order',
    ).toEqual(['q_prof_workorder_kitchens', 'q_prof_workorder_forge']);
    // Both really moved: an order pin over a single event would pass on any
    // ordering at all.
    expect(events.filter((e) => e.type === 'questProgress').map((e) => e.current)).toEqual([0, 0]);
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

// The count pins in command_schema re-derive the send set from source, which
// cannot say WHICH method emits a token: a swap between tradeClose and
// tradeCancel keeps every derived set identical and passes everything. Pin the
// two sends apart at the ClientWorld boundary (the target_echo_client idiom).
describe('ClientWorld trade sends', () => {
  it('tradeClose sends trade_close, distinct from tradeCancel', () => {
    const world = bareClient(1);
    // Intercept rather than call through: the bare client has no socket, and
    // the pin is about WHICH token each method hands to the send path.
    const cmd = vi
      .spyOn(world as unknown as { cmd: (m: unknown) => void }, 'cmd')
      .mockImplementation(() => {});

    world.tradeClose();
    expect(cmd).toHaveBeenCalledWith({ cmd: 'trade_close' });

    cmd.mockClear();
    world.tradeCancel();
    expect(cmd).toHaveBeenCalledWith({ cmd: 'trade_cancel' });
    // Instance spy on a test-local bareClient, so nothing leaks; restored for
    // the scoping to be self-evident rather than incidental.
    cmd.mockRestore();
  });

  it("the server's trade_close dispatch arm resolves to sim.tradeClose, not tradeCancel", () => {
    // The server-side mirror of the client pin above: command_schema only
    // scans for the case LABEL, so a tradeClose/tradeCancel swap inside the
    // arm keeps every derived set identical. Comment-stripped, bounded at the
    // next case label so the window covers this arm alone.
    const game = readFileSync(join(__dirname, '..', 'server', 'game.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // URL-guarded line strip: a :// in this 10k-line file must not eat the
      // rest of its line (#2499).
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const start = game.indexOf("case 'trade_close':");
    expect(start).toBeGreaterThan(-1);
    const end = game.indexOf('case ', start + 1);
    expect(end).toBeGreaterThan(start);
    const arm = game.slice(start, end);
    expect(arm).toContain('sim.tradeClose(pid)');
    expect(arm).not.toContain('tradeCancel');
    // Positive control for the absence: the cancel arm exists and the scanner
    // sees its token, so the not.toContain above is a real absence.
    expect(game).toContain('sim.tradeCancel(pid)');
  });
});
