import { describe, expect, it } from 'vitest';
import { POOL_WATER } from '../src/render/drowned_temple/temple_plan_core';
import {
  makeTsunamiFoamPatch,
  makeTsunamiProfileSummary,
  makeTsunamiShape,
  TSUNAMI_CRASH_SECONDS,
  TSUNAMI_DROP_LIFE_MAX,
  TSUNAMI_FOAM_DRIFT,
  TSUNAMI_FOAM_FADE_GLSL,
  TSUNAMI_FOAM_LIFE_MAX,
  TSUNAMI_FOAM_MAX_ALONG,
  TSUNAMI_FOAM_MIDLINE_CLEARANCE,
  TSUNAMI_FOAM_PEAK_ALPHA,
  TSUNAMI_FOAM_SIZE_MAX,
  TSUNAMI_LANDING,
  TSUNAMI_LIP_REACH_FULL,
  TSUNAMI_LOOK,
  TSUNAMI_POOL_WATER_DROP,
  TSUNAMI_PROFILE_POINTS,
  TSUNAMI_SHOULDER_GLSL,
  TSUNAMI_SPRAY_LIFE_MAX,
  TSUNAMI_SURGE_HEIGHT,
  TSUNAMI_SWELL_HEIGHT,
  TSUNAMI_TIERS,
  TSUNAMI_WALL_HEIGHT,
  TSUNAMI_WARN_CURL,
  tsunamiCurl,
  tsunamiFoamAlpha,
  tsunamiFoamPatchInto,
  tsunamiHeight,
  tsunamiProfileInto,
  tsunamiShapeInto,
  tsunamiShoulder,
  tsunamiSprayRatesInto,
  tsunamiTier,
  tsunamiTravel,
  tsunamiWarnProgress,
} from '../src/render/drowned_temple/temple_tsunami_core';
import {
  HYDRA_TUNING,
  inTsunamiPath,
  POOL,
  type TsunamiSide,
  tsunamiHeading,
} from '../src/sim/encounters/drowned_temple/ids';

// The Mere Hydra's Tsunami wave plan (temple_tsunami_core.ts): the curling
// cross-section, the timeline over the heads' bar, the tiers' spray, and the
// lingering foam that must stay on the half the wave swept.

function profile(height: number, curl: number) {
  const out = new Float32Array(TSUNAMI_PROFILE_POINTS * 3);
  const summary = makeTsunamiProfileSummary();
  tsunamiProfileInto(out, height, curl, summary);
  return { out, summary };
}

describe('the breaking wave profile', () => {
  it('scales the crest to exactly the requested height, toe at the origin', () => {
    for (const curl of [0, 0.3, 1]) {
      const { out, summary } = profile(8, curl);
      expect(out[0]).toBe(0);
      expect(out[1]).toBe(0);
      expect(summary.crestY).toBeCloseTo(8, 6);
      let maxY = 0;
      for (let p = 0; p < TSUNAMI_PROFILE_POINTS; p++) maxY = Math.max(maxY, out[p * 3 + 1]);
      expect(maxY).toBeCloseTo(8, 6);
    }
  });

  it('stands as a wall with no overhang while uncurled', () => {
    const { summary } = profile(8, 0);
    // The lip tip is the crest itself, and nothing reaches ahead of the toe.
    expect(summary.tipY).toBeGreaterThan(0.95 * 8);
    expect(summary.reach).toBeLessThan(0.05 * 8);
  });

  it('throws the lip forward past the toe and curls it down when fully curled', () => {
    const { summary } = profile(8, 1);
    expect(summary.reach).toBeGreaterThan(0.5 * 8);
    expect(summary.tipZ).toBeGreaterThan(0);
    // Curled over: the tip hangs well under the crest, and it sits behind the
    // furthest point of the lip (it has turned back under, a barrel).
    expect(summary.tipY).toBeLessThan(0.5 * 8);
    expect(summary.tipZ).toBeLessThan(summary.reach);
  });

  it('overhangs further as the curl grows', () => {
    let prev = -Infinity;
    for (const curl of [0, 0.25, 0.5, 0.75, 1]) {
      const { summary } = profile(8, curl);
      expect(summary.reach).toBeGreaterThan(prev);
      prev = summary.reach;
    }
  });

  it('carries a tangent that turns steadily from the climbing toe over the lip', () => {
    const { out } = profile(8, 1);
    for (let p = 1; p < TSUNAMI_PROFILE_POINTS; p++) {
      expect(out[p * 3 + 2]).toBeLessThan(out[(p - 1) * 3 + 2]);
    }
    // Climbing at the toe, pitched over and down (past straight down) at the tip.
    expect(out[2]).toBeGreaterThan(Math.PI / 2);
    expect(out[(TSUNAMI_PROFILE_POINTS - 1) * 3 + 2]).toBeLessThan(-Math.PI / 2);
  });
});

describe('the wave over the bar', () => {
  it('reads the build off the heads bar for both the first wave and the backwash', () => {
    const roll = HYDRA_TUNING.tsunamiRoll;
    expect(tsunamiWarnProgress(HYDRA_TUNING.tsunamiCast, HYDRA_TUNING.tsunamiCast)).toBe(0);
    expect(tsunamiWarnProgress(roll, HYDRA_TUNING.tsunamiCast)).toBe(1);
    const mid = roll + (HYDRA_TUNING.tsunamiCast - roll) / 2;
    expect(tsunamiWarnProgress(mid, HYDRA_TUNING.tsunamiCast)).toBeCloseTo(0.5, 6);
    // The heroic backwash's shorter bar builds over its own length.
    expect(tsunamiWarnProgress(HYDRA_TUNING.backwashAfter, HYDRA_TUNING.backwashAfter)).toBe(0);
    expect(tsunamiWarnProgress(roll, HYDRA_TUNING.backwashAfter)).toBe(1);
    // Clamped both ways, and a degenerate bar reads as built.
    expect(tsunamiWarnProgress(0, HYDRA_TUNING.tsunamiCast)).toBe(1);
    expect(tsunamiWarnProgress(99, HYDRA_TUNING.tsunamiCast)).toBe(0);
    expect(tsunamiWarnProgress(0, roll)).toBe(1);
  });

  it('builds a swell into a standing wall over the warning, then rears on the roll', () => {
    expect(tsunamiHeight(0, 0)).toBeCloseTo(TSUNAMI_SWELL_HEIGHT, 6);
    expect(tsunamiHeight(1, 0)).toBeCloseTo(TSUNAMI_WALL_HEIGHT, 6);
    expect(tsunamiHeight(1, 1)).toBeCloseTo(TSUNAMI_SURGE_HEIGHT, 6);
    let prev = 0;
    for (let i = 0; i <= 20; i++) {
      const h = tsunamiHeight(i / 20, 0);
      expect(h).toBeGreaterThanOrEqual(prev);
      prev = h;
    }
  });

  it('only feathers its crest during the warning, and curls fully over on the roll', () => {
    for (let i = 0; i <= 10; i++)
      expect(tsunamiCurl(i / 10, 0)).toBeLessThanOrEqual(TSUNAMI_WARN_CURL);
    expect(tsunamiCurl(0.3, 0)).toBe(0);
    expect(tsunamiCurl(1, 0)).toBeCloseTo(TSUNAMI_WARN_CURL, 6);
    expect(tsunamiCurl(1, 1)).toBeCloseTo(1, 6);
    expect(tsunamiCurl(1, 0.5)).toBeGreaterThan(TSUNAMI_WARN_CURL);
  });

  it('holds on the rim while warning and lands its lip on the middle line and a stride beyond', () => {
    expect(tsunamiTravel(0)).toBe(0);
    expect(TSUNAMI_LANDING).toBe(POOL.r + 2);
    // The fully curled lip's reach plus the toe's travel is exactly the landing.
    expect(tsunamiTravel(1) + TSUNAMI_LIP_REACH_FULL).toBeCloseTo(POOL.r + 2, 6);
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const t = tsunamiTravel(i / 20);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
    // It accelerates as it pitches: the second half covers more ground.
    expect(tsunamiTravel(1) - tsunamiTravel(0.5)).toBeGreaterThan(tsunamiTravel(0.5));
  });

  it('fades in, stands, and collapses to nothing over the crash', () => {
    const s = makeTsunamiShape();
    tsunamiShapeInto(s, 0, 0, -1, 0);
    expect(s.alpha).toBe(0);
    tsunamiShapeInto(s, 0.5, 0, -1, 2);
    expect(s.alpha).toBe(1);
    expect(s.collapse).toBe(0);
    tsunamiShapeInto(s, 1, 1, TSUNAMI_CRASH_SECONDS / 2, 5);
    expect(s.alpha).toBeGreaterThan(0);
    expect(s.alpha).toBeLessThan(1);
    expect(s.collapse).toBeCloseTo(0.5, 6);
    tsunamiShapeInto(s, 1, 1, TSUNAMI_CRASH_SECONDS, 5);
    expect(s.alpha).toBe(0);
    expect(s.collapse).toBe(1);
  });

  it('stands fully built on the roll even when first seen late', () => {
    const s = makeTsunamiShape();
    tsunamiShapeInto(s, 0, 0.5, -1, 1);
    expect(s.height).toBeGreaterThanOrEqual(TSUNAMI_WALL_HEIGHT);
    expect(s.travel).toBeCloseTo(tsunamiTravel(0.5), 6);
  });

  it('whitens its lip further the more it curls', () => {
    const s = makeTsunamiShape();
    tsunamiShapeInto(s, 1, 0, -1, 3);
    const warnFoamStart = s.foamStart;
    const warnFoam = s.foam;
    tsunamiShapeInto(s, 1, 1, -1, 4);
    expect(s.foamStart).toBeLessThan(warnFoamStart);
    expect(s.foam).toBeGreaterThan(warnFoam);
  });
});

describe('the shoulders', () => {
  it('keep the middle whole and drop, soften and peel back toward the ends', () => {
    const sh = { height: 0, soft: 0, lag: 0 };
    tsunamiShoulder(0, sh);
    expect(sh).toEqual({ height: 1, soft: 0, lag: 0 });
    tsunamiShoulder(1, sh);
    expect(sh.height).toBeCloseTo(0.22, 6);
    expect(sh.soft).toBe(1);
    expect(sh.lag).toBeGreaterThan(0);
    let prev = 2;
    for (let i = 0; i <= 10; i++) {
      tsunamiShoulder(i / 10, sh);
      expect(sh.height).toBeLessThanOrEqual(prev);
      prev = sh.height;
    }
  });

  it('match their GLSL copy', () => {
    expect(TSUNAMI_SHOULDER_GLSL).toContain('1.0 - 0.7800 * smoothstep(0.5, 1.0, e)');
    expect(TSUNAMI_SHOULDER_GLSL).toContain('return 2.5000 * e * e;');
  });
});

describe('spray by tier', () => {
  it('maps the detail flag to a tier', () => {
    expect(tsunamiTier(true)).toBe('full');
    expect(tsunamiTier(false)).toBe('low');
  });

  it('sheds density on the low tier, never zeroing a layer the full tier draws', () => {
    const full = TSUNAMI_TIERS.full;
    const low = TSUNAMI_TIERS.low;
    for (const key of Object.keys(full) as (keyof typeof full)[]) {
      expect(low[key]).toBeGreaterThan(0);
      expect(low[key]).toBeLessThan(full[key]);
    }
  });

  it('blows spindrift only once the crest feathers, and throws the lip only on the roll', () => {
    const r = { spindrift: 0, lip: 0, churn: 0 };
    tsunamiSprayRatesInto(r, 'full', 0.3, 0);
    expect(r.spindrift).toBe(0);
    expect(r.lip).toBe(0);
    tsunamiSprayRatesInto(r, 'full', 1, 0);
    expect(r.spindrift).toBeGreaterThan(0);
    expect(r.lip).toBe(0);
    tsunamiSprayRatesInto(r, 'full', 1, 1);
    expect(r.spindrift).toBe(TSUNAMI_TIERS.full.spindrift);
    expect(r.lip).toBe(TSUNAMI_TIERS.full.lip);
    expect(r.churn).toBe(TSUNAMI_TIERS.full.churn);
    const low = { spindrift: 0, lip: 0, churn: 0 };
    tsunamiSprayRatesInto(low, 'low', 1, 1);
    expect(low.spindrift).toBeLessThan(r.spindrift);
    expect(low.lip).toBeLessThan(r.lip);
  });

  it('sizes every pool for its worst case, so no live particle is ever recycled', () => {
    for (const tier of ['full', 'low'] as const) {
      const p = TSUNAMI_TIERS[tier];
      // Puffs: spindrift and churn at their peak for a whole puff life, plus the crash plume.
      expect(p.sprayCapacity).toBeGreaterThanOrEqual(
        Math.ceil((p.spindrift + p.churn) * TSUNAMI_SPRAY_LIFE_MAX) + p.crashSpray,
      );
      expect(p.dropCapacity).toBeGreaterThanOrEqual(
        Math.ceil(p.lip * TSUNAMI_DROP_LIFE_MAX) + p.crashDrops,
      );
      // Foam: two waves' worth (the heroic backwash lands inside the first
      // wave's foam life).
      expect(HYDRA_TUNING.backwashAfter).toBeLessThan(TSUNAMI_FOAM_LIFE_MAX);
      expect(p.foamCapacity).toBeGreaterThanOrEqual(2 * (p.foamRoll + p.foamCrash));
    }
  });
});

describe('the lingering foam', () => {
  function world(side: TsunamiSide, along: number, across: number) {
    const heading = tsunamiHeading(side);
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const rimX = POOL.x + (side === 'east' ? POOL.r : -POOL.r);
    return { x: rimX + fx * along + fz * across, z: POOL.z + fz * along - fx * across, fx };
  }

  it('lies wholly inside the swept half, its size and drift included', () => {
    const patch = makeTsunamiFoamPatch();
    const draws = [0, 0.01, 0.2, 0.5, 0.8, 0.99, 1];
    const bands: [number, number][] = [
      [-10, 0],
      [-5, 3],
      [5, 12],
      [18, 40],
      [TSUNAMI_FOAM_MAX_ALONG, 60],
    ];
    let checked = 0;
    for (const side of ['east', 'west'] as const) {
      for (const [lo, hi] of bands) {
        for (const u1 of draws) {
          for (const u2 of draws) {
            for (const u3 of [0, 0.5, 1]) {
              tsunamiFoamPatchInto(patch, u1, u2, u3, lo, hi);
              const radius = patch.size / 2;
              // Short of the middle line, drifted to the full and at full size.
              expect(patch.along + radius + TSUNAMI_FOAM_DRIFT).toBeLessThanOrEqual(
                POOL.r - TSUNAMI_FOAM_MIDLINE_CLEARANCE + 1e-9,
              );
              expect(patch.along - radius).toBeGreaterThan(0);
              // Inside the rim circle.
              const w = world(side, patch.along, patch.across);
              const far = world(side, patch.along + TSUNAMI_FOAM_DRIFT, patch.across);
              expect(Math.hypot(w.x - POOL.x, w.z - POOL.z) + radius).toBeLessThanOrEqual(
                POOL.r + 1e-9,
              );
              // The drifted patch's edge nearest the middle line stays on its
              // own half, clear of the line (the other half is the backwash's).
              const edge = far.x + far.fx * radius;
              if (side === 'east') {
                expect(edge).toBeGreaterThanOrEqual(POOL.x + TSUNAMI_FOAM_MIDLINE_CLEARANCE - 1e-9);
              } else {
                expect(edge).toBeLessThanOrEqual(POOL.x - TSUNAMI_FOAM_MIDLINE_CLEARANCE + 1e-9);
              }
              expect(inTsunamiPath(side, w.x, w.z)).toBe(true);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBe(2 * bands.length * draws.length * draws.length * 3);
  });

  it('places patches in the band it is asked for when the band is valid', () => {
    const patch = makeTsunamiFoamPatch();
    tsunamiFoamPatchInto(patch, 0, 0.5, 0.5, 10, 14);
    expect(patch.along).toBeCloseTo(10, 6);
    tsunamiFoamPatchInto(patch, 1, 0.5, 0.5, 10, 14);
    expect(patch.along).toBeCloseTo(14, 6);
    expect(patch.across).toBeCloseTo(0, 6);
  });

  it('floats on the moon pool only when the whole patch is over its water', () => {
    const patch = makeTsunamiFoamPatch();
    // On the pool's axis, deep in: the middle of the moon pool.
    tsunamiFoamPatchInto(patch, 0.5, 0.5, 0, POOL.r - 4, POOL.r - 4);
    expect(patch.onWater).toBe(true);
    // Near the rim: the flagstones.
    tsunamiFoamPatchInto(patch, 0.5, 0.5, 0, 3, 3);
    expect(patch.onWater).toBe(false);
    // The water sits a hand under the rim floor.
    expect(TSUNAMI_POOL_WATER_DROP).toBeCloseTo(POOL.h - POOL_WATER.y, 9);
    expect(TSUNAMI_POOL_WATER_DROP).toBeGreaterThan(0);
  });

  it('settles quickly, thins away over its life, and stays a faint trace', () => {
    expect(tsunamiFoamAlpha(0)).toBe(0);
    expect(tsunamiFoamAlpha(1)).toBe(0);
    expect(TSUNAMI_FOAM_PEAK_ALPHA).toBeLessThanOrEqual(0.3);
    let peak = 0;
    let peakAt = 0;
    for (let i = 0; i <= 200; i++) {
      const a = tsunamiFoamAlpha(i / 200);
      expect(a).toBeLessThanOrEqual(TSUNAMI_FOAM_PEAK_ALPHA + 1e-9);
      if (a > peak) {
        peak = a;
        peakAt = i / 200;
      }
    }
    expect(peakAt).toBeLessThanOrEqual(0.1);
    // Non-increasing after the settle: it only ever thins.
    let prev = Infinity;
    for (let i = Math.ceil(peakAt * 200); i <= 200; i++) {
      const a = tsunamiFoamAlpha(i / 200);
      expect(a).toBeLessThanOrEqual(prev + 1e-12);
      prev = a;
    }
    // It lingers: still visible a third of the way through.
    expect(tsunamiFoamAlpha(0.35)).toBeGreaterThan(0.4 * TSUNAMI_FOAM_PEAK_ALPHA);
    // The GLSL copy carries the same constants.
    expect(TSUNAMI_FOAM_FADE_GLSL).toContain(`return ${TSUNAMI_FOAM_PEAK_ALPHA.toFixed(4)}`);
    expect(TSUNAMI_FOAM_FADE_GLSL).toContain('smoothstep(0.0, 0.0800, t)');
  });

  it('fits the patch size the placement assumes', () => {
    expect(TSUNAMI_FOAM_MAX_ALONG).toBeCloseTo(
      POOL.r - TSUNAMI_FOAM_MIDLINE_CLEARANCE - TSUNAMI_FOAM_SIZE_MAX / 2 - TSUNAMI_FOAM_DRIFT,
      9,
    );
  });
});

describe('the look never out-glows the telegraph', () => {
  it('caps every colour well under the bloom threshold, foam included', () => {
    const colours = [
      TSUNAMI_LOOK.deep,
      TSUNAMI_LOOK.body,
      TSUNAMI_LOOK.crest,
      TSUNAMI_LOOK.sky,
      TSUNAMI_LOOK.foam,
      TSUNAMI_LOOK.spray,
      TSUNAMI_LOOK.floorFoam,
    ];
    // post.ts BLOOM_THRESHOLD is 1.32 (linear); the cap sits far below it.
    expect(TSUNAMI_LOOK.maxChannel).toBeLessThanOrEqual(0.9);
    for (const c of colours)
      for (const ch of c) expect(ch).toBeLessThanOrEqual(TSUNAMI_LOOK.maxChannel);
    // The droplets ride the Crypt kit's glow sprite, which lifts its core 1.8x.
    for (const ch of TSUNAMI_LOOK.drop)
      expect(ch * 1.8).toBeLessThanOrEqual(TSUNAMI_LOOK.maxChannel);
  });

  it('keeps the foam cool, never the warm red-orange of the telegraph', () => {
    for (const c of [TSUNAMI_LOOK.foam, TSUNAMI_LOOK.floorFoam, TSUNAMI_LOOK.spray]) {
      expect(c[2]).toBeGreaterThan(c[0]);
    }
  });
});
