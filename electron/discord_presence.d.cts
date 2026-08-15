// Hand-written declarations for electron/discord_presence.cjs so the Vitest
// suite (tests/electron_discord_presence.test.ts) type-checks its imports. Keep
// in sync with the .cjs exports (same convention as notify_guard.d.cts).

export interface DiscordPresenceSocket {
  on: (event: string, listener: (...args: never[]) => void) => unknown;
  write: (data: unknown) => unknown;
  end: () => unknown;
  destroy: () => unknown;
}

export interface DiscordPresenceLog {
  warn: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export interface DiscordPathStats {
  isSocket: () => boolean;
  uid?: number;
}

export interface DiscordActivity {
  details: string;
  timestamps?: { start: number };
}

export interface DiscordPresenceDeps {
  clientId: string | null;
  connect: (path: string) => DiscordPresenceSocket | null;
  statPath: (path: string) => DiscordPathStats | null;
  /** The uid every candidate socket must belong to, or null to skip the check. */
  uid?: number | null;
  clampText?: (value: unknown, maxLength: number) => string;
  platform: string;
  env: Record<string, string | undefined>;
  now: () => number;
  setTimeoutFn: (callback: () => void, delayMs: number) => unknown;
  clearTimeoutFn: (handle: unknown) => void;
  random: () => number;
  pid: number;
  log: DiscordPresenceLog;
  initiallyEnabled?: boolean;
  minSendIntervalMs?: number;
  maxBackoffMs?: number;
  answerTimeoutMs?: number;
}

export interface DiscordPresenceState {
  state: string;
  enabled: boolean;
  desiredActivity: unknown;
  lastSentActivity: unknown;
  pendingNonce: string | null;
  backoffMs: number;
  connectAttempts: number;
}

export interface DiscordPresence {
  setActivity: (activity: unknown) => void;
  setEnabled: (enabled: unknown) => void;
  dispose: () => void;
  stateForTest: () => DiscordPresenceState;
}

export const DISCORD_ANSWER_TIMEOUT_MS: number;
export const DISCORD_BASE_BACKOFF_MS: number;
export const DISCORD_DETAILS_MAX: number;
export const DISCORD_LOG_TEXT_MAX: number;
export const DISCORD_MAX_BACKOFF_MS: number;
export const DISCORD_MIN_SEND_INTERVAL_MS: number;
export const DISCORD_PIPE_SLOTS: number;
export function candidatePipePaths(
  platform: string,
  env: Record<string, string | undefined> | undefined,
): string[];
export function createDiscordPresence(deps: DiscordPresenceDeps): DiscordPresence;
export const DEFAULT_DISCORD_APP_ID: string;
export function resolveDiscordClientId(
  env: Record<string, string | undefined> | undefined,
): string | null;
export function sanitizeDiscordActivity(
  payload: unknown,
  clampTextFn?: (value: unknown, maxLength: number) => string,
): DiscordActivity | null;
