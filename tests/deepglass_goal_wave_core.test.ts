import { describe, expect, it } from 'vitest';
import {
  createDgGoalWaveFrame,
  DG_GOAL_SHELLS,
  DG_GOAL_WAVE_SECS,
  deepglassGoalWaveFrame,
} from '../src/render/deepglass_goal_wave_core';
import { DG_GOAL_CELEBRATE } from '../src/sim/deepglass/match';

const frame = createDgGoalWaveFrame();
const at = (t: number, reduced = false): ReturnType<typeof createDgGoalWaveFrame> =>
  deepglassGoalWaveFrame(t, reduced, frame);

describe('deepglass goal wave timeline', () => {
  it('is inert outside the celebration', () => {
    for (const t of [-1, DG_GOAL_WAVE_SECS, DG_GOAL_WAVE_SECS + 5, Number.POSITIVE_INFINITY]) {
      const f = at(t);
      expect(f.active, `t=${t}`).toBe(false);
      expect(f.desat).toBe(0);
      expect(f.flash).toBe(0);
      for (const s of f.shells) expect(s.fade).toBe(0);
    }
  });

  it('finishes before the sim resets for the kickoff', () => {
    // A grey screen must never survive into the restart.
    expect(DG_GOAL_WAVE_SECS).toBeLessThan(DG_GOAL_CELEBRATE);
  });

  it('takes the lights down with the chroma and brings both back together', () => {
    // They ride one envelope: a frame caught grey-but-bright washes the wave
    // out to pastel on the composer tiers, which is the whole reason dim
    // exists. Their ratio must therefore be constant while the drain is live.
    let ratio = 0;
    for (let t = 0.25; t < 2; t += 0.1) {
      const f = at(t);
      expect(f.dim).toBeGreaterThan(0);
      const r = f.dim / f.desat;
      if (ratio) expect(r).toBeCloseTo(ratio, 6);
      ratio = r;
    }
    // And both are gone by the end.
    expect(at(3.399).dim).toBeLessThan(0.01);
    expect(at(DG_GOAL_WAVE_SECS).dim).toBe(0);
  });

  it('drains chroma fast, holds it, then gives it all back', () => {
    expect(at(0.01).desat).toBeLessThan(0.15);
    expect(at(0.2).desat).toBeGreaterThan(0.8);
    expect(at(1.5).desat).toBeGreaterThan(0.8);
    // Fully recovered at the end, and monotonically on the way there.
    const late = [2.4, 2.8, 3.2, 3.39].map((t) => at(t).desat);
    for (let i = 1; i < late.length; i++) expect(late[i]).toBeLessThan(late[i - 1]);
    expect(at(3.399).desat).toBeLessThan(0.01);
  });

  it('pops white on the whistle only', () => {
    expect(at(0.001).flash).toBeGreaterThan(0.4);
    expect(at(0.3).flash).toBe(0);
    expect(at(1).flash).toBe(0);
  });

  it('holds the colour back until the frame has drained', () => {
    // The whole first beat is the world going grey. If a front is already
    // visible while chroma is still draining, the drain never reads — which
    // is exactly what the first tuning pass got wrong.
    const firstVisible = DG_GOAL_SHELLS.reduce((acc, _spec, i) => {
      for (let t = 0; t < DG_GOAL_WAVE_SECS; t += 0.005) {
        if (at(t).shells[i].fade > 0.05) return Math.min(acc, t);
      }
      return acc;
    }, DG_GOAL_WAVE_SECS);
    let peakDesat = 0;
    for (let t = 0; t < DG_GOAL_WAVE_SECS; t += 0.01) peakDesat = Math.max(peakDesat, at(t).desat);
    // Measured against the peak, not an absolute, so retuning how grey the
    // frame goes cannot silently break the ordering this test is about.
    expect(at(firstVisible).desat / peakDesat).toBeGreaterThan(0.85);
  });

  it('launches the shells in order and clears the building', () => {
    // Nothing but the leader is out just after the leader's own delay.
    const early = at(DG_GOAL_SHELLS[0].delay + 0.05);
    expect(early.shells[0].fade).toBeGreaterThan(0);
    expect(early.shells[1].fade).toBe(0);
    expect(early.shells[2].fade).toBe(0);
    // Their delays are strictly staggered, so the fronts can never merge.
    for (let i = 1; i < DG_GOAL_SHELLS.length; i++) {
      expect(DG_GOAL_SHELLS[i].delay).toBeGreaterThan(DG_GOAL_SHELLS[i - 1].delay);
      expect(DG_GOAL_SHELLS[i].speed).toBeLessThan(DG_GOAL_SHELLS[i - 1].speed);
    }

    // Each front's radius grows monotonically while it lives.
    for (let i = 0; i < DG_GOAL_SHELLS.length; i++) {
      const spec = DG_GOAL_SHELLS[i];
      let prev = -1;
      for (let t = spec.delay + 0.05; t < spec.delay + spec.life; t += 0.05) {
        const r = at(t).shells[i].radius;
        expect(r).toBeGreaterThan(prev);
        prev = r;
      }
      // The parapet (r 99, a hard collider in sim/deepglass/world.ts) is as
      // far from the middle as anyone can get, so the worst case is a goal at
      // x=-30 and a camera against the far rail at x=+99: 129 yards, plus the
      // camera boom. Every front must clear that or somebody in the building
      // gets the grey screen without ever seeing the colour arrive.
      const reach = 6 + spec.speed * spec.life;
      expect(reach, `shell ${i}`).toBeGreaterThan(150);
    }
  });

  it('overlaps the fronts so the wave reads as ripples, not one shell', () => {
    // At 0.9s all three are alive at once with different radii.
    const f = at(0.9);
    const live = f.shells.filter((s) => s.fade > 0);
    expect(live).toHaveLength(3);
    const radii = f.shells.map((s) => s.radius);
    expect(radii[0]).toBeGreaterThan(radii[1]);
    expect(radii[1]).toBeGreaterThan(radii[2]);
  });

  it('every shell fades in and back out inside its own life', () => {
    for (let i = 0; i < DG_GOAL_SHELLS.length; i++) {
      const spec = DG_GOAL_SHELLS[i];
      expect(at(spec.delay + 0.001).shells[i].fade).toBeLessThan(0.05);
      expect(at(spec.delay + spec.life * 0.25).shells[i].fade).toBeGreaterThan(0.2);
      expect(at(spec.delay + spec.life - 0.001).shells[i].fade).toBeLessThan(0.01);
      expect(at(spec.delay + spec.life + 0.01).shells[i].fade).toBe(0);
    }
  });

  it('reduced motion keeps the colour and drops the movement', () => {
    // at() hands back the one caller-owned frame, so read the numbers out
    // before the next call overwrites them.
    const { warp: plainWarp, desat: plainDesat } = at(1);
    const { warp: calmWarp, desat: calmDesat } = at(1, true);
    expect(calmWarp).toBe(0);
    expect(plainWarp).toBeGreaterThan(0);
    expect(calmDesat).toBeLessThan(plainDesat);
    // Still a celebration: the shells are quieter but they are all there.
    for (let i = 0; i < DG_GOAL_SHELLS.length; i++) {
      expect(at(1, true).shells[i].fade).toBeGreaterThan(0);
      expect(at(1, true).shells[i].radius).toBe(at(1).shells[i].radius);
    }
  });

  it('writes into the caller-owned frame without allocating', () => {
    const own = createDgGoalWaveFrame();
    const shells = own.shells;
    const first = own.shells[0];
    const out = deepglassGoalWaveFrame(1, false, own);
    expect(out).toBe(own);
    expect(out.shells).toBe(shells);
    expect(out.shells[0]).toBe(first);
  });

  it('is a pure function of its inputs', () => {
    const a = createDgGoalWaveFrame();
    const b = createDgGoalWaveFrame();
    deepglassGoalWaveFrame(0.7, false, a);
    // Same t after an unrelated call must give the same answer.
    deepglassGoalWaveFrame(2.2, false, b);
    deepglassGoalWaveFrame(0.7, false, b);
    expect(b).toEqual(a);
  });
});
