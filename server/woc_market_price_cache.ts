// The $WOC price read's cache policy, extracted to its own seam so the proxy
// (server/woc_market_proxy.ts) stays a transport layer. The old inline cache
// had three defects on the realm's hottest shared read, and this module is the
// fix for all three:
//
//   1. A FAILED refresh was cached for the full success TTL, so one bad
//      refresh blanked prices (and paused the market via guardEnabledHealthy)
//      for 15 seconds even when the service recovered instantly. Failures now
//      carry their own short memo (failureTtlMs) that only bounds re-probe
//      rate; they never overwrite a success that is still inside the
//      stale-serve bound.
//   2. No single-flight: concurrent readers racing an expired entry each paid
//      their own service round trip. Refreshes are single-flight here.
//   3. Every reader at TTL expiry BLOCKED on the refresh (up to the service
//      timeout), so price renders hitched on every slow refresh.
//      Stale-while-revalidate: a read inside staleServeMaxMs serves the last
//      success immediately and lets the refresh land in the background.
//
// The stale-serve bound is deliberately FINITE and short. createCachedRead's
// indefinite stale-on-error is right for boards; for the price it would keep
// a healthy quote rendering (and the market open, and the defaulting-buyer
// strike probe satisfied) through an arbitrarily long service outage. Past
// staleServeMaxMs the cache converges to the refresh's own truth, so a real
// outage still pauses the market within seconds of the bound; the service's
// own oracle staleness policy (an hour, judged on venue publish time) is far
// wider than anything served here.
//
// The refresh NEVER throws (the proxy's graceful-degradation contract): it
// resolves an unavailable value instead, and this module distinguishes
// success from failure with an injected predicate so it stays value-agnostic.
// Worst-case read latency: a read past staleServeMaxMs (or a cold one)
// blocks on the single-flight refresh, i.e. up to the proxy's 5s service
// timeout; every concurrent reader joins that one flight. Inside the bound,
// reads never block (SWR).
// Wall clock is correct here (server-only, never sim); tests inject now.

export interface WocPriceCacheOptions<T> {
  /** How the cache tells a refresh failure from a success. */
  isFailure(value: T): boolean;
  /** Success freshness window: within it, reads are pure cache hits. */
  ttlMs?: number;
  /** How long past ttlMs a success may still be served while a background
   *  refresh runs (and through refresh failures). The health-staleness
   *  ceiling: guardEnabledHealthy can act on a price at most this old. */
  staleServeMaxMs?: number;
  /** How long a failure answer short-circuits new refreshes once there is no
   *  servable success: bounds outage probe rate, not outage visibility. */
  failureTtlMs?: number;
  /** Injected clock for tests; production callers omit it (Date.now). */
  now?: () => number;
}

export const WOC_PRICE_CACHE_TTL_MS = 15_000;
export const WOC_PRICE_STALE_SERVE_MAX_MS = 30_000;
export const WOC_PRICE_FAILURE_TTL_MS = 3_000;

export interface WocPriceCache<T> {
  read(): Promise<T>;
  /** Test/ops introspection: the installed success and failure memos. */
  peek(): { success: { at: number; value: T } | null; failure: { at: number; value: T } | null };
}

export function createWocPriceCache<T>(
  refresh: () => Promise<T>,
  opts: WocPriceCacheOptions<T>,
): WocPriceCache<T> {
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? WOC_PRICE_CACHE_TTL_MS;
  const staleServeMaxMs = opts.staleServeMaxMs ?? WOC_PRICE_STALE_SERVE_MAX_MS;
  const failureTtlMs = opts.failureTtlMs ?? WOC_PRICE_FAILURE_TTL_MS;

  let success: { at: number; value: T } | null = null;
  let failure: { at: number; value: T } | null = null;
  let inFlight: Promise<T> | null = null;

  const refreshShared = (): Promise<T> => {
    if (inFlight === null) {
      inFlight = refresh()
        .then((value) => {
          if (opts.isFailure(value)) {
            // A failure never overwrites a success still inside the
            // stale-serve bound; the memo only spaces out re-probes.
            failure = { at: now(), value };
            if (success !== null && now() - success.at >= staleServeMaxMs) success = null;
          } else {
            success = { at: now(), value };
            failure = null;
          }
          return value;
        })
        .finally(() => {
          // Settled: clear the slot so the next miss starts a fresh flight.
          // (refresh never rejects per the proxy contract, but a thrown bug
          // must not wedge the cache into sharing a rejection forever.)
          inFlight = null;
        });
    }
    return inFlight;
  };

  return {
    async read(): Promise<T> {
      const at = now();
      if (success !== null) {
        const age = at - success.at;
        if (age < ttlMs) return success.value;
        if (age < staleServeMaxMs) {
          // Stale-while-revalidate: kick (or join) the background refresh and
          // serve the stale success without waiting on it. The failure-memo
          // gate bounds the probe rate against a FAST-failing service (a
          // refused connection settles instantly, so without it every read
          // would launch a fresh probe); a hanging service self-spaces via
          // single-flight. The catch keeps a thrown refresh bug from
          // surfacing as an unhandled rejection; the next read retries
          // through the cleared flight slot.
          if (failure === null || at - failure.at >= failureTtlMs) {
            refreshShared().catch(() => {});
          }
          return success.value;
        }
      }
      // No servable success. A recent failure memo answers without a new
      // probe; otherwise this read pays (or joins) the refresh.
      if (failure !== null && at - failure.at < failureTtlMs) return failure.value;
      const value = await refreshShared();
      // Stale-on-error BELT, unreachable under the current interleavings: a
      // cold-path reader implies no in-bound success existed at read time,
      // single-flight admits no rival install, and the failure handler above
      // clears any out-of-bound success before a joined reader resumes. Kept
      // because it is the correct answer if a future edit ever lets a fresh
      // success land while a failure flight is still settling.
      if (opts.isFailure(value) && success !== null && now() - success.at < staleServeMaxMs) {
        return success.value;
      }
      return value;
    },
    peek() {
      // Shallow copies: introspection must never hand out the live memo
      // records (a caller writing .at would corrupt the state machine).
      return {
        success: success === null ? null : { ...success },
        failure: failure === null ? null : { ...failure },
      };
    },
  };
}
