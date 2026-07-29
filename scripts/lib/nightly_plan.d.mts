export const NIGHTLY_ISSUE_LABEL: string;
export const NIGHTLY_ISSUE_TITLE: string;
export const NIGHTLY_DRILL_ISSUE_LABEL: string;
export const NIGHTLY_DRILL_ISSUE_TITLE: string;
export const NIGHTLY_LANES_PER_REF: number;

export interface NightlyJobResult {
  name: string;
  conclusion: string;
  html_url: string;
}

export function trackingIssueIdentity(drill: boolean): { label: string; title: string };

export function refNamesFromMatchingRefs(entries: ReadonlyArray<{ ref?: unknown }>): string[];

export function parseTargetsEnv(raw: string | undefined): string[];

export function labelEnsureFailed(ok: boolean, status: number): boolean;

export function pickActiveReleaseBranch(names: readonly string[]): string | null;

export function buildTargets(opts: {
  inputRef?: string | null;
  releaseBranch?: string | null;
  defaultBranch?: string;
}): string[];

export function summarizeRunJobs(
  jobs: ReadonlyArray<{
    name?: string;
    status?: string;
    conclusion?: string | null;
    html_url?: string;
  }>,
): { completed: NightlyJobResult[]; failed: NightlyJobResult[] };

export function renderIssueBody(opts: {
  runUrl: string;
  targets: readonly string[];
  timestamp: string;
  failed: readonly NightlyJobResult[];
}): string;

export function renderFailureComment(opts: {
  runUrl: string;
  timestamp: string;
  failed: readonly NightlyJobResult[];
}): string;

export function renderRecoveryComment(opts: { runUrl: string; timestamp: string }): string;

export type NightlyReportPlan =
  | { action: 'create'; title: string; body: string; labels: string[] }
  | { action: 'update'; issueNumber: number; body: string; comment: string }
  | { action: 'close'; issueNumber: number; comment: string }
  | { action: 'none'; reason: string };

export function planNightlyReport(opts: {
  failed: readonly NightlyJobResult[];
  completed: readonly NightlyJobResult[];
  openIssues: ReadonlyArray<{
    number?: number;
    state?: string;
    title?: string;
    pull_request?: unknown;
  }>;
  runUrl: string;
  targets: readonly string[];
  timestamp: string;
  drill?: boolean;
}): NightlyReportPlan;
