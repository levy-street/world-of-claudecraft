// Intentional Gathering PR3: the selected-corpse status QUERY, exercised end
// to end (corpse-status-contract.md). tests/corpse_harvest_command.test.ts
// owns the sibling harvestCorpse ACTION command; this file owns
// corpseHarvestInfo/inspectCorpseHarvest: the offline Sim query, the real
// GameServer wire dispatch (malformed/throttled/spoofed-pid), and a real
// ClientWorld<->GameServer round trip (correlation, supersede, disconnect).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import type { ClientSession } from '../server/game';
import { GameServer } from '../server/game';
import { MOBS, setActiveWorldContent } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type WorldContent } from '../src/sim/types';
import { bareClient, fakeWs, joinServer } from './helpers/bare_client';
import { expectDefined } from './helpers/defined';
import { EMPTY_TEST_WORLD } from './sim_shared';

// The corpse_harvest_command.test.ts rig: EMPTY_TEST_WORLD plus roads:[] so a
// plain sim.tick() has no ambient rng-drawing systems beyond the harvest path.
const CORPSE_TEST_WORLD: WorldContent = { ...EMPTY_TEST_WORLD, roads: [] };

function spawnWolfCorpse(sim: Sim, id: number, near: { x: number; z: number }): Entity {
  const pos = sim.groundPos(near.x, near.z);
  const mob = createMob(id, MOBS.forest_wolf, MOBS.forest_wolf.maxLevel, pos);
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  sim.entities.set(mob.id, mob);
  return mob;
}

describe('Sim.corpseHarvestInfo (offline, real ticks, EMPTY_TEST_WORLD)', () => {
  beforeAll(() => setActiveWorldContent(CORPSE_TEST_WORLD));
  afterAll(() => setActiveWorldContent(null));

  function rig(seed = 501) {
    const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: CORPSE_TEST_WORLD });
    const a = sim.addPlayer('warrior', 'Scout');
    const e = expectDefined(sim.entities.get(a));
    e.pos = sim.groundPos(0, 0);
    e.prevPos = { ...e.pos };
    return { sim, a };
  }

  it('answers denial no_field_kit with real componentTags, starting and reserving nothing', () => {
    const { sim, a } = rig();
    const mob = spawnWolfCorpse(sim, 9301, { x: 0, z: 0 });

    const info = sim.corpseHarvestInfo(mob.id, a);

    expect(info?.corpseId).toBe(mob.id);
    expect(info?.componentTags).toEqual(expect.arrayContaining(['hide', 'fang']));
    expect(info?.denial).toBe('no_field_kit');
    expect(info?.reservation).toBeNull();
    const actor = expectDefined(sim.entities.get(a));
    expect(actor.castingAbility).toBeNull();
    expect(mob.corpseHarvestState?.reservedBy ?? null).toBeNull();
  });

  it('the denial clears once the actor holds a field kit, agreeing with startCorpseHarvest', () => {
    const { sim, a } = rig();
    sim.addItem('field_kit', 1, a);
    const mob = spawnWolfCorpse(sim, 9302, { x: 0, z: 0 });

    expect(sim.corpseHarvestInfo(mob.id, a)?.denial).toBeNull();
    // Inspection and the real start agree: a denial-free read really can start.
    expect(sim.harvestCorpse(mob.id, a)).toBe(true);
  });

  it('returns null for a missing/non-corpse id, never a populated denial object', () => {
    const { sim, a } = rig();
    expect(sim.corpseHarvestInfo(999999, a)).toBeNull();
  });

  it('is a cold read: repeated calls draw no rng and never mutate the corpse', () => {
    const { sim, a } = rig();
    sim.addItem('field_kit', 1, a);
    const mob = spawnWolfCorpse(sim, 9303, { x: 0, z: 0 });

    const draws: number[] = [];
    sim.rng.setObserver((v) => draws.push(v));
    sim.corpseHarvestInfo(mob.id, a);
    sim.corpseHarvestInfo(mob.id, a);
    sim.rng.setObserver(null);

    expect(draws).toEqual([]);
    expect(mob.corpseHarvestState?.reservedBy ?? null).toBeNull();
  });
});

describe('the inspectCorpseHarvest wire command (real GameServer.handleMessage)', () => {
  function joinedServer(characterId: number, name: string) {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, characterId, name);
    return { server, session, fc };
  }

  function spawnCorpseAtSession(server: GameServer, session: ClientSession, id: number): Entity {
    const player = expectDefined(server.sim.entities.get(session.pid), 'player entity');
    const mob = createMob(id, MOBS.forest_wolf, MOBS.forest_wolf.maxLevel, { ...player.pos });
    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    server.sim.entities.set(mob.id, mob);
    return mob;
  }

  function sendInspect(server: GameServer, session: ClientSession, extra: Record<string, unknown>) {
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'inspectCorpseHarvest', ...extra }),
    );
  }

  it('a malformed frame (missing rid) is uncorrelatable: no reply at all', () => {
    const { server, session, fc } = joinedServer(1, 'Malformed');
    const mob = spawnCorpseAtSession(server, session, 9501);
    fc.sent.length = 0;

    sendInspect(server, session, { id: mob.id });

    expect(fc.sent.find((f) => f.t === 'corpseHarvestInfo')).toBeUndefined();
  });

  it('a malformed frame (non-integer id) is uncorrelatable: no reply at all', () => {
    const { server, session, fc } = joinedServer(1, 'Malformed2');
    fc.sent.length = 0;

    sendInspect(server, session, { id: 'nope', rid: 1 });

    expect(fc.sent.find((f) => f.t === 'corpseHarvestInfo')).toBeUndefined();
  });

  it('a valid frame for a missing corpse answers info:null on the exact request id/rid', () => {
    const { server, session, fc } = joinedServer(1, 'NoCorpse');
    fc.sent.length = 0;

    sendInspect(server, session, { id: 999999, rid: 5 });

    const reply = fc.sent.find((f) => f.t === 'corpseHarvestInfo');
    expect(reply).toEqual({ t: 'corpseHarvestInfo', id: 999999, rid: 5, info: null });
  });

  it('the actor identity is always the authenticated session, never a payload pid', () => {
    const { server, session: a, fc } = joinedServer(1, 'Alpha');
    server.sim.addItem('field_kit', 1, a.pid);
    const fcB = fakeWs();
    const b = joinServer(server, fcB, 2, 'Beta');
    const mob = spawnCorpseAtSession(server, a, 9502);
    fc.sent.length = 0;

    sendInspect(server, a, { id: mob.id, rid: 6, pid: b.pid, characterId: b.characterId });

    const reply = fc.sent.find((f) => f.t === 'corpseHarvestInfo');
    // Answered for the AUTHENTICATED session (a has a field kit -> denial
    // null); if the payload pid had won, b (no field kit) would answer
    // no_field_kit instead, or the reservation would name b.
    expect(reply).toMatchObject({ id: mob.id, rid: 6, info: { denial: null } });
  });

  it('throttles to one real inspection per 0.5 sim seconds, answering info:null (no admission scan) in between', () => {
    const { server, session, fc } = joinedServer(1, 'Throttle');
    server.sim.addItem('field_kit', 1, session.pid);
    const mob = spawnCorpseAtSession(server, session, 9503);
    fc.sent.length = 0;
    // Observed only around the three inspect dispatches themselves, never
    // around the tick loop below: the loop runs the FULL default world (not
    // an empty test one), and its ambient systems draw rng of their own, so
    // wrapping it would assert something this test does not own.
    const draws: number[] = [];
    const observeInspect = (v: number) => draws.push(v);

    server.sim.rng.setObserver(observeInspect);
    sendInspect(server, session, { id: mob.id, rid: 1 });
    sendInspect(server, session, { id: mob.id, rid: 2 }); // same sim.time: throttled
    server.sim.rng.setObserver(null);

    // A tick past the 0.5s boundary (not exactly on it, so float accumulation
    // in Sim.time cannot make this flaky either way).
    const ticksPastHalfSecond = Math.round(0.5 / DT) + 1;
    for (let i = 0; i < ticksPastHalfSecond; i++) server.sim.tick();

    server.sim.rng.setObserver(observeInspect);
    sendInspect(server, session, { id: mob.id, rid: 3 }); // due again
    server.sim.rng.setObserver(null);

    const replies = fc.sent.filter((f) => f.t === 'corpseHarvestInfo');
    expect(replies).toEqual([
      {
        t: 'corpseHarvestInfo',
        id: mob.id,
        rid: 1,
        info: expect.objectContaining({ denial: null }),
      },
      { t: 'corpseHarvestInfo', id: mob.id, rid: 2, info: null },
      {
        t: 'corpseHarvestInfo',
        id: mob.id,
        rid: 3,
        info: expect.objectContaining({ denial: null }),
      },
    ]);
    expect(draws).toEqual([]);
    // The throttled request never reserved or claimed anything either.
    expect(mob.harvestClaimedBy).toBeNull();
  });
});

describe('inspectCorpseHarvest transport (real ClientWorld <-> GameServer)', () => {
  function rig(characterId = 21, name = 'Inspector') {
    const toClient: string[] = [];
    const server = new GameServer();
    const session = joinServer(
      server,
      { sent: [], ws: { readyState: 1, send: (payload: string) => toClient.push(payload) } },
      characterId,
      name,
    );
    const world = bareClient(session.pid, {
      connected: true,
      spectating: null,
      sessionEnded: false,
      reconnectAttempts: 0,
      ws: {
        readyState: WebSocket.OPEN,
        send: (payload: string) => server.handleMessage(session, payload),
      },
    });
    const onMessage = (world as unknown as { onMessage(raw: string): void }).onMessage.bind(world);
    // Delivers exactly the OLDEST queued server frame (FIFO, matching real
    // wire arrival order); a no-op once the queue is drained.
    const deliverOne = () => {
      const raw = toClient.shift();
      if (raw !== undefined) onMessage(raw);
    };
    const deliver = () => {
      while (toClient.length) deliverOne();
    };
    deliver(); // drain the join-time hello/snap so mirrored state is fresh
    return { server, session, world, deliver, deliverOne };
  }

  function spawnCorpseAtSession(server: GameServer, session: ClientSession, id: number): Entity {
    const player = expectDefined(server.sim.entities.get(session.pid), 'player entity');
    const mob = createMob(id, MOBS.forest_wolf, MOBS.forest_wolf.maxLevel, { ...player.pos });
    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    server.sim.entities.set(mob.id, mob);
    return mob;
  }

  it('a real request/reply round trip resolves the correlated promise', async () => {
    const { server, session, world, deliver } = rig();
    server.sim.addItem('field_kit', 1, session.pid);
    const mob = spawnCorpseAtSession(server, session, 9601);

    const outcome = world.corpseHarvestInfo(mob.id);
    deliver();

    await expect(outcome).resolves.toMatchObject({ corpseId: mob.id, denial: null });
  });

  it('same-subject concurrent reads share the one pending promise (one send)', () => {
    const { server, session, world } = rig();
    const mob = spawnCorpseAtSession(server, session, 9602);
    const sendSpy = vi.spyOn(
      (world as unknown as { ws: { send: (p: string) => void } }).ws,
      'send',
    );

    const first = world.corpseHarvestInfo(mob.id);
    const second = world.corpseHarvestInfo(mob.id);

    expect(second).toBe(first);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('an immediate different-body supersede settles the OLD subject null locally, and the real 2Hz throttle answers the NEW one null too (same sim.time)', async () => {
    const { server, session, world, deliver } = rig();
    const mobA = spawnCorpseAtSession(server, session, 9603);
    const mobB = spawnCorpseAtSession(server, session, 9604);

    const first = world.corpseHarvestInfo(mobA.id);
    const second = world.corpseHarvestInfo(mobB.id);
    // Superseded locally, before either server reply exists.
    await expect(first).resolves.toBeNull();

    deliver();
    // B is a genuine second request at the SAME sim.time as A: the server's
    // real per-session 0.5s throttle (server/corpse_harvest_inspection.ts)
    // answers null on B's own valid id/rid too, never a real read. This is
    // the actual server behavior, not a stand-in for it.
    await expect(second).resolves.toBeNull();
  });

  it('a stale reply for a subject superseded AFTER crossing the real throttle window never settles the NEW pending request', async () => {
    const { server, session, world, deliverOne } = rig();
    server.sim.addItem('field_kit', 1, session.pid);
    const mobA = spawnCorpseAtSession(server, session, 9605);
    const mobB = spawnCorpseAtSession(server, session, 9606);

    // A is pending at the client; the server's real (first-ever, so
    // not throttled) answer for it is already queued, undelivered.
    const first = world.corpseHarvestInfo(mobA.id);

    // Advance ACTUAL sim time past the 0.5s per-session throttle window so
    // B's own request below lands as a genuine second read rather than
    // sharing A's same-instant throttle window.
    const ticksPastHalfSecond = Math.round(0.5 / DT) + 1;
    for (let i = 0; i < ticksPastHalfSecond; i++) server.sim.tick();

    // Supersedes A locally (settles it null) before sending B's own request.
    const second = world.corpseHarvestInfo(mobB.id);
    await expect(first).resolves.toBeNull();

    // Deliver A's now-stale (but real, valid) reply FIRST, independently: it
    // must not resettle the already-null `first`, and must not touch B
    // either, since A's id/rid answer a different request than the one
    // currently pending.
    deliverOne();
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    // Now deliver B's own real, valid, non-throttled reply.
    deliverOne();
    await expect(second).resolves.toEqual({
      corpseId: mobB.id,
      componentTags: ['hide', 'fang'],
      denial: null,
      preference: { kind: 'all' },
      reservation: null,
      tierBonus: 0,
    });
  });

  it('disconnect settles a pending query null, and a late server reply cannot resurrect it', async () => {
    const { server, session, world, deliver } = rig();
    const mob = spawnCorpseAtSession(server, session, 9607);

    const outcome = world.corpseHarvestInfo(mob.id);
    // Matches the established bareClient socketClosed idiom (tests/net_interaction_outcome.test.ts):
    // sessionEnded short-circuits socketClosed before it would need `window`.
    (world as unknown as { sessionEnded: boolean }).sessionEnded = true;
    (world as unknown as { socketClosed(): void }).socketClosed();

    await expect(outcome).resolves.toBeNull();

    // The server's real answer, delivered only now, must not throw or alter
    // the already-settled promise (a settled Promise cannot change value).
    expect(() => deliver()).not.toThrow();
    await expect(outcome).resolves.toBeNull();
  });

  it('a fresh reconnect hello settles any pending query null (resetQuery), independent of command outcomes', async () => {
    const { server, session, world } = rig();
    const mob = spawnCorpseAtSession(server, session, 9608);
    const outcome = world.corpseHarvestInfo(mob.id);

    (world as unknown as { reconnectAttempts: number }).reconnectAttempts = 1;
    (world as unknown as { onMessage(raw: string): void }).onMessage(
      JSON.stringify({ t: 'hello', pid: session.pid, seed: 1 }),
    );

    await expect(outcome).resolves.toBeNull();
  });

  it('sends nothing and resolves null locally while spectating', async () => {
    const { world } = rig();
    (world as unknown as { spectating: string | null }).spectating = 'Someone Else';
    const sendSpy = vi.spyOn(
      (world as unknown as { ws: { send: (p: string) => void } }).ws,
      'send',
    );

    await expect(world.corpseHarvestInfo(1)).resolves.toBeNull();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('rejects locally (sends nothing) when the transport is not connected', async () => {
    const { world } = rig();
    (world as unknown as { connected: boolean }).connected = false;
    const sendSpy = vi.spyOn(
      (world as unknown as { ws: { send: (p: string) => void } }).ws,
      'send',
    );

    await expect(world.corpseHarvestInfo(1)).resolves.toBeNull();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
