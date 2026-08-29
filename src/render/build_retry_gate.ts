// Keyed failure-cooldown gate for retryable async builds (the rift interior
// build). Timestamp-based on purpose, NO setTimeout: a timer handle would hold
// its owner past teardown and could fire after a context recycle, mutating
// state a successor instance now owns. State dies with the owner instead, and
// the cooldown is read inline on the next attempt.
export class BuildRetryGate {
  private readonly retryAtMs = new Map<string, number>();

  constructor(private readonly cooldownMs: number) {}

  /** Record a failed attempt: the key stays blocked for cooldownMs. */
  markFailed(key: string, nowMs: number): void {
    this.retryAtMs.set(key, nowMs + this.cooldownMs);
  }

  /** True when no failure cooldown blocks the key. A spent cooldown is
   *  cleared on read, so the map only ever holds keys still cooling down. */
  shouldAttempt(key: string, nowMs: number): boolean {
    const at = this.retryAtMs.get(key);
    if (at === undefined) return true;
    if (nowMs < at) return false;
    this.retryAtMs.delete(key);
    return true;
  }
}
