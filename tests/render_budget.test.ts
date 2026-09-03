import { describe, expect, it } from 'vitest';
import { GFX_BUCKET_BANDS, GFX_BUDGETS } from '../src/render/gfx';
import {
  RenderBudgetGovernor,
  type RenderBudgetSample,
  renderBudgetShaderPrewarmLevels,
} from '../src/render/render_budget';

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
    expect(state.levels).toEqual({
      grass: 1,
      foliage: 1,
      vfx: 1,
      lighting: 1,
      resolution: 1,
      post: 1,
    });
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
      post: 1,
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
      post: 1,
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
      post: 1,
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
      post: 1,
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
      post: 1,
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

describe('render budget governor: the post shed level', () => {
  const FULL_CHAIN = { smaa: true, bloom: true, ao: true } as const;
  // Over every composer tier's drop line on frame cost alone (no submit
  // stall, whose hold would outlive the calm phase below).
  const heavy = () => sample({ dt: 0.5, frameMs: 90, totalMs: 90, submitMs: 12 });
  const calm = () => sample({ dt: 0.5, frameMs: 5, totalMs: 5, submitMs: 2 });

  function governorFor(tier: 'low' | 'medium' | 'high' | 'ultra' | 'insane', extra = {}) {
    const governor = new RenderBudgetGovernor({
      tier,
      budget: GFX_BUDGETS[tier],
      enabled: true,
      postShed: FULL_CHAIN,
      ...extra,
    });
    governor.reset(1, 0.65, 1);
    governor.update(sample({ dt: 1 }));
    return governor;
  }

  it('starts every tier at 1, the full chain', () => {
    for (const tier of ['low', 'medium', 'high', 'ultra', 'insane'] as const) {
      expect(governorFor(tier).state().levels.post).toBe(1);
    }
  });

  it('sheds ONE rung per over-budget step, and only once the density buckets are floored', () => {
    const governor = governorFor('ultra');
    let state = governor.state();
    const seen: number[] = [state.levels.post];
    for (let i = 0; i < 60; i++) {
      state = governor.update(heavy());
      if (seen[seen.length - 1] !== state.levels.post) seen.push(state.levels.post);
    }
    expect(seen).toEqual([1, 0.75, 0.5, 0.25, 0]);
    expect(state.levels.post).toBe(0);
    expect(state.levels.grass).toBe(state.caps.minGrassLevel);
    expect(state.levels.foliage).toBe(state.caps.minFoliageLevel);
    expect(state.levels.lighting).toBe(state.caps.minLightingLevel);
    expect(state.levels.vfx).toBe(state.caps.minVfxLevel);
  });

  it('walks the rungs in the pinned order: 1, 0.75, 0.5, 0.25, 0 and never skips one', () => {
    const governor = governorFor('high');
    let previous = 1;
    for (let i = 0; i < 80; i++) {
      const level = governor.update(heavy()).levels.post;
      expect(previous - level).toBeLessThanOrEqual(0.25 + 1e-9);
      expect(level).toBeLessThanOrEqual(previous);
      previous = level;
    }
    expect(previous).toBe(0);
  });

  it('sheds a rung before the buckets are floored only under SEVERE frame pressure', () => {
    // 1.33x the drop line but not urgent: the severe arm steps post and
    // resolution alongside vfx from the first over-budget step, while the
    // density buckets (keyed to draw pressure) still stand at baseline.
    const governor = governorFor('ultra');
    const severe = () => sample({ dt: 0.5, frameMs: 40, totalMs: 40, submitMs: 4 });
    const state = governor.update(severe());
    expect(state.levels.post).toBe(0.75);
    expect(state.levels.grass).toBe(1);
    expect(state.levels.foliage).toBe(1);
    expect(state.levels.lighting).toBe(1);
  });

  it('under ordinary pressure holds the chain until every density bucket sits at its floor', () => {
    // 1.1x the drop line on frame AND draw pressure, never urgent: the ladder
    // walks foliage, grass, lighting and vfx to their floors first, and only
    // then takes the first post rung.
    const governor = governorFor('ultra');
    const mild = () =>
      sample({ dt: 0.5, frameMs: 33, totalMs: 33, submitMs: 4, calls: 960, triangles: 7_000_000 });
    let state = governor.state();
    let firstShedAt = -1;
    for (let i = 0; i < 400; i++) {
      state = governor.update(mild());
      const bucketsFloored =
        state.levels.grass <= state.caps.minGrassLevel + 0.001 &&
        state.levels.foliage <= state.caps.minFoliageLevel + 0.001 &&
        state.levels.lighting <= state.caps.minLightingLevel + 0.001 &&
        state.levels.vfx <= state.caps.minVfxLevel + 0.001;
      if (!bucketsFloored) expect(state.levels.post, `step ${i}`).toBe(1);
      if (firstShedAt < 0 && state.levels.post < 1) firstShedAt = i;
    }
    expect(firstShedAt).toBeGreaterThan(0);
    expect(state.levels.post).toBe(0);
  });

  it('restores one rung per sustained-calm step, after the density buckets and before resolution', () => {
    const governor = governorFor('high');
    let state = governor.state();
    for (let i = 0; i < 60; i++) state = governor.update(heavy());
    expect(state.levels.post).toBe(0);
    const order: string[] = [];
    let previous = state.levels;
    for (let i = 0; i < 400; i++) {
      state = governor.update(calm());
      for (const key of ['grass', 'lighting', 'vfx', 'foliage', 'post', 'resolution'] as const) {
        if (state.levels[key] > previous[key] && order[order.length - 1] !== key) order.push(key);
      }
      previous = { ...state.levels };
    }
    expect(state.levels.post).toBe(1);
    // Phase A restores the four density buckets, then the post rungs, then
    // render scale; the phase B climb above baseline follows resolution.
    const firstPost = order.indexOf('post');
    expect(firstPost).toBeGreaterThan(0);
    expect([...order.slice(0, firstPost)].sort()).toEqual(['foliage', 'grass', 'lighting', 'vfx']);
    expect(order[firstPost + 1]).toBe('resolution');
  });

  it('holds 1 on the grade-only tiers whose band is not governable, whatever the pressure', () => {
    for (const tier of ['low', 'medium'] as const) {
      const governor = governorFor(tier);
      let state = governor.state();
      for (let i = 0; i < 200; i++) state = governor.update(heavy());
      expect(state.levels.post).toBe(1);
    }
  });

  it('floors at the deepest rung the session OWN chain carries, beside the tier band', () => {
    const smaaOnly = governorFor('high', { postShed: { smaa: true, bloom: false, ao: false } });
    let state = smaaOnly.state();
    for (let i = 0; i < 200; i++) state = smaaOnly.update(heavy());
    expect(state.levels.post).toBe(0.75);

    const bloomAndAo = governorFor('ultra', { postShed: { smaa: false, bloom: true, ao: true } });
    state = bloomAndAo.state();
    for (let i = 0; i < 200; i++) state = bloomAndAo.update(heavy());
    expect(state.levels.post).toBe(0);

    const empty = governorFor('ultra', { postShed: { smaa: false, bloom: false, ao: false } });
    state = empty.state();
    for (let i = 0; i < 200; i++) state = empty.update(heavy());
    expect(state.levels.post).toBe(1);
  });

  it('the ?postshed=off kill switch (a null chain) pins the level at 1 on every tier', () => {
    for (const tier of ['high', 'ultra', 'insane'] as const) {
      const governor = governorFor(tier, { postShed: null });
      let state = governor.state();
      for (let i = 0; i < 200; i++) state = governor.update(heavy());
      expect(state.levels.post).toBe(1);
    }
  });

  it('the ?postshed=<level> pin holds the level exactly, governor on or off, under any pressure', () => {
    const pinnedOn = governorFor('ultra', { pinnedPostLevel: 0.5 });
    let state = pinnedOn.state();
    expect(state.levels.post).toBe(0.5);
    for (let i = 0; i < 200; i++) state = pinnedOn.update(heavy());
    expect(state.levels.post).toBe(0.5);
    for (let i = 0; i < 400; i++) state = pinnedOn.update(calm());
    expect(state.levels.post).toBe(0.5);

    const pinnedOff = new RenderBudgetGovernor({
      tier: 'ultra',
      budget: GFX_BUDGETS.ultra,
      enabled: false,
      postShed: FULL_CHAIN,
      pinnedPostLevel: 0,
    });
    expect(pinnedOff.reset(1, 0.65, 1).levels.post).toBe(0);
    expect(pinnedOff.update(heavy()).levels.post).toBe(0);
  });

  it('a disabled governor without a pin holds 1', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'ultra',
      budget: GFX_BUDGETS.ultra,
      enabled: false,
      postShed: FULL_CHAIN,
    });
    governor.reset(1, 0.65, 1);
    let state = governor.state();
    for (let i = 0; i < 100; i++) state = governor.update(heavy());
    expect(state.levels.post).toBe(1);
  });

  it('the shader prewarm walk leaves the level where it stands: no rung selects a scene program', () => {
    const governor = governorFor('ultra');
    let state = governor.state();
    for (let i = 0; i < 20; i++) state = governor.update(heavy());
    expect(state.levels.post).toBeLessThan(1);
    for (const step of renderBudgetShaderPrewarmLevels(state)) {
      expect(step.post).toBe(state.levels.post);
    }
  });
});
