import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import {
  applyEditLayer,
  inAuthoredHeightStamp,
  invalidateTerrainEditIndex,
} from '../src/sim/terrain_edit_layer';
import { noiseStampWeight } from '../src/sim/terrain_noise_brush';
import type { HeightStamp, WorldContent } from '../src/sim/types';
import * as world from '../src/sim/world';

// The custom-map edit layer (src/sim/terrain_edit_layer.ts), moved out of
// world.ts. Imported DIRECTLY: each stamp mode against an independent
// reference of the per-stamp math (bit-exact, ===), the indexed lookup against
// the linear fallback, the in-place invalidation contract, and the
// inAuthoredHeightStamp reach query. tests/terrain_edit_index.test.ts covers
// the same layer end to end through terrainHeight.

afterEach(() => {
  setActiveWorldContent(null);
  invalidateTerrainEditIndex();
});

function useEdits(terrainEdits: HeightStamp[]): void {
  setActiveWorldContent({ ...BUILTIN_WORLD, terrainEdits } as WorldContent);
}

function smoothstepRef(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function stampRef(e: HeightStamp, x: number, z: number, h: number): number {
  if (e.radius <= 0) return h;
  const dx = x - e.x;
  const dz = z - e.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= e.radius) return h;
  const t = d / e.radius;
  const w = e.falloff === 'flat' ? 1 : 1 - smoothstepRef(0, 1, t);
  if (e.mode === 'level') {
    const target =
      e.gx !== undefined || e.gz !== undefined
        ? e.delta + (e.gx ?? 0) * dx + (e.gz ?? 0) * dz
        : e.delta;
    const k = w * (e.strength ?? 1);
    return h + (target - h) * k;
  }
  return h + e.delta * (e.noiseSize === undefined ? w : noiseStampWeight(e, x, z, t));
}

function refLayer(edits: HeightStamp[], x: number, z: number, h0: number): number {
  let h = h0;
  for (const e of edits) h = stampRef(e, x, z, h);
  return h;
}

const STAMPS: HeightStamp[] = [
  { x: 10, z: 10, radius: 12, delta: 3.5, falloff: 'smooth', mode: 'add' },
  { x: 14, z: 6, radius: 9, delta: -1.25, falloff: 'flat', mode: 'add' },
  { x: 8, z: 12, radius: 15, delta: 2, falloff: 'smooth', mode: 'level', strength: 0.6 },
  { x: 40, z: -20, radius: 20, delta: 1, falloff: 'smooth', mode: 'level', gx: 0.1, gz: -0.05 },
  {
    x: 70,
    z: 70,
    radius: 18,
    delta: 2.5,
    falloff: 'smooth',
    mode: 'add',
    noiseSize: 6,
    noiseRough: 0.5,
    noiseSeed: 77,
  },
];

const PROBES: [number, number, number][] = [
  [10, 10, 0],
  [13.3, 7.7, -2.5],
  [2, 18, 4.125],
  [45, -18, 0.75],
  [71.5, 66.25, 1],
  [33, 33, 2],
  [-500, 900, 7],
];

describe('applyEditLayer', () => {
  it('is the identity with no terrainEdits (the built-in world)', () => {
    for (const [x, z, h] of PROBES) expect(applyEditLayer(x, z, h)).toBe(h);
  });

  it('matches the reference per-stamp math bit for bit, every mode', () => {
    useEdits(STAMPS);
    for (const [x, z, h] of PROBES) {
      expect(applyEditLayer(x, z, h), `${x},${z}`).toBe(refLayer(STAMPS, x, z, h));
    }
    // and actually moves the ground inside the stamps
    expect(applyEditLayer(10, 10, 0)).not.toBe(0);
  });

  it('the linear fallback (an unbucketable stamp) gives the indexed answer', () => {
    useEdits(STAMPS);
    const indexed = PROBES.map(([x, z, h]) => applyEditLayer(x, z, h));
    // A non-finite stamp at the END forces the linear scan; it contributes 0
    // at every probe (Infinity radius, zero delta, add mode).
    const hostile: HeightStamp = {
      x: 0,
      z: 0,
      radius: Number.POSITIVE_INFINITY,
      delta: 0,
      falloff: 'flat',
      mode: 'add',
    };
    invalidateTerrainEditIndex();
    useEdits([...STAMPS, hostile]);
    const linear = PROBES.map(([x, z, h]) => applyEditLayer(x, z, h));
    expect(linear).toEqual(indexed);
  });

  it('invalidateTerrainEditIndex picks up a same-length in-place mutation', () => {
    const edits: HeightStamp[] = [
      { x: 0, z: 0, radius: 10, delta: 2, falloff: 'flat', mode: 'add' },
    ];
    useEdits(edits);
    expect(applyEditLayer(0, 0, 0)).toBe(2);
    edits[0] = { x: 200, z: 200, radius: 10, delta: 5, falloff: 'flat', mode: 'add' };
    invalidateTerrainEditIndex();
    expect(applyEditLayer(0, 0, 0)).toBe(0);
    expect(applyEditLayer(200, 200, 0)).toBe(5);
  });
});

describe('inAuthoredHeightStamp', () => {
  it('is false with no terrainEdits', () => {
    expect(inAuthoredHeightStamp(10, 10)).toBe(false);
  });

  it('is true strictly inside a stamp radius, on both lookup paths', () => {
    const stamp: HeightStamp = { x: 50, z: 50, radius: 10, delta: 1, falloff: 'flat', mode: 'add' };
    useEdits([stamp]);
    expect(inAuthoredHeightStamp(50, 50)).toBe(true);
    expect(inAuthoredHeightStamp(59.9, 50)).toBe(true);
    expect(inAuthoredHeightStamp(60, 50)).toBe(false);
    expect(inAuthoredHeightStamp(0, 0)).toBe(false);
    const hostile: HeightStamp = {
      x: Number.NaN,
      z: 0,
      radius: 1,
      delta: 0,
      falloff: 'flat',
      mode: 'add',
    };
    useEdits([stamp, hostile]);
    expect(inAuthoredHeightStamp(50, 50)).toBe(true);
    expect(inAuthoredHeightStamp(0, 0)).toBe(false);
  });
});

describe('world.ts re-exports', () => {
  it('the public names are the same function objects', () => {
    expect(world.invalidateTerrainEditIndex).toBe(invalidateTerrainEditIndex);
    expect(world.inAuthoredHeightStamp).toBe(inAuthoredHeightStamp);
  });
});
