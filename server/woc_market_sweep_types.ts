// The sweep's pass-accounting vocabulary, extracted from woc_market.ts on
// the monolith ratchet (a leaf types module, the woc_market_monitor_types.ts
// pattern: no imports, so the sweep, the delivery arms and the service can
// all name these shapes without a cycle). woc_market.ts re-exports the trio,
// so existing importers keep their path.

export interface WocSweepPassStats {
  lapsedBids: number;
  /** Directed p2p offers that timed out unanswered. */
  expiredOffers: number;
  /** Accepted offers whose escrow provably rolled back (aged, no stamped
   *  listing), converged back to pending or straight to expired. The unwind
   *  half of the atomic listing stamp. */
  convergedOffers: number;
  reclaimed: number;
  closed: number;
  /** Over-bound 'confirming' rows parked in the operator 'review' state
   *  (the H15 exit; its own arm so a confirming backlog cannot starve the
   *  deadline expiry batch). */
  reviewed: number;
  expired: number;
  /** Cancel-pending listings whose lock window ended unpaid, closed
   *  'cancelled' with the return flight home (the cancel-intent converge). */
  cancelClosed: number;
  polled: number;
  /** Bonds paid but not yet decided by the chain, re-checked this pass. */
  polledBonds: number;
  delivered: number;
  reconciled: number;
  /** Delivered-but-unclosed settlements whose close tail was re-driven
   *  forward (an older binary's crash residue converging). */
  redriven: number;
  /** Sold-but-undisposed residue rows whose dispose flag converged (the
   *  sibling residue class; counted apart from redriven so a page-walk beat
   *  and a dispose beat cannot trip the saturation signal together). */
  disposed: number;
  returned: number;
  /** Rows PARKED this pass (delivery or return refusals rotating to the
   *  tail). Parked work is real work: without this a fully parked pass
   *  scored zero everywhere and the pass looked idle exactly when wedged. */
  parked: number;
  bonds: number;
}

/** Sweep failure tags: every per-arm stats key, plus the delivery sub-steps
 *  that report row-level failures from inside an arm (the grant commit and
 *  the seller notice), which carry their own tags so an operator can tell
 *  WHERE in the delivery a row is failing. 'offer_reopen' is the one
 *  request-thread tag: the acceptance path's in-request reopen swallows its
 *  own transport failures (the escrow root cause and the typed refusal are
 *  the caller-facing truths), and this report is what connects a
 *  reopen-latency symptom to that swallow. */
export type WocSweepErrorTag =
  | keyof WocSweepPassStats
  | 'deliver_grant'
  | 'deliver_notice'
  | 'offer_reopen';

/** Contention and park accounting for ONE delivery entry: the sweep pass
 *  owns one scope across its arm sequence, and the eager confirm entry mints
 *  its own, so a request-thread delivery can neither clobber a pass's
 *  contention verdict mid-flight nor inherit a stale one. */
export interface WocDeliveryScope {
  /** One 'contended' outcome stops the scope's remaining SETTLEMENT work
   *  (the claim, both runDeliveryBatch arms, and the two residue beats):
   *  the rows a break leaves behind are already 'delivering', and retrying
   *  them seconds later only spends the lock_timeout budget the break
   *  conserved. The return arm deliberately ignores it: it writes different
   *  listings and only contributes park events here. */
  contended: boolean;
  /** Park EVENTS in this scope (rows newly parked or re-parked on a retry). */
  parked: number;
  /** FIFO-busy grant parks in this scope (the delivered-save entry found the
   *  buyer's save queue wedged past its deadline). Budgeted: past
   *  WOC_GRANT_BUSY_BUDGET the delivery arms stop the scope's settlement
   *  work like a contended pass, so a save-wave wedge costs the LOCKED sweep
   *  segment a bounded number of deadlines, never one per row. Optional so
   *  the eager entry's inline literal stays unchanged; absent reads as 0. */
  busyParks?: number;
}
