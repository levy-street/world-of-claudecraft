import { describe, expect, it, vi } from 'vitest';

// Postgres is mocked before the server/game import the harness pulls in
// (tests/CLAUDE.md, Server tests). Superset shape, copied from
// tests/wind_drift_online.test.ts.
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

import { QUENCH_AURAS, QUENCH_NAMES } from '../src/sim/encounters/smith_heart/quench_ids';
import { createOnlineHarness } from './helpers/online_harness';

// The online pin for the Frozen Lake's water (encounters/smith_heart/
// quench_ice.ts): a body that walks into a hole is held there by an
// unbreakable root while the server sets it a breath inside the rim, and on
// the tick its time is up the server sets it on the rim and lifts the root.
// One real ClientWorld against one real GameServer over a 120 ms link: while
// held, the drawn body stays put (the prediction stands down to the server,
// no walking on through the water); after the climb it lands where the server
// put it and walks on again under its own prediction. The fight's own rules
// are pinned offline (tests/smith_heart_quench.test.ts); this pins the two
// server moves the water makes.

const PLUNGE_AT_MS = 900;
const HOLD_MS = 4000;
const RUN_MS = PLUNGE_AT_MS + HOLD_MS + 2200;
const RTT_SETTLE_MS = 450;

describe('the Frozen Lake water online (wire v2)', () => {
  it('holds a body still in the water and sets it on the rim, then lets it walk on', () => {
    const harness = createOnlineHarness({
      latency: {
        toServer: { baseMs: 60, jitterMs: 10, seed: 1337 },
        toClient: { baseMs: 60, jitterMs: 10, seed: 4242 },
      },
      movementWire: 2,
    });
    try {
      const e = harness.serverEntity;
      const sim = harness.server.sim;
      let climbAt = { x: 0, z: 0 };
      const run = harness.runScript({
        durationMs: RUN_MS,
        // Held forward (north) the whole run: the player keeps pushing on.
        script: [{ atMs: 0, mi: { forward: true }, facing: 0 }],
        actions: [
          {
            atMs: PLUNGE_AT_MS,
            run: () => {
              // In the water a breath inside the rim, and held.
              e.pos.z += 0.8;
              e.prevPos = { ...e.pos };
              sim.ctx.rebucket(e);
              sim.ctx.applyAura(e, {
                id: QUENCH_AURAS.trapped,
                name: QUENCH_NAMES.trapped,
                kind: 'root',
                remaining: HOLD_MS / 1000 + 1,
                duration: HOLD_MS / 1000 + 1,
                value: 0,
                sourceId: 0,
                school: 'frost',
                unbreakableControl: true,
                undispellable: true,
              });
            },
          },
          {
            atMs: PLUNGE_AT_MS + HOLD_MS,
            run: () => {
              // Out on the rim, to the side it went in, the root lifted.
              const p = sim.ctx.groundPos(e.pos.x + 3.5, e.pos.z);
              e.pos = p;
              e.prevPos = { ...p };
              sim.ctx.rebucket(e);
              e.auras = e.auras.filter((a) => a.id !== QUENCH_AURAS.trapped);
              climbAt = { x: p.x, z: p.z };
            },
          },
        ],
      });
      const held = run.frames.filter(
        (f) => f.tMs >= PLUNGE_AT_MS + RTT_SETTLE_MS && f.tMs < PLUNGE_AT_MS + HOLD_MS,
      );
      expect(held.length).toBeGreaterThan(100);
      // Held: the drawn body does not walk on through the water.
      const h0 = held[0];
      for (const f of held) expect(Math.hypot(f.x - h0.x, f.z - h0.z)).toBeLessThan(0.3);
      expect(held.every((f) => !f.predictionEnabled || !f.predictorActive)).toBe(true);
      // After the climb (and a round trip), it stands on the rim where the
      // server set it, then walks on north under its own prediction.
      const after = run.frames.filter((f) => f.tMs >= PLUNGE_AT_MS + HOLD_MS + RTT_SETTLE_MS);
      expect(after.length).toBeGreaterThan(40);
      const a0 = after[0];
      expect(Math.abs(a0.x - climbAt.x)).toBeLessThan(0.6);
      const last = after[after.length - 1];
      expect(last.z - a0.z).toBeGreaterThan(4);
      expect(after.slice(-20).every((f) => f.predictorActive)).toBe(true);
      for (const f of after.slice(-20))
        expect(Math.hypot(f.x - f.mirrorX, f.z - f.mirrorZ)).toBeLessThan(2);
    } finally {
      harness.dispose();
    }
  });
});
