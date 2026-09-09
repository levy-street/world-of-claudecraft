// Dedicated token bucket for the guild bank HISTORY reads (the
// `guild_bank_log` command: the newest window, an older page, or a filter
// slice), the list_read_guard.ts idiom, split off the guild bank OP bucket at
// the transaction-history review.
//
// Before paging, the history read shared server/guild_bank_op_guard.ts with the
// five mutating ops: one request per client TTL was a rounding error against a
// burst of ten. Paging and filters changed the shape: every chip press is a
// request (and re-requests the newest window), every Show older press is a
// request, and a member who toggles All / Items / Money a few times and pages
// twice inside five seconds is an honest reader. Drawn from the op bucket,
// that reader drained it and their NEXT DEPOSIT was dropped on the floor with
// no echo and a tally toward the abuse window. Reads and writes are different
// abuse shapes (a keep-forever ledger row versus a cached, index-bounded
// SELECT), so they meter separately.
//
// The budget stays far above human rate while still bounding a flooder:
// every uncached page is one bounded index scan, so two per second sustained
// is nothing, and a burst of twenty covers the fastest plausible click storm.
// Refusals are dropped, never queued, and the CALLER tallies each refusal
// into the shared abuse window (tallyDrop in server/msg_rate_limit.ts), so a
// sustained read flood reaches the same kick verdict as any other flood.
//
// Same purity contract as server/msg_rate_limit.ts and server/list_read_guard.ts:
// pure state plus functions, injected nowSec, no Date.now and no session or
// ws imports, so the math is unit-testable without a live server.

export const GUILD_BANK_LOG_READ_BURST = 20;
export const GUILD_BANK_LOG_READ_REFILL_PER_SECOND = 2;

export interface GuildBankLogReadGuardState {
  tokens: number;
  lastRefillSec: number;
}

export function createGuildBankLogReadGuard(nowSec: number): GuildBankLogReadGuardState {
  return { tokens: GUILD_BANK_LOG_READ_BURST, lastRefillSec: nowSec };
}

/**
 * Mutates `state` in place and returns whether this read may run. A refusal
 * spends nothing, mirroring the gate and the lanes.
 */
export function consumeGuildBankLogReadToken(
  state: GuildBankLogReadGuardState,
  nowSec: number,
): boolean {
  const elapsed = Math.max(0, nowSec - state.lastRefillSec);
  state.tokens = Math.min(
    GUILD_BANK_LOG_READ_BURST,
    state.tokens + elapsed * GUILD_BANK_LOG_READ_REFILL_PER_SECOND,
  );
  state.lastRefillSec = nowSec;
  if (state.tokens < 1) return false;
  state.tokens -= 1;
  return true;
}
