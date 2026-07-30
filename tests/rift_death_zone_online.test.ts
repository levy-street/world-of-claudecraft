import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; only the live GameServer event
// routing is under test. The zone wire path is server->client via routeEvents,
// not via a snapshot field.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import type { Entity, SimEvent } from '../src/sim/types';

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } };
}

function joinServer(server: GameServer, fc: FakeClient, id: number, name: string): ClientSession {
  const session = server.join(fc.ws, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function deliveredEvents(fc: FakeClient): SimEvent[] {
  return fc.sent.filter((m) => m.t === 'events').flatMap((m) => m.list as SimEvent[]);
}

function clearSent(fc: FakeClient): void {
  fc.sent.length = 0;
}

function route(server: GameServer, events: SimEvent[]): void {
  (server as any).routeEvents(events);
}

function moveTo(server: GameServer, pid: number, x: number, z: number): void {
  const e = (server.sim as any).entities.get(pid) as Entity | undefined;
  if (!e) throw new Error(`missing entity ${pid}`);
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
}

// Build a bare ClientWorld whose field initialisers have run (the same idiom
// used by world_api_parity.test.ts and raid_lockout_world.test.ts).
function bareClient(): ClientWorld {
  return Object.create(ClientWorld.prototype) as ClientWorld;
}

describe('rift boss death zone wire mirror', () => {
  it('riftDeathZoneSpawn event reaches a nearby player and counts down via riftBossDeathZones()', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Alpha');
    // Place the player at the zone origin (0, 0) so interest-scope routing delivers
    // the event (EVENT_RADIUS = 90 yd; the zone is AT the player's position).
    moveTo(server, session.pid, 0, 0);
    server.sim.tick();
    clearSent(fc);

    // Emit a riftDeathZoneSpawn directly (the locomotion driver would do this
    // when bossDeathZones.push fires).
    const DURATION = 2.5;
    const zones: SimEvent[] = [
      { type: 'riftDeathZoneSpawn', x: 0, z: 0, radius: 9, durationSecs: DURATION },
    ];
    route(server, zones);

    const received = deliveredEvents(fc).filter((e) => e.type === 'riftDeathZoneSpawn');
    expect(received, 'riftDeathZoneSpawn reaches the in-range player').toHaveLength(1);
    const ev = received[0];
    if (ev.type !== 'riftDeathZoneSpawn') throw new Error('expected riftDeathZoneSpawn');
    expect(ev.x).toBe(0);
    expect(ev.z).toBe(0);
    expect(ev.radius).toBe(9);
    expect(ev.durationSecs).toBe(DURATION);
  });

  it('riftDeathZoneSpawn is NOT delivered to a player far outside the interest radius', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 2, 'Bravo');
    // Place the player far away (200 yd) so the distance check excludes them.
    moveTo(server, session.pid, 200, 200);
    server.sim.tick();
    clearSent(fc);

    const zones: SimEvent[] = [
      { type: 'riftDeathZoneSpawn', x: 0, z: 0, radius: 9, durationSecs: 2.5 },
    ];
    route(server, zones);

    const received = deliveredEvents(fc).filter((e) => e.type === 'riftDeathZoneSpawn');
    expect(received, 'out-of-range player does not receive the zone').toHaveLength(0);
  });

  it('ClientWorld.riftBossDeathZones() returns the zone with a counting-down remaining', () => {
    const client = bareClient();
    const privateClient = client as any;
    // Object.create bypasses field initializers, so seed the array manually
    // (the same idiom raid_lockout_world.test.ts uses for selfLockouts).
    privateClient.activeBossDeathZones = [];
    // Simulate receiving a riftDeathZoneSpawn event by calling the private handler.
    const DURATION_SECS = 3;
    const before = performance.now();
    privateClient.applyRiftDeathZoneSpawnEvent({
      type: 'riftDeathZoneSpawn',
      x: 10,
      z: 20,
      radius: 12,
      durationSecs: DURATION_SECS,
    });
    const after = performance.now();

    const zones = client.riftBossDeathZones();
    expect(zones, 'one active zone').toHaveLength(1);
    const z = zones[0];
    expect(z.x).toBe(10);
    expect(z.z).toBe(20);
    expect(z.radius).toBe(12);
    // remaining should be slightly less than DURATION_SECS due to elapsed time
    const elapsed = (after - before) / 1000;
    expect(z.remaining, 'remaining counts down from durationSecs').toBeLessThanOrEqual(
      DURATION_SECS,
    );
    expect(z.remaining, 'remaining has not dropped more than elapsed').toBeGreaterThan(
      DURATION_SECS - elapsed - 0.05,
    );
  });

  it('ClientWorld.riftBossDeathZones() drops zones whose remaining has reached zero', () => {
    const client = bareClient();
    const privateClient = client as any;
    // Inject a zone that has already expired (negative expiresAtMs offset).
    privateClient.activeBossDeathZones = [
      { x: 5, z: 5, radius: 8, expiresAtMs: performance.now() - 1000 },
    ];
    expect(client.riftBossDeathZones(), 'expired zone is omitted').toHaveLength(0);
  });

  it('riftState(active:false) clears all active death zones on exit', () => {
    const client = bareClient();
    const privateClient = client as any;
    // Seed the field (Object.create bypasses field initializers) then inject a
    // live zone and fire the rift-exit event.
    privateClient.activeBossDeathZones = [
      { x: 0, z: 0, radius: 9, expiresAtMs: performance.now() + 5000 },
    ];
    expect(client.riftBossDeathZones()).toHaveLength(1);

    privateClient.applyRiftStateEvent({
      type: 'riftState',
      pid: 1,
      active: false,
      eventId: null,
      instanceId: 0,
      seed: 0,
      baseLevel: 0,
      floorIndex: 0,
      floorCount: 0,
      origin: { x: 0, z: 0 },
      contentId: '',
      contentHash: '',
      upgrade: null,
      name: '',
      themeName: '',
      tier: null,
    });

    expect(client.riftBossDeathZones(), 'death zones cleared after rift exit').toHaveLength(0);
  });
});
