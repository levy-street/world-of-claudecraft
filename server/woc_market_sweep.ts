// Self-clocked $WOC Exchange sweep: the timing shell around the segment plan
// WocMarketService.sweepSegments() builds (auction closes, settlement expiry
// and cascades, delivery and return reconciliation, bond refunds/forfeits).
// The arms themselves are idempotent and batch-bounded, so this shell only
// owns the clock, the re-entrancy guard, the per-realm advisory lock, the
// duration watchdog stamps, and stop().
//
// Locking (H11): the lock and its pool client are held PER LOCKED SEGMENT,
// never across the pass. The old shape checked out one client and held the
// session advisory lock across the whole pass body, which the two chain-poll
// arms can stretch to 2 x SWEEP_BATCH confirm round trips at the 60s confirm
// timeout: a hung economy service camped a shared-pool client and the lock
// for tens of minutes while every peer lost the try-lock. Now:
// - a `locked` segment (the database arms) brackets its bounded batches with
//   checkout + try-lock and unlock + release;
// - an UNLOCKED segment (the read-only confirm polls) holds NO client and NO
//   advisory lock ACROSS its chain round trips; the individual guarded
//   writes it lands still check out their own clients for their own bounded
//   transactions, and every STATE write is a single-winner CAS transition
//   (see sweepSegments' contract; the park-rotation timestamp touches are
//   idempotent bookkeeping a racing peer merely repeats), so a concurrent
//   peer costs duplicate confirm round trips for the deploy-overlap window
//   (an accepted, bounded cost), never duplicate effects; money-moving
//   chain arms stay locked;
// - a LOST try-lock aborts the rest of the pass (the peer holding the lock
//   IS this realm's sweep, exactly the old whole-pass semantic, now judged
//   at each locked segment);
// - progress persists between segments in the rows themselves, so an aborted
//   pass resumes from durable state on the next poll.
//
// Locking mechanics: realm processes share one database, and a realm may be
// restarted side by side during a deploy, so each locked segment takes the
// two-int session advisory lock (WOC_MARKET_SWEEP_ADVISORY_LOCK_KEY,
// hashtext(realm)). Distinct-key cross-reference: db.ts boot DDL holds
// "WOC\x01" (0x57_4f_43_01), retention_sweep.ts holds "WOC\x02"
// (0x57_4f_43_02); this key is "WOC\x03" in the int4 space of the two-arg
// lock family, so the three can never collide.
//
// Pool floor: a locked segment holds ONE client for the lock while each arm
// checks out its own for its guarded transactions, so the segmented shape
// needs at least two pool clients; at DB_POOL_MAX_CLIENTS=1 every locked
// segment self-starves (each arm's checkout waits out its 5s deadline and
// refuses TxNeverStarted, scored 0 by per-arm isolation) while the process
// otherwise looks healthy apart from the sweep-error log.
//
// Unlike the nightly retention sweep this polls every few seconds: auction
// ends and settlement windows are minute-scale deadlines, and every arm it
// drives is a bounded no-op when nothing is due.

export const WOC_MARKET_SWEEP_ADVISORY_LOCK_KEY = 0x57_4f_43_03; // "WOC\x03"

/** The lock statements as ONE source of truth: the shell issues these and
 *  the pg exclusion proof executes the SAME strings, so the hashtext(realm)
 *  shape cannot drift between the judge that pins the text and the judge
 *  that proves the exclusion. Params: [key, realm]. */
export const WOC_MARKET_SWEEP_LOCK_SQL = 'SELECT pg_try_advisory_lock($1, hashtext($2)) AS ok';
export const WOC_MARKET_SWEEP_UNLOCK_SQL = 'SELECT pg_advisory_unlock($1, hashtext($2)) AS ok';
export const WOC_MARKET_SWEEP_POLL_MS = 5_000;

export interface WocMarketSweepLockClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(destroy?: boolean): void;
}

/** One ordered slice of a pass (WocMarketService.sweepSegments builds them). */
export interface WocMarketSweepSegment {
  name: string;
  /** Bracket this segment with the advisory lock (and its one client). An
   *  unlocked segment runs with no client checked out at all. */
  locked: boolean;
  run(): Promise<void>;
}

export interface WocMarketSweepPassPlan {
  segments: ReadonlyArray<WocMarketSweepSegment>;
  /** Per-pass reporting; the shell calls it exactly once, aborted or not. */
  finish(): unknown;
}

/** The watchdog stamps the shell feeds (woc_market_sweep_watchdog.ts). */
export interface WocMarketSweepWatchdogStamps {
  begin(): void;
  segment(name: string): void;
  end(): void;
}

export interface WocMarketSweepDeps {
  realm: string;
  /** One pool checkout per LOCKED SEGMENT, held only for that segment. */
  connect(): Promise<WocMarketSweepLockClient>;
  /** Build one pass's ordered plan; null when the market is disabled. */
  plan(): WocMarketSweepPassPlan | null;
  onError(err: unknown): void;
  watchdog?: WocMarketSweepWatchdogStamps;
  pollMs?: number;
}

export interface WocMarketSweep {
  start(): void;
  stop(): Promise<void>;
  /** One guarded pass; exposed for tests and for eager pokes. */
  runOnce(): Promise<void>;
}

export function createWocMarketSweep(deps: WocMarketSweepDeps): WocMarketSweep {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<void> | null = null;
  let stopped = false;

  /** Run one segment under the advisory lock: checkout, try-lock, run,
   *  unlock, release. 'lost' means a peer holds the realm's lock. */
  async function lockedRun(run: () => Promise<void>): Promise<'ran' | 'lost'> {
    const client = await deps.connect();
    // Poisoned-lock hazard (the retention_sweep.ts rationale, verbatim): a
    // client whose lock or unlock query failed may still hold the SESSION
    // advisory lock, and a pooled connection lives for hours. While it sits in
    // the pool the lock stays taken and every future segment for this realm
    // loses the try-lock, so the marketplace silently stops closing auctions
    // and expiring settlements. Both arms destroy the connection instead of
    // pooling it: ending the backend session drops its locks.
    let destroyClient = false;
    try {
      let acquired = false;
      try {
        const res = await client.query(WOC_MARKET_SWEEP_LOCK_SQL, [
          WOC_MARKET_SWEEP_ADVISORY_LOCK_KEY,
          deps.realm,
        ]);
        acquired = res.rows[0]?.ok === true;
      } catch (err) {
        destroyClient = true;
        throw err;
      }
      if (!acquired) return 'lost';
      try {
        await run();
      } finally {
        try {
          const unlocked = await client.query(WOC_MARKET_SWEEP_UNLOCK_SQL, [
            WOC_MARKET_SWEEP_ADVISORY_LOCK_KEY,
            deps.realm,
          ]);
          // A false answer means this session did not hold the lock it just
          // ran under: the session's lock state is not what this code
          // believes, so the client is destroyed like the thrown arm (the
          // conservative reading of the poisoned-lock rule).
          if (unlocked.rows[0]?.ok !== true) destroyClient = true;
        } catch {
          destroyClient = true;
        }
      }
      return 'ran';
    } finally {
      client.release(destroyClient || undefined);
    }
  }

  async function guardedPass(): Promise<void> {
    const plan = deps.plan();
    if (!plan) return;
    deps.watchdog?.begin();
    try {
      for (const segment of plan.segments) {
        // A stop() ends the pass at the next segment boundary: shutdown
        // skips every segment not yet started (it still waits out the one
        // in flight; only the poll cadence, never stop(), can cut a
        // segment's own chain round trips short).
        if (stopped) break;
        deps.watchdog?.segment(segment.name);
        if (segment.locked) {
          const outcome = await lockedRun(segment.run);
          // A peer holding the lock IS this realm's sweep: it will run the
          // remaining arms itself, so this pass stands down entirely rather
          // than interleaving.
          if (outcome === 'lost') break;
        } else {
          // Chain calls: no client checked out, no lock held (see header).
          await segment.run();
        }
      }
    } finally {
      deps.watchdog?.end();
      plan.finish();
    }
  }

  async function runOnce(): Promise<void> {
    if (stopped || running) return; // never overlap passes
    running = guardedPass()
      .catch((err) => deps.onError(err))
      .finally(() => {
        running = null;
      });
    await running;
  }

  return {
    start(): void {
      if (timer || stopped) return;
      timer = setInterval(() => {
        void runOnce();
      }, deps.pollMs ?? WOC_MARKET_SWEEP_POLL_MS);
      timer.unref();
    },
    async stop(): Promise<void> {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (running) await running.catch(() => {});
    },
    runOnce,
  };
}
