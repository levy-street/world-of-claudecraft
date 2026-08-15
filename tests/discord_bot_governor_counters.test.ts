// The RateGovernor counter snapshot Phase 8 will ship (D16).
//
// Every monotonic counter is asserted as a DELTA around ONE driven event, never
// as a running total: against a total, a counter that moved twice reads exactly
// like a counter that moved once, and a counter that never moved reads like a
// counter whose event did not happen. The delta map covers all eight monotonic
// counters plus all four scope buckets at once, so a test named for `banPauses`
// also proves that same event did not quietly bump `globalPauses` as well. The
// live gauges (queueDepth, trackedBuckets, forbiddenEntries, breakerState) are
// asserted on their own, because they move both ways and a delta says nothing
// useful about them.
//
// Time is the syntheticClock, deliberately NOT vi.useFakeTimers: the governor
// captures its clock at construction (so it would never see a fake timer swap)
// and its waits are computed from a float retry_after (so a real fractional
// timer is allowed to fire early). The virtual clock has neither problem.
import { describe, expect, it } from 'vitest';
import {
  BREAKER_WINDOW_MS,
  GovernorBlockedError,
  type GovernorCounters,
  type GovernorRequest,
  type GovernorResponse,
  MAX_ATTEMPTS,
  MAX_QUEUE_DEPTH,
  RateGovernor,
  type RateGovernorOptions,
} from '../bot/rate_governor';
import { type SyntheticClock, syntheticClock } from './helpers/synthetic_clock';

// None of these repeats a DEFAULT_* from the module, on purpose. A fixture equal
// to the implementation's own default cannot tell a wired option from an ignored
// one, so the assertion built on it could not fail.
const MAX_RPS = 40;
const BAN_PAUSE_MS = 777_000;
const BREAKER_LIMIT = 4;
const FORBIDDEN_TTL_MS = 60_000;

/** Distinct routes, so a test can put two requests in two separate bucket queues. */
const ROLES: GovernorRequest = { method: 'GET', path: '/guilds/1/roles' };
const MESSAGES: GovernorRequest = { method: 'POST', path: '/channels/9/messages' };
const NICK: GovernorRequest = { method: 'PATCH', path: '/guilds/1/members/7' };
/** A background write: not essential, so it is what the breaker stops first. */
const SWEEP: GovernorRequest = { method: 'PATCH', path: '/guilds/1/members/2' };

type GovernorLogLine = { level: string; message: string; fields: Record<string, string | number> };

function makeGovernor(overrides: Partial<RateGovernorOptions> = {}): {
  governor: RateGovernor;
  clock: SyntheticClock;
  logs: GovernorLogLine[];
} {
  const clock = syntheticClock();
  const logs: GovernorLogLine[] = [];
  const governor = new RateGovernor({
    clock,
    maxRps: MAX_RPS,
    banPauseMs: BAN_PAUSE_MS,
    breakerLimit: BREAKER_LIMIT,
    forbiddenTtlMs: FORBIDDEN_TTL_MS,
    log: (level, message, fields) => logs.push({ level, message, fields }),
    ...overrides,
  });
  return { governor, clock, logs };
}

function reply(opts: Partial<GovernorResponse> = {}): GovernorResponse {
  return {
    status: opts.status ?? 200,
    headers: opts.headers ?? {},
    json: opts.json,
    jsonParsed: opts.jsonParsed ?? true,
    nonJsonBody: opts.nonJsonBody,
  };
}

/** One 429 and then a normal answer, the shape of a retry that succeeds. */
function limitedThenOk(limited: GovernorResponse): () => Promise<GovernorResponse> {
  let call = 0;
  return async () => {
    call++;
    return call === 1 ? limited : reply();
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Await a governor call, moving virtual time to whatever it sleeps on. The
 * rejection is captured BEFORE the clock runs so a refused request never shows
 * up as an unhandled rejection, and it is re-thrown afterwards so callers can
 * still `.catch` it.
 */
async function settle<T>(clock: SyntheticClock, pending: Promise<T>): Promise<T> {
  const captured = pending.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await clock.runAll();
  const outcome = await captured;
  if (outcome.ok) return outcome.value;
  throw outcome.error;
}

type MonotonicCounter =
  | 'requests'
  | 'rateLimited'
  | 'globalPauses'
  | 'banPauses'
  | 'breakerOpens'
  | 'forbiddenBlocks'
  | 'breakerBlocks'
  | 'queueFullBlocks';

const MONOTONIC: MonotonicCounter[] = [
  'requests',
  'rateLimited',
  'globalPauses',
  'banPauses',
  'breakerOpens',
  'forbiddenBlocks',
  'breakerBlocks',
  'queueFullBlocks',
];

const SCOPES = ['user', 'global', 'shared', 'unknown'] as const;

/** The all-zero expectation every movement assertion spreads over. */
const NO_MOVEMENT: Record<string, number> = {
  requests: 0,
  rateLimited: 0,
  globalPauses: 0,
  banPauses: 0,
  breakerOpens: 0,
  forbiddenBlocks: 0,
  breakerBlocks: 0,
  queueFullBlocks: 0,
  'scope.user': 0,
  'scope.global': 0,
  'scope.shared': 0,
  'scope.unknown': 0,
};

function movement(before: GovernorCounters, after: GovernorCounters): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of MONOTONIC) out[key] = after[key] - before[key];
  for (const scope of SCOPES) {
    out[`scope.${scope}`] = after.rateLimitedByScope[scope] - before.rateLimitedByScope[scope];
  }
  return out;
}

/** Drive exactly `BREAKER_LIMIT` counted failures, which is what opens it. */
async function openTheBreaker(governor: RateGovernor, clock: SyntheticClock): Promise<void> {
  for (let i = 0; i < BREAKER_LIMIT; i++) {
    await settle(
      clock,
      governor.run(SWEEP, async () => reply({ status: 403 })),
    );
  }
}

describe('RateGovernor snapshot shape', () => {
  it('starts fully zeroed and closed, with exactly the D16 field set', () => {
    // Synchronous on purpose: snapshot() takes no await and no clock advance to
    // be callable. `toEqual` is exact over own keys, so this pins the field set
    // too: a counter added without a zero initializer reads undefined here, and
    // a counter dropped from the shape fails outright.
    const { governor } = makeGovernor();
    expect(governor.snapshot()).toEqual({
      requests: 0,
      rateLimited: 0,
      rateLimitedByScope: { user: 0, global: 0, shared: 0, unknown: 0 },
      globalPauses: 0,
      banPauses: 0,
      breakerState: 'closed',
      breakerOpens: 0,
      queueDepth: 0,
      trackedBuckets: 0,
      // The three registry sizes are reported so their BOUNDS are observable:
      // buckets and learned routes are LRU capped, and a drained queue is
      // dropped. Without a counter each, an unbounded map is invisible to a test
      // and only shows up as a slow leak in a long-lived process.
      trackedRoutes: 0,
      activeQueues: 0,
      forbiddenEntries: 0,
      forbiddenBlocks: 0,
      breakerBlocks: 0,
      queueFullBlocks: 0,
    });
  });

  it('keys rateLimitedByScope by exactly user, global, shared and unknown', () => {
    // The scope table is a fixed Record over the four documented scopes. A fifth
    // key would mean the governor invented a scope Discord does not send, and a
    // missing key would make that scope's counter read undefined at increment.
    const { governor } = makeGovernor();
    expect(Object.keys(governor.snapshot().rateLimitedByScope).sort()).toEqual([
      'global',
      'shared',
      'unknown',
      'user',
    ]);
  });

  it('performs no IO and schedules no sleep', () => {
    // The sleep seam is made to throw: snapshot() is a plain read of already
    // accumulated state, so anything that waited, retried, or dispatched here
    // would surface as that throw rather than as a slow test.
    const base = syntheticClock();
    let sleeps = 0;
    const { governor } = makeGovernor({
      clock: {
        now: () => base.now(),
        sleep: async (ms: number) => {
          sleeps++;
          throw new Error(`snapshot must not sleep, asked for ${ms} ms`);
        },
      },
    });

    expect(governor.snapshot().requests).toBe(0);
    expect(sleeps).toBe(0);
    // Nor may it park a waiter for later or move the clock forward itself.
    expect(base.pending()).toBe(0);
    expect(base.now()).toBe(0);
  });

  it('hands back a COPY: mutating a snapshot cannot change the governor', async () => {
    // Returning `this.counters` directly would make every reader of the snapshot
    // (a metrics endpoint, a log line) able to corrupt the governor's own state,
    // and would make two successive readings alias each other.
    const { governor, clock } = makeGovernor();
    await settle(
      clock,
      governor.run(
        ROLES,
        limitedThenOk(
          reply({
            status: 429,
            headers: { 'x-ratelimit-scope': 'user' },
            json: { retry_after: 2 },
          }),
        ),
      ),
    );

    const first = governor.snapshot();
    expect(first.requests).toBe(2);
    expect(first.rateLimited).toBe(1);
    expect(first.rateLimitedByScope.user).toBe(1);

    first.requests = 999;
    first.rateLimited = 999;
    first.queueDepth = 999;
    first.breakerState = 'open';
    // The nested table too: a shallow spread alone would leave this one live.
    first.rateLimitedByScope.user = 999;

    const second = governor.snapshot();
    // Both sides pinned to literals, not merely to each other: comparing the two
    // snapshots would hold even if both had been corrupted to 999.
    expect(second.requests).toBe(2);
    expect(second.rateLimited).toBe(1);
    expect(second.rateLimitedByScope.user).toBe(1);
    expect(second.queueDepth).toBe(0);
    expect(second.breakerState).toBe('closed');
    expect(second.rateLimitedByScope).not.toBe(first.rateLimitedByScope);
  });
});

describe('RateGovernor counters move exactly once per event', () => {
  it('counts requests once for one send and moves nothing else', async () => {
    const { governor, clock } = makeGovernor();
    const before = governor.snapshot();

    await settle(
      clock,
      governor.run(ROLES, async () => reply()),
    );

    expect(movement(before, governor.snapshot())).toEqual({ ...NO_MOVEMENT, requests: 1 });
  });

  it('counts requests per SEND, retries included, and rateLimited per 429', async () => {
    // A route that answers 429 forever is handed to the send callback exactly
    // MAX_ATTEMPTS times, so `requests` is 3 rather than the 1 a per-CALL counter
    // would report, and `rateLimited` is 3 rather than the 1 a "did this call get
    // limited at all" flag would report.
    const { governor, clock } = makeGovernor();
    const before = governor.snapshot();
    let sent = 0;

    await settle(
      clock,
      governor.run(ROLES, async () => {
        sent++;
        return reply({
          status: 429,
          headers: { 'x-ratelimit-scope': 'user' },
          json: { retry_after: 2 },
        });
      }),
    );

    expect(sent).toBe(MAX_ATTEMPTS);
    expect(movement(before, governor.snapshot())).toEqual({
      ...NO_MOVEMENT,
      requests: 3,
      rateLimited: 3,
      'scope.user': 3,
    });
  });

  // One row per X-RateLimit-Scope Discord can send, plus the header-absent case.
  // Each drives ONE 429 that then succeeds, so the whole difference between rows
  // is which scope bucket moved: a governor that folded every 429 into `unknown`
  // (or that read the header case-sensitively wrong) fails three of the four.
  const SCOPE_ROWS: {
    name: string;
    headers: Record<string, string>;
    expected: Record<string, number>;
  }[] = [
    {
      name: 'user',
      headers: { 'x-ratelimit-scope': 'user' },
      expected: { ...NO_MOVEMENT, requests: 2, rateLimited: 1, 'scope.user': 1 },
    },
    {
      name: 'global',
      headers: { 'x-ratelimit-scope': 'global' },
      // A global-scope 429 is also the one that starts the process-wide pause,
      // so its row is the pin that globalPauses moves once and only here.
      expected: {
        ...NO_MOVEMENT,
        requests: 2,
        rateLimited: 1,
        'scope.global': 1,
        globalPauses: 1,
      },
    },
    {
      name: 'shared',
      headers: { 'x-ratelimit-scope': 'shared' },
      expected: { ...NO_MOVEMENT, requests: 2, rateLimited: 1, 'scope.shared': 1 },
    },
    {
      name: 'unknown (no scope header at all)',
      headers: {},
      expected: { ...NO_MOVEMENT, requests: 2, rateLimited: 1, 'scope.unknown': 1 },
    },
  ];

  for (const row of SCOPE_ROWS) {
    it(`lands a ${row.name} 429 in exactly that scope bucket`, async () => {
      const { governor, clock } = makeGovernor();
      const before = governor.snapshot();

      await settle(
        clock,
        governor.run(
          ROLES,
          limitedThenOk(reply({ status: 429, headers: row.headers, json: { retry_after: 2 } })),
        ),
      );

      expect(movement(before, governor.snapshot())).toEqual(row.expected);
    });
  }

  it('counts a body-flagged global 429 as one globalPause under the unknown scope', async () => {
    // Discord flags some global limits only in the JSON body (`"global": true`)
    // with no scope header. Dropping the body arm would leave the process-wide
    // pause uncounted, and counting it in BOTH arms would double count the pause
    // for a 429 that carries the header and the flag.
    const { governor, clock } = makeGovernor();
    const before = governor.snapshot();

    await settle(
      clock,
      governor.run(
        ROLES,
        limitedThenOk(reply({ status: 429, json: { retry_after: 2, global: true } })),
      ),
    );

    expect(movement(before, governor.snapshot())).toEqual({
      ...NO_MOVEMENT,
      requests: 2,
      rateLimited: 1,
      globalPauses: 1,
      'scope.unknown': 1,
    });
  });

  it('counts a non-JSON 429 as one banPause and NOT as a globalPause', async () => {
    // A 429 whose body is not JSON is Cloudflare refusing us, not Discord pacing
    // us. It starts the much longer ban pause, so it must land in `banPauses`
    // alone: folding it into `globalPauses` would hide the ban in the ordinary
    // rate-limit noise, which is the whole reason the two are separate fields.
    const { governor, clock } = makeGovernor();
    const before = governor.snapshot();
    let sent = 0;

    await settle(
      clock,
      governor.run(ROLES, async () => {
        sent++;
        return reply({ status: 429, jsonParsed: false, nonJsonBody: true });
      }),
    );

    // No retry either: a banned bot coming back is what deepens the ban.
    expect(sent).toBe(1);
    expect(movement(before, governor.snapshot())).toEqual({
      ...NO_MOVEMENT,
      requests: 1,
      rateLimited: 1,
      banPauses: 1,
      'scope.unknown': 1,
    });
  });

  it('opens the breaker exactly once, on the response that reaches the limit', async () => {
    const { governor, clock } = makeGovernor();
    const opensAfterEach: number[] = [];

    for (let i = 0; i < BREAKER_LIMIT; i++) {
      await settle(
        clock,
        governor.run(SWEEP, async () => reply({ status: 403 })),
      );
      opensAfterEach.push(governor.snapshot().breakerOpens);
    }

    expect(opensAfterEach).toEqual([0, 0, 0, 1]);
    expect(governor.snapshot().breakerState).toBe('open');

    // Essential traffic still flows while the breaker is open, and a further
    // failure must NOT count a second open: the breaker is open already. Without
    // the already-open guard this reads 2 and every later failure inflates it.
    await settle(
      clock,
      governor.run({ ...SWEEP, essential: true }, async () => reply({ status: 403 })),
    );
    expect(governor.snapshot().breakerOpens).toBe(1);
  });

  it('counts a breaker-refused request once, sends nothing, and lets essential through', async () => {
    const { governor, clock } = makeGovernor();
    await openTheBreaker(governor, clock);

    const before = governor.snapshot();
    let sent = 0;
    const refused = await settle(
      clock,
      governor.run(SWEEP, async () => {
        sent++;
        return reply();
      }),
    ).catch((error: unknown) => error);
    const blocked = governor.snapshot();

    expect(refused).toBeInstanceOf(GovernorBlockedError);
    expect((refused as GovernorBlockedError).reason).toBe('breaker-open');
    // `requests` staying at 0 is what proves the refusal happened BEFORE the
    // send callback, not after a wasted dispatch.
    expect(sent).toBe(0);
    expect(movement(before, blocked)).toEqual({ ...NO_MOVEMENT, breakerBlocks: 1 });

    await settle(
      clock,
      governor.run({ ...SWEEP, essential: true }, async () => {
        sent++;
        return reply();
      }),
    );
    const after = governor.snapshot();

    expect(sent).toBe(1);
    expect(movement(blocked, after)).toEqual({ ...NO_MOVEMENT, requests: 1 });
    // An essential success is not a probe, so it must not close the breaker.
    expect(after.breakerState).toBe('open');
  });

  it('counts a queue-full refusal once and never reaches the send callback', async () => {
    // The refusal and its counter both land synchronously inside run(), before
    // any await, so the snapshots on either side of the call isolate exactly
    // this one event: no queued request has dispatched yet (requests stays 0).
    const { governor, clock } = makeGovernor();
    const gate = deferred<GovernorResponse>();
    const queued: Promise<GovernorResponse>[] = [];
    for (let i = 0; i < MAX_QUEUE_DEPTH; i++) {
      queued.push(governor.run(ROLES, () => gate.promise));
    }
    const before = governor.snapshot();

    let sent = 0;
    const refused = governor.run(ROLES, async () => {
      sent++;
      return reply();
    });
    const after = governor.snapshot();

    const blocked = await refused.catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(GovernorBlockedError);
    expect((blocked as GovernorBlockedError).reason).toBe('queue-full');
    expect(sent).toBe(0);
    expect(movement(before, after)).toEqual({ ...NO_MOVEMENT, queueFullBlocks: 1 });

    // Release the gate and drain, so the case leaves no pending virtual work.
    gate.resolve(reply());
    await clock.runAll();
    await Promise.all(queued);
  });

  it('counts a cache-refused subject once and never reaches the send callback', async () => {
    const { governor, clock } = makeGovernor();
    const subject: GovernorRequest = { ...NICK, subjectKey: 'g1:u7' };
    let sent = 0;

    await settle(
      clock,
      governor.run(subject, async () => {
        sent++;
        return reply({ status: 403 });
      }),
    );
    expect(governor.snapshot().forbiddenEntries).toBe(1);

    const before = governor.snapshot();
    const refused = await settle(
      clock,
      governor.run(subject, async () => {
        sent++;
        return reply();
      }),
    ).catch((error: unknown) => error);
    const after = governor.snapshot();

    expect(refused).toBeInstanceOf(GovernorBlockedError);
    expect((refused as GovernorBlockedError).reason).toBe('forbidden-cached');
    // One dispatch in total: the original 403, never the second write.
    expect(sent).toBe(1);
    expect(movement(before, after)).toEqual({ ...NO_MOVEMENT, forbiddenBlocks: 1 });
  });
});

describe('RateGovernor queueDepth gauge', () => {
  it('reads NON-ZERO while work is in flight and returns to 0 once it drains', async () => {
    // A gauge only ever observed at rest proves nothing, so the reading that
    // matters is taken with three requests parked on one serialized bucket
    // queue. If the increment moved below the queue wait, this reads 1.
    const { governor, clock } = makeGovernor();
    const gate = deferred<void>();
    let sent = 0;
    const send = async (): Promise<GovernorResponse> => {
      sent++;
      await gate.promise;
      return reply();
    };

    const inflight = [
      governor.run(ROLES, send),
      governor.run(ROLES, send),
      governor.run(ROLES, send),
    ];
    const done = Promise.all(inflight);
    // Flush microtasks without moving virtual time, so the head request has
    // reached its send and the other two are genuinely waiting.
    await clock.advanceBy(0);

    const during = governor.snapshot();
    expect(during.queueDepth).toBe(3);
    // One bucket, serialized FIFO: only the head has been dispatched.
    expect(during.requests).toBe(1);
    expect(sent).toBe(1);

    gate.resolve();
    await clock.runAll();
    await done;

    const after = governor.snapshot();
    expect(after.queueDepth).toBe(0);
    expect(after.requests).toBe(3);
  });

  it('reads activeQueues NON-ZERO while queues are live, then drops drained ones', async () => {
    // activeQueues exists so the queue map's bound is observable at all, but
    // every assertion on it read 0, which is also what a hard-coded zero returns.
    // Two DIFFERENT buckets held open at once is the reading that says the gauge
    // tracks the map: one queue per template, and both dropped on drain.
    const { governor, clock } = makeGovernor();
    const gate = deferred<void>();
    const send = async (): Promise<GovernorResponse> => {
      await gate.promise;
      return reply();
    };

    expect(governor.snapshot().activeQueues).toBe(0);

    const inflight = [
      governor.run(ROLES, send),
      governor.run(ROLES, send),
      governor.run(MESSAGES, send),
    ];
    const done = Promise.all(inflight);
    await clock.advanceBy(0);

    const during = governor.snapshot();
    // Two templates, so two queues, even though three requests are in flight.
    expect(during.activeQueues).toBe(2);
    expect(during.queueDepth).toBe(3);

    gate.resolve();
    await clock.runAll();
    await done;

    // Dropped on drain: the map does not keep an entry per template it has ever
    // seen, which on the per-interaction-id callback path would be one per slash
    // command for the life of the process.
    expect(governor.snapshot().activeQueues).toBe(0);
  });

  it('returns queueDepth to 0 when the send callback THROWS, not only when it resolves', async () => {
    // The decrement lives in a finally. Without it one socket failure leaks a
    // permanent unit of depth and the gauge ratchets up for the process's life,
    // which would eventually read as a full queue and refuse real traffic.
    const { governor, clock } = makeGovernor();
    const boom = new Error('socket hang up');

    const thrown = await settle(
      clock,
      governor.run(ROLES, async () => {
        throw boom;
      }),
    ).catch((error: unknown) => error);

    // Identity, not a message match: what the send callback throws propagates
    // untouched rather than being wrapped as a governor error.
    expect(thrown).toBe(boom);
    const after = governor.snapshot();
    expect(after.queueDepth).toBe(0);
    expect(after.requests).toBe(1);
  });
});

describe('RateGovernor trackedBuckets and forbiddenEntries gauges', () => {
  const RATE_HEADERS = { 'x-ratelimit-remaining': '4', 'x-ratelimit-reset-after': '2' };

  it('tracks one entry per distinct Discord bucket hash', async () => {
    const { governor, clock } = makeGovernor();
    expect(governor.snapshot().trackedBuckets).toBe(0);

    await settle(
      clock,
      governor.run(ROLES, async () =>
        reply({ headers: { ...RATE_HEADERS, 'x-ratelimit-bucket': 'roles-hash' } }),
      ),
    );
    expect(governor.snapshot().trackedBuckets).toBe(1);

    await settle(
      clock,
      governor.run(MESSAGES, async () =>
        reply({ headers: { ...RATE_HEADERS, 'x-ratelimit-bucket': 'messages-hash' } }),
      ),
    );
    expect(governor.snapshot().trackedBuckets).toBe(2);

    // A response carrying no rate headers teaches nothing about any bucket, so
    // it must not mint a third entry keyed by its own provisional template.
    await settle(
      clock,
      governor.run(NICK, async () => reply()),
    );
    expect(governor.snapshot().trackedBuckets).toBe(2);
  });

  it('counts two templates sharing a hash AND a major parameter only once', async () => {
    // The remap onto X-RateLimit-Bucket is what stops a bucket being counted
    // twice. Without it the gauge would report 2 while the two routes actually
    // share one rate window, and the operator would read the wrong denominator.
    // Both routes are in guild 1, so they share the major parameter too, which
    // is what makes them one real bucket rather than merely one route shape.
    const { governor, clock } = makeGovernor();

    await settle(
      clock,
      governor.run(ROLES, async () =>
        reply({ headers: { ...RATE_HEADERS, 'x-ratelimit-bucket': 'one-real-bucket' } }),
      ),
    );
    await settle(
      clock,
      governor.run(NICK, async () =>
        reply({ headers: { ...RATE_HEADERS, 'x-ratelimit-bucket': 'one-real-bucket' } }),
      ),
    );

    expect(governor.snapshot().trackedBuckets).toBe(1);
  });

  it('counts a shared hash across DIFFERENT major parameters as TWO buckets', async () => {
    // The other half, and the one that decides whether the gauge is telling the
    // truth. Discord documents X-RateLimit-Bucket as NON-inclusive of the major
    // resource, so guild 1 and channel 9 legitimately answer with the same hash
    // while holding separate limits. Keying rate state on the bare hash merged
    // them into one LimitState: channel 9 reporting headroom then erased guild
    // 1's exhausted window, and the next guild-1 write dispatched at
    // Remaining 0. The gauge reads 2 because there really are 2.
    const { governor, clock } = makeGovernor();

    await settle(
      clock,
      governor.run(ROLES, async () =>
        reply({ headers: { ...RATE_HEADERS, 'x-ratelimit-bucket': 'same-shape-hash' } }),
      ),
    );
    await settle(
      clock,
      governor.run(MESSAGES, async () =>
        reply({ headers: { ...RATE_HEADERS, 'x-ratelimit-bucket': 'same-shape-hash' } }),
      ),
    );

    expect(governor.snapshot().trackedBuckets).toBe(2);
  });

  it('reports live forbidden subjects and drops the one invalidateForbidden names', async () => {
    const { governor, clock } = makeGovernor();

    await settle(
      clock,
      governor.run({ ...NICK, subjectKey: 'g1:u1' }, async () => reply({ status: 403 })),
    );
    // 401 is cached on the same footing as 403: both are permanent for a subject.
    await settle(
      clock,
      governor.run({ ...NICK, subjectKey: 'g1:u2' }, async () => reply({ status: 401 })),
    );
    expect(governor.snapshot().forbiddenEntries).toBe(2);

    governor.invalidateForbidden('g1:u1');

    expect(governor.snapshot().forbiddenEntries).toBe(1);
    expect(governor.isForbidden('g1:u1')).toBe(false);
    // The surviving entry pins that invalidateForbidden removed one subject and
    // did not simply clear the whole cache.
    expect(governor.isForbidden('g1:u2')).toBe(true);
  });

  it('prunes an entry out of the snapshot the instant its TTL expires', async () => {
    const { governor, clock } = makeGovernor();
    await settle(
      clock,
      governor.run({ ...NICK, subjectKey: 'g1:u1' }, async () => reply({ status: 403 })),
    );
    expect(governor.snapshot().forbiddenEntries).toBe(1);

    // One millisecond short of the TTL the entry is still live. Without this
    // reading, a snapshot that pruned on ANY clock movement would satisfy the
    // assertion below and the TTL itself would be unpinned.
    await clock.advanceBy(FORBIDDEN_TTL_MS - 1);
    expect(governor.snapshot().forbiddenEntries).toBe(1);

    await clock.advanceBy(1);
    expect(governor.snapshot().forbiddenEntries).toBe(0);
  });
});

describe('RateGovernor breakerState reporting', () => {
  it('reads half-open while the single probe is in flight, then closed once it succeeds', async () => {
    const { governor, clock } = makeGovernor();
    await openTheBreaker(governor, clock);
    expect(governor.snapshot().breakerState).toBe('open');

    // The probe is offered only after a FULL quiet window with no counted
    // failure, so nothing is half-open until the clock has crossed it.
    await clock.advanceBy(BREAKER_WINDOW_MS);
    const before = governor.snapshot();
    expect(before.breakerState).toBe('open');

    const gate = deferred<void>();
    const probe = governor.run(SWEEP, async () => {
      await gate.promise;
      return reply();
    });
    await clock.advanceBy(0);

    const during = governor.snapshot();
    // The reading that only exists mid-probe: an implementation that flipped
    // straight from open to closed would never show this state at all.
    expect(during.breakerState).toBe('half-open');
    expect(during.queueDepth).toBe(1);
    expect(during.requests - before.requests).toBe(1);

    gate.resolve();
    await settle(clock, probe);

    const after = governor.snapshot();
    expect(after.breakerState).toBe('closed');
    expect(after.queueDepth).toBe(0);
    // A probe that SUCCEEDS closes the breaker; it is not another open.
    expect(after.breakerOpens).toBe(1);
  });

  it('re-opens and counts a SECOND open when the half-open probe fails', async () => {
    // Documented behavior: breakerOpens includes half-open probe failures. A
    // failed probe that only re-entered `open` silently would leave the operator
    // reading one open for an outage that has now flapped twice.
    const { governor, clock } = makeGovernor();
    await openTheBreaker(governor, clock);
    await clock.advanceBy(BREAKER_WINDOW_MS);

    const before = governor.snapshot();
    expect(before.breakerOpens).toBe(1);

    await settle(
      clock,
      governor.run(SWEEP, async () => reply({ status: 403 })),
    );

    const after = governor.snapshot();
    // Both sides against literals: a delta alone would hold at 5 and 6 too.
    expect(after.breakerOpens).toBe(2);
    expect(after.breakerState).toBe('open');
  });
});
