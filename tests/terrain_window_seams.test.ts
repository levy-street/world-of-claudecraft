// Terrain applier window seams: several shaping appliers used to cut off at a
// hard coordinate window while their contribution was still large, leaving an
// instant cliff along the whole window edge (the same bug class as the border
// ridge 3 sigma cutoff, tests/border_ridge_skirt.test.ts). A world scan for
// height steps that survive a 0.04yd gap found these lines in playable areas:
//   applyValeCoast: x = 178 (a wall standing in the Farshore strait) and
//     z = 178 segments near the marsh border corners
//   applyStarterMoat: z = 150 and x = 194 (strait carve window), x = 184
//     (the north channel's west end wall)
//   applyFrostTerraces: z = 1460 across southern Frostveil, z = 1856 and
//     z = 1924 and x = +-92 (the crossing corridor rect), x = +-178
//   applyStripFlankCoast: z = 940 and z = 1925 on the Hollow moat flanks
//   onCauseway: x = 140 clipping the sandbar lift mid slope
// Each test measures the rise of the RIDDEN surface (water clamps a seabed
// step) across a 0.04yd gap straight over the line: a true discontinuity
// shows nearly its full height there, while even the steepest intended slope
// (massif flanks, terrace risers) contributes only ~gradient * 0.04. The
// bound sits between the pre-fix cliffs (0.5 to several yards) and intended
// terrain, the same separation tests/border_ridge_skirt.test.ts uses.

import { describe, expect, it } from 'vitest';
import { groundHeight, waterLevelAt } from '../src/sim/world';

// The production seed: these are seed-pinned world geometry regressions.
const SEED = 20061;
const GAP = 0.04;
const MAX_STEP = 0.35; // yards of ridden rise across the gap

function rideStep(ax: 'x' | 'z', at: number, along: number): number {
  const pa: [number, number] = ax === 'x' ? [at - GAP / 2, along] : [along, at - GAP / 2];
  const pb: [number, number] = ax === 'x' ? [at + GAP / 2, along] : [along, at + GAP / 2];
  const ra = Math.max(groundHeight(pa[0], pa[1], SEED), waterLevelAt(pa[0], pa[1]));
  const rb = Math.max(groundHeight(pb[0], pb[1], SEED), waterLevelAt(pb[0], pb[1]));
  return Math.abs(rb - ra);
}

function sweep(ax: 'x' | 'z', at: number, lo: number, hi: number): string[] {
  const bad: string[] = [];
  for (let along = lo; along <= hi; along += 2) {
    const s = rideStep(ax, at, along);
    if (s > MAX_STEP) bad.push(`${ax}=${at} along ${along}: step ${s.toFixed(2)}`);
  }
  return bad;
}

describe('terrain applier windows end without a blocking step', () => {
  it('applyValeCoast: the x = 178 strait line and the z = 178 border segments', () => {
    const bad = [...sweep('x', 178, -180, 160), ...sweep('z', 178, -160, 160)];
    expect(bad, bad.slice(0, 8).join('\n')).toEqual([]);
  });

  it('applyStarterMoat: the z = 150, x = 184, and x = 194 window edges', () => {
    const bad = [
      ...sweep('z', 150, 176, 200),
      ...sweep('x', 184, 150, 210),
      ...sweep('x', 194, -180, 150),
    ];
    expect(bad, bad.slice(0, 8).join('\n')).toEqual([]);
  });

  it('applyFrostTerraces: the band and corridor window edges', () => {
    const bad = [
      ...sweep('z', 1460, -176, 176),
      ...sweep('z', 1856, -176, 176),
      ...sweep('z', 1924, -176, 176),
      ...sweep('x', 92, 1858, 1922),
      ...sweep('x', -92, 1858, 1922),
      ...sweep('x', 178, 1462, 1958),
      ...sweep('x', -178, 1462, 1958),
    ];
    expect(bad, bad.slice(0, 8).join('\n')).toEqual([]);
  });

  it('applyStripFlankCoast: the z = 940 and z = 1925 window edges', () => {
    const bad = [
      ...sweep('z', 940, 130, 180),
      ...sweep('z', 940, -180, -130),
      ...sweep('z', 1925, 130, 180),
      ...sweep('z', 1925, -180, -130),
    ];
    expect(bad, bad.slice(0, 8).join('\n')).toEqual([]);
  });

  it('applyCauseway: the onCauseway rect no longer clips the sandbar lift', () => {
    const bad = sweep('x', 140, -62, 42);
    expect(bad, bad.slice(0, 8).join('\n')).toEqual([]);
  });
});
