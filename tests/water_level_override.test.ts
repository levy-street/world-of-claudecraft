import { afterEach, describe, expect, it } from 'vitest';
import { buildChunkArrays } from '../src/render/zone_build_worker';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import type { WorldContent } from '../src/sim/types';
import {
  isOpenSeaAt,
  terrainHeightSansEdits,
  WATER_LEVEL,
  waterLevel,
  waterLevelAt,
} from '../src/sim/world';

// A custom map may set its own `waterLevel`. Two things then have to follow it,
// and neither did:
//
// 1. WHERE the water is. isOpenSeaAt memoizes sea-ness per 1-yard cell keyed on
//    the seed and the content OBJECT. The editor's slider mutates the active
//    content in place (so terrainHeight/waterLevel see it without a clone), so
//    the key never moved for a level change and every cell kept the bit it got
//    at the old waterline: the surface moved and the world stayed dry.
// 2. WHAT the shore looks like. The beach band is per-vertex work in the
//    terrain mesher, and it read the WATER_LEVEL constant, so a custom map's
//    sand sat at the built-in waterline whatever its own level was.

const SEED = 20061;

const worldAt = (level: number): WorldContent => ({ ...BUILTIN_WORLD, waterLevel: level });

afterEach(() => {
  setActiveWorldContent(null);
});

describe('the active water level moves the sea', () => {
  it('re-decides sea cells when the level changes under the same content object', () => {
    // One mutable content object, exactly as the editor's slider holds it.
    const world = worldAt(WATER_LEVEL);
    setActiveWorldContent(world);
    // A cell whose ground sits between the two levels: dry under the low
    // waterline, submerged under the high one.
    const probe = { x: -540.5, z: 40.5 };
    const ground = terrainHeightSansEdits(probe.x, probe.z, SEED);
    expect(ground).toBeLessThan(WATER_LEVEL);

    world.waterLevel = ground - 2; // drain: ground now stands proud
    expect(waterLevel()).toBe(ground - 2);
    expect(isOpenSeaAt(probe.x, probe.z, SEED)).toBe(false);
    expect(waterLevelAt(probe.x, probe.z, SEED)).toBe(-Infinity);

    world.waterLevel = ground + 2; // flood: the same cell has to turn wet
    expect(isOpenSeaAt(probe.x, probe.z, SEED)).toBe(true);
    expect(waterLevelAt(probe.x, probe.z, SEED)).toBe(ground + 2);
  });

  it('leaves the shipped world untouched', () => {
    setActiveWorldContent(null);
    expect(waterLevel()).toBe(WATER_LEVEL);
  });
});

describe('the active water level moves the beach', () => {
  const COAST = {
    kind: 'chunk',
    id: 1,
    x0: -560,
    z0: 0,
    size: 60,
    spacing: 2,
    seed: SEED,
    withSplat: true,
    skirtSpan: 8,
    lowShade: false,
  } as const;

  /** Total sand weight over the chunk: splat channel 3 is the sandy bank. */
  const sandWeight = (arrays: { splats: Float32Array | null }): number => {
    const splats = arrays.splats;
    expect(splats).not.toBeNull();
    let total = 0;
    for (let i = 3; i < (splats as Float32Array).length; i += 4) {
      total += (splats as Float32Array)[i];
    }
    return total;
  };

  it('paints its sand at the map level, not the built-in constant', () => {
    setActiveWorldContent(worldAt(WATER_LEVEL));
    const atDefault = sandWeight(buildChunkArrays(COAST));
    // This chunk is sea floor around -5.5, so at the shipped level the band is
    // saturated across it. Drop the sea BELOW that floor - the Goldcrest case,
    // where the map asked for -9 - and the bank has to recede with it.
    setActiveWorldContent(worldAt(-7));
    const drained = sandWeight(buildChunkArrays(COAST));
    expect(drained).toBeLessThan(atDefault * 0.9);

    // ...and coming back to the shipped level restores it exactly, so the
    // difference is the level and nothing else.
    setActiveWorldContent(null);
    expect(sandWeight(buildChunkArrays(COAST))).toBeCloseTo(atDefault, 6);
  });
});
