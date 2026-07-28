export interface StreamingCandidate {
  id: number;
  distanceSq: number;
  actionable: boolean;
  estimatedMs: number;
}

export interface StreamingBudget {
  maxItems: number;
  maxEstimatedMs: number;
}

export interface StreamingBudgetScratch {
  ordered: StreamingCandidate[];
}

export function createStreamingBudgetScratch(): StreamingBudgetScratch {
  return { ordered: [] };
}

export function admitStreamingCandidates(
  candidates: readonly StreamingCandidate[],
  budget: StreamingBudget,
  admittedIds: number[],
  scratch: StreamingBudgetScratch,
): number {
  if (!Number.isInteger(budget.maxItems) || budget.maxItems < 0 || budget.maxEstimatedMs < 0) {
    throw new RangeError('invalid streaming budget');
  }
  admittedIds.length = 0;
  scratch.ordered.length = 0;
  scratch.ordered.push(...candidates);
  scratch.ordered.sort(
    (a, b) =>
      Number(b.actionable) - Number(a.actionable) || a.distanceSq - b.distanceSq || a.id - b.id,
  );
  let estimatedMs = 0;
  for (const candidate of scratch.ordered) {
    if (admittedIds.length >= budget.maxItems) break;
    const nextMs = estimatedMs + Math.max(0, candidate.estimatedMs);
    if (!candidate.actionable && nextMs > budget.maxEstimatedMs) continue;
    admittedIds.push(candidate.id);
    estimatedMs = nextMs;
  }
  return admittedIds.length;
}
