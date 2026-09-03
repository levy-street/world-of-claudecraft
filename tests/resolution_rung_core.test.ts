import { describe, expect, it } from 'vitest';
import { GFX_BUDGETS } from '../src/render/gfx';
import { RenderBudgetGovernor, type RenderBudgetSample } from '../src/render/render_budget';
import {
  RESOLUTION_RUNG_STEP,
  resolutionAllocationScale,
  resolutionRungCount,
  resolutionRungFor,
  resolutionRungLadder,
  resolutionRungTransition,
} from '../src/render/resolution_rung_core';

describe('resolution rung ladder', () => {
  it('spaces the rungs nearest to the step between the ceiling and the tier floor', () => {
    expect(RESOLUTION_RUNG_STEP).toBe(0.1);
    // Desktop floors (GFX_BUDGETS.<tier>.minRenderScaleDesktop).
    expect(resolutionRungLadder(1, GFX_BUDGETS.ultra.minRenderScaleDesktop)).toEqual([
      1, 0.89, 0.78,
    ]);
    expect(resolutionRungLadder(1, GFX_BUDGETS.insane.minRenderScaleDesktop)).toEqual([
      1, 0.89, 0.78,
    ]);
    expect(resolutionRungLadder(1, GFX_BUDGETS.high.minRenderScaleDesktop)).toEqual([
      1, 0.9, 0.8, 0.7,
    ]);
    // Mobile floors (GFX_BUDGETS.<tier>.minRenderScaleMobile).
    expect(resolutionRungLadder(1, GFX_BUDGETS.ultra.minRenderScaleMobile)).toEqual([
      1, 0.893, 0.787, 0.68,
    ]);
    expect(resolutionRungLadder(1, GFX_BUDGETS.high.minRenderScaleMobile)).toEqual([
      1, 0.9, 0.8, 0.7, 0.6,
    ]);
  });

  it('ends on the floor exactly and starts on the ceiling exactly', () => {
    for (const tier of ['high', 'ultra', 'insane'] as const) {
      for (const floor of [
        GFX_BUDGETS[tier].minRenderScaleDesktop,
        GFX_BUDGETS[tier].minRenderScaleMobile,
      ]) {
        for (const ceiling of [1, 0.95, 0.9, 0.85]) {
          const ladder = resolutionRungLadder(ceiling, floor);
          expect(ladder[0], `${tier} ${ceiling}/${floor}`).toBe(ceiling);
          expect(ladder[ladder.length - 1], `${tier} ${ceiling}/${floor}`).toBe(
            Math.min(ceiling, floor),
          );
          for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeLessThan(ladder[i - 1]);
        }
      }
    }
  });

  it('collapses to the ceiling alone when the manual ceiling sits at or below the floor', () => {
    expect(resolutionRungCount(0.78, 0.78)).toBe(0);
    expect(resolutionRungLadder(0.6, 0.78)).toEqual([0.6]);
    expect(resolutionRungLadder(0.78, 0.78)).toEqual([0.78]);
    expect(resolutionRungFor(0.5, 0.6, 0.78)).toBe(0.6);
  });

  it('holds a band narrower than half a step: a storm for a few percent cannot pay for itself', () => {
    // The Render Quality slider at 0.8 on ultra (floor 0.78).
    expect(resolutionRungCount(0.8, 0.78)).toBe(0);
    expect(resolutionRungLadder(0.8, 0.78)).toEqual([0.8]);
    expect(resolutionRungTransition(0.8, 0.5, 0.8, 0.78)).toBe(0.8);
    // Half a step and up gets its one rung.
    expect(resolutionRungLadder(0.85, 0.78)).toEqual([0.85, 0.78]);
  });

  it('keeps a narrow band as one rung rather than none', () => {
    // 0.9 to 0.78 is 1.2 steps: one rung, so a lowered slider still has a lever.
    expect(resolutionRungLadder(0.9, 0.78)).toEqual([0.9, 0.78]);
  });

  it('maps a level to the highest rung at or below it, never above the level', () => {
    expect(resolutionRungFor(1, 1, 0.78)).toBe(1);
    expect(resolutionRungFor(0.92, 1, 0.78)).toBe(0.89);
    expect(resolutionRungFor(0.89, 1, 0.78)).toBe(0.89);
    expect(resolutionRungFor(0.84, 1, 0.78)).toBe(0.78);
    expect(resolutionRungFor(0.5, 1, 0.78)).toBe(0.78);
    expect(resolutionRungFor(1.2, 1, 0.78)).toBe(1);
    expect(resolutionRungFor(Number.NaN, 1, 0.78)).toBe(1);
  });
});

describe('resolution rung hysteresis', () => {
  it('sheds only when the level reaches the rung below and climbs only on the rung above', () => {
    let held = 1;
    const walk: number[] = [];
    // The ultra governor's normal drop is 0.08 and its recover step 0.04.
    for (const level of [0.92, 0.84, 0.78, 0.82, 0.86, 0.9, 0.94, 0.98, 1]) {
      held = resolutionRungTransition(held, level, 1, 0.78);
      walk.push(held);
    }
    expect(walk).toEqual([1, 0.89, 0.78, 0.78, 0.78, 0.89, 0.89, 0.89, 1]);
  });

  it('walks one rung per step whatever the level did, on every tier ladder', () => {
    // The real GFX_BUDGETS drop steps (ultra 0.08, insane 0.06, urgent 0.12
    // and 0.1) are not divisors of the 0.11 ultra stride: without the clamp
    // the middle rung would be skipped on the way down.
    for (const [tier, step] of [
      ['ultra', GFX_BUDGETS.ultra.dropStep],
      ['ultra', GFX_BUDGETS.ultra.urgentDropStep],
      ['insane', GFX_BUDGETS.insane.dropStep],
      ['high', GFX_BUDGETS.high.dropStep],
    ] as const) {
      for (const floor of [
        GFX_BUDGETS[tier].minRenderScaleDesktop,
        GFX_BUDGETS[tier].minRenderScaleMobile,
      ]) {
        const ladder = resolutionRungLadder(1, floor);
        const visited = [1];
        let held = 1;
        let level = 1;
        while (held > floor + 0.0005) {
          level = Math.max(floor, Math.round((level - step) * 100) / 100);
          const next = resolutionRungTransition(held, level, 1, floor);
          if (next !== held) visited.push(next);
          held = next;
        }
        expect(visited, `${tier} floor ${floor} step ${step}`).toEqual(ladder);
        // A level that jumps straight to the floor still climbs down one rung at a time.
        expect(resolutionRungTransition(1, floor, 1, floor)).toBe(ladder[1]);
        expect(resolutionRungTransition(floor, 1, 1, floor)).toBe(ladder[ladder.length - 2]);
      }
    }
  });

  it('holds an off-ladder scale until the level leaves its band', () => {
    // The mobile opening scale (initialEffectiveRenderScale) is 0.85, between
    // two rungs of the mobile ultra ladder [1, 0.893, 0.787, 0.68].
    expect(resolutionRungTransition(0.85, 0.85, 1, 0.68)).toBe(0.85);
    expect(resolutionRungTransition(0.85, 0.8, 1, 0.68)).toBe(0.85);
    expect(resolutionRungTransition(0.85, 0.787, 1, 0.68)).toBe(0.787);
    expect(resolutionRungTransition(0.85, 0.89, 1, 0.68)).toBe(0.85);
    expect(resolutionRungTransition(0.85, 0.893, 1, 0.68)).toBe(0.893);
  });

  it('never leaves the ceiling-to-floor band and is monotone in the level', () => {
    for (const floor of [0.78, 0.7, 0.68, 0.6]) {
      for (let previous = 0.5; previous <= 1.001; previous += 0.01) {
        let last = Number.NEGATIVE_INFINITY;
        for (let level = 0.5; level <= 1.001; level += 0.01) {
          const next = resolutionRungTransition(previous, level, 1, floor);
          expect(next).toBeGreaterThanOrEqual(floor);
          expect(next).toBeLessThanOrEqual(1);
          expect(next).toBeGreaterThanOrEqual(last);
          last = next;
        }
      }
    }
  });

  it('follows a real ultra governor walk in fewer, coarser steps than the governor takes', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'ultra',
      budget: GFX_BUDGETS.ultra,
      enabled: true,
    });
    governor.reset(1, 0.78, 1);
    const sample: RenderBudgetSample = {
      dt: 1 / 60,
      frameMs: 60,
      totalMs: 58,
      submitMs: 30,
      calls: 1_200,
      triangles: 9_500_000,
      grassVisibleTufts: 12_000,
      grassVisibleChunks: 20,
      activeViews: 40,
      createdViews: 0,
      minRenderScale: 0.78,
      maxRenderScale: 1,
    };
    let held = 1;
    let governorSteps = 0;
    let reallocations = 0;
    let lastLevel = 1;
    for (let frame = 0; frame < 60 * 40; frame++) {
      const state = governor.update(sample);
      if (Math.abs(state.levels.resolution - lastLevel) >= 0.001) governorSteps++;
      lastLevel = state.levels.resolution;
      const next = resolutionRungTransition(held, state.levels.resolution, 1, 0.78);
      if (Math.abs(next - held) >= 0.001) reallocations++;
      held = next;
    }
    expect(lastLevel).toBe(0.78);
    expect(held).toBe(0.78);
    expect(governorSteps).toBeGreaterThanOrEqual(2);
    expect(reallocations).toBeLessThanOrEqual(governorSteps);
    expect(reallocations).toBeLessThanOrEqual(resolutionRungCount(1, 0.78));

    // Recovery: headroom walks the level back up in 0.04 steps; the allocation
    // climbs a whole rung at a time and reaches the ceiling with the level.
    const calm: RenderBudgetSample = {
      ...sample,
      frameMs: 8,
      totalMs: 7,
      submitMs: 2,
      calls: 200,
      triangles: 500_000,
      grassVisibleTufts: 1_000,
    };
    let climbs = 0;
    for (let frame = 0; frame < 60 * 180; frame++) {
      const state = governor.update(calm);
      const next = resolutionRungTransition(held, state.levels.resolution, 1, 0.78);
      if (next > held + 0.001) climbs++;
      expect(next).toBeGreaterThanOrEqual(held - 0.001);
      held = next;
      lastLevel = state.levels.resolution;
    }
    expect(lastLevel).toBe(1);
    expect(held).toBe(1);
    expect(climbs).toBe(resolutionRungCount(1, 0.78));
  });
});

describe('resolution allocation scale', () => {
  it('walks the rungs on the allocation path and clamps the level elsewhere', () => {
    const base = { pin: null, previous: 1, level: 0.84, ceiling: 1, floor: 0.78 };
    expect(resolutionAllocationScale({ ...base, mode: 'allocation' })).toBe(0.89);
    expect(
      resolutionAllocationScale({ ...base, mode: 'allocation', previous: 0.89, level: 0.78 }),
    ).toBe(0.78);
    expect(resolutionAllocationScale({ ...base, mode: 'region' })).toBe(0.84);
    expect(resolutionAllocationScale({ ...base, mode: 'locked' })).toBe(0.84);
    expect(resolutionAllocationScale({ ...base, mode: 'region', level: 0.5 })).toBe(0.78);
    expect(resolutionAllocationScale({ ...base, mode: 'region', level: 1.5 })).toBe(1);
  });

  it('honours the dev pin exactly on every path, below the floor but never above the ceiling', () => {
    for (const mode of ['allocation', 'region', 'locked'] as const) {
      // The Render Quality slider (and the tier cap) at 0.8: the pin cannot allocate above it.
      expect(
        resolutionAllocationScale({
          mode,
          pin: 1,
          previous: 0.8,
          level: 0.8,
          ceiling: 0.8,
          floor: 0.78,
        }),
      ).toBe(0.8);
      expect(
        resolutionAllocationScale({
          mode,
          pin: 0.6,
          previous: 1,
          level: 1,
          ceiling: 1,
          floor: 0.78,
        }),
      ).toBe(0.6);
      expect(
        resolutionAllocationScale({
          mode,
          pin: 0.85,
          previous: 1,
          level: 1,
          ceiling: 1,
          floor: 0.78,
        }),
      ).toBe(0.85);
    }
    expect(
      resolutionAllocationScale({
        mode: 'allocation',
        pin: 0.2,
        previous: 1,
        level: 1,
        ceiling: 1,
        floor: 0.78,
      }),
    ).toBe(0.5);
  });
});
