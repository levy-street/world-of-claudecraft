import { describe, expect, it } from 'vitest';
import {
  articulatedRigLimit,
  createRigBudgetScratch,
  planArticulatedRigs,
  type RigBudgetDecision,
} from '../src/render/articulated_rig_budget_core';
import { planPlayerRigResidency } from '../src/render/player_rig_residency_core';

describe('articulated rig budget', () => {
  it('preserves every actionable pose outside the ordinary rig ceiling', () => {
    const decisions: RigBudgetDecision[] = [];
    planArticulatedRigs(
      [
        { id: 1, distanceSq: 1000, actionable: true },
        { id: 2, distanceSq: 1, actionable: false },
        { id: 3, distanceSq: 4, actionable: false },
        { id: 4, distanceSq: 9, actionable: false },
      ],
      1,
      1,
      decisions,
      createRigBudgetScratch(),
    );
    expect(decisions).toEqual([
      { id: 1, mode: 'rig' },
      { id: 2, mode: 'rig' },
      { id: 3, mode: 'localFar' },
      { id: 4, mode: 'batchedFar' },
    ]);
  });

  it('reduces the ceiling with memory and frame pressure', () => {
    expect(articulatedRigLimit('ultra', false, 0)).toBe(32);
    expect(articulatedRigLimit('ultra', true, 1)).toBeLessThan(20);
    expect(articulatedRigLimit('low', true, 1)).toBe(6);
  });

  it('releases batched players and acquires only rig-backed modes', () => {
    const releases: number[] = [];
    const acquires: number[] = [];
    planPlayerRigResidency(
      [
        { id: 1, mode: 'rig' },
        { id: 2, mode: 'localFar' },
        { id: 3, mode: 'batchedFar' },
        { id: 4, mode: 'batchedFar' },
      ],
      new Set([1, 3]),
      releases,
      acquires,
    );
    expect(releases).toEqual([3]);
    expect(acquires).toEqual([2]);
  });
});
