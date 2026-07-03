import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; the holder-tier broadcast
// round-trip (server identity encode -> client snapshot decode) is under test.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import type { PlayerClass } from '../src/sim/types';

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) {
    if (sent[i].t === 'snap') return sent[i];
  }
  return null;
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function broadcast(server: GameServer): void {
  (server as any).broadcastSnapshots();
}

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot directly.
function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.missingSince = new Map(); // despawn-grace bookkeeping (set by the real field initializer)
  c.playerId = pid;
  c.moveInput = {};
  c.inventory = [];
  c.vendorBuyback = [];
  c.equipment = {};
  c.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  c.copper = 0;
  c.xp = 0;
  c.known = [];
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.tradeInfo = null;
  c.duelInfo = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.pendingFacingDelta = 0;
  c.connected = true;
  c.eventQueue = [];
  c.mouselookFacing = null;
  c.lastInputSentAt = 0;
  c.lastInputSig = '';
  c.inputSeq = 0;
  c.pendingInputSeqSentAt = new Map();
  c.ackedInputSeq = 0;
  c.inputEchoSamples = [];
  return c;
}

describe('holder-tier identity broadcast round-trip', () => {
  let server: GameServer;
  let fc: FakeClient;
  let session: ClientSession;

  beforeEach(() => {
    server = new GameServer();
    fc = fakeWs();
    session = joinServer(server, fc, 1, 'Holdr');
  });

  it('encodes ht and a rounded hb in the full identity record when a player holds $WOC', () => {
    const player = server.sim.entities.get(session.pid)!;
    player.holderTier = 7;
    player.holderBalance = 1234567;
    broadcast(server);

    const snap = lastSnap(fc.sent);
    expect(snap).not.toBeNull();
    // The self record rides through wireEntity -> identityFields, so it carries
    // the holder-tier flair fields whenever they are set on the sim entity.
    expect(snap.self.ht).toBe(7);
    expect(snap.self.hb).toBe(1234567);
  });

  it('rounds a fractional $WOC balance with Math.round when emitting hb', () => {
    const player = server.sim.entities.get(session.pid)!;
    player.holderTier = 3;
    player.holderBalance = 1234.6;
    broadcast(server);

    const snap = lastSnap(fc.sent);
    expect(snap.self.ht).toBe(3);
    expect(snap.self.hb).toBe(1235);
  });

  it('omits ht and hb entirely for a player with tier 0 / no balance', () => {
    const player = server.sim.entities.get(session.pid)!;
    // a brand-new player has no linked-wallet flair yet
    expect(player.holderTier ?? 0).toBe(0);
    broadcast(server);

    const snap = lastSnap(fc.sent);
    // the `if (e.holderTier)` guard keeps both keys off the wire
    expect(snap.self).not.toHaveProperty('ht');
    expect(snap.self).not.toHaveProperty('hb');
  });

  it('omits hb when the tier is set but the balance is zero (guard is per-field)', () => {
    const player = server.sim.entities.get(session.pid)!;
    player.holderTier = 4;
    player.holderBalance = 0;
    broadcast(server);

    const snap = lastSnap(fc.sent);
    expect(snap.self.ht).toBe(4);
    // `if (e.holderBalance)` drops a zero balance even though the tier rode along
    expect(snap.self).not.toHaveProperty('hb');
  });

  it("round-trips a second player's ht/hb through the full entity record both clients see", () => {
    // both players spawn together, so each appears in the other's interest set
    const fc2 = fakeWs();
    const other = joinServer(server, fc2, 2, 'Whaley', 'mage');
    const otherEnt = server.sim.entities.get(other.pid)!;
    otherEnt.holderTier = 7;
    otherEnt.holderBalance = 1234567;
    fc.sent.length = 0;
    broadcast(server);

    const snap = lastSnap(fc.sent);
    const wire = snap.ents.find((e: any) => e.id === other.pid);
    expect(wire).toBeDefined();
    // a first-sight record is "full": identity fields ride along
    expect(wire.k).toBe('player');
    expect(wire.ht).toBe(7);
    expect(wire.hb).toBe(1234567);

    // and the online client decodes the flair onto the mirrored entity
    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    const decoded = client.entities.get(other.pid)!;
    expect(decoded.holderTier).toBe(7);
    expect(decoded.holderBalance).toBe(1234567);
  });

  it('decodes ht/hb into holderTier and holderBalance on the client entity', () => {
    const client = bareClient(99);
    const wire = {
      id: 42,
      k: 'player',
      tid: 'player',
      nm: 'Sovereign',
      lv: 60,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 100,
      mhp: 100,
      ht: 7,
      hb: 1234567,
    };

    (client as any).applySnapshot({ t: 'snap', ents: [wire] });

    const decoded = client.entities.get(42)!;
    expect(decoded.holderTier).toBe(7);
    expect(decoded.holderBalance).toBe(1234567);
  });

  it('defaults holderTier to 0 and leaves holderBalance undefined when a record omits ht/hb', () => {
    const client = bareClient(99);
    // a full identity record with no holder flair (the common case)
    const wire = {
      id: 43,
      k: 'mob',
      tid: 'forest_wolf',
      nm: 'Forest Wolf',
      lv: 1,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 45,
      mhp: 45,
    };

    (client as any).applySnapshot({ t: 'snap', ents: [wire] });

    const decoded = client.entities.get(43)!;
    expect(decoded.holderTier).toBe(0); // w.ht ?? 0
    expect(decoded.holderBalance).toBeUndefined(); // typeof w.hb !== 'number'
  });

  it('decodes ht present but hb absent: tier shows, balance stays undefined', () => {
    const client = bareClient(99);
    // server drops hb when balance is 0 but keeps ht for a pinned/dev tier
    const wire = {
      id: 44,
      k: 'player',
      tid: 'player',
      nm: 'Tierless',
      lv: 12,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 100,
      mhp: 100,
      ht: 4,
    };

    (client as any).applySnapshot({ t: 'snap', ents: [wire] });

    const decoded = client.entities.get(44)!;
    expect(decoded.holderTier).toBe(4);
    expect(decoded.holderBalance).toBeUndefined();
  });

  it('re-broadcasts a changed identity (a later balance refresh resends ht/hb to a tracking client)', () => {
    const fc2 = fakeWs();
    const other = joinServer(server, fc2, 2, 'Climber', 'mage');
    const otherEnt = server.sim.entities.get(other.pid)!;

    // first sight: no flair yet -> full record, but no ht/hb
    broadcast(server);
    let snap = lastSnap(fc.sent);
    let wire = snap.ents.find((e: any) => e.id === other.pid);
    expect(wire).toBeDefined();
    expect(wire).not.toHaveProperty('ht');

    // the wallet refresh lands -> identity changes -> a fresh full record rides.
    // Tick so the per-tick wire cache recomputes identityFields for the entity.
    otherEnt.holderTier = 6;
    otherEnt.holderBalance = 100000;
    server.sim.tick();
    fc.sent.length = 0;
    broadcast(server);
    snap = lastSnap(fc.sent);
    wire = snap.ents.find((e: any) => e.id === other.pid);
    expect(wire).toBeDefined();
    expect(wire.k).toBe('player'); // identity re-sent => full record
    expect(wire.ht).toBe(6);
    expect(wire.hb).toBe(100000);
  });
});
