// The Steam achievement mirror: an OBSERVER, never an authority. The sim
// decides unlocks, server/deeds_records.ts persists them into character_deeds,
// and this module copies a linked account's unlocks outward to Steam via the
// publisher Web API. Nothing here can grant, deny, or reorder a deed, and the
// 50 ms world loop never awaits any of it: onDeedRecorded returns
// synchronously and all IO happens on a detached in-process FIFO.
//
// Delivery model: at-least-once with in-flight dedupe. Steam's
// SetUserStatsForGame is idempotent for an already-set achievement, so a
// redelivery (crash replay, retro re-emit, reconcile overlap) is harmless. A
// push that still fails after the capped retries is DROPPED with one warn
// line: the in-memory queue holds nothing afterward, so a durable REPLAY heals
// the gap. character_deeds is that durable outbox (the server store is
// canonical and Steam is a mirrored subset), and TWO reconcile paths replay
// from it: reconcile-on-link (the moment an account first links) and
// reconcile-on-login (every join, per-account throttled), so a linked account
// that never re-links still catches up. No periodic sweep in v1 (the Cogmind
// pattern); the login reconcile is the steady-state heal.
//
// Secrets: the publisher key is read inside web_api.ts request builders only;
// no log line here carries a URL, a body, or anything upstream echoed.

import { earnedDeedIdsForAccount } from '../deeds_db';
import { ACHIEVEMENT_MAP } from './achievement_map';
import { steamAppId, steamEnabled, steamWebApiKey } from './config';
import { steamLinkForAccount } from './steam_db';
import { pushAchievementUnlocks } from './web_api';

/** Push attempts per batch before dropping (capped exponential backoff). */
export const MAX_PUSH_ATTEMPTS = 4;
/** Base backoff between attempts; doubles each retry (1s, 2s, 4s). */
export const PUSH_BACKOFF_BASE_MS = 1000;
/** Most unlock names coalesced into one SetUserStatsForGame call. A whole
 *  account's reconcile set ships as one request up to this cap (the rest spill
 *  into the next batch), so one linked account can never monopolize the FIFO. */
export const MAX_BATCH_NAMES = 100;
/** Consecutive exhausted batches before the outage trip-wire fast-drops the
 *  rest of the queue. Steam looking down must not grind every queued account
 *  through the full retry ladder; reconcile-on-login is the documented heal. */
export const OUTAGE_TRIP_BATCHES = 2;
/** Default shutdown drain deadline when stopSteamMirror is called without one. */
export const SHUTDOWN_DEADLINE_MS = 5000;
/** How long a link lookup is trusted before re-reading steam_links. */
export const LINK_CACHE_TTL_MS = 60_000;
/** Hard cap on the per-process link cache; the oldest entry is evicted (Map
 *  insertion order) before a new account is cached past this size. */
export const LINK_CACHE_MAX = 8192;
/** How long after a login reconcile before the same account reconciles again.
 *  Login churn (reconnects, alt hops) must not re-push an account's whole
 *  earned-and-mapped history every join, so the login heal is throttled to at
 *  most once per this window per account. Long relative to the link cache TTL:
 *  a dropped push is a rare tail event, and the next reconnect after the window
 *  still heals it. */
export const LOGIN_RECONCILE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface MirrorDeps {
  linkForAccount(accountId: number): Promise<{ steamId: string } | null>;
  earnedDeedIds(accountId: number): Promise<string[]>;
  pushUnlocks(opts: {
    key: string;
    appId: number;
    steamId: string;
    achNames: readonly string[];
  }): Promise<boolean>;
  delay(ms: number): Promise<void>;
  now(): number;
}

// Every real dep is a call-time arrow, never a load-time export binding: this
// module rides in game.ts's graph via deeds_records, so a load-time access of
// a db-boundary export would throw inside every test that partial-mocks that
// module with a fixed export list (the known overlay-mock breakage class).
const REAL_DEPS: MirrorDeps = {
  linkForAccount: (accountId) => steamLinkForAccount(accountId),
  earnedDeedIds: (accountId) => earnedDeedIdsForAccount(accountId),
  pushUnlocks: (opts) => pushAchievementUnlocks(opts),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

let deps: MirrorDeps = REAL_DEPS;

/** Override mirror IO with fakes (test-only; merges over the real deps). */
export function setSteamMirrorDepsForTests(overrides: Partial<MirrorDeps>): void {
  deps = { ...REAL_DEPS, ...overrides };
}

// ---------------------------------------------------------------------------
// Link cache. Per-process, short TTL, promise-valued so a retro burst of
// unlocks for one account does exactly one steam_links read on the lookup
// path. The link and unlink routes overwrite entries via onLinkChanged, but
// that is only a latency courtesy: an in-flight lookup or reconcile closure
// has already captured the old id, and PEER realm processes never see the
// flip at all. The actual revocation barrier is the fresh steam_links read
// attemptPushBatch does before every push.
// ---------------------------------------------------------------------------

interface LinkCacheEntry {
  steamId: Promise<string | null>;
  expiresAt: number;
}

const linkCache = new Map<number, LinkCacheEntry>();

// Bounded insert: a long-lived process must not accrete one cache entry per
// distinct account ever seen. Updating an existing key never grows the map, so
// only a NEW key at the cap evicts, and it evicts the oldest by Map insertion
// order (an approximate LRU, cheap and good enough for a 60s-TTL cache).
function linkCacheSet(accountId: number, entry: LinkCacheEntry): void {
  if (!linkCache.has(accountId) && linkCache.size >= LINK_CACHE_MAX) {
    const oldest = linkCache.keys().next().value;
    if (oldest !== undefined) linkCache.delete(oldest);
  }
  linkCache.set(accountId, entry);
}

function cachedSteamId(accountId: number): Promise<string | null> {
  const now = deps.now();
  const hit = linkCache.get(accountId);
  if (hit && hit.expiresAt > now) return hit.steamId;
  const steamId = deps
    .linkForAccount(accountId)
    .then((row) => row?.steamId ?? null)
    .catch(() => {
      // A failed read is not proof of no link; forget it so the next unlock
      // retries instead of caching "unlinked" for the TTL.
      linkCache.delete(accountId);
      return null;
    });
  linkCacheSet(accountId, { steamId, expiresAt: now + LINK_CACHE_TTL_MS });
  return steamId;
}

/** The link and unlink routes call this the moment steam_links changes, so
 *  the mirror's view flips in the same request, not a TTL later. */
export function onLinkChanged(accountId: number, steamId: string | null): void {
  linkCacheSet(accountId, {
    steamId: Promise.resolve(steamId),
    expiresAt: deps.now() + LINK_CACHE_TTL_MS,
  });
}

// ---------------------------------------------------------------------------
// The push queue: a plain FIFO drained by one detached worker, with a pending
// set (queued or in flight) so a duplicate delivery of the same
// (account, steamId, achievement) triple collapses while one is already on
// its way. The account id is part of the key: when a Steam account moves
// between WoCC accounts, the old account's in-flight item must not swallow
// the new account's reconcile item (revalidation drops the old one, and
// nothing but reconcile-on-link would ever redeliver the new one).
//
// Drained a BATCH at a time, not an item at a time: the worker groups the head
// with every other queued item for the same (accountId, steamId) into one
// SetUserStatsForGame call (up to MAX_BATCH_NAMES). A 72-deed reconcile for one
// account is then ONE ladder, not 72 serial ones, so no single account can hog
// the FIFO for tens of minutes during an outage. The revalidation barrier still
// runs once per attempt for the whole batch (all its names share one link).
// ---------------------------------------------------------------------------

interface PushItem {
  accountId: number;
  steamId: string;
  achName: string;
}

const queue: PushItem[] = [];
const pending = new Set<string>();
let draining = false;
let drain: Promise<void> = Promise.resolve();
// True once shutdown starts: the drain finishes the current work without the
// slow retry ladder or backoff sleeps so it can beat the shutdown deadline.
let shuttingDown = false;
// Consecutive exhausted batches (Steam unreachable), reset by any delivered
// push. Once it reaches OUTAGE_TRIP_BATCHES the drain fast-drops the rest of
// the queue instead of grinding every account through the full ladder.
let consecutiveExhausted = 0;

function pushKey(item: PushItem): string {
  return `${item.accountId}:${item.steamId}:${item.achName}`;
}

// How a batch resolved: 'delivered' (Steam took it, heal the trip-wire),
// 'exhausted' (the ladder failed, an outage signal), or 'dropped' (a revoked
// link, a twice-failed revalidation read, or an unprovisioned host: real, but
// NOT an outage, so it neither trips nor resets the trip-wire).
type BatchResult = 'delivered' | 'exhausted' | 'dropped';

function enqueue(item: PushItem): void {
  const key = pushKey(item);
  if (pending.has(key)) return;
  pending.add(key);
  queue.push(item);
  if (draining) return;
  draining = true;
  drain = runDrain();
}

async function runDrain(): Promise<void> {
  try {
    // Yield once before the first batch so a burst of same-tick enqueues (a
    // reconcile loop pushes a whole account's mapped set synchronously) has all
    // landed in the queue before the head is grouped; otherwise the head would
    // be shifted and batched alone.
    await Promise.resolve();
    while (queue.length > 0) {
      const head = queue.shift();
      if (!head) break;
      const batch = takeBatch(head);
      let result: BatchResult;
      try {
        result = await attemptPushBatch(head.accountId, head.steamId, batch);
      } catch {
        // attemptPushBatch handles its known failure modes itself; this backstop
        // exists so one unexpectedly-throwing push can never turn the drain
        // promise into an unhandled rejection (process-fatal under Node
        // defaults) and wedge every queued batch behind it. Same contract as any
        // other drop: one fixed line, a reconcile heals the gap.
        console.warn(
          `steam mirror: dropping ${batch.length} unlock(s), push attempt threw unexpectedly`,
        );
        result = 'exhausted';
      } finally {
        for (const it of batch) pending.delete(pushKey(it));
      }
      if (result === 'delivered') {
        consecutiveExhausted = 0;
      } else if (result === 'exhausted') {
        consecutiveExhausted++;
        if (consecutiveExhausted >= OUTAGE_TRIP_BATCHES && queue.length > 0) {
          // Trip-wire: Steam looks down. Fast-drop everything still queued with
          // one summary line rather than grinding each batch through the full
          // ladder; reconcile-on-login replays the durable outbox once Steam is
          // back. The counter stays tripped until a push succeeds.
          console.warn(
            `steam mirror: Steam unreachable after ${consecutiveExhausted} exhausted batches, fast-dropping ${queue.length} queued unlock(s)`,
          );
          for (const it of queue) pending.delete(pushKey(it));
          queue.length = 0;
        }
      }
    }
  } finally {
    draining = false;
  }
}

// Group the head with every other queued item sharing its (accountId, steamId),
// preserving FIFO order among the rest, up to the name cap. The head plus its
// same-account siblings ship as one batch; a different account stays queued.
function takeBatch(head: PushItem): PushItem[] {
  const batch: PushItem[] = [head];
  for (let i = 0; i < queue.length && batch.length < MAX_BATCH_NAMES; ) {
    const candidate = queue[i];
    if (candidate.accountId === head.accountId && candidate.steamId === head.steamId) {
      batch.push(candidate);
      queue.splice(i, 1);
    } else {
      i++;
    }
  }
  return batch;
}

async function attemptPushBatch(
  accountId: number,
  steamId: string,
  batch: PushItem[],
): Promise<BatchResult> {
  const appId = steamAppId();
  const key = steamWebApiKey();
  if (appId === null || key === null) {
    console.warn('steam mirror: enabled without STEAM_APP_ID/STEAM_WEB_API_KEY, dropping unlock');
    return 'dropped';
  }
  const achNames = batch.map((it) => it.achName);
  // Push-time revalidation, the revocation barrier: a fresh steam_links read
  // (deliberately not the TTL cache, which a peer realm process cannot see
  // invalidated) must still name this exact Steam id, or the batch was queued
  // by a read that lost a race with an unlink and is dropped whole. Comparing
  // ids rather than row existence keeps queued pushes flowing after a relink. A
  // REJECTED read proves nothing about the link, so it is retried once (one
  // transient DB blip must not eat a push), and a second rejection drops WITH a
  // warn line so operators can see the loss instead of a silent gap; a
  // reconcile (on link or on login) heals it either way.
  //
  // Revalidated INSIDE the retry loop, before EVERY attempt, not once before
  // it: the backoff ladder can span seconds, and an unlink or relink landing
  // between attempts must stop the very next push, never let attempts 2..N keep
  // pushing to an id the account no longer controls.
  for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
    let row: { steamId: string } | null;
    try {
      row = await deps.linkForAccount(accountId);
    } catch {
      try {
        row = await deps.linkForAccount(accountId);
      } catch {
        console.warn(
          `steam mirror: dropping ${batch.length} unlock(s), link revalidation read failed twice`,
        );
        return 'dropped';
      }
    }
    if (row?.steamId !== steamId) return 'dropped';
    const ok = await deps.pushUnlocks({ key, appId, steamId, achNames });
    if (ok) return 'delivered';
    // Shutdown: skip the remaining retries and their backoff sleeps so the drain
    // beats the deadline. The residual is reported by stopSteamMirror and healed
    // by the next reconcile-on-login.
    if (shuttingDown) return 'dropped';
    if (attempt < MAX_PUSH_ATTEMPTS) {
      await deps.delay(PUSH_BACKOFF_BASE_MS * 2 ** (attempt - 1));
    }
  }
  // One fixed line, no URL, no body, no key: a reconcile heals the gap.
  console.warn(
    `steam mirror: dropping ${batch.length} unlock(s) after ${MAX_PUSH_ATTEMPTS} attempts`,
  );
  return 'exhausted';
}

// ---------------------------------------------------------------------------
// Entry points.
// ---------------------------------------------------------------------------

// Per-account throttle for the login reconcile: the last time (deps.now) an
// account ran reconcileOnLogin, so login churn cannot re-push whole histories
// every join. Bounded by LOGIN_RECONCILE_TTL_MS.
const lastReconciledAt = new Map<number, number>();
// A stamp older than the TTL no longer throttles anything, so once the map
// outgrows this bound the expired entries are swept before the next stamp:
// a long-lived process holds O(accounts active per TTL window) entries
// instead of one per distinct account since boot.
export const RECONCILE_STAMP_SWEEP_SIZE = 8192;
// Amortized sweep cadence. Sweeping the whole map on every insert once it is
// full is O(n) per insert even when nothing has expired (a churn-free burst of
// distinct accounts). So after a sweep that frees little (the map is still at
// or above the base bound) the threshold backs off to twice the live size, and
// only a sweep that drops the map below the base bound restores the base
// cadence. A live map is then swept at most O(log n) times, not once per insert.
let sweepThreshold = RECONCILE_STAMP_SWEEP_SIZE;
// Test-only diagnostic: how many times the O(n) stamp sweep has actually run.
let sweepRunCount = 0;

/**
 * Mirror one recorded unlock. Called by server/deeds_records.ts AFTER the
 * character_deeds upsert for the event resolves (the observer's observer);
 * synchronous and swallow-all so the recorder's FIFO can never be faulted or
 * slowed from here. No-ops unless the flag is on, the deed is in the map, and
 * the account has a link.
 */
export function onDeedRecorded(accountId: number, deedId: string): void {
  try {
    if (!steamEnabled()) return;
    const achName = ACHIEVEMENT_MAP[deedId];
    if (achName === undefined) return;
    void cachedSteamId(accountId)
      .then((steamId) => {
        if (steamId !== null) enqueue({ accountId, steamId, achName });
      })
      .catch(() => {});
  } catch (err) {
    console.error('steam mirror: onDeedRecorded failed:', err);
  }
}

/**
 * Reconcile-on-link: push everything the account already earned, intersected
 * with the map, to the freshly linked Steam id. Fire-and-forget; the link
 * response never waits on it. The server store is canonical and Steam is a
 * mirrored subset, so this one push is the entire sync.
 */
export function reconcileLink(accountId: number, steamId: string): void {
  try {
    if (!steamEnabled()) return;
    onLinkChanged(accountId, steamId);
    void deps
      .earnedDeedIds(accountId)
      .then((deedIds) => {
        for (const deedId of deedIds) {
          const achName = ACHIEVEMENT_MAP[deedId];
          if (achName !== undefined) enqueue({ accountId, steamId, achName });
        }
      })
      .catch((err) => {
        console.error('steam mirror: reconcile read failed:', err);
      });
  } catch (err) {
    console.error('steam mirror: reconcileLink failed:', err);
  }
}

/**
 * Reconcile-on-login: the steady-state durable heal. A live unlock's push can
 * exhaust its retry ladder and DROP (delivery is at-least-once and the queue is
 * in-memory only), and grantDeed never re-emits a deed already in the earned
 * set, so nothing replays it on its own. reconcile-on-link only fires when an
 * account FIRST links (an already-linked account never re-links: the route 409s
 * it), so without this a linked account's dropped push would never heal.
 * character_deeds IS the durable outbox: on join, re-push the account's
 * earned-and-mapped set to its currently linked Steam id, idempotent Steam-side.
 *
 * Called fire-and-forget from the join path (server/game.ts) beside the
 * character_deeds reconcile: returns void immediately, is fully guarded so it
 * can never throw into join, and no-ops unless the flag is on and the account
 * has a link. Throttled per account (LOGIN_RECONCILE_TTL_MS) so reconnect churn
 * stays bounded; the throttle stamp is taken even for an unlinked account so a
 * relink-then-reconnect burst cannot hammer the reads either.
 */
export function reconcileOnLogin(accountId: number): void {
  try {
    if (!steamEnabled()) return;
    const now = deps.now();
    const last = lastReconciledAt.get(accountId);
    if (last !== undefined && now - last < LOGIN_RECONCILE_TTL_MS) return;
    if (lastReconciledAt.size >= sweepThreshold) {
      sweepRunCount++;
      for (const [acct, at] of lastReconciledAt) {
        if (now - at >= LOGIN_RECONCILE_TTL_MS) lastReconciledAt.delete(acct);
      }
      // A sweep that dropped the map below the base bound restores the base
      // cadence; one that freed little (still at or above the base bound) backs
      // off to twice the live size so a churn-free burst is not rescanned per
      // insert.
      sweepThreshold =
        lastReconciledAt.size < RECONCILE_STAMP_SWEEP_SIZE
          ? RECONCILE_STAMP_SWEEP_SIZE
          : lastReconciledAt.size * 2;
    }
    // Stamp BEFORE the reads (the churn bound): a resolved unlinked-account run
    // KEEPS this stamp so a relink-then-reconnect burst cannot hammer the reads.
    lastReconciledAt.set(accountId, now);
    // Read the link DIRECTLY (not through cachedSteamId, which collapses a read
    // failure to null): a rejected link OR earned read must reach the catch so
    // the stamp is cleared and the next login retries, rather than a transient
    // blip throttling the account for the full 6h TTL with zero work done. A
    // resolved null row is a genuine unlink and correctly keeps its stamp.
    void deps
      .linkForAccount(accountId)
      .then((row) => {
        const steamId = row?.steamId ?? null;
        if (steamId === null) return;
        return deps.earnedDeedIds(accountId).then((deedIds) => {
          for (const deedId of deedIds) {
            const achName = ACHIEVEMENT_MAP[deedId];
            if (achName !== undefined) enqueue({ accountId, steamId, achName });
          }
        });
      })
      .catch((err) => {
        // A transient read failure must not burn the 6h throttle: clear our own
        // stamp so the next login retries. Guard against clobbering a LATER
        // run's stamp (a slow read resolving after the TTL already advanced and
        // a fresh reconcile re-stamped).
        if (lastReconciledAt.get(accountId) === now) lastReconciledAt.delete(accountId);
        console.error('steam mirror: login reconcile failed:', err);
      });
  } catch (err) {
    console.error('steam mirror: reconcileOnLogin failed:', err);
  }
}

/** The current drain tail, for tests to await deterministic queue settling. */
export function steamMirrorIdle(): Promise<void> {
  return drain;
}

/**
 * Begin shutdown: flip the flag so the drain skips its retry ladder and backoff
 * sleeps (finishing the current work fast), then race the drain tail against a
 * deadline. If the deadline wins (a wedged upstream), log the residual count and
 * return anyway so the process shutdown can never hang. Every residual unlock is
 * replayed by the next reconcile-on-login from the durable character_deeds
 * outbox, so dropping them here is safe. A no-op fast path when nothing is queued.
 */
export async function stopSteamMirror(deadlineMs?: number): Promise<void> {
  shuttingDown = true;
  const tail = drain;
  let timedOut = false;
  const deadline = deps.delay(deadlineMs ?? SHUTDOWN_DEADLINE_MS).then(() => {
    timedOut = true;
  });
  await Promise.race([tail, deadline]);
  if (timedOut) {
    // pending counts every still-undelivered unlock (queued plus the batch stuck
    // in flight), the true residual; the queue array alone would miss the batch
    // the drain already shifted out.
    const residual = pending.size;
    if (residual > 0) {
      console.warn(
        `steam mirror: shutdown deadline reached, ${residual} unlock(s) undelivered (reconcile heals them)`,
      );
    }
  }
}

/** The live reconcile-stamp count, for the sweep-bound test only. */
export function reconcileStampCountForTests(): number {
  return lastReconciledAt.size;
}

/** How many times the O(n) stamp sweep has run, for the amortized-sweep test. */
export function reconcileSweepCountForTests(): number {
  return sweepRunCount;
}

/** The current stamp-sweep threshold, for the amortized-sweep test. */
export function reconcileSweepThresholdForTests(): number {
  return sweepThreshold;
}

/** The live link-cache size, for the cache-bound test only. */
export function linkCacheSizeForTests(): number {
  return linkCache.size;
}

/** Whether an account is currently cached, for the cache-eviction test only. */
export function linkCacheHasForTests(accountId: number): boolean {
  return linkCache.has(accountId);
}

/** Clear queue, dedupe, cache, and all drain/sweep state (test-only). */
export function resetSteamMirrorForTests(): void {
  queue.length = 0;
  pending.clear();
  linkCache.clear();
  lastReconciledAt.clear();
  draining = false;
  drain = Promise.resolve();
  shuttingDown = false;
  consecutiveExhausted = 0;
  sweepThreshold = RECONCILE_STAMP_SWEEP_SIZE;
  sweepRunCount = 0;
  deps = REAL_DEPS;
}
