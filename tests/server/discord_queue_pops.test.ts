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

import { accountsWithDiscordQueuePings } from '../../server/discord_queue_pings_db';
import {
  ARENA_POP_TTL_MS,
  bustQueuePingCache,
  collectQueuePops,
  drainQueuePops,
  enqueueQueuePop,
  observeQueuePops,
  QUEUE_PING_CACHE_TTL_MS,
  QUEUE_POP_MAX_QUEUE,
  type QueuedQueuePop,
  type QueuePopDeps,
  queuedPidsOf,
  queuePopDepsFor,
  queuePopQueueDepth,
  queuePopsWatching,
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
    await observeQueuePops([], [1], deps(optedIn));
    bustQueuePingCache(10);
    optedIn.mockResolvedValueOnce([10]);
    await observeQueuePops([], [1], deps(optedIn));
    expect(optedIn).toHaveBeenCalledTimes(2);
    await observeQueuePops([], [1], deps(optedIn));
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
    await observeQueuePops([], [1], deps(again));
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('a Discord link busts a cached unlinked false so the next pop can enqueue', async () => {
    const optedOutBecauseUnlinked = vi.fn(async (): Promise<number[]> => []);
    await observeQueuePops([], [1], deps(optedOutBecauseUnlinked));
    await observeQueuePops([bgProposed(1)], [1], deps(vi.fn(async () => [10])));
    expect(queuePopQueueDepth()).toBe(0);

    bustQueuePingCache(10);
    const linked = vi.fn(async () => [10]);
    await observeQueuePops([bgProposed(1)], [1], deps(linked));
    expect(linked).toHaveBeenCalledTimes(1);
    expect(drainQueuePops(NOW).map((p) => [p.accountId, p.seconds])).toEqual([[10, 30]]);

    await observeQueuePops([], [1], deps(linked));
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

  it('swallows a failed read: the pop loses its DM and the tick loses nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const optedIn = vi.fn(async () => {
      throw new Error('db down');
    });
    await expect(observeQueuePops([bgProposed(1)], [1], deps(optedIn))).resolves.toBeUndefined();
    expect(queuePopQueueDepth()).toBe(0);
    expect(error).toHaveBeenCalled();
    // Nothing was cached, so the next tick tries again.
    await observeQueuePops([], [1], deps(optedIn));
    expect(optedIn).toHaveBeenCalledTimes(2);
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
