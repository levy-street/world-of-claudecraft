import { describe, expect, it, vi } from 'vitest';

// Postgres is mocked before the server/game import (tests/CLAUDE.md, Server
// tests). Superset shape, copied from tests/unstuck_online.test.ts.
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
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { DT, RUN_SPEED } from '../src/sim/types';
import {
  COLLIDER_FREE_LANE,
  groundDistance,
  type MoveScript,
  type Pose,
  rawFakeWs,
  runOfflineSimTrajectory,
  runTwinServerTrajectory,
} from './helpers/movement_ground_truth';

// The ground truth a simulated-latency movement scenario is scored against. If
// the twin-server runner is not reproducible, or its straight run does not cover
// the distance the movement kernel promises, every latency measurement built on
// it is noise.

const STRAIGHT_RUN: MoveScript = [{ tick: 0, mi: { forward: true }, facing: 0 }];
const TICKS = 40; // 2 seconds; a full world boots per twin server, so keep it short

function traceOf(poses: Pose[]): string {
  return JSON.stringify(poses);
}

describe('twin-GameServer ground truth', () => {
  it('replays a script bit-identically', () => {
    const script: MoveScript = [
      { tick: 0, mi: { forward: true }, facing: 0.4 },
      { tick: 8, mi: { turnLeft: true } },
      { tick: 16, mi: { turnLeft: false, strafeRight: true } },
      { tick: 24, mi: { jump: true } },
      { tick: 25, mi: { jump: false } },
    ];
    const a = runTwinServerTrajectory({ script, ticks: TICKS });
    const b = runTwinServerTrajectory({ script, ticks: TICKS });

    expect(a).toHaveLength(TICKS);
    expect(traceOf(b)).toBe(traceOf(a));
    // Not a pair of frozen poses: the script really moved the body around.
    expect(groundDistance(a[0], a[TICKS - 1])).toBeGreaterThan(5);
    expect(new Set(a.map((p) => p.facing)).size).toBeGreaterThan(1);
  });

  it('covers RUN_SPEED per second on the collider-free lane', () => {
    const poses = runTwinServerTrajectory({ script: STRAIGHT_RUN, ticks: TICKS });
    const start = { x: COLLIDER_FREE_LANE.x, y: poses[0].y, z: COLLIDER_FREE_LANE.z, facing: 0 };
    const expected = RUN_SPEED * DT * TICKS;

    expect(groundDistance(start, poses[TICKS - 1])).toBeCloseTo(expected, 6);
    // Facing 0 is +z, so the whole run is on the z axis.
    expect(poses[TICKS - 1].z - COLLIDER_FREE_LANE.z).toBeCloseTo(expected, 6);
    expect(Math.abs(poses[TICKS - 1].x - COLLIDER_FREE_LANE.x)).toBeLessThan(1e-9);
    // Even per-tick pacing, no stall from a stale-input clear part way through.
    for (let i = 1; i < TICKS; i++) {
      expect(groundDistance(poses[i - 1], poses[i])).toBeCloseTo(RUN_SPEED * DT, 6);
    }
  });

  it('holds a scripted key down across the stale-input window', () => {
    // STALE_INPUT_SECONDS is 0.75 s (15 ticks): a runner that wrote the meta
    // once would be zeroed here and cover a fraction of the distance.
    const long = 30;
    const poses = runTwinServerTrajectory({ script: STRAIGHT_RUN, ticks: long });
    expect(poses[long - 1].z - COLLIDER_FREE_LANE.z).toBeCloseTo(RUN_SPEED * DT * long, 6);
  });

  it('records raw wire frames byte-identically', () => {
    const client = rawFakeWs();
    client.ws.send('{"t":"snap","x":1}');
    expect(client.sent).toEqual(['{"t":"snap","x":1}']);
  });
});

describe('offline-Sim cross-check', () => {
  it('agrees with the twin server on a straight run in the collider-free lane', () => {
    const twin = runTwinServerTrajectory({ script: STRAIGHT_RUN, ticks: TICKS });
    const offline = runOfflineSimTrajectory({ script: STRAIGHT_RUN, ticks: TICKS });
    expect(traceOf(offline)).toBe(traceOf(twin));
  });
});
