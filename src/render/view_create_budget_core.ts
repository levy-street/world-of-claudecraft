export interface ViewCreateBudgetInput {
  dtSeconds: number;
  constrained: boolean;
  budgetPressure: number;
  entryElapsedMs: number;
}

export interface ViewCreateBudget {
  maxViews: number;
  maxStartWorkMs: number;
}

export function viewCreateBudget(input: ViewCreateBudgetInput): ViewCreateBudget {
  const dtMs = Math.max(0, input.dtSeconds * 1000);
  const pressure = Math.min(1, Math.max(0, input.budgetPressure));
  const entry = input.entryElapsedMs < 12_000;
  const baseCount = input.constrained ? 2 : 8;
  const framePenalty = dtMs > 30 ? 0.35 : dtMs > 20 ? 0.65 : 1;
  const pressureScale = 1 - pressure * 0.75;
  const entryScale = entry ? 0.75 : 1;
  return {
    maxViews: Math.max(1, Math.floor(baseCount * framePenalty * pressureScale * entryScale)),
    maxStartWorkMs: input.constrained
      ? Math.max(0.75, 1.75 - pressure)
      : Math.max(1.25, 3 - pressure * 1.5),
  };
}
