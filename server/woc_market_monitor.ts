// Stuck-custody monitor for the $WOC Exchange: the CONSUMER of the "visible
// and stuck" failure direction. Delivery code parks anything it cannot prove
// (an unbooked custody claim, a settlement held in 'delivering', a closed
// listing whose escrowed copy never left) instead of guessing; this module is
// what makes those parked states reachable by a human. Two consumers share
// one cached read: the secret-gated ops endpoint (server/internal.ts,
// GET /internal/woc-market/stuck) and a slow periodic log line.
//
// Cost model: the readout is viewer-identical, so it rides createCachedRead
// (TTL + single-flight + stale-serve), and the underlying queries are O(cap):
// samples are LIMIT reads over the stuck-class indexes, and the counts
// SATURATE at countCap (a bare count consumed the whole stuck set per
// refresh, which is exactly wrong during the incident that grows it).
// Nothing here runs per tick or per request: a cold endpoint hit refreshes at
// most once per TTL, and the log interval is minutes. Deliberately NOT
// bust-wired: no moderation action changes what is stuck, so TTL staleness
// only delays an operator diagnostic, never enforcement (the cached-read bust
// rule in server/CLAUDE.md "Hot paths").

import { createCachedRead } from './cached_read';
import type { WocStuckCustodyClasses, WocStuckCustodyReadout } from './woc_market';

/** The one db read the monitor needs (PgWocMarketDb implements it). */
export interface WocMarketMonitorDb {
  stuckCustodyReadout(
    realm: string,
    olderThanMs: number,
    sampleLimit: number,
    countCap: number,
    bondOlderThanMs: number,
  ): Promise<WocStuckCustodyClasses>;
}

export interface WocMarketMonitorDeps {
  db: WocMarketMonitorDb;
  realm: string;
  /** Log sink for the periodic stuck line (main.ts wires console.warn). */
  log(line: string): void;
  /** Injected clock for tests; production omits it (Date.now). */
  now?: () => number;
  /** Cache freshness for the endpoint read. */
  ttlMs?: number;
  /** A row must be at least this old to count as stuck: everything the sweep
   *  is still actively converging (claims mid-pass, deliveries in flight)
   *  stays out of the readout. */
  stuckAgeMs?: number;
  /** The stuck-bond age cutoff: a paid-but-undecided bond older than this is
   *  surfaced for a hand verdict. main.ts wires the same knob that bounds the
   *  confirming settlements (WOC_MARKET_CONFIRMING_REVIEW_HOURS), so the two
   *  H15 surfaces age on one policy. */
  bondStuckAgeMs?: number;
  /** How many rows each class returns beside its count. */
  sampleLimit?: number;
  /** Cadence of the periodic log line. */
  logIntervalMs?: number;
  /** Where each class's count saturates ("cap or more"). */
  countCap?: number;
}

export interface WocMarketMonitor {
  /** The cached three-class readout (the ops endpoint serves this). */
  read(): Promise<WocStuckCustodyReadout>;
  /** One log-cadence beat: logs ONLY when something is stuck (a healthy
   *  marketplace stays silent; the endpoint answers the affirmative case). */
  logTick(): Promise<void>;
  start(): void;
  /** Resolves after any in-flight beat finishes, so a shutdown never races a
   *  beat into the closing pool (the sweep shell's stop() contract). */
  stop(): Promise<void>;
}

export const WOC_MONITOR_TTL_MS = 30_000;
export const WOC_MONITOR_STUCK_AGE_MS = 10 * 60_000;
/** Fallback only: production wiring passes the env-derived confirming-review
 *  bound (see WocMarketMonitorDeps.bondStuckAgeMs); this mirrors its default. */
export const WOC_MONITOR_BOND_STUCK_AGE_MS = 6 * 3600 * 1000;
export const WOC_MONITOR_SAMPLE_LIMIT = 20;
export const WOC_MONITOR_COUNT_CAP = 1000;
export const WOC_MONITOR_LOG_INTERVAL_MS = 5 * 60_000;
/** How long a COLD-cache failure short-circuits new refresh flights: with no
 *  prior success there is no stale value to serve, so without this every
 *  endpoint hit during a DB outage would start a fresh multi-query flight. */
export const WOC_MONITOR_COLD_FAIL_TTL_MS = 5_000;
/** A warm cache stale-serves through a DB outage; past this age the beat
 *  starts warning that its numbers are old (staleness would otherwise be
 *  invisible on the one surface built for incidents). */
export const WOC_MONITOR_STALE_WARN_MS = WOC_MONITOR_TTL_MS * 10;

/** Freeze the readout before it is shared: read() hands the SAME object to
 *  every caller for a TTL window, so an in-place sort or redaction by one
 *  consumer would corrupt it for the rest. */
function freezeReadout(readout: WocStuckCustodyReadout): WocStuckCustodyReadout {
  for (const cls of [
    readout.unbookedClaims,
    readout.stuckDelivering,
    readout.undisposedListings,
    readout.reviewSettlements,
    readout.stuckBonds,
  ] as const) {
    for (const row of cls.sample) Object.freeze(row);
    Object.freeze(cls.sample);
    Object.freeze(cls);
  }
  return Object.freeze(readout);
}

export function createWocMarketMonitor(deps: WocMarketMonitorDeps): WocMarketMonitor {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? WOC_MONITOR_TTL_MS;
  const stuckAgeMs = deps.stuckAgeMs ?? WOC_MONITOR_STUCK_AGE_MS;
  const bondStuckAgeMs = deps.bondStuckAgeMs ?? WOC_MONITOR_BOND_STUCK_AGE_MS;
  const sampleLimit = deps.sampleLimit ?? WOC_MONITOR_SAMPLE_LIMIT;
  const logIntervalMs = deps.logIntervalMs ?? WOC_MONITOR_LOG_INTERVAL_MS;
  const countCap = deps.countCap ?? WOC_MONITOR_COUNT_CAP;
  // Scales with the effective TTL so tests with tiny TTLs keep the same
  // ten-refreshes-missed meaning; at the production TTL this equals
  // WOC_MONITOR_STALE_WARN_MS.
  const staleWarnMs = ttlMs * 10;

  const cached = createCachedRead(
    async () =>
      freezeReadout({
        // Stamped INSIDE the refresh: the cached read stale-serves through an
        // outage, and without an as-of time a stale readout is
        // indistinguishable from a fresh one on the wire.
        asOfMs: now(),
        ...(await deps.db.stuckCustodyReadout(
          deps.realm,
          now() - stuckAgeMs,
          sampleLimit,
          countCap,
          now() - bondStuckAgeMs,
        )),
      }),
    { ttlMs, now },
  );

  // Negative cache for the COLD-failure case only: after a success the cached
  // read stale-serves and never rejects, but with no prior success every
  // caller would otherwise start a fresh multi-query flight against a dead DB.
  let coldFailAtMs = 0;
  let coldFailErr: unknown = null;
  const read = async (): Promise<WocStuckCustodyReadout> => {
    if (coldFailErr !== null && now() - coldFailAtMs < WOC_MONITOR_COLD_FAIL_TTL_MS) {
      throw coldFailErr;
    }
    try {
      const readout = await cached.read();
      coldFailErr = null;
      return readout;
    } catch (err) {
      coldFailAtMs = now();
      coldFailErr = err;
      throw err;
    }
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<void> | null = null;
  // Warn once per failure STREAK: the cached read's own stale-serve warning
  // only fires after a first success, so a monitor that fails from boot (a
  // migration lag, a revoked grant) would otherwise be silent forever, which
  // is the one failure mode the visibility module must not have.
  let failStreak = false;
  // The warm twin: a stale-served readout resolves fine, so track its age and
  // warn once per STALE streak too, or a warm brownout is silent.
  let staleStreak = false;

  const logTick = async (): Promise<void> => {
    let readout: WocStuckCustodyReadout;
    try {
      readout = await read();
      failStreak = false;
    } catch (err) {
      if (!failStreak) {
        failStreak = true;
        try {
          deps.log(`[woc_market] stuck custody readout failing: ${String(err)}`);
        } catch {
          // Beat-never-throws covers the failure line too: the interval call
          // is void'ed, so a throwing sink here would be an unhandled
          // rejection with no safer sink to report it to.
        }
      }
      return;
    }
    // Nothing below may reject out of the void'ed interval call: the log sink
    // is console.warn in production, but the contract is beat-never-throws.
    try {
      const ageMs = now() - readout.asOfMs;
      if (ageMs > staleWarnMs) {
        if (!staleStreak) {
          staleStreak = true;
          deps.log(
            `[woc_market] stuck custody readout is STALE (age ${Math.round(ageMs / 1000)}s): serving the last good value`,
          );
        }
      } else {
        staleStreak = false;
      }
      const counts = {
        unbookedClaims: readout.unbookedClaims.count,
        stuckDelivering: readout.stuckDelivering.count,
        undisposedListings: readout.undisposedListings.count,
        reviewSettlements: readout.reviewSettlements.count,
        stuckBonds: readout.stuckBonds.count,
      };
      const stuck = Object.values(counts).some((n) => n > 0);
      if (!stuck) return;
      deps.log(`[woc_market] stuck custody ${JSON.stringify(counts)}`);
    } catch {
      // The log sink threw; there is no safer sink to report that to.
    }
  };

  const guardedTick = (): Promise<void> => {
    const run = logTick().finally(() => {
      if (running === run) running = null;
    });
    running = run;
    return run;
  };

  return {
    read,
    logTick: guardedTick,
    start(): void {
      if (timer !== null) return;
      timer = setInterval(() => {
        void guardedTick();
      }, logIntervalMs);
      timer.unref?.();
    },
    async stop(): Promise<void> {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      // Drain a beat that already fired: otherwise it finishes against the
      // closing pool and logs a phantom incident during a clean shutdown.
      if (running !== null) await running.catch(() => {});
    },
  };
}
