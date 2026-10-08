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
}));

import { SKERRITS_SHARDPIKE_ID } from '../src/sim/lance_balance_core';
import {
  createOnlineHarness,
  type FrameRecord,
  type FrameScriptEntry,
} from './helpers/online_harness';

// The online pin for a couched Shardpike. The brace owns the body in the shared sim
// (player_movement_modes.ts advanceLanceBrace): the strafe keys steer the balance beam
// and the body stays planted. Online, the client's self-motion predictor stepped those
// same strafe frames through the plain motion kernel, so the drawn body slid sideways
// while the server held it still (dev playtest, 2026-10-08). The brace has to raise the
// server's movement override (server/movement_override_epoch.ts) the way a ledge climb
// does, so the predictor stands down and the drawn pose stays on the planted body.

const BRACE_AT_MS = 300;
const TAPS_FROM_MS = 900;
const TAP_MS = 150;
const TAPS = 6;
const TAPS_END_MS = TAPS_FROM_MS + TAPS * 2 * TAP_MS;
const RELEASE_AT_MS = TAPS_END_MS + 200;
const UNBRACED_STRAFE_AT_MS = RELEASE_AT_MS + 400;
const RUN_MS = UNBRACED_STRAFE_AT_MS + 800;
// The planted body may only show the wire's centimeter rounding.
const PLANTED_TOLERANCE_YD = 0.1;

function drawnOffset(frame: FrameRecord, x: number, z: number): number {
  return Math.hypot(frame.x - x, frame.z - z);
}

describe('online Shardpike brace (wire v2)', () => {
  it('keeps the drawn body planted while strafe steers the beam', () => {
    const harness = createOnlineHarness({
      latency: {
        toServer: { baseMs: 60, jitterMs: 10, seed: 1337 },
        toClient: { baseMs: 60, jitterMs: 10, seed: 4242 },
      },
      movementWire: 2,
    });
    try {
      const sim = harness.server.sim;
      const pid = harness.pid;
      sim.setPlayerLevel(20, pid);
      sim.addItem(SKERRITS_SHARDPIKE_ID, 1, pid);
      sim.equipItem(SKERRITS_SHARDPIKE_ID, pid);
      const anchor = { x: 0, z: 0 };
      let bracedThroughTaps = false;
      // Alternating short taps, the way a player holds the beam: every one of them
      // is real strafe intent on the wire.
      const script: FrameScriptEntry[] = [{ atMs: 0, mi: {}, facing: 0 }];
      for (let i = 0; i < TAPS; i++) {
        const at = TAPS_FROM_MS + i * 2 * TAP_MS;
        const right = i % 2 === 0;
        script.push({ atMs: at, mi: { strafeRight: right, strafeLeft: !right }, facing: 0 });
        script.push({
          atMs: at + TAP_MS,
          mi: { strafeRight: false, strafeLeft: false },
          facing: 0,
        });
      }
      // The control arm: the same strafe once the pike is put up moves the body.
      script.push({ atMs: UNBRACED_STRAFE_AT_MS, mi: { strafeRight: true }, facing: 0 });
      const run = harness.runScript({
        durationMs: RUN_MS,
        script,
        actions: [
          {
            atMs: BRACE_AT_MS,
            run: () => {
              anchor.x = harness.serverEntity.pos.x;
              anchor.z = harness.serverEntity.pos.z;
              // The real wire verb, exactly as the HUD's brace button sends it.
              harness.client.lanceBrace();
            },
          },
          {
            atMs: TAPS_END_MS,
            run: () => {
              bracedThroughTaps = !!sim.players.get(pid)?.lance;
            },
          },
          { atMs: RELEASE_AT_MS, run: () => harness.client.lanceRelease() },
        ],
      });

      // The scenario is honest: the beam survived every tap, so the server never let go.
      expect(bracedThroughTaps).toBe(true);
      const braced = run.frames.filter((f) => f.tMs >= TAPS_FROM_MS && f.tMs < TAPS_END_MS);
      expect(braced.length).toBeGreaterThan(0);
      const worst = Math.max(...braced.map((f) => drawnOffset(f, anchor.x, anchor.z)));
      expect(worst).toBeLessThanOrEqual(PLANTED_TOLERANCE_YD);

      // Control: unbraced, the same strafe intent really moves the drawn body.
      const last = run.frames[run.frames.length - 1];
      expect(drawnOffset(last, anchor.x, anchor.z)).toBeGreaterThan(1);
    } finally {
      harness.dispose();
    }
  });
});
