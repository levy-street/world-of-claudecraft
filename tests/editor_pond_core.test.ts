import { describe, expect, it } from 'vitest';
import { customMapToWorldContent, newFlatCustomMap } from '../src/editor/custom_map';
import { parseMap, serializeMapCompact } from '../src/editor/persist';
import { type PondPlan, planPond, pondTerrainMatches } from '../src/editor/pond_core';
import { fluidContains } from '../src/sim/fluid_volumes';
import { applyHeightStamp } from '../src/sim/terrain_edit_layer';

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Expected a valid pond');
  return value;
}

function samplePlan(plan: PondPlan, x: number, z: number, before: number): number {
  return plan.stamps.reduce((height, stamp) => applyHeightStamp(stamp, x, z, height), before);
}

describe('pond terrain plan', () => {
  it('accepts the completed basin and rejects an authored pad that overrides its floor', () => {
    const plan = required(planPond({ x: 450, z: 2140, radius: 8, depth: 2 }, () => 2));
    const completed = (x: number, z: number): number => samplePlan(plan, x, z, 2);
    expect(pondTerrainMatches(plan, completed)).toBe(true);
    expect(pondTerrainMatches(plan, () => 2)).toBe(false);
    expect(pondTerrainMatches(plan, (x, z) => completed(x, z) + 1e-6)).toBe(true);
  });

  it.each([1, 4, 9, 15])('refuses a breach at rim sample %i after terrain evaluation', (step) => {
    const plan = required(planPond({ x: 0, z: 0, radius: 8, depth: 2 }, () => 10));
    const angle = (step * Math.PI * 2) / 16;
    const breachX = Math.cos(angle) * 8;
    const breachZ = Math.sin(angle) * 8;
    const completed = (x: number, z: number): number =>
      Math.hypot(x - breachX, z - breachZ) < 0.001 ? 8 : samplePlan(plan, x, z, 10);
    expect(pondTerrainMatches(plan, completed)).toBe(false);
  });

  it('refuses non-finite final center or rim heights', () => {
    const plan = required(planPond({ x: 0, z: 0, radius: 8, depth: 2 }, () => 10));
    expect(pondTerrainMatches(plan, () => NaN)).toBe(false);
    expect(pondTerrainMatches(plan, (x, z) => (x === 0 && z === 0 ? 8 : Infinity))).toBe(false);
  });

  it('digs the requested depth and seats water relative to the completed basin', () => {
    const plan = required(planPond({ x: 12, z: -6, radius: 8, depth: 2 }, () => 16));
    expect(samplePlan(plan, 12, -6, 16)).toBe(14);
    expect(plan.surfaceY).toBe(15.75);
    expect(plan.water.sizeY).toBe(1.75);
    expect(plan.water).toMatchObject({
      assetId: 'fluid/water',
      sizeX: 16,
      sizeZ: 16,
      collide: false,
      fluidDps: 0,
      fluidFx: 0,
    });
    expect(plan.region.minX).toBeCloseTo(0.8);
    expect(plan.region.maxZ).toBeCloseTo(5.2);
    expect(samplePlan(plan, 12 + 11.2, -6, 16)).toBe(16);
  });

  it('buries the entire water-disc edge on sloping ground and blends outside the bank', () => {
    const terrain = (x: number, z: number): number => 18 + 0.8 * x - 0.4 * z;
    const plan = required(planPond({ x: 0, z: 0, radius: 10, depth: 3 }, terrain));
    for (let step = 0; step < 72; step++) {
      const angle = (step * Math.PI * 2) / 72;
      const x = Math.cos(angle) * 10;
      const z = Math.sin(angle) * 10;
      expect(samplePlan(plan, x, z, terrain(x, z))).toBeCloseTo(18);
      expect(samplePlan(plan, x, z, terrain(x, z))).toBeGreaterThan(plan.surfaceY);
      const outerX = Math.cos(angle) * 14;
      const outerZ = Math.sin(angle) * 14;
      expect(samplePlan(plan, outerX, outerZ, terrain(outerX, outerZ))).toBeCloseTo(
        terrain(outerX, outerZ),
      );
    }
    // Halfway through the feather, the bank still follows the hillside.
    expect(samplePlan(plan, 12, 0, terrain(12, 0))).toBeCloseTo(22.8);
    expect(samplePlan(plan, 0, 0, terrain(0, 0))).toBe(15);
  });

  it.each([
    { radius: -1, depth: -4, diameter: 4, floor: 19.5 },
    { radius: 900, depth: 80, diameter: 120, floor: 12 },
  ])('bounds finite size settings without producing unsaveable geometry: %j', (settings) => {
    const plan = required(planPond({ x: 0, z: 0, ...settings }, () => 20));
    expect(plan.water.sizeX).toBe(settings.diameter);
    expect(samplePlan(plan, 0, 0, 20)).toBe(settings.floor);
    expect(plan.water.sizeY).toBeGreaterThan(0);
  });

  it.each([
    { x: NaN, z: 0, radius: 8, depth: 2 },
    { x: 0, z: Infinity, radius: 8, depth: 2 },
    { x: 0, z: 0, radius: NaN, depth: 2 },
    { x: 0, z: 0, radius: 8, depth: -Infinity },
    { x: 10_000, z: 0, radius: 8, depth: 2 },
  ])('rejects invalid coordinates or settings: %j', (settings) => {
    expect(planPond(settings, () => 20)).toBeNull();
  });

  it.each([NaN, Infinity, -Infinity, 201, -199])(
    'refuses terrain height %s rather than author a level target that saving would change',
    (height) => {
      expect(planPond({ x: 0, z: 0, radius: 8, depth: 2 }, () => height)).toBeNull();
    },
  );

  it('round-trips both stamps and water through the real sanitizer and playtest projection', () => {
    const map = newFlatCustomMap('Pond garden', 'pond-garden', 42);
    map.waterLevel = -12;
    const plan = required(planPond({ x: 3, z: 4, radius: 8, depth: 2 }, () => 10));
    map.terrainEdits.push(...plan.stamps);
    map.placements.push(plan.water);
    const loaded = required(parseMap(serializeMapCompact(map)));
    expect(loaded.terrainEdits.slice(-2)).toEqual(plan.stamps);
    expect(loaded.placements).toEqual([plan.water]);
    expect(loaded.waterLevel).toBe(-12);
    const world = customMapToWorldContent(loaded);
    expect(world.waterLevel).toBe(-12);
    const volume = required(world.fluids?.[0]);
    expect(volume).toMatchObject({
      kind: 'water',
      x: 3,
      z: 4,
      halfX: 8,
      halfZ: 8,
      offsetY: 1.75,
      dps: 0,
      fx: 0,
    });
    expect(fluidContains(volume, 3, 4)).toBe(true);
    expect(fluidContains(volume, 12, 4)).toBe(false);
    const floor = loaded.terrainEdits
      .slice(-2)
      .reduce((height, stamp) => applyHeightStamp(stamp, 3, 4, height), 10);
    expect(floor + volume.offsetY).toBe(plan.surfaceY);
  });
});
