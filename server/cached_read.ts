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

// ---------------------------------------------------------------------------
// The KEYED sibling: a bounded map of per-key CachedRead instances. It lives
// here, beside the single-value factory it composes, because it is generic:
// it grew for the Discord status core (server/discord_status_cache.ts, which
// re-exports it for its own callers and tests) and the guild bank activity log
// (server/guild_bank_log.ts) is the second domain to need exactly it. A domain
// module importing another domain module for a generic would be the wrong
// seam; the cache seam is this file.
// ---------------------------------------------------------------------------

export interface KeyedCachedReadOptions {
  ttlMs: number;
  /** Hard entry bound; the least-recently-read key is evicted at the cap. */
  maxEntries: number;
  /** Injected clock for tests; production callers omit it (Date.now). */
  now?: () => number;
}

/**
 * A bounded map of per-key CachedRead instances: TTL, single-flight, and
 * stale-on-error per key via createCachedRead; bust-by-key, bust-all, and the
 * entry bound owned here. A key is whatever the owning domain keys by (account
 * ids for the Discord status core, guild ids for the guild bank activity log);
 * each domain holds its OWN instance, so the key domains never meet and an
 * entry can never be served for any key other than the one it is stored under.
 */
export interface KeyedCachedReadStats {
  /** read() calls since construction. */
  reads: number;
  /** Refresh flights started (cold misses + TTL expiries + post-bust reads). */
  refreshes: number;
  /** Entries dropped by the cap, never by bust. */
  evictions: number;
  /** Entries dropped by bust()/bustAll(). */
  busts: number;
  /** Live entry count (same value size() returns). */
  entries: number;
}

export class KeyedCachedRead<T> {
  private readonly entries = new Map<number, CachedRead<T>>();
  // Refresh telemetry, the DailyRewardBoardCache.stats() shape: this cache
  // refreshes on demand after busts, so its query rate is bust rate times
  // status arrival rate, and these counters are what make eviction thrash, a
  // bust storm, or a brownout's refresh churn observable at all (a metrics
  // export can wire them up later).
  private readCount = 0;
  private refreshCount = 0;
  private evictionCount = 0;
  private bustCount = 0;

  constructor(
    private readonly refresh: (key: number) => Promise<T>,
    private readonly opts: KeyedCachedReadOptions,
  ) {
    // Loud at wiring time: a non-positive TTL would serve every read stale or
    // never, and a non-positive cap would refuse every entry. Callers that read
    // their bounds from the environment sanitize them first (see
    // positiveIntFromEnv in discord_status_cache.ts); this guards every direct
    // construction, including the ones that pass literals.
    if (!Number.isFinite(opts.ttlMs) || opts.ttlMs <= 0)
      throw new Error(`KeyedCachedRead ttlMs must be positive, got ${opts.ttlMs}`);
    if (!Number.isInteger(opts.maxEntries) || opts.maxEntries <= 0)
      throw new Error(
        `KeyedCachedRead maxEntries must be a positive integer, got ${opts.maxEntries}`,
      );
  }

  read(key: number): Promise<T> {
    this.readCount += 1;
    let entry = this.entries.get(key);
    if (entry !== undefined) {
      // LRU touch: a Map iterates in insertion order, so re-inserting on every
      // sighting keeps the first key the coldest.
      this.entries.delete(key);
      this.entries.set(key, entry);
      return entry.read();
    }
    if (this.entries.size >= this.opts.maxEntries) {
      const coldest = this.entries.keys().next();
      if (!coldest.done) {
        this.entries.delete(coldest.value);
        this.evictionCount += 1;
      }
    }
    entry = createCachedRead(
      () => {
        // Counted where the flight STARTS, so TTL expiries and post-bust
        // refreshes are visible, not just cold mints.
        this.refreshCount += 1;
        return this.refresh(key);
      },
      {
        ttlMs: this.opts.ttlMs,
        now: this.opts.now,
      },
    );
    this.entries.set(key, entry);
    const flight = entry.read();
    flight.catch(() => {
      // A rejected read means nothing was ever installed (a warm entry
      // stale-serves instead of rejecting), so this entry is value-less: drop
      // it at settle so failed mints never accumulate as dead weight (the
      // header states the honest scope: the insert above already ran the
      // at-cap eviction, so this prevents retention, not the transient
      // displacement). Deleting at settle loses no single-flight sharing (the
      // insert is synchronous, so concurrent readers joined this flight), and
      // the next reader re-mints, cached_read's own retry shape.
      // Identity-guarded: a bust may already have replaced us. Side effect of
      // any settle-cleanup handler: the returned promise counts as handled,
      // so a caller that forgets to await no longer trips unhandledRejection;
      // awaiting callers still see the rejection.
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return flight;
  }

  /**
   * Whether a key currently holds an entry at all: an installed value OR an
   * in-flight first read. Deliberately not `peek`-shaped, because the caller
   * that needs this (the guild bank log's coalescing floor) must treat a cold
   * MINT and an in-flight flight the same way: in both cases there is a
   * refresh already coming, and in neither is there a stale value to coalesce
   * against. Does not touch the LRU order: this is an observation, not a read.
   */
  has(key: number): boolean {
    return this.entries.has(key);
  }

  /** Drop one key's entry; its next read refreshes (see the header on why drop). */
  bust(key: number): void {
    if (this.entries.delete(key)) this.bustCount += 1;
  }

  bustAll(): void {
    this.bustCount += this.entries.size;
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  stats(): KeyedCachedReadStats {
    return {
      reads: this.readCount,
      refreshes: this.refreshCount,
      evictions: this.evictionCount,
      busts: this.bustCount,
      entries: this.entries.size,
    };
  }
}
