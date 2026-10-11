import { describe, expect, it } from 'vitest';
import {
  CHOSEN_CADENCE_ALLOWED_MISS_SHARE,
  chosenCadenceFrameMs,
  chosenCadenceLoadMs,
  NO_CHOSEN_CADENCE,
} from '../src/render/chosen_cadence_pressure_core';
import { GFX_BUDGETS, type GfxTier } from '../src/render/gfx';
import {
  RenderBudgetGovernor,
  type RenderBudgetSample,
  type RenderBudgetState,
} from '../src/render/render_budget';

// The frame rate ceiling makes the wall interval a choice. Read raw, a held
// 33.4 ms rhythm with an idle main thread is over every tier's frame budget and
// is exactly the external frame cap candidate. Under a chosen cadence the
// governor judges the share of frames missing their slot instead.

const TIERS: GfxTier[] = ['low', 'medium', 'high', 'ultra', 'insane'];

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

function governor(tier: GfxTier): RenderBudgetGovernor {
  const g = new RenderBudgetGovernor({ tier, budget: GFX_BUDGETS[tier], enabled: true });
  g.reset(1, 1, 1);
  return g;
}

function run(
  g: RenderBudgetGovernor,
  seconds: number,
  overrides: Partial<RenderBudgetSample>,
): { state: RenderBudgetState; probed: boolean; degraded: boolean } {
  let state = g.state();
  let probed = false;
  let degraded = false;
  for (let t = 0; t < seconds; t += 1 / 30) {
    state = g.update(sample(overrides));
    if (state.frameCapProbe !== 'idle' || state.externalFrameCap) probed = true;
    if (state.mode === 'degrading') degraded = true;
  }
  return { state, probed, degraded };
}

describe('chosen cadence reading', () => {
  it.each(TIERS)('%s: a held rhythm reads under the recover line', (tier) => {
    const b = GFX_BUDGETS[tier];
    expect(chosenCadenceFrameMs(0, b.dropFrameMs, b.recoverFrameMs)).toBeLessThan(b.recoverFrameMs);
  });

  it.each(TIERS)('%s: the allowed miss share lands exactly on the drop line', (tier) => {
    const b = GFX_BUDGETS[tier];
    expect(
      chosenCadenceFrameMs(CHOSEN_CADENCE_ALLOWED_MISS_SHARE, b.dropFrameMs, b.recoverFrameMs),
    ).toBeCloseTo(b.dropFrameMs, 6);
  });

  it.each(TIERS)('%s: a machine missing most slots reads urgent', (tier) => {
    const b = GFX_BUDGETS[tier];
    expect(chosenCadenceFrameMs(0.4, b.dropFrameMs, b.recoverFrameMs)).toBeGreaterThanOrEqual(
      b.urgentFrameMs,
    );
  });

  it('reads the load as nominal while the chosen interval is held, late past it', () => {
    expect(chosenCadenceLoadMs(33.4, 33.4)).toBeCloseTo(16.67, 1);
    expect(chosenCadenceLoadMs(50, 33.4)).toBeCloseTo(33.27, 1);
    // No chosen cadence (including a real 30 Hz display): the wall interval stands.
    expect(chosenCadenceLoadMs(33.4, 0)).toBe(33.4);
  });
});

describe('governor under a chosen cadence', () => {
  it('without it, a held 33 ms rhythm with an idle main thread opens the cap probe', () => {
    const r = run(governor('low'), 20, {});
    expect(r.probed).toBe(true);
  });

  it('a real 30 Hz display keeps today’s behavior: the marker is not a cadence', () => {
    const r = run(governor('low'), 20, { chosenCadenceMissShare: NO_CHOSEN_CADENCE });
    expect(r.probed).toBe(true);
  });

  it.each(TIERS)('%s: a held chosen cadence opens no probe and sheds nothing', (tier) => {
    const r = run(governor(tier), 30, { chosenCadenceMissShare: 0 });
    expect(r.probed).toBe(false);
    expect(r.degraded).toBe(false);
    expect(r.state.reason).not.toBe('frame-cap');
  });

  it.each(TIERS)('%s: a chosen cadence that keeps missing its slot sheds quality', (tier) => {
    const r = run(governor(tier), 30, { chosenCadenceMissShare: 0.3 });
    expect(r.probed).toBe(false);
    expect(r.degraded).toBe(true);
  });

  it('CPU-side cost still reads over budget under a held chosen cadence', () => {
    const held = run(governor('low'), 30, { chosenCadenceMissShare: 0 });
    expect(held.state.pressure).toBeLessThan(1);
    const costly = run(governor('low'), 30, { chosenCadenceMissShare: 0, totalMs: 26 });
    expect(costly.state.pressure).toBeGreaterThanOrEqual(1);
    expect(costly.probed).toBe(false);
  });
});

describe('governor under an automatic ceiling', () => {
  // The hierarchy of frame_cadence_auto_core.ts: while the automatic ceiling is
  // in force the headroom goes to the cadence, so quality never climbs back and
  // then fails the next return trial.
  function shedThenRest(holdRecovery: boolean): number {
    const g = governor('high');
    run(g, 20, { chosenCadenceMissShare: 0.3 });
    const shed = g.state().levels.foliage;
    const rested = run(g, 120, {
      chosenCadenceMissShare: 0,
      holdRecovery,
      totalMs: 6,
      submitMs: 3,
    });
    return rested.state.levels.foliage - shed;
  }

  it('recovers quality at a held manual ceiling', () => {
    expect(shedThenRest(false)).toBeGreaterThan(0);
  });

  it('holds its quality levels while the automatic ceiling asks it to', () => {
    expect(shedThenRest(true)).toBe(0);
  });

  it('still sheds under the hold: only recovery is held', () => {
    const r = run(governor('high'), 30, { chosenCadenceMissShare: 0.3, holdRecovery: true });
    expect(r.degraded).toBe(true);
  });
});

describe('a ceiling engaging while a cap probe is in flight', () => {
  it('restores what the probe shed and refuses nothing', () => {
    const g = governor('low');
    const before = { ...g.state().levels };
    // A held 33 ms rhythm with an idle main thread opens the probe and sheds.
    let shed = g.state();
    for (let t = 0; t < 20 && shed.frameCapProbe !== 'shed'; t += 1 / 30) shed = g.update(sample());
    expect(shed.frameCapProbe).toBe('shed');
    for (let i = 0; i < 40; i++) shed = g.update(sample());
    expect(shed.levels.foliage).toBeLessThan(before.foliage);
    // The ceiling engages, with the automatic mode's recovery hold.
    const engaged = run(g, 10, { chosenCadenceMissShare: 0, holdRecovery: true });
    expect(engaged.state.frameCapProbe).toBe('idle');
    expect(engaged.state.levels).toEqual(before);
    // No refusal was earned: once the ceiling lifts the candidate may probe again.
    const lifted = run(g, 20, {});
    expect(lifted.probed).toBe(true);
  });
});

describe('no chosen cadence', () => {
  it('leaves the governor exactly as it was: the marker and an absent field are one state', () => {
    const trace = (overrides: Partial<RenderBudgetSample>) => {
      const g = governor('medium');
      const states: string[] = [];
      for (let i = 0; i < 1800; i++) {
        // A session with a light stretch, a heavy one and a stall.
        const heavy = i > 600 && i < 1200;
        const stall = i === 900;
        states.push(
          JSON.stringify(
            g.update(
              sample({
                frameMs: heavy ? 29 : 16.7,
                dt: heavy ? 0.029 : 1 / 60,
                totalMs: heavy ? 21 : 7,
                submitMs: stall ? 90 : 5,
                ...overrides,
              }),
            ),
          ),
        );
      }
      return states;
    };
    expect(trace({ chosenCadenceMissShare: NO_CHOSEN_CADENCE, holdRecovery: false })).toEqual(
      trace({}),
    );
  });
});

describe('a ceiling engaging while a cap probe lost its origin', () => {
  it('restores the band baselines: a stall during a dwell must not freeze the floors', () => {
    const g = governor('low');
    const before = { ...g.state().levels };
    let s = g.state();
    for (let t = 0; t < 60 && s.frameCapProbe !== 'restored'; t += 1 / 30) s = g.update(sample());
    expect(s.frameCapProbe).toBe('restored');
    // A submit stall during the dwell sheds for real, which clears the origin.
    // (One frame: a run of them lapses the candidate and ends the probe by itself.)
    s = g.update(sample({ submitMs: 120, totalMs: 130 }));
    expect(s.frameCapProbe).toBe('restored');
    expect(s.levels.foliage).toBeLessThan(before.foliage);
    // The automatic ceiling engages with its recovery hold: nothing may stay shed.
    const engaged = run(g, 30, { chosenCadenceMissShare: 0, holdRecovery: true });
    expect(engaged.state.frameCapProbe).toBe('idle');
    expect(engaged.state.levels).toEqual(before);
  });
});

describe('a ceiling engaging on a probe that had nothing to shed', () => {
  it('installs the band baselines, like the probe itself does, never the floors back', () => {
    const g = governor('low');
    const before = { ...g.state().levels };
    // A real disaster first: the ladder is driven to its floors.
    const floored = run(g, 120, { frameMs: 70, dt: 0.07, totalMs: 60, submitMs: 30 });
    for (const bucket of ['grass', 'foliage', 'lighting', 'vfx'] as const) {
      expect(floored.state.levels[bucket]).toBeLessThan(before[bucket]);
    }
    // Then a held 33 ms rhythm with an idle main thread opens a probe that
    // sheds nothing and reaches its restored dwell on the baselines.
    let s = g.state();
    for (let t = 0; t < 240 && s.frameCapProbe !== 'restored'; t += 1 / 30) s = g.update(sample());
    expect(s.frameCapProbe).toBe('restored');
    expect(s.levels).toEqual(before);
    // Read on the engaging frame itself: what the abandon wrote, before the
    // governor's own later steps.
    const engaged = g.update(sample({ chosenCadenceMissShare: 0, holdRecovery: true }));
    expect(engaged.frameCapProbe).toBe('idle');
    // (The same update may already take one ordinary step off a bucket; the
    // floors written back would read 0.5 here, not the baselines.)
    expect(engaged.levels.grass).toBe(before.grass);
    expect(engaged.levels.foliage).toBe(before.foliage);
    expect(engaged.levels.lighting).toBe(before.lighting);
    expect(engaged.levels.vfx).toBeGreaterThan(floored.state.levels.vfx + 0.1);
  });
});

describe('the governor at baseline (the automatic ceiling headroom evidence)', () => {
  it('is at baseline once settled with nothing shed', () => {
    const g = governor('medium');
    run(g, 5, { chosenCadenceMissShare: 0 });
    expect(g.atBaseline(1)).toBe(true);
  });

  it('is not at baseline while shedding, nor once floored, nor before quality is back', () => {
    const g = governor('medium');
    const shed = run(g, 60, { chosenCadenceMissShare: 0.5 });
    expect(shed.degraded).toBe(true);
    expect(g.atBaseline(1)).toBe(false);
    // The rhythm holds again, but recovery is held: the levels stay shed.
    run(g, 120, { chosenCadenceMissShare: 0, holdRecovery: true });
    expect(g.atBaseline(1)).toBe(false);
    // Released, the governor climbs back, and only then reads as at baseline.
    run(g, 600, { chosenCadenceMissShare: 0 });
    expect(g.atBaseline(1)).toBe(true);
  });

  it('is not at baseline with render scale still under its maximum', () => {
    const g = governor('medium');
    run(g, 5, { chosenCadenceMissShare: 0 });
    expect(g.atBaseline(1.5)).toBe(false);
  });

  it('a disabled governor never took anything', () => {
    const g = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: false,
    });
    expect(g.atBaseline(1)).toBe(true);
  });
});
