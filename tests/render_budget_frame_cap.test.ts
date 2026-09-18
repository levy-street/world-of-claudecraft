import { describe, expect, it } from 'vitest';
import { GFX_BUDGETS } from '../src/render/gfx';
import {
  RenderBudgetGovernor,
  type RenderBudgetLevels,
  type RenderBudgetSample,
  type RenderBudgetState,
} from '../src/render/render_budget';

// The external-frame-cap heuristic (render_budget.ts) reads CPU-side numbers
// only, so a GPU-bound frame stepping at 33.4 ms under vsync with 9 ms of
// main-thread work looks exactly like a 30 Hz display cap. The governor must
// spend its ladder before it believes the cap: it probes (sheds everything it
// owns, dwells, restores, dwells) and believes the cap only when shedding did
// not move the cadence.

const LOW_BASELINE: RenderBudgetLevels = {
  grass: 0.74,
  foliage: 0.7,
  vfx: 0.76,
  lighting: 0.68,
  resolution: 1,
  detail: 1,
  post: 1,
};

const LOW_FLOORS = { grass: 0.5, foliage: 0.5, vfx: 0.58, lighting: 0.45 };

function sample(overrides: Partial<RenderBudgetSample> = {}): RenderBudgetSample {
  return {
    dt: 1 / 30,
    frameMs: 33.4,
    totalMs: 9,
    submitMs: 5,
    calls: 220,
    triangles: 1_540_000,
    grassVisibleTufts: 2_600,
    grassVisibleChunks: 8,
    activeViews: 25,
    createdViews: 0,
    minRenderScale: 1,
    maxRenderScale: 1,
    ...overrides,
  };
}

function lowGovernor(minRenderScale = 1): RenderBudgetGovernor {
  const governor = new RenderBudgetGovernor({
    tier: 'low',
    budget: GFX_BUDGETS.low,
    enabled: true,
  });
  // The direct (no composer) low path passes [effective, effective] as the
  // resolution range, so the resolution rung is inert there by design; the
  // composer tiers pass the real range.
  governor.reset(1, minRenderScale, 1);
  governor.update(sample({ dt: 0.6, frameMs: 16, totalMs: 16, minRenderScale }));
  return governor;
}

function ultraGovernor(): RenderBudgetGovernor {
  const governor = new RenderBudgetGovernor({
    tier: 'ultra',
    budget: GFX_BUDGETS.ultra,
    enabled: true,
  });
  governor.reset(1, 1, 1);
  governor.update(sample({ dt: 0.6, frameMs: 16, totalMs: 16 }));
  return governor;
}

interface Run {
  state: RenderBudgetState;
  /** Lowest level each bucket reached over the run. */
  min: RenderBudgetLevels;
  /** Simulated second at which the cap was first asserted, or -1. */
  capAtS: number;
  /** Simulated second of the last frame in 'degrading' mode before the cap. */
  lastShedBeforeCapS: number;
}

function run(
  governor: RenderBudgetGovernor,
  seconds: number,
  frame: (state: RenderBudgetState) => Partial<RenderBudgetSample>,
): Run {
  let state = governor.state();
  const min = { ...state.levels };
  let capAtS = -1;
  let lastShedBeforeCapS = -1;
  const frames = Math.round(seconds * 30);
  for (let i = 0; i < frames; i++) {
    state = governor.update(sample(frame(state)));
    const t = (i + 1) / 30;
    for (const key of Object.keys(min) as (keyof RenderBudgetLevels)[]) {
      min[key] = Math.min(min[key], state.levels[key]);
    }
    if (state.mode === 'degrading' && capAtS < 0) lastShedBeforeCapS = t;
    if (state.externalFrameCap && capAtS < 0) capAtS = t;
  }
  return { state, min, capAtS, lastShedBeforeCapS };
}

describe('render budget governor: external frame cap versus a GPU-bound frame', () => {
  it('sheds a steady over-budget cadence with CPU headroom before reading it as a cap', () => {
    // The iGPU campaign's Eastbrook numbers on the HD 530: a steady 33.4 ms
    // rAF interval, 9 ms of renderer main-thread time, draw counters under
    // every cap. Before the fix this read 'frame-cap' from the first frames
    // on and never shed a bucket.
    const { state } = run(lowGovernor(), 0.8, () => ({}));

    expect(state.externalFrameCap).toBe(false);
    expect(state.reason).not.toBe('frame-cap');
    expect(state.levels.vfx).toBeLessThan(LOW_BASELINE.vfx);
  });

  it('believes a cap only after every rung was spent and the cadence did not move', () => {
    // A real 30 fps cap (a throttled tab, a 30 Hz panel) looks the same from
    // the CPU side. The probe sheds EVERY bucket to its floor, dwells, and
    // restores the levels it started from the moment the cap is believed, so
    // a capped display pays a few seconds of the probe, never a climb back.
    const result = run(lowGovernor(), 60, () => ({}));

    expect(result.lastShedBeforeCapS).toBeGreaterThan(0);
    expect(result.capAtS).toBeGreaterThan(result.lastShedBeforeCapS);
    expect(result.capAtS).toBeLessThan(15);
    expect(result.min.grass).toBe(LOW_FLOORS.grass);
    expect(result.min.foliage).toBe(LOW_FLOORS.foliage);
    expect(result.min.vfx).toBe(LOW_FLOORS.vfx);
    expect(result.min.lighting).toBe(LOW_FLOORS.lighting);
    expect(result.state.externalFrameCap).toBe(true);
    expect(result.state.reason).toBe('frame-cap');
    // The 1.54 M triangles sit above the 90% enrich line, so the levels hold
    // at exactly the restored baselines.
    expect(result.state.levels).toEqual(LOW_BASELINE);
  });

  it('restores the render scale at the latch instead of climbing it back', () => {
    // The composer path hands the governor a real resolution range: the probe
    // sheds it with the rest, and the latch puts it back at once (recoverStep
    // would otherwise need half a minute for the same distance).
    const governor = lowGovernor(0.65);
    const result = run(governor, 60, () => ({ minRenderScale: 0.65 }));

    expect(result.min.resolution).toBe(0.65);
    expect(result.state.externalFrameCap).toBe(true);
    expect(result.state.levels.resolution).toBe(1);
    // And the restore is immediate: at the latch frame the scale is already 1.
    const probe = run(lowGovernor(0.65), result.capAtS, () => ({ minRenderScale: 0.65 }));
    expect(probe.state.externalFrameCap).toBe(true);
    expect(probe.state.levels.resolution).toBe(1);
  });

  it('restores terrain detail at the latch instead of leaving the probe shed behind', () => {
    const result = run(ultraGovernor(), 60, () => ({}));

    expect(result.min.detail).toBeLessThan(1);
    expect(result.state.externalFrameCap).toBe(true);
    const latch = run(ultraGovernor(), result.capAtS, () => ({}));
    expect(latch.state.externalFrameCap).toBe(true);
    expect(latch.state.levels.detail).toBe(1);
  });

  it('refuses the cap when shedding moves the cadence, and stays shed', () => {
    // A GPU-bound frame that vsync steps between 41.7 and 33.4 ms depending
    // on how much the governor draws: the probe's restore brings the slower
    // step back, so the probe concludes shedding works. No cap, the normal
    // rules shed again, and the session settles at the floors as 'floored'.
    const density = (levels: RenderBudgetLevels) =>
      levels.grass + levels.foliage + levels.vfx + levels.lighting;
    const floorDensity =
      LOW_FLOORS.grass + LOW_FLOORS.foliage + LOW_FLOORS.vfx + LOW_FLOORS.lighting;
    const result = run(lowGovernor(), 60, (state) => ({
      frameMs: density(state.levels) > floorDensity + 0.05 ? 41.7 : 33.4,
    }));

    expect(result.state.externalFrameCap).toBe(false);
    expect(result.state.mode).toBe('stable');
    expect(result.state.reason).toBe('floored');
    expect(result.state.levels.grass).toBe(LOW_FLOORS.grass);
    expect(result.state.levels.vfx).toBe(LOW_FLOORS.vfx);
  });

  it('drops the cap once the cadence leaves the window, but not on one hitch frame', () => {
    const governor = lowGovernor();
    let { state } = run(governor, 60, () => ({}));
    expect(state.externalFrameCap).toBe(true);

    // One 60 ms hitch (a view build) is not a cadence change.
    state = governor.update(sample({ frameMs: 60 }));
    expect(state.externalFrameCap).toBe(true);
    for (let i = 0; i < 4; i++) state = governor.update(sample());
    expect(state.externalFrameCap).toBe(true);

    // A steady 60 ms with the CPU still idle is not a cap window.
    for (let i = 0; i < 8; i++) state = governor.update(sample({ frameMs: 60 }));
    expect(state.externalFrameCap).toBe(false);
    expect(state.reason).not.toBe('frame-cap');
  });

  it('reads a probe whose floors run under budget as refused, then re-probes after the hold', () => {
    // A machine whose floors run at 60 fps and whose baseline flips to the
    // 30 fps vsync step: the probe's own success takes the cadence out of
    // the window, which IS the verdict (shedding works). Recovery then climbs
    // on measured headroom and the cadence flips back into the window. The
    // refusal must hold for the cooldown, but a continuous candidate may
    // probe again once that hold expires.
    const density = (levels: RenderBudgetLevels) =>
      levels.grass + levels.foliage + levels.vfx + levels.lighting;
    const floorDensity =
      LOW_FLOORS.grass + LOW_FLOORS.foliage + LOW_FLOORS.vfx + LOW_FLOORS.lighting;
    const governor = lowGovernor();
    let state = governor.state();
    let probes = 0;
    let capFrames = 0;
    let lastProbe: string | undefined = 'idle';
    const update = () => {
      state = governor.update(
        sample({
          frameMs: density(state.levels) > floorDensity + 0.05 ? 33.4 : 16.7,
          dt: density(state.levels) > floorDensity + 0.05 ? 1 / 30 : 1 / 60,
        }),
      );
      if (state.frameCapProbe === 'shed' && lastProbe !== 'shed') probes++;
      lastProbe = state.frameCapProbe;
      if (state.externalFrameCap) capFrames++;
    };
    for (let i = 0; i < 30 * 55; i++) {
      update();
    }
    expect(probes).toBe(1);
    expect(capFrames).toBe(0);
    expect(state.frameCapProbe).toBe('refused');
    for (let i = 0; i < 30 * 50 && probes < 2; i++) {
      update();
    }
    expect(probes).toBe(2);
    expect(capFrames).toBe(0);
  });

  it('keeps a fresh refusal through a heavier zone, and re-probes only after the hold', () => {
    // Refused on the GPU-bound model, then the frame gets heavier (an upward
    // lapse: the workload changed). A refusal younger than the hold survives
    // it, so a GPU-bound machine does not get a probe (and its restored
    // baseline dwell) on every zone it walks into; an old one is re-tried.
    const density = (levels: RenderBudgetLevels) =>
      levels.grass + levels.foliage + levels.vfx + levels.lighting;
    const floorDensity =
      LOW_FLOORS.grass + LOW_FLOORS.foliage + LOW_FLOORS.vfx + LOW_FLOORS.lighting;
    const governor = lowGovernor();
    let state = governor.state();
    for (let i = 0; i < 30 * 30 && state.frameCapProbe !== 'refused'; i++) {
      state = governor.update(
        sample({ frameMs: density(state.levels) > floorDensity + 0.05 ? 41.7 : 33.4 }),
      );
    }
    expect(state.frameCapProbe).toBe('refused');

    const heavyThenWindow = () => {
      for (let i = 0; i < 6; i++) state = governor.update(sample({ frameMs: 70 }));
      for (let i = 0; i < 30; i++) state = governor.update(sample());
    };
    heavyThenWindow();
    expect(state.frameCapProbe).toBe('refused');
    // Past the hold, the same excursion re-opens a probe.
    for (let i = 0; i < 30 * 61; i++) state = governor.update(sample());
    heavyThenWindow();
    expect(state.frameCapProbe).not.toBe('refused');
  });

  it('restores the pre-probe levels even when a hitch interrupted the probe at the floors', () => {
    // A multi-frame hitch (three frames outside the window) lapses the probe
    // after it shed everything. The levels stay where the ladder put them
    // (the frame may really have got heavier), but the origin survives: the
    // probe that resumes from the floors still restores what the session had
    // before, never the floors.
    const governor = lowGovernor();
    let state = governor.state();
    // Run until the probe reaches its floor dwell.
    for (let i = 0; i < 30 * 30 && state.levels.grass > LOW_FLOORS.grass; i++) {
      state = governor.update(sample());
    }
    expect(state.levels.grass).toBe(LOW_FLOORS.grass);
    expect(state.externalFrameCap).toBe(false);
    for (let i = 0; i < 4; i++) state = governor.update(sample({ frameMs: 80, totalMs: 40 }));
    expect(state.levels.grass).toBe(LOW_FLOORS.grass);

    const resumed = run(governor, 30, () => ({}));
    expect(resumed.state.externalFrameCap).toBe(true);
    expect(resumed.state.levels).toEqual(LOW_BASELINE);
  });

  it('never reports floored while the probe itself dwells at the floors', () => {
    const governor = lowGovernor();
    let state = governor.state();
    let flooredWhileProbing = 0;
    for (let i = 0; i < 30 * 20 && !state.externalFrameCap; i++) {
      state = governor.update(sample());
      if (state.reason === 'floored') flooredWhileProbing++;
    }
    expect(state.externalFrameCap).toBe(true);
    expect(flooredWhileProbing).toBe(0);
  });

  it('forgets a probe in flight on reset', () => {
    const governor = lowGovernor();
    for (let i = 0; i < 60; i++) governor.update(sample());
    const state = governor.reset(1, 1, 1);
    expect(state.levels).toEqual(LOW_BASELINE);
    expect(state.externalFrameCap).toBe(false);
    expect(state.reason).toBe('startup');
  });

  it('reports floored when everything it owns is shed and the frame is still over budget', () => {
    // The Thornpeak Heights numbers on the HD 530: vsync steps of 33.4 / 50 /
    // 66.7 ms, 292 calls and 5.54 M triangles (draw pressure 3.46, urgent), so
    // no cap candidate ever forms. Before the fix the terminal state read
    // 'stable', indistinguishable from a healthy session.
    const governor = lowGovernor();
    const steps = [33.4, 33.4, 33.4, 50, 33.4, 50, 33.4, 33.4, 50, 66.7];
    let state = governor.state();
    for (let i = 0; i < 600; i++) {
      const frameMs = steps[i % steps.length];
      state = governor.update(
        sample({ dt: frameMs / 1000, frameMs, calls: 292, triangles: 5_540_000 }),
      );
    }

    expect(state.levels).toEqual({ ...LOW_FLOORS, resolution: 1, detail: 1, post: 1 });
    expect(state.externalFrameCap).toBe(false);
    expect(state.mode).toBe('stable');
    expect(state.reason).toBe('floored');
  });

  it('leaves a 60 Hz idle frame alone', () => {
    const { state } = run(lowGovernor(), 10, () => ({
      dt: 1 / 60,
      frameMs: 16.7,
      totalMs: 6,
      submitMs: 3,
    }));
    expect(state.mode).toBe('stable');
    expect(state.reason).toBe('stable');
    expect(state.externalFrameCap).toBe(false);
    expect(state.levels).toEqual(LOW_BASELINE);
  });
});
