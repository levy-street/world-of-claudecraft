export interface CiStallStep {
  name: string;
  conclusion: string | null;
}

export interface CiStallJob {
  name: string;
  conclusion: string | null;
  steps: CiStallStep[];
  /**
   * Check-run annotation messages for the job; only consulted on the
   * cancelled arm (the bound-kill discriminator). Absent means the driver
   * did not fetch them, which fails the cancelled arm closed.
   */
  annotationMessages?: string[];
}

export interface CiStallRun {
  runAttempt: number;
  runConclusion: string | null;
  jobs: CiStallJob[];
}

export interface CiStallDecision {
  rerun: boolean;
  reason: string;
  stalledJobs: string[];
}

export const SETUP_STEP_RE: RegExp;

export const CHECKOUT_STEP_RE: RegExp;

export const TIMEOUT_ANNOTATION_FRAGMENT: string;

export function decide(run: CiStallRun): CiStallDecision;
