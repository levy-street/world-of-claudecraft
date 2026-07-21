export interface AiReviewFinding {
  severity: 'high' | 'medium' | 'low';
  category: 'correctness' | 'security' | 'invariants' | 'tests' | 'maintainability';
  path: string;
  line: number | null;
  message: string;
  recommendation: string;
}

export interface AiReviewOutput {
  assessment: 'looks_correct' | 'needs_changes' | 'blocked';
  summary: string;
  findings: AiReviewFinding[];
}

export const MAX_COMMENT_BYTES: number;
export function validateReview(value: unknown): AiReviewOutput;
export function renderReview(review: AiReviewOutput, requestActor?: string): string;
