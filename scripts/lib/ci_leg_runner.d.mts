export interface CiLeg {
  name: string;
  cmd: string;
  args: string[];
}

export interface LegResult {
  status: number | null;
  tail: string;
  spawnError?: Error;
}

export const DEFAULT_DRAIN_DEADLINE_MS: number;

export function formatLegHeader(leg: CiLeg): string;

export function createTailKeeper(tailBytes: number): {
  push: (chunk: Buffer) => void;
  retainedBytes: () => number;
  tail: () => string;
};

export function runLeg(opts: {
  cmd: string;
  args: string[];
  cwd: string;
  out?: { write: (chunk: Buffer) => boolean };
  err?: { write: (chunk: Buffer) => boolean };
  log?: (line: string) => unknown;
  tailBytes?: number;
  drainDeadlineMs?: number;
}): Promise<LegResult>;

export function runLegsWithFlakeRetry(opts: {
  legs: CiLeg[];
  cwd: string;
  log?: (line: string) => unknown;
  error?: (line: string) => unknown;
  annotate?: (line: string) => unknown;
  runLegImpl?: typeof runLeg;
}): Promise<{ ok: boolean; status: number; retriedLegNames: string[] }>;
