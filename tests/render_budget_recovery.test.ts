import { describe, expect, it } from 'vitest';
import { GFX_BUDGETS } from '../src/render/gfx';
import {
  RenderBudgetGovernor,
  type RenderBudgetLevels,
  type RenderBudgetSample,
  type RenderBudgetState,
} from '../src/render/render_budget';

// Render scale is dropped FIRST under severe frame pressure and sits LAST on the
// recovery ladder, so the ladder's own ratchet can strand it: every above-baseline
// quality rung widens the drawn ring, which grows the same call / triangle / tuft
// counters the recovery gate tests at 90% of target. Once the climb passes that
// line the gate closes, stableSeconds is zeroed every frame, and the resolution
// rung is never reached again. These pins hold the split that fixes it: measured
// headroom gates ALL recovery, the counters gate only the climb above baseline.

// The high tier is the retune-immune arm; tests/render_budget_ultra.test.ts pins
// these caps as literals.
const HIGH_TARGET_CALLS = 620;
const HIGH_TARGET_TRIANGLES = 4_500_000;
const HIGH_TARGET_TUFTS = 6_000;
const HIGH_BASELINE = { grass: 0.88, foliage: 0.9, vfx: 0.92, lighting: 0.9 };
const MIN_RENDER_SCALE = 0.7;

function severeSample(): RenderBudgetSample {
  return {
    dt: 0.5,
    frameMs: 90,
    totalMs: 90,
    submitMs: 16,
    calls: 300,
    triangles: 1_200_000,
    grassVisibleTufts: 1_500,
    grassVisibleChunks: 8,
    activeViews: 25,
    createdViews: 0,
    minRenderScale: MIN_RENDER_SCALE,
    maxRenderScale: 1,
  };
}

// Mimics the real feedback loop: foliage and grass levels scale the drawn ring
// (foliage activeRadius is grassRadius * quality), so richer quality means more
// calls, triangles and tufts from the very same scene. Quality at its band
// baselines lands the counters UNDER the gate's 90% line; quality above baseline
// pushes them into the 90 to 100% band, still strictly under target so no
// degrade reason fires and the frames stay pure headroom.
function counters(
  levels: RenderBudgetLevels,
): Pick<RenderBudgetSample, 'calls' | 'triangles' | 'grassVisibleTufts'> {
  const foliageRatio = 0.6 + (0.35 * (levels.foliage - 0.6)) / 0.4;
  const grassRatio = 0.62 + (0.3 * (levels.grass - 0.6)) / 0.4;
  return {
    calls: Math.round(HIGH_TARGET_CALLS * foliageRatio),
    triangles: Math.round(HIGH_TARGET_TRIANGLES * foliageRatio),
    grassVisibleTufts: Math.round(HIGH_TARGET_TUFTS * grassRatio),
  };
}

function headroomSample(
  counts: Pick<RenderBudgetSample, 'calls' | 'triangles' | 'grassVisibleTufts'>,
): RenderBudgetSample {
  return {
    dt: 0.5,
    frameMs: 10,
    totalMs: 8,
    submitMs: 4,
    ...counts,
    grassVisibleChunks: 8,
    activeViews: 25,
    createdViews: 0,
    minRenderScale: MIN_RENDER_SCALE,
    maxRenderScale: 1,
  };
}

// Low runs the same tier-parameterized ladder against the retuned numbers
// (caps 380 / 1.6M / 3.4k, baselines mediums x 0.95, desktop scale floor 0.65),
// so a low-budget-specific regression cannot hide behind the retune-immune
// high arm. The maxima literals sit strictly under 1.0, which is what lets the
// climb-ceiling arm actually REACH its bound (a bound never reached binds
// nothing: the phase 5 QA probe round stripped the grass phase B ceiling and
// every suite stayed green).
const LOW_BASELINE = { grass: 0.74, foliage: 0.7, vfx: 0.76, lighting: 0.68 };
const LOW_MAXIMA = { grass: 0.86, foliage: 0.82, vfx: 0.86, lighting: 0.78 };
const LOW_MIN_RENDER_SCALE = 0.65;

function lowGovernor(): RenderBudgetGovernor {
  const governor = new RenderBudgetGovernor({
    tier: 'low',
    budget: GFX_BUDGETS.low,
    enabled: true,
  });
  governor.reset(1, LOW_MIN_RENDER_SCALE, 1);
  return governor;
}

function lowSevereSample(): RenderBudgetSample {
  return { ...severeSample(), minRenderScale: LOW_MIN_RENDER_SCALE };
}

function lowHeadroomSample(
  counts: Pick<RenderBudgetSample, 'calls' | 'triangles' | 'grassVisibleTufts'>,
): RenderBudgetSample {
  return { ...headroomSample(counts), minRenderScale: LOW_MIN_RENDER_SCALE };
}

function highGovernor(): RenderBudgetGovernor {
  const governor = new RenderBudgetGovernor({
    tier: 'high',
    budget: GFX_BUDGETS.high,
    enabled: true,
  });
  governor.reset(1, MIN_RENDER_SCALE, 1);
  return governor;
}

/** Severe frame pressure until every governable bucket, resolution included, is floored. */
function floorEverything(governor: RenderBudgetGovernor): RenderBudgetState {
  let state = governor.state();
  for (let i = 0; i < 8; i++) state = governor.update(severeSample());
  return state;
}

/** Full-headroom frames whose counters follow the quality the governor just set. */
function driveHeadroom(
  governor: RenderBudgetGovernor,
  frames: number,
  onFrame?: (state: RenderBudgetState) => void,
): RenderBudgetState {
  let state = governor.state();
  for (let i = 0; i < frames; i++) {
    state = governor.update(headroomSample(counters(state.levels)));
    onFrame?.(state);
  }
  return state;
}

describe('render budget recovery ladder', () => {
  it('restores render scale after the quality climb pushes the counters past the gate', () => {
    const governor = highGovernor();
    const degraded = floorEverything(governor);

    expect(degraded.levels.resolution).toBe(MIN_RENDER_SCALE);
    expect(degraded.levels.grass).toBeLessThan(HIGH_BASELINE.grass);

    const state = driveHeadroom(governor, 260);

    // The counters end in the 90 to 100% band because quality climbed, which is
    // exactly the state that used to freeze the ladder short of this rung.
    const finalCounters = counters(state.levels);
    expect(finalCounters.calls).toBeGreaterThan(HIGH_TARGET_CALLS * 0.9);
    expect(finalCounters.calls).toBeLessThan(HIGH_TARGET_CALLS);
    expect(finalCounters.triangles).toBeLessThan(HIGH_TARGET_TRIANGLES);
    expect(finalCounters.grassVisibleTufts).toBeLessThan(HIGH_TARGET_TUFTS);

    expect(state.levels.resolution).toBe(1);
    expect(state.levels.grass).toBeGreaterThanOrEqual(HIGH_BASELINE.grass);
    expect(state.levels.foliage).toBeGreaterThanOrEqual(HIGH_BASELINE.foliage);
    expect(state.levels.vfx).toBeGreaterThanOrEqual(HIGH_BASELINE.vfx);
    expect(state.levels.lighting).toBeGreaterThanOrEqual(HIGH_BASELINE.lighting);
  });

  it('finishes every bucket back to baseline before the first render scale step', () => {
    const governor = highGovernor();
    floorEverything(governor);

    let previousResolution = governor.state().levels.resolution;
    let atFirstScaleStep: RenderBudgetLevels | null = null;
    driveHeadroom(governor, 260, (state) => {
      if (atFirstScaleStep === null && state.levels.resolution > previousResolution) {
        atFirstScaleStep = { ...state.levels };
      }
      previousResolution = state.levels.resolution;
    });

    expect(atFirstScaleStep).not.toBeNull();
    const levels = atFirstScaleStep as unknown as RenderBudgetLevels;
    expect(levels.resolution).toBeGreaterThan(MIN_RENDER_SCALE);
    expect(levels.grass).toBeGreaterThanOrEqual(HIGH_BASELINE.grass);
    expect(levels.foliage).toBeGreaterThanOrEqual(HIGH_BASELINE.foliage);
    expect(levels.vfx).toBeGreaterThanOrEqual(HIGH_BASELINE.vfx);
    expect(levels.lighting).toBeGreaterThanOrEqual(HIGH_BASELINE.lighting);
  });

  it('returns to baseline and restores render scale in a scene dense from the start', () => {
    const governor = highGovernor();
    floorEverything(governor);

    // Counters parked in the 90 to 100% band from the FIRST recovery frame: a
    // genuinely dense scene, not the ladder's own ratchet. The other repro only
    // crosses the band via the climb, after resolution has already recovered,
    // so it cannot tell a counter-gated phase A from an ungated one. Here the
    // return to baseline and the render scale rung must proceed on measured
    // headroom alone, and the climb above baseline must never start.
    let state = governor.state();
    for (let i = 0; i < 260; i++) {
      state = governor.update(
        headroomSample({ calls: 600, triangles: 4_300_000, grassVisibleTufts: 5_800 }),
      );
    }

    expect(state.levels.resolution).toBe(1);
    expect(state.levels.grass).toBe(HIGH_BASELINE.grass);
    expect(state.levels.foliage).toBe(HIGH_BASELINE.foliage);
    expect(state.levels.vfx).toBe(HIGH_BASELINE.vfx);
    expect(state.levels.lighting).toBe(HIGH_BASELINE.lighting);
  });

  it.each([
    ['calls', { calls: 600, triangles: 2_000_000, grassVisibleTufts: 2_000 }],
    ['triangles', { calls: 300, triangles: 4_300_000, grassVisibleTufts: 2_000 }],
    ['grass tufts', { calls: 300, triangles: 2_000_000, grassVisibleTufts: 5_800 }],
  ] as const)('holds the climb while %s alone sits over the gate line', (_axis, dense) => {
    // Each counter clause must close the enrich gate ON ITS OWN. The dense-scene
    // arm above parks all three counters over the line at once, so deleting any
    // single clause from canEnrich still passes it (the other two keep binding);
    // the phase 5 QA probe round proved the triangles clause could be dropped
    // green. These arms park exactly one counter in the 90 to 100% band of its
    // target and pin that phase A still completes while the climb never starts.
    const governor = highGovernor();
    floorEverything(governor);

    let state = governor.state();
    for (let i = 0; i < 260; i++) {
      state = governor.update(headroomSample(dense));
    }

    expect(state.levels).toEqual({
      grass: HIGH_BASELINE.grass,
      foliage: HIGH_BASELINE.foliage,
      vfx: HIGH_BASELINE.vfx,
      lighting: HIGH_BASELINE.lighting,
      resolution: 1,
    });
  });

  it('permits one enrich step when the counters dip under the line for a single frame', () => {
    const governor = highGovernor();
    floorEverything(governor);

    // Dense scene: phase A completes, the climb never starts, and the stable
    // timer stays charged because density no longer resets it. DELIBERATE: a
    // single frame under the 90% line at a fire slot may take ONE enrich step
    // (the recharge after each fired step bounds the rate; the cooldown is
    // shorter on every tier and never binds); the old behavior demanded a
    // full fresh stable window of low-density frames.
    let state = governor.state();
    for (let i = 0; i < 260; i++) {
      state = governor.update(
        headroomSample({ calls: 600, triangles: 4_300_000, grassVisibleTufts: 5_800 }),
      );
    }
    expect(state.levels.foliage).toBe(HIGH_BASELINE.foliage);

    state = governor.update(
      headroomSample({ calls: 300, triangles: 2_000_000, grassVisibleTufts: 2_000 }),
    );
    expect(state.levels.foliage).toBeGreaterThan(HIGH_BASELINE.foliage);
    const afterDip = { ...state.levels };

    // Back inside the band: the climb must hold again even across another
    // charged window.
    for (let i = 0; i < 60; i++) {
      state = governor.update(
        headroomSample({ calls: 600, triangles: 4_300_000, grassVisibleTufts: 5_800 }),
      );
    }
    expect(state.levels).toEqual(afterDip);
  });

  it('returns to baseline and restores render scale at low tier in a dense scene', () => {
    const governor = lowGovernor();
    let state = governor.state();
    for (let i = 0; i < 12; i++) state = governor.update(lowSevereSample());
    // Floors genuinely reached, so the recovery below cannot be vacuous.
    expect(state.levels.resolution).toBe(LOW_MIN_RENDER_SCALE);
    expect(state.levels.grass).toBe(0.5);

    // Counters parked in low's 90 to 100% band (targets 380 / 1.6M / 3.4k) from
    // the first recovery frame: phase A, resolution included, must proceed on
    // measured headroom alone and the climb above baseline must never start.
    for (let i = 0; i < 300; i++) {
      state = governor.update(
        lowHeadroomSample({ calls: 370, triangles: 1_550_000, grassVisibleTufts: 3_300 }),
      );
    }

    expect(state.levels).toEqual({ ...LOW_BASELINE, resolution: 1 });
  });

  it('climbs to the low band maxima and stops exactly there when the scene stays sparse', () => {
    const governor = lowGovernor();
    let state = governor.state();
    for (let i = 0; i < 12; i++) state = governor.update(lowSevereSample());
    expect(state.levels.grass).toBe(0.5);

    // Sparse counters stay under every 90% line through the whole climb, so the
    // ladder walks phase A and then every phase B rung. The equality reaches
    // each band ceiling for real: a mutant that widens a phase B ceiling
    // overshoots the maxima and reds here.
    for (let i = 0; i < 400; i++) {
      state = governor.update(
        lowHeadroomSample({ calls: 200, triangles: 800_000, grassVisibleTufts: 1_500 }),
      );
    }

    expect(state.levels).toEqual({ ...LOW_MAXIMA, resolution: 1 });
  });

  it('holds the climb above baseline while the counters sit inside the gate band', () => {
    const governor = highGovernor();
    floorEverything(governor);
    const recovered = driveHeadroom(governor, 260).levels;

    // Literals, never the value this same run produced: a comparison against a
    // captured state passes even when the climb runs away, because the captured
    // state runs away with it. Foliage takes the one above-baseline rung the
    // counters still allow, which is what closes the band on the rest.
    expect(recovered).toEqual({
      grass: 0.88,
      foliage: 0.98,
      vfx: 0.92,
      lighting: 0.9,
      resolution: 1,
    });

    // Counters parked between 90% and 100% of target: full headroom, nothing to
    // restore, and no slot left that may fire. The ladder must claim nothing.
    let state = governor.state();
    for (let i = 0; i < 40; i++) {
      state = governor.update(
        headroomSample({
          calls: 600,
          triangles: 4_300_000,
          grassVisibleTufts: 5_800,
        }),
      );
    }

    expect(state.mode).toBe('stable');
    expect(state.levels).toEqual(recovered);
  });
});
