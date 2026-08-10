export declare const GATE_BYTES_PER_WORKER: number;

export type MachineTier = 'low' | 'medium' | 'high';

export interface MachineFacts {
  platform: string;
  arch: string;
  cpuCount: number;
  totalMemBytes: number;
  freeMemBytes: number;
  totalMemGb: number;
  freeMemGb: number;
  nodeVersion: string;
  processPlatform: string;
  gateMaxWorkers: string | null;
  tier: MachineTier;
}

export interface FileDuration {
  file: string;
  durationMs: number;
}

export interface RankedFileDuration extends FileDuration {
  rank: number;
}

export interface GateProfileStep {
  name: string;
  cmd: string;
  args: string[];
  /** Optional env overlay (e.g. WOC_SKIP_PRETEST=1 on the vitest step). */
  env?: Record<string, string>;
}

export interface TimedStepResult {
  name: string;
  seconds: number;
  status: 'ok' | 'fail' | 'skipped';
  exitCode?: number | null;
}

export interface GateProfileArgs {
  help: boolean;
  factsOnly: boolean;
  steps: boolean;
  vitestSlow: boolean;
  fromJson: string | null;
  top: number;
  skipBrowser: boolean;
  skipBuilds: boolean;
  skipVitest: boolean;
  skipTypes: boolean;
  continueOnError: boolean;
  jsonOut: string | null;
  workersOverride: number | null;
  dryRun: boolean;
}

export declare function classifyMachineTier(input: {
  cpuCount: number;
  totalMemBytes: number;
}): MachineTier;

export declare function collectMachineFacts(
  osApi: {
    // node:os uses functions; tests may inject plain strings.
    platform: string | (() => string);
    arch: string | (() => string);
    availableParallelism?: () => number;
    cpus: () => { length: number };
    totalmem: () => number;
    freemem: () => number;
  },
  processApi: { version: string; platform: string },
  env?: Record<string, string | undefined>,
): MachineFacts;

export declare function extractFileDurations(vitestJson: unknown): FileDuration[];

export declare function rankSlowestFiles(
  vitestJsonOrRows: unknown,
  limit?: number,
): RankedFileDuration[];

export declare function parseGateProfileArgs(argv: ReadonlyArray<string>): GateProfileArgs;

export declare function buildGateProfileSteps(
  workers: number,
  opts?: {
    /** Forwarded to buildFullGateSteps: adds the dedicated release-tier i18n step. */
    releaseTier?: boolean;
    skipBrowser?: boolean;
    skipBuilds?: boolean;
    skipVitest?: boolean;
    skipTypes?: boolean;
    /** Forwarded to buildFullGateSteps: resolveTurboBin's cmd for turbo steps. */
    repoRoot?: string;
  },
): GateProfileStep[];

export declare function formatMachineFacts(
  facts: MachineFacts,
  extra?: {
    workers?: number;
    /** Availability the clamp budgeted against (lib/gate_memory.mjs), when resolved. */
    availableMemGb?: number;
    gitSha?: string;
    npmVersion?: string;
    dateUtc?: string;
  },
): string;

export declare function formatStepTimings(steps: ReadonlyArray<TimedStepResult>): string;

export declare function formatSlowFiles(ranked: ReadonlyArray<RankedFileDuration>): string;

export declare function helpText(): string;
