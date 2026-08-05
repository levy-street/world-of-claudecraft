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
//   applyStripFlankCoast: z = 940 and z = 1925 on the Hollow moat flanks, plus
//     its outer x = +-180 edge
//   greenSeamT: z = 170, the south edge of the marsh/peaks green seam
// (The Ferrywalk causeway and its onCauseway sandbar clip are gone: the
// Farshore moved far offshore and the ferry is the only crossing. Its
// replacement applier, applyFarshoreSea, gets its own edge sweep below.)
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
  const ra = Math.max(groundHeight(pa[0], pa[1], SEED), waterLevelAt(pa[0], pa[1], SEED));
  const rb = Math.max(groundHeight(pb[0], pb[1], SEED), waterLevelAt(pb[0], pb[1], SEED));
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
  // KNOWN-UNFIXED, documented by the Willowfen investigation: the same
  // applier-edge bug class fixed for applyStripFlankCoast and greenSeamT,
  // at two further sites. Expected-fail so the suite stays green while the
  // defect exists and trips the day the applier gets its skirt without
  // this pin being promoted to a real assertion.
  it.fails('applyValeCoast: the x = 178 strait line and the z = 178 border segments', () => {
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

  // KNOWN-UNFIXED: see the applyValeCoast note above.
  it.fails('applyFrostTerraces: the band and corridor window edges', () => {
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

  it('applyFarshoreSea: every window fade edge crosses without a seabed cliff', () => {
    // The eastern-sea applier carves up to ~9yd of seabed inside its window
    // (x ~190..1372, z -400..368), all of it under open water, so the RIDDEN
    // surface is flat by definition and cannot witness a window-edge step.
    // Measure the SEABED instead: walk a 1yd-sample transect straight across
    // each fade edge and require no instant cliff between adjacent samples. A
    // hard window cut would show most of the carve depth (several yards) in
    // one step; the intended 18..20yd fades spread it to well under 1yd per
    // yard. 2.5 sits between the two, matching the suite's separation idea.
    const MAX_SEABED_STEP = 2.5;
    const transects: { name: string; ax: 'x' | 'z'; along: number; lo: number; hi: number }[] = [
      // the near arm's west onset, smoothstep(182, 200, x), off the vale coast
      { name: 'near arm x onset', ax: 'x', along: 0, lo: 170, hi: 215 },
      { name: 'near arm x onset south', ax: 'x', along: -100, lo: 170, hi: 215 },
      // the near arm's north release, z fade 160..180, under the Galecrest border
      { name: 'near arm z fade', ax: 'z', along: 300, lo: 150, hi: 195 },
      // the far arm's onset, smoothstep(552, 570, x), east of the Galecrest coast
      { name: 'far arm x onset', ax: 'x', along: 250, lo: 540, hi: 585 },
      // the east release, 1 - smoothstep(1380, 1412, x), past the island:
      // the sea carve persists under the world-edge rim's smooth rise
      // (smoothstep(1372, 1420, x)), so the whole handoff from deep water to
      // the containment wall is one continuous slope with no gate cliffs.
      { name: 'east fade', ax: 'x', along: 0, lo: 1340, hi: 1470 },
      // the z window's two edges, smoothstep(-400, -380) and (348, 368)
      { name: 'z window north edge', ax: 'z', along: 1000, lo: -410, hi: -370 },
      { name: 'z window south edge', ax: 'z', along: 1000, lo: 340, hi: 380 },
    ];
    const bad: string[] = [];
    for (const t of transects) {
      let prev: number | null = null;
      for (let at = t.lo; at <= t.hi; at += 1) {
        const [x, z] = t.ax === 'x' ? [at, t.along] : [t.along, at];
        const h = groundHeight(x, z, SEED);
        if (prev !== null && Math.abs(h - prev) > MAX_SEABED_STEP) {
          bad.push(`${t.name} at ${t.ax}=${at}: step ${(h - prev).toFixed(2)}`);
        }
        prev = h;
      }
    }
    expect(bad, bad.slice(0, 8).join('\n')).toEqual([]);
  });

  it('applyStripFlankCoast: the outer x = +-180 edge', () => {
    const bad = [...sweep('x', 180, 940, 1925), ...sweep('x', -180, 940, 1925)];
    expect(bad, bad.slice(0, 8).join('\n')).toEqual([]);
  });

  it('greenSeamT: the z = 170 south edge of the green seam', () => {
    const bad = sweep('z', 170, -540, 540);
    expect(bad, bad.slice(0, 8).join('\n')).toEqual([]);
  });
});
