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

describe('render budget governor: the resolution lever where a step reallocates', () => {
  function flooredUltra(): RenderBudgetGovernor {
    const governor = new RenderBudgetGovernor({
      tier: 'ultra',
      budget: GFX_BUDGETS.ultra,
      enabled: true,
    });
    governor.reset(1, 0.78, 1);
    return governor;
  }

  const ultraTown = (overrides: Partial<RenderBudgetSample> = {}): RenderBudgetSample =>
    sample({
      dt: 1 / 60,
      // Over the triangle and call targets (under the urgent caps) with every
      // density bucket floored: the ultra town shape by construction.
      calls: 1_000,
      triangles: 8_000_000,
      grassVisibleTufts: 7_000,
      minRenderScale: 0.78,
      maxRenderScale: 1,
      resolutionReallocates: true,
      ...overrides,
    });

  const calmField = (overrides: Partial<RenderBudgetSample> = {}): RenderBudgetSample =>
    ultraTown({ calls: 200, triangles: 500_000, grassVisibleTufts: 1_000, ...overrides });

  it('never sheds resolution on draw-count pressure alone, however long it lasts', () => {
    // Fewer pixels do not reduce draws, so the lever must not fire on a strong
    // machine that is merely over the town's draw caps at 100 fps.
    const governor = flooredUltra();
    let state = governor.state();
    for (let frame = 0; frame < 60 * 60; frame++) {
      state = governor.update(ultraTown({ frameMs: 10, totalMs: 9, submitMs: 7 }));
    }
    expect(state.levels.resolution).toBe(1);
  });

  it('ignores a single long frame where a step would reallocate, but not on the region path', () => {
    const spike = (reallocates: boolean) => {
      const governor = flooredUltra();
      for (let frame = 0; frame < 60; frame++) {
        governor.update(calmField({ frameMs: 10, totalMs: 9, submitMs: 7 }));
      }
      // One 90 ms frame: a link or a stream-in, severe on the instantaneous read.
      return governor.update(
        calmField({ frameMs: 90, totalMs: 90, submitMs: 40, resolutionReallocates: reallocates }),
      ).levels.resolution;
    };
    expect(spike(false)).toBeLessThan(1);
    expect(spike(true)).toBe(1);
  });

  it('sheds resolution to the tier floor under sustained frame pressure at the floored ladder', () => {
    const governor = flooredUltra();
    let state = governor.state();
    for (let frame = 0; frame < 60 * 60; frame++) {
      state = governor.update(ultraTown({ frameMs: 36, totalMs: 34, submitMs: 14 }));
    }
    expect(state.levels.resolution).toBe(0.78);
    expect(state.levels.grass).toBe(0.78);
    expect(state.levels.vfx).toBe(0.86);
  });

  it('sheds resolution under sustained submit pressure alone at the floored ladder', () => {
    const governor = flooredUltra();
    let state = governor.state();
    for (let frame = 0; frame < 60 * 60; frame++) {
      state = governor.update(ultraTown({ frameMs: 20, totalMs: 19, submitMs: 19 }));
    }
    expect(state.levels.resolution).toBe(0.78);
  });

  it('reaches resolution only once the ladder has nothing left to shed under sustained cost', () => {
    const governor = flooredUltra();
    let state = governor.state();
    // 40 ms frames on ultra (drop line 30 ms) in a sparse field: severe on the
    // instantaneous read, so VFX sheds a step per cooldown; resolution waits
    // behind that dwell and fires on the first call that changes nothing else.
    let vfxFloorFrame = -1;
    let sheddingFrame = -1;
    for (let frame = 0; frame < 60 * 12; frame++) {
      state = governor.update(calmField({ frameMs: 40, totalMs: 40, submitMs: 12 }));
      if (vfxFloorFrame < 0 && state.levels.vfx <= state.caps.minVfxLevel + 0.001) {
        vfxFloorFrame = frame;
      }
      if (sheddingFrame < 0 && state.levels.resolution < 1) sheddingFrame = frame;
    }
    expect(vfxFloorFrame).toBeGreaterThan(0);
    expect(sheddingFrame).toBeGreaterThan(vfxFloorFrame);
    expect(state.levels.resolution).toBeLessThan(1);
    expect(state.levels.grass).toBe(GFX_BUCKET_BANDS.ultra.grass.baseline);
  });

  it('never reallocates inside a stall hold, whatever the sustained read says between stalls', () => {
    const governor = flooredUltra();
    let state = governor.state();
    for (let frame = 0; frame < 60; frame++) {
      state = governor.update(calmField({ frameMs: 10, totalMs: 9, submitMs: 7 }));
    }
    // A world-entry link storm: one stall, then a second of long frames.
    state = governor.update(calmField({ frameMs: 200, totalMs: 200, submitMs: 190 }));
    expect(state.stallHoldSeconds).toBeGreaterThan(0);
    for (let frame = 0; frame < 60; frame++) {
      state = governor.update(calmField({ frameMs: 70, totalMs: 70, submitMs: 30 }));
    }
    expect(state.frameMsEma).toBeGreaterThan(GFX_BUDGETS.ultra.dropFrameMs);
    expect(state.stallHoldSeconds).toBeGreaterThan(0);
    expect(state.levels.resolution).toBe(1);
    // The hold runs out under sustained cost that is still there: now it counts.
    for (let frame = 0; frame < 60 * 20; frame++) {
      state = governor.update(calmField({ frameMs: 40, totalMs: 40, submitMs: 12 }));
    }
    expect(state.stallHoldSeconds).toBe(0);
    expect(state.levels.resolution).toBeLessThan(1);
  });

  it('never reallocates on a submit-stall frame, whatever the sustained read says', () => {
    const governor = flooredUltra();
    let state = governor.state();
    for (let frame = 0; frame < 60 * 12; frame++) {
      // Every frame a stall (a link inside the frame) with the ladder already
      // floored by the urgent path: the stall path bypasses the cooldown, and
      // the sustained read is far past the line, but no reallocation is bought.
      state = governor.update(
        ultraTown({ frameMs: 130, totalMs: 130, submitMs: 125, calls: 1_150 }),
      );
    }
    expect(state.reason).toBe('submit-stall');
    expect(state.levels.vfx).toBe(state.caps.minVfxLevel);
    expect(state.levels.resolution).toBe(1);
  });

  it('restores render scale first when the scene is over its draw caps, so it is not starved', () => {
    // A strong machine at a town: sustained fragment cost shed resolution
    // (a fight), then the fight ended, but the town is over the draw caps by
    // construction, so every bucket restore is re-shed at the next step. The
    // scale must not wait behind that oscillation.
    const governor = flooredUltra();
    let state = governor.state();
    for (let frame = 0; frame < 60 * 30; frame++) {
      state = governor.update(ultraTown({ frameMs: 36, totalMs: 34, submitMs: 14 }));
    }
    expect(state.levels.resolution).toBe(0.78);
    let firstRestore: 'resolution' | 'bucket' | null = null;
    for (let frame = 0; frame < 60 * 60; frame++) {
      const before = { ...state.levels };
      state = governor.update(ultraTown({ frameMs: 10, totalMs: 9, submitMs: 7 }));
      if (firstRestore === null) {
        if (state.levels.resolution > before.resolution) firstRestore = 'resolution';
        else if (
          state.levels.grass > before.grass ||
          state.levels.foliage > before.foliage ||
          state.levels.vfx > before.vfx ||
          state.levels.lighting > before.lighting
        ) {
          firstRestore = 'bucket';
        }
      }
    }
    expect(firstRestore).toBe('resolution');
    expect(state.levels.resolution).toBe(1);
  });

  it('keeps the bucket-first restore order when the scene is under its draw caps', () => {
    const governor = flooredUltra();
    let state = governor.state();
    for (let frame = 0; frame < 60 * 30; frame++) {
      state = governor.update(calmField({ frameMs: 40, totalMs: 40, submitMs: 12 }));
    }
    expect(state.levels.resolution).toBeLessThan(1);
    expect(state.levels.vfx).toBe(state.caps.minVfxLevel);
    let firstRestore: 'resolution' | 'bucket' | null = null;
    for (let frame = 0; frame < 60 * 60 && firstRestore === null; frame++) {
      const before = { ...state.levels };
      state = governor.update(calmField({ frameMs: 10, totalMs: 9, submitMs: 7 }));
      if (state.levels.resolution > before.resolution) firstRestore = 'resolution';
      else if (state.levels.vfx > before.vfx) firstRestore = 'bucket';
    }
    expect(firstRestore).toBe('bucket');
  });

  it('settles a reallocation under its own cooldown instead of reading it as a stall', () => {
    const governor = flooredUltra();
    const pressured = () => ultraTown({ frameMs: 36, totalMs: 34, submitMs: 14 });
    let state = governor.state();
    // Drive the ladder to the first resolution step.
    let steps = 0;
    while (state.levels.resolution >= 1 && steps < 60 * 60) {
      state = governor.update(pressured());
      steps++;
    }
    expect(state.levels.resolution).toBeLessThan(1);
    expect(state.cooldownSeconds).toBeGreaterThan(0);
    const levelAfterStep = state.levels.resolution;

    // The renderer reallocated on that step; the next sample says so, and the
    // swap back-pressure lands as huge submit readings over the frames after it.
    state = governor.update({ ...pressured(), submitMs: 300, reallocated: true });
    for (let frame = 0; frame < 6; frame++) {
      state = governor.update({ ...pressured(), submitMs: 180 });
    }
    expect(state.recentSubmitStalls).toBe(0);
    expect(state.stallHoldSeconds).toBe(0);
    expect(state.reason).not.toBe('submit-stall');
    // The cooldown still stands, so no second rung was shed on the first one's cost.
    expect(state.levels.resolution).toBe(levelAfterStep);
    expect(state.cooldownSeconds).toBeGreaterThan(0);
  });

  it("never sheds a second rung on the first one's aftershock, even with no cooldown standing", () => {
    // The manual Render Quality path reallocates behind reset()'s short
    // cooldown; a reallocated sample whose swap back-pressure pushes the EMAs
    // past the line is the reallocation's own cost, not fragment cost.
    const governor = flooredUltra();
    let state = governor.state();
    const town = () => ultraTown({ frameMs: 10, totalMs: 9, submitMs: 7, calls: 1_150 });
    for (let frame = 0; frame < 60 * 6; frame++) state = governor.update(town());
    for (let frame = 0; frame < 120 && state.cooldownSeconds > 0; frame++) {
      state = governor.update(town());
    }
    expect(state.cooldownSeconds).toBe(0);
    expect(state.levels.grass).toBe(state.caps.minGrassLevel);
    expect(state.levels.lighting).toBe(state.caps.minLightingLevel);
    state = governor.update({
      ...town(),
      frameMs: 250,
      totalMs: 250,
      submitMs: 250,
      reallocated: true,
    });
    expect(state.frameMsEma).toBeGreaterThan(GFX_BUDGETS.ultra.dropFrameMs * 0.9);
    expect(state.levels.resolution).toBe(1);
    expect(state.recentSubmitStalls).toBe(0);
  });

  it('arms the standard cooldown for a reallocation that arrives with none standing', () => {
    // The window must cover the back-pressure frames, which land two to six
    // frames after the reallocating one, not only the reallocated sample.
    const governor = flooredUltra();
    let state = governor.state();
    const calm = () => calmField({ frameMs: 10, totalMs: 9, submitMs: 5 });
    for (let frame = 0; frame < 60; frame++) state = governor.update(calm());
    expect(state.cooldownSeconds).toBe(0);
    state = governor.update({ ...calm(), reallocated: true });
    // Armed on that update and already ticking down by its dt.
    expect(state.cooldownSeconds).toBeCloseTo(GFX_BUDGETS.ultra.cooldownSeconds - 1 / 60, 2);
    for (let frame = 0; frame < 6; frame++) {
      state = governor.update({ ...calm(), frameMs: 90, totalMs: 90, submitMs: 180 });
    }
    expect(state.recentSubmitStalls).toBe(0);
    expect(state.stallHoldSeconds).toBe(0);
    expect(state.levels.resolution).toBe(1);
  });

  it('closes the settling window with the cooldown, so a real stall after it still counts', () => {
    const governor = flooredUltra();
    const calm = () => calmField({ frameMs: 10, totalMs: 9, submitMs: 5 });
    let state = governor.update({ ...calm(), submitMs: 300, reallocated: true });
    expect(state.recentSubmitStalls).toBe(0);
    // reset() arms a 0.5 s cooldown; run it out.
    for (let frame = 0; frame < 60; frame++) state = governor.update(calm());
    expect(state.cooldownSeconds).toBe(0);
    state = governor.update({ ...calm(), submitMs: 300 });
    expect(state.recentSubmitStalls).toBe(1);
    expect(state.reason).toBe('submit-stall');
  });

  it('keeps the shipped stall path for a stall that carries no reallocation', () => {
    const governor = flooredUltra();
    for (let frame = 0; frame < 60; frame++) {
      governor.update(sample({ dt: 1 / 60, minRenderScale: 0.78, maxRenderScale: 1 }));
    }
    const state = governor.update(
      sample({ dt: 1 / 60, submitMs: 300, minRenderScale: 0.78, maxRenderScale: 1 }),
    );
    expect(state.recentSubmitStalls).toBe(1);
    expect(state.stallHoldSeconds).toBeGreaterThan(0);
  });
});
