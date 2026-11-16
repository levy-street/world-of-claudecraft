import { describe, expect, it } from 'vitest';
import {
  advanceResolutionProbe,
  cancelResolutionProbe,
  createResolutionProbe,
  noteResolutionCut,
  RESOLUTION_EFFECT_MEASURE_S,
  RESOLUTION_EFFECT_SETTLE_S,
  RESOLUTION_LOCKOUT_S,
  RESOLUTION_TRUST_S,
  RESOLUTION_TRUSTED_CUTS,
  type ResolutionProbeState,
  type ResolutionProbeStep,
  resolutionCutAllowed,
  resolutionProbeBusy,
} from '../src/render/resolution_effect_probe_core';

const DT = 1 / 60;
const EXPERIMENT_S = 3 * (RESOLUTION_EFFECT_SETTLE_S + RESOLUTION_EFFECT_MEASURE_S);

/**
 * Drive one experiment to its verdict. `cost(level, t)` is the frame cost at the
 * level the governor currently holds; the helper applies every setLevel the probe
 * asks for, like the governor does.
 */
function runProbe(
  p: ResolutionProbeState,
  start: number,
  cost: (level: number, t: number) => number,
  clean: (i: number) => boolean = () => true,
): { step: ResolutionProbeStep; level: number; levels: number[] } {
  let level = start;
  const levels: number[] = [];
  let step: ResolutionProbeStep = { setLevel: null, verdict: 'pending' };
  const frames = Math.ceil(EXPERIMENT_S / DT) + 10;
  for (let i = 0; i < frames && step.verdict === 'pending'; i++) {
    step = advanceResolutionProbe(p, cost(level, i * DT), DT, clean(i));
    if (step.setLevel !== null) level = step.setLevel;
    levels.push(level);
  }
  return { step, level, levels };
}

const gpuBound = (level: number) => 30 * (level / 0.85) ** 2;
const cpuBound = () => 30;

describe('resolution effect probe (A/B/A inside the experiment)', () => {
  it('keeps a cut that made a pixel-bound frame cheaper, after cut, restore and cut again', () => {
    const p = createResolutionProbe();
    expect(noteResolutionCut(p, 0.85, 0.77)).toBe(true);
    const { step, level, levels } = runProbe(p, 0.77, gpuBound);
    expect(step.verdict).toBe('keep');
    expect(level).toBe(0.77);
    // the three arms: cut, restored, cut again
    const firstRestore = levels.indexOf(0.85);
    expect(firstRestore).toBeGreaterThan(0);
    expect(levels.slice(firstRestore).includes(0.77)).toBe(true);
    expect(p.kept).toBe(1);
    expect(p.lastGainMs).toBeGreaterThan(4);
  });

  it('undoes a cut that bought nothing on a CPU-bound frame and locks the rung out', () => {
    const p = createResolutionProbe();
    noteResolutionCut(p, 0.85, 0.77);
    const { step, level } = runProbe(p, 0.77, cpuBound);
    expect(step.verdict).toBe('revert');
    expect(level).toBe(0.85);
    expect(p.reverted).toBe(1);
    expect(resolutionCutAllowed(p)).toBe(false);
    expect(p.lockoutS).toBeGreaterThan(RESOLUTION_LOCKOUT_S - 5);
  });

  it('a steadily FALLING load does not fake a payoff on a CPU-bound frame', () => {
    // the overload that triggered the cut fades during the experiment
    const p = createResolutionProbe();
    noteResolutionCut(p, 0.85, 0.77);
    expect(runProbe(p, 0.77, (_l, t) => 40 - 3 * t).step.verdict).toBe('revert');
  });

  it('a steadily RISING load does not hide a real payoff on a pixel-bound frame', () => {
    const p = createResolutionProbe();
    noteResolutionCut(p, 0.85, 0.77);
    expect(runProbe(p, 0.77, (l, t) => gpuBound(l) + 3 * t).step.verdict).toBe('keep');
  });

  it('needs both the absolute and the relative gain', () => {
    const slow = createResolutionProbe();
    noteResolutionCut(slow, 1, 0.92);
    expect(runProbe(slow, 0.92, (l) => (l === 1 ? 40 : 39.4)).step.verdict).toBe('revert');
    const fast = createResolutionProbe();
    noteResolutionCut(fast, 1, 0.92);
    expect(runProbe(fast, 0.92, (l) => (l === 1 ? 6 : 5.6)).step.verdict).toBe('revert');
  });

  it('judges on medians, so a hitch in any arm cannot decide it', () => {
    const p = createResolutionProbe();
    noteResolutionCut(p, 0.85, 0.77);
    let i = 0;
    expect(runProbe(p, 0.77, () => (i++ % 50 === 25 ? 600 : 30)).step.verdict).toBe('revert');
  });

  it('with too little clean evidence the cut stands (the old behaviour), unjudged', () => {
    const p = createResolutionProbe();
    noteResolutionCut(p, 0.85, 0.77);
    const { step, level } = runProbe(p, 0.77, cpuBound, () => false);
    expect(step.verdict).toBe('keep');
    expect(level).toBe(0.77);
    expect(p.unjudged).toBe(1);
    expect(p.reverted).toBe(0);
    expect(resolutionCutAllowed(p)).toBe(true);
  });

  it('is busy from the cut to the verdict, and blocks a second cut meanwhile', () => {
    const p = createResolutionProbe();
    expect(resolutionProbeBusy(p)).toBe(false);
    expect(noteResolutionCut(p, 0.85, 0.85)).toBe(false);
    expect(noteResolutionCut(p, 0.85, 0.77)).toBe(true);
    expect(resolutionProbeBusy(p)).toBe(true);
    expect(resolutionCutAllowed(p)).toBe(false);
    expect(noteResolutionCut(p, 0.77, 0.7)).toBe(false);
    runProbe(p, 0.77, cpuBound);
    expect(resolutionProbeBusy(p)).toBe(false);
  });

  it('a cancelled experiment keeps the cut, counts as cancelled and starts no lockout', () => {
    const p = createResolutionProbe();
    noteResolutionCut(p, 0.85, 0.77);
    // run into the restored arm, then cancel
    for (let t = 0; t < RESOLUTION_EFFECT_SETTLE_S + RESOLUTION_EFFECT_MEASURE_S + 0.2; t += DT) {
      advanceResolutionProbe(p, 30, DT, true);
    }
    expect(cancelResolutionProbe(p)).toBe(0.77);
    expect(p.cancelled).toBe(1);
    expect(resolutionProbeBusy(p)).toBe(false);
    expect(resolutionCutAllowed(p)).toBe(true);
    expect(cancelResolutionProbe(p)).toBeNull();
  });

  it('after a kept cut, further cuts skip the experiment for a while', () => {
    const p = createResolutionProbe();
    noteResolutionCut(p, 0.85, 0.77);
    runProbe(p, 0.77, gpuBound);
    expect(noteResolutionCut(p, 0.77, 0.7)).toBe(false);
    expect(p.phase).toBe('idle');
    for (let t = 0; t < RESOLUTION_TRUST_S + 1; t += DT) advanceResolutionProbe(p, 20, DT, true);
    expect(noteResolutionCut(p, 0.77, 0.7)).toBe(true);
  });

  it('a keep trusts only the next few cuts, so a misjudged keep cannot walk to the floor', () => {
    // A load that jumped inside the restored arm makes a CPU-bound cut look like
    // it paid off. The trust it earns lets RESOLUTION_TRUSTED_CUTS further cuts
    // through unjudged, then the next cut, still inside RESOLUTION_TRUST_S, is
    // judged again and undone on the CPU-bound frame.
    const p = createResolutionProbe();
    noteResolutionCut(p, 0.85, 0.77);
    const misjudged = (level: number, t: number) => {
      const restoredArm = t >= 2 && t < 4;
      return restoredArm ? 40 : 30 + 0 * level;
    };
    expect(runProbe(p, 0.77, misjudged).step.verdict).toBe('keep');
    let level = 0.77;
    for (let i = 0; i < RESOLUTION_TRUSTED_CUTS; i++) {
      expect(noteResolutionCut(p, level, level - 0.08)).toBe(false);
      level -= 0.08;
    }
    expect(p.trustS).toBeGreaterThan(0);
    expect(noteResolutionCut(p, level, level - 0.08)).toBe(true);
    expect(runProbe(p, level - 0.08, cpuBound).step).toEqual({
      setLevel: level,
      verdict: 'revert',
    });
  });

  it('the lockout expires, and the next cut is judged on what bounds the frame then', () => {
    const p = createResolutionProbe();
    noteResolutionCut(p, 0.85, 0.77);
    runProbe(p, 0.77, cpuBound);
    expect(resolutionCutAllowed(p)).toBe(false);
    for (let t = 0; t < RESOLUTION_LOCKOUT_S + 1; t += DT) advanceResolutionProbe(p, 30, DT, true);
    expect(resolutionCutAllowed(p)).toBe(true);
    noteResolutionCut(p, 0.85, 0.77);
    expect(runProbe(p, 0.77, gpuBound).step.verdict).toBe('keep');
  });
});
