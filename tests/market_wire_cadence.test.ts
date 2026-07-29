// The `market` self key's cadence + rebuild-only-on-change gate (the
// tick-budget fix). The expensive call is sim.marketInfoFor (a filter + page
// over the whole listing book), so the decisive pin is a SPY on it: within the
// MARKET_WIRE_HZ cadence the server polls the cheap browse revision and must
// not rebuild while nothing changed; a book change, a query change, the
// viewer's own market command, and the staleness backstop each bring exactly
// the rebuilds they promise.
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

import { type ClientSession, GameServer } from '../server/game';
import { groundHeight } from '../src/sim/world';
import { broadcast, type FakeClient, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

// Mirrors MARKET_WIRE_HZ = 4 / MARKET_BROWSE_REFRESH_TICKS in server/game.ts.
const MARKET_WIRE_INTERVAL_TICKS = 5;
const MARKET_BROWSE_REFRESH_TICKS = 40;

function placeAtMerchant(server: GameServer, pid: number): void {
  let m = null;
  for (const e of server.sim.entities.values()) {
    if (e.templateId === 'the_merchant') {
      m = e;
      break;
    }
  }
  if (!m) throw new Error('the Merchant was not spawned');
  const e = server.sim.entities.get(pid);
  if (!e) throw new Error(`missing entity ${pid}`);
  e.pos.x = m.pos.x;
  e.pos.z = m.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, server.sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function placeFarAway(server: GameServer, pid: number): void {
  const e = server.sim.entities.get(pid);
  if (!e) throw new Error(`missing entity ${pid}`);
  e.pos.x = 400;
  e.pos.z = 400;
  e.pos.y = groundHeight(400, 400, server.sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function duePass(server: GameServer): void {
  for (let i = 0; i < MARKET_WIRE_INTERVAL_TICKS; i++) server.sim.tick();
  broadcast(server);
}

function marketSnaps(sent: unknown[], from: number): unknown[] {
  // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON, the harness idiom
  return (sent as any[]).slice(from).filter((m) => m.t === 'snap' && m.self && 'market' in m.self);
}

function browseServer(): { server: GameServer; fc: FakeClient; session: ClientSession } {
  const server = new GameServer();
  const fc = fakeWs();
  const session = joinServer(server, fc, 71, 'Browser');
  placeAtMerchant(server, session.pid);
  return { server, fc, session };
}

describe('market wire cadence + rebuild-only-on-change', () => {
  it('rebuilds once for the join, then never again while nothing changes (until the backstop)', () => {
    const { server, fc } = browseServer();
    const spy = vi.spyOn(server.sim, 'marketInfoFor');
    broadcast(server);
    expect(spy).toHaveBeenCalledTimes(1);
    const first = lastSnap(fc.sent);
    expect(first.self.market).not.toBeNull();
    expect(first.self.market.listings.length).toBeGreaterThan(0); // house stock

    // Every due pass up to one interval SHORT of the backstop, with no book,
    // query, or position change: the gate polls the browse revision and skips
    // the rebuild every time, tight boundary included. The pre-fix behavior
    // was one rebuild per TICK.
    const passesToBackstop = Math.ceil(MARKET_BROWSE_REFRESH_TICKS / MARKET_WIRE_INTERVAL_TICKS);
    const sent = fc.sent.length;
    for (let pass = 0; pass < passesToBackstop - 1; pass++) duePass(server);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(marketSnaps(fc.sent, sent)).toHaveLength(0); // nothing re-shipped either

    // The next due pass crosses the staleness backstop: exactly one more
    // rebuild lands (and, being unchanged, still elides from the wire).
    duePass(server);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(marketSnaps(fc.sent, sent)).toHaveLength(0);
  });

  it('re-sending a byte-identical market_search does not force rebuilds', () => {
    const { server, fc, session } = browseServer();
    broadcast(server);
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'market_search', q: 'wolf', page: 0 }),
    );
    broadcast(server);
    // The query is now applied; identical re-sends (a client re-firing the same
    // search every command window) re-arm the cadence gate but must not
    // replace the query object, so the identity check skips every rebuild.
    const spy = vi.spyOn(server.sim, 'marketInfoFor');
    const sent = fc.sent.length;
    for (let round = 0; round < 3; round++) {
      server.handleMessage(
        session,
        JSON.stringify({ t: 'cmd', cmd: 'market_search', q: 'wolf', page: 0 }),
      );
      server.sim.tick();
      broadcast(server);
    }
    expect(spy).not.toHaveBeenCalled();
    expect(marketSnaps(fc.sent, sent)).toHaveLength(0);
  });

  it('a book change reaches the viewer on their next due pass', () => {
    const { server, fc, session } = browseServer();
    broadcast(server);
    const spy = vi.spyOn(server.sim, 'marketInfoFor');

    const fc2 = fakeWs();
    const seller = joinServer(server, fc2, 72, 'Seller');
    placeAtMerchant(server, seller.pid);
    server.sim.addItem('wolf_fang', 1, seller.pid);
    server.sim.marketList('wolf_fang', 1, 100, seller.pid);

    const sent = fc.sent.length;
    duePass(server);
    const snaps = marketSnaps(fc.sent, sent);
    expect(snaps).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    const listings = (snaps[0] as any).self.market.listings;
    expect(listings.some((l: { itemId: string }) => l.itemId === 'wolf_fang')).toBe(true);
    expect(spy.mock.calls.filter(([pid]) => pid === session.pid).length).toBe(1);
  });

  it("the viewer's own market_search lands on the next snapshot, not a cadence later", () => {
    const { server, fc, session } = browseServer();
    broadcast(server);
    server.sim.tick(); // one tick only: the plain cadence gate is NOT due yet

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'market_search', q: 'wolf', page: 0 }),
    );
    const sent = fc.sent.length;
    broadcast(server);
    const snaps = marketSnaps(fc.sent, sent);
    expect(snaps).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    expect((snaps[0] as any).self.market.filter).toBe('wolf');
  });

  it('walking away nulls the key at cadence; returning re-ships the full view', () => {
    const { server, fc, session } = browseServer();
    broadcast(server);

    placeFarAway(server, session.pid);
    let sent = fc.sent.length;
    duePass(server);
    let snaps = marketSnaps(fc.sent, sent);
    expect(snaps).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    expect((snaps[0] as any).self.market).toBeNull();

    placeAtMerchant(server, session.pid);
    sent = fc.sent.length;
    duePass(server);
    snaps = marketSnaps(fc.sent, sent);
    expect(snaps).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    expect((snaps[0] as any).self.market.listings.length).toBeGreaterThan(0);
  });
});
