// An in-memory RateLimitStore for tests. It implements the frozen contract from
// server/http/types and mirrors the sliding-window decision of
// recordSlidingWindowAttempt in server/ratelimit (prune entries at or before the
// window start, push now, then compare the count against maxPerMinute) so the
// fake and the real limiter agree by construction. The clock is injected at
// construction (NOT a method arg), so windows and resetSeconds are deterministic
// in tests. WINDOW_MS is imported from server/ratelimit as the single source of
// truth (no magic 60000).

import type { RateLimitOutcome, RateLimitStore } from '../../../server/http/types';
import { WINDOW_MS } from '../../../server/ratelimit';

export class FakeRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, maxPerMinute: number): RateLimitOutcome {
    const now = this.now();
    const windowStart = now - WINDOW_MS;
    // Prune-then-push-then-compare, exactly like recordSlidingWindowAttempt:
    // keep only timestamps strictly newer than windowStart, then record now.
    const pruned = (this.windows.get(key) ?? []).filter((t) => t > windowStart);
    const updated = [...pruned, now];
    this.windows.set(key, updated);

    const count = updated.length;
    // recordSlidingWindowAttempt returns "limited" when count > maxPerMinute, so
    // an attempt is allowed exactly while count <= maxPerMinute.
    const allowed = count <= maxPerMinute;
    const remaining = Math.max(0, maxPerMinute - count);
    // Seconds until the oldest in-window entry ages out of the window. The push
    // above always leaves at least `now` in the window, so updated[0] is defined.
    const oldest = updated[0];
    const resetSeconds = Math.max(0, Math.ceil((oldest + WINDOW_MS - now) / 1000));

    return { allowed, remaining, resetSeconds };
  }

  reset(): void {
    this.windows.clear();
  }
}
