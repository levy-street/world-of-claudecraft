export const DEFAULT_LOCK_HOST: string;
export const DEFAULT_LOCK_PORT: number;
export const DEFAULT_POLL_MS: number;
export const DEFAULT_MAX_WAIT_MS: number;
export const DEFAULT_REANNOUNCE_MS: number;
export const DEFAULT_IDENTIFY_TIMEOUT_MS: number;

export function acquireFullSuiteLock(opts?: {
  optOut?: boolean;
  host?: string;
  port?: number;
  pid?: number;
  ownerId?: string;
  now?: () => number;
  pollMs?: number;
  maxWaitMs?: number;
  reannounceMs?: number;
  identifyTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}): Promise<{ release: () => Promise<void> }>;
