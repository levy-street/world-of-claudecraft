// The queue-pop DM feed (server/discord_queue_pops.ts): which events name a
// pop, the opt-in gate and its cache, the queue's dedupe/cap/expiry/requeue
// rules, and the bot-cadence watch signal. Everything runs over the injected
// deps (no DB, no clock): the observer's production deps are bound in
// queuePopDepsFor, and only the SQL boundary (discord_queue_pings_db.ts) is
// pinned by text elsewhere.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_queue_pops_units';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({ pool: { __fake: 'queue-pops-pool' } }));
vi.mock('../../server/discord_queue_pings_db', () => ({
  accountsWithDiscordQueuePings: vi.fn(async (): Promise<number[]> => []),
  getDiscordQueuePings: vi.fn(),
  setDiscordQueuePings: vi.fn(),
}));

import { QUEUE_PING_CACHE_FLOOR } from '../../server/discord_queue_ping_cache';
import { accountsWithDiscordQueuePings } from '../../server/discord_queue_pings_db';
import {
  ARENA_POP_TTL_MS,
  bustQueuePingCache,
  collectQueuePops,
  delayedQueuePopCandidateCount,
  drainQueuePops,
  enqueueQueuePop,
  observeQueuePops,
  QUEUE_PING_CACHE_TTL_MS,
  QUEUE_PING_FAILURE_BACKOFF_MS,
  QUEUE_POP_MAX_BATCH_IDS,
  QUEUE_POP_MAX_QUEUE,
  QUEUE_POP_MIN_BATCH_INTERVAL_MS,
  type QueuedQueuePop,
  type QueuePopDeps,
  queuedPidsOf,
  queuePopDepsFor,
  queuePopQueueDepth,
  queuePopsWatching,
  queueWatchTrackedAccountCount,
  requeueQueuePops,
  resetQueuePopsForTests,
} from '../../server/discord_queue_pops';
import type { SimEvent } from '../../src/sim/types';

const NOW = 1_700_000_000_000;

/** pid -> session for the cases: pid 1 is account 10 (Ann), pid 2 account 20 (Bo). */
const SESSIONS = new Map([
  [1, { accountId: 10, name: 'Ann' }],
  [2, { accountId: 20, name: 'Bo' }],
]);

function deps(optedIn: (ids: readonly number[]) => Promise<number[]>, now = NOW): QueuePopDeps {
  return {
    sessionFor: (pid) => SESSIONS.get(pid),
    optedIn,
    now: () => now,
    realm: 'Claudemoon',
  };
}

function pop(accountId: number, over: Partial<QueuedQueuePop> = {}): QueuedQueuePop {
  return {
    accountId,
    characterName: `c${accountId}`,
    kind: 'bg',
    format: null,
    seconds: 30,
    expiresAtMs: NOW + 30_000,
    realm: 'R',
    ...over,
  };
}

const bgProposed = (pid: number): SimEvent => ({ type: 'bgProposed', seconds: 30, pid });
const arenaFound = (pid: number): SimEvent => ({
  type: 'arenaFound',
  format: '2v2',
  oppName: 'x',
  oppClass: 'warrior',
  oppLevel: 1,
  allies: [],
  enemies: [],
  pid,
});

afterEach(() => {
  resetQueuePopsForTests();
  vi.mocked(accountsWithDiscordQueuePings).mockReset();
});

describe('collectQueuePops', () => {
  it('names a bg pop with the Accept window and an arena pop with the fixed TTL', () => {
    const out = collectQueuePops([bgProposed(1), arenaFound(2)], (p) => SESSIONS.get(p), NOW);
    expect(out).toEqual([
      {
        accountId: 10,
        characterName: 'Ann',
        kind: 'bg',
        format: null,
        seconds: 30,
        expiresAtMs: NOW + 30_000,
      },
      {
        accountId: 20,
        characterName: 'Bo',
        kind: 'arena',
        format: '2v2',
        seconds: 0,
        expiresAtMs: NOW + ARENA_POP_TTL_MS,
      },
    ]);
  });

  it('ignores every other event, an event without a pid, and a pid without a session', () => {
    const events: SimEvent[] = [
      { type: 'bgQueued', position: 1, pid: 1 },
      { type: 'bgFound', team: 0, pid: 1 },
      { type: 'bgProposed', seconds: 30 } as SimEvent,
      bgProposed(99), // a bot: no session
    ];
    expect(collectQueuePops(events, (p) => SESSIONS.get(p), NOW)).toEqual([]);
  });
});

describe('queuedPidsOf', () => {
  it('flattens the bg groups and every arena bracket, solo 1v1 included', () => {
    expect(
      queuedPidsOf({
        bgQueue: [{ pids: [1, 2] }, { pids: [3] }],
        arenaQueue1v1: [4],
        arenaQueue2v2: [{ pids: [5, 6] }],
        arenaQueueFiesta: [{ pids: [7] }],
        arenaQueueYumi3: [{ pids: [8] }],
        arenaQueueYumi5: [],
      }),
    ).toEqual([4, 1, 2, 3, 5, 6, 7, 8]);
  });
});

describe('the queue', () => {
  it('drains FIFO, dropping items already past their deadline', () => {
    enqueueQueuePop(pop(1, { expiresAtMs: NOW - 1 }));
    enqueueQueuePop(pop(2));
    enqueueQueuePop(pop(3));
    expect(queuePopQueueDepth()).toBe(3);
    expect(drainQueuePops(NOW).map((p) => p.accountId)).toEqual([2, 3]);
    expect(queuePopQueueDepth()).toBe(0);
  });

  it("refreshes an account's UNDRAINED item in place, keeping its position", () => {
    enqueueQueuePop(pop(1, { seconds: 30 }));
    enqueueQueuePop(pop(2));
    enqueueQueuePop(pop(1, { seconds: 25, expiresAtMs: NOW + 25_000 }));
    const drained = drainQueuePops(NOW);
    expect(drained.map((p) => [p.accountId, p.seconds])).toEqual([
      [1, 25],
      [2, 30],
    ]);
    // Delivered history is never consulted: the next pop is a fresh item.
    enqueueQueuePop(pop(1));
    expect(queuePopQueueDepth()).toBe(1);
  });

  it('drops the OLDEST past the cap, and a requeue is trimmed the same way', () => {
    for (let i = 1; i <= QUEUE_POP_MAX_QUEUE + 5; i++) enqueueQueuePop(pop(i));
    expect(queuePopQueueDepth()).toBe(QUEUE_POP_MAX_QUEUE);
    const drained = drainQueuePops(NOW);
    expect(drained[0].accountId).toBe(6);
    // A dropped account is open again (its pending entry went with it).
    enqueueQueuePop(pop(1));
    expect(queuePopQueueDepth()).toBe(1);
    resetQueuePopsForTests();
    enqueueQueuePop(pop(1));
    requeueQueuePops(drained);
    expect(queuePopQueueDepth()).toBe(QUEUE_POP_MAX_QUEUE);
    // Front-inserted, original order, and the trim spends the requeued items
    // first because they ARE the oldest (the relay queue's honest limit): the
    // 200 requeued plus the one new item overflow by one, so the requeued
    // head (account 6) is the one dropped and account 7 leads.
    const after = drainQueuePops(NOW);
    expect(after[0].accountId).toBe(7);
    expect(after[after.length - 1].accountId).toBe(1);
  });

  it('requeues at the front in original order and reopens those accounts to refresh', () => {
    enqueueQueuePop(pop(1));
    enqueueQueuePop(pop(2));
    const drained = drainQueuePops(NOW);
    enqueueQueuePop(pop(3));
    requeueQueuePops(drained);
    enqueueQueuePop(pop(2, { seconds: 5 }));
    expect(drainQueuePops(NOW).map((p) => [p.accountId, p.seconds])).toEqual([
      [1, 30],
      [2, 5],
      [3, 30],
    ]);
    requeueQueuePops([]);
    expect(queuePopQueueDepth()).toBe(0);
  });
});

describe('observeQueuePops', () => {
  it('enqueues the pops of opted-in players only, after ONE read over the union', async () => {
    const optedIn = vi.fn(async () => [10]);
    await observeQueuePops([bgProposed(1), arenaFound(2)], [1, 2], deps(optedIn));
    expect(optedIn).toHaveBeenCalledTimes(1);
    expect([...(optedIn.mock.calls[0] as unknown as [number[]])[0]].sort()).toEqual([10, 20]);
    expect(drainQueuePops(NOW)).toEqual([
      {
        accountId: 10,
        characterName: 'Ann',
        kind: 'bg',
        format: null,
        seconds: 30,
        expiresAtMs: NOW + 30_000,
        realm: 'Claudemoon',
      },
    ]);
  });

  it('answers a pop from the cache with NO read once the queue join warmed it', async () => {
    const optedIn = vi.fn(async () => [10]);
    // Tick 1: Ann joins the queue (queued pid, no pop) -> the read warms the cache.
    await observeQueuePops([], [1], deps(optedIn));
    expect(optedIn).toHaveBeenCalledTimes(1);
    expect(queuePopsWatching()).toBe(false); // in flight during the tick
    // Tick 2: still queued -> watching, still no second read.
    await observeQueuePops([], [1], deps(optedIn));
    expect(optedIn).toHaveBeenCalledTimes(1);
    expect(queuePopsWatching()).toBe(true);
    // Tick 3: the pop -> enqueued synchronously from the cache, no read.
    const pending = observeQueuePops([bgProposed(1)], [], deps(optedIn));
    expect(queuePopQueueDepth()).toBe(1);
    await pending;
    expect(optedIn).toHaveBeenCalledTimes(1);
    expect(queuePopsWatching()).toBe(false);
  });

  it('caches a NO as well, so an opted-out player costs one read per TTL, not per tick', async () => {
    const optedIn = vi.fn(async () => []);
    await observeQueuePops([bgProposed(1)], [1], deps(optedIn));
    await observeQueuePops([bgProposed(1)], [1], deps(optedIn));
    expect(optedIn).toHaveBeenCalledTimes(1);
    expect(queuePopQueueDepth()).toBe(0);
    expect(queuePopsWatching()).toBe(false);
    // Past the TTL the answer is re-read.
    await observeQueuePops([], [1], deps(optedIn, NOW + QUEUE_PING_CACHE_TTL_MS));
    expect(optedIn).toHaveBeenCalledTimes(2);
  });

  it('a toggle write busts the cached answer, and one that lands mid-read wins over the read', async () => {
    const optedIn = vi.fn(async (): Promise<number[]> => []);
    let clock = NOW;
    await observeQueuePops([], [1], deps(optedIn, clock));
    bustQueuePingCache(10);
    optedIn.mockResolvedValueOnce([10]);
    // A bust forces a fresh read regardless of the cached answer, but a
    // batch completion still starts the QUEUE_POP_MIN_BATCH_INTERVAL_MS
    // clock: advance past it so this tick's batch is allowed to run.
    clock += QUEUE_POP_MIN_BATCH_INTERVAL_MS;
    await observeQueuePops([], [1], deps(optedIn, clock));
    expect(optedIn).toHaveBeenCalledTimes(2);
    await observeQueuePops([], [1], deps(optedIn, clock));
    expect(queuePopsWatching()).toBe(true);

    // Mid-read bust: the answer that arrives afterwards is NOT remembered.
    resetQueuePopsForTests();
    let release: (ids: number[]) => void = () => {};
    const slow = vi.fn(() => new Promise<number[]>((resolve) => (release = resolve)));
    const inFlight = observeQueuePops([], [1], deps(slow));
    bustQueuePingCache(10);
    release([10]);
    await inFlight;
    // The next tick has to read again: nothing was cached for account 10.
    const again = vi.fn(async () => [10]);
    await observeQueuePops([], [1], deps(again, NOW + QUEUE_POP_MIN_BATCH_INTERVAL_MS));
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('a Discord link busts a cached unlinked false so the next pop can enqueue', async () => {
    const optedOutBecauseUnlinked = vi.fn(async (): Promise<number[]> => []);
    await observeQueuePops([], [1], deps(optedOutBecauseUnlinked));
    await observeQueuePops([bgProposed(1)], [1], deps(vi.fn(async () => [10])));
    expect(queuePopQueueDepth()).toBe(0);

    bustQueuePingCache(10);
    const linked = vi.fn(async () => [10]);
    // A bust forces a fresh read regardless of the cached answer, but this
    // tick still owes QUEUE_POP_MIN_BATCH_INTERVAL_MS since the prior batch.
    const afterBust = NOW + QUEUE_POP_MIN_BATCH_INTERVAL_MS;
    await observeQueuePops([bgProposed(1)], [1], deps(linked, afterBust));
    expect(linked).toHaveBeenCalledTimes(1);
    expect(drainQueuePops(afterBust).map((p) => [p.accountId, p.seconds])).toEqual([[10, 30]]);

    await observeQueuePops([], [1], deps(linked, afterBust));
    expect(queuePopsWatching()).toBe(true);
  });

  it('single-flights opt-in reads and enqueues only the latest delayed pop', async () => {
    let release: (ids: number[]) => void = () => {};
    const slow = vi.fn(() => new Promise<number[]>((resolve) => (release = resolve)));
    const first = observeQueuePops([{ type: 'bgProposed', seconds: 30, pid: 1 }], [1], deps(slow));
    const second = observeQueuePops([{ type: 'bgProposed', seconds: 12, pid: 1 }], [1], deps(slow));

    expect(slow).toHaveBeenCalledTimes(1);
    expect(queuePopQueueDepth()).toBe(0);
    release([10]);
    await Promise.all([first, second]);

    const drained = drainQueuePops(NOW);
    expect(drained).toHaveLength(1);
    expect(drained[0].accountId).toBe(10);
    expect(drained[0].seconds).toBe(12);
    expect(drained[0].expiresAtMs).toBe(NOW + 12_000);
  });

  it('hands back the exact same batch promise to every tick while one is in flight (no growing per-tick waiters)', async () => {
    let release: (ids: number[]) => void = () => {};
    const slow = vi.fn(() => new Promise<number[]>((resolve) => (release = resolve)));
    const p1 = observeQueuePops([bgProposed(1)], [], deps(slow));
    const p2 = observeQueuePops([], [1], deps(slow));
    const p3 = observeQueuePops([], [], deps(slow));
    // Referential equality, not just "all resolve together": a tick that
    // opened its own promise wrapping the shared batch (an extra `.then()`
    // per tick) would still resolve at the same moment but would NOT be the
    // SAME object, which is exactly the "growing waiters" shape this proves
    // absent.
    expect(p2).toBe(p1);
    expect(p3).toBe(p1);
    expect(slow).toHaveBeenCalledTimes(1);
    release([10]);
    await p1;
  });

  it('keeps peak batch concurrency at 1 even with a fresh account arriving every tick while a request is deferred', async () => {
    let release: (ids: number[]) => void = () => {};
    const slow = vi.fn(() => new Promise<number[]>((resolve) => (release = resolve)));
    const first = observeQueuePops([], [1], deps(slow));
    expect(slow).toHaveBeenCalledTimes(1);

    // Ticks 2-4 each bring a BRAND NEW account, never seen or failed before,
    // while the first batch is still pending: the per-id in-flight tracking
    // this replaces would have let each one open its OWN concurrent read.
    const freshSessionFor = (pid: number) => ({ accountId: 100 + pid, name: `n${pid}` });
    const later = [2, 3, 4].map((pid) =>
      observeQueuePops([], [pid], {
        sessionFor: freshSessionFor,
        optedIn: slow,
        now: () => NOW,
        realm: 'Claudemoon',
      }),
    );
    expect(slow).toHaveBeenCalledTimes(1);

    release([10]);
    await Promise.all([first, ...later]);
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it('a slow failing batch arms the shared backoff even with a brand-new id arriving mid-flight, then the recovery batch reads everyone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const clock = NOW;
    let fail: (err: Error) => void = () => {};
    const slow = vi.fn(() => new Promise<number[]>((_resolve, reject) => (fail = reject)));
    const d: QueuePopDeps = {
      sessionFor: (p) => SESSIONS.get(p),
      optedIn: slow,
      now: () => clock,
      realm: 'Claudemoon',
    };

    const first = observeQueuePops([], [1], d); // account 10, read starts
    expect(slow).toHaveBeenCalledTimes(1);

    // Account 20, never seen or failed before, joins while the slow read is
    // still pending: it must not open its own concurrent batch.
    const second = observeQueuePops([], [2], d);
    expect(slow).toHaveBeenCalledTimes(1);

    fail(new Error('db down'));
    await Promise.all([first, second]);

    // Still inside the shared backoff window: neither account is retried.
    const stillBackedOff = vi.fn(async () => [10, 20]);
    await observeQueuePops([], [1, 2], { ...d, optedIn: stillBackedOff, now: () => clock + 1 });
    expect(stillBackedOff).not.toHaveBeenCalled();

    // Past the backoff window, ONE recovery batch reads both accounts together.
    const recovered = vi.fn(async () => [10, 20]);
    await observeQueuePops([], [1, 2], {
      ...d,
      optedIn: recovered,
      now: () => clock + QUEUE_PING_FAILURE_BACKOFF_MS,
    });
    expect(recovered).toHaveBeenCalledTimes(1);
    expect([...(recovered.mock.calls[0] as unknown as [number[]])[0]].sort()).toEqual([10, 20]);
  });

  it('swallows a failed read: the pop loses its DM and the tick loses nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const optedIn = vi.fn(async () => {
      throw new Error('db down');
    });
    await expect(observeQueuePops([bgProposed(1)], [1], deps(optedIn))).resolves.toBeUndefined();
    expect(queuePopQueueDepth()).toBe(0);
    expect(error).toHaveBeenCalled();
  });

  it('backs off a failing account instead of re-reading every tick, then recovers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error('db down');
    });
    await observeQueuePops([bgProposed(1)], [1], deps(failing));
    expect(failing).toHaveBeenCalledTimes(1);
    // Still queued, still failing, still inside the backoff window: no
    // second read (a persistent outage would otherwise cost one read per
    // tick, far faster than the outage could ever resolve).
    await observeQueuePops([], [1], deps(failing));
    await observeQueuePops([], [1], deps(failing, NOW + 1));
    expect(failing).toHaveBeenCalledTimes(1);
    // Past the backoff window, the account is retried, and a healthy read
    // now succeeds and is cached normally.
    const recovered = vi.fn(async () => [10]);
    await observeQueuePops([], [1], deps(recovered, NOW + QUEUE_PING_FAILURE_BACKOFF_MS));
    expect(recovered).toHaveBeenCalledTimes(1);
    await observeQueuePops([], [1], deps(recovered, NOW + QUEUE_PING_FAILURE_BACKOFF_MS));
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  it('backs off using the FAILURE COMPLETION time, not the tick-start time (a slow failing read)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let clock = NOW;
    let fail: (err: Error) => void = () => {};
    const slow = vi.fn(() => new Promise<number[]>((_resolve, reject) => (fail = reject)));
    const d: QueuePopDeps = {
      sessionFor: (p) => SESSIONS.get(p),
      optedIn: slow,
      now: () => clock,
      realm: 'Claudemoon',
    };
    const pending = observeQueuePops([bgProposed(1)], [], d);
    // The read takes LONGER than the whole backoff window to fail: were the
    // backoff window recorded from the tick's start time (when `slow` was
    // invoked), it would already have lapsed by the time the failure lands.
    clock = NOW + QUEUE_PING_FAILURE_BACKOFF_MS + 500;
    fail(new Error('db down'));
    await pending;

    // Immediately after the failure lands, still backed off: the window is
    // measured from completion (clock), not tick start (NOW).
    const stillBackedOff = vi.fn(async () => [10]);
    await observeQueuePops([], [1], { ...d, optedIn: stillBackedOff, now: () => clock + 1 });
    expect(stillBackedOff).not.toHaveBeenCalled();

    // Only past completion-time + the backoff window is it retried.
    const recovered = vi.fn(async () => [10]);
    await observeQueuePops([], [1], {
      ...d,
      optedIn: recovered,
      now: () => clock + QUEUE_PING_FAILURE_BACKOFF_MS,
    });
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  it('holds a brand-new account out of every read during an outage (shared, not per-account, backoff)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error('db down');
    });
    // Account 10 (pid 1) fails first, arming the shared backoff window.
    await observeQueuePops([], [1], deps(failing, NOW));
    expect(failing).toHaveBeenCalledTimes(1);

    // A moment later, account 20 (pid 2), never seen or failed before, joins
    // the queue while the outage's backoff window is still open. A PER-ACCOUNT
    // backoff would read it anyway (it has no failure of its own recorded);
    // the shared window must hold it out too, or a churning queue during an
    // outage costs a fresh query every tick regardless of backoff.
    const stillOutage = vi.fn(async () => {
      throw new Error('db down');
    });
    await observeQueuePops([], [2], deps(stillOutage, NOW + 1));
    expect(stillOutage).not.toHaveBeenCalled();

    // Past the window, both the earlier and the newly-joined account are
    // read together in the recovery batch.
    const recovered = vi.fn(async () => [10, 20]);
    await observeQueuePops([], [1, 2], deps(recovered, NOW + QUEUE_PING_FAILURE_BACKOFF_MS));
    expect(recovered).toHaveBeenCalledTimes(1);
    expect([...(recovered.mock.calls[0] as unknown as [number[]])[0]].sort()).toEqual([10, 20]);
  });

  it('sweeps an expired delayed candidate instead of leaking it forever', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error('db down');
    });
    // Tick 1: a first pop candidate's read fails, which both drops that
    // candidate (the existing "the pop loses its DM" rule) and arms the
    // shared backoff (QUEUE_PING_FAILURE_BACKOFF_MS, 2s).
    await observeQueuePops([bgProposed(1)], [], deps(failing));
    expect(delayedQueuePopCandidateCount()).toBe(0);

    // Tick 2, one ms later, still inside the backoff window: a SECOND
    // candidate for the SAME account arrives (a fresh proposal), this one
    // with a deliberately short 1s Accept window, so its own deadline lapses
    // well before the shared 2s backoff would ever let a retry run. Its read
    // never starts (the account is still backed off), so it is revisited by
    // nothing before its own deadline: the sim has already dropped a
    // proposed player from the queue arrays by the time it is proposed, so
    // no future tick's queuedPids will ever name this account again, and the
    // bgProposed event itself fires once.
    await observeQueuePops(
      [{ type: 'bgProposed', seconds: 1, pid: 1 }],
      [],
      deps(failing, NOW + 1),
    );
    expect(delayedQueuePopCandidateCount()).toBe(1);

    // Still within its own 1s Accept window AND the shared backoff window (so
    // no retry could have run either way): the entry survives.
    await observeQueuePops([], [], deps(failing, NOW + 1 + 999));
    expect(delayedQueuePopCandidateCount()).toBe(1);

    // Past its own Accept window (but still inside the shared backoff window,
    // so this tick could not have answered it by reading it anyway): swept as
    // moot, the same "already past deadline" rule drainQueuePops applies.
    await observeQueuePops([], [], deps(failing, NOW + 1 + 1_000));
    expect(delayedQueuePopCandidateCount()).toBe(0);
  });

  it('revisits a still-pending delayed candidate on a later tick with no fresh event, once the batch cadence and backoff clear', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error('db down');
    });
    // Tick 1: an unrelated failure arms the shared backoff.
    await observeQueuePops([], [2], deps(failing));
    expect(failing).toHaveBeenCalledTimes(1);

    // Tick 2, still backed off: a pop candidate arrives and sits delayed,
    // unread (the per-tick candidate list alone would never see it again,
    // since bgProposed fires once; only the persistent delayedCandidates
    // entry keeps it live for a later tick to pick up).
    await observeQueuePops([bgProposed(1)], [], deps(failing, NOW + 1));
    expect(delayedQueuePopCandidateCount()).toBe(1);

    // Past both the shared backoff and QUEUE_POP_MIN_BATCH_INTERVAL_MS, with
    // NO fresh event and NO queued pid naming this account: the observer
    // still revisits it purely from delayedCandidates, and a now-healthy
    // backend answers it.
    const recovered = vi.fn(async () => [10]);
    await observeQueuePops([], [], deps(recovered, NOW + QUEUE_PING_FAILURE_BACKOFF_MS));
    expect(recovered).toHaveBeenCalledTimes(1);
    expect(recovered).toHaveBeenCalledWith([10]);
    expect(delayedQueuePopCandidateCount()).toBe(0);
    expect(drainQueuePops(NOW + QUEUE_PING_FAILURE_BACKOFF_MS).map((p) => p.accountId)).toEqual([
      10,
    ]);
  });

  it('issues no read at all when nothing is queued and nothing popped', async () => {
    const optedIn = vi.fn(async () => []);
    await observeQueuePops([{ type: 'bgQueued', position: 1, pid: 1 }], [], deps(optedIn));
    expect(optedIn).not.toHaveBeenCalled();
  });

  it('recomputes the watch signal from the queued set every tick (no join/leave bookkeeping)', async () => {
    const optedIn = vi.fn(async () => [10]);
    await observeQueuePops([], [1], deps(optedIn));
    await observeQueuePops([], [1], deps(optedIn));
    expect(queuePopsWatching()).toBe(true);
    // Ann vanished from the queue arrays (left, or disconnected): off next tick.
    await observeQueuePops([], [], deps(optedIn));
    expect(queuePopsWatching()).toBe(false);
    // Bo is queued but opted out: still off.
    await observeQueuePops([], [2], deps(vi.fn(async () => [])));
    await observeQueuePops([], [2], deps(optedIn));
    expect(queuePopsWatching()).toBe(false);
  });
});

describe('bounded batching under a disabled realm admission cap (churn above the cache floor)', () => {
  // MAX_PLAYERS_PER_REALM=0 disables realm admission capping (server/CLAUDE.md,
  // ws_auth.ts), so a realm can carry more live accounts than
  // QUEUE_PING_CACHE_FLOOR: one MORE than the floor is the minimal case that
  // forces the cache to evict something.
  const REALM_ACCOUNTS = QUEUE_PING_CACHE_FLOOR + 1;

  afterEach(() => {
    delete process.env.MAX_PLAYERS_PER_REALM;
  });

  it('caps every batch at QUEUE_POP_MAX_BATCH_IDS and eventually reads every account despite cache eviction churn', async () => {
    process.env.MAX_PLAYERS_PER_REALM = '0';
    const pids = Array.from({ length: REALM_ACCOUNTS }, (_, i) => i + 1);
    const sessionFor = (pid: number) => ({ accountId: pid, name: `p${pid}` });
    const seenBatches: number[][] = [];
    const optedIn = vi.fn(async (ids: readonly number[]) => {
      seenBatches.push([...ids]);
      return [...ids]; // everyone opts in, so an answered id drops out of the next read
    });
    let clock = NOW;
    const d = (): QueuePopDeps => ({ sessionFor, optedIn, now: () => clock, realm: 'Claudemoon' });

    // Enough ticks, each spaced exactly on the min-batch-interval floor, to
    // cover the whole realm at least once (ceil(8193 / 2048) = 5 batches)
    // plus headroom to observe the cache evicting and re-reading the
    // earliest-answered account (the realm has exactly one MORE account than
    // the cache floor).
    for (let i = 0; i < 8; i++) {
      await observeQueuePops([], pids, d());
      clock += QUEUE_POP_MIN_BATCH_INTERVAL_MS;
    }

    expect(seenBatches.length).toBeGreaterThan(0);
    for (const batch of seenBatches) {
      expect(batch.length).toBeLessThanOrEqual(QUEUE_POP_MAX_BATCH_IDS);
    }
    const distinctAccountsRead = new Set(seenBatches.flat());
    // Every one of the 8,193 accounts gets read at least once: the churn
    // this cap size forces (one eviction once the 8,193rd distinct answer
    // lands) never leaves an account permanently unread.
    expect(distinctAccountsRead.size).toBe(REALM_ACCOUNTS);
    // The eviction is real, not a coincidence of this fixture: the same
    // account is read more than once across the run.
    const readCounts = new Map<number, number>();
    for (const id of seenBatches.flat()) readCounts.set(id, (readCounts.get(id) ?? 0) + 1);
    expect([...readCounts.values()].some((count) => count > 1)).toBe(true);
  });

  it('never opens a second batch before QUEUE_POP_MIN_BATCH_INTERVAL_MS has passed since the last one completed, however many accounts are still unknown', async () => {
    process.env.MAX_PLAYERS_PER_REALM = '0';
    const pids = Array.from({ length: REALM_ACCOUNTS }, (_, i) => i + 1);
    const sessionFor = (pid: number) => ({ accountId: pid, name: `p${pid}` });
    const optedIn = vi.fn(async () => []);
    let clock = NOW;
    const d = (): QueuePopDeps => ({ sessionFor, optedIn, now: () => clock, realm: 'Claudemoon' });

    await observeQueuePops([], pids, d());
    expect(optedIn).toHaveBeenCalledTimes(1);

    // 8,192 of the 8,193 accounts are STILL cache-unknown (only the first
    // QUEUE_POP_MAX_BATCH_IDS were answered): advancing by one ms short of
    // the floor must still refuse a second batch.
    clock += QUEUE_POP_MIN_BATCH_INTERVAL_MS - 1;
    await observeQueuePops([], pids, d());
    expect(optedIn).toHaveBeenCalledTimes(1);

    clock += 1;
    await observeQueuePops([], pids, d());
    expect(optedIn).toHaveBeenCalledTimes(2);
  });

  it('with 12,000+ steady queued accounts (past cache floor + one batch), every account is read within a small bounded number of rounds, never starved behind its position in the queue array', async () => {
    process.env.MAX_PLAYERS_PER_REALM = '0';
    // The smallest steady account count where a plain array-order scan of
    // queuedAccounts (picking the first QUEUE_POP_MAX_BATCH_IDS cache-unknown
    // ids every tick) could starve a TAIL id forever is
    // QUEUE_PING_CACHE_FLOOR + QUEUE_POP_MAX_BATCH_IDS + 1 = 10,241: once the
    // cache holds its first QUEUE_PING_CACHE_FLOOR answers and one more batch
    // fills the rest of the cache's headroom, the single id past both never
    // again sorts to the front of the array, while the low-index ids ahead of
    // it keep cycling through eviction and re-read forever (hand-traced in the
    // watchLastBatchedAt declaration). 12,000 is comfortably past that floor.
    const REALM_ACCOUNTS = 12_000;
    const pids = Array.from({ length: REALM_ACCOUNTS }, (_, i) => i + 1);
    const sessionFor = (pid: number) => ({ accountId: pid, name: `p${pid}` });
    const seenBatches: number[][] = [];
    const optedIn = vi.fn(async (ids: readonly number[]) => {
      seenBatches.push([...ids]);
      return [...ids];
    });
    let clock = NOW;
    const d = (): QueuePopDeps => ({ sessionFor, optedIn, now: () => clock, realm: 'Claudemoon' });

    // A decisively small, bounded round budget: comfortably more than the
    // information-theoretic minimum (ceil(12,000 / QUEUE_POP_MAX_BATCH_IDS) = 6),
    // and nearly two orders of magnitude under how long a full TTL-driven
    // re-read alone would take (QUEUE_PING_CACHE_TTL_MS / QUEUE_POP_MIN_BATCH_INTERVAL_MS,
    // over a thousand rounds): if coverage needed anywhere near that many
    // rounds, the fairness fix would not be doing its job.
    const ROUNDS = 20;
    for (let i = 0; i < ROUNDS; i++) {
      await observeQueuePops([], pids, d());
      clock += QUEUE_POP_MIN_BATCH_INTERVAL_MS;
    }

    for (const batch of seenBatches) {
      expect(batch.length).toBeLessThanOrEqual(QUEUE_POP_MAX_BATCH_IDS);
    }
    const distinctAccountsRead = new Set(seenBatches.flat());
    const neverRead = pids.filter((id) => !distinctAccountsRead.has(id));
    expect(neverRead).toEqual([]);
  });

  it('under churn (accounts leaving and new accounts joining), a late joiner is read within bounded rounds and a departed account is pruned rather than tracked forever', async () => {
    process.env.MAX_PLAYERS_PER_REALM = '0';
    const sessionFor = (pid: number) => ({ accountId: pid, name: `p${pid}` });
    const seenBatches: number[][] = [];
    const optedIn = vi.fn(async (ids: readonly number[]) => {
      seenBatches.push([...ids]);
      return [...ids];
    });
    let clock = NOW;
    const d = (): QueuePopDeps => ({ sessionFor, optedIn, now: () => clock, realm: 'Claudemoon' });

    // A base steady population past the cache floor (so the fairness path is
    // actually exercised, not just a single-batch happy case) settles first.
    const BASE = Array.from({ length: 9_000 }, (_, i) => i + 1); // 1..9000
    for (let i = 0; i < 8; i++) {
      await observeQueuePops([], BASE, d());
      clock += QUEUE_POP_MIN_BATCH_INTERVAL_MS;
    }
    seenBatches.length = 0; // only the post-churn phase matters below

    // 1..4000 leave (seated/proposed elsewhere); 9001..13000 freshly join.
    const DEPARTED = new Set(Array.from({ length: 4_000 }, (_, i) => i + 1));
    const NEW_JOINERS = new Set(Array.from({ length: 4_000 }, (_, i) => i + 9_001));
    const CHURNED = [
      ...Array.from({ length: 5_000 }, (_, i) => i + 4_001), // 4001..9000, stayed
      ...Array.from({ length: 4_000 }, (_, i) => i + 9_001), // 9001..13000, new
    ];

    for (let i = 0; i < 10; i++) {
      await observeQueuePops([], CHURNED, d());
      clock += QUEUE_POP_MIN_BATCH_INTERVAL_MS;
    }

    const readAfterChurn = new Set(seenBatches.flat());
    for (const id of DEPARTED) expect(readAfterChurn.has(id)).toBe(false);
    for (const id of NEW_JOINERS) expect(readAfterChurn.has(id)).toBe(true);

    // Bounded growth: the tracked map holds no more than the LIVE queue size,
    // so the 4,000 departed accounts left no permanent residue behind.
    expect(queueWatchTrackedAccountCount()).toBeLessThanOrEqual(CHURNED.length);
  });
});

describe('queuePopDepsFor', () => {
  it('binds the SQL opt-in read over the real pool, the host session lookup and the realm', async () => {
    vi.mocked(accountsWithDiscordQueuePings).mockImplementation(async () => [7]);
    const sessionFor = vi.fn((pid: number) =>
      pid === 1 ? { accountId: 7, name: 'A' } : undefined,
    );
    const d = queuePopDepsFor(sessionFor, 'Claudemoon');
    expect(d.realm).toBe('Claudemoon');
    expect(d.sessionFor(1)).toEqual({ accountId: 7, name: 'A' });
    expect(await d.optedIn([7, 8])).toEqual([7]);
    expect(vi.mocked(accountsWithDiscordQueuePings)).toHaveBeenCalledWith(
      { __fake: 'queue-pops-pool' },
      [7, 8],
    );
    expect(typeof d.now()).toBe('number');
  });
});

describe('shared-account cache invalidation', () => {
  it('deduplicates GM sessions so a mid-read opt-out cannot be undone by a second stale result', async () => {
    let finish!: (ids: number[]) => void;
    const read = vi.fn(
      () =>
        new Promise<number[]>((resolve) => {
          finish = resolve;
        }),
    );
    const shared: QueuePopDeps = {
      ...deps(read),
      sessionFor: () => ({ accountId: 10, name: 'GM' }),
    };
    const batch = observeQueuePops([], [1, 2], shared);
    expect(read).toHaveBeenCalledWith([10]);
    bustQueuePingCache(10);
    finish([10]);
    await batch;
    // Still before another batch may start: a stale cached true would enqueue
    // immediately here, bypassing the preference change made during the read.
    await observeQueuePops([bgProposed(1)], [], { ...shared, now: () => NOW + 1 });
    expect(drainQueuePops(NOW + 1)).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
    const current = vi.fn(async () => []);
    await observeQueuePops([], [], {
      ...shared,
      optedIn: current,
      now: () => NOW + QUEUE_POP_MIN_BATCH_INTERVAL_MS,
    });
    expect(current).toHaveBeenCalledWith([10]);
    expect(drainQueuePops(NOW + QUEUE_POP_MIN_BATCH_INTERVAL_MS)).toEqual([]);
  });
});
