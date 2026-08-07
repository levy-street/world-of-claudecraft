export interface PrFileEntry {
  filename?: string;
  previous_filename?: string | null;
  status?: string;
}

export interface CodeDecision {
  code: boolean;
  reason: string;
}

export const PR_FILES_CAP: number;

export function isCodePath(path: string): boolean;

export function classifyPrFiles(files: readonly PrFileEntry[]): CodeDecision;

export function fetchPrFiles(opts: {
  repo: string;
  prNumber: number;
  token: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  perPage?: number;
  cap?: number;
  timeoutMs?: number;
}): Promise<PrFileEntry[]>;

export function detectCode(opts: {
  eventName: string;
  prNumber: number;
  reportedCount?: number;
  repo: string;
  token: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<CodeDecision & { files?: PrFileEntry[] }>;
