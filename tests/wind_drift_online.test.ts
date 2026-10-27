import { describe, expect, it, vi } from 'vitest';

// Postgres is mocked before the server/game import the harness pulls in
// (tests/CLAUDE.md, Server tests). Superset shape, copied from
// tests/shardpike_brace_online.test.ts.
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

import type { Aura } from '../src/sim/types';
import { WIND_DRIFT_AURA } from '../src/sim/wind_drift';
import { createOnlineHarness, type FrameRecord } from './helpers/online_harness';

// The online pin for an encounter's wind (src/sim/wind_drift.ts; the Guardian
// of the Breath's blows, encounters/smith_heart/breath_gale.ts). The push is
// stepped by the shared kernel on BOTH hosts from an aura the snapshot mirrors,
// so one real ClientWorld against one real GameServer over a 120 ms link keeps
// PREDICTING through a blow: the reconciler matches every acknowledged tick of
// the steady wind (only the blow's start and end are replayed), the predictor
// never stands down, and the drawn body moves smoothly (no frame jumps more
// than the walk plus the wind can carry it), tracking the authoritative pose.
// A real second connection walking against the wind in the game itself is the
// in-browser check (NOTAS); this is its deterministic twin.

const BLOW_AT_MS = 800;
const BLOW_MS = 4000;
const RUN_MS = BLOW_AT_MS + BLOW_MS + 1200;
const WIND = 3.6;
/** Settle windows round the blow's edges (an RTT and a little). */
const EDGE_MS = 400;

function wind(heading: number): Aura {
  return {
    id: WIND_DRIFT_AURA,
    name: 'Bellows Wind',
    kind: 'internal_cd',
    remaining: BLOW_MS / 1000,
    duration: BLOW_MS / 1000,
    value: heading,
    value2: WIND,
    sourceId: 0,
    school: 'nature',
    undispellable: true,
  };
}

function inSteadyBlow(f: FrameRecord): boolean {
  return f.tMs >= BLOW_AT_MS + EDGE_MS && f.tMs < BLOW_AT_MS + BLOW_MS - 450;
}

describe.each([
  ['into the wind', Math.PI],
  ['across the wind', Math.PI / 2],
])('online wind drift (wire v2), walking %s', (_label, windHeading) => {
  it('keeps predicting through a blow: matched acks, no stand-down, no jumps', () => {
    const harness = createOnlineHarness({
      latency: {
        toServer: { baseMs: 60, jitterMs: 10, seed: 1337 },
        toClient: { baseMs: 60, jitterMs: 10, seed: 4242 },
      },
      movementWire: 2,
    });
    try {
      let epochBefore = -1;
      const run = harness.runScript({
        durationMs: RUN_MS,
        // Held forward (north) the whole run, the way a player fights a blow.
        script: [{ atMs: 0, mi: { forward: true }, facing: 0 }],
        actions: [
          {
            atMs: 200,
            run: () => {
              epochBefore = harness.session.movementOverrideEpoch;
            },
          },
          {
            atMs: BLOW_AT_MS,
            run: () => {
              harness.serverEntity.auras.push(wind(windHeading));
            },
          },
        ],
      });
      // No server override epoch, ever: the blow's start and its end (the
      // aura running out mid-tick, after the step it carried, as the fight's
      // do) never stand the prediction down: the step check allows the last
      // tick's wind too.
      expect(harness.session.movementOverrideEpoch).toBe(epochBefore);
      expect(run.frames.filter((f) => f.tMs > 200).every((f) => f.predictorActive)).toBe(true);
      const steady = run.frames.filter(inSteadyBlow);
      expect(steady.length).toBeGreaterThan(40);
      // The predictor owns the pose through the whole blow.
      expect(steady.every((f) => f.predictorActive)).toBe(true);
      // Every acknowledgement of the steady wind matched: no frame of it
      // replayed (the harness marks a replayed frame, a match leaves it null).
      expect(steady.filter((f) => f.reconcileMode !== null).map((f) => f.tMs)).toEqual([]);
      // Smooth: no frame moves the drawn body farther than the walk and the
      // wind together carry it in that frame (plus the wire's rounding).
      for (let i = 1; i < run.frames.length; i++) {
        const a = run.frames[i - 1];
        const b = run.frames[i];
        const step = Math.hypot(b.x - a.x, b.z - a.z);
        expect(step, `frame ${b.tMs} ms`).toBeLessThanOrEqual((7 + WIND) * b.frameDtSec + 0.12);
      }
      // ...and it tracks the authoritative body the whole time.
      for (const f of steady) {
        expect(Math.hypot(f.x - f.mirrorX, f.z - f.mirrorZ)).toBeLessThan(2);
      }
      // The wind really moved it: walking into it makes less headway north,
      // across it the body drifts sideways.
      const first = steady[0];
      const last = steady[steady.length - 1];
      const dt = (last.tMs - first.tMs) / 1000;
      const north = (last.z - first.z) / dt;
      const east = (last.x - first.x) / dt;
      if (windHeading === Math.PI) expect(north).toBeLessThan(7 - WIND + 0.5);
      else expect(east).toBeGreaterThan(WIND - 0.5);
    } finally {
      harness.dispose();
    }
  });
});
