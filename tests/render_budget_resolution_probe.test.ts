import { describe, expect, it } from 'vitest';
import { GFX_BUDGETS } from '../src/render/gfx';
import {
  RenderBudgetGovernor,
  type RenderBudgetSample,
  type RenderBudgetState,
} from '../src/render/render_budget';
import { RESOLUTION_LOCKOUT_S } from '../src/render/resolution_effect_probe_core';

// Every resolution cut is now an experiment (resolution_effect_probe_core.ts):
// a cut that does not make the frame cheaper is undone and the rung is locked
// out for a while. These drive the real governor with a frame whose cost is a
// function of the governor's own resolution level, for a CPU-bound device
// (cost does not depend on pixels) and a GPU-bound one (it does).

const DT = 1 / 60;

function sample(frameMs: number, overrides: Partial<RenderBudgetSample> = {}): RenderBudgetSample {
  return {
    dt: DT,
    frameMs,
    totalMs: frameMs - 1,
    submitMs: 6,
    calls: 150,
    triangles: 250000,
    grassVisibleTufts: 900,
    grassVisibleChunks: 8,
    activeViews: 25,
    createdViews: 0,
    minRenderScale: 0.68,
    maxRenderScale: 0.85,
    ...overrides,
  };
}

/** Run `seconds` of frames whose cost comes from `cost(resolution)`. */
function play(
  g: RenderBudgetGovernor,
  seconds: number,
  cost: (resolution: number) => number,
  onFrame?: (s: RenderBudgetState) => void,
): RenderBudgetState {
  let state = g.update(sample(16));
  for (let t = 0; t < seconds; t += DT) {
    state = g.update(sample(cost(state.levels.resolution)));
    onFrame?.(state);
  }
  return state;
}

function settledGovernor() {
  const g = new RenderBudgetGovernor({ tier: 'low', budget: GFX_BUDGETS.low, enabled: true });
  g.reset(0.85, 0.68, 0.85);
  // a calm second so the probe knows what a frame normally costs
  play(g, 1.5, () => 15);
  return g;
}

describe('render budget: resolution cuts must pay for themselves', () => {
  it('on a CPU-bound frame a cut is undone and the rung stays out of the ladder', () => {
    const g = settledGovernor();
    let lowest = 1;
    // 30 ms whatever the resolution: severe frame pressure, nothing pixel-bound
    const state = play(
      g,
      8,
      () => 30,
      (s) => {
        lowest = Math.min(lowest, s.levels.resolution);
      },
    );
    expect(state.resolutionCutsReverted).toBeGreaterThanOrEqual(1);
    expect(state.resolutionCutsKept).toBe(0);
    expect(state.levels.resolution).toBe(0.85);
    expect(state.resolutionLockoutSeconds).toBeGreaterThan(RESOLUTION_LOCKOUT_S - 10);
    // it did try (the experiment), but only one cut's worth before undoing it
    expect(lowest).toBeLessThan(0.85);
    expect(lowest).toBeGreaterThan(0.7);
  });

  it('during the lockout a CPU-bound frame keeps full resolution and the other rungs still shed', () => {
    const g = settledGovernor();
    const before = { ...g.update(sample(16)).levels };
    const state = play(g, 20, () => 30);
    expect(state.levels.resolution).toBe(0.85);
    expect(state.resolutionCutsReverted).toBe(1);
    // the rest of the ladder still answered the pressure (effects are the rung
    // frame pressure sheds on Low), and the governor says honestly it is out of rungs
    expect(state.levels.vfx).toBeLessThan(before.vfx);
    expect(state.reason).toBe('floored');
  });

  it('on a GPU-bound frame the cut pays off and is kept, as before', () => {
    const g = settledGovernor();
    // cost proportional to pixels: 30 ms at 0.85, about 24 ms at 0.77
    const state = play(g, 8, (r) => 30 * (r / 0.85) ** 2);
    expect(state.resolutionCutsKept).toBeGreaterThanOrEqual(1);
    expect(state.resolutionCutsReverted).toBe(0);
    expect(state.levels.resolution).toBeLessThan(0.85);
  });

  it('the lockout ends and a later cut is judged again when the scene turns GPU-bound', () => {
    const g = settledGovernor();
    play(g, 8, () => 30); // CPU-bound: reverted, locked out
    // calm until the lockout is over (the probe re-learns the normal cost)
    play(g, RESOLUTION_LOCKOUT_S, () => 15);
    const state = play(g, 8, (r) => 30 * (r / 0.85) ** 2);
    expect(state.resolutionCutsReverted).toBe(1);
    expect(state.resolutionCutsKept).toBeGreaterThanOrEqual(1);
    expect(state.levels.resolution).toBeLessThan(0.85);
  });

  it('holds every other rung still while an experiment runs', () => {
    const g = settledGovernor();
    // over budget throughout: without the freeze the restored arm would shed effects
    let sawBusy = false;
    let vfxDuringExperiment: number | null = null;
    let changedDuringExperiment = false;
    play(
      g,
      8,
      (r) => 30 * (r / 0.85) ** 2,
      (st) => {
        if (st.resolutionProbe !== 'idle') {
          sawBusy = true;
          if (vfxDuringExperiment === null) vfxDuringExperiment = st.levels.vfx;
          else if (st.levels.vfx !== vfxDuringExperiment) changedDuringExperiment = true;
        }
      },
    );
    expect(sawBusy).toBe(true);
    expect(changedDuringExperiment).toBe(false);
  });

  it('is never "at baseline" for the frame-rate ceiling while an experiment runs', () => {
    const g = settledGovernor();
    let busyAtBaseline = false;
    play(
      g,
      4,
      () => 30,
      (st) => {
        if (st.resolutionProbe !== 'idle' && g.atBaseline(0.85)) busyAtBaseline = true;
      },
    );
    expect(busyAtBaseline).toBe(false);
  });

  it('a resolution range change mid-experiment cancels it and keeps the cut', () => {
    const g = settledGovernor();
    let state = g.update(sample(16));
    // start an experiment
    for (let i = 0; i < 30 && state.resolutionProbe === 'idle'; i++) state = g.update(sample(30));
    expect(state.resolutionProbe).not.toBe('idle');
    const cut = state.levels.resolution;
    // the post chain turned dynamic resolution off: range collapses
    state = g.update(sample(30, { minRenderScale: 0.68, maxRenderScale: 0.8 }));
    expect(state.resolutionProbe).toBe('idle');
    expect(state.resolutionCutsCancelled).toBe(1);
    expect(state.resolutionCutsReverted).toBe(0);
    expect(state.resolutionLockoutSeconds).toBe(0);
    expect(state.levels.resolution).toBe(Math.min(cut, 0.8));
  });

  it('a submit stall mid-experiment ends it, keeps the cut and sheds on the same frame', () => {
    const g = settledGovernor();
    let state = g.update(sample(16));
    // start an experiment
    for (let i = 0; i < 30 && state.resolutionProbe === 'idle'; i++) state = g.update(sample(30));
    expect(state.resolutionProbe).not.toBe('idle');
    const cut = state.levels.resolution;
    const before = { ...state.levels };
    // a real stall (the governor's line is 120 ms of submit) during the experiment
    state = g.update(sample(140, { totalMs: 139, submitMs: 130 }));
    // The experiment ends unjudged with its cut held. The ladder then sheds on
    // this same frame; with the other rungs already floored that shed is a
    // further resolution cut, which starts its own experiment.
    expect(state.resolutionCutsCancelled).toBe(1);
    expect(state.resolutionCutsReverted).toBe(0);
    expect(state.levels.resolution).toBeLessThanOrEqual(cut);
    expect(state.reason).toBe('submit-stall');
    const shed = (Object.keys(before) as (keyof typeof before)[]).some(
      (k) => k !== 'resolution' && state.levels[k] < before[k],
    );
    expect(shed || state.levels.resolution < cut).toBe(true);
  });

  it('an urgent frame without a stall does not end the experiment', () => {
    const g = settledGovernor();
    let state = g.update(sample(16));
    for (let i = 0; i < 30 && state.resolutionProbe === 'idle'; i++) state = g.update(sample(30));
    expect(state.resolutionProbe).not.toBe('idle');
    // well past Low's urgent frame line, but the submit is ordinary
    state = g.update(sample(45, { totalMs: 44 }));
    expect(state.resolutionProbe).not.toBe('idle');
    expect(state.resolutionCutsCancelled).toBe(0);
  });

  it('reports the probe in the state the perf readout and beacon carry', () => {
    const g = settledGovernor();
    const state = play(g, 0.2, () => 30);
    expect([
      'idle',
      'settle-cut',
      'measure-cut',
      'settle-restore',
      'measure-restore',
      'settle-recut',
      'measure-recut',
    ]).toContain(state.resolutionProbe);
    expect(typeof state.resolutionLastGainMs).toBe('number');
  });
});
