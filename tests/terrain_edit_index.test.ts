import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import type { HeightStamp, WorldContent } from '../src/sim/types';
import { invalidateTerrainEditIndex, terrainHeight } from '../src/sim/world';

// The edit-layer spatial bucket index (src/sim/world.ts applyEditLayer): the
// determinism contract is that the indexed lookup is BIT-identical (===) to
// the linear scan it replaced, because candidate stamps are iterated in
// ascending original array index so float addition order never changes. The
// reference implementation below is a byte-for-byte copy of the old linear
// scan's math.

const SEED = 1234;

afterEach(() => {
  setActiveWorldContent(null);
  invalidateTerrainEditIndex();
});

// --- reference: the pre-index linear scan, copied verbatim ------------------
function smoothstepRef(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
function lerpRef(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function linearEditLayer(edits: HeightStamp[], x: number, z: number, h0: number): number {
  let h = h0;
  for (const e of edits) {
    if (e.radius <= 0) continue;
    const dx = x - e.x;
    const dz = z - e.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= e.radius) continue;
    const t = d / e.radius;
    const w = e.falloff === 'flat' ? 1 : 1 - smoothstepRef(0, 1, t);
    if (e.mode === 'level') h = lerpRef(h, e.delta, w);
    else h += e.delta * w;
  }
  return h;
}

// Deterministic stamp generator (mulberry32; NEVER Math.random in a sim test).
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStamps(count: number, seed: number): HeightStamp[] {
  const rng = makeRng(seed);
  const stamps: HeightStamp[] = [];
  for (let i = 0; i < count; i++) {
    const stamp: HeightStamp = {
      x: -180 + rng() * 360,
      z: -60 + rng() * 480,
      radius: 0.5 + rng() * 60, // many span multiple 32yd index cells
      delta: -40 + rng() * 80,
      falloff: rng() < 0.5 ? 'smooth' : 'flat',
    };
    if (rng() < 0.3) stamp.mode = 'level';
    stamps.push(stamp);
  }
  // Stamps pinned exactly on 32yd cell borders (the index cell size), both
  // centred on a border and with the rim exactly touching one.
  stamps.push({ x: 64, z: 96, radius: 32, delta: 11, falloff: 'smooth' });
  stamps.push({ x: 48, z: 48, radius: 16, delta: -7, falloff: 'flat', mode: 'level' });
  stamps.push({ x: 0, z: 0, radius: 64, delta: 5, falloff: 'smooth' });
  return stamps;
}

// A grid of sample points covering stamped and empty regions, plus points that
// sit exactly on index-cell borders.
function samplePoints(): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = -176; x <= 176; x += 16.5) {
    for (let z = -56; z <= 400; z += 19.25) pts.push([x, z]);
  }
  // Exact cell-border points and far-outside-all-stamps points.
  pts.push([64, 96], [32, 32], [0, 0], [-32, 64], [96, 96.00000001], [170, 410], [-179, -59]);
  return pts;
}

function content(edits: HeightStamp[]): WorldContent {
  return { ...BUILTIN_WORLD, terrainEdits: edits };
}

const NO_EDITS: WorldContent = { ...BUILTIN_WORLD, terrainEdits: [] };

// Height without the edit layer at (x, z): applyEditLayer is the LAST terrain
// stage, so an empty-edits world yields exactly its input height h0.
function baseHeightAt(x: number, z: number): number {
  setActiveWorldContent(NO_EDITS);
  return terrainHeight(x, z, SEED);
}

describe('terrain edit spatial index', () => {
  it('is bit-identical (===) to the linear scan across a grid of sample points', () => {
    const stamps = makeStamps(300, 99);
    const world = content(stamps);
    const points = samplePoints();
    const bases = points.map(([x, z]) => baseHeightAt(x, z));
    setActiveWorldContent(world);
    for (let i = 0; i < points.length; i++) {
      const [x, z] = points[i];
      const h0 = bases[i];
      const got = terrainHeight(x, z, SEED);
      const want = linearEditLayer(stamps, x, z, h0);
      // Strict equality on purpose: the collision sim and the render mesh
      // sample the same function, so approximate agreement is not enough.
      expect(got === want, `(${x}, ${z}): ${got} !== ${want}`).toBe(true);
    }
  });

  it('is deterministic across repeated queries (cache warm and cold)', () => {
    const stamps = makeStamps(50, 7);
    setActiveWorldContent(content(stamps));
    const cold = samplePoints().map(([x, z]) => terrainHeight(x, z, SEED));
    const warm = samplePoints().map(([x, z]) => terrainHeight(x, z, SEED));
    expect(warm).toEqual(cold);
    invalidateTerrainEditIndex();
    const rebuilt = samplePoints().map(([x, z]) => terrainHeight(x, z, SEED));
    expect(rebuilt).toEqual(cold);
  });

  it('rebuilds automatically when the array length changes (brush stroke push)', () => {
    const stamps = makeStamps(10, 3);
    setActiveWorldContent(content(stamps));
    terrainHeight(0, 0, SEED); // prime the index
    stamps.push({ x: 150, z: 350, radius: 20, delta: 25, falloff: 'flat' });
    const h0 = baseHeightAt(150, 350);
    setActiveWorldContent(content(stamps));
    expect(terrainHeight(150, 350, SEED)).toBe(linearEditLayer(stamps, 150, 350, h0));
  });

  it('invalidateTerrainEditIndex picks up an in-place same-length mutation', () => {
    const stamps = makeStamps(10, 11);
    const world = content(stamps);
    setActiveWorldContent(world);
    terrainHeight(0, 0, SEED); // prime the index on this array reference
    // Splice-style mutation: same array, same length, a stamp moved far away.
    const moved: HeightStamp = { x: 160, z: 380, radius: 15, delta: 30, falloff: 'flat' };
    stamps[4] = moved;
    const h0 = baseHeightAt(160, 380);
    setActiveWorldContent(world);
    const want = linearEditLayer(stamps, 160, 380, h0);
    // The stale index does not know the stamp moved into this cell...
    expect(terrainHeight(160, 380, SEED)).not.toBe(want);
    // ...until the editor invalidates it, as the contract requires.
    invalidateTerrainEditIndex();
    expect(terrainHeight(160, 380, SEED)).toBe(want);
  });

  it('points outside every stamp are untouched by the edit layer', () => {
    const stamps: HeightStamp[] = [{ x: 0, z: 0, radius: 10, delta: 50, falloff: 'flat' }];
    const h0 = baseHeightAt(120, 300);
    setActiveWorldContent(content(stamps));
    expect(terrainHeight(120, 300, SEED)).toBe(h0);
  });
});
