// Dedicated token bucket for the five guild bank ops (Guild Bank Phase 3 QA,
// the database-performance ruling), the list_read_guard.ts idiom.
//
// Every SUCCESSFUL guild bank op writes one keep-forever bank_ledger row and
// appends one unflushed-delta log entry, and an ALLOWED under-ceiling frame
// books no drop, so without this guard a hostile authenticated officer could
// alternate deposit_gold(1)/withdraw_gold(1) at the full command-lane ceiling
// (30/s sustained) and grow the audit table by millions of rows per day while
// the abuse window stayed structurally unable to kick the stream. The guard
// caps the rate far above any human banking cadence; refusals are dropped,
// never queued, and the CALLER tallies each refusal into the shared abuse
// window (tallyDrop in server/msg_rate_limit.ts), so a sustained op flood
// reaches the same kick verdict as any other flood.
//
// Same purity contract as server/msg_rate_limit.ts and server/list_read_guard.ts:
// pure state plus functions, injected nowSec, no Date.now and no session or
// ws imports, so the math is unit-testable without a live server.

// Far above human rate: bank ops are manual clicks (a stack move, a gold
// amount submit), so a burst of 10 with two tokens per second of refill never
// touches a real player emptying a bank while capping a flooder at two ops
// (up to FOUR ledger rows, counting a counterparty-orphan anomaly row beside
// an op's own row) per second sustained.
export const GUILD_BANK_OP_BURST = 10;
export const GUILD_BANK_OP_REFILL_PER_SECOND = 2;

export interface GuildBankOpGuardState {
  tokens: number;
  lastRefillSec: number;
}

export function createGuildBankOpGuard(nowSec: number): GuildBankOpGuardState {
  return { tokens: GUILD_BANK_OP_BURST, lastRefillSec: nowSec };
}

/**
 * Mutates `state` in place and returns whether this op may run. A refusal
 * spends nothing, mirroring the gate and the lanes.
 */
export function consumeGuildBankOpToken(state: GuildBankOpGuardState, nowSec: number): boolean {
  const elapsed = Math.max(0, nowSec - state.lastRefillSec);
  state.tokens = Math.min(
    GUILD_BANK_OP_BURST,
    state.tokens + elapsed * GUILD_BANK_OP_REFILL_PER_SECOND,
  );
  state.lastRefillSec = nowSec;
  if (state.tokens < 1) return false;
  state.tokens -= 1;
  return true;
}
