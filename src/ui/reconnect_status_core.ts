// Pure display math for the reconnect overlay: how many whole seconds remain
// until the next scheduled retry. Kept separate from ClientWorld so the
// countdown math is unit-testable without a live socket.
export function secondsUntilRetry(nextRetryAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((nextRetryAtMs - nowMs) / 1000));
}
