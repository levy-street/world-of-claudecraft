// Dedicated token bucket shared by the two Book of Deeds cosmetic commands
// (deed_set_title, deed_set_border), the guild_bank_op_guard.ts idiom.
//
// `title` and `border` are both identityFields members, so a change bumps the
// entity's idVer and the broadcast loop pushes the FULL identity record to
// every in-range viewer BEFORE the distance-tier isUpdateDue check can thin
// it. An ALLOWED under-ceiling frame books no drop, so without this guard a
// hostile authenticated client could alternate deed_set_border between two
// earned values at the command lane's full 30/s and re-serialize the whole
// identity blob to everyone within interest range at 20 Hz.
//
// The PROTECTION here is the throttle itself: past the burst, at most about
// one set per second is accepted, which is what bounds the re-wire cost. The
// kick is a secondary effect and NOT guaranteed: refusals are dropped, never
// queued, and the CALLER tallies each into the shared abuse window (tallyDrop
// in server/msg_rate_limit.ts), but that window only marks a second abusive
// at MSG_ABUSE_SECOND_DROP_FLOOR drops within it, so a flooder pacing just
// above the refill never reaches a kick verdict. It also never gets more than
// the throttled rate. The sibling guild-bank guard shares this shape.
//
// ONE bucket for both commands on purpose: they are the same window, the same
// player, and the same re-wire cost, so alternating between the two must not
// buy twice the budget.
//
// Same purity contract as server/msg_rate_limit.ts and server/list_read_guard.ts:
// pure state plus functions, injected nowSec, no Date.now and no session or
// ws imports, so the math is unit-testable without a live server.

// Far above human rate: picking a title or a border is an occasional click in
// an open window, so a burst of 10 with one token per second of refill never
// touches a real player browsing the two shelves while capping a flooder at
// one identity re-wire per second sustained.
export const COSMETIC_OP_BURST = 10;
export const COSMETIC_OP_REFILL_PER_SECOND = 1;

export interface CosmeticOpGuardState {
  tokens: number;
  lastRefillSec: number;
}

export function createCosmeticOpGuard(nowSec: number): CosmeticOpGuardState {
  return { tokens: COSMETIC_OP_BURST, lastRefillSec: nowSec };
}

/**
 * Mutates `state` in place and returns whether this cosmetic set may run. A
 * refusal spends nothing, mirroring the gate and the lanes.
 */
export function consumeCosmeticOpToken(state: CosmeticOpGuardState, nowSec: number): boolean {
  const elapsed = Math.max(0, nowSec - state.lastRefillSec);
  state.tokens = Math.min(
    COSMETIC_OP_BURST,
    state.tokens + elapsed * COSMETIC_OP_REFILL_PER_SECOND,
  );
  state.lastRefillSec = nowSec;
  if (state.tokens < 1) return false;
  state.tokens -= 1;
  return true;
}
