import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fbm2 } from '../src/sim/rng';
import { terraceStep, terrainHeight } from '../src/sim/world';
import { buildTerrainGrid, f64hex, type GridPoint } from './terrain_height_grid';

// terrainHeight skips the rim-crest noise and the terracing when they provably
// contribute exactly zero (the whole open world, where the rim mask is 0 and no
// inter-zone ridge is in range). This is a PURE PERFORMANCE early-out: the
// returned heights must stay bit-for-bit identical, because the heightfield
// feeds gameplay (deep-water/gravity/slope gates, mob movement) and determinism
// across all three hosts. Issue #1620.

type Golden = { points: GridPoint[]; goldenHex: string[] };

const golden: Golden = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/terrain_height_golden.json'), 'utf8'),
);

describe('terrainHeight rim-crest / terrace early-out (issue #1620)', () => {
  it('is bit-identical to the pre-optimization implementation across the whole grid', () => {
    // The golden hexes were captured from the ORIGINAL (unconditional) code path.
    // f64hex compares the full IEEE-754 bit pattern, so a -0/+0 or ULP drift on
    // any single sample fails here.
    let mismatches = 0;
    let firstBad = '';
    for (let i = 0; i < golden.points.length; i++) {
      const [x, z, seed] = golden.points[i];
      const got = f64hex(terrainHeight(x, z, seed));
      if (got !== golden.goldenHex[i]) {
        mismatches++;
        if (!firstBad)
          firstBad = `(${x}, ${z}, seed ${seed}): got ${got} want ${golden.goldenHex[i]}`;
      }
    }
    expect(mismatches, `first mismatch ${firstBad}`).toBe(0);
  });

  it('covers both branch sides: open-world (rim 0) and rim/ridge samples exist', () => {
    // Guard the guard: prove the grid actually exercises rim === 0 AND rim > 0,
    // so the "bit-identical" pin above is not vacuously testing one arm only.
    const points = buildTerrainGrid();
    expect(points).toEqual(golden.points); // fixture and generator agree
    let openWorld = 0; // rim === 0 and no ridge in range: the skipped path
    let rimActive = 0; // rim > 0: the rim-crest path must still run
    let ridgeActive = 0; // near an inter-zone ridge (z within 30 of 180 or 540)
    for (const [x, z] of points) {
      const rim = rimMask(x, z);
      const nearRidge = Math.abs(z - 180) < 30 || Math.abs(z - 540) < 30;
      if (rim === 0 && !nearRidge) openWorld++;
      if (rim > 0) rimActive++;
      if (nearRidge) ridgeActive++;
    }
    expect(openWorld).toBeGreaterThan(100);
    expect(rimActive).toBeGreaterThan(20);
    expect(ridgeActive).toBeGreaterThan(20);
  });

  it('the rim-crest noise term is exactly zero wherever the rim mask is zero', () => {
    // Independently reconstruct the skipped contribution (rim * 55 * rimCrest)
    // and confirm it is +0 across the open world, so the early-out drops nothing.
    // This is the algebraic justification the bit-identity pin relies on.
    for (const [x, z, seed] of buildTerrainGrid()) {
      if (rimMask(x, z) !== 0) continue;
      const rimCrest =
        1 +
        (fbm2(x * 0.025, z * 0.025, seed + 29, 3) - 0.5) * 0.35 +
        (fbm2(x * 0.09, z * 0.09, seed + 37, 2) - 0.5) * 0.15;
      // rim is +0 here; the product is the exact term terrainHeight adds.
      expect(0 * 55 * rimCrest).toBe(0);
      expect(Object.is(0 * 55 * rimCrest, 0)).toBe(true); // +0, never -0
    }
  });

  it('terraceStep(0) is exactly 0, so the terrace block is a no-op at zero rise', () => {
    // The terrace early-out fires when mountainAdd === 0; this pins the reason it
    // is safe (terraceStep(0) === +0 and the blend of a zero rise adds +0).
    expect(terraceStep(0, 6, 0.6, 0.5)).toBe(0);
    expect(Object.is(terraceStep(0, 6, 0.6, 0.5), 0)).toBe(true);
  });
});

// A test-local copy of terrainHeight's rim mask (world.ts). Pinned to the same
// literal edge offsets so it tracks the production onset; only used to classify
// samples into branch arms, never to compute a height.
function rimMask(x: number, z: number): number {
  const WORLD_MAX_X = 180;
  const minZ = -180;
  const maxZ = 900;
  const rimX = smoothstep(WORLD_MAX_X - 30, WORLD_MAX_X - 6, Math.abs(x));
  const rimS = smoothstep(minZ + 30, minZ + 6, z);
  const rimN = smoothstep(maxZ - 30, maxZ - 6, z);
  return Math.max(rimX, rimS, rimN);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
