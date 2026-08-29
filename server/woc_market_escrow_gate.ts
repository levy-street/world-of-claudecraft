// The realm-global bound on escrow sequences in flight (the escrow write-path
// rider). The per-character depth cap in woc_market_custody.ts bounds each
// character to ONE queued-or-running escrow sequence, but nothing bounded how
// many CHARACTERS could hold one at once: the shared pg pool (10 clients by
// default) was the only realm-wide backstop, and saturating it with
// escrow-shaped work (each sequence can hold a pool client through the
// guild-flush heavy allowance and the escrow transaction's own ceiling)
// starves every other guard transaction, the sweep's locked segments, and the
// autosave wave. This gate is that missing bound: a counted in-flight cap
// with an immediate typed refusal at saturation, the seeker-executor idiom
// minus the queue (a queued waiter would just recreate the pile-up the
// refusal exists to prevent; the client's retry loop is the queue).
//
// Holds are IDENTITY-TOKENED (the qa-checklist round): a release retires its
// OWN stamp, never a positional guess, so out-of-order settlements report
// every surviving hold's age EXACTLY, the leak reclaim fires exactly at the
// ceiling for the wedged hold and no other, and a reclaimed sequence that
// later settles releases nothing (its token is already gone), eliminating
// the transient over-free the earlier FIFO approximation carried.
//
// Scope: acquired ONLY by the custody module's runSerialized entry (the
// listing escrow path). The sweep, the monitor, and the grant persist never
// touch it: the sweep's delivery work is bounded by its own batch sizes and
// busy budget, and taking this gate while holding the sweep's advisory lock
// would couple the two backpressure systems (the enqueueMarketWrite latency
// chain recorded in the rider spec).

/** Realm-global cap on escrow sequences in flight (queued plus running).
 *  Sized to the autosave wave's own SAVE_CONCURRENCY (4): the realm already
 *  prices in four concurrent character-save writes, so four escrow sequences
 *  add at most four more save-shaped holds. The tunables ladder pins the
 *  relation to the scraped SAVE_CONCURRENCY and to the pool default, so
 *  re-tuning either forces this sizing to be re-decided rather than
 *  silently diverging. (The pool-default relation is sizing arithmetic, not
 *  an enforced reserve: nothing fences the remaining clients, which also
 *  serve every non-market read on the shared pool.) */
export const WOC_ESCROW_GATE_MAX_IN_FLIGHT = 4;

/** A held slot older than this is treated as LEAKED and reclaimed, counted
 *  and loud: a save FIFO that never settles would otherwise pin its slot for
 *  the process lifetime, and four such wedges would close the realm's
 *  listing path until a restart (the per-character cap made that a
 *  one-character outage; a realm-global bound must not amplify it into a
 *  realm one). The slot is taken BEFORE the guild flush and the FIFO
 *  enqueue, so a hold spans the character's queue wait as well as the
 *  sequence itself, and the 5s waiter deadline does NOT end it (a
 *  deadline-cancelled job still settles only when the FIFO reaches it).
 *  The tunables ladder therefore prices the honest started-request ceiling
 *  PLUS the guild-flush heavy allowance PLUS a bounded head-of-line term
 *  (ONE heavy save queued ahead on the same character: 255s + 60s + 60s
 *  leaves this 400s ceiling 25s of slack). Inside that bound
 *  a reclaim is an incident signal rather than ordinary churn; PAST it (a
 *  character whose queue holds two or more saves each taking the full
 *  heavy allowance) the reclaim can also fire on a still-legitimate hold,
 *  which costs one over-admitted slot and a misleading line, never
 *  correctness. Identity tokens keep it exact (only the oldest hold past
 *  the ceiling is reclaimed), and the pg pool's own bounds remain the
 *  backstop for whatever the wedged sequence still holds. */
export const WOC_ESCROW_GATE_HOLD_CEILING_MS = 400_000;

/** One acquired slot. release() retires exactly this hold's stamp; calling
 *  it twice, or after the reclaim already retired the hold, is a no-op. */
export interface WocEscrowHold {
  release(): void;
}

export interface WocEscrowGateStats {
  inFlight: number;
  max: number;
  /** Process-lifetime refusals at cap, BOTH arms: the service's pre-burn
   *  saturated() probe and tryAcquire (the realm_refused counter's twin on
   *  the ops readout: the counter alerts, this number dates the readout). */
  refused: number;
  /** Process-lifetime leaked-slot reclaims (each one was a sequence that
   *  outlived the hold ceiling: an incident, not churn). */
  reclaimed: number;
  /** EXACT age of the oldest standing hold, or 0 when idle (identity
   *  tokens: a release retires its own stamp, so churn cannot skew this). */
  oldestHoldMs: number;
}

export interface WocEscrowGate {
  /** Take a slot. Null means the realm is at cap and the caller refuses the
   *  typed 'contended' without holding anything. */
  tryAcquire(): WocEscrowHold | null;
  /** The pre-burn saturation probe (the service consults it BEFORE spending
   *  a step-up challenge). It RECLAIMS leaked holds first: a bare stats
   *  read here would make the full-wedge outage permanent, because a
   *  saturated pre-check refuses every request before any tryAcquire could
   *  run the reclaim (the fix-round review's blocking find). A true answer
   *  is COUNTED as a refusal: the pre-check short-circuits tryAcquire, so
   *  without this the refused stat and the realm_refused counter would
   *  stay flat during exactly the sustained saturation they exist to
   *  surface (the qa-checklist round's find). */
  saturated(): boolean;
  stats(): WocEscrowGateStats;
}

export function createWocEscrowGate(
  max: number = WOC_ESCROW_GATE_MAX_IN_FLIGHT,
  opts: { holdCeilingMs?: number; now?: () => number } = {},
): WocEscrowGate {
  const holdCeilingMs = opts.holdCeilingMs ?? WOC_ESCROW_GATE_HOLD_CEILING_MS;
  const now = opts.now ?? Date.now;
  /** Acquisition stamps by identity token. Map iteration is insertion
   *  order and stamps are monotone, so the first entry is the oldest. */
  const holds = new Map<object, number>();
  let refused = 0;
  let reclaimed = 0;

  function reclaimLeaked(): void {
    const cutoff = now() - holdCeilingMs;
    for (const [token, stampMs] of holds) {
      // Monotone stamps in insertion order: past the first survivor, every
      // later entry is younger still.
      if (stampMs > cutoff) break;
      holds.delete(token);
      reclaimed++;
      console.error(
        `[woc_market] escrow gate reclaimed a slot held past ${holdCeilingMs}ms: a listing sequence never settled (wedged save FIFO, or a character queue deep in heavy saves); capacity restored, the cause itself still needs an operator`,
      );
    }
  }

  function oldestHoldMs(): number {
    for (const stampMs of holds.values()) return now() - stampMs;
    return 0;
  }

  return {
    tryAcquire(): WocEscrowHold | null {
      reclaimLeaked();
      if (holds.size >= max) {
        refused++;
        return null;
      }
      const token = {};
      holds.set(token, now());
      return {
        release(): void {
          // Identity delete: a double release, or a release after the
          // reclaim already retired this token, removes nothing.
          holds.delete(token);
        },
      };
    },
    saturated(): boolean {
      reclaimLeaked();
      if (holds.size >= max) {
        refused++;
        return true;
      }
      return false;
    },
    stats(): WocEscrowGateStats {
      return {
        inFlight: holds.size,
        max,
        refused,
        reclaimed,
        oldestHoldMs: oldestHoldMs(),
      };
    },
  };
}
