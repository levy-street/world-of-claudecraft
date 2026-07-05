// Liquidity Guardian identity broadcast round-trip: the server encodes gt in
// the full identity record, the client decodes it into guardianTier, and an
// omitted gt defaults to 0. Mirrors tests/holder_broadcast.test.ts (the badge
// this one rides alongside).
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';

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

// The own player rides in snap.self (wireEntity -> identityFields), like the
// holder-broadcast suite asserts; other players would appear under ents.
function selfRecord(sent: any[]): any {
  return lastSnap(sent)?.self;
}

function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.missingSince = new Map();
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

describe('guardian-tier identity broadcast round-trip', () => {
  let server: GameServer;
  let fc: FakeClient;
  let session: ClientSession;

  beforeEach(() => {
    server = new GameServer();
    fc = fakeWs();
    const joined = server.join(fc.ws, 1, 1, 'Guardn', 'warrior', null);
    if ('error' in joined) throw new Error(joined.error);
    session = joined;
    session.blockListLoaded = true;
  });

  it('encodes gt in the full identity record when a player is a guardian', () => {
    const player = server.sim.entities.get(session.pid)!;
    player.guardianTier = 5;
    (server as any).broadcastSnapshots();
    expect(selfRecord(fc.sent).gt).toBe(5);
  });

  it('omits gt entirely for tier 0 (no wasted identity bytes)', () => {
    const player = server.sim.entities.get(session.pid)!;
    player.guardianTier = 0;
    (server as any).broadcastSnapshots();
    expect('gt' in selfRecord(fc.sent)).toBe(false);
  });

  it('decodes gt into guardianTier on the client entity, defaulting to 0 when omitted', () => {
    const client = bareClient(999);
    (client as any).applySnapshot({ ents: [{ id: 1, k: 'player', gt: 3 }], self: null, keep: [] });
    expect(client.entities.get(1)!.guardianTier).toBe(3);
    const client2 = bareClient(999);
    (client2 as any).applySnapshot({ ents: [{ id: 2, k: 'player' }], self: null, keep: [] });
    expect(client2.entities.get(2)!.guardianTier).toBe(0);
  });

  it('rides alongside ht without disturbing it', () => {
    const player = server.sim.entities.get(session.pid)!;
    player.holderTier = 7;
    player.guardianTier = 2;
    (server as any).broadcastSnapshots();
    const w = selfRecord(fc.sent);
    expect(w.ht).toBe(7);
    expect(w.gt).toBe(2);
  });
});
