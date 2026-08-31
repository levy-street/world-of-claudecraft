// crucible_buy over the LIVE GameServer wire. Every other crucible vendor test
// calls Sim directly (tests/crucible_vendor.test.ts); this suite is the online
// parity leg the heroic_buy wire test has (tests/snapshots.test.ts, "dungeon
// difficulty wire"): the dispatch arm's typeof-string guard, the full
// buy-path outcome over handleMessage (sigil debit, set-piece grant), the
// routed vendor response frame, and the ClientWorld inventory mirror.
//
// The fixture enters the raid approach room through the /dev practice-raid
// door exactly like the sim-direct suite (the Crucible Quartermaster is a
// dynamic NPC that only exists there), so the server sim is built with
// ALLOW_DEV_COMMANDS set for the setup chat command only; crucible_buy itself
// is an ordinary player command with no dev gating.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so the live GameServer suite needs no Postgres (the
// vi.mock hoisting caveat from #2088 applies: this block cannot reference
// imports).
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
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountWeaponSkins: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  setCharacterHotbarLayout: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadRiftState: vi.fn(async () => null),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  saveRiftState: vi.fn(async () => {}),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
}));

import { type ClientSession, GameServer } from '../server/game';
import { CRUCIBLE_VENDOR_NPC_ID } from '../src/sim/content/ignivar_loot';
import type { SimEvent } from '../src/sim/types';
import {
  bareClient,
  broadcast,
  type FakeClient,
  fakeWs,
  joinServer,
  lastSnap,
} from './helpers/bare_client';

const SET_PIECE = 'slagbreaker_helmet';
const SIGIL = 'sigil_anvil_helmet';

/** A GameServer whose sim was built with dev commands enabled, so the fixture
 *  can enter the raid approach room where the quartermaster spawns. The env
 *  var is restored immediately after construction: Sim.devCommands latches at
 *  construction time, and nothing under test reads the variable afterwards. */
function raidServer(): GameServer {
  const previous = process.env.ALLOW_DEV_COMMANDS;
  process.env.ALLOW_DEV_COMMANDS = '1';
  try {
    return new GameServer();
  } finally {
    if (previous === undefined) delete process.env.ALLOW_DEV_COMMANDS;
    else process.env.ALLOW_DEV_COMMANDS = previous;
  }
}

/** Join a session, stage the practice raid, and stand the player at the
 *  Crucible Quartermaster in the approach room. */
function joinAtQuartermaster(server: GameServer, fc: FakeClient): ClientSession {
  const session = joinServer(server, fc, 1, 'Redeemer');
  server.sim.chat('/dev ignivarraid', session.pid);
  const vendor = [...server.sim.entities.values()].find(
    (e) => e.kind === 'npc' && e.templateId === CRUCIBLE_VENDOR_NPC_ID,
  );
  if (!vendor) throw new Error('Crucible Quartermaster did not spawn in the approach room');
  const player = server.sim.entities.get(session.pid);
  if (!player) throw new Error('joined player missing');
  player.pos = { x: vendor.pos.x + 1, y: player.pos.y, z: vendor.pos.z };
  player.prevPos = { ...player.pos };
  (server.sim as unknown as { rebucket(e: unknown): void }).rebucket(player);
  return session;
}

function routeTick(server: GameServer): void {
  (server as unknown as { routeEvents(events: SimEvent[]): void }).routeEvents(server.sim.tick());
}

function sendBuy(server: GameServer, session: ClientSession, itemId: unknown): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'crucible_buy', itemId }));
}

describe('crucible_buy over the GameServer wire', () => {
  it('debits the sigil, grants the set piece, routes the vendor frame, and mirrors the bags', () => {
    const server = raidServer();
    const fc = fakeWs();
    const session = joinAtQuartermaster(server, fc);
    server.sim.addItem(SIGIL, 2, session.pid);
    routeTick(server); // drain the join/dev-staging noise before the buy
    broadcast(server);
    fc.sent.length = 0;

    sendBuy(server, session, SET_PIECE);

    // Authoritative outcome, by literal value: one piece granted, ONE sigil
    // debited from the stack of two.
    expect(server.sim.countItem(SET_PIECE, session.pid)).toBe(1);
    expect(server.sim.countItem(SIGIL, session.pid)).toBe(1);

    // The response frame: the sim's vendor event reaches this session as a
    // routed { t: 'events' } frame (the shop window's re-render signal).
    routeTick(server);
    const vendorEvents = fc.sent
      .flatMap((msg: { t: string; list?: SimEvent[] }) =>
        msg.t === 'events' ? (msg.list ?? []) : [],
      )
      .filter((ev) => ev.type === 'vendor');
    expect(vendorEvents).toEqual([
      { type: 'vendor', action: 'buy', itemId: SET_PIECE, pid: session.pid },
    ]);

    // The ClientWorld leg: the vendor event is a HEAVY_SELF_EVENT, so the next
    // broadcast re-diffs the inv delta and the mirrored inventory shows the
    // purchase (grant AND debit), not a click-time guess.
    broadcast(server);
    const client = bareClient(session.pid);
    (client as unknown as { applySnapshot(snap: unknown): void }).applySnapshot(lastSnap(fc.sent));
    expect(client.inventory).toEqual(
      expect.arrayContaining([
        { itemId: SET_PIECE, count: 1 },
        { itemId: SIGIL, count: 1 },
      ]),
    );
  });

  it('rejects non-string itemId payloads at the dispatch guard, before the sim handler', () => {
    const server = raidServer();
    const fc = fakeWs();
    const session = joinAtQuartermaster(server, fc);
    server.sim.addItem(SIGIL, 1, session.pid);
    routeTick(server);

    // The guard is the pin, not just the absence of a grant: a junk payload
    // must never REACH buyCrucibleVendorItem (bypassing the typeof check would
    // call through and fail here), and a malformed frame must not crash the
    // server.
    const handler = vi.spyOn(server.sim, 'buyCrucibleVendorItem');
    sendBuy(server, session, 7);
    sendBuy(server, session, null);
    sendBuy(server, session, { itemId: SET_PIECE });
    sendBuy(server, session, ['x']);
    sendBuy(server, session, undefined); // serializes to a missing itemId field
    server.handleMessage(session, 'not json at all');
    expect(handler).not.toHaveBeenCalled();
    expect(server.sim.countItem(SET_PIECE, session.pid)).toBe(0);
    expect(server.sim.countItem(SIGIL, session.pid)).toBe(1);

    // The session is still live after the junk: a valid string flows through
    // to the sim handler with the session's own pid and completes the buy.
    sendBuy(server, session, SET_PIECE);
    expect(handler).toHaveBeenCalledExactlyOnceWith(SET_PIECE, session.pid);
    expect(server.sim.countItem(SET_PIECE, session.pid)).toBe(1);
    expect(server.sim.countItem(SIGIL, session.pid)).toBe(0);
    handler.mockRestore();
  });

  it('a valid id still refuses far from the quartermaster, granting nothing over the wire', () => {
    // The heroic_buy wire test's refusal arm, mirrored: dispatch passes the
    // string through and the sim's own range gate answers with an error event
    // instead of a grant.
    const server = raidServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Farbuyer');
    server.sim.chat('/dev ignivarraid', session.pid);
    const vendor = [...server.sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === CRUCIBLE_VENDOR_NPC_ID,
    );
    const player = server.sim.entities.get(session.pid);
    if (!vendor || !player) throw new Error('vendor or player missing');
    // Explicitly out of reach (the sim-direct suite's +40 recipe).
    player.pos = { x: vendor.pos.x + 40, y: player.pos.y, z: vendor.pos.z };
    player.prevPos = { ...player.pos };
    (server.sim as unknown as { rebucket(e: unknown): void }).rebucket(player);
    server.sim.addItem(SIGIL, 1, session.pid);
    routeTick(server);
    fc.sent.length = 0;

    sendBuy(server, session, SET_PIECE);
    expect(server.sim.countItem(SET_PIECE, session.pid)).toBe(0);
    expect(server.sim.countItem(SIGIL, session.pid)).toBe(1);
    routeTick(server);
    const errorTexts = fc.sent
      .flatMap((msg: { t: string; list?: SimEvent[] }) =>
        msg.t === 'events' ? (msg.list ?? []) : [],
      )
      .flatMap((ev) => (ev.type === 'error' ? [(ev as { text: string }).text] : []));
    expect(errorTexts).toContain('Too far away.');
  });
});
