// Dedicated token bucket for the ignore/block LIST readouts (/ignorelist,
// /blocklist), added by the phase 06 maintainer ruling of the input-cadence
// packet (docs/design/player-performance/packet-3-input-cadence.md).
//
// R5 keeps list READS chat-token-free: they must work for a GM-silenced
// player, and echoing your own list back must never burn a token toward the
// chat cooldown. But each readout is a live per-call DB SELECT, and an
// ALLOWED under-ceiling frame books no drop, so without this guard a hostile
// authenticated client could sustain readouts at the full pre-parse ceiling
// (raised to 120 per second by this packet) while the abuse window stayed
// structurally unable to kick the stream. The guard closes exactly that gap
// with a budget far above any human rate: refusals are dropped, never
// queued, and the CALLER tallies each refusal into the shared abuse window
// (tallyDrop in server/msg_rate_limit.ts), so a sustained read flood
// reaches the same kick verdict as any other flood. R5's letter is intact:
// no chat token is drawn, and the write commands keep their ladder metering.
//
// Same purity contract as server/msg_rate_limit.ts and server/msg_lanes.ts:
// pure state plus functions, injected nowSec, no Date.now and no session or
// ws imports, so the math is unit-testable without a live server.

// Far above human rate: the readouts are manual slash commands, so a burst
// of 10 with one token per second of refill never touches a real player
// while capping a flooder at one DB read per second sustained.
export const LIST_READ_BURST = 10;
export const LIST_READ_REFILL_PER_SECOND = 1;

export interface ListReadGuardState {
  tokens: number;
  lastRefillSec: number;
}

export function createListReadGuard(nowSec: number): ListReadGuardState {
  return { tokens: LIST_READ_BURST, lastRefillSec: nowSec };
}

/**
 * Mutates `state` in place and returns whether this readout may run. A
 * refusal spends nothing, mirroring the gate and the lanes.
 */
export function consumeListReadToken(state: ListReadGuardState, nowSec: number): boolean {
  const elapsed = Math.max(0, nowSec - state.lastRefillSec);
  state.tokens = Math.min(LIST_READ_BURST, state.tokens + elapsed * LIST_READ_REFILL_PER_SECOND);
  state.lastRefillSec = nowSec;
  if (state.tokens < 1) return false;
  state.tokens -= 1;
  return true;
}
