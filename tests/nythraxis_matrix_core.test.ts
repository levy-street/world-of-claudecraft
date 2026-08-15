import { describe, expect, it } from 'vitest';
import {
  activeDps,
  benchmarkAllocation,
  combatElapsed,
  comparisonPlans,
  nythraxisDamageBucket,
  WARLOCK_BENCHMARK_ROWS,
} from '../scripts/lib/nythraxis_matrix_core.mjs';
import { defaultBuild, validateAllocation } from '../src/sim/content/talents';

describe('Nythraxis matrix benchmark allocations', () => {
  it('keeps the requested specialization rows instead of silently using every default row', () => {
    expect(
      benchmarkAllocation(
        {
          spec: 'affliction',
          rows: {
            5: 'default-5',
            8: 'default-8',
            11: 'default-11',
            14: 'default-14',
            17: 'default-17',
            20: 'default-20',
          },
        },
        'affliction',
        {
          14: 'wlk_r14_shadow_mastery',
          17: 'wlk_r17_improved_fear',
        },
      ),
    ).toEqual({
      spec: 'affliction',
      rows: {
        5: 'default-5',
        8: 'default-8',
        11: 'default-11',
        14: 'wlk_r14_shadow_mastery',
        17: 'wlk_r17_improved_fear',
        20: 'default-20',
      },
    });
  });

  it('pins valid level-20 rows for every compared Warlock specialization', () => {
    expect(WARLOCK_BENCHMARK_ROWS).toEqual({
      8: 'wlk_r8_voidfeast',
      14: 'wlk_r14_shadow_mastery',
      17: 'wlk_r17_improved_fear',
      20: 'wlk_r20_chaos_bolt',
    });
    for (const spec of ['affliction', 'destruction', 'demonology']) {
      const allocation = benchmarkAllocation(
        defaultBuild('warlock', 20),
        spec,
        WARLOCK_BENCHMARK_ROWS,
      );
      expect(validateAllocation('warlock', allocation, 20), spec).toEqual({ ok: true });
    }
  });
});

describe('Nythraxis matrix damage attribution', () => {
  it('measures the encounter from a shared post-setup origin', () => {
    expect(combatElapsed(124.8, 4.8)).toBeCloseTo(120);
    expect(combatElapsed(4, 4.8)).toBe(0);
  });

  it('separates living throughput from damage that persists after death', () => {
    expect(activeDps(15_000, 150)).toBe(100);
    expect(activeDps(9_000, 150, 75)).toBe(120);
    expect(activeDps(15_000, 150, 200)).toBe(100);
    expect(activeDps(15_000, 0)).toBe(0);
  });

  it('counts both boss and encounter-add damage while excluding unrelated targets', () => {
    expect(nythraxisDamageBucket(90, 'nythraxis_scourge_of_thornpeak', 90)).toBe('boss');
    expect(nythraxisDamageBucket(91, 'nythraxis_skeleton_warrior', 90)).toBe('add');
    expect(nythraxisDamageBucket(92, 'nythraxis_heroic_priest_add', 90)).toBe('add');
    expect(nythraxisDamageBucket(93, 'nythraxis_heroic_warrior_add', 90)).toBe('add');
    expect(nythraxisDamageBucket(94, 'nythraxis_heroic_rogue_add', 90)).toBe('add');
    expect(nythraxisDamageBucket(95, 'nythraxis_scourge_of_thornpeak', 90)).toBeNull();
    expect(nythraxisDamageBucket(90, 'forest_wolf', 90)).toBe('boss');
    expect(nythraxisDamageBucket(93, 'forest_wolf', 90)).toBeNull();
  });
});

describe('Nythraxis matrix comparison plans', () => {
  it('pairs every compared spec against exactly the same surrounding composition', () => {
    const plans = comparisonPlans({
      tanks: ['tank-a', 'tank-b'],
      healerSets: [['healer-a', 'healer-b']],
      dps: ['warlock-a', 'warlock-b', 'warlock-c', 'rogue', 'mage', 'hunter', 'warrior'],
      compared: ['warlock-a', 'warlock-b', 'warlock-c'],
      dpsSlots: 3,
      limit: 2,
    });

    expect(plans).toHaveLength(6);
    const byPair = new Map<string, typeof plans>();
    for (const plan of plans) {
      const variants = byPair.get(plan.pairKey) ?? [];
      variants.push(plan);
      byPair.set(plan.pairKey, variants);
    }
    expect(byPair.size).toBe(2);
    for (const variants of byPair.values()) {
      expect(variants.map((plan) => plan.comparedKey)).toEqual([
        'warlock-a',
        'warlock-b',
        'warlock-c',
      ]);
      expect(new Set(variants.map((plan) => plan.tank)).size).toBe(1);
      expect(new Set(variants.map((plan) => plan.healerSet.join('+'))).size).toBe(1);
      expect(new Set(variants.map((plan) => plan.baselineDps.join('+'))).size).toBe(1);
      expect(variants.flatMap((plan) => plan.baselineDps)).not.toContain('warlock-a');
      expect(variants.flatMap((plan) => plan.baselineDps)).not.toContain('warlock-b');
      expect(variants.flatMap((plan) => plan.baselineDps)).not.toContain('warlock-c');
    }
  });
});
