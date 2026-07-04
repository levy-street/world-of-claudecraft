// The Gravemarch 5v5 battleground over the GameServer/wire pipeline, cloned
// structurally from tests/arena_online.test.ts: queue commands route to the
// sim, the 'bg' self key rides the snapshot at 2 Hz, a full 10-human match
// delivers bgFound/bgStart to every fighter, match spectate (the anchor swap
// without the GM grant, privacy-reduced self record, next/leave/auto-exit),
// and the disconnect-desertion save ordering.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => ({ listings: [], collections: new Map() })),
  saveMarketState: vi.fn(async () => {}),
  loadMailState: vi.fn(async () => null),
  saveMailState: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  walletForAccount: vi.fn(async () => null),
}));

import { saveCharacterAndMarketState } from '../server/db';
import { type ClientSession, GameServer } from '../server/game';
import { isBattlegroundPos } from '../src/sim/data';
import { endBgMatch } from '../src/sim/social/battleground';
import type { PlayerClass } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

interface FakeClient {
  sent: unknown[];
  ws: { readyState: number; send: (payload: string) => void };
}

function fakeWs(): FakeClient {
  const sent: unknown[] = [];
  return {
    sent,
    ws: {
      readyState: 1,
      send: (payload: string) => sent.push(JSON.parse(payload)),
    },
  };
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws as any, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function teleport(sim: GameServer['sim'], pid: number, x: number, z: number): void {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

function advance(server: GameServer): void {
  const events = server.sim.tick();
  (server as any).routeEvents(events);
  (server as any).broadcastSnapshots();
}

function lastSnap(fc: FakeClient): any {
  for (let i = fc.sent.length - 1; i >= 0; i--) {
    const msg = fc.sent[i] as any;
    if (msg.t === 'snap') return msg;
  }
  return null;
}

function eventsOf(fc: FakeClient, type: string): any[] {
  return fc.sent
    .flatMap((msg: any) => (msg.t === 'events' ? msg.list : []))
    .filter((ev: any) => ev.type === type);
}

// 'bg' is a delta self key: absent from a snapshot while unchanged, so scan
// back for the most recent snapshot that carried it (the client mirror rule).
function lastBg(fc: FakeClient): any {
  for (let i = fc.sent.length - 1; i >= 0; i--) {
    const msg = fc.sent[i] as any;
    if (msg.t === 'snap' && msg.self?.bg !== undefined) return msg.self.bg;
  }
  return undefined;
}

function spectateFrames(fc: FakeClient): any[] {
  return fc.sent.filter((msg: any) => msg.t === 'spectate');
}

function cmd(server: GameServer, session: ClientSession, payload: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...payload }));
}

// Join a queue-eligible fighter: level 20 (BG_MIN_LEVEL is 10) at an
// overworld spot near spawn (x < DUNGEON_X_THRESHOLD).
function joinFighter(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = joinServer(server, fc, characterId, name, cls);
  server.sim.setPlayerLevel(20, session.pid);
  teleport(server.sim, session.pid, (characterId % 8) * 3, -40);
  return session;
}

// Seat a full 10-human 5v5 and fast-forward the 10 s countdown so the match
// is active. Returns everything the spectate tests anchor on.
function startFullMatch(server: GameServer): {
  clients: FakeClient[];
  sessions: ClientSession[];
  matchId: number;
  participants: number[];
} {
  const clients: FakeClient[] = [];
  const sessions: ClientSession[] = [];
  for (let i = 0; i < 10; i++) {
    const fc = fakeWs();
    clients.push(fc);
    sessions.push(joinFighter(server, fc, i + 1, `Fighter${i}`, i % 2 === 0 ? 'warrior' : 'mage'));
  }
  for (const session of sessions) cmd(server, session, { cmd: 'bg_queue' });
  advance(server); // matchmaking pass seats the match (countdown state)
  const matchId = server.sim.bgLiveMatchIds()[0];
  expect(matchId).toBeDefined();
  // speed the countdown: one tick left on the shared match object
  const match = (server.sim as any).bgMatches.get(sessions[0].pid);
  expect(match).toBeTruthy();
  match.timer = 0.01;
  advance(server); // countdown expires, bgStart fires
  const participants = server.sim.bgMatchPids(matchId);
  expect(participants).toHaveLength(10);
  return { clients, sessions, matchId, participants };
}

describe('battleground: online integration (GameServer)', () => {
  let server: GameServer;

  beforeEach(() => {
    vi.mocked(saveCharacterAndMarketState).mockClear();
    server = new GameServer();
  });

  it('routes bg_queue/bg_leave to the sim and ships the bg self key within 10 ticks', () => {
    const fc = fakeWs();
    const session = joinFighter(server, fc, 1, 'Queuer');
    advance(server);

    // the readout rides the very first snapshot (idle: not queued)
    const initial = lastSnap(fc);
    expect(initial.self.bg).toBeTruthy();
    expect(initial.self.bg.queued).toBe(false);
    expect(initial.self.bg.standing.rating).toBe(1500);
    expect(() => JSON.stringify(initial.self.bg)).not.toThrow();

    cmd(server, session, { cmd: 'bg_queue' });
    let queuedSeen = false;
    for (let i = 0; i < 10 && !queuedSeen; i++) {
      advance(server);
      queuedSeen = lastSnap(fc)?.self?.bg?.queued === true;
    }
    // the 2 Hz throttle (BG_WIRE_INTERVAL_TICKS = 10) must have re-shipped it
    expect(queuedSeen).toBe(true);
    expect(eventsOf(fc, 'bgQueued').length).toBeGreaterThan(0);
    const snap = lastSnap(fc);
    expect(snap.self.bg.queueSize).toBe(1);
    expect(snap.self.bg.position).toBe(1);
    // wire payload must be JSON-clean (no Map/Set leaks)
    expect(() => JSON.stringify(snap.self.bg)).not.toThrow();

    cmd(server, session, { cmd: 'bg_leave' });
    let unqueuedSeen = false;
    for (let i = 0; i < 10 && !unqueuedSeen; i++) {
      advance(server);
      unqueuedSeen = lastSnap(fc)?.self?.bg?.queued === false;
    }
    expect(unqueuedSeen).toBe(true);
    expect(eventsOf(fc, 'bgUnqueued').length).toBeGreaterThan(0);
  });

  it('rejects a queue join from inside an instance band with the sim error', () => {
    const fc = fakeWs();
    const session = joinFighter(server, fc, 2, 'Dungeoneer');
    teleport(server.sim, session.pid, 900, 0); // dungeon instance band
    cmd(server, session, { cmd: 'bg_queue' });
    advance(server);

    const errors = eventsOf(fc, 'error').map((ev) => ev.text);
    expect(errors).toContain('You cannot queue from inside an instance.');
    expect(lastSnap(fc).self.bg.queued).toBe(false);
  });

  it('seats a full 10-human 5v5: bgFound and bgStart reach every fighter', () => {
    const { clients, sessions, matchId } = startFullMatch(server);

    for (let i = 0; i < 10; i++) {
      const found = eventsOf(clients[i], 'bgFound');
      expect(found.length, `Fighter${i} bgFound`).toBeGreaterThan(0);
      expect(found[0].allies).toHaveLength(4);
      expect(found[0].enemies).toHaveLength(5);
      expect(found[0].rated).toBe(true);
      expect(eventsOf(clients[i], 'bgStart').length, `Fighter${i} bgStart`).toBeGreaterThan(0);
      expect(server.sim.bgMatchOf(sessions[i].pid)).toBe(matchId);
      // teleported onto the battleground band
      expect(isBattlegroundPos(server.sim.entities.get(sessions[i].pid)!.pos.x)).toBe(true);
    }

    // the in-match readout reaches the fighters' snapshots (within one 2 Hz
    // window of going active) and is JSON-clean
    for (let i = 0; i < 10; i++) advance(server);
    const bg = lastBg(clients[0]);
    expect(bg.match).toBeTruthy();
    expect(bg.match.state).toBe('active');
    expect(['A', 'B']).toContain(bg.match.team);
    expect(bg.match.teamA).toHaveLength(5);
    expect(bg.match.teamB).toHaveLength(5);
    expect(bg.match.structures.length).toBeGreaterThan(0);
    expect(() => JSON.stringify(bg)).not.toThrow();
  });

  it('spectate: anchors an 11th session on a fighter with a privacy-reduced self record', () => {
    const { clients, sessions, matchId, participants } = startFullMatch(server);
    const fc = fakeWs();
    const watcher = joinFighter(server, fc, 42, 'Watcher');
    const homePos = { ...server.sim.entities.get(watcher.pid)!.pos };
    advance(server);

    cmd(server, watcher, { cmd: 'bg_spectate', matchId });

    // parked in limbo, anchored on the first connected fighter (team A first)
    expect(watcher.spectating?.mode).toBe('match');
    expect((watcher.spectating as any).matchId).toBe(matchId);
    expect((watcher.spectating as any).anchorPid).toBe(participants[0]);
    // no GM grant: the parked entity stays a plain player
    expect(server.sim.entities.get(watcher.pid)!.gm).toBeFalsy();
    const frames = spectateFrames(fc);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[frames.length - 1].name).toBe('Fighter0');

    fc.sent.length = 0;
    advance(server);
    const snap = lastSnap(fc);
    // the snapshot self record IS the anchored fighter
    expect(snap.self.id).toBe(participants[0]);
    // ... with the private heavy keys omitted
    for (const key of [
      'inv',
      'bags',
      'buyback',
      'equip',
      'cosmetics',
      'qlog',
      'qdone',
      'milestones',
      'tal',
      'mail',
      'mailU',
      'market',
      'trade',
      'prof',
      // private economy/progression scalars stripped from the BASE self object
      // (they bypass the maybe() skip set)
      'copper',
      'xp',
      'lxp',
      'rxp',
      'prk',
    ]) {
      expect(key in snap.self, `spectator self must omit ${key}`).toBe(false);
    }
    // ... while the match HUD data and dynamic state stay present
    expect(snap.self.bg).toBeTruthy();
    expect(snap.self.bg.match).toBeTruthy();
    expect(snap.self.bg.match.id).toBe(matchId);
    expect('cds' in snap.self).toBe(true);
    expect(typeof snap.self.hp).toBe('number');
    expect(() => JSON.stringify(snap.self.bg)).not.toThrow();

    // a fighter's own snapshot still carries the heavy keys
    const fighter = sessions[0];
    fighter.lastSent = {};
    fighter.selfHeavyDirty = true;
    clients[0].sent.length = 0;
    advance(server);
    const fighterSnap = lastSnap(clients[0]);
    expect('inv' in fighterSnap.self).toBe(true);
    expect('tal' in fighterSnap.self).toBe(true);
    expect('equip' in fighterSnap.self).toBe(true);
    expect('copper' in fighterSnap.self).toBe(true);
    expect('xp' in fighterSnap.self).toBe(true);

    // the spectator command gate: bg_queue stays blocked while spectating
    cmd(server, watcher, { cmd: 'bg_queue' });
    advance(server);
    expect(eventsOf(fc, 'bgQueued')).toHaveLength(0);
    expect(server.sim.bgInfoFor(watcher.pid)?.queued).toBe(false);

    // bg_spectate_next moves the anchor to the next connected fighter
    fc.sent.length = 0;
    cmd(server, watcher, { cmd: 'bg_spectate_next' });
    expect((watcher.spectating as any).anchorPid).toBe(participants[1]);
    expect(spectateFrames(fc)[0]?.name).toBe('Fighter1');
    advance(server);
    expect(lastSnap(fc).self.id).toBe(participants[1]);

    // bg_spectate_leave restores the parked entity
    fc.sent.length = 0;
    cmd(server, watcher, { cmd: 'bg_spectate_leave' });
    expect(watcher.spectating).toBeNull();
    expect(spectateFrames(fc)[0]?.name).toBeNull();
    const restored = server.sim.entities.get(watcher.pid)!.pos;
    expect(restored.x).toBeCloseTo(homePos.x);
    expect(restored.z).toBeCloseTo(homePos.z);
  });

  it('spectate: silent retarget when the anchor disconnects, auto-exit when the match ends', async () => {
    const { sessions, matchId, participants } = startFullMatch(server);
    const fc = fakeWs();
    const watcher = joinFighter(server, fc, 43, 'Observer');
    advance(server);
    cmd(server, watcher, { cmd: 'bg_spectate', matchId });
    expect((watcher.spectating as any).anchorPid).toBe(participants[0]);

    // the anchored fighter disconnects: the spectate silently re-anchors
    await server.leave(sessions[0], 'ws closed');
    fc.sent.length = 0;
    advance(server);
    expect(watcher.spectating?.mode).toBe('match');
    expect((watcher.spectating as any).anchorPid).toBe(participants[1]);
    expect(spectateFrames(fc)[0]?.name).toBe('Fighter1');
    expect(lastSnap(fc).self.id).toBe(participants[1]);

    // the match ends: the spectator inherits the anchor's bgEnd event, then
    // the snapshot pass auto-exits and restores them
    const ctx = (server.sim as any).ctx;
    const match = (server.sim as any).bgMatches.get(participants[1]);
    endBgMatch(ctx, match, 'A', 'timeout');
    fc.sent.length = 0;
    advance(server);
    expect(eventsOf(fc, 'bgEnd').length).toBeGreaterThan(0);
    expect(watcher.spectating).toBeNull();
    const frames = spectateFrames(fc);
    expect(frames[frames.length - 1]?.name).toBeNull();
    expect(eventsOf(fc, 'error').map((ev) => ev.text)).toContain('That battle has already ended.');
  });

  it('spectate: refused while dead, queued, in a match, or inside an instance band', () => {
    const { sessions, matchId } = startFullMatch(server);

    // a fighter of the match cannot spectate it
    const fcFighter = fakeWs();
    void fcFighter;
    cmd(server, sessions[1], { cmd: 'bg_spectate', matchId });
    expect(sessions[1].spectating).toBeNull();

    // a queued player cannot spectate
    const fcQ = fakeWs();
    const queued = joinFighter(server, fcQ, 44, 'Queued');
    cmd(server, queued, { cmd: 'bg_queue' });
    cmd(server, queued, { cmd: 'bg_spectate', matchId });
    advance(server);
    expect(queued.spectating).toBeNull();
    expect(eventsOf(fcQ, 'error').map((ev) => ev.text)).toContain('You cannot spectate right now.');

    // inside an instance band
    const fcD = fakeWs();
    const inside = joinFighter(server, fcD, 45, 'Insider');
    teleport(server.sim, inside.pid, 900, 0);
    cmd(server, inside, { cmd: 'bg_spectate', matchId });
    expect(inside.spectating).toBeNull();

    // a match that is not live
    const fcG = fakeWs();
    const ghost = joinFighter(server, fcG, 46, 'Latecomer');
    cmd(server, ghost, { cmd: 'bg_spectate', matchId: matchId + 999 });
    advance(server);
    expect(ghost.spectating).toBeNull();
    expect(eventsOf(fcG, 'error').map((ev) => ev.text)).toContain('That battle has already ended.');
  });

  it('desertion: a mid-match disconnect persists the post-loss bgRating', async () => {
    const { sessions } = startFullMatch(server);
    const deserter = sessions[3];
    const characterId = deserter.characterId;

    await server.leave(deserter, 'ws closed');

    // leave() resolves the desertion BEFORE the save, so the serialized state
    // carries the post-loss Elo (1500 - 16 for even 1500-rated teams) and the
    // loss; the surviving match plays on unrated.
    const calls = vi.mocked(saveCharacterAndMarketState).mock.calls;
    const saved = calls.filter((c) => c[0] === characterId).pop();
    expect(saved).toBeTruthy();
    const state = saved![2] as any;
    expect(state.bgRating).toBe(1484);
    expect(state.bgLosses).toBe(1);
    const match = (server.sim as any).bgMatches.get(sessions[4].pid);
    expect(match.rated).toBe(false);
    expect(match.deserted.has(deserter.pid)).toBe(true);
  });
});
