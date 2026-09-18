import { describe, expect, it } from 'vitest';
import {
  sampleGroundTilt,
  sampleStandingSurface,
  standingSurfaceAt,
} from '../src/render/entity_ground_sample';
import {
  createEntityGroundSample,
  ENTITY_GROUND_RESAMPLE_S,
  ENTITY_GROUND_RESAMPLE_YD,
} from '../src/render/entity_ground_sample_core';
import { supportHeightAt } from '../src/sim/colliders';
import { isRiftPos, riftInstanceOrigin } from '../src/sim/data';
import { generateRiftFloor, riftLiftAt } from '../src/sim/rift/rift_gen';
import { groundHeight } from '../src/sim/world';

// The host half of the remote-body ground sample: the standing surface is
// the sim's own terrain height (plus a standable prop top under the feet),
// never re-derived here, and the per-frame entry serves the cached value
// between the cadence core's resamples.

const SEED = 42;
const OPEN_WORLD_POINTS: [number, number][] = [
  [12.5, -40.25],
  [-180, 64],
  [300.75, 220.5],
];

describe('entity ground sample host', () => {
  it('reads the standing surface off the sim terrain and prop tops', () => {
    for (const [x, z] of OPEN_WORLD_POINTS) {
      const ground = groundHeight(x, z, SEED);
      const y = ground;
      const expected = Math.max(ground, supportHeightAt(SEED, x, z, 0.5, y + 0.01));
      expect(standingSurfaceAt(SEED, null, x, y, z)).toBe(expected);
    }
  });

  it('serves the cached surface for a standing body and resamples on a move', () => {
    const world = { cfg: { seed: SEED }, riftFloor: null };
    const sample = createEntityGroundSample();
    const [x, z] = OPEN_WORLD_POINTS[0];
    const y = groundHeight(x, z, SEED);
    const first = sampleStandingSurface(sample, world, x, y, z, 1 / 60, false);
    expect(first).toBe(standingSurfaceAt(SEED, null, x, y, z));

    // Standing still within the cadence: the same reading, no new sample.
    for (let i = 0; i < 10; i++) {
      expect(sampleStandingSurface(sample, world, x, y, z, 1 / 60, false)).toBe(first);
    }
    expect(sample.x).toBe(x);

    // Past the displacement threshold: a fresh sample at the new position.
    const x2 = x + ENTITY_GROUND_RESAMPLE_YD * 2;
    const y2 = groundHeight(x2, z, SEED);
    expect(sampleStandingSurface(sample, world, x2, y2, z, 1 / 60, false)).toBe(
      standingSurfaceAt(SEED, null, x2, y2, z),
    );
    expect(sample.x).toBe(x2);
  });

  it('adds the rift tier lift under a body standing in a rift', () => {
    // A synthetic rift floor at the rift band: the standing surface is the
    // flat rift ground plus the raised tier under the feet, exactly the sum
    // the old inline block took, so a player on a platform reads grounded.
    // Not every generated floor carries a raised tier (authored layouts are
    // flat unless a room lifts): search a few seeds and floors for one.
    let rift: NonNullable<Parameters<typeof standingSurfaceAt>[1]> | null = null;
    let lifted: [number, number] | null = null;
    let floor = generateRiftFloor(1, 10, 0, null);
    for (let seed = 1; seed <= 24 && !lifted; seed++) {
      for (let floorIndex = 0; floorIndex < 4 && !lifted; floorIndex++) {
        floor = generateRiftFloor(seed, 10, floorIndex, null);
        for (let lx = -36; lx <= 60 && !lifted; lx += 3) {
          for (let lz = -80; lz <= 160; lz += 3) {
            if (riftLiftAt(floor, lx, lz) > 0) {
              lifted = [lx, lz];
              rift = {
                seed,
                baseLevel: 10,
                floorIndex,
                upgrade: null,
                origin: riftInstanceOrigin(0, floorIndex),
              } as unknown as NonNullable<Parameters<typeof standingSurfaceAt>[1]>;
              break;
            }
          }
        }
      }
    }
    expect(lifted, 'a raised tier exists on some generated floor').not.toBeNull();
    if (!rift || !lifted) return;
    const [lx, lz] = lifted;
    const x = rift.origin.x + lx;
    const z = rift.origin.z + lz;
    expect(isRiftPos(x)).toBe(true);
    const lift = riftLiftAt(floor, lx, lz);
    const flat = standingSurfaceAt(SEED, null, x, 0, z);
    const y = flat + lift;
    expect(standingSurfaceAt(SEED, rift, x, y, z)).toBeCloseTo(
      Math.max(groundHeight(x, z, SEED) + lift, supportHeightAt(SEED, x, z, 0.5, y + 0.01)),
      9,
    );
    expect(standingSurfaceAt(SEED, rift, x, y, z)).toBeGreaterThan(flat);
  });

  it('resamples the terrain-lean stencil on the interval only once the body moved', () => {
    const [x, z] = OPEN_WORLD_POINTS[2];
    const y = groundHeight(x, z, SEED);
    const view = {
      tiltSampleT: 0,
      tiltSample: createEntityGroundSample(),
      tiltGradX: 0,
      tiltGradZ: 0,
      tiltOnProp: true,
    };
    const interval = 0.06;
    sampleGroundTilt(view, SEED, x, y, z, 1 / 60, interval);
    const span = 0.55;
    expect(view.tiltGradX).toBeCloseTo(
      (groundHeight(x + span, z, SEED) - groundHeight(x - span, z, SEED)) / (2 * span),
      9,
    );
    expect(view.tiltOnProp).toBe(false);
    expect(view.tiltSampleT).toBe(interval);

    // Standing still: the interval elapses again and again without a new
    // stencil (a poisoned gradient stays), until the age cadence.
    view.tiltGradX = 123;
    let t = 0;
    while (t < ENTITY_GROUND_RESAMPLE_S - 0.1) {
      sampleGroundTilt(view, SEED, x, y, z, 1 / 60, interval);
      t += 1 / 60;
    }
    expect(view.tiltGradX).toBe(123);
    while (t < ENTITY_GROUND_RESAMPLE_S + 0.2) {
      sampleGroundTilt(view, SEED, x, y, z, 1 / 60, interval);
      t += 1 / 60;
    }
    expect(view.tiltGradX).not.toBe(123);

    // Moving: a body past the threshold resamples at the next interval, and
    // never inside it, whatever the displacement.
    view.tiltGradX = 123;
    view.tiltSampleT = interval;
    const x2 = x + ENTITY_GROUND_RESAMPLE_YD * 2;
    sampleGroundTilt(view, SEED, x2, y, z, 1 / 60, interval);
    expect(view.tiltGradX).toBe(123);
    sampleGroundTilt(view, SEED, x2, y, z, interval, interval);
    expect(view.tiltGradX).not.toBe(123);
    expect(view.tiltSample.x).toBe(x2);
  });

  it('samples every frame when forced (the local player)', () => {
    const world = { cfg: { seed: SEED }, riftFloor: null };
    const sample = createEntityGroundSample();
    const [x, z] = OPEN_WORLD_POINTS[1];
    const y = groundHeight(x, z, SEED);
    sampleStandingSurface(sample, world, x, y, z, 1 / 60, true);
    // A move under the threshold still resamples under force.
    const x2 = x + ENTITY_GROUND_RESAMPLE_YD / 2;
    sampleStandingSurface(sample, world, x2, y, z, 1 / 60, true);
    expect(sample.x).toBe(x2);
  });
});
