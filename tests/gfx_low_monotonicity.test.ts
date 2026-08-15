import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GFX_BUCKET_BANDS, GFX_BUDGETS, gfxInternalsForTest } from '../src/render/gfx';
import { type RenderBudgetCaps, RenderBudgetGovernor } from '../src/render/render_budget';

// Low must never draw more than medium. Every pin below reads BOTH tiers' real
// exported tables (never a literal standing in for one of them), so a future edit
// that walks low back above medium on any axis reds here.

function capsFor(tier: 'low' | 'medium'): RenderBudgetCaps {
  return new RenderBudgetGovernor({
    tier,
    budget: GFX_BUDGETS[tier],
    enabled: true,
  }).state().caps;
}

// Mirrors foliage.ts activeRadius: Math.round(baseRadius * Math.max(minRadiusScale,
// quality) * 10) / 10, where minRadiusScale is lush ? 0.58 : 0.48.
const LEAN_MIN_RADIUS_SCALE = 0.48;
const LUSH_MIN_RADIUS_SCALE = 0.58;

function activeRadius(baseRadius: number, minRadiusScale: number, quality: number): number {
  return Math.round(baseRadius * Math.max(minRadiusScale, quality) * 10) / 10;
}

const GOVERNABLE_BUCKETS = ['grass', 'foliage', 'lighting', 'vfx'] as const;
type BucketId = keyof typeof GFX_BUCKET_BANDS.low;
// Derived from the live table, never enumerated: the phase 5 QA probe round
// raised low's resolution band min above medium's and the old hand-written
// list swept right past it, and a brand-new bucket would have dodged it the
// same way. Everything that is not a governor-ladder bucket takes the
// at-or-under sweep below.
const NON_GOVERNABLE_BUCKETS = (Object.keys(GFX_BUCKET_BANDS.low) as BucketId[]).filter(
  (bucket) => !(GOVERNABLE_BUCKETS as readonly string[]).includes(bucket),
);

describe('low tier stays monotonically lighter than medium', () => {
  const low = gfxInternalsForTest.settingsFor('low');
  const medium = gfxInternalsForTest.settingsFor('medium');
  const lowCaps = capsFor('low');
  const mediumCaps = capsFor('medium');

  it('draws grass over a smaller radius', () => {
    expect(low.grassRadius).toBeLessThan(medium.grassRadius);
  });

  it('keeps a smaller baseline grass ring than medium', () => {
    const lowRing = low.grassRadius * GFX_BUCKET_BANDS.low.grass.baseline;
    const mediumRing = medium.grassRadius * GFX_BUCKET_BANDS.medium.grass.baseline;
    expect(lowRing).toBeLessThan(mediumRing);
  });

  it('keeps a smaller fully degraded grass ring than medium', () => {
    // Low is leanFoliage, medium (unhinted) is lush, so the two tiers floor their
    // radius against different scales; the low floor must still be the smaller ring.
    expect(low.leanFoliage).toBe(true);
    expect(medium.leanFoliage).toBe(false);
    const lowFloor = activeRadius(low.grassRadius, LEAN_MIN_RADIUS_SCALE, lowCaps.minGrassLevel);
    const mediumFloor = activeRadius(
      medium.grassRadius,
      LUSH_MIN_RADIUS_SCALE,
      mediumCaps.minGrassLevel,
    );
    expect(lowFloor).toBeLessThan(mediumFloor);
  });

  it.each(GOVERNABLE_BUCKETS)(
    'starts bucket %s below medium and cannot enrich past it',
    (bucket) => {
      expect(GFX_BUCKET_BANDS.low[bucket].baseline).toBeLessThan(
        GFX_BUCKET_BANDS.medium[bucket].baseline,
      );
      expect(GFX_BUCKET_BANDS.low[bucket].max).toBeLessThan(GFX_BUCKET_BANDS.medium[bucket].max);
    },
  );

  it.each(NON_GOVERNABLE_BUCKETS)(
    'keeps the non-governable bucket %s at or under medium on min, baseline and max',
    (bucket) => {
      // Several of these rows are deliberately equal (weapons, the ui max), so
      // this sweep bounds rather than demands strictness; the point is that NO
      // row, dormant or not, sits above medium.
      expect(GFX_BUCKET_BANDS.low[bucket].min).toBeLessThanOrEqual(
        GFX_BUCKET_BANDS.medium[bucket].min,
      );
      expect(GFX_BUCKET_BANDS.low[bucket].baseline).toBeLessThanOrEqual(
        GFX_BUCKET_BANDS.medium[bucket].baseline,
      );
      expect(GFX_BUCKET_BANDS.low[bucket].max).toBeLessThanOrEqual(
        GFX_BUCKET_BANDS.medium[bucket].max,
      );
    },
  );

  it('keeps the low and medium band tables on the same bucket set', () => {
    // The derived sweep above can only see rows that exist in low's table; this
    // equality closes the remaining dodge (a medium-only or low-only row).
    expect(Object.keys(GFX_BUCKET_BANDS.low).sort()).toEqual(
      Object.keys(GFX_BUCKET_BANDS.medium).sort(),
    );
  });

  it('mirrors the foliage minRadiusScale constants it compares with', () => {
    // The ring comparison above uses copies of foliage.ts's lush/lean floor
    // scales; this pin binds the copies to the one real declaration so a
    // foliage retune cannot silently de-sync them (found by the phase 5 QA).
    const foliageSource = readFileSync(
      new URL('../src/render/foliage.ts', import.meta.url),
      'utf8',
    );
    const declaration = /const minRadiusScale = lush \? ([0-9.]+) : ([0-9.]+);/g;
    const matches = [...foliageSource.matchAll(declaration)];
    expect(matches).toHaveLength(1);
    expect(Number(matches[0][1])).toBe(LUSH_MIN_RADIUS_SCALE);
    expect(Number(matches[0][2])).toBe(LEAN_MIN_RADIUS_SCALE);
  });

  it('lets low shed render scale at least as far as medium on both hosts', () => {
    // The render-scale analog of the quality-floor sweep: the governor's
    // resolution rung floors at these budget values, not at the band row.
    expect(GFX_BUDGETS.low.minRenderScaleDesktop).toBeLessThanOrEqual(
      GFX_BUDGETS.medium.minRenderScaleDesktop,
    );
    expect(GFX_BUDGETS.low.minRenderScaleMobile).toBeLessThanOrEqual(
      GFX_BUDGETS.medium.minRenderScaleMobile,
    );
    expect(GFX_BUDGETS.low.maxRenderScale).toBeLessThanOrEqual(GFX_BUDGETS.medium.maxRenderScale);
  });

  it('pins the retuned low caps as literals', () => {
    // Mediums x 0.9 on per-row clean grains (the derivation recorded in the
    // phase 5 ledger). The inequalities above allow silent drift like 380 to
    // 395; this mirrors the literal pins the ultra suite keeps for high/ultra.
    expect(lowCaps).toEqual({
      targetCalls: 380,
      urgentCalls: 560,
      targetTriangles: 1_600_000,
      urgentTriangles: 2_350_000,
      targetGrassTufts: 3_400,
      urgentGrassTufts: 4_900,
      minGrassLevel: 0.5,
      minFoliageLevel: 0.5,
      minVfxLevel: 0.58,
      minLightingLevel: 0.45,
    });
  });

  it('keeps every render budget cap at or under medium', () => {
    expect(lowCaps.targetCalls).toBeLessThan(mediumCaps.targetCalls);
    expect(lowCaps.urgentCalls).toBeLessThan(mediumCaps.urgentCalls);
    expect(lowCaps.targetTriangles).toBeLessThan(mediumCaps.targetTriangles);
    expect(lowCaps.urgentTriangles).toBeLessThan(mediumCaps.urgentTriangles);
    expect(lowCaps.targetGrassTufts).toBeLessThan(mediumCaps.targetGrassTufts);
    expect(lowCaps.urgentGrassTufts).toBeLessThan(mediumCaps.urgentGrassTufts);
  });

  it('lets low shed at least as far as medium on every quality floor', () => {
    // Equality is the derivation rule (low inherits medium's minima), so these are
    // pinned to medium's live values rather than only bounded by them.
    expect(lowCaps.minGrassLevel).toBe(mediumCaps.minGrassLevel);
    expect(lowCaps.minFoliageLevel).toBe(mediumCaps.minFoliageLevel);
    expect(lowCaps.minVfxLevel).toBe(mediumCaps.minVfxLevel);
    expect(lowCaps.minLightingLevel).toBe(mediumCaps.minLightingLevel);
  });

  it('draws no more point lights at baseline than medium', () => {
    const lowLights = Math.round(low.maxPointLights * GFX_BUCKET_BANDS.low.lighting.baseline);
    const mediumLights = Math.round(
      medium.maxPointLights * GFX_BUCKET_BANDS.medium.lighting.baseline,
    );
    expect(lowLights).toBeLessThanOrEqual(mediumLights);
  });

  it('mirrors each caps floor onto the matching band minimum in both tiers', () => {
    expect(lowCaps.minGrassLevel).toBe(GFX_BUCKET_BANDS.low.grass.min);
    expect(lowCaps.minFoliageLevel).toBe(GFX_BUCKET_BANDS.low.foliage.min);
    expect(lowCaps.minVfxLevel).toBe(GFX_BUCKET_BANDS.low.vfx.min);
    expect(lowCaps.minLightingLevel).toBe(GFX_BUCKET_BANDS.low.lighting.min);
    expect(mediumCaps.minGrassLevel).toBe(GFX_BUCKET_BANDS.medium.grass.min);
    expect(mediumCaps.minFoliageLevel).toBe(GFX_BUCKET_BANDS.medium.foliage.min);
    expect(mediumCaps.minVfxLevel).toBe(GFX_BUCKET_BANDS.medium.vfx.min);
    expect(mediumCaps.minLightingLevel).toBe(GFX_BUCKET_BANDS.medium.lighting.min);
  });

  it('keeps every low band ordered min <= baseline <= max within the unit range', () => {
    for (const bucket of GOVERNABLE_BUCKETS) {
      const band = GFX_BUCKET_BANDS.low[bucket];
      expect(band.min).toBeGreaterThanOrEqual(0);
      expect(band.min).toBeLessThanOrEqual(band.baseline);
      expect(band.baseline).toBeLessThanOrEqual(band.max);
      expect(band.max).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the already lighter low knobs lighter', () => {
    // grassStep is spacing (bigger is fewer tufts) and the far density floor is a
    // fraction of full density; both were already on the light side of medium.
    expect(low.grassStep).toBeGreaterThan(medium.grassStep);
    expect(low.farGrassDensityFloor).toBeLessThan(medium.farGrassDensityFloor);
  });
});
