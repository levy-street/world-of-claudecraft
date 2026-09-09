// Queue-pop pings: when a player's Thornhollow Fields (battleground) offer
// opens or their Ashen Coliseum (arena) queue seats them, the Discord bot DMs
// the player's linked Discord account, so a player who alt-tabbed while waiting
// in the queue sees the pop before the Accept window lapses. This module is the
// server-side hand-off, the discord_relay.ts / discord_activity.ts shape: game.ts
// hands the tick's drained events to observeQueuePops, the opt-in read filters
// the players (accounts.discord_queue_pings, and only linked accounts), the
// enqueue lands here, and the bot drains the queue through the consolidated
// GET /internal/discord/outbox poll (server/internal.ts outboxHandler).
//
// The pure core (the pop candidates a batch of events names, the queue with its
// dedupe and cap, the opt-in cache and its failure backoff, the queue-watch
// signal) takes its IO as an injected deps object with production defaults, so
// tests drive it with no DB and no clock (the bot/ member_writes.ts
// convention). Only `pool` and `Date.now` are reached through the defaults.
//
// LATENCY, and the reason for the watch signal: the bot's outbox poll runs at
// its active cadence only while drains keep finding work, then decays toward a
// 15 s idle interval, while the battleground Accept window is 30 s
// (BG_PROPOSAL_SECONDS). A pop landing in an idle poll gap could cost half the
// window before the DM leaves. So the outbox also reports WHETHER any opted-in,
// linked player is currently waiting in a battleground or arena queue
// (queuePopsWatching), and the bot treats that as work: it holds the fast
// cadence for exactly as long as a DM could be needed, and nothing else costs
// it a poll. The signal is recomputed from the sim's own queue arrays every
// tick, never from join/leave bookkeeping, so a player who disconnects while
// queued cannot leave the cadence pinned.
//
// EXPIRY: every item carries the wall-clock deadline past which the pop is
// moot (the Accept window lapsed, or the arena countdown ran out). The drain
// drops items already past it and the bot re-checks at send time, so a bot
// that was absent for minutes never DMs a player about an offer that lapsed
// while it was away.
//
// THE OPT-IN READ IS ONE OBSERVER-WIDE BATCH, never one per account. At most
// one batch is ever in flight (`activeBatch` below): a tick that finds the
// cache already refreshing hands back that SAME promise rather than opening a
// second concurrent read or attaching another waiter to it, so an arbitrarily
// churning queue can never grow the number of batches in flight. A completed
// batch is throttled to at most one every QUEUE_POP_MIN_BATCH_INTERVAL_MS
// (independent of how large or thrashy the cache is: a disabled realm
// admission cap, MAX_PLAYERS_PER_REALM<=0, can hold far more live accounts
// than the cache floor, so cache misses alone must never set the read rate),
// and each batch reads at most QUEUE_POP_MAX_BATCH_IDS accounts. Pending
// misses are drained fairly: pop candidates (delayedCandidates, which a
// player's own Accept window bounds) are always read before plain
// queue-watch refreshes, and within each tier the LEAST RECENTLY BATCHED
// account is read first (delayedCandidates' own insertion order for
// candidates, the watchLastBatchedAt timestamp for plain queue-watch
// accounts), so no id can be starved behind a stream of newer or
// re-cycling ones, even when the queue steadily holds more accounts than
// the cache floor plus one batch (see watchLastBatchedAt's declaration).
// Against the shortest deadline in play (the 30 s Accept window), a worst
// case of one batch interval plus one DB round trip is negligible; see the
// responsiveness tradeoff note on QUEUE_POP_MIN_BATCH_INTERVAL_MS.
//
// DEDUPE: one UNDRAINED item per account. A re-pop for the same account (an
// accepter re-queued and re-proposed after someone else declined) refreshes
// the queued item in place, keeping its FIFO position. Delivered history is
// never consulted: a fresh pop after a delivered one is a fresh DM, which is
// the right answer, since it is a new offer with a new deadline.
//
// PER PROCESS, like the sibling feeds: this queue and the cache live in ONE
// realm process, the one whose game loop observed the pop, and the bot polls
// each process it is pointed at.

import type { SimEvent } from '../src/sim/types';
import { pool } from './db';
import {
  bustQueuePingCache,
  cachedQueuePingOptIn,
  QUEUE_PING_CACHE_TTL_MS,
  queuePingCacheBustStamp,
  queuePingReadBackedOff,
  recordQueuePingReadFailure,
  rememberQueuePingOptIn,
  resetQueuePingCacheForTests,
} from './discord_queue_ping_cache';
import { accountsWithDiscordQueuePings } from './discord_queue_pings_db';

export {
  bustQueuePingCache,
  QUEUE_PING_CACHE_TTL_MS,
  QUEUE_PING_FAILURE_BACKOFF_MS,
} from './discord_queue_ping_cache';

/** Which queue popped. */
export type QueuePopKind = 'bg' | 'arena';

/** One queue pop awaiting delivery to the bot. */
export interface QueuedQueuePop {
  /** Account whose queue popped (resolved to a Discord id at drain). */
  accountId: number;
  /** The queued character's name, for the DM copy. */
  characterName: string;
  kind: QueuePopKind;
  /** Arena format id ('1v1', '2v2', ...), or null for a battleground pop. */
  format: string | null;
  /**
   * The battleground Accept window in seconds. 0 for an arena pop: the
   * coliseum seats the player without an answer, so there is nothing to accept.
   */
  seconds: number;
  /** Wall-clock ms after which the pop is moot; see EXPIRY above. */
  expiresAtMs: number;
  realm: string;
}

/**
 * How long an arena pop stays worth delivering. The coliseum runs its own
 * countdown before the gates open, and a DM after the bout is under way tells
 * the player nothing they can act on; a minute covers the countdown with room
 * for one poll gap.
 */
export const ARENA_POP_TTL_MS = 60_000;

/**
 * Feed cap. A battleground pop is a burst of ten items at most and an arena
 * pop one or two, so even a stalled bot needs many pops in a row to reach it;
 * past the cap the OLDEST items are dropped, which the expiry rule would have
 * discarded first anyway.
 */
export const QUEUE_POP_MAX_QUEUE = 200;

/**
 * The most accounts ONE opt-in batch reads. A realm with the admission cap
 * disabled (MAX_PLAYERS_PER_REALM<=0) can carry far more live accounts than
 * the opt-in cache floor (QUEUE_PING_CACHE_FLOOR, 8,192), so nothing bounds
 * how many could be cache-unknown on any given tick; this cap is what keeps a
 * single query bounded regardless, at a cost of spreading a very large miss
 * set over several batches (see the fairness note on QUEUE_POP_MIN_BATCH_INTERVAL_MS).
 */
export const QUEUE_POP_MAX_BATCH_IDS = 2048;

/**
 * The floor between two COMPLETED (successful) opt-in batches, independent of
 * how many accounts are cache-unknown: bounding read frequency by the clock
 * rather than by cache size is what keeps a thrashing cache (more live
 * accounts than QUEUE_PING_CACHE_FLOOR, see QUEUE_POP_MAX_BATCH_IDS) from
 * driving one DB batch every tick. RESPONSIVENESS TRADEOFF: at 20 Hz this is
 * a handful of ticks, worth stating against the deadlines it delays: a fresh
 * pop candidate in an idle, below-cap batch waits one interval plus its DB
 * round trip. An already-running read adds its remaining time; larger bursts
 * need multiple batches (ceil(unknown accounts / batch cap) on a stable set),
 * and pop candidates take priority over queue-watch refreshes. Deadlines still
 * expire stale notifications during long reads or outages. A
 * failed batch is governed by the separate, longer QUEUE_PING_FAILURE_BACKOFF_MS
 * instead (see discord_queue_ping_cache.ts); this floor applies only between
 * batches that actually completed.
 */
export const QUEUE_POP_MIN_BATCH_INTERVAL_MS = 250;

/** What the observer needs from its host, the session identity of a pid. */
export interface QueuePopSession {
  accountId: number;
  name: string;
}

/** The observer's IO, injected so the decision core runs with no DB and no clock. */
export interface QueuePopDeps {
  sessionFor(pid: number): QueuePopSession | undefined;
  /**
   * Which of these accounts opted in AND hold a Discord link. Rejections are
   * logged and swallowed by the observer: a failed read loses one pop's DM,
   * never the tick.
   */
  optedIn(accountIds: readonly number[]): Promise<number[]>;
  now(): number;
  realm: string;
}

/** The sim queue arrays the watch signal reads; see queuedPidsOf. */
export interface QueuedPidsSource {
  bgQueue: readonly { pids: readonly number[] }[];
  arenaQueue1v1: readonly number[];
  arenaQueue2v2: readonly { pids: readonly number[] }[];
  arenaQueueFiesta: readonly { pids: readonly number[] }[];
  arenaQueueYumi3: readonly { pids: readonly number[] }[];
  arenaQueueYumi5: readonly { pids: readonly number[] }[];
}

/** Every pid currently waiting in a battleground or arena queue. */
export function queuedPidsOf(ctx: QueuedPidsSource): number[] {
  const out: number[] = [...ctx.arenaQueue1v1];
  for (const list of [
    ctx.bgQueue,
    ctx.arenaQueue2v2,
    ctx.arenaQueueFiesta,
    ctx.arenaQueueYumi3,
    ctx.arenaQueueYumi5,
  ]) {
    for (const unit of list) out.push(...unit.pids);
  }
  return out;
}

const QUEUE: QueuedQueuePop[] = [];

// Account id -> the undrained item it may still refresh. Only ever holds items
// currently in QUEUE: a drain clears it wholesale and an overflow eviction
// deletes the entry it dropped.
const pending = new Map<number, QueuedQueuePop>();

// The watch signal the outbox reports; see the header. Recomputed per tick.
let watching = false;

/** Enqueue a pop for the bot, refreshing the account's undrained item if it has one. */
export function enqueueQueuePop(item: QueuedQueuePop): void {
  const open = pending.get(item.accountId);
  if (open) {
    Object.assign(open, item);
    return;
  }
  QUEUE.push(item);
  pending.set(item.accountId, item);
  while (QUEUE.length > QUEUE_POP_MAX_QUEUE) {
    const dropped = QUEUE.shift();
    if (dropped && pending.get(dropped.accountId) === dropped) pending.delete(dropped.accountId);
  }
}

/**
 * Remove and return everything queued that is still worth delivering (the
 * bot calls this each poll). Items already past their deadline are discarded
 * here rather than handed over: a DM about a lapsed offer is noise.
 */
export function drainQueuePops(now: number): QueuedQueuePop[] {
  const all = QUEUE.splice(0, QUEUE.length);
  pending.clear();
  return all.filter((item) => item.expiresAtMs > now);
}

/**
 * Put drained items BACK at the front, in their original order, so a poll whose
 * response failed to build costs the bot a retry rather than the DMs (the
 * outbox drain, server/internal.ts). The cap trim is the same drop-the-oldest
 * rule an enqueue applies. A requeued item becomes open to refresh again: it
 * was never delivered.
 */
export function requeueQueuePops(items: readonly QueuedQueuePop[]): void {
  if (items.length === 0) return;
  const requeued: QueuedQueuePop[] = [];
  for (const item of items) {
    const open = pending.get(item.accountId);
    if (open) {
      Object.assign(open, item);
    } else {
      requeued.push(item);
      pending.set(item.accountId, item);
    }
  }
  QUEUE.unshift(...requeued);
  while (QUEUE.length > QUEUE_POP_MAX_QUEUE) {
    const dropped = QUEUE.shift();
    if (dropped && pending.get(dropped.accountId) === dropped) pending.delete(dropped.accountId);
  }
}

/** Current queue depth (for tests / diagnostics). */
export function queuePopQueueDepth(): number {
  return QUEUE.length;
}

/** Whether an opted-in, linked player is waiting in a queue right now; see the header. */
export function queuePopsWatching(): boolean {
  return watching;
}

/** Test seam: forget the queue, the cache and the watch signal. */
export function resetQueuePopsForTests(): void {
  QUEUE.length = 0;
  pending.clear();
  delayedCandidates.clear();
  watchLastBatchedAt.clear();
  activeBatch = null;
  lastBatchCompletedAt = Number.NEGATIVE_INFINITY;
  resetQueuePingCacheForTests();
  watching = false;
}

/** A pop candidate named by one event, before the opt-in read. */
interface PopCandidate {
  accountId: number;
  characterName: string;
  kind: QueuePopKind;
  format: string | null;
  seconds: number;
  expiresAtMs: number;
}

interface DelayedCandidate {
  candidate: PopCandidate;
  realm: string;
}

// Every pop candidate still awaiting an opt-in answer, insertion-ordered
// (oldest first): also the observer-wide "candidate" read priority tier, so a
// batch always drains the longest-waiting candidates first. Entries persist
// across ticks until answered or swept as expired; see the expiry sweep in
// observeQueuePops.
const delayedCandidates = new Map<number, DelayedCandidate>();

// The last time (deps.now()) a plain queue-watch account (one with no pop
// candidate) was actually included in a batch; see nextBatchIds. A queue can
// steadily hold more accounts than QUEUE_PING_CACHE_FLOOR + QUEUE_POP_MAX_BATCH_IDS,
// in which case cache eviction churn alone can never make every account's
// answer cache-unknown at once: picking the cache-unknown ids in ARRAY order
// every tick would let whichever ids sit at the FRONT of queuedAccounts cycle
// through eviction and re-read forever while an id nearer the back, evicted
// only once the cache first fills, waits behind that cycle indefinitely (an id
// past cache_max + batch_cap is never reached: reproduced with 8,193 steady
// accounts staying green while 10,241+ starved). Sorting the cache-unknown set
// by this timestamp instead (oldest/never-batched first) fixes that: no id can
// be picked twice while a never-yet-batched id is still waiting, regardless of
// where either sits in queuedAccounts. Pruned for ids no longer queued so it
// stays bounded by the live queue size, never by history.
const watchLastBatchedAt = new Map<number, number>();

// The one opt-in batch in flight, if any; see the header note on THE OPT-IN
// READ IS ONE OBSERVER-WIDE BATCH. Every tick that finds this set hands it
// straight back instead of starting a second concurrent read or attaching a
// new waiter.
let activeBatch: Promise<void> | null = null;

// When the last batch that actually COMPLETED (succeeded OR failed cleanly,
// as opposed to still being in flight) finished; gates QUEUE_POP_MIN_BATCH_INTERVAL_MS.
let lastBatchCompletedAt = Number.NEGATIVE_INFINITY;

/** Pending delayed-candidate count (for tests / diagnostics); see the expiry sweep in observeQueuePops. */
export function delayedQueuePopCandidateCount(): number {
  return delayedCandidates.size;
}

/**
 * Tracked queue-watch-account count (for tests / diagnostics): proves
 * watchLastBatchedAt stays bounded by the LIVE queue rather than growing with
 * every account ever seen, see its declaration and nextBatchIds' pruning.
 */
export function queueWatchTrackedAccountCount(): number {
  return watchLastBatchedAt.size;
}

/**
 * The pops a batch of drained events names, pure over the session lookup.
 * `bgProposed` carries the Accept window; `arenaFound` has no answer step, so
 * its deadline is the fixed ARENA_POP_TTL_MS. Bots have no session, so the
 * lookup filters them naturally, and an event without a pid is not personal.
 */
export function collectQueuePops(
  events: readonly SimEvent[],
  sessionFor: (pid: number) => QueuePopSession | undefined,
  now: number,
): PopCandidate[] {
  const out: PopCandidate[] = [];
  for (const ev of events) {
    if (ev.pid === undefined) continue;
    if (ev.type !== 'bgProposed' && ev.type !== 'arenaFound') continue;
    const session = sessionFor(ev.pid);
    if (!session) continue;
    if (ev.type === 'bgProposed') {
      out.push({
        accountId: session.accountId,
        characterName: session.name,
        kind: 'bg',
        format: null,
        seconds: ev.seconds,
        expiresAtMs: now + ev.seconds * 1000,
      });
    } else {
      out.push({
        accountId: session.accountId,
        characterName: session.name,
        kind: 'arena',
        format: ev.format,
        seconds: 0,
        expiresAtMs: now + ARENA_POP_TTL_MS,
      });
    }
  }
  return out;
}

/**
 * The next batch's account ids, fairly prioritized: every still-pending pop
 * candidate first (delayedCandidates, oldest first, so a candidate can never
 * starve behind a stream of newer ones), then every queued account with no
 * fresh cached answer, LEAST-RECENTLY-BATCHED first (watchLastBatchedAt; see
 * its declaration for why array order alone starves a tail id under cache
 * churn), stopping at `cap`. Anything left past the cap simply reappears on a
 * LATER batch's build: a candidate stays in delayedCandidates until answered
 * or expired, and a still-queued account is recomputed fresh from the live
 * queue arrays every tick, so nothing needs its own separate retry
 * bookkeeping beyond the one shared timestamp per id.
 */
function nextBatchIds(queuedAccounts: readonly number[], now: number, cap: number): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const id of delayedCandidates.keys()) {
    if (ids.length >= cap) return ids;
    if (cachedQueuePingOptIn(id, now) !== undefined) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length >= cap) return ids;

  // Prune ids no longer queued so the map stays bounded by live queue size,
  // never by history: an account that left never gets to "keep its place"
  // and a re-joined account is correctly treated as never-batched again.
  const queuedSet = new Set(queuedAccounts);
  for (const id of watchLastBatchedAt.keys()) {
    if (!queuedSet.has(id)) watchLastBatchedAt.delete(id);
  }

  const unknown = [...queuedSet].filter(
    (id) => !seen.has(id) && cachedQueuePingOptIn(id, now) === undefined,
  );
  // Stable sort: ids that were never batched (undefined -> treated as -Infinity)
  // sort before any that were, and ties (including "never batched" ties)
  // preserve queuedAccounts order, so behavior only diverges from a plain
  // scan once churn actually makes it unfair.
  unknown.sort(
    (a, b) => (watchLastBatchedAt.get(a) ?? -Infinity) - (watchLastBatchedAt.get(b) ?? -Infinity),
  );
  for (const id of unknown) {
    if (ids.length >= cap) break;
    ids.push(id);
    watchLastBatchedAt.set(id, now);
  }
  return ids;
}

function enqueueCandidate(c: PopCandidate, realm: string): void {
  enqueueQueuePop({
    accountId: c.accountId,
    characterName: c.characterName,
    kind: c.kind,
    format: c.format,
    seconds: c.seconds,
    expiresAtMs: c.expiresAtMs,
    realm,
  });
}

/**
 * Start the ONE opt-in batch for `ids` (the caller already checked no batch is
 * active), resolving each id against the cache and against any delayed
 * candidate it answers. Sets `activeBatch` for the duration and clears it
 * (never leaving a stale reference for the next tick to reuse) plus stamps
 * `lastBatchCompletedAt` when it settles, success or failure alike: a failed
 * batch is ALREADY held back further by the separate, longer
 * QUEUE_PING_FAILURE_BACKOFF_MS, so stamping it too costs nothing extra.
 */
function startBatch(ids: readonly number[], deps: QueuePopDeps, now: number): Promise<void> {
  const readStarted = queuePingCacheBustStamp();
  activeBatch = deps
    .optedIn(ids)
    .then((opted) => new Set(opted))
    .catch((err) => {
      console.error('queue-pop opt-in read failed:', err);
      // The FAILURE time, not this tick's start time (`now`, captured before
      // the read began): a read slower than QUEUE_PING_FAILURE_BACKOFF_MS to
      // fail would otherwise back off a window that had already lapsed
      // before it was ever recorded (see recordQueuePingReadFailure).
      recordQueuePingReadFailure(deps.now());
      return null;
    })
    .then((set) => {
      for (const id of ids) {
        if (!set) {
          delayedCandidates.delete(id);
          continue;
        }
        const optedIn = set.has(id);
        if (!rememberQueuePingOptIn(id, optedIn, now, readStarted)) continue;
        const delayed = delayedCandidates.get(id);
        if (delayed) {
          delayedCandidates.delete(id);
          if (optedIn) enqueueCandidate(delayed.candidate, delayed.realm);
        }
      }
      lastBatchCompletedAt = deps.now();
    })
    .finally(() => {
      activeBatch = null;
    });
  return activeBatch;
}

/**
 * One tick's observer pass: enqueue the pops of opted-in linked players and
 * refresh the watch signal. Returns the active opt-in batch (resolved
 * immediately when nothing needs reading, or when one is already running and
 * this tick simply hands it back) so a test can await the asynchronous arm;
 * the game loop ignores it. The read's rejection is caught inside startBatch:
 * it costs the unanswered pops their DM and nothing else.
 */
export function observeQueuePops(
  events: readonly SimEvent[],
  queuedPids: readonly number[],
  deps: QueuePopDeps,
): Promise<void> {
  const now = deps.now();
  // A delayed candidate is not retried while the shared outage backoff is
  // open (queuePingReadBackedOff below) or while a batch is already in
  // flight, and a proposed/seated account drops out of queuedPids on the
  // very next tick (the sim moves it out of the queue arrays), so nothing
  // else would ever revisit it. Sweeping expired entries here (the same
  // "already past deadline" rule drainQueuePops applies) is what keeps a
  // transient read failure from leaking one entry per moot pop forever
  // instead of just costing that pop its DM.
  for (const [accountId, delayed] of delayedCandidates) {
    if (delayed.candidate.expiresAtMs <= now) delayedCandidates.delete(accountId);
  }
  const candidates = collectQueuePops(events, deps.sessionFor, now);
  const queuedAccounts: number[] = [];
  for (const pid of queuedPids) {
    const session = deps.sessionFor(pid);
    if (session) queuedAccounts.push(session.accountId);
  }
  // The watch signal reads the cache as it stands: a join whose answer is
  // still in flight (or not yet due for its own batch, see
  // QUEUE_POP_MIN_BATCH_INTERVAL_MS) arms it on a later tick.
  watching = queuedAccounts.some((id) => cachedQueuePingOptIn(id, now) === true);

  for (const c of candidates) {
    const known = cachedQueuePingOptIn(c.accountId, now);
    if (known === true) enqueueCandidate(c, deps.realm);
    else if (known === undefined)
      delayedCandidates.set(c.accountId, { candidate: c, realm: deps.realm });
  }

  // Exactly one batch in flight at a time: a tick that finds one running
  // hands it straight back rather than starting a second concurrent read or
  // attaching a new waiter to it (see the header note and the module docs
  // above nextBatchIds/startBatch).
  if (activeBatch) return activeBatch;
  if (queuePingReadBackedOff(now)) return Promise.resolve();
  if (now - lastBatchCompletedAt < QUEUE_POP_MIN_BATCH_INTERVAL_MS) return Promise.resolve();

  const ids = nextBatchIds(queuedAccounts, now, QUEUE_POP_MAX_BATCH_IDS);
  if (ids.length === 0) return Promise.resolve();
  return startBatch(ids, deps, now);
}

/** The production deps: the session lookup is the host's, the rest is real IO. */
export function queuePopDepsFor(
  sessionFor: (pid: number) => QueuePopSession | undefined,
  realm: string,
): QueuePopDeps {
  return {
    sessionFor,
    optedIn: (ids) => accountsWithDiscordQueuePings(pool, ids),
    now: () => Date.now(),
    realm,
  };
}
