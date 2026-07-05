import { beforeEach, describe, expect, it, vi } from 'vitest';

// The inspect-another-player feature mirrors a player's full worn set onto the
// entity (render-only `equippedItems`) and rides it over the identity wire as
// the terse `eq` field. Two things are under test: the sim mirror that the
// inspect window reads, and the server-encode -> client-decode round-trip that
// makes another player's gear available client-side.

// Mock the db layer so no Postgres is needed (hoisted above the server import).
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
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

describe('inspect: sim mirrors the worn set onto the entity', () => {
  it('copies PlayerMeta.equipment onto entity.equippedItems on creation', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    // autoEquip dresses the starter, so the mirror is non-empty and matches.
    expect(Object.keys(sim.equipment).length).toBeGreaterThan(0);
    expect(sim.player.equippedItems).toEqual(sim.equipment);
  });

  it('mirrors a distinct copy, not an alias of the meta map', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    // A copy, so a later mutation of one never silently changes the other.
    expect(sim.player.equippedItems).not.toBe(sim.equipment);
  });

  it('is deterministic for a fixed seed (same gear both runs)', () => {
    const run = () =>
      new Sim({ seed: 7, playerClass: 'mage', autoEquip: true }).player.equippedItems;
    expect(run()).toEqual(run());
  });

  it('leaves equippedItems empty for a non-player entity', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const mob = [...sim.entities.values()].find((e) => e.kind === 'mob');
    // Mobs never run recalcPlayerStats, so the mirror stays at its empty default.
    if (mob) expect(mob.equippedItems).toEqual({});
  });
});

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

describe('inspect: equipment identity-wire round-trip', () => {
  let server: GameServer;
  let fc: FakeClient;
  let session: ClientSession;

  beforeEach(() => {
    server = new GameServer();
    fc = fakeWs();
    session = joinServer(server, fc, 1, 'Wearer');
  });

  it("encodes a second player's worn set as `eq` in the full entity record", () => {
    const fc2 = fakeWs();
    const other = joinServer(server, fc2, 2, 'Geared', 'mage');
    const otherEnt = server.sim.entities.get(other.pid)!;
    otherEnt.equippedItems = { helmet: 'iron_helm', chest: 'iron_chest' };
    fc.sent.length = 0;
    broadcast(server);

    const snap = lastSnap(fc.sent);
    const wire = snap.ents.find((e: any) => e.id === other.pid);
    expect(wire).toBeDefined();
    expect(wire.k).toBe('player'); // first-sight => full identity record
    expect(wire.eq).toEqual({ helmet: 'iron_helm', chest: 'iron_chest' });
  });

  it('decodes `eq` onto the mirrored client entity', () => {
    const client = bareClient(99);
    const wire = {
      id: 42,
      k: 'player',
      tid: 'player',
      nm: 'Geared',
      lv: 30,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 100,
      mhp: 100,
      eq: { helmet: 'iron_helm', mainhand: 'iron_sword' },
    };

    (client as any).applySnapshot({ t: 'snap', ents: [wire] });

    const decoded = client.entities.get(42)!;
    expect(decoded.equippedItems).toEqual({ helmet: 'iron_helm', mainhand: 'iron_sword' });
  });

  it('defaults equippedItems to {} when a record omits `eq`', () => {
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

    expect(client.entities.get(43)!.equippedItems).toEqual({});
  });

  it('omits `eq` for a player with nothing equipped (gated like mh)', () => {
    const fc2 = fakeWs();
    const other = joinServer(server, fc2, 2, 'Bare', 'mage');
    const otherEnt = server.sim.entities.get(other.pid)!;
    otherEnt.equippedItems = {};
    fc.sent.length = 0;
    broadcast(server);

    const snap = lastSnap(fc.sent);
    const wire = snap.ents.find((e: any) => e.id === other.pid);
    expect(wire).toBeDefined();
    expect(wire).not.toHaveProperty('eq');
  });

  it('omits `eq` for a non-player entity even if the field were populated', () => {
    const player = server.sim.entities.get(session.pid)!;
    // identityFields gates `eq` on kind === 'player'; a mob never carries it.
    const mob = [...server.sim.entities.values()].find((e) => e.kind === 'mob');
    expect(player.kind).toBe('player');
    if (mob) {
      (mob as any).equippedItems = { helmet: 'iron_helm' };
      fc.sent.length = 0;
      broadcast(server);
      const snap = lastSnap(fc.sent);
      const wire = snap.ents.find((e: any) => e.id === mob.id);
      if (wire) expect(wire).not.toHaveProperty('eq');
    }
  });
});
