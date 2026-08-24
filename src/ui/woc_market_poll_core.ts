// When the open $WOC Exchange window should re-ask the server.
//
// The window arms no repeating driver of its own (pinned by its own suite): the
// HUD's slow band already calls refreshIfChanged, and that rebuild is a LOCAL
// one over data already in hand. It repaints countdowns, but it can never show a
// bid that was accepted, a listing someone else bought, or a bond the chain has
// now confirmed, because none of that is in the client's copy. Re-asking the
// server is a separate decision from repainting, and this is that decision.
//
// Pure and clock-injected so the cadence is testable without a DOM or a network:
// the caller passes the wall clock it already read.

/**
 * The idle cadence, comfortably slower than the HUD band that drives it.
 *
 * The exchange is not a trading floor: a listing's price moves on a human
 * placing a bid, so a browse list is stale in a way anyone would tolerate for a
 * few seconds. This is chosen against the SERVER's cost (one read per open
 * window per interval, per player) rather than against perceived latency.
 */
export const WOC_MARKET_IDLE_POLL_MS = 15_000;

/**
 * The cadence while a submitted payment is awaiting the chain.
 *
 * Faster because the player is watching a spinner and cannot act until it
 * resolves, which is the one moment in this window where staleness is felt as
 * the app being broken. Solana confirms in well under this, so a handful of
 * polls covers a normal confirmation; the sweep on the server is what covers the
 * abnormal one, so this never needs to be aggressive.
 */
export const WOC_MARKET_AWAITING_POLL_MS = 3_000;

export interface WocMarketPollInput {
  /** The caller's already-read wall clock. */
  nowMs: number;
  /** When the last server read STARTED, or null if none has yet. */
  lastFetchStartedMs: number | null;
  /** A read is outstanding right now. */
  inFlight: boolean;
  /** Something the player is waiting on is mid-verification on chain. */
  awaitingChain: boolean;
}

/** The cadence that applies right now, in ms. */
export function wocMarketPollIntervalMs(awaitingChain: boolean): number {
  return awaitingChain ? WOC_MARKET_AWAITING_POLL_MS : WOC_MARKET_IDLE_POLL_MS;
}

/**
 * Whether to re-ask the server on this tick.
 *
 * Never while a read is outstanding: the HUD band ticks far faster than any
 * response returns, so without that guard a slow or hanging request would have a
 * new one stacked on it every tick, which is how a stalled backend turns into a
 * client-side flood. `lastFetchStartedMs` is the START of the previous read for
 * the same reason: measuring from its COMPLETION would let a slow read shorten
 * the gap after it, so the worse the server was doing the harder it would be
 * asked.
 *
 * A null `lastFetchStartedMs` polls immediately, so opening the window is not
 * followed by a silent wait for the first interval.
 */
export function shouldPollWocMarket(input: WocMarketPollInput): boolean {
  if (input.inFlight) return false;
  if (input.lastFetchStartedMs === null) return true;
  const elapsed = input.nowMs - input.lastFetchStartedMs;
  // A clock that jumped BACKWARD (a device time correction, a resumed suspended
  // tab) leaves elapsed negative. Poll rather than wait it out: the alternative
  // is a window frozen until real time catches back up to a stamp from the
  // future, which is unbounded and looks exactly like a hung panel.
  if (elapsed < 0) return true;
  return elapsed >= wocMarketPollIntervalMs(input.awaitingChain);
}

/**
 * Whether any of these bids is mid-verification.
 *
 * Kept here beside the cadence it selects rather than in the window: it is the
 * same decision, and a caller that had to derive "awaiting" itself could easily
 * derive it differently from what the spinner shows.
 */
export function anyBondAwaitingChain(
  bids: readonly { status: string; bondConfirming: boolean }[],
): boolean {
  return bids.some((b) => b.status === 'pending_bond' && b.bondConfirming);
}
