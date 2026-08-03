// Linked-member change feed: wherever the server ALREADY learns that a linked
// account's flex-relevant state moved (character level or which character is the
// account's top one, reward points or the derived status tier, a link, an unlink) it
// enqueues a record here; the bot drains the feed through the consolidated outbox poll
// and re-pushes only the members that actually changed. Without it, the only way the
// bot notices is to re-read every online member's flex payload on a timer.
//
// Pure + dependency-free (no DB, no IO, no Discord types), mirroring discord_relay.ts
// and discord_activity.ts. The drain endpoint resolves accountIds to Discord identities;
// this layer is just the in-memory hand-off.
//
// DEDUPE: a burst of transitions for one account collapses into the single UNDRAINED
// item already queued for that account, merging kinds and keeping that item's original
// FIFO position, for as long as the item is younger than DEDUPE_TTL_MS. The window is
// measured from when the item was minted and a merge does not extend it, so a steady
// stream of transitions for one account still yields a fresh item every TTL rather than
// one item that absorbs changes forever. Dedupe NEVER consults DELIVERED history: a drain
// clears the pending entry of every item it hands over (a paged drain clears exactly its
// page, never the remainder), so the next enqueue for a delivered account mints a fresh
// item even one millisecond later. A change deduped against an already-delivered item is
// a change the bot never sees, which is the exact staleness this feed exists to kill. An
// item that was drained and then REQUEUED (the outbox's failed-poll path) was never
// delivered, so it correctly becomes open again; see requeueLinkChanges.
//
// CAP: MAX_QUEUE bounds the feed when the bot is stalled or absent, the same backstop
// role it plays in relay/activity, but sized differently because the unit differs: those
// queues hold one item per event, this one holds at most one item per ACCOUNT per TTL.
// SIZING, honestly: the wiring produces up to one item per ACTIVE ACCOUNT per TTL,
// LINKED OR NOT, because the points feed rides playtime grants that reach every player.
// At the D18 envelope (1,000 concurrent players, the 5-minute playtime sweep) that is
// about 3.3 items per second, so a queue sized at the 5,000-member envelope fills after
// roughly 25 minutes of bot absence, not the days a "one item per guild member" reading
// would suggest. Past that point the EVICTION LADDER is what keeps the feed useful,
// four rungs, each oldest-first, the next rung consulted only when the previous is
// exhausted: (1) playtime noise (kinds exactly ['points'] and no carried Discord id),
// the class the drain drops anyway when the account resolves unlinked; (2) any other
// id-less item without a 'link'/'unlink' kind (a 'flex' or mixed item whose staleness
// the bot's periodic resync heals); (3) anything else without a 'link'/'unlink' kind,
// id-carrying included; (4) plain oldest-first. 'link'/'unlink' items (whose carried
// discordId is the bot's only copy of which member to start or stop flairing) are
// therefore the LAST thing the cap spends, surviving until nothing else is left to
// evict. Either way the drop is bounded staleness, not data loss: the bot's
// periodic full re-read of the linked set heals anything the feed dropped.
//
// PER PROCESS, like relay and activity: this queue is in-memory and lives in ONE realm
// process. An enqueue fires on whichever process served the write, so a fleet's changes
// are spread across the processes that observed them, and only the process the bot polls
// answers with its own. That is the same shape the two sibling feeds already have; the
// heal for anything a peer process holds (or a restart drops) is the bot's periodic full
// resync, which is also what heals an eviction.

/** Which class of transition an enqueue site observed. */
export type LinkChangeKind =
  /** Character level, class, or which character is the account's top one. */
  | 'flex'
  /** Reward points, and with them the derived status tier. */
  | 'points'
  /** A Discord link row was created. */
  | 'link'
  /** A Discord link row was removed. */
  | 'unlink';

/** One linked-member change awaiting delivery to the bot. */
export interface QueuedLinkChange {
  /** Account whose state moved (the bot re-reads this account at drain). */
  accountId: number;
  /** Discord id, carried when the enqueue site already has it (never looked up here). */
  discordId?: string;
  /** Transition kinds observed for this account, in first-seen order, no repeats. */
  kinds: LinkChangeKind[];
}

/** Feed cap: one item per account at the D18 envelope of 5,000 guild members. */
export const LINK_CHANGE_MAX_QUEUE = 5000;

/**
 * Redundant re-statement of the enum in one place the eviction rule can point at:
 * an item whose kinds are EXACTLY ['points'] and which carries no Discord id is a
 * playtime grant for an account the enqueue site could not name, i.e. the class the
 * outbox drops anyway when it cannot resolve an identity. That makes it the cheapest
 * thing to lose at the cap.
 */
function isPlaytimeNoise(item: QueuedLinkChange): boolean {
  return item.discordId === undefined && item.kinds.length === 1 && item.kinds[0] === 'points';
}

/**
 * The middle rung of the eviction ladder: no carried id and no 'link'/'unlink' kind.
 * These are 'flex' (or mixed flex/points) items that fire for every account, linked or
 * not, so at the cap they are the same resolve-or-drop lottery as playtime noise; what
 * they are NOT is a link transition whose carried id the bot can never re-learn from a
 * resync. Spending them before any 'link'/'unlink' item is what makes the header's
 * survival claim true rather than aspirational (found by the Phase 5 QA privacy
 * review: the old two-rung rule let an id-less flex item outlive a link item).
 */
function isEvictableFlexNoise(item: QueuedLinkChange): boolean {
  return (
    item.discordId === undefined && !item.kinds.includes('link') && !item.kinds.includes('unlink')
  );
}

/** How long an undrained item stays open to absorb further changes for its account. */
export const LINK_CHANGE_DEDUPE_TTL_MS = 30_000;

const QUEUE: QueuedLinkChange[] = [];

// Account id to the undrained item it may still merge into, plus the time that item was
// minted. Only ever holds items currently in QUEUE: a drain clears the whole index and
// an overflow eviction deletes the entry it dropped, so this can never point at an item
// the bot has already been handed, and its size is bounded by the cap.
const pending = new Map<number, { item: QueuedLinkChange; at: number }>();

// When each queued item was MINTED, kept off the item itself so the drained shape stays
// exactly what the endpoint ships. It exists for requeueLinkChanges: a drain that the
// handler later puts back has to restore the item's dedupe window at its ORIGINAL
// deadline, never a fresh one, or a requeue would extend a window the header promises a
// merge cannot extend. Weak so an evicted or delivered item is collectable.
const mintedAt = new WeakMap<QueuedLinkChange, number>();

/** Drop the pending-index entry an item owns, if it still owns one (identity, not id). */
function forgetPending(item: QueuedLinkChange): void {
  if (pending.get(item.accountId)?.item === item) pending.delete(item.accountId);
}

// The eviction ladder, cheapest loss first (see the CAP note at the top). The final
// rung accepts anything, so the ladder always finds enough to evict. The third rung
// exists so the "link/unlink go last" promise is STRUCTURAL rather than an accident
// of today's enqueue sites: rung 2 keys on `discordId === undefined`, so an
// id-carrying non-link item (no site mints one today, but nothing stops a future
// flex site that happens to know the id) would otherwise skip straight to the
// anything-goes rung and could outlive a link item (QA fresh-eyes round).
const EVICTION_LADDER: ReadonlyArray<(item: QueuedLinkChange) => boolean> = [
  isPlaytimeNoise,
  isEvictableFlexNoise,
  (item) => !item.kinds.includes('link') && !item.kinds.includes('unlink'),
  () => true,
];

/**
 * Bring the queue back to the cap by walking the eviction ladder: all of tier 1
 * (oldest-first) before any of tier 2, and so on (see the CAP note at the top). One
 * marking pass per rung plus one compaction pass, so a burst requeue at the cap costs
 * O(queue) rather than the O(queue * evictions) the old per-eviction findIndex rescan
 * paid (measured at 21 ms for a 1,000-item requeue into a full queue; this shape is
 * well under a millisecond there).
 */
function trimToCap(): void {
  const excess = QUEUE.length - LINK_CHANGE_MAX_QUEUE;
  if (excess <= 0) return;
  // Identity-keyed marking assumes each item object appears in QUEUE at most once,
  // which every path guarantees (enqueue mints fresh objects, merges never push,
  // requeue re-inserts a freshly spliced page). A duplicate identity would be
  // dropped in both positions while counting as one eviction.
  const drop = new Set<QueuedLinkChange>();
  for (const rung of EVICTION_LADDER) {
    if (drop.size >= excess) break;
    for (const item of QUEUE) {
      if (drop.size >= excess) break;
      if (!drop.has(item) && rung(item)) drop.add(item);
    }
  }
  let write = 0;
  for (const item of QUEUE) {
    if (drop.has(item)) forgetPending(item);
    else QUEUE[write++] = item;
  }
  QUEUE.length = write;
}

/**
 * Enqueue a linked-member change for the bot to pick up, merging into the account's open
 * item when one is still within the TTL (see the dedupe rule at the top of this file).
 * `now` is injected so callers pass the server clock and tests stay deterministic.
 */
export function enqueueLinkChange(change: QueuedLinkChange, now: number): void {
  const open = pending.get(change.accountId);
  if (open && now - open.at < LINK_CHANGE_DEDUPE_TTL_MS) {
    for (const kind of change.kinds) {
      if (!open.item.kinds.includes(kind)) open.item.kinds.push(kind);
    }
    // First id observed wins; a merge only ever FILLS a gap, so a site that has the id
    // completes an item enqueued by one that did not. The drain resolves the
    // authoritative link anyway.
    if (open.item.discordId === undefined && change.discordId !== undefined) {
      open.item.discordId = change.discordId;
    }
    return;
  }
  // Copied field by field: merges mutate the stored kinds array, so the caller's object
  // must not be the one the queue holds.
  const kinds: LinkChangeKind[] = [];
  for (const kind of change.kinds) {
    if (!kinds.includes(kind)) kinds.push(kind);
  }
  const item: QueuedLinkChange = { accountId: change.accountId, kinds };
  if (change.discordId !== undefined) item.discordId = change.discordId;
  QUEUE.push(item);
  pending.set(item.accountId, { item, at: now });
  mintedAt.set(item, now);
  trimToCap();
}

/**
 * Remove and return queued items (the bot calls this each poll).
 *
 * With no argument this is the whole queue, which is what a poll that can act on
 * everything wants. With `max` it is a PAGE: the first `max` items in FIFO order, and
 * only THEIR pending-index entries are dropped. The remainder stays queued with its
 * dedupe entries intact, so a later enqueue for one of those accounts still merges into
 * the item already waiting rather than minting a second one, and the next drain carries
 * the rest. Paging is how the outbox bounds both its serialization cost and the number of
 * items at risk in a single failed poll (server/internal.ts OUTBOX_LINK_CHANGE_PAGE).
 */
export function drainLinkChanges(max?: number): QueuedLinkChange[] {
  if (max === undefined || max >= QUEUE.length) {
    // Every pending entry points at an item in QUEUE, so a full drain can clear the
    // whole index rather than walking it.
    pending.clear();
    return QUEUE.splice(0, QUEUE.length);
  }
  const page = QUEUE.splice(0, Math.max(0, max));
  for (const item of page) forgetPending(item);
  return page;
}

/**
 * Put drained items BACK at the front, in their original order (the outbox calls this
 * when the response it was building failed, so a poll that answers 500 costs the bot
 * nothing but a retry).
 *
 * The pending-index entry is restored only when the account has NO open item: a newer
 * item minted while these were in flight keeps ownership, and the two items for one
 * account simply both drain later, which is correct (the bot re-reads the account) and
 * strictly better than merging into an item whose FIFO position is behind this one. A
 * restored entry keeps the item's ORIGINAL mint stamp, so the requeue cannot extend a
 * dedupe window; an item older than the TTL is simply closed again on the next enqueue.
 *
 * Merging into a requeued item is NOT the "dedupe against drained history" defect the
 * header forbids: these items were never delivered, so a change folded into one still
 * reaches the bot on the next poll.
 *
 * HONEST LIMIT, as in requeueRelay/requeueActivity: a queue that refilled past the
 * cap during the failed poll evicts on the requeue, so "costs the bot nothing but a
 * retry" holds only up to the cap. The eviction ladder still applies, so requeued
 * link/unlink items are the last thing spent.
 */
export function requeueLinkChanges(items: readonly QueuedLinkChange[]): void {
  if (items.length === 0) return;
  QUEUE.unshift(...items);
  for (const item of items) {
    const at = mintedAt.get(item);
    if (at !== undefined && !pending.has(item.accountId)) pending.set(item.accountId, { item, at });
  }
  trimToCap();
}

/** Current queue depth (for tests / diagnostics). */
export function linkChangeDepth(): number {
  return QUEUE.length;
}
