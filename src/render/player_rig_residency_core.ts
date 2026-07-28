import type { RigBudgetDecision } from './articulated_rig_budget_core';

/**
 * Compute the two-phase player-rig residency transition into caller-owned
 * arrays. Releases are deliberately separate so the renderer returns every
 * demoted rig to the finite pool before satisfying promotions.
 */
export function planPlayerRigResidency(
  decisions: readonly RigBudgetDecision[],
  residentIds: ReadonlySet<number>,
  releaseIds: number[],
  acquireIds: number[],
): void {
  releaseIds.length = 0;
  acquireIds.length = 0;

  for (const decision of decisions) {
    const resident = residentIds.has(decision.id);
    if (decision.mode === 'batchedFar') {
      if (resident) releaseIds.push(decision.id);
    } else if (!resident) {
      acquireIds.push(decision.id);
    }
  }
}
