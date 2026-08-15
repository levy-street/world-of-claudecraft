// The `corder` self key's cadence + rebuild-only-on-change gate (the market
// recipe applied to the commission order board, the second O(realm-collection)
// read that shipped on the per-tick self path). The expensive call is
// sim.commissionOrdersFor (a walk over the whole board where every open-scope
// order lands in every viewer's projection), so the decisive pin is a SPY on
// it, plus per-verb pins that every board mutation advances the revision the
// server gate polls.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
  setCharacterHotbarLayout: vi.fn(async () => {}),
}));

import {
  type ClientSession,
  CORDER_BOARD_REFRESH_TICKS,
  CORDER_WIRE_INTERVAL_TICKS,
  GameServer,
} from '../server/game';
import { broadcast, type FakeClient, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

// A commission-eligible weapon recipe (the professions_commission_order
// harness constant): opening an order needs no crafting prerequisites.
const SWORD_RECIPE = 'recipe_eastbrook_arming_sword';

function duePass(server: GameServer): void {
  for (let i = 0; i < CORDER_WIRE_INTERVAL_TICKS; i++) server.sim.tick();
  broadcast(server);
}

function corderSnaps(sent: unknown[], from: number): unknown[] {
  // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON, the harness idiom
  return (sent as any[]).slice(from).filter((m) => m.t === 'snap' && m.self && 'corder' in m.self);
}

function viewerServer(): { server: GameServer; fc: FakeClient; session: ClientSession } {
  const server = new GameServer();
  const fc = fakeWs();
  const session = joinServer(server, fc, 81, 'Viewer');
  return { server, fc, session };
}

describe('corder wire cadence + rebuild-only-on-change', () => {
  it('pins the tuned cadence literally: 5-tick interval, 40-tick backstop', () => {
    // The imported constants drive the loop mechanics above; these literal
    // pins keep a server-side retune (say CORDER_WIRE_HZ = 20, reverting the
    // cadence layer) from leaving the suite green while it asserts a window
    // that no longer exists.
    expect(CORDER_WIRE_INTERVAL_TICKS).toBe(5);
    expect(CORDER_BOARD_REFRESH_TICKS).toBe(40);
  });

  it('rebuilds once at join, then never again while the board is unchanged (until the backstop)', () => {
    const { server, fc } = viewerServer();
    const spy = vi.spyOn(server.sim, 'commissionOrdersFor');
    broadcast(server);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(lastSnap(fc.sent).self.corder).toEqual([]);

    const passesToBackstop = Math.ceil(CORDER_BOARD_REFRESH_TICKS / CORDER_WIRE_INTERVAL_TICKS);
    const sent = fc.sent.length;
    for (let pass = 0; pass < passesToBackstop - 1; pass++) duePass(server);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(corderSnaps(fc.sent, sent)).toHaveLength(0);

    // The next due pass crosses the staleness backstop: exactly one more
    // rebuild (and, unchanged, it still elides from the wire).
    duePass(server);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(corderSnaps(fc.sent, sent)).toHaveLength(0);
  });

  it("another player's open order reaches the viewer on their next due pass", () => {
    const { server, fc, session } = viewerServer();
    broadcast(server);
    const spy = vi.spyOn(server.sim, 'commissionOrdersFor');

    const fc2 = fakeWs();
    const requester = joinServer(server, fc2, 82, 'Requester');
    server.sim.openCommissionOrder(SWORD_RECIPE, 'open', undefined, requester.pid);

    // Mid-window: the open already advanced the revision, but the viewer's
    // cadence gate is not due yet (one tick into the 5-tick window), so a
    // broadcast here must ship nothing and pay no rebuild for them. Deleting
    // the corderDue branch would rebuild right here and redden this pin.
    server.sim.tick();
    const midWindow = fc.sent.length;
    broadcast(server);
    expect(corderSnaps(fc.sent, midWindow)).toHaveLength(0);
    expect(spy.mock.calls.filter(([pid]) => pid === session.pid).length).toBe(0);

    const sent = fc.sent.length;
    duePass(server);
    const snaps = corderSnaps(fc.sent, sent);
    expect(snaps).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    const rows = (snaps[0] as any).self.corder;
    expect(rows).toHaveLength(1);
    expect(rows[0].requesterName).toBe('Requester');
    expect(rows[0].status).toBe('open');
    expect(spy.mock.calls.length).toBeGreaterThan(0);
  });

  it("the viewer's own commission command lands on the next snapshot (prompt re-arm)", () => {
    const { server, fc, session } = viewerServer();
    broadcast(server);
    server.sim.tick(); // one tick only: the plain cadence gate is NOT due yet

    server.handleMessage(
      session,
      JSON.stringify({
        t: 'cmd',
        cmd: 'open_commission_order',
        recipe: SWORD_RECIPE,
        scope: 'open',
      }),
    );
    const sent = fc.sent.length;
    broadcast(server);
    const snaps = corderSnaps(fc.sent, sent);
    expect(snaps).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    expect((snaps[0] as any).self.corder[0].mine).toBe(true);
  });

  it("a spectate anchor switch re-ships the NEW target's projection on the next snapshot", () => {
    // The revisions are realm-global with no target identity, so an
    // anchor-changing path that missed BOTH protections (the lastSent wipe
    // and the tracker resets) would leave a moderator reading player A's
    // projection while spectating B for up to the staleness backstop. This
    // pins the observable property through the real enterSpectate path, for
    // both the enter and the switch.
    const server = new GameServer();
    const fcMod = fakeWs();
    const mod = joinServer(server, fcMod, 86, 'Watcher');
    const fcA = fakeWs();
    const a = joinServer(server, fcA, 87, 'Anna');
    const fcB = fakeWs();
    const bela = joinServer(server, fcB, 88, 'Bela');
    server.sim.openCommissionOrder(SWORD_RECIPE, 'open', undefined, a.pid);
    broadcast(server);

    // Enter: anchored on Anna, the order reads as HERS (mine: true).
    let before = fcMod.sent.length;
    // biome-ignore lint/suspicious/noExplicitAny: the spectate entry is private by design
    (server as any).enterSpectate(mod, a);
    broadcast(server);
    let snaps = corderSnaps(fcMod.sent, before);
    expect(snaps).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    expect((snaps[0] as any).self.corder[0].mine).toBe(true);

    // Switch to Bela with the board UNCHANGED: only the wipe/reset pair can
    // carry the re-anchored projection through the gate.
    before = fcMod.sent.length;
    // biome-ignore lint/suspicious/noExplicitAny: the spectate entry is private by design
    (server as any).enterSpectate(mod, bela);
    broadcast(server);
    snaps = corderSnaps(fcMod.sent, before);
    expect(snaps).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    expect((snaps[0] as any).self.corder[0].mine).toBe(false);
  });

  it('a linkdead resume re-ships the projection through the lastSent wipe, unchanged board included', () => {
    // Pins the dependency documented at resumeSession's lastSent reset: the
    // gate trackers (lastCorderBoardRev and friends) are deliberately NOT
    // reset on resume; the lastSent wipe alone must force the rebuild.
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 85, 'Comeback');
    const spy = vi.spyOn(server.sim, 'commissionOrdersFor');
    broadcast(server);
    expect(spy).toHaveBeenCalledTimes(1);

    // Transport drop into linkdead grace, then a same-character re-join.
    fc.ws.readyState = 3;
    server.socketClosed(session, fc.ws);
    const fc2 = fakeWs();
    const resumed = server.join(fc2.ws, 85, 85, 'Comeback', 'warrior', null);
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed).toBe(session);

    // The board never changed and lastCorderBoardRev still matches, yet the
    // fresh socket must receive the projection again: sent.corder was wiped.
    const sent = fc2.sent.length;
    broadcast(server);
    expect(spy).toHaveBeenCalledTimes(2);
    const snaps = corderSnaps(fc2.sent, sent);
    expect(snaps).toHaveLength(1);
  });

  it('every board verb advances the revision the gate polls; idle ticks do not', () => {
    const server = new GameServer();
    const fcA = fakeWs();
    const fcB = fakeWs();
    const requester = joinServer(server, fcA, 83, 'Requester');
    const crafter = joinServer(server, fcB, 84, 'Crafter');
    const rev = () => server.sim.commissionOrderBoardRev;

    const idle = rev();
    for (let i = 0; i < 40; i++) server.sim.tick();
    expect(rev()).toBe(idle);

    // open
    let before = rev();
    server.sim.openCommissionOrder(SWORD_RECIPE, 'open', undefined, requester.pid);
    expect(rev()).toBeGreaterThan(before);
    const order = server.sim.commissionOrderBoard.find((o) => o.requesterId === requester.pid);
    if (!order) throw new Error('missing opened order');

    // a REFUSED verb moves nothing (the requester cannot accept their own order)
    before = rev();
    server.sim.acceptCommissionOrder(order.id, requester.pid);
    expect(rev()).toBe(before);

    // accept
    before = rev();
    server.sim.acceptCommissionOrder(order.id, crafter.pid);
    expect(rev()).toBeGreaterThan(before);

    // open a second order, then cancel it
    server.sim.openCommissionOrder(SWORD_RECIPE, 'open', undefined, requester.pid);
    const second = server.sim.commissionOrderBoard.find(
      (o) => o.requesterId === requester.pid && o.status === 'open',
    );
    if (!second) throw new Error('missing second order');
    before = rev();
    server.sim.cancelCommissionOrder(second.id, requester.pid);
    expect(rev()).toBeGreaterThan(before);

    // deliver: the crafter holds a commission-armed, still-unbound copy and
    // stands beside the requester (both spawn at the same start), so the
    // fourth verb's success path is exercised for real.
    const crafterMeta = server.sim.players.get(crafter.pid);
    const orderRow = server.sim.commissionOrderBoard.find((o) => o.id === order.id);
    if (!crafterMeta || !orderRow) throw new Error('missing crafter meta or order');
    crafterMeta.inventory.push({
      itemId: orderRow.itemId,
      count: 1,
      instance: { bindOnTrade: true },
    });
    // a REFUSED deliver first (the requester did not accept it): no bump
    before = rev();
    server.sim.deliverCommissionOrder(order.id, requester.pid);
    expect(rev()).toBe(before);
    before = rev();
    server.sim.deliverCommissionOrder(order.id, crafter.pid);
    expect(server.sim.commissionOrderBoard.find((o) => o.id === order.id)?.status).toBe(
      'delivered',
    );
    expect(rev()).toBeGreaterThan(before);

    // retention sweep, prune arm: force the cancelled order past its retain
    // window
    // biome-ignore lint/suspicious/noExplicitAny: reaching sim internals is the harness idiom
    (second as any).settledAt = -100_000;
    before = rev();
    for (let i = 0; i < 2; i++) server.sim.tick();
    expect(rev()).toBeGreaterThan(before);
    expect(server.sim.commissionOrderBoard.some((o) => o.id === second.id)).toBe(false);

    // retention sweep, expire arm: an open order forced past
    // ORDER_OPEN_EXPIRE_SECONDS flips to 'expired' and bumps too
    server.sim.openCommissionOrder(SWORD_RECIPE, 'open', undefined, requester.pid);
    const third = server.sim.commissionOrderBoard.find(
      (o) => o.requesterId === requester.pid && o.status === 'open',
    );
    if (!third) throw new Error('missing third order');
    // biome-ignore lint/suspicious/noExplicitAny: reaching sim internals is the harness idiom
    (third as any).openedAt = -100_000;
    before = rev();
    for (let i = 0; i < 2; i++) server.sim.tick();
    expect(server.sim.commissionOrderBoard.find((o) => o.id === third.id)?.status).toBe('expired');
    expect(rev()).toBeGreaterThan(before);
  });
});
