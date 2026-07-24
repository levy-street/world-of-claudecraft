// The INTERLEAVED race arm. Destroy commands (disenchant_item/salvage_item/
// apply_enchant) racing a concurrent trade of the same item, and racing
// concurrent inv_move reorders, over the REAL online dispatch path (live
// in-process GameServer, the tests/professions_bind_on_trade_online.test.ts recipe).
// Every scenario asserts CONSERVATION: total copies across both players plus
// destructions balances exactly; no dupe, no double-destroy, coherent lastX.
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
import type { PlayerMeta } from '../src/sim/sim';
import type { InvSlot, SimEvent } from '../src/sim/types';

const SWORD = 'eastbrook_arming_sword'; // common: disenchants to dust, salvages to bone_fragments
const WEAPON_ENCHANT = 'enchant_weapon_might'; // mainhand, 5x arcane_dust
const DUST = 'arcane_dust';
const BONE = 'bone_fragments';
const TRADE_FAILED = 'Trade failed: items or money no longer available.';

const FIELD_A = { x: 0, z: 150 };
const FIELD_B = { x: 3, z: 150 };

type WireMsg = { t: string; list?: SimEvent[]; [k: string]: unknown };

function fakeWs(): { sent: WireMsg[]; ws: unknown } {
  const sent: WireMsg[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
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
  const entity = (
    server.sim as unknown as { entities: Map<number, { pos: any; prevPos?: any }> }
  ).entities.get(pid);
  if (!entity) throw new Error(`no entity for pid ${pid}`);
  entity.pos.x = pos.x;
  entity.pos.z = pos.z;
  entity.prevPos = { x: pos.x, z: pos.z };
}

function routeTick(server: GameServer): void {
  (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(server.sim.tick());
}

function cmd(server: GameServer, session: ClientSession, body: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));
}

function eventsFor(sent: WireMsg[], type: SimEvent['type'], fromIdx = 0): SimEvent[] {
  return sent
    .slice(fromIdx)
    .filter((m) => m.t === 'events')
    .flatMap((m) => m.list ?? [])
    .filter((ev) => ev.type === type);
}

function errTexts(sent: WireMsg[], fromIdx = 0): string[] {
  return eventsFor(sent, 'error', fromIdx).map((e) => (e as { text?: string }).text ?? '');
}

function serverInv(server: GameServer, pid: number): InvSlot[] {
  const meta = (server.sim as unknown as { players: Map<number, PlayerMeta> }).players.get(pid);
  if (!meta) throw new Error(`no meta for pid ${pid}`);
  return meta.inventory;
}

function totalOf(server: GameServer, itemId: string, pids: number[]): number {
  return pids.reduce((n, pid) => n + server.sim.countItem(itemId, pid), 0);
}

type Pair = {
  server: GameServer;
  fcA: ReturnType<typeof fakeWs>;
  fcB: ReturnType<typeof fakeWs>;
  a: ClientSession;
  b: ClientSession;
};

function pairUp(idBase: number): Pair {
  const server = new GameServer();
  const fcA = fakeWs();
  const fcB = fakeWs();
  const a = joinServer(server, fcA, idBase, 'Racer');
  const b = joinServer(server, fcB, idBase + 1, 'Counter');
  placeAt(server, a.pid, FIELD_A);
  placeAt(server, b.pid, FIELD_B);
  return { server, fcA, fcB, a, b };
}

function openTrade(p: Pair): void {
  cmd(p.server, p.a, { cmd: 'trade_req', id: p.b.pid });
  cmd(p.server, p.b, { cmd: 'trade_accept' });
}

// ---------------------------------------------------------------------------
// 1. Disenchant racing a concurrent trade of the same item, both orders,
//    interleaved within one tick AND across ticks.
// ---------------------------------------------------------------------------
describe('race: disenchant vs concurrent trade of the same copy', () => {
  it('destroy-before-confirm (same tick): the trade is invalidated, never both consuming the copy', () => {
    const p = pairUp(701);
    p.server.sim.addItem(SWORD, 1, p.a.pid);
    openTrade(p);
    cmd(p.server, p.a, { cmd: 'trade_offer', items: [{ itemId: SWORD, count: 1 }] });
    cmd(p.server, p.a, { cmd: 'trade_confirm' });
    // A destroys the offered copy BEFORE B's confirm lands, all in one tick.
    cmd(p.server, p.a, { cmd: 'disenchant_item', item: SWORD });
    cmd(p.server, p.b, { cmd: 'trade_confirm' });
    routeTick(p.server);

    // The disenchant succeeded exactly once (dust granted once).
    const denc = eventsFor(p.fcA.sent, 'disenchantResult');
    expect(denc).toHaveLength(1);
    expect((denc[0] as { ok?: boolean }).ok).toBe(true);
    expect(p.server.sim.countItem(DUST, p.a.pid)).toBeGreaterThan(0);
    // The trade did NOT also transfer the copy: confirm-time revalidation
    // failed and both parties were told.
    expect(errTexts(p.fcA.sent)).toContain(TRADE_FAILED);
    expect(errTexts(p.fcB.sent)).toContain(TRADE_FAILED);
    // Conservation: exactly one copy existed, exactly one destruction, zero
    // copies remain anywhere. No dupe into B, no double-destroy.
    expect(totalOf(p.server, SWORD, [p.a.pid, p.b.pid])).toBe(0);
    expect(p.server.sim.countItem(SWORD, p.b.pid)).toBe(0);
    // The session is closed (no zombie trade holding a stale offer).
    expect(
      (p.server.sim as unknown as { ctx: { trades: Map<number, unknown> } }).ctx.trades.get(
        p.a.pid,
      ),
    ).toBeUndefined();
  });

  it('destroy-before-confirm (across ticks): same invariant with a tick between every command', () => {
    const p = pairUp(703);
    p.server.sim.addItem(SWORD, 1, p.a.pid);
    openTrade(p);
    routeTick(p.server);
    cmd(p.server, p.a, { cmd: 'trade_offer', items: [{ itemId: SWORD, count: 1 }] });
    routeTick(p.server);
    cmd(p.server, p.a, { cmd: 'trade_confirm' });
    routeTick(p.server);
    cmd(p.server, p.a, { cmd: 'disenchant_item', item: SWORD });
    routeTick(p.server);
    cmd(p.server, p.b, { cmd: 'trade_confirm' });
    routeTick(p.server);

    expect(eventsFor(p.fcA.sent, 'disenchantResult')).toHaveLength(1);
    expect(errTexts(p.fcB.sent)).toContain(TRADE_FAILED);
    expect(totalOf(p.server, SWORD, [p.a.pid, p.b.pid])).toBe(0);
    expect(p.server.sim.countItem(DUST, p.a.pid)).toBeGreaterThan(0);
  });

  it('confirm-before-destroy: the queued disenchant denies not_held, B keeps the copy', () => {
    const p = pairUp(705);
    p.server.sim.addItem(SWORD, 1, p.a.pid);
    openTrade(p);
    cmd(p.server, p.a, { cmd: 'trade_offer', items: [{ itemId: SWORD, count: 1 }] });
    cmd(p.server, p.a, { cmd: 'trade_confirm' });
    cmd(p.server, p.b, { cmd: 'trade_confirm' });
    // The disenchant arrives AFTER the swap, same tick (a queued replay shape).
    const dustBefore = p.server.sim.countItem(DUST, p.a.pid);
    cmd(p.server, p.a, { cmd: 'disenchant_item', item: SWORD });
    routeTick(p.server);
    // And once more on the NEXT tick (the cross-tick queued arrival).
    cmd(p.server, p.a, { cmd: 'disenchant_item', item: SWORD });
    routeTick(p.server);

    const denc = eventsFor(p.fcA.sent, 'disenchantResult');
    expect(denc).toHaveLength(2);
    for (const ev of denc) {
      expect((ev as { ok?: boolean }).ok).toBe(false);
      expect((ev as { reason?: string }).reason).toBe('not_held');
    }
    expect(p.server.sim.lastDisenchantResultFor(p.a.pid)?.reason).toBe('not_held');
    // The traded copy is with B, untouched; no dust was minted for A.
    expect(p.server.sim.countItem(SWORD, p.b.pid)).toBe(1);
    expect(p.server.sim.countItem(SWORD, p.a.pid)).toBe(0);
    expect(p.server.sim.countItem(DUST, p.a.pid)).toBe(dustBefore);
    expect(totalOf(p.server, SWORD, [p.a.pid, p.b.pid])).toBe(1);
  });

  it('partial-stock variant: offer 2, destroy 1 mid-trade; the confirm cannot deliver the ghost copy', () => {
    const p = pairUp(707);
    p.server.sim.addItem(SWORD, 2, p.a.pid);
    openTrade(p);
    cmd(p.server, p.a, { cmd: 'trade_offer', items: [{ itemId: SWORD, count: 2 }] });
    cmd(p.server, p.a, { cmd: 'trade_confirm' });
    cmd(p.server, p.a, { cmd: 'disenchant_item', item: SWORD });
    cmd(p.server, p.b, { cmd: 'trade_confirm' });
    routeTick(p.server);

    // Either the whole trade failed (nothing delivered) or it delivered only
    // real copies. It must never deliver 2 while only 1 exists.
    const bGot = p.server.sim.countItem(SWORD, p.b.pid);
    const aKept = p.server.sim.countItem(SWORD, p.a.pid);
    expect(bGot + aKept).toBe(1); // conservation: 2 minted, 1 destroyed
    expect(errTexts(p.fcB.sent)).toContain(TRADE_FAILED); // the observed deny arm
    expect(bGot).toBe(0);
    expect(aKept).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Salvage racing the same trade, both orders.
// ---------------------------------------------------------------------------
describe('race: salvage vs concurrent trade of the same copy', () => {
  it('salvage-before-confirm (same tick): trade invalidated, one destruction, no dupe', () => {
    const p = pairUp(711);
    p.server.sim.addItem(SWORD, 1, p.a.pid);
    openTrade(p);
    cmd(p.server, p.a, { cmd: 'trade_offer', items: [{ itemId: SWORD, count: 1 }] });
    cmd(p.server, p.a, { cmd: 'trade_confirm' });
    cmd(p.server, p.a, { cmd: 'salvage_item', item: SWORD });
    cmd(p.server, p.b, { cmd: 'trade_confirm' });
    routeTick(p.server);

    const salv = eventsFor(p.fcA.sent, 'salvageResult');
    expect(salv).toHaveLength(1);
    expect((salv[0] as { ok?: boolean }).ok).toBe(true);
    expect(p.server.sim.countItem(BONE, p.a.pid)).toBeGreaterThan(0);
    expect(errTexts(p.fcA.sent)).toContain(TRADE_FAILED);
    expect(totalOf(p.server, SWORD, [p.a.pid, p.b.pid])).toBe(0);
  });

  it('confirm-before-salvage (across ticks): the late salvage denies not_held', () => {
    const p = pairUp(713);
    p.server.sim.addItem(SWORD, 1, p.a.pid);
    openTrade(p);
    routeTick(p.server);
    cmd(p.server, p.a, { cmd: 'trade_offer', items: [{ itemId: SWORD, count: 1 }] });
    cmd(p.server, p.a, { cmd: 'trade_confirm' });
    cmd(p.server, p.b, { cmd: 'trade_confirm' });
    routeTick(p.server);
    const boneBefore = p.server.sim.countItem(BONE, p.a.pid);
    cmd(p.server, p.a, { cmd: 'salvage_item', item: SWORD });
    routeTick(p.server);

    const salv = eventsFor(p.fcA.sent, 'salvageResult');
    expect(salv).toHaveLength(1);
    expect((salv[0] as { reason?: string }).reason).toBe('not_held');
    expect(p.server.sim.lastSalvageResultFor(p.a.pid)?.reason).toBe('not_held');
    expect(p.server.sim.countItem(BONE, p.a.pid)).toBe(boneBefore);
    expect(p.server.sim.countItem(SWORD, p.b.pid)).toBe(1);
    expect(totalOf(p.server, SWORD, [p.a.pid, p.b.pid])).toBe(1);
  });

  it('cross-command double-destroy: disenchant then salvage of the last copy in one tick destroys once', () => {
    const p = pairUp(715);
    p.server.sim.addItem(SWORD, 1, p.a.pid);
    cmd(p.server, p.a, { cmd: 'disenchant_item', item: SWORD });
    cmd(p.server, p.a, { cmd: 'salvage_item', item: SWORD });
    routeTick(p.server);

    const denc = eventsFor(p.fcA.sent, 'disenchantResult');
    const salv = eventsFor(p.fcA.sent, 'salvageResult');
    expect((denc[0] as { ok?: boolean }).ok).toBe(true);
    expect((salv[0] as { ok?: boolean; reason?: string }).ok).toBe(false);
    expect((salv[0] as { reason?: string }).reason).toBe('not_held');
    expect(p.server.sim.countItem(DUST, p.a.pid)).toBeGreaterThan(0);
    expect(p.server.sim.countItem(BONE, p.a.pid)).toBe(0);
    expect(p.server.sim.countItem(SWORD, p.a.pid)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Destroy racing concurrent inv_move reorders (the only move surface on the
//    wire; there is no bank command). Commands are id-based, so the probe is
//    that the destroy consumes the CORRECT copy (never the enchanted one for
//    disenchant) regardless of slot position churn, and never a stale slot.
// ---------------------------------------------------------------------------
describe('race: disenchant/salvage vs concurrent inv_move of the same item', () => {
  it('disenchant between moves consumes the plain copy, never the enchanted one, wherever it sits', () => {
    const p = pairUp(721);
    p.server.sim.addItem(SWORD, 2, p.a.pid);
    p.server.sim.addItem(DUST, 5, p.a.pid);
    // Make one of the two copies a distinct enchanted instance.
    cmd(p.server, p.a, { cmd: 'apply_enchant', item: SWORD, enchant: WEAPON_ENCHANT });
    routeTick(p.server);
    const inv = serverInv(p.server, p.a.pid);
    const enchIdx = inv.findIndex((s) => s.itemId === SWORD && s.instance?.enchant);
    const plainIdx = inv.findIndex((s) => s.itemId === SWORD && !s.instance);
    expect(enchIdx).toBeGreaterThanOrEqual(0);
    expect(plainIdx).toBeGreaterThanOrEqual(0);

    // Interleave: shuffle the two copies, destroy, shuffle again, same tick.
    cmd(p.server, p.a, { cmd: 'inv_move', from: enchIdx, to: plainIdx });
    cmd(p.server, p.a, { cmd: 'disenchant_item', item: SWORD });
    cmd(p.server, p.a, { cmd: 'inv_move', from: plainIdx, to: enchIdx });
    routeTick(p.server);

    const denc = eventsFor(p.fcA.sent, 'disenchantResult');
    expect(denc).toHaveLength(1);
    expect((denc[0] as { ok?: boolean }).ok).toBe(true);
    // Exactly one copy left and it is the ENCHANTED one: the destroy tracked
    // the item, not a stale index.
    const after = serverInv(p.server, p.a.pid).filter((s) => s.itemId === SWORD);
    expect(after).toHaveLength(1);
    expect(after[0].count).toBe(1);
    expect(after[0].instance?.enchant).toBe(WEAPON_ENCHANT);

    // Now salvage the survivor between two more moves: it consumes the real
    // (enchanted) copy once fungibles are exhausted, and the bags empty out.
    const last = serverInv(p.server, p.a.pid).findIndex((s) => s.itemId === SWORD);
    cmd(p.server, p.a, { cmd: 'inv_move', from: last, to: 0 });
    cmd(p.server, p.a, { cmd: 'salvage_item', item: SWORD });
    routeTick(p.server);
    const salv = eventsFor(p.fcA.sent, 'salvageResult');
    expect(salv).toHaveLength(1);
    expect((salv[0] as { ok?: boolean }).ok).toBe(true);
    expect(p.server.sim.countItem(SWORD, p.a.pid)).toBe(0);
  });

  it('inv_move churn during an open trade offer does not break the swap or duplicate the copy', () => {
    const p = pairUp(723);
    p.server.sim.addItem(SWORD, 1, p.a.pid);
    openTrade(p);
    cmd(p.server, p.a, { cmd: 'trade_offer', items: [{ itemId: SWORD, count: 1 }] });
    const idx = serverInv(p.server, p.a.pid).findIndex((s) => s.itemId === SWORD);
    cmd(p.server, p.a, { cmd: 'inv_move', from: idx, to: 0 });
    cmd(p.server, p.a, { cmd: 'trade_confirm' });
    cmd(p.server, p.a, { cmd: 'inv_move', from: 0, to: idx });
    cmd(p.server, p.b, { cmd: 'trade_confirm' });
    routeTick(p.server);

    expect(p.server.sim.countItem(SWORD, p.b.pid)).toBe(1);
    expect(p.server.sim.countItem(SWORD, p.a.pid)).toBe(0);
    expect(totalOf(p.server, SWORD, [p.a.pid, p.b.pid])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Apply-enchant racing a trade of the TARGET item.
// ---------------------------------------------------------------------------
describe('race: apply_enchant vs concurrent trade of the target copy', () => {
  it('enchant lands mid-offer: the copy is never duplicated and the enchant is never silently lost', () => {
    const p = pairUp(731);
    p.server.sim.addItem(SWORD, 1, p.a.pid);
    p.server.sim.addItem(DUST, 5, p.a.pid);
    openTrade(p);
    cmd(p.server, p.a, { cmd: 'trade_offer', items: [{ itemId: SWORD, count: 1 }] });
    cmd(p.server, p.a, { cmd: 'trade_confirm' });
    // The enchant transforms the offered copy into an instanced enchanted copy
    // of the SAME item id (count stays 1) before B's confirm.
    cmd(p.server, p.a, { cmd: 'apply_enchant', item: SWORD, enchant: WEAPON_ENCHANT });
    cmd(p.server, p.b, { cmd: 'trade_confirm' });
    routeTick(p.server);

    const ench = eventsFor(p.fcA.sent, 'enchantResult');
    expect(ench).toHaveLength(1);
    expect((ench[0] as { ok?: boolean }).ok).toBe(true);
    // Conservation: exactly one copy of the item exists across both players,
    // and exactly one enchanted payload exists, wherever it landed.
    const aCopies = serverInv(p.server, p.a.pid).filter((s) => s.itemId === SWORD);
    const bCopies = serverInv(p.server, p.b.pid).filter((s) => s.itemId === SWORD);
    const total = totalOf(p.server, SWORD, [p.a.pid, p.b.pid]);
    expect(total).toBe(1);
    const enchantedCopies = [...aCopies, ...bCopies].filter(
      (s) => s.instance?.enchant === WEAPON_ENCHANT,
    );
    expect(enchantedCopies).toHaveLength(1);
    // The reagents were spent exactly once.
    expect(p.server.sim.countItem(DUST, p.a.pid)).toBe(0);
    // Observed arm: the trade completes and the enchanted instance transfers
    // with its payload intact (the offer is id-based; the accept flags are not
    // reset by an inventory transform that keeps the count).
    expect(p.server.sim.countItem(SWORD, p.b.pid)).toBe(1);
    expect(bCopies[0]?.instance?.enchant).toBe(WEAPON_ENCHANT);
    expect(p.server.sim.countItem(SWORD, p.a.pid)).toBe(0);
  });

  it('trade completes first: the queued apply_enchant denies not_held and consumes no reagents', () => {
    const p = pairUp(733);
    p.server.sim.addItem(SWORD, 1, p.a.pid);
    p.server.sim.addItem(DUST, 5, p.a.pid);
    openTrade(p);
    cmd(p.server, p.a, { cmd: 'trade_offer', items: [{ itemId: SWORD, count: 1 }] });
    cmd(p.server, p.a, { cmd: 'trade_confirm' });
    cmd(p.server, p.b, { cmd: 'trade_confirm' });
    cmd(p.server, p.a, { cmd: 'apply_enchant', item: SWORD, enchant: WEAPON_ENCHANT });
    routeTick(p.server);

    const ench = eventsFor(p.fcA.sent, 'enchantResult');
    expect(ench).toHaveLength(1);
    expect((ench[0] as { ok?: boolean }).ok).toBe(false);
    expect((ench[0] as { reason?: string }).reason).toBe('not_held');
    expect(p.server.sim.lastEnchantResultFor(p.a.pid)?.reason).toBe('not_held');
    // Reagents untouched, B's copy is the plain one, nothing enchanted anywhere.
    expect(p.server.sim.countItem(DUST, p.a.pid)).toBe(5);
    const bCopy = serverInv(p.server, p.b.pid).find((s) => s.itemId === SWORD);
    expect(bCopy?.count).toBe(1);
    expect(bCopy?.instance?.enchant).toBeUndefined();
    expect(totalOf(p.server, SWORD, [p.a.pid, p.b.pid])).toBe(1);
  });
});
