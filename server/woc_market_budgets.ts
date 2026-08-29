// The marketplace service's pass budgets and deadlines, extracted from
// woc_market.ts on the monolith ratchet (the sibling-module pattern the
// delivery arms and drift warner already follow). Values are unchanged;
// woc_market.ts re-exports the public pair so existing importers keep their
// path.

// Sweep pass budgets: every arm is bounded per pass so one huge backlog can
// never starve the others; the next pass continues where this one stopped.
export const SWEEP_BATCH = 25;

/** Wall-clock budget for the LOCKED bond-payout walk: the segment holds the
 *  advisory lock and its client while refund/forfeit RPCs run, so a degraded
 *  service (every RPC riding its full timeout) must stop the walk early
 *  rather than camp the lock for the whole batch. Rows left behind stay
 *  durably due and the next pass resumes; worst hold is about this budget
 *  plus one RPC timeout, comfortably under the watchdog's 60s alarm. */
export const BOND_PAYOUT_BUDGET_MS = 30_000;

/** Wall-clock bound on the activity readout's six SEQUENTIAL reads: each is
 *  its own implicit pool checkout with its own 5s connect deadline, so under
 *  a saturated pool the sequencing turned one 5s worst case into six back to
 *  back (30s of held socket per poll). One checkout timeout plus slack: the
 *  between-reads check fails the readout fast and the client's poll retries
 *  on its next beat. */
export const WOC_MARKET_ME_READOUT_DEADLINE_MS = 6_000;
