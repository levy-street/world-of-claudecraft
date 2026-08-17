import { describe, expect, it } from 'vitest';
import { GFX_BUCKET_BANDS, GFX_BUDGETS } from '../src/render/gfx';
import { RenderBudgetGovernor, type RenderBudgetSample } from '../src/render/render_budget';

function sample(overrides: Partial<RenderBudgetSample> = {}): RenderBudgetSample {
  return {
    dt: 1,
    frameMs: 16,
    totalMs: 16,
    submitMs: 5,
    calls: 150,
    triangles: 250000,
    grassVisibleTufts: 900,
    grassVisibleChunks: 8,
    activeViews: 25,
    createdViews: 0,
    minRenderScale: 0.65,
    maxRenderScale: 1,
    ...overrides,
  };
}

describe('render budget governor', () => {
  it('leaves all scalers at full quality when disabled', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: false,
    });
    governor.reset(1, 0.65, 1);

    const state = governor.update(
      sample({
        frameMs: 80,
        totalMs: 80,
        submitMs: 60,
        calls: 900,
        triangles: 2_000_000,
        grassVisibleTufts: 6_000,
      }),
    );

    expect(state.mode).toBe('disabled');
    expect(state.levels).toEqual({ grass: 1, foliage: 1, vfx: 1, lighting: 1, resolution: 1 });
  });

  it('reduces model foliage before grass for non-urgent draw pressure', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: true,
    });
    governor.reset(1, 0.65, 1);
    governor.update(sample({ dt: 0.6 }));

    const state = governor.update(
      sample({
        frameMs: 20,
        totalMs: 20,
        submitMs: 8,
        // Above low's targetCalls/targetTriangles and below its urgent pair, at the
        // same pressure ratios the old 560/2.2M caps saw (610 calls, 2.35M tris).
        calls: 415,
        triangles: 1_710_000,
        grassVisibleTufts: 2_000,
      }),
    );

    expect(state.mode).toBe('degrading');
    expect(state.reason).toBe('draw');
    expect(state.levels.foliage).toBeLessThan(0.7);
    expect(state.levels.grass).toBe(0.74);
    expect(state.levels.vfx).toBe(0.76);
    expect(state.levels.resolution).toBe(1);
  });

  it('reduces grass when grass density alone is over budget', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: true,
    });
    governor.reset(1, 0.65, 1);
    governor.update(sample({ dt: 0.6 }));

    const state = governor.update(
      sample({
        frameMs: 24,
        totalMs: 24,
        submitMs: 8,
        calls: 180,
        // Above low's targetGrassTufts and below its urgent tuft cap, the same
        // over-target ratio the old 5_600 target saw at 5_900 tufts.
        grassVisibleTufts: 3_600,
        triangles: 500_000,
      }),
    );

    expect(state.mode).toBe('degrading');
    expect(state.reason).toBe('grass');
    expect(state.levels.foliage).toBe(0.7);
    expect(state.levels.grass).toBeLessThan(0.74);
    expect(state.levels.vfx).toBe(0.76);
    expect(state.levels.resolution).toBe(1);
  });

  it('drops resolution on urgent submit pressure', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: true,
    });
    governor.reset(1, 0.65, 1);
    governor.update(sample({ dt: 0.6 }));

    const state = governor.update(
      sample({
        frameMs: 72,
        totalMs: 72,
        submitMs: 55,
        calls: 500,
        triangles: 1_400_000,
        grassVisibleTufts: 3_000,
      }),
    );

    expect(state.mode).toBe('degrading');
    expect(state.levels.foliage).toBeLessThan(0.7);
    expect(state.levels.grass).toBeLessThan(0.74);
    expect(state.levels.lighting).toBeLessThan(0.68);
    expect(state.levels.vfx).toBeLessThan(0.76);
    expect(state.levels.resolution).toBeLessThan(1);
  });

  it('treats 60fps-class low frames as stable headroom', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: true,
    });
    governor.reset(1, 0.65, 1);
    governor.update(sample({ dt: 0.6 }));

    const state = governor.update(
      sample({
        frameMs: 18,
        totalMs: 18,
        submitMs: 7,
        calls: 260,
        triangles: 950_000,
        grassVisibleTufts: 3_300,
      }),
    );

    expect(state.mode).toBe('stable');
    expect(state.levels).toEqual({
      grass: 0.74,
      foliage: 0.7,
      vfx: 0.76,
      lighting: 0.68,
      resolution: 1,
    });
  });

  it('does not degrade when frame cadence is capped but render work is cheap', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: true,
    });
    governor.reset(1, 0.65, 1);
    governor.update(sample({ dt: 0.6 }));

    let state = governor.state();
    for (let i = 0; i < 24; i++) {
      state = governor.update(
        sample({
          dt: 1 / 30,
          frameMs: 33.4,
          totalMs: 8.3,
          submitMs: 4.6,
          calls: 232,
          triangles: 882_236,
          grassVisibleTufts: 2_922,
        }),
      );
    }

    expect(state.externalFrameCap).toBe(true);
    expect(state.mode).toBe('stable');
    expect(state.reason).toBe('frame-cap');
    expect(state.pressure).toBeLessThan(1);
    expect(state.levels).toEqual({
      grass: 0.74,
      foliage: 0.7,
      vfx: 0.76,
      lighting: 0.68,
      resolution: 1,
    });
  });

  it('recovers quality under capped frame cadence when render work has headroom', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: true,
    });
    governor.reset(1, 0.65, 1);
    governor.update(sample({ dt: 0.6 }));

    let state = governor.update(
      sample({
        frameMs: 80,
        totalMs: 80,
        submitMs: 55,
        calls: 600,
        triangles: 1_500_000,
        grassVisibleTufts: 4_000,
      }),
    );
    const degradedGrass = state.levels.grass;

    for (let i = 0; i < 260; i++) {
      state = governor.update(
        sample({
          dt: 1 / 30,
          frameMs: 33.4,
          totalMs: 8.3,
          submitMs: 4.6,
          calls: 232,
          triangles: 882_236,
          grassVisibleTufts: 2_922,
        }),
      );
    }

    expect(state.externalFrameCap).toBe(true);
    expect(state.levels.grass).toBeGreaterThan(degradedGrass);
  });

  it('restores baselines and render scale under a frame cap but never climbs while dense', () => {
    // Long-horizon cap pin (the 24-frame test above never reaches a fire slot,
    // so it cannot distinguish holds-at-baseline from climbs-to-maxima). With
    // counters parked in the 90 to 100% band, a capped session restores every
    // baseline and the render scale (phase A runs on measured headroom alone)
    // and the climb above baseline never starts. This pins the capped arm of
    // the canRecover/canEnrich split in both directions.
    const governor = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: true,
    });
    governor.reset(1, 0.65, 1);
    governor.update(sample({ dt: 0.6 }));

    let state = governor.state();
    for (let i = 0; i < 12; i++) {
      state = governor.update(
        sample({
          dt: 0.5,
          frameMs: 90,
          totalMs: 90,
          submitMs: 16,
          calls: 300,
          triangles: 1_200_000,
          grassVisibleTufts: 1_500,
        }),
      );
    }
    expect(state.levels.resolution).toBe(0.65);
    expect(state.levels.grass).toBe(0.5);

    for (let i = 0; i < 3_600; i++) {
      state = governor.update(
        sample({
          dt: 1 / 30,
          frameMs: 33.4,
          totalMs: 8.3,
          submitMs: 4.6,
          calls: 370,
          triangles: 1_550_000,
          grassVisibleTufts: 3_300,
        }),
      );
    }

    expect(state.externalFrameCap).toBe(true);
    expect(state.levels).toEqual({
      grass: 0.74,
      foliage: 0.7,
      vfx: 0.76,
      lighting: 0.68,
      resolution: 1,
    });
  });

  it('climbs to the band maxima under a frame cap once the counters leave the band', () => {
    // The sparse capped arm: with counters under every 90% line, a capped
    // session may legally climb past baseline to the band maxima (identical to
    // the pre-split behavior; the phase 5 QA governor audit recorded this as
    // the deliberate cap semantics). A future change that holds capped
    // sessions at baseline is a design decision and must rewrite this pin.
    const governor = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: true,
    });
    governor.reset(1, 0.65, 1);
    governor.update(sample({ dt: 0.6 }));

    let state = governor.state();
    for (let i = 0; i < 3_600; i++) {
      state = governor.update(
        sample({
          dt: 1 / 30,
          frameMs: 33.4,
          totalMs: 8.3,
          submitMs: 4.6,
          calls: 232,
          triangles: 882_236,
          grassVisibleTufts: 2_922,
        }),
      );
    }

    expect(state.externalFrameCap).toBe(true);
    expect(state.levels).toEqual({
      grass: 0.86,
      foliage: 0.82,
      vfx: 0.86,
      lighting: 0.78,
      resolution: 1,
    });
  });

  it('keeps high quality stable when fast frames carry premium foliage density', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'high',
      budget: GFX_BUDGETS.high,
      enabled: true,
    });
    governor.reset(1, 0.7, 1);
    governor.update(sample({ dt: 0.6 }));

    const state = governor.update(
      sample({
        frameMs: 8.4,
        totalMs: 8.4,
        submitMs: 2.8,
        calls: 215,
        triangles: 3_950_000,
        grassVisibleTufts: 2_200,
      }),
    );

    expect(state.mode).toBe('stable');
    expect(state.levels).toEqual({
      grass: 0.88,
      foliage: 0.9,
      vfx: 0.92,
      lighting: 0.9,
      resolution: 1,
    });
  });

  it('recovers high buckets toward their baselines before overfilling one bucket', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'high',
      budget: GFX_BUDGETS.high,
      enabled: true,
    });
    governor.reset(1, 0.7, 1);
    governor.update(sample({ dt: 0.6 }));

    let state = governor.update(
      sample({
        frameMs: 16,
        totalMs: 16,
        submitMs: 145,
        calls: 215,
        triangles: 3_950_000,
        grassVisibleTufts: 2_200,
      }),
    );

    expect(state.reason).toBe('submit-stall');
    expect(state.levels.grass).toBeLessThan(0.88);

    for (let i = 0; i < 40; i++) {
      state = governor.update(
        sample({
          dt: 1,
          frameMs: 8.4,
          totalMs: 8.4,
          submitMs: 2.8,
          calls: 215,
          triangles: 3_950_000,
          grassVisibleTufts: 2_200,
        }),
      );
    }

    expect(state.levels.grass).toBeGreaterThanOrEqual(0.88);
    expect(state.levels.vfx).toBeGreaterThanOrEqual(0.92);
    expect(state.levels.lighting).toBeGreaterThanOrEqual(0.9);
    expect(state.levels.foliage).toBeGreaterThanOrEqual(0.9);
  });

  it('holds a separate submit-stall budget even when steady draw pressure is low', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: true,
    });
    governor.reset(1, 0.65, 1);
    governor.update(sample({ dt: 0.6 }));

    let state = governor.update(
      sample({
        frameMs: 16,
        totalMs: 16,
        submitMs: 180,
        calls: 120,
        triangles: 180_000,
        grassVisibleTufts: 800,
      }),
    );

    expect(state.mode).toBe('degrading');
    expect(state.reason).toBe('submit-stall');
    expect(state.stallPressure).toBeGreaterThan(1);
    expect(state.recentSubmitStalls).toBe(1);
    expect(state.lastSubmitStallMs).toBe(180);
    expect(state.stallHoldSeconds).toBeGreaterThan(10);
    expect(state.levels.foliage).toBeLessThan(0.7);
    expect(state.levels.grass).toBeLessThan(0.74);

    state = governor.update(
      sample({
        dt: 1,
        frameMs: 13,
        totalMs: 13,
        submitMs: 4,
        calls: 100,
        triangles: 150_000,
        grassVisibleTufts: 500,
      }),
    );

    expect(state.mode).toBe('degrading');
    expect(state.reason).toBe('submit-stall');
    expect(state.stableSeconds).toBe(0);
  });

  it('does not reduce resolution below the runtime floor', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: true,
    });
    governor.reset(0.7, 0.65, 1);

    let state = governor.update(sample({ dt: 0.6 }));
    for (let i = 0; i < 12; i++) {
      state = governor.update(
        sample({
          dt: 2,
          frameMs: 90,
          totalMs: 90,
          submitMs: 65,
          calls: 900,
          triangles: 2_200_000,
          grassVisibleTufts: 6_500,
        }),
      );
    }

    expect(state.levels.resolution).toBeGreaterThanOrEqual(0.65);
  });

  it('recovers slowly after sustained stable frames', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: true,
    });
    governor.reset(1, 0.65, 1);
    governor.update(sample({ dt: 0.6 }));
    let state = governor.update(
      sample({
        frameMs: 80,
        totalMs: 80,
        submitMs: 55,
        calls: 600,
        triangles: 1_500_000,
        grassVisibleTufts: 4_000,
      }),
    );
    const degradedResolution = state.levels.resolution;

    // Long enough for the ladder to finish every quality bucket back to its
    // baseline and reach the render-scale rung: a >= pin here is satisfied by no
    // recovery at all, which is the state this test is supposed to rule out.
    for (let i = 0; i < 60; i++) {
      state = governor.update(
        sample({
          dt: 1,
          frameMs: 13,
          totalMs: 13,
          submitMs: 4,
          calls: 100,
          triangles: 150_000,
          grassVisibleTufts: 500,
        }),
      );
    }

    expect(state.levels.resolution).toBeGreaterThan(degradedResolution);
    // The band max is the real ceiling (1 was constant-true: low's grass band
    // tops out below it, so nothing reachable could ever fail that bound).
    expect(state.levels.grass).toBeLessThanOrEqual(GFX_BUCKET_BANDS.low.grass.max);
  });
});
