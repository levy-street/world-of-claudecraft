import { describe, expect, it, vi } from 'vitest';

// Postgres is mocked before the server/game import the harness pulls in
// (tests/CLAUDE.md, Server tests). Superset shape, copied from
// tests/unstuck_online.test.ts.
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
}));

import type { LatencyLinkConfig } from './helpers/latency_link';
import { COLLIDER_FREE_LANE, teleportEntity } from './helpers/movement_ground_truth';
import { createOnlineHarness, type FrameRecord } from './helpers/online_harness';

// The real-path pin for the post-teleport flight: one real ClientWorld against
// one real GameServer over the simulated link, the drawn pose coming out of the
// same updateSelfRenderPosition call renderer.ts makes (tests/helpers/
// online_harness.ts). The server moves the authoritative body a teleport away
// mid-run, the way a dungeon exit, hearth, or graveyard release does; the
// mirror snaps (entity_reanchor.ts) and prediction suspends on the override
// epoch bump, which is exactly the handoff frame where the display used to
// capture the whole jump as a decaying offset and draw the body flying the
// distance. The pinned property: once the mirror has arrived, the drawn pose is
// at the destination within a frame, and no frame ever draws a pose out in the
// gap between departure and arrival.
//
// Only the wire v2 arm is the regression pin (the base core fails it with eight
// in-gap frames). On wire v1 the predictor stays active across the teleport and
// re-seats itself, so the base core never captured an offset there; that arm is
// kept as a guard that the rule stays inert on the path that never needed it.

const TELEPORT_AT_MS = 1200;
const RUN_MS = 2600;
const TELEPORT_DZ = 400;
// Drawn-pose tolerance at the destination: the predictor's own display lead
// plus the wire's centimeter rounding, far below the six-yard snap rule.
const ARRIVAL_TOLERANCE_YD = 3;

function link(rttMs: number, jitterMs: number): LatencyLinkConfig {
  return {
    toServer: { baseMs: rttMs / 2, jitterMs, seed: 1337 },
    toClient: { baseMs: rttMs / 2, jitterMs, seed: 4242 },
  };
}

function runTeleportScenario(movementWire: 1 | 2): {
  frames: FrameRecord[];
  destinationZ: number;
} {
  const harness = createOnlineHarness({ latency: link(120, 10), movementWire });
  try {
    const seed = harness.server.sim.cfg.seed;
    const destinationZ = COLLIDER_FREE_LANE.z + TELEPORT_DZ;
    const run = harness.runScript({
      durationMs: RUN_MS,
      // Held forward the whole run: the predictor owns the pose when the
      // teleport lands, which is the shape the bug needed.
      script: [{ atMs: 0, mi: { forward: true }, facing: 0 }],
      actions: [
        {
          atMs: TELEPORT_AT_MS,
          run: () => {
            teleportEntity(harness.serverEntity, COLLIDER_FREE_LANE.x, destinationZ, seed);
            harness.server.sim.rebucket(harness.serverEntity);
          },
        },
      ],
    });
    return { frames: run.frames, destinationZ };
  } finally {
    harness.dispose();
  }
}

describe.each([2, 1] as const)('online self pose across a server teleport (wire v%i)', (wire) => {
  it('arrives with the mirror in one frame and never draws the body in the gap', () => {
    const { frames, destinationZ } = runTeleportScenario(wire);
    const departureZ = COLLIDER_FREE_LANE.z;
    const arrivalIndex = frames.findIndex(
      (frame) => frame.tMs >= TELEPORT_AT_MS && Math.abs(frame.mirrorZ - destinationZ) < 1,
    );
    expect(arrivalIndex).toBeGreaterThan(0);
    const gapLow = departureZ + 40;
    const gapHigh = destinationZ - 40;
    const flying = frames.filter((frame) => frame.z > gapLow && frame.z < gapHigh);
    expect(flying.map((frame) => ({ tMs: frame.tMs, z: frame.z }))).toEqual([]);
    // The frame the mirror lands (or the very next one) draws the destination.
    const arrived = frames
      .slice(arrivalIndex, arrivalIndex + 2)
      .some((frame) => Math.abs(frame.z - frame.mirrorZ) <= ARRIVAL_TOLERANCE_YD);
    expect(arrived).toBe(true);
    // ...and it stays there: every later frame tracks the mirror.
    for (const frame of frames.slice(arrivalIndex + 2)) {
      expect(Math.abs(frame.z - frame.mirrorZ)).toBeLessThanOrEqual(ARRIVAL_TOLERANCE_YD);
    }
  });
});
