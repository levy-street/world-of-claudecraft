// On-chain ecosystem activity feed: an off-game worker (the chain-watch worker in
// the economy service) detects $WOC burns, item sales settled in $WOC, and Claudium
// purchases on Solana, and POSTs each as a normalized event to /internal/onchain-event.
// The ingress fans each event to two sinks: an in-game realm-chat line (broadcast
// immediately) and this queue, which the Discord bot drains from /internal/onchain/feed
// and posts to the dedicated channel (and to X when enabled).
//
// Pure + dependency-free (no chain IO, no DB, no Discord IO), so it is trivially
// testable. Mirrors discord_activity.ts: an in-memory hand-off with bounded depth
// and TTL dedupe, keyed by transaction signature so a resend never double-posts.

export type OnchainKind = 'burn' | 'sale' | 'claudium';
export type OnchainToken = 'WOC' | 'SOL' | 'USDC';

export interface OnchainEvent {
  kind: OnchainKind;
  // The token the value moved in. Burns and $WOC sinks are 'WOC'; Claudium can be
  // any of the three rails.
  token: OnchainToken;
  // Whole-token amount (already scaled out of base units by the worker).
  amountUi: number;
  // USD value at detection time, or null when the price oracle was unavailable.
  usd: number | null;
  // Best-effort human context. `actor` is a wallet (short address) or a resolved
  // player name; `item` is the ware/product name when known (sales/Claudium).
  actor: string;
  item: string | null;
  // The Solana transaction signature (the dedupe identity + explorer link).
  sig: string;
  // Block time in ms since epoch (0 when the RPC omitted it).
  blockMs: number;
  // 'mainnet' today; the field exists so a devnet feed can be labeled if ever added.
  network: string;
  // Optional running total of $WOC burned (1e9 minus live supply), for the burn line.
  totalBurnedUi: number | null;
}

const QUEUE: OnchainEvent[] = [];
const MAX_QUEUE = 200; // backstop so a stalled/absent bot can never grow this unbounded

// Recent dedupe keys with their wall-clock time, so a signature re-sent by the
// worker (retry, overlapping scan windows) is enqueued once. Keys expire after
// DEDUPE_TTL_MS.
const DEDUPE_TTL_MS = 10 * 60_000;
const recentKeys = new Map<string, number>();

/**
 * Enqueue an on-chain event for the bot to post. When dedupeKey (normally the tx
 * signature) was seen within the TTL, the item is dropped. `now` is injected so
 * callers pass the server clock and tests stay deterministic. Returns true when the
 * item was newly enqueued, false when it was a duplicate.
 */
export function enqueueOnchain(item: OnchainEvent, dedupeKey: string | null, now: number): boolean {
  if (dedupeKey) {
    const last = recentKeys.get(dedupeKey);
    if (last !== undefined && now - last < DEDUPE_TTL_MS) return false;
    recentKeys.set(dedupeKey, now);
    if (recentKeys.size > 1024) {
      for (const [k, t] of recentKeys) {
        if (now - t >= DEDUPE_TTL_MS) recentKeys.delete(k);
      }
    }
  }
  QUEUE.push(item);
  if (QUEUE.length > MAX_QUEUE) QUEUE.splice(0, QUEUE.length - MAX_QUEUE);
  return true;
}

/** Remove and return everything queued (the bot calls this each poll). */
export function drainOnchain(): OnchainEvent[] {
  return QUEUE.splice(0, QUEUE.length);
}

/** Current queue depth (for tests / diagnostics). */
export function onchainQueueDepth(): number {
  return QUEUE.length;
}

/** Clear queue + dedupe memory (tests only). */
export function resetOnchainForTests(): void {
  QUEUE.length = 0;
  recentKeys.clear();
}
