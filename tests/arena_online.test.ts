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
  saveMailState: vi.fn(async () => {}),
  releaseCharacterLease: vi.fn(async () => true),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { saveCharacterAndMarketState } from '../server/db';
import { type ClientSession, GameServer } from '../server/game';
import { RANKED_ARENA_WIN_HONOR } from '../src/sim/pvp';
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

describe('arena: online integration (GameServer)', () => {
  let server: GameServer;

  beforeEach(() => {
    server = new GameServer();
    vi.mocked(saveCharacterAndMarketState).mockClear();
  });

  it('routes arena_queue format=2v2 and seats four solos with wire-safe arena snapshots', () => {
    const names = ['Aleph', 'Bet', 'Gimel', 'Dalet'];
    const classes: PlayerClass[] = ['warrior', 'mage', 'rogue', 'priest'];
    const clients: FakeClient[] = [];
    const sessions: ClientSession[] = [];

    for (let i = 0; i < 4; i++) {
      const fc = fakeWs();
      clients.push(fc);
      sessions.push(joinServer(server, fc, i + 1, names[i], classes[i]));
      teleport(server.sim, sessions[i].pid, i * 4, -40);
    }

    for (const session of sessions) {
      server.handleMessage(
        session,
        JSON.stringify({ t: 'cmd', cmd: 'arena_queue', format: '2v2' }),
      );
    }
    advance(server);

    for (let i = 0; i < 4; i++) {
      const snap = lastSnap(clients[i]);
      expect(snap?.self?.arena, `${names[i]} arena snapshot`).toBeTruthy();
      expect(snap.self.arena.format).toBe('2v2');
      expect(snap.self.arena.match).toBeTruthy();
      expect(snap.self.arena.match.format).toBe('2v2');
      expect(snap.self.arena.match.enemies).toHaveLength(2);
      expect(snap.self.arena.match.allies).toHaveLength(1);
      expect(snap.self.arena.standings['1v1'].rating).toBe(1500);
      expect(snap.self.arena.standings['2v2'].rating).toBe(1500);
      expect(snap.self.arena.ladder).toEqual(snap.self.arena.ladders['2v2']);
      // wire payload must be JSON-clean (no Map/Set leaks)
      expect(() => JSON.stringify(snap.self.arena)).not.toThrow();
      const found = eventsOf(clients[i], 'arenaFound');
      expect(found.length).toBeGreaterThan(0);
      expect(found[0].format).toBe('2v2');
      expect(found[0].enemies).toHaveLength(2);
    }

    const m = server.sim.arenaMatchFor(sessions[0].pid)!;
    expect(server.sim.arenaAllPids(m).sort()).toEqual(sessions.map((s) => s.pid).sort());

    // all four fighters are within interest range on the same arena slot
    const positions = sessions.map((s) => server.sim.entities.get(s.pid)!.pos);
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const dx = positions[i].x - positions[j].x;
        const dz = positions[i].z - positions[j].z;
        expect(Math.hypot(dx, dz)).toBeLessThan(90);
      }
    }
  });

  it('premade party leader queues via arena_queue and both members receive arenaQueued', () => {
    const fcA = fakeWs();
    const fcB = fakeWs();
    const sa = joinServer(server, fcA, 10, 'Leader', 'warrior');
    const sb = joinServer(server, fcB, 11, 'Member', 'priest');
    teleport(server.sim, sa.pid, 0, -40);
    teleport(server.sim, sb.pid, 3, -40);

    server.handleMessage(sa, JSON.stringify({ t: 'cmd', cmd: 'pinvite', id: sb.pid }));
    server.handleMessage(sb, JSON.stringify({ t: 'cmd', cmd: 'paccept' }));
    server.handleMessage(sa, JSON.stringify({ t: 'cmd', cmd: 'arena_queue', format: '2v2' }));
    advance(server);

    expect(eventsOf(fcA, 'arenaQueued')[0]?.format).toBe('2v2');
    expect(eventsOf(fcB, 'arenaQueued')[0]?.format).toBe('2v2');
    expect(lastSnap(fcA).self.arena.queued).toBe(true);
    expect(lastSnap(fcB).self.arena.queued).toBe(true);
    expect(lastSnap(fcA).self.arena.format).toBe('2v2');
  });

  it('1v1 arena_queue still works through the server command path', () => {
    const fcA = fakeWs();
    const fcB = fakeWs();
    const sa = joinServer(server, fcA, 20, 'One', 'warrior');
    const sb = joinServer(server, fcB, 21, 'Two', 'mage');
    teleport(server.sim, sa.pid, 0, -40);
    teleport(server.sim, sb.pid, 4, -40);

    server.handleMessage(sa, JSON.stringify({ t: 'cmd', cmd: 'arena_queue' }));
    server.handleMessage(sb, JSON.stringify({ t: 'cmd', cmd: 'arena_queue' }));
    advance(server);

    const snapA = lastSnap(fcA);
    expect(snapA.self.arena.match.format).toBe('1v1');
    expect(snapA.self.arena.match.enemies).toHaveLength(1);
    expect(snapA.self.arena.match.allies).toHaveLength(0);
    expect(snapA.self.arena.ladder).toEqual(snapA.self.arena.ladders['1v1']);
  });

  it('resolves a disconnect win before leave saves so a near-simultaneous winner leave persists honor', async () => {
    const fcA = fakeWs();
    const fcB = fakeWs();
    const sa = joinServer(server, fcA, 30, 'Deserter', 'warrior');
    const sb = joinServer(server, fcB, 31, 'Victor', 'mage');
    server.sim.utcDay = '2026-07-11';
    teleport(server.sim, sa.pid, 0, -40);
    teleport(server.sim, sb.pid, 4, -40);
    server.handleMessage(sa, JSON.stringify({ t: 'cmd', cmd: 'arena_queue' }));
    server.handleMessage(sb, JSON.stringify({ t: 'cmd', cmd: 'arena_queue' }));
    for (let i = 0; i < 20 * 6; i++) advance(server);
    expect(server.sim.arenaMatchFor(sa.pid)?.state).toBe('active');

    await server.leave(sa, 'disconnect');
    expect(server.sim.meta(sb.pid)!.honor).toBe(RANKED_ARENA_WIN_HONOR['1v1']);
    await server.leave(sb, 'disconnect');

    const victorSave = vi
      .mocked(saveCharacterAndMarketState)
      .mock.calls.find(([characterId]) => characterId === sb.characterId);
    expect(victorSave?.[2].honor).toBe(RANKED_ARENA_WIN_HONOR['1v1']);
    expect(victorSave?.[2].lifetimeHonor).toBe(RANKED_ARENA_WIN_HONOR['1v1']);
  });

  // Regression coverage for the stale Arena window: ARENA_WIRE_HZ throttles the
  // `arena` self key to once per 200 ticks (10s), a real perf fix (#940) for the
  // uncached arenaLadder() sort. A queue join/leave must still surface on the
  // very next snapshot rather than waiting out that window, or the window keeps
  // showing "Queue" after the player already queued (and vice versa on leave).
  function snapsWithArenaKey(fc: FakeClient, fromIndex: number): any[] {
    return fc.sent
      .slice(fromIndex)
      .filter((msg: any) => msg.t === 'snap' && Object.hasOwn(msg.self, 'arena'));
  }

  it('refreshes the arena self key on the very next tick after arena_queue/arena_leave, not after the 10s throttle', () => {
    const fc = fakeWs();
    const session = joinServer(server, fc, 40, 'Quick', 'warrior');
    teleport(server.sim, session.pid, 0, -40);

    // A fresh join always ships arena on its first snapshot (lastArenaWireTick
    // starts negative); consume that grace before probing the steady-state gate.
    advance(server);
    const first = lastSnap(fc);
    expect(first.self.arena).toBeTruthy();
    expect(first.self.arena.queued).toBe(false);

    const beforeQueue = fc.sent.length;
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'arena_queue', format: '1v1' }));
    advance(server); // a single tick: far short of the 200-tick (10s) throttle window
    const queueUpdates = snapsWithArenaKey(fc, beforeQueue);
    expect(queueUpdates.length).toBeGreaterThan(0);
    expect(queueUpdates[queueUpdates.length - 1].self.arena.queued).toBe(true);

    const beforeLeave = fc.sent.length;
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'arena_leave' }));
    advance(server);
    const leaveUpdates = snapsWithArenaKey(fc, beforeLeave);
    expect(leaveUpdates.length).toBeGreaterThan(0);
    expect(leaveUpdates[leaveUpdates.length - 1].self.arena.queued).toBe(false);
  });

  it('refreshes the arena self key on the very next tick after a match concludes (arenaEnd), not after the 10s throttle', async () => {
    const fcA = fakeWs();
    const fcB = fakeWs();
    const sa = joinServer(server, fcA, 41, 'Loser', 'warrior');
    const sb = joinServer(server, fcB, 42, 'Winner', 'mage');
    teleport(server.sim, sa.pid, 0, -40);
    teleport(server.sim, sb.pid, 4, -40);
    server.handleMessage(sa, JSON.stringify({ t: 'cmd', cmd: 'arena_queue' }));
    server.handleMessage(sb, JSON.stringify({ t: 'cmd', cmd: 'arena_queue' }));
    for (let i = 0; i < 20 * 6; i++) advance(server);
    expect(server.sim.arenaMatchFor(sa.pid)?.state).toBe('active');

    // Run well past the throttle window so lastArenaWireTick sits in a settled
    // steady state (not still inside the queue command's own forced-fresh grace).
    for (let i = 0; i < 200; i++) advance(server);
    const priorArenaSnaps = snapsWithArenaKey(fcB, 0);
    const ratingBefore =
      priorArenaSnaps[priorArenaSnaps.length - 1].self.arena.standings['1v1'].rating;

    const before = fcB.sent.length;
    await server.leave(sa, 'disconnect'); // forfeit win for sb: sim.arenaResolveDesertion emits arenaEnd
    advance(server); // one tick later: routes the arenaEnd event, then broadcasts

    const updates = snapsWithArenaKey(fcB, before);
    expect(updates.length).toBeGreaterThan(0);
    const updated = updates[updates.length - 1].self.arena;
    expect(updated.standings['1v1'].rating).toBeGreaterThan(ratingBefore);
  });
});
