export interface ReviewCommand {
  command: 'review' | 'suggest';
  focus: string;
}

export interface ReviewContext {
  mode: 'automatic' | 'requested';
  repository: string;
  prNumber: string;
  baseSha: string;
  headSha: string;
  requestCommentId: string;
  requestActor: string;
  focus: string;
}

export function parseReviewCommand(body: unknown): ReviewCommand | null;
export function contextFromPullRequestEvent(event: unknown, repository: string): ReviewContext;
export function renderReviewPrompt(template: string, values: Record<string, unknown>): string;
export function buildReviewHarness(env: Record<string, string | undefined>): void;
