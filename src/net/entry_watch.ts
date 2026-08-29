// Polls a freshly connecting world for entry completion and gives up if too
// long passes with no sign of life. "Sign of life" is either the world
// actually connecting or a legitimate transient-rejection retry starting
// (reconnect_policy.ts: 'character already in world' / 'authentication timed
// out' on the very first join attempt, the same window a mid-session
// auto-reconnect already tolerates): the caller must call noteActivity() on
// every such retry, or a first-attempt backoff that is actively making
// progress (visible to the player via the reconnect overlay) gets killed out
// from under itself by this timeout before it gets anywhere. A genuine hang
// (no response at all, ever) still times out ENTRY_TIMEOUT_MS after the last
// real signal.
export const ENTRY_TIMEOUT_MS = 10_000;

interface EntryWatchWorld {
  readonly connected: boolean;
  readonly playerId: number;
  readonly entities: { has(id: number): boolean };
}

export interface EntryWatchHandle {
  /**
   * Push the timeout deadline out: call on every legitimate retry attempt.
   * When a reconnect is already scheduled, pass its absolute retry time so a
   * long backoff gets its own response window instead of timing out mid-wait.
   */
  noteActivity(nextRetryAtMs?: number): void;
  /** Stop polling. Idempotent. */
  cancel(): void;
}

export function watchWorldEntry(
  world: EntryWatchWorld,
  onReady: () => void,
  onTimedOut: () => void,
): EntryWatchHandle {
  let deadlineAt = Date.now() + ENTRY_TIMEOUT_MS;
  const extendDeadline = (nextRetryAtMs?: number): void => {
    const retryDeadline =
      typeof nextRetryAtMs === 'number' && Number.isFinite(nextRetryAtMs)
        ? nextRetryAtMs + ENTRY_TIMEOUT_MS
        : 0;
    deadlineAt = Math.max(Date.now() + ENTRY_TIMEOUT_MS, retryDeadline);
  };
  const poll = window.setInterval(() => {
    if (world.connected && world.entities.has(world.playerId)) {
      window.clearInterval(poll);
      onReady();
    } else if (Date.now() > deadlineAt) {
      window.clearInterval(poll);
      onTimedOut();
    }
  }, 50);
  return {
    noteActivity: extendDeadline,
    cancel: () => window.clearInterval(poll),
  };
}
