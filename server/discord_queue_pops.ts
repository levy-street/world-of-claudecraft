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
// dedupe and cap, the opt-in cache, the queue-watch signal) takes its IO as an
// injected deps object with production defaults, so tests drive it with no DB
// and no clock (the bot/ member_writes.ts convention). Only `pool` and
// `Date.now` are reached through the defaults.
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
import { accountsWithDiscordQueuePings } from './discord_queue_pings_db';

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
 * How long an opt-in answer is believed before it is re-read. The toggle
 * route busts the entry it changes on this process, so the TTL only covers a
 * write that landed elsewhere (another realm process, an unlink) and the
 * eviction of players who stopped queueing.
 */
export const QUEUE_PING_CACHE_TTL_MS = 5 * 60_000;

/** Bound on the opt-in cache: one entry per account that queued recently. */
export const QUEUE_PING_CACHE_MAX = 4096;

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

// The opt-in cache: account id -> { opted in and linked, when it was read }.
// Insertion-ordered so the bound evicts the oldest read first.
const optIn = new Map<number, { value: boolean; at: number }>();

// The watch signal the outbox reports; see the header. Recomputed per tick.
let watching = false;

// Bust bookkeeping: a monotonic stamp per bust, so a read that STARTED before a
// toggle write landed cannot re-insert the answer that write invalidated.
// Bounded like the cache; entries are consumed by the read that observes them.
let bustStamp = 0;
const bustedAt = new Map<number, number>();

function cachedOptIn(accountId: number, now: number): boolean | undefined {
  const entry = optIn.get(accountId);
  if (!entry) return undefined;
  if (now - entry.at >= QUEUE_PING_CACHE_TTL_MS) {
    optIn.delete(accountId);
    return undefined;
  }
  return entry.value;
}

function rememberOptIn(accountId: number, value: boolean, now: number): void {
  optIn.delete(accountId);
  optIn.set(accountId, { value, at: now });
  while (optIn.size > QUEUE_PING_CACHE_MAX) {
    const oldest = optIn.keys().next();
    if (oldest.done) break;
    optIn.delete(oldest.value);
  }
}

/**
 * Forget an account's cached opt-in answer. The toggle route calls this on
 * every write so a player who opts in mid-queue is picked up by the next tick's
 * read rather than after the TTL.
 */
export function bustQueuePingCache(accountId: number): void {
  optIn.delete(accountId);
  bustedAt.delete(accountId);
  bustedAt.set(accountId, ++bustStamp);
  while (bustedAt.size > QUEUE_PING_CACHE_MAX) {
    const oldest = bustedAt.keys().next();
    if (oldest.done) break;
    bustedAt.delete(oldest.value);
  }
}

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
  optIn.clear();
  bustedAt.clear();
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
 * The accounts whose opt-in the observer should read this tick: every queued
 * player it has no fresh answer for, plus every pop candidate likewise. Reading
 * at queue JOIN (through the queued set) is what makes the watch signal and the
 * pop enqueue both answer from the cache in the common case, so a pop costs no
 * read of its own.
 */
function accountsToRead(
  candidates: readonly PopCandidate[],
  queuedAccounts: readonly number[],
  now: number,
): number[] {
  const ids = new Set<number>();
  for (const c of candidates) if (cachedOptIn(c.accountId, now) === undefined) ids.add(c.accountId);
  for (const id of queuedAccounts) if (cachedOptIn(id, now) === undefined) ids.add(id);
  return [...ids];
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
 * One tick's observer pass: enqueue the pops of opted-in linked players and
 * refresh the watch signal. Returns the pending opt-in read (resolved when
 * there was nothing to read) so a test can await the asynchronous arm; the
 * game loop ignores it. The read's rejection is caught here: it costs the
 * unanswered pops their DM and nothing else.
 */
export function observeQueuePops(
  events: readonly SimEvent[],
  queuedPids: readonly number[],
  deps: QueuePopDeps,
): Promise<void> {
  const now = deps.now();
  const candidates = collectQueuePops(events, deps.sessionFor, now);
  const queuedAccounts: number[] = [];
  for (const pid of queuedPids) {
    const session = deps.sessionFor(pid);
    if (session) queuedAccounts.push(session.accountId);
  }
  // The watch signal reads the cache as it stands: a join whose answer is
  // still in flight arms it on the next tick, one poll gap at the very most.
  watching = queuedAccounts.some((id) => cachedOptIn(id, now) === true);

  const unanswered: PopCandidate[] = [];
  for (const c of candidates) {
    const known = cachedOptIn(c.accountId, now);
    if (known === true) enqueueCandidate(c, deps.realm);
    else if (known === undefined) unanswered.push(c);
  }
  const toRead = accountsToRead(unanswered, queuedAccounts, now);
  if (toRead.length === 0) return Promise.resolve();
  const readStarted = bustStamp;
  return deps
    .optedIn(toRead)
    .then((opted) => {
      const set = new Set(opted);
      for (const id of toRead) {
        // A toggle write that landed DURING the read invalidated this answer
        // before it arrived; leave the entry empty so the next tick re-reads
        // it, and consume the bust mark.
        const busted = bustedAt.get(id);
        if (busted !== undefined && busted > readStarted) continue;
        if (busted !== undefined) bustedAt.delete(id);
        rememberOptIn(id, set.has(id), now);
      }
      for (const c of unanswered) if (set.has(c.accountId)) enqueueCandidate(c, deps.realm);
    })
    .catch((err) => {
      console.error('queue-pop opt-in read failed:', err);
    });
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
