import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GFX_BUDGETS } from '../src/render/gfx';
import {
  PRE_REVEAL_MAX_S,
  PREPARATION_EXEMPT_MAX_SHARE,
  REVEAL_GRACE_S,
  RenderBudgetGovernor,
  type RenderBudgetSample,
  type RenderBudgetState,
} from '../src/render/render_budget';

// A frame whose span linked a shader program pays a one-off cost inside its
// submit (three links a cold program synchronously at first draw). The governor
// used to read that spike as render load: one 120 ms+ link degraded a rung on
// the spot, held recovery for up to 18 s on low and inflated the frame average,
// so a phone turning its camera toward unseen scenery sat at the resolution floor
// for whole sessions. Such a PREPARATION FRAME is now read with its timings
// replaced by the running averages: every other rule and clock runs as usual.

const DT = 1 / 60;

function sample(overrides: Partial<RenderBudgetSample> = {}): RenderBudgetSample {
  return {
    dt: DT,
    frameMs: 16,
    totalMs: 14,
    submitMs: 5,
    calls: 150,
    triangles: 250000,
    grassVisibleTufts: 900,
    grassVisibleChunks: 8,
    activeViews: 25,
    createdViews: 0,
    minRenderScale: 0.65,
    maxRenderScale: 1,
    programCount: 300,
    ...overrides,
  };
}

// The spike a cold link produces: submit far past SUBMIT_STALL_MS, a long frame.
const SPIKE = { frameMs: 250, totalMs: 240, submitMs: 230 };

function governor(enabled = true) {
  const g = new RenderBudgetGovernor({ tier: 'low', budget: GFX_BUDGETS.low, enabled });
  g.reset(1, 0.65, 1);
  for (let i = 0; i < 60; i++) g.update(sample());
  return g;
}

/** Everything a neutral frame must leave exactly as a calm frame would. */
function comparable(state: RenderBudgetState) {
  const { preparationFrames, preparationShare, coveredFrames, stableSeconds, ...rest } = state;
  return rest;
}

describe('render budget: a preparation frame is not render load', () => {
  it('an UNATTRIBUTED submit stall still degrades and holds (unchanged)', () => {
    const g = governor();
    const baseline = { ...g.update(sample()).levels };
    const state = g.update(sample(SPIKE));
    expect(state.reason).toBe('submit-stall');
    expect(state.stallHoldSeconds).toBeGreaterThan(10);
    expect(state.levels).not.toEqual(baseline);
  });

  it('the same spike on a span that linked a program changes nothing a calm frame would not', () => {
    const calm = governor();
    const linked = governor();
    calm.update(sample());
    linked.update(sample());
    const a = calm.update(sample());
    const b = linked.update(sample({ ...SPIKE, programCount: 304 }));
    expect(comparable(b)).toEqual(comparable(a));
    expect(b.reason).not.toBe('submit-stall');
    expect(b.stallHoldSeconds).toBe(0);
    expect(b.recentSubmitStalls).toBe(0);
    expect(b.preparationFrames).toBe(1);
    expect(a.preparationFrames).toBe(0);
  });

  it('holds recovery progress instead of crediting or resetting it', () => {
    const calm = governor();
    const linked = governor();
    const before = calm.update(sample());
    linked.update(sample());
    const credited = calm.update(sample()).stableSeconds;
    const held = linked.update(sample({ ...SPIKE, programCount: 301 })).stableSeconds;
    expect(credited).toBeGreaterThan(before.stableSeconds);
    expect(held).toBe(before.stableSeconds);
    expect(held).toBeGreaterThan(0); // not reset either
  });

  it('keeps every running clock in step with a calm frame during a stall hold', () => {
    // Both start from one real (unattributed) stall: hold, cooldown and stall pressure running.
    const calm = governor();
    const linked = governor();
    calm.update(sample(SPIKE));
    linked.update(sample(SPIKE));
    let a = calm.update(sample());
    let b = linked.update(sample());
    let programs = 300;
    for (let i = 0; i < 120; i++) {
      // one linked spike every 6 frames on one side, calm frames on the other
      const link = i % 6 === 0;
      if (link) programs += 1;
      a = calm.update(sample({ programCount: programs }));
      b = linked.update(
        sample(link ? { ...SPIKE, programCount: programs } : { programCount: programs }),
      );
    }
    expect(b.stallHoldSeconds).toBe(a.stallHoldSeconds);
    expect(b.cooldownSeconds).toBe(a.cooldownSeconds);
    expect(b.stallPressure).toBe(a.stallPressure);
    expect(b.recentSubmitStalls).toBe(a.recentSubmitStalls);
    expect(b.levels).toEqual(a.levels);
    expect(b.mode).toBe(a.mode);
    expect(b.preparationFrames).toBe(20);
  });

  it('does not report a stale degrading mode on the frame after a step', () => {
    const g = governor();
    const stepped = g.update(sample({ frameMs: 60, totalMs: 58, submitMs: 20 }));
    expect(stepped.mode).toBe('degrading');
    const next = g.update(sample({ ...SPIKE, programCount: 301 }));
    expect(next.preparationFrames).toBe(1);
    expect(next.reason).not.toBe('submit-stall');
  });

  it('a link on a frame that did NOT spike is read as an ordinary frame', () => {
    // a steady background link stream must not hide real load that lands on it
    const calm = governor();
    const linked = governor();
    calm.update(sample());
    linked.update(sample());
    const load = { frameMs: 26, totalMs: 25, submitMs: 9 };
    const a = calm.update(sample(load));
    const b = linked.update(sample({ ...load, programCount: 301 }));
    expect(b.preparationFrames).toBe(0);
    expect(b.frameMsEma).toBe(a.frameMsEma);
  });

  it('the first reading only arms the baseline', () => {
    const g = new RenderBudgetGovernor({ tier: 'low', budget: GFX_BUDGETS.low, enabled: true });
    g.reset(1, 0.65, 1);
    const state = g.update(sample({ ...SPIKE, programCount: 900 }));
    expect(state.preparationFrames).toBe(0);
    expect(state.reason).toBe('submit-stall');
  });

  it('a falling count re-arms (context restore starts at zero) and the next rise marks again', () => {
    const g = governor();
    const dropped = g.update(sample({ ...SPIKE, programCount: 0 }));
    expect(dropped.preparationFrames).toBe(0);
    expect(dropped.reason).toBe('submit-stall');
    for (let i = 0; i < 60; i++) g.update(sample({ programCount: 0 }));
    const relinked = g.update(sample({ ...SPIKE, programCount: 12 }));
    expect(relinked.preparationFrames).toBe(1);
  });

  it('without a program count the governor behaves exactly as before', () => {
    const g = new RenderBudgetGovernor({ tier: 'low', budget: GFX_BUDGETS.low, enabled: true });
    g.reset(1, 0.65, 1);
    const plain = { ...sample(), programCount: undefined };
    for (let i = 0; i < 60; i++) g.update(plain);
    const state = g.update({ ...plain, ...SPIKE });
    expect(state.reason).toBe('submit-stall');
    expect(state.preparationFrames).toBe(0);
  });

  it('a disabled governor stays disabled and counts nothing', () => {
    const g = governor(false);
    const state = g.update(sample({ ...SPIKE, programCount: 301 }));
    expect(state.mode).toBe('disabled');
    expect(state.preparationFrames).toBe(0);
  });

  it('keeps marking occasional links among ordinary frames, quality intact', () => {
    const g = governor();
    let programs = 300;
    let state = g.update(sample());
    const baseline = { ...state.levels };
    for (let i = 0; i < 600; i++) {
      const link = i % 6 === 0;
      if (link) programs += 1;
      state = g.update(
        sample(link ? { ...SPIKE, programCount: programs } : { programCount: programs }),
      );
    }
    expect(state.preparationShare).toBeLessThan(PREPARATION_EXEMPT_MAX_SHARE);
    expect(state.preparationFrames).toBe(100);
    expect(state.recentSubmitStalls).toBe(0);
    for (const key of Object.keys(baseline) as Array<keyof typeof baseline>) {
      expect(state.levels[key]).toBeGreaterThanOrEqual(baseline[key]);
    }
  });

  it('stops neutralizing when links stop being occasional, so real load is never hidden', () => {
    const g = governor();
    const baseline = { ...g.update(sample()).levels };
    let programs = 300;
    let state = g.update(sample());
    for (let i = 0; i < 240; i++) {
      programs += 1;
      state = g.update(sample({ frameMs: 60, totalMs: 58, submitMs: 30, programCount: programs }));
    }
    expect(state.preparationShare).toBeGreaterThan(PREPARATION_EXEMPT_MAX_SHARE);
    expect(state.frameMsEma).toBeGreaterThan(GFX_BUDGETS.low.dropFrameMs);
    // the governor answered: it shed effects (resolution cuts must now pay off,
    // resolution_effect_probe_core.ts, and on this CPU-bound frame they do not)
    expect(state.levels.vfx).toBeLessThan(baseline.vfx);
    // the bound is time-based: only the first fraction of a second was neutral
    expect(state.preparationFrames).toBeLessThan(30);
  });

  it('a long burst of links falls back to the old reading after its start (documented limit)', () => {
    const g = governor();
    let programs = 300;
    let state = g.update(sample());
    for (let i = 0; i < 60; i++) {
      programs += 1;
      state = g.update(sample({ ...SPIKE, programCount: programs }));
    }
    expect(state.reason).toBe('submit-stall');
    expect(state.preparationFrames).toBeGreaterThan(0);
  });
});

// The world-entry loading screen and a blocking teleport arrival both draw the
// world UNDER a cover while it prepares (arrival_cover.ts). Measured on the
// calibrated desktop proxy: a 1.04 s submit stall on such a covered frame, a
// fraction of a second before the reveal, started a 30 s submit-stall hold that
// covered the first half minute of play. Nobody sees a covered frame.
describe('render budget: a covered frame is not render load', () => {
  it('a submit stall under the cover neither degrades nor starts a hold', () => {
    const calm = governor();
    const covered = governor();
    calm.update(sample());
    covered.update(sample());
    const a = calm.update(sample());
    const b = covered.update(sample({ ...SPIKE, covered: true }));
    expect(comparable(b)).toEqual(comparable(a));
    expect(b.stallHoldSeconds).toBe(0);
    expect(b.coveredFrames).toBe(1);
  });

  it('stays neutral for a whole long curtain, however many frames link under it', () => {
    const g = governor();
    const baseline = { ...g.update(sample()).levels };
    let programs = 300;
    let state = g.update(sample());
    // 20 s of covered, linking, stalling frames: no share bound applies
    for (let i = 0; i < 1200; i++) {
      programs += 1;
      state = g.update(sample({ ...SPIKE, programCount: programs, covered: true }));
    }
    expect(state.reason).not.toBe('submit-stall');
    expect(state.stallHoldSeconds).toBe(0);
    expect(state.levels).toEqual(baseline);
    expect(state.coveredFrames).toBe(1200);
    // covered frames are not evidence about the live share either
    expect(state.preparationShare).toBeLessThan(PREPARATION_EXEMPT_MAX_SHARE);
  });

  it('the first frames after the cover drops are still neutral (reveal grace)', () => {
    // The first revealed frame pays one-off presentation costs (the curtain fade,
    // the HUD laid out and painted for the first time): about 1 s on the desktop
    // proxy, which used to start a 24 s hold although the cover itself was neutral.
    const g = governor();
    g.update(sample({ ...SPIKE, covered: true }));
    const revealed = g.update(sample(SPIKE));
    expect(revealed.reason).not.toBe('submit-stall');
    expect(revealed.stallHoldSeconds).toBe(0);
    expect(revealed.coveredFrames).toBe(2);
  });

  it('after the reveal grace a live stall is read as usual', () => {
    const g = governor();
    g.update(sample({ ...SPIKE, covered: true }));
    for (let t = 0; t < REVEAL_GRACE_S + 0.1; t += DT) g.update(sample());
    const live = g.update(sample(SPIKE));
    expect(live.reason).toBe('submit-stall');
  });

  it('a disabled governor stays disabled under the cover too', () => {
    const g = governor(false);
    const state = g.update(sample({ ...SPIKE, covered: true }));
    expect(state.mode).toBe('disabled');
    expect(state.coveredFrames).toBe(0);
  });
});

// The frame loop starts while the loading screen is still up, two frames before
// the entry cover is raised (main.ts: requestAnimationFrame(frame), then the
// first-paint callback calls settleWorldEntryCover). The world's very first full
// draw lands there: about 1 s on the desktop proxy, unseen, and it started a 24 s
// hold although cover and grace were both neutral.
describe('render budget: frames before the world is revealed', () => {
  function revealGovernor() {
    const g = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: true,
      awaitReveal: true,
    });
    g.reset(1, 0.65, 1);
    return g;
  }

  it('reads every frame before the reveal as covered', () => {
    const g = revealGovernor();
    let state = g.update(sample(SPIKE));
    for (let i = 0; i < 120; i++) state = g.update(sample(SPIKE));
    expect(state.reason).not.toBe('submit-stall');
    expect(state.stallHoldSeconds).toBe(0);
    expect(state.coveredFrames).toBe(121);
  });

  it('the reveal starts the grace, and after it a live stall is read as usual', () => {
    const g = revealGovernor();
    g.update(sample(SPIKE));
    g.noteReveal();
    const revealed = g.update(sample(SPIKE));
    expect(revealed.reason).not.toBe('submit-stall');
    for (let t = 0; t < REVEAL_GRACE_S + 0.1; t += DT) g.update(sample());
    expect(g.update(sample(SPIKE)).reason).toBe('submit-stall');
  });

  it('is bounded: a host that never reveals gets a normal governor after the limit', () => {
    const g = revealGovernor();
    for (let t = 0; t < PRE_REVEAL_MAX_S + 0.5; t += 0.25) g.update(sample({ dt: 0.25 }));
    expect(g.update(sample(SPIKE)).reason).toBe('submit-stall');
  });

  it('a reveal after the bound ran out still grants the grace', () => {
    const g = revealGovernor();
    for (let t = 0; t < PRE_REVEAL_MAX_S + 0.5; t += 0.25) g.update(sample({ dt: 0.25 }));
    g.noteReveal();
    const revealed = g.update(sample(SPIKE));
    expect(revealed.reason).not.toBe('submit-stall');
  });

  it('only the first reveal starts a grace (later ones are teleport reveals under their own cover)', () => {
    const g = revealGovernor();
    g.noteReveal();
    for (let t = 0; t < REVEAL_GRACE_S + 0.1; t += DT) g.update(sample());
    g.noteReveal();
    expect(g.update(sample(SPIKE)).reason).toBe('submit-stall');
  });

  it('a governor that does not await a reveal reads its first frames as before', () => {
    const g = new RenderBudgetGovernor({ tier: 'low', budget: GFX_BUDGETS.low, enabled: true });
    g.reset(1, 0.65, 1);
    expect(g.update(sample(SPIKE)).reason).toBe('submit-stall');
  });
});

describe('renderer wiring', () => {
  it('awaits the world reveal and reports it to the governor', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const ctor = source.indexOf('this.renderBudgetGovernor = new RenderBudgetGovernor({');
    expect(source.slice(ctor, source.indexOf('});', ctor))).toContain('awaitReveal: true,');
    const reveal = source.indexOf('  markGpuHitchReveal(): void {');
    const body = source.slice(reveal, source.indexOf('\n  }\n', reveal));
    expect(body).toContain('this.renderBudgetGovernor.noteReveal();');
  });

  it('feeds the arrival cover to the governor sample before update()', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const start = source.indexOf('private updateAdaptiveResolution(dt: number): void');
    const body = source.slice(start, source.indexOf('\n  }\n', start));
    const wire = body.indexOf('sample.covered = arrivalCoverActive();');
    expect(wire).toBeGreaterThan(0);
    expect(wire).toBeLessThan(body.indexOf('this.renderBudgetGovernor.update(sample'));
  });

  it('feeds the context program count to the governor sample before update()', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const start = source.indexOf('private updateAdaptiveResolution(dt: number): void');
    const body = source.slice(start, source.indexOf('\n  }\n', start));
    const wire = body.indexOf('sample.programCount = info.programs?.length ?? 0;');
    const update = body.indexOf('this.renderBudgetGovernor.update(sample');
    expect(start).toBeGreaterThan(0);
    expect(wire).toBeGreaterThan(0);
    expect(wire).toBeLessThan(update);
    expect(body).toContain('const info = this.webgl.info;');
  });
});
