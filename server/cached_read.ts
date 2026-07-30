// Generic single-flight TTL read cache for expensive server-side reads.
//
// This generalizes two patterns that grew next to each other: the board caches
// in server/main.ts (a TTL freshness gate over one expensive query, stale-serve
// when a refresh fails in ensureDeedsBoard, and the boardEpoch guard that keeps
// a moderation bust from being masked by an in-flight refresh) and the
// singleFlight helper in server/deeds_board_warm.ts (callers racing the same
// cold window share ONE refresh; a settled flight clears its slot so a failure
// retries fresh). New expensive reads get all four behaviors from one factory
// instead of re-growing them by hand.
//
// The epoch guard closes the lost-bust race: a refresh captures the epoch
// before its first await and installs its result only if the epoch is still
// unchanged, so a bust() landing mid-refresh means that refresh must NOT
// reinstall its pre-bust snapshot. Its pre-bust joiners still receive the
// value it computed, but a reader arriving AFTER the bust refuses to join
// the stale flight and starts a fresh one, so post-bust reads always see
// post-bust data.
//
// Wall-clock time is correct here: this is server-only code, never used by the
// deterministic sim. Production callers omit opts.now (Date.now); tests inject
// a fake clock.
//
// Logging contract: a failed refresh's thrown error is logged RAW by the
// stale-serve warning below, so refresh closures must never embed secret or
// player-private material in error messages.

export interface CachedReadOptions {
  ttlMs: number;
  /** Injected clock for tests; production callers omit it (Date.now). */
  now?: () => number;
}

export interface CachedRead<T> {
  /** Serve fresh-within-TTL from cache; otherwise refresh (single-flight). */
  read(): Promise<T>;
  /** Last installed value regardless of freshness, null when cold or busted. */
  peek(): T | null;
  /** Drop the cached value and bump the epoch so an in-flight refresh declines to install. */
  bust(): void;
}

/**
 * Build a cached view over `refresh` (the one expensive read). read() serves
 * an installed value while it is younger than ttlMs, collapses concurrent
 * misses into a single refresh, serves the stale value when a refresh fails
 * after at least one success, and rejects only when the cache is cold (never
 * installed, or busted). bust() empties the cache immediately and declines
 * any in-flight install (the lost-bust race in the header).
 */
export function createCachedRead<T>(
  refresh: () => Promise<T>,
  opts: CachedReadOptions,
): CachedRead<T> {
  const now = opts.now ?? Date.now;
  // The installed value and its install time; null when cold or busted.
  let installed: { at: number; value: T } | null = null;
  // Monotonic bust counter; see the lost-bust race in the header.
  let epoch = 0;
  // The shared in-flight refresh and the epoch it started under; callers
  // racing a miss join it (single-flight).
  let inFlight: { epoch: number; promise: Promise<T> } | null = null;
  // Whether the last read stale-served; used to warn once per failure streak.
  let staleServing = false;

  const refreshShared = (): Promise<T> => {
    // A flight started before the last bust would hand its joiners pre-bust
    // data, so a post-bust reader refuses to join it and starts a fresh
    // flight instead (the stale flight still settles, declines its install
    // via the epoch guard below, and resolves only its own pre-bust joiners).
    // Cost: at most one extra bounded refresh per bust-during-flight.
    if (inFlight === null || inFlight.epoch !== epoch) {
      // Capture the epoch before the refresh's first await so a bust landing
      // mid-flight is visible at install time.
      const flightEpoch = epoch;
      const promise = refresh()
        .then((value) => {
          // Skip the install when a bust landed mid-refresh; the caller still
          // receives this value, and the next read refreshes fresh.
          if (epoch === flightEpoch) {
            installed = { at: now(), value };
            staleServing = false;
          }
          return value;
        })
        .finally(() => {
          // Settled (fulfilled or rejected): clear the slot so the next miss
          // starts a fresh flight rather than sharing a cached rejection.
          // Clear only our own registration: a post-bust flight may already
          // have replaced this one.
          if (inFlight !== null && inFlight.epoch === flightEpoch) inFlight = null;
        });
      inFlight = { epoch: flightEpoch, promise };
    }
    return inFlight.promise;
  };

  return {
    async read(): Promise<T> {
      if (installed !== null && now() - installed.at < opts.ttlMs) return installed.value;
      try {
        return await refreshShared();
      } catch (err) {
        // Stale-serve: a failed refresh returns the last installed value even
        // past its TTL (mirrors ensureDeedsBoard); only a cold cache rejects.
        // Warn once per failure streak so a long brownout (a peer process
        // serving a pre-moderation board past its TTL) is visible in the logs.
        if (installed !== null) {
          if (!staleServing) {
            staleServing = true;
            console.warn('cached read refresh failed; serving the stale value:', err);
          }
          return installed.value;
        }
        throw err;
      }
    },
    peek(): T | null {
      return installed === null ? null : installed.value;
    },
    bust(): void {
      epoch++;
      installed = null;
    },
  };
}
