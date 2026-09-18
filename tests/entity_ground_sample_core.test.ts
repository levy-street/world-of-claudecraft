import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  commitEntityGroundSample,
  createEntityGroundSample,
  ENTITY_GROUND_RESAMPLE_S,
  ENTITY_GROUND_RESAMPLE_YD,
  entityGroundSampleDue,
  entityGroundSamplePhaseS,
} from '../src/render/entity_ground_sample_core';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';

// The renderer's entity loop used to sample the procedural terrain (and the
// standable prop tops) under every remote player on every frame for the
// airborne heuristic: 5 percent of the main thread with 51 bodies on the
// iGPU campaign's profiles. This core decides when a body needs a fresh
// standing surface; the renderer caches the sample per body in between.

const DT = 1 / 60;

describe('entity ground sample cadence', () => {
  it('samples a body that just appeared, then not again while it stands still', () => {
    const sample = createEntityGroundSample();
    expect(entityGroundSampleDue(sample, 10, 5, 20, DT)).toBe(true);
    commitEntityGroundSample(sample, 10, 5, 20, 4.8);
    expect(sample.standY).toBe(4.8);

    // A standing body: the same reading for as long as the cadence allows,
    // so the cached surface is exactly the one a per-frame sample would give.
    let due = 0;
    for (let i = 0; i < 20; i++) if (entityGroundSampleDue(sample, 10, 5, 20, DT)) due++;
    expect(due).toBe(0);
    expect(sample.standY).toBe(4.8);
  });

  it('resamples once the body moved past the threshold on any axis', () => {
    const near = ENTITY_GROUND_RESAMPLE_YD * 0.9;
    const far = ENTITY_GROUND_RESAMPLE_YD * 1.1;
    for (const axis of ['x', 'y', 'z'] as const) {
      const sample = createEntityGroundSample();
      commitEntityGroundSample(sample, 10, 5, 20, 4.8);
      const at = (d: number) => ({ x: 10, y: 5, z: 20, [axis]: { x: 10, y: 5, z: 20 }[axis] + d });
      const a = at(near);
      expect(entityGroundSampleDue(sample, a.x, a.y, a.z, DT)).toBe(false);
      const b = at(-near);
      expect(entityGroundSampleDue(sample, b.x, b.y, b.z, DT)).toBe(false);
      const c = at(far);
      expect(entityGroundSampleDue(sample, c.x, c.y, c.z, DT)).toBe(true);
    }
  });

  it('resamples a standing body once its countdown reaches the cadence', () => {
    const sample = createEntityGroundSample();
    commitEntityGroundSample(sample, 10, 5, 20, 4.8);
    let t = 0;
    let firstDueAt = -1;
    while (t < ENTITY_GROUND_RESAMPLE_S * 2) {
      t += DT;
      if (entityGroundSampleDue(sample, 10, 5, 20, DT)) {
        firstDueAt = t;
        break;
      }
    }
    expect(firstDueAt).toBeGreaterThanOrEqual(ENTITY_GROUND_RESAMPLE_S);
    expect(firstDueAt).toBeLessThan(ENTITY_GROUND_RESAMPLE_S + 2 * DT);
    // A fresh commit restarts the clock.
    commitEntityGroundSample(sample, 10, 5, 20, 4.8);
    expect(sample.ageS).toBe(0);
    expect(entityGroundSampleDue(sample, 10, 5, 20, DT)).toBe(false);
  });

  it('seeds a stable per-entity phase so standing remote bodies spread across frames', () => {
    const ids = Array.from({ length: 24 }, (_, i) => 10_000 + i);
    const phases = ids.map((id) => entityGroundSamplePhaseS(id));
    for (const phase of phases) {
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(ENTITY_GROUND_RESAMPLE_S);
    }
    expect(new Set(phases.map((phase) => phase.toFixed(4))).size).toBeGreaterThan(20);
    expect(entityGroundSamplePhaseS(ids[0])).toBe(entityGroundSamplePhaseS(ids[0]));

    const samples = ids.map((id) => createEntityGroundSample(entityGroundSamplePhaseS(id)));
    for (const sample of samples) commitEntityGroundSample(sample, 10, 5, 20, 4.8);
    const dueCounts: number[] = [];
    for (let frame = 0; frame < Math.ceil(ENTITY_GROUND_RESAMPLE_S / DT); frame++) {
      let due = 0;
      for (const sample of samples) {
        if (entityGroundSampleDue(sample, 10, 5, 20, DT)) {
          due++;
          commitEntityGroundSample(sample, 10, 5, 20, 4.8);
        }
      }
      dueCounts.push(due);
    }
    expect(Math.max(...dueCounts)).toBeLessThan(ids.length / 3);
    expect(dueCounts.filter((count) => count > 0).length).toBeGreaterThan(8);
  });

  it('drives the airborne heuristic and the terrain lean in the renderer entity loop', () => {
    // The wiring pin: the airborne heuristic reads the cached sample through
    // the host module, forcing a fresh sample only for the local player, the
    // old per-frame groundHeight + supportHeightAt pair is gone from it, and
    // the terrain-lean stencil rides the same module over its interval.
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain(
      'const standY = sampleStandingSurface(v.groundSample, this.sim, ax, ay, az, dt, isSelf);',
    );
    expect(renderer).toContain(
      'groundSample: createEntityGroundSample(entityGroundSamplePhaseS(e.id)),',
    );
    expect(renderer).not.toContain('supportHeightAt(heurSeed, ax, az, 0.5, ay + 0.01)');
    expect(renderer).toContain(
      'sampleGroundTilt(v, this.sim.cfg.seed, ax, ay, az, dt, TILT_SAMPLE_INTERVAL);',
    );
    expect(renderer).toContain('tiltSample: createEntityGroundSample(),');
    expect(renderer).not.toContain('groundHeight(ax - TILT_SAMPLE_SPAN, az, ts)');
  });

  it('keeps the displacement threshold under the airborne epsilon on walkable slopes', () => {
    // The renderer reads airborne when the feet sit more than AIRBORNE_EPS
    // above the standing surface. The threshold is per axis, so a diagonal
    // mover can be threshold * sqrt(2) stale, and the steepest walkable
    // ground is the sim's climb limit: that product must stay under the
    // epsilon, read off the two sources so a retune of either reds here.
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const airborneEps = Number(renderer.match(/const AIRBORNE_EPS = ([0-9.]+);/)?.[1]);
    expect(airborneEps).toBeGreaterThan(0);
    expect(PLAYER_MAX_CLIMB_SLOPE).toBeGreaterThan(0);
    expect(ENTITY_GROUND_RESAMPLE_YD).toBeGreaterThan(0);
    expect(ENTITY_GROUND_RESAMPLE_YD * Math.SQRT2 * PLAYER_MAX_CLIMB_SLOPE).toBeLessThan(
      airborneEps,
    );
  });
});
