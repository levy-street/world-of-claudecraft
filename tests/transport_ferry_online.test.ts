import { describe, expect, it, vi } from 'vitest';

// Postgres is mocked before the server/game import the harness pulls in
// (tests/CLAUDE.md, Server tests). Superset shape, copied from
// tests/self_pose_teleport_online.test.ts.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
  // The branch's db surface (integration/world-quests-v0440): every export
  // server/game.ts imports, so a future arm of this file never trips
  // "No X export is defined on the mock" (the canonical shape is
  // tests/character_lease_game.test.ts).
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadRiftState: vi.fn(async () => null),
  saveRiftState: vi.fn(async () => {}),
  loadGuildBankRow: vi.fn(async () => null),
  loadGuildBankRows: vi.fn(async () => []),
  saveCharacterAndGuildBankState: vi.fn(async () => {}),
  GUILD_BANK_ROW_MAX_BYTES: 262144,
}));

import { type ClientSession, GameServer } from '../server/game';
import { deckFrameFor, entityRenderPose } from '../src/render/deck_frame';
import { remoteEntityAlpha } from '../src/render/net_interp_core';
import {
  EASTBROOK_FERRY_HULL,
  EASTBROOK_NIGHTBLOOM_FERRY,
} from '../src/sim/content/transport_ships';
import type { Sim } from '../src/sim/sim';
import { deckToWorld, worldToDeck } from '../src/sim/transport_deck';
import { transportClock } from '../src/sim/transport_ferry';
import {
  type TransportPose,
  transportShipPoseAt,
  transportVoyageSeconds,
} from '../src/sim/transport_schedule';
import type { Entity } from '../src/sim/types';
import { WATER_LEVEL } from '../src/sim/world';
import { broadcast } from './helpers/bare_client';
import { createOnlineHarness } from './helpers/online_harness';

// The ferry end to end online (Phase 3): real ClientWorlds against one real
// GameServer over the simulated link (tests/helpers/online_harness.ts). A
// passenger walks the deck of a ship under way with the reconciling
// prediction running in the ship's frame; another passenger standing on the
// deck stays glued to it on screen while the ship sails at full speed (the
// ship-frame interpolation of their wire deck spot); a connection dropped
// mid-voyage resumes on the deck wherever the ship has got to; and a whole
// voyage lands docked at the Nightbloom (route A; route B shares the code).

const ROUTE = EASTBROOK_NIGHTBLOOM_FERRY;
const T = ROUTE.timings;
const FAR = ROUTE.berths[1];
const DECK = WATER_LEVEL + EASTBROOK_FERRY_HULL.mainDeckY;
const VOYAGE = transportVoyageSeconds(ROUTE, 0);
/** A schedule clock on the homeward voyage's long reach east along the
 *  channel south of the Willowfen: at cruise, running straight, due east. */
const CRUISING_CLOCK = 2 * T.docked + transportVoyageSeconds(ROUTE, 0) + 92;

function shipPose(sim: Sim): TransportPose {
  return transportShipPoseAt(ROUTE, transportClock(sim.ctx), { x: 0, z: 0, rot: 0 });
}

function putOnDeck(sim: Sim, e: Entity, lx: number, lz: number, lf = 0): void {
  const pose = shipPose(sim);
  const at = deckToWorld(pose, lx, lz, { x: 0, z: 0 });
  e.pos = { x: at.x, y: DECK, z: at.z };
  e.prevPos = { ...e.pos };
  e.facing = pose.rot + lf;
  e.onGround = true;
  sim.rebucket(e);
}

const latency = {
  toServer: { baseMs: 40, jitterMs: 5, seed: 1337 },
  toClient: { baseMs: 40, jitterMs: 5, seed: 4242 },
};

describe('walking the deck under way, online', () => {
  it('predicts the walk in the ship frame, and the drawn pose agrees with the server', () => {
    const harness = createOnlineHarness({ latency, frameMs: 1000 / 60 });
    try {
      const sim = harness.server.sim;
      const e = harness.serverEntity;
      sim.transportClockOffset = CRUISING_CLOCK - sim.time;
      // on the port side of the waist, clear of the hatch, the mast and the
      // stairs: the harness steers by a fixed world heading, which on this
      // eastbound reach points across the deck to starboard
      putOnDeck(sim, e, 3.5, 1);
      const run = harness.runScript({
        durationMs: 4200,
        script: [
          { atMs: 0, mi: {}, facing: null },
          { atMs: 1200, mi: { forward: true }, facing: null },
          { atMs: 2700, mi: { forward: false }, facing: null },
        ],
      });
      // the client mirrors the voyage
      expect(harness.client.entities.get(harness.pid)?.ferryRiding).toBe(true);
      expect(harness.client.ferryView()?.passenger).toBe(true);
      const aboard = run.frames.filter((f) => f.tMs > 600);
      expect(aboard.every((f) => f.deckDrawn !== null)).toBe(true);
      // the reconciling prediction owned the pose while they walked
      const walking = run.frames.filter((f) => f.tMs > 1400 && f.tMs < 2600);
      expect(walking.length).toBeGreaterThan(50);
      expect(walking.every((f) => f.predictorActive)).toBe(true);
      // on screen the walk is steady and forward across the deck: no slide
      // with the ship's own 19 yards a second, no backward pops
      const first = aboard[0].deckDrawn;
      const last = aboard[aboard.length - 1].deckDrawn;
      if (!first || !last) throw new Error('not aboard');
      const len = Math.hypot(last.x - first.x, last.z - first.z);
      const dir = { x: (last.x - first.x) / len, z: (last.z - first.z) / len };
      let maxStep = 0;
      let backward = 0;
      for (let i = 1; i < aboard.length; i++) {
        const a = aboard[i - 1].deckDrawn;
        const b = aboard[i].deckDrawn;
        if (!a || !b) continue;
        maxStep = Math.max(maxStep, Math.hypot(b.x - a.x, b.z - a.z));
        backward = Math.max(backward, -((b.x - a.x) * dir.x + (b.z - a.z) * dir.z));
      }
      expect(maxStep).toBeLessThan(0.4);
      expect(backward).toBeLessThan(0.05);
      // they walked right across the waist to the starboard rail...
      expect(len).toBeGreaterThan(6.5);
      expect(last.x).toBeGreaterThan(-EASTBROOK_FERRY_HULL.beam / 2 + 0.3);
      // ...and the drawn deck spot settles on the server's
      const server = worldToDeck(shipPose(sim), e.pos.x, e.pos.z, { x: 0, z: 0 });
      expect(Math.hypot(last.x - server.x, last.z - server.z)).toBeLessThan(0.3);
      expect(last.y).toBeCloseTo(EASTBROOK_FERRY_HULL.mainDeckY, 1);
      // a replay only ever nudged the pose a hair
      expect(Math.max(...run.frames.map((f) => f.residualYd))).toBeLessThan(0.25);
    } finally {
      harness.dispose();
    }
  }, 60_000);

  it('another passenger standing on deck stays glued to the drawn deck at full speed', () => {
    const harness = createOnlineHarness({ latency, frameMs: 1000 / 60 });
    try {
      const sim = harness.server.sim;
      sim.transportClockOffset = CRUISING_CLOCK - sim.time;
      putOnDeck(sim, harness.serverEntity, 2, -6);
      // a second passenger on the same deck, a few yards forward
      const otherPid = sim.addPlayer('mage', 'Deckhand', { bot: true });
      const other = sim.entities.get(otherPid);
      if (!other) throw new Error('no second passenger');
      putOnDeck(sim, other, -1.5, 4.5, 0.4);
      const spots: { x: number; z: number }[] = [];
      const naive: { x: number; z: number }[] = [];
      let worldTravel = 0;
      let firstWorld: { x: number; z: number } | null = null;
      harness.runScript({
        durationMs: 3500,
        actions: Array.from({ length: 150 }, (_, i) => ({
          atMs: 1000 + i * 17,
          run: () => {
            const mirror = harness.client.entities.get(otherPid);
            const df = deckFrameFor(harness.client);
            if (!mirror || df.selfRoute < 0) return;
            const now = harness.clock.now();
            const ea = remoteEntityAlpha(now, mirror.netUpdatedAt, mirror.netInterval, 1);
            const pose = entityRenderPose(harness.client, mirror, ea, null);
            const drawn = df.ships[0].drawn;
            spots.push(worldToDeck(drawn, pose.x, pose.z, { x: 0, z: 0 }));
            // what plain world interpolation would have drawn instead
            const wx = mirror.prevPos.x + (mirror.pos.x - mirror.prevPos.x) * ea;
            const wz = mirror.prevPos.z + (mirror.pos.z - mirror.prevPos.z) * ea;
            naive.push(worldToDeck(drawn, wx, wz, { x: 0, z: 0 }));
            firstWorld ??= { x: pose.x, z: pose.z };
            worldTravel = Math.hypot(pose.x - firstWorld.x, pose.z - firstWorld.z);
          },
        })),
      });
      expect(harness.client.entities.get(otherPid)?.ferryRiding).toBe(true);
      expect(spots.length).toBeGreaterThan(100);
      // the ship carried them tens of yards...
      expect(worldTravel).toBeGreaterThan(25);
      // ...and on screen they never left their spot on the deck
      const spread = (list: { x: number; z: number }[]) =>
        Math.max(...list.map((s) => Math.hypot(s.x - list[0].x, s.z - list[0].z)));
      expect(spread(spots)).toBeLessThan(0.05);
      const onDeck = spots[spots.length - 1];
      expect(onDeck.x).toBeCloseTo(-1.5, 1);
      expect(onDeck.z).toBeCloseTo(4.5, 1);
      // (the world-frame interpolation the renderer used to draw slides
      // against the deck by a good fraction of a yard)
      expect(spread(naive)).toBeGreaterThan(spread(spots) * 4);
    } finally {
      harness.dispose();
    }
  }, 60_000);

  it('rides a whole voyage and lands docked at the Nightbloom, on the same deck spot', () => {
    const harness = createOnlineHarness({ latency, frameMs: 50 });
    try {
      const sim = harness.server.sim;
      const e = harness.serverEntity;
      sim.transportClockOffset = T.docked - 1 - sim.time;
      putOnDeck(sim, e, 1.5, 0.8);
      let sawPassenger = false;
      harness.runScript({
        durationMs: (VOYAGE + 2.5) * 1000,
        actions: Array.from({ length: 30 }, (_, i) => ({
          atMs: 2000 + i * 3000,
          run: () => {
            const view = harness.client.ferryView();
            const self = harness.client.entities.get(harness.pid);
            if (view?.passenger && self?.ferryRiding && self.ferryDeck) sawPassenger = true;
          },
        })),
      });
      expect(sawPassenger).toBe(true);
      expect(e.ferryRide ?? null).toBeNull();
      const local = worldToDeck(FAR, e.pos.x, e.pos.z, { x: 0, z: 0 });
      expect(local.x).toBeCloseTo(1.5, 1);
      expect(local.z).toBeCloseTo(0.8, 1);
      expect(e.pos.y).toBeCloseTo(DECK, 2);
      const view = harness.client.ferryView();
      expect(view?.phase).toBe('docked');
      expect(view?.berth).toBe('nightbloom');
      expect(view?.passenger).toBe(false);
      const self = harness.client.entities.get(harness.pid);
      expect(self?.ferryRiding).toBe(false);
      expect(self?.ferryDeck ?? null).toBeNull();
    } finally {
      harness.dispose();
    }
  }, 150_000);
});

function fakeWs() {
  // biome-ignore lint/suspicious/noExplicitAny: a minimal ws stand-in (tests/linkdead.test.ts)
  const ws: any = {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(() => {
      ws.readyState = 3;
    }),
  };
  return ws;
}

function joined(result: ClientSession | { error: string }): ClientSession {
  if ('error' in result) throw new Error(result.error);
  return result;
}

describe('a connection dropped mid-voyage', () => {
  it('rides on while linkdead and resumes on the deck wherever the ship has got to', () => {
    const server = new GameServer();
    const sim = server.sim;
    const ws = fakeWs();
    const session = joined(server.join(ws, 11, 101, 'Sailor', 'warrior', null));
    const e = sim.entities.get(session.pid);
    if (!e) throw new Error('no entity');
    sim.transportClockOffset = T.docked + 20 - sim.time;
    putOnDeck(sim, e, 0.5, -3);
    sim.tick();
    expect(e.ferryRide).toBeTruthy();
    // the socket drops; the character is held in the world, and the ship
    // sails on with it
    ws.readyState = 3;
    server.socketClosed(session, ws);
    expect(session.linkdead).toBe(true);
    const before = shipPose(sim);
    for (let i = 0; i < 200; i++) sim.tick();
    const after = shipPose(sim);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(60);
    const spot = worldToDeck(after, e.pos.x, e.pos.z, { x: 0, z: 0 });
    expect(spot.x).toBeCloseTo(0.5, 2);
    expect(spot.z).toBeCloseTo(-3, 2);
    expect(e.pos.y).toBeCloseTo(DECK, 3);
    // the same character reconnects: the held session resumes, on the deck
    const ws2 = fakeWs();
    const resumed = joined(server.join(ws2, 11, 101, 'Sailor', 'warrior', null));
    expect(resumed).toBe(session);
    expect(e.ferryRide).toBeTruthy();
    // the first snapshot to the new socket carries the passenger's deck spot
    broadcast(server);
    const snaps = ws2.send.mock.calls
      .map((c: unknown[]) => JSON.parse(String(c[0])))
      .filter((m: { t?: string }) => m.t === 'snap');
    const self = snaps
      .map((m: { self?: { id: number; fry?: number[] } }) => m.self)
      .find((w?: { id: number }) => w?.id === session.pid);
    expect(self?.fry?.[0]).toBe(0);
    expect(self?.fry?.[1]).toBeCloseTo(0.5, 1);
    expect(self?.fry?.[3]).toBeCloseTo(-3, 1);
  });
});
