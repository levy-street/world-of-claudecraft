import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; the developer-badge broadcast
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

describe('developer-badge identity broadcast round-trip', () => {
  let server: GameServer;
  let fc: FakeClient;
  let session: ClientSession;

  beforeEach(() => {
    server = new GameServer();
    fc = fakeWs();
    session = joinServer(server, fc, 1, 'Devvy');
  });

  it('encodes dvt/dvc/dgl in the full identity record when a player is a contributor', () => {
    const player = server.sim.entities.get(session.pid)!;
    player.devTier = 4;
    player.devMergedPrs = 187;
    player.githubLogin = 'CharlieSaxton';
    broadcast(server);

    const snap = lastSnap(fc.sent);
    expect(snap).not.toBeNull();
    expect(snap.self.dvt).toBe(4);
    expect(snap.self.dvc).toBe(187);
    expect(snap.self.dgl).toBe('CharlieSaxton');
  });

  it('omits dvt/dvc/dgl entirely for a player with no linked GitHub', () => {
    const player = server.sim.entities.get(session.pid)!;
    expect(player.devTier ?? 0).toBe(0);
    broadcast(server);

    const snap = lastSnap(fc.sent);
    expect(snap.self).not.toHaveProperty('dvt');
    expect(snap.self).not.toHaveProperty('dvc');
    expect(snap.self).not.toHaveProperty('dgl');
  });

  it('omits dvc when the tier is set but the merged-PR count is zero (guard is per-field)', () => {
    const player = server.sim.entities.get(session.pid)!;
    player.devTier = 1;
    player.devMergedPrs = 0;
    player.githubLogin = 'newdev';
    broadcast(server);

    const snap = lastSnap(fc.sent);
    expect(snap.self.dvt).toBe(1);
    expect(snap.self).not.toHaveProperty('dvc');
    expect(snap.self.dgl).toBe('newdev');
  });

  it("round-trips a second player's dvt/dvc/dgl through the full entity record", () => {
    const fc2 = fakeWs();
    const other = joinServer(server, fc2, 2, 'Wright', 'mage');
    const otherEnt = server.sim.entities.get(other.pid)!;
    otherEnt.devTier = 5;
    otherEnt.devMergedPrs = 821;
    otherEnt.githubLogin = 'FernandoX7';
    fc.sent.length = 0;
    broadcast(server);

    const snap = lastSnap(fc.sent);
    const wire = snap.ents.find((e: any) => e.id === other.pid);
    expect(wire).toBeDefined();
    expect(wire.k).toBe('player');
    expect(wire.dvt).toBe(5);
    expect(wire.dvc).toBe(821);
    expect(wire.dgl).toBe('FernandoX7');

    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    const decoded = client.entities.get(other.pid)!;
    expect(decoded.devTier).toBe(5);
    expect(decoded.devMergedPrs).toBe(821);
    expect(decoded.githubLogin).toBe('FernandoX7');
  });

  it('decodes dvt/dvc/dgl into devTier/devMergedPrs/githubLogin on the client entity', () => {
    const client = bareClient(99);
    const wire = {
      id: 42,
      k: 'player',
      tid: 'player',
      nm: 'Architect',
      lv: 60,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 100,
      mhp: 100,
      dvt: 4,
      dvc: 187,
      dgl: 'CharlieSaxton',
    };

    (client as any).applySnapshot({ t: 'snap', ents: [wire] });

    const decoded = client.entities.get(42)!;
    expect(decoded.devTier).toBe(4);
    expect(decoded.devMergedPrs).toBe(187);
    expect(decoded.githubLogin).toBe('CharlieSaxton');
  });

  it('defaults devTier to 0 and leaves devMergedPrs/githubLogin undefined when omitted', () => {
    const client = bareClient(99);
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
    expect(decoded.devTier).toBe(0); // w.dvt ?? 0
    expect(decoded.devMergedPrs).toBeUndefined();
    expect(decoded.githubLogin).toBeUndefined();
  });

  it('re-broadcasts a changed dev tier (a later contributor refresh resends dvt/dvc/dgl)', () => {
    const fc2 = fakeWs();
    const other = joinServer(server, fc2, 2, 'Climber', 'mage');
    const otherEnt = server.sim.entities.get(other.pid)!;

    broadcast(server);
    let snap = lastSnap(fc.sent);
    let wire = snap.ents.find((e: any) => e.id === other.pid);
    expect(wire).toBeDefined();
    expect(wire).not.toHaveProperty('dvt');

    otherEnt.devTier = 3;
    otherEnt.devMergedPrs = 72;
    otherEnt.githubLogin = 'trevcavill';
    server.sim.tick();
    fc.sent.length = 0;
    broadcast(server);
    snap = lastSnap(fc.sent);
    wire = snap.ents.find((e: any) => e.id === other.pid);
    expect(wire).toBeDefined();
    expect(wire.k).toBe('player');
    expect(wire.dvt).toBe(3);
    expect(wire.dvc).toBe(72);
    expect(wire.dgl).toBe('trevcavill');
  });

  it('re-broadcasts a dropped dev tier (unlink / recount below threshold resets dvt/dvc/dgl to absent)', () => {
    const fc2 = fakeWs();
    const other = joinServer(server, fc2, 2, 'Lapsed', 'mage');
    const otherEnt = server.sim.entities.get(other.pid)!;
    otherEnt.devTier = 4;
    otherEnt.devMergedPrs = 187;
    otherEnt.githubLogin = 'CharlieSaxton';
    server.sim.tick();
    fc.sent.length = 0;
    broadcast(server);
    let snap = lastSnap(fc.sent);
    let wire = snap.ents.find((e: any) => e.id === other.pid);
    expect(wire).toBeDefined();
    expect(wire.dvt).toBe(4);
    expect(wire.dvc).toBe(187);
    expect(wire.dgl).toBe('CharlieSaxton');

    // Unlink (or a recount that drops below tier 1): the server clears all three
    // fields back to the "no badge" state.
    otherEnt.devTier = 0;
    otherEnt.devMergedPrs = undefined;
    otherEnt.githubLogin = undefined;
    server.sim.tick();
    fc.sent.length = 0;
    broadcast(server);
    snap = lastSnap(fc.sent);
    wire = snap.ents.find((e: any) => e.id === other.pid);
    expect(wire).toBeDefined();
    // The identity record re-sends (the JSON diff changed) but the now-falsy
    // fields are omitted entirely, exactly like a never-linked player.
    expect(wire).not.toHaveProperty('dvt');
    expect(wire).not.toHaveProperty('dvc');
    expect(wire).not.toHaveProperty('dgl');

    // And the client decodes the dropped identity back to "no badge", not a
    // stale carry-over of the previous tier.
    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    const decoded = client.entities.get(other.pid)!;
    expect(decoded.devTier).toBe(0);
    expect(decoded.devMergedPrs).toBeUndefined();
    expect(decoded.githubLogin).toBeUndefined();
  });
});
