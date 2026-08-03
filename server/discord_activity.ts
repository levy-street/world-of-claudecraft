// Significant-activity feed: the game loop detects notable moments (a character
// reaching max level, a rare drop, a duel result, an arena win, a decided Vale
// Cup match, a masterwork craft, a feed-worthy deed) and enqueues a structured
// item here; the bot drains /internal/discord/activity and posts a rich card to
// the activity channel, tagging the linked Discord user(s) involved.
//
// Pure + dependency-free (no Discord IO, no DB), so it is trivially testable. The
// drain endpoint resolves accountIds to Discord identities; this layer is just the
// in-memory hand-off, mirroring discord_relay.ts.

export type ActivityKind =
  | 'levelup'
  | 'rareloot'
  | 'duel'
  | 'arena'
  | 'vale_cup'
  | 'masterwork'
  | 'deed';

export interface QueuedActivity {
  kind: ActivityKind;
  // Accounts to tag (resolved to Discord ids at drain). Index 0 is the primary
  // subject (drives the card avatar/profile); duels carry [winner, loser].
  accountIds: number[];
  // Character names parallel to accountIds (display when a player is not linked).
  names: string[];
  realm: string;
  // Public profile URL of the primary subject, or null.
  profileUrl: string | null;
  // Type-specific payload (only the relevant fields are set):
  level?: number; // levelup
  itemName?: string; // rareloot; masterwork; the first-koi deed's catch name
  quality?: string; // rareloot ('epic' | 'legendary')
  winnerName?: string; // duel
  loserName?: string; // duel
  ratingDelta?: number; // arena (signed)
  bracket?: number; // vale_cup (1..5, an NvN bout)
  scoreA?: number; // vale_cup
  scoreB?: number; // vale_cup
  winnerNation?: string; // vale_cup (VcNationId banner of the winning side)
  deedId?: string; // deed
  deedName?: string; // deed (English deed name; the bot posts English)
  deedTitle?: string; // deed, when the deed rewards a title
}

const QUEUE: QueuedActivity[] = [];
/** Backstop so a stalled/absent bot can never grow this unbounded (exported so the
 * outbox payload-bound fixture builds its worst case from the REAL cap, not a mirror). */
export const ACTIVITY_MAX_QUEUE = 100;
const MAX_QUEUE = ACTIVITY_MAX_QUEUE;

// Recent dedupe keys with their wall-clock time, so a moment that surfaces as
// several sim events (a loot roll per candidate, an arena end per ally) is posted
// once. Keys expire after DEDUPE_TTL_MS.
const DEDUPE_TTL_MS = 30_000;
// Sized for the 1,000-concurrent load target the packet was measured
// against, not for comfort at today's population: the map is SHARED across
// every activity kind (rareloot per roll id, duel, vale_cup, deed,
// masterwork per account), so at the old 512 cap a sustained rate above
// about 17 keyed events per second would keep the live set at the cap and
// the oldest-first backstop would evict aged masterwork windows still
// inside their TTL, each eviction buying one duplicate card plus one extra
// opt-out db read inside the window it was supposed to own. 4096 keys is
// about 8x that rate before eviction starts, and the memory (a short
// string and a number per entry) is negligible.
// Exported for the same reason as ACTIVITY_MAX_QUEUE above: the sweep test
// sizes its fixture from the REAL trigger, not a mirror that drifts.
export const MAX_RECENT_KEYS = 4096;
// After a rejected gated read the claimant re-opens the key only this far
// into the future: a single blip costs one card (a retry lands 2s later),
// while a sustained outage still costs at most one read per backoff window
// instead of one per proc against the already-failing pool.
const RELEASE_RETRY_BACKOFF_MS = 2_000;
const recentKeys = new Map<string, number>();

/**
 * Atomically claim a dedupe key: true means claimed (proceed), false means the
 * key was seen within the TTL. Exists so a caller can gate EXPENSIVE work (the
 * masterwork arm's per-proc opt-out db read) behind the dedupe rather than
 * only the enqueue: a check-then-read would let a same-tick burst pass the
 * check together with every read still in flight, so the claim must test and
 * set in one synchronous step. A caller that claimed passes a NULL key to
 * enqueueActivity (the key is already spent).
 */
export function claimDedupeKey(key: string, now: number): boolean {
  const last = recentKeys.get(key);
  if (last !== undefined && now - last < DEDUPE_TTL_MS) return false;
  // Delete-then-set so a re-claimed key moves to the END of insertion order:
  // Map.set on an existing key keeps its ORIGINAL slot, which would make the
  // eviction below drop the freshest window first and quietly lean on the
  // never-grows-on-reclaim size invariant instead of on position.
  recentKeys.delete(key);
  recentKeys.set(key, now);
  if (recentKeys.size > MAX_RECENT_KEYS) {
    for (const [k, t] of recentKeys) {
      if (now - t >= DEDUPE_TTL_MS) recentKeys.delete(k);
    }
    // Live-set overflow backstop: expiry freed nothing (more than the cap of
    // keys all inside the TTL), so evict oldest-first down to the cap. This
    // bounds the live set's MEMORY and thereby the SIZE of the per-claim
    // expiry sweep (which still runs whenever the population sits at the
    // cap); an evicted key can let one duplicate card through, which at
    // this population beats an unbounded map.
    if (recentKeys.size > MAX_RECENT_KEYS) {
      const over = recentKeys.size - MAX_RECENT_KEYS;
      let evicted = 0;
      for (const k of recentKeys.keys()) {
        if (evicted++ >= over) break;
        recentKeys.delete(k);
      }
    }
  }
  return true;
}

/**
 * Release a claimed dedupe key: the claimant's gated work FAILED (a rejected
 * opt-out read), so the TTL window must not stay burned; without this, one
 * db blip would silently drop the failed proc AND every proc for that
 * account for the rest of the TTL. `claimedAt` is the caller's claim stamp:
 * the release is a compare-and-set, so a LATE rejection (a driver-timeout
 * reject can land after the TTL) cannot delete a window a newer claimant
 * now owns. The re-stamp (not a delete) keeps a retry backoff: the next
 * claim succeeds RELEASE_RETRY_BACKOFF_MS after the failed one, never
 * immediately. The backoff is measured from the CLAIM, not the failure,
 * which is safe ONLY because the key stays burned for the whole in-flight
 * read: releasing before the read settles would zero the backoff for any
 * failure slower than the backoff window.
 */
export function releaseDedupeKey(key: string, claimedAt: number): void {
  if (recentKeys.get(key) !== claimedAt) return;
  recentKeys.set(key, claimedAt - DEDUPE_TTL_MS + RELEASE_RETRY_BACKOFF_MS);
}

/**
 * Enqueue an activity for the bot to post. When dedupeKey is given and was seen
 * within the TTL, the item is dropped (so one moment yields one card). `now` is
 * injected so callers pass the server clock (and tests stay deterministic).
 */
export function enqueueActivity(item: QueuedActivity, dedupeKey: string | null, now: number): void {
  if (dedupeKey && !claimDedupeKey(dedupeKey, now)) return;
  QUEUE.push(item);
  if (QUEUE.length > MAX_QUEUE) QUEUE.splice(0, QUEUE.length - MAX_QUEUE);
}

/** Remove and return everything queued (the bot calls this each poll). */
export function drainActivity(): QueuedActivity[] {
  return QUEUE.splice(0, QUEUE.length);
}

/**
 * Put drained items BACK at the front, in their original order, so a poll whose response
 * failed to build costs the bot a retry rather than the cards themselves (the outbox
 * drain, server/internal.ts). The recentKeys dedupe map is deliberately untouched: these
 * items already claimed their keys at enqueue and are the SAME items, so re-claiming
 * would only re-stamp a window that is already correct. HONEST LIMIT: as in
 * requeueRelay, a queue that refilled past the cap during the failed poll spends the
 * requeued (oldest) items first; "preserved on error" holds only up to the cap.
 */
export function requeueActivity(items: readonly QueuedActivity[]): void {
  if (items.length === 0) return;
  QUEUE.unshift(...items);
  if (QUEUE.length > MAX_QUEUE) QUEUE.splice(0, QUEUE.length - MAX_QUEUE);
}

/** Current queue depth (for tests / diagnostics). */
export function activityQueueDepth(): number {
  return QUEUE.length;
}
