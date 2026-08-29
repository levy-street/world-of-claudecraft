// The $WOC Exchange sweep shell (server/woc_market_sweep.ts): the timing,
// locking, and watchdog wrapper around the segment plan
// WocMarketService.sweepSegments builds. Modeled on
// tests/retention_sweep.test.ts, which pins the sibling sweep's identical
// hazards.
//
// Why the lock-key pin matters: a key that collides with the boot-DDL lock
// (0x57_4f_43_01) or the retention lock (0x57_4f_43_02) makes this realm's
// sweep lose the try-lock on every pass, forever and silently. Auctions would
// never close, settlement windows never expire, and escrowed items never fly
// home, all while the process looks healthy. The module claims distinctness in
// prose; this asserts it.
//
// Why the per-segment shape matters (H11): the old shell held ONE pool client
// and the session advisory lock across the whole pass, which the chain-poll
// arms can stretch to tens of minutes against a hung economy service. The
// pins here are the new contract: a locked segment brackets its own
// checkout/lock/unlock/release, an UNLOCKED (chain) segment runs with no
// client checked out at all, and a lost try-lock stands the pass down.

import { describe, expect, it, vi } from 'vitest';
import { RETENTION_SWEEP_ADVISORY_LOCK_KEY } from '../server/retention_sweep';
import {
  createWocMarketSweep,
  WOC_MARKET_SWEEP_ADVISORY_LOCK_KEY,
  WOC_MARKET_SWEEP_LOCK_SQL,
  WOC_MARKET_SWEEP_POLL_MS,
  WOC_MARKET_SWEEP_UNLOCK_SQL,
  type WocMarketSweepLockClient,
  type WocMarketSweepPassPlan,
  type WocMarketSweepSegment,
} from '../server/woc_market_sweep';

const REALM = 'Claudemoon';

interface FakeClient extends WocMarketSweepLockClient {
  queries: { sql: string; params: unknown[] }[];
  releases: (boolean | undefined)[];
}

function fakeClient(
  opts: {
    lockOk?: boolean;
    lockThrows?: boolean;
    unlockThrows?: boolean;
    unlockFalse?: boolean;
  } = {},
): FakeClient {
  const queries: { sql: string; params: unknown[] }[] = [];
  const releases: (boolean | undefined)[] = [];
  return {
    queries,
    releases,
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (sql.includes('pg_try_advisory_lock')) {
        if (opts.lockThrows) throw new Error('lock query failed');
        return { rows: [{ ok: opts.lockOk !== false }] };
      }
      if (sql.includes('pg_advisory_unlock')) {
        if (opts.unlockThrows) throw new Error('unlock query failed');
        // The real call answers its boolean; false means the session did not
        // hold the lock it just ran under (the destroy arm's trigger).
        return { rows: [{ ok: opts.unlockFalse !== true }] };
      }
      return { rows: [] };
    },
    release(destroy?: boolean) {
      releases.push(destroy);
    },
  };
}

/** A one-segment plan (the single-locked-segment shape most lock tests need). */
function planOf(segments: WocMarketSweepSegment[], finish: () => void = () => {}) {
  const plan: WocMarketSweepPassPlan = { segments, finish };
  return plan;
}

describe('the advisory lock key', () => {
  it('is the literal WOC\\x03 key and collides with neither sibling lock', () => {
    // Pinned to the literal, not to itself: the whole point is that these three
    // numbers stay different, so a self-comparison would prove nothing.
    expect(WOC_MARKET_SWEEP_ADVISORY_LOCK_KEY).toBe(0x57_4f_43_03);
    // The retention key is EXPORTED, so compare the live symbol: a hand copy
    // would stay green if retention itself moved onto 0x57_4f_43_03, which is
    // the exact collision this test exists to prevent.
    expect(WOC_MARKET_SWEEP_ADVISORY_LOCK_KEY).not.toBe(RETENTION_SWEEP_ADVISORY_LOCK_KEY);
    expect(RETENTION_SWEEP_ADVISORY_LOCK_KEY).toBe(0x57_4f_43_02);
    // db.ts's boot-DDL key is module-private, so that literal is unavoidable.
    expect(WOC_MARKET_SWEEP_ADVISORY_LOCK_KEY).not.toBe(0x57_4f_43_01);
  });

  it('polls on a seconds-scale cadence (auction ends are minute-scale deadlines)', () => {
    expect(WOC_MARKET_SWEEP_POLL_MS).toBe(5_000);
  });
});

describe('one guarded pass over the segment plan', () => {
  it('brackets a locked segment with lock and unlock, then pools the client', async () => {
    const client = fakeClient();
    const run = vi.fn(async () => {});
    const finish = vi.fn();
    const sweep = createWocMarketSweep({
      realm: REALM,
      connect: async () => client,
      plan: () => planOf([{ name: 'expiry', locked: true, run }], finish),
      onError: () => {},
    });
    await sweep.runOnce();
    expect(run).toHaveBeenCalledTimes(1);
    // The EXACT statements, by the exported single source: the pg exclusion
    // proof executes these same strings, so a shape drift (dropping
    // hashtext, rewrapping the realm) cannot pass one judge and fail only in
    // production.
    expect(client.queries[0].sql).toBe(WOC_MARKET_SWEEP_LOCK_SQL);
    expect(WOC_MARKET_SWEEP_LOCK_SQL).toBe('SELECT pg_try_advisory_lock($1, hashtext($2)) AS ok');
    // Both lock statements carry the key AND the realm, so two realms never
    // serialize against each other.
    expect(client.queries[0].params).toEqual([WOC_MARKET_SWEEP_ADVISORY_LOCK_KEY, REALM]);
    expect(client.queries[1].sql).toBe(WOC_MARKET_SWEEP_UNLOCK_SQL);
    expect(WOC_MARKET_SWEEP_UNLOCK_SQL).toBe('SELECT pg_advisory_unlock($1, hashtext($2)) AS ok');
    expect(client.queries[1].params).toEqual([WOC_MARKET_SWEEP_ADVISORY_LOCK_KEY, REALM]);
    // Healthy pass: the client goes back to the pool, never destroyed.
    expect(client.releases).toEqual([undefined]);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('runs an UNLOCKED (chain) segment with no client checked out at all', async () => {
    let connects = 0;
    const order: string[] = [];
    const sweep = createWocMarketSweep({
      realm: REALM,
      connect: async () => {
        connects++;
        order.push('connect');
        return fakeClient();
      },
      plan: () =>
        planOf([
          {
            name: 'chain-polls',
            locked: false,
            run: async () => {
              order.push('chain');
            },
          },
        ]),
      onError: () => {},
    });
    await sweep.runOnce();
    // The decisive shape: a chain segment costs ZERO pool checkouts, so a
    // hung economy service can no longer camp a shared-pool client.
    expect(connects).toBe(0);
    expect(order).toEqual(['chain']);
  });

  it('releases the locked segment BEFORE the chain segment runs, and re-locks after', async () => {
    const order: string[] = [];
    const clients: FakeClient[] = [];
    const sweep = createWocMarketSweep({
      realm: REALM,
      connect: async () => {
        const c = fakeClient();
        clients.push(c);
        const release = c.release.bind(c);
        c.release = (destroy?: boolean) => {
          order.push('release');
          release(destroy);
        };
        return c;
      },
      plan: () =>
        planOf([
          {
            name: 'expiry',
            locked: true,
            run: async () => {
              order.push('db-1');
            },
          },
          {
            name: 'chain-polls',
            locked: false,
            run: async () => {
              order.push('chain');
            },
          },
          {
            name: 'delivery',
            locked: true,
            run: async () => {
              order.push('db-2');
            },
          },
        ]),
      onError: () => {},
    });
    await sweep.runOnce();
    // The pass never holds a client across the chain segment: the first
    // locked segment's client is RELEASED before the chain work starts, and
    // the second locked segment checks out (and releases) its own.
    expect(order).toEqual(['db-1', 'release', 'chain', 'db-2', 'release']);
    expect(clients).toHaveLength(2);
    for (const c of clients) {
      expect(c.queries.map((q) => q.sql).filter((sql) => sql.includes('advisory'))).toHaveLength(2);
    }
  });

  it('stands the whole pass down when a peer holds the realm lock, finish still fires', async () => {
    const client = fakeClient({ lockOk: false });
    const db = vi.fn(async () => {});
    const chain = vi.fn(async () => {});
    const finish = vi.fn();
    const stamps: string[] = [];
    const sweep = createWocMarketSweep({
      realm: REALM,
      connect: async () => client,
      plan: () =>
        planOf(
          [
            { name: 'expiry', locked: true, run: db },
            { name: 'chain-polls', locked: false, run: chain },
          ],
          finish,
        ),
      onError: () => {},
      watchdog: {
        begin: () => stamps.push('begin'),
        segment: (name) => stamps.push(`segment:${name}`),
        end: () => stamps.push('end'),
      },
    });
    await sweep.runOnce();
    expect(db).not.toHaveBeenCalled();
    // The peer holding the lock IS this realm's sweep: the chain arms stand
    // down with the rest rather than interleaving with it.
    expect(chain).not.toHaveBeenCalled();
    // No unlock: this process never held the lock.
    expect(client.queries.map((q) => q.sql).join()).not.toContain('pg_advisory_unlock');
    expect(client.releases).toEqual([undefined]);
    // The pass still reports (zero-scored arms can never read as saturated).
    expect(finish).toHaveBeenCalledTimes(1);
    // The lost-lock abort still closes its watchdog pass: without the end
    // stamp the readout would show a phantom forever-running pass.
    expect(stamps).toEqual(['begin', 'segment:expiry', 'end']);
  });

  it('a null plan (market disabled) does nothing', async () => {
    let connects = 0;
    const sweep = createWocMarketSweep({
      realm: REALM,
      connect: async () => {
        connects++;
        return fakeClient();
      },
      plan: () => null,
      onError: () => {},
    });
    await sweep.runOnce();
    expect(connects).toBe(0);
  });

  it('still unlocks and releases when a segment throws, reports the error, and finish fires', async () => {
    const client = fakeClient();
    const onError = vi.fn();
    const finish = vi.fn();
    const boom = new Error('segment exploded');
    const sweep = createWocMarketSweep({
      realm: REALM,
      connect: async () => client,
      plan: () =>
        planOf(
          [
            {
              name: 'expiry',
              locked: true,
              run: async () => {
                throw boom;
              },
            },
          ],
          finish,
        ),
      onError,
    });
    await sweep.runOnce();
    // A thrown segment must not leak the lock: the next pass has to be able to
    // take it, or this realm's sweep is dead until the connection dies.
    expect(client.queries[1].sql).toContain('pg_advisory_unlock');
    expect(client.releases).toEqual([undefined]);
    expect(onError).toHaveBeenCalledWith(boom);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('DESTROYS the client when the lock query itself fails', async () => {
    const client = fakeClient({ lockThrows: true });
    const onError = vi.fn();
    const sweep = createWocMarketSweep({
      realm: REALM,
      connect: async () => client,
      plan: () => planOf([{ name: 'expiry', locked: true, run: async () => {} }]),
      onError,
    });
    await sweep.runOnce();
    // The lock state on this connection is unknown, so pooling it could park a
    // held lock in the pool for hours and wedge every future pass.
    expect(client.releases).toEqual([true]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('DESTROYS the client when the unlock query fails', async () => {
    const client = fakeClient({ unlockThrows: true });
    const run = vi.fn(async () => {});
    const sweep = createWocMarketSweep({
      realm: REALM,
      connect: async () => client,
      plan: () => planOf([{ name: 'expiry', locked: true, run }]),
      onError: () => {},
    });
    await sweep.runOnce();
    expect(run).toHaveBeenCalledTimes(1);
    // The segment succeeded but the lock may still be held: same hazard, same fix.
    expect(client.releases).toEqual([true]);
  });

  it('DESTROYS the client when unlock answers FALSE (session lock state unexpected)', async () => {
    const client = fakeClient({ unlockFalse: true });
    const run = vi.fn(async () => {});
    const sweep = createWocMarketSweep({
      realm: REALM,
      connect: async () => client,
      plan: () => planOf([{ name: 'expiry', locked: true, run }]),
      onError: () => {},
    });
    await sweep.runOnce();
    expect(run).toHaveBeenCalledTimes(1);
    // A false unlock means this session did not hold the lock it just ran
    // under: its lock state is not what the shell believes, so the client is
    // destroyed like the thrown arm rather than pooled.
    expect(client.releases).toEqual([true]);
  });

  it('stamps the watchdog: begin, each segment by name, end (end even on a throw)', async () => {
    const stamps: string[] = [];
    const watchdog = {
      begin: () => stamps.push('begin'),
      segment: (name: string) => stamps.push(`segment:${name}`),
      end: () => stamps.push('end'),
    };
    const sweep = createWocMarketSweep({
      realm: REALM,
      connect: async () => fakeClient(),
      plan: () =>
        planOf([
          { name: 'expiry', locked: true, run: async () => {} },
          {
            name: 'chain-polls',
            locked: false,
            run: async () => {
              throw new Error('mid-pass');
            },
          },
        ]),
      onError: () => {},
      watchdog,
    });
    await sweep.runOnce();
    // end fires from the finally: a thrown pass must never leave the watchdog
    // reporting a phantom still-running pass forever.
    expect(stamps).toEqual(['begin', 'segment:expiry', 'segment:chain-polls', 'end']);
  });
});

describe('re-entrancy and shutdown', () => {
  it('never overlaps passes: a runOnce during an in-flight pass is a no-op', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Counted on CONNECT, not on the segment body: the guard rejects the
    // second call the moment the first is in flight, which is before the
    // first has awaited its way into a segment.
    let connects = 0;
    const run = vi.fn(async () => {
      await gate;
    });
    const sweep = createWocMarketSweep({
      realm: REALM,
      connect: async () => {
        connects++;
        return fakeClient();
      },
      plan: () => planOf([{ name: 'expiry', locked: true, run }]),
      onError: () => {},
    });
    const first = sweep.runOnce();
    await sweep.runOnce(); // lands while the first pass is still in flight
    expect(connects).toBe(1);
    release();
    await first;
    // And the rejected call never queued: no second pass runs on drain.
    expect(connects).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('stop() awaits the in-flight segment and skips the remaining segments', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finished = false;
    const later = vi.fn(async () => {});
    const finish = vi.fn();
    const sweep = createWocMarketSweep({
      realm: REALM,
      connect: async () => fakeClient(),
      plan: () =>
        planOf(
          [
            {
              name: 'expiry',
              locked: true,
              run: async () => {
                await gate;
                finished = true;
              },
            },
            { name: 'chain-polls', locked: false, run: later },
          ],
          finish,
        ),
      onError: () => {},
    });
    const first = sweep.runOnce();
    const stopping = sweep.stop();
    release();
    await stopping;
    // stop() must not resolve before the segment it is draining: the pool
    // closes right after it in main.ts's shutdown. But the NEXT segment never
    // starts: shutdown does not wait out chain round trips it can skip.
    expect(finished).toBe(true);
    await first;
    expect(later).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);
    await sweep.runOnce();
    expect(later).not.toHaveBeenCalled();
    // The post-stop runOnce must refuse at the GUARD, not merely skip
    // segments inside a fresh pass: a fresh pass would build a new plan and
    // fire finish() a second time (deleting the stopped arm of runOnce's
    // guard is exactly the regression this count catches).
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('start() arms an unref-ed timer and stop() clears it', async () => {
    const sweep = createWocMarketSweep({
      realm: REALM,
      connect: async () => fakeClient(),
      plan: () => planOf([]),
      onError: () => {},
      pollMs: 50,
    });
    const spy = vi.spyOn(globalThis, 'setInterval');
    sweep.start();
    expect(spy).toHaveBeenCalledTimes(1);
    // hasRef(), not typeof unref: every Node Timeout HAS an unref method
    // whether or not anyone called it, so the old assertion stayed green with
    // the unref deleted and the interval holding the process open through
    // every shutdown.
    const handle = spy.mock.results[0].value as NodeJS.Timeout;
    expect(handle.hasRef()).toBe(false);
    sweep.start(); // idempotent
    expect(spy).toHaveBeenCalledTimes(1);
    await sweep.stop();
    spy.mockRestore();
  });
});
