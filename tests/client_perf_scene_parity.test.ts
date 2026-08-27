// Cross-boundary drift guard for the client-perf scene classifier
// (server/http/client_perf_metrics.ts). The zone tokens a stock client reports
// are minted by telemetryZoneId (src/game/world_telemetry.ts); the server
// keeps its own knowledge of those token shapes because server/http cannot
// import src/game. This pin drives the REAL client function at real positions
// for every band it can emit from and asserts each output lands in its OWN
// scene class, so a token added to telemetryZoneId without a classifier arm
// fails here instead of silently polluting the 'overworld' distribution
// (which is exactly how arena / yumi_maze / rift / instance were missed in
// this module's first draft). Same pattern as
// tests/perf_suggestion_id_parity.test.ts: the one file that deliberately
// imports both sides of the boundary.

import { describe, expect, it } from 'vitest';
import {
  CLIENT_PERF_SCENE_CLASSES,
  classifyClientPerfScene,
} from '../server/http/client_perf_metrics';
import { telemetryZoneId } from '../src/game/world_telemetry';
import {
  ARENA_X_MIN,
  BG_X,
  DUNGEONS,
  delveOrigin,
  instanceOrigin,
  riftInstanceOrigin,
  YUMI_BAND_X_MAX,
  YUMI_BAND_X_MIN,
} from '../src/sim/data';

describe('client perf scene parity', () => {
  it('maps every band telemetryZoneId can emit from to its own scene class', () => {
    // Position recipes mirror tests/world_telemetry.test.ts: derived from the
    // band helpers, never literal coordinates.
    const cases: Array<[x: number, z: number, expected: string]> = [
      [0, 0, 'overworld'],
      [instanceOrigin(DUNGEONS.hollow_crypt.index, 0).x, 0, 'dungeon'],
      [delveOrigin(0, 0).x, delveOrigin(0, 0).z, 'delve'],
      // The unmapped-slot fallback still carries the delve: prefix.
      [delveOrigin(1, 0).x + 300, 0, 'delve'],
      [ARENA_X_MIN + 10, 0, 'arena'],
      [YUMI_BAND_X_MIN + 10, 0, 'yumi_maze'],
      [BG_X, 0, 'battleground'],
      [riftInstanceOrigin(0, 0).x, riftInstanceOrigin(0, 0).z, 'rift'],
      [YUMI_BAND_X_MAX + 10, 0, 'instance'],
    ];
    for (const [x, z, expected] of cases) {
      expect(classifyClientPerfScene(telemetryZoneId(x, z))).toBe(expected);
    }
  });

  it('never classifies a real client token as other', () => {
    // 'other' exists for the ingest defaults ('gameplay', 'benchmark', '');
    // a REAL zone token landing there means the classifier lost a signal.
    const tokens = [
      telemetryZoneId(0, 0),
      telemetryZoneId(instanceOrigin(DUNGEONS.hollow_crypt.index, 0).x, 0),
      telemetryZoneId(delveOrigin(0, 0).x, delveOrigin(0, 0).z),
      telemetryZoneId(ARENA_X_MIN + 10, 0),
      telemetryZoneId(YUMI_BAND_X_MIN + 10, 0),
      telemetryZoneId(BG_X, 0),
      telemetryZoneId(riftInstanceOrigin(0, 0).x, riftInstanceOrigin(0, 0).z),
      telemetryZoneId(YUMI_BAND_X_MAX + 10, 0),
    ];
    for (const token of tokens) {
      const scene = classifyClientPerfScene(token);
      expect(CLIENT_PERF_SCENE_CLASSES).toContain(scene);
      expect(scene).not.toBe('other');
    }
  });
});
