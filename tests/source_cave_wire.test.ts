import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; only the cave wire path is under test.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { type ClientSession, configureSourceCaveRuntime, GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { SOURCE_CAVE_DUNGEON_ID } from '../src/sim/source_cave';

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

function joinServer(server: GameServer, fc: FakeClient, id: number, name: string): ClientSession {
  const session = server.join(fc.ws, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function broadcast(server: GameServer): void {
  (server as any).broadcastSnapshots();
}

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot directly
// (mirrors bareClient in snapshots.test.ts), plus the source-cave mirror field.
function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.playerId = pid;
  c.ownPlayerId = pid;
  c.ownPlayerClass = 'warrior';
  c.spectating = null;
  c.cupInfo = null;
  c.sportRole = null;
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
  c.selectedDungeonDifficulty = 'normal';
  c.tradeInfo = null;
  c.duelInfo = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.missingSince = new Map();
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
  c.spectateFacingPending = false;
  c.pendingSpectateFacing = null;
  c.mirroredSourceCaveInfo = null;
  return c;
}

// Put the player on the cave door and walk them in through the real dispatch path,
// returning the claimed cave instance so a test can mark its mobs dead.
function enterCave(server: GameServer, session: ClientSession) {
  const sim = server.sim;
  const pid = session.pid;
  sim.setPlayerLevel(20, pid);
  const door = [...sim.entities.values()].find(
    (x) => x.templateId === 'dungeon_door' && x.dungeonId === SOURCE_CAVE_DUNGEON_ID,
  );
  if (!door) throw new Error('source cave door not found');
  const p = sim.entities.get(pid)!;
  p.pos = { ...door.pos };
  p.prevPos = { ...p.pos };
  server.handleMessage(
    session,
    JSON.stringify({ t: 'cmd', cmd: 'enter_dungeon', dungeon: 'source_cave' }),
  );
  const inst = sim.instances.find(
    (i) => i.dungeonId === SOURCE_CAVE_DUNGEON_ID && i.partyKey !== null,
  );
  if (!inst) throw new Error('player did not claim a source cave instance');
  return inst;
}

describe('configureSourceCaveRuntime -> GameServer boot wiring', () => {
  afterEach(() => {
    // The injected roster is a module-local var on server/game.ts, read only at
    // GameServer construction time; reset it so it doesn't leak into other tests
    // in this file (or other files, if the module registry is ever shared).
    configureSourceCaveRuntime(undefined);
  });

  it('a GameServer constructed after configureSourceCaveRuntime seeds the injected roster', () => {
    configureSourceCaveRuntime([
      { login: 'injected-alpha', mergedPrs: 50, rank: 1 },
      { login: 'injected-bravo', mergedPrs: 2, rank: 2 },
    ]);
    const server = new GameServer();
    const info = server.sim.sourceCaveInfo();
    expect(info?.mobs.map((m) => m.login).sort()).toEqual(['injected-alpha', 'injected-bravo']);
  });

  it('a GameServer constructed with no injected roster falls back to the placeholder roster', () => {
    // No configureSourceCaveRuntime call this test => the module var stays undefined,
    // matching how every OTHER test in this file constructs GameServer.
    const server = new GameServer();
    const info = server.sim.sourceCaveInfo();
    expect(info?.totalMobs).toBeGreaterThan(0);
    expect(info?.mobs.some((m) => m.login === 'injected-alpha')).toBe(false);
  });

  it('ships the full visible roster with the fixed combat total', () => {
    configureSourceCaveRuntime(
      Array.from({ length: 60 }, (_, i) => ({
        login: `contributor-${i}`,
        mergedPrs: i === 0 ? 90 : i < 7 ? 30 : i < 13 ? 15 : i < 21 ? 5 : 1,
        rank: i + 1,
      })),
    );
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 99, 'Caver');
    enterCave(server, session);
    broadcast(server);
    const info = lastSnap(fc.sent).self.scave;
    expect(info.mobs.length).toBe(60);
    expect(info.totalMobs).toBe(37);
    expect(info.mobs.filter((mob: { combatant: boolean }) => mob.combatant)).toHaveLength(37);
  });
});

describe('source cave wire (scave)', () => {
  it('ships scave on entry and increments killed as cave mobs die', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Caver');
    const inst = enterCave(server, session);
    expect(inst.mobIds.length).toBeGreaterThan(0);

    broadcast(server);
    const entrySnap = lastSnap(fc.sent);
    expect(entrySnap.self).toHaveProperty('scave');
    expect(entrySnap.self.scave.killed).toBe(0);
    expect(entrySnap.self.scave.totalMobs).toBe(inst.mobIds.length);
    expect(entrySnap.self.scave.moduleCount).toBeGreaterThan(0);
    // The ordered module-type sequence rides the wire too (render needs the real
    // per-module footprint to stack interiors, not just the count).
    expect(Array.isArray(entrySnap.self.scave.modules)).toBe(true);
    expect(entrySnap.self.scave.modules.length).toBe(entrySnap.self.scave.moduleCount);
    // Content pin, not just shape: the wire's module sequence must match the
    // server's own spec verbatim (order and type), not merely be an array of the
    // right length (a wrong-type or reversed sequence would desync render's
    // module z-offset stacking from the sim's real colliders).
    expect(entrySnap.self.scave.modules).toEqual(server.sim.sourceCave!.spec.modules);

    // Kill one cave mob and confirm killed advances in the NEXT self wire snapshot.
    fc.sent.length = 0;
    server.sim.entities.get(inst.mobIds[0])!.dead = true;
    broadcast(server);
    const killSnap = lastSnap(fc.sent);
    expect(killSnap.self.scave.killed).toBe(1);

    // A second death advances again, proving the count tracks live state, not a flag.
    fc.sent.length = 0;
    server.sim.entities.get(inst.mobIds[1])!.dead = true;
    broadcast(server);
    expect(lastSnap(fc.sent).self.scave.killed).toBe(2);
  });

  it('clears session.lastSent.scave on leaving so the next snapshot resends fresh state', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 2, 'Leaver');
    enterCave(server, session);
    broadcast(server);
    // The heavy field is now cached as last-sent for this session.
    expect(session.lastSent.scave).toBeDefined();

    // Baseline: with nothing changed, the delta guard OMITS scave (unchanged), so a
    // resend here proves the resync did the forcing, not an incidental value change.
    fc.sent.length = 0;
    broadcast(server);
    expect(lastSnap(fc.sent).self).not.toHaveProperty('scave');

    // Walk onto the exit portal and leave through the real dispatch path.
    const sim = server.sim;
    const exit = [...sim.entities.values()].find(
      (x) => x.templateId === 'dungeon_exit' && x.dungeonId === SOURCE_CAVE_DUNGEON_ID,
    );
    if (!exit) throw new Error('source cave exit not found');
    const p = sim.entities.get(session.pid)!;
    p.pos = { ...exit.pos };
    p.prevPos = { ...p.pos };
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'leave_dungeon' }));

    // resyncSourceCave dropped the cached value, so the delta guard resends it.
    expect(session.lastSent.scave).toBeUndefined();
    fc.sent.length = 0;
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self).toHaveProperty('scave'); // forced resend after leave
    expect(snap.self.scave).not.toBeNull(); // the static spec always projects on the server

    // The online client mirror follows: sourceCaveInfo() reflects the resent state.
    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    expect(client.sourceCaveInfo()).not.toBeNull();
    expect(client.sourceCaveInfo()?.totalMobs).toBe(snap.self.scave.totalMobs);
  });
});
