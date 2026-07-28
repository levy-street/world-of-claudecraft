import { describe, expect, it } from 'vitest';
import {
  admitStreamingCandidates,
  createStreamingBudgetScratch,
} from '../src/render/streaming_budget_core';

describe('streaming admission budget', () => {
  it('admits actionable work first and keeps ordinary work inside time and count', () => {
    const admitted: number[] = [];
    admitStreamingCandidates(
      [
        { id: 1, actionable: false, distanceSq: 1, estimatedMs: 1.5 },
        { id: 2, actionable: true, distanceSq: 100, estimatedMs: 2 },
        { id: 3, actionable: false, distanceSq: 4, estimatedMs: 1 },
      ],
      { maxItems: 3, maxEstimatedMs: 2.5 },
      admitted,
      createStreamingBudgetScratch(),
    );
    expect(admitted).toEqual([2]);
  });
});
