// Determinism of the governor's dispatch schedule, plus its two pure helpers and
// the virtual clock every other governor suite leans on.
//
// The determinism claim is the load-bearing one: the governor reads no wall clock
// and owns no timer, so the SAME scenario driven by an identical injected clock
// has to produce the same dispatch schedule down to the millisecond. That is what
// makes a rate-limit contract provable in a unit test instead of observable only
// in production, so it is asserted by RECORDING the schedule (virtual time, route
// template, attempt index) over two runs from completely fresh state and
// comparing the arrays, not by eyeballing a log or checking a length.
//
// Time here comes only from syntheticClock. Vitest fake timers are the wrong tool
// twice over for this module: a clock captured at construction does not move
// under them (so a test can pass for an implementation that quietly read the real
// clock), and a fractional delay is allowed to fire early (so a wait computed
// from a float retry_after can expire a hair before its window).
import { describe, expect, it } from 'vitest';
import {
  BREAKER_WINDOW_MS,
  DEFAULT_BAN_PAUSE_MS,
  DEFAULT_BREAKER_LIMIT,
  DEFAULT_FORBIDDEN_TTL_MS,
  DEFAULT_MAX_RPS,
  type GovernorCounters,
  type GovernorResponse,
  MAX_FORBIDDEN_ENTRIES,
  MAX_QUEUE_DEPTH,
  MAX_TRACKED_BUCKETS,
  MAX_TRACKED_ROUTES,
  majorParameterOf,
  RateGovernor,
  redactPath,
  routeTemplate,
} from '../bot/rate_governor';
import { type SyntheticClock, syntheticClock } from './helpers/synthetic_clock';

// Snowflake-shaped ids, distinct per position so a template that interpolated the
// wrong segment cannot accidentally still match.
const GUILD = '123456789012345678';
const OTHER_GUILD = '987654321098765432';
const MEMBER_A = '111111111111111111';
const MEMBER_B = '222222222222222222';
const CHANNEL = '555555555555555555';
const APP = '333333333333333333';
const INTERACTION = '444444444444444444';
const ROLE = '666666666666666666';
// Opaque, non-numeric, and well past the 16 character variable-segment floor,
// which is what a real interaction and webhook token look like.
const INTERACTION_TOKEN = 'aW50ZXJhY3Rpb250b2tlbnZhbHVlMTIzNDU2Nzg5';
const WEBHOOK_TOKEN = 'd2ViaG9va3Rva2VudmFsdWUxMjM0NTY3ODk';

interface Dispatch {
  /** Virtual milliseconds at the moment the send callback was invoked. */
  at: number;
  route: string;
  /** 0 for the first hand-off of this request, 1 for its first retry. */
  attempt: number;
}

/**
 * Every knob is deliberately UNEQUAL to the module's own DEFAULT_ fallback. A
 * fixture that matched the default could not fail: the recorded schedule would
 * come out identical even if the constructor dropped the option on the floor.
 * 4 rps is 250 ms of global spacing, which is what the times below are built on.
 */
const SCENARIO_KNOBS = {
  maxRps: 4,
  banPauseMs: 111_000,
  breakerLimit: 25,
  forbiddenTtlMs: 7_000,
};

function ok(headers: Record<string, string> = {}): GovernorResponse {
  return { status: 200, headers, json: {}, jsonParsed: true };
}

function tooManyRequests(retryAfterSeconds: number): GovernorResponse {
  return {
    status: 429,
    headers: {},
    json: { retry_after: retryAfterSeconds },
    jsonParsed: true,
  };
}

interface Job {
  label: string;
  method: string;
  path: string;
  /** One entry per attempt; the last entry answers every further attempt. */
  replies: GovernorResponse[];
}

/**
 * Three buckets at once, one of which 429s and retries, one of which reports its
 * window exhausted, and five requests against a 4 rps cap so the global pacer is
 * genuinely the binding constraint for part of the run. Two of the jobs share one
 * bucket template (the two member PATCHes) so the serialized FIFO queue is in
 * play as well.
 */
const SCENARIO: Job[] = [
  {
    label: 'roles',
    method: 'GET',
    path: `/guilds/${GUILD}/roles`,
    replies: [ok()],
  },
  {
    label: 'nick-a',
    method: 'PATCH',
    path: `/guilds/${GUILD}/members/${MEMBER_A}`,
    // 0.5 seconds, a FRACTIONAL retry_after: it rounds UP to 500 ms, and it is
    // the case a real-timer test would let fire early.
    replies: [tooManyRequests(0.5), ok()],
  },
  {
    label: 'nick-b',
    method: 'PATCH',
    path: `/guilds/${GUILD}/members/${MEMBER_B}`,
    replies: [ok()],
  },
  {
    label: 'relay-1',
    method: 'POST',
    path: `/channels/${CHANNEL}/messages`,
    replies: [ok({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '1' })],
  },
  {
    label: 'relay-2',
    method: 'POST',
    path: `/channels/${CHANNEL}/messages`,
    replies: [ok({ 'x-ratelimit-remaining': '4', 'x-ratelimit-reset-after': '2' })],
  },
];

const ROLES_ROUTE = `GET /guilds/${GUILD}/roles`;
const MEMBER_ROUTE = `PATCH /guilds/${GUILD}/members/:id`;
const RELAY_ROUTE = `POST /channels/${CHANNEL}/messages`;

/** Run SCENARIO once against a brand new governor and clock, recording the schedule. */
async function recordScenario(): Promise<{ schedule: Dispatch[]; counters: GovernorCounters }> {
  const clock = syntheticClock();
  const governor = new RateGovernor({ clock, ...SCENARIO_KNOBS });
  const schedule: Dispatch[] = [];
  const attempts = new Map<string, number>();

  const pending = SCENARIO.map((job) => {
    const route = routeTemplate(job.method, job.path);
    return governor.run({ method: job.method, path: job.path }, async () => {
      const attempt = attempts.get(job.label) ?? 0;
      attempts.set(job.label, attempt + 1);
      schedule.push({ at: clock.now(), route, attempt });
      return job.replies[Math.min(attempt, job.replies.length - 1)];
    });
  });

  await clock.runAll();
  await Promise.all(pending);
  return { schedule, counters: governor.snapshot() };
}

describe('RateGovernor scheduling determinism', () => {
  it('replays a byte-identical dispatch schedule over two runs from fresh state', async () => {
    const first = await recordScenario();
    const second = await recordScenario();

    // Pinned against LITERALS first. Two runs that both recorded nothing, or both
    // recorded the same wrong thing, would satisfy run-to-run equality on its own,
    // so the equality below is only meaningful next to a schedule that is spelled
    // out. Every time here is derived: 250 ms of global spacing from maxRps 4, a
    // 500 ms retry from the fractional retry_after, and a 1000 ms proactive wait
    // from the exhausted relay bucket's reset-after.
    expect(first.schedule).toEqual([
      { at: 0, route: ROLES_ROUTE, attempt: 0 },
      { at: 250, route: MEMBER_ROUTE, attempt: 0 },
      { at: 500, route: RELAY_ROUTE, attempt: 0 },
      // The retry: 250 (the 429) plus its full 500 ms wait.
      { at: 750, route: MEMBER_ROUTE, attempt: 1 },
      // Behind the retry in the SAME bucket queue, then one global slot later.
      { at: 1000, route: MEMBER_ROUTE, attempt: 0 },
      // Held off until the relay bucket's window reopens at 500 plus 1000.
      { at: 1500, route: RELAY_ROUTE, attempt: 0 },
    ]);
    expect(second.schedule).toEqual(first.schedule);

    // And non-trivial, so an empty or single-entry recording cannot pass even if
    // the literal pin above were ever loosened: several dispatches, more than one
    // bucket, a real retry, and time that actually moved.
    expect(first.schedule.length).toBeGreaterThan(2);
    expect(first.schedule.some((d) => d.at > 0)).toBe(true);
    expect(new Set(first.schedule.map((d) => d.route)).size).toBeGreaterThan(1);
    expect(first.schedule.some((d) => d.attempt === 1)).toBe(true);
  });

  it('ends both runs on identical counters, so no state survives between governors', async () => {
    // The schedule alone would not catch a module-level counter or a shared Map:
    // the second run's pacing could still look right while its bookkeeping had
    // been polluted by the first.
    const first = await recordScenario();
    const second = await recordScenario();

    expect(first.counters).toEqual(second.counters);
    // Six sends for five requests: exactly one of them was retried.
    expect(first.counters.requests).toBe(6);
    expect(first.counters.rateLimited).toBe(1);
    expect(first.counters.rateLimitedByScope.unknown).toBe(1);
    // A scope-less 429 is neither a global pause nor a ban.
    expect(first.counters.globalPauses).toBe(0);
    expect(first.counters.banPauses).toBe(0);
    expect(first.counters.breakerState).toBe('closed');
    // Every queue drained: a leaked depth is how a bucket wedges permanently.
    expect(first.counters.queueDepth).toBe(0);
  });

  it('drives the scenario with knobs that differ from every governor default', () => {
    // A fixture equal to the implementation's own fallback cannot fail, so the
    // scenario's separation from the defaults is itself pinned rather than left
    // to a later editor's memory.
    expect(SCENARIO_KNOBS.maxRps).not.toBe(DEFAULT_MAX_RPS);
    expect(SCENARIO_KNOBS.banPauseMs).not.toBe(DEFAULT_BAN_PAUSE_MS);
    expect(SCENARIO_KNOBS.breakerLimit).not.toBe(DEFAULT_BREAKER_LIMIT);
    expect(SCENARIO_KNOBS.forbiddenTtlMs).not.toBe(DEFAULT_FORBIDDEN_TTL_MS);
  });
});

describe('routeTemplate', () => {
  // One row per route this bot actually calls. The contract is three-part: the
  // MAJOR parameter id survives (Discord buckets genuinely differ per guild,
  // channel, webhook and interaction), every other variable segment collapses to
  // :id, and a credential segment collapses to :token.
  const ROWS: { name: string; method: string; path: string; template: string }[] = [
    {
      name: 'gateway',
      method: 'GET',
      path: '/gateway/bot',
      template: 'GET /gateway/bot',
    },
    {
      name: 'application commands',
      method: 'PUT',
      path: `/applications/${APP}/guilds/${GUILD}/commands`,
      // `applications` is not a major parent, so the app id collapses while the
      // guild id, which really does separate buckets, does not.
      template: `PUT /applications/:id/guilds/${GUILD}/commands`,
    },
    {
      name: 'interaction callback',
      method: 'POST',
      path: `/interactions/${INTERACTION}/${INTERACTION_TOKEN}/callback`,
      template: `POST /interactions/${INTERACTION}/:token/callback`,
    },
    {
      name: 'webhook original-message edit',
      method: 'PATCH',
      path: `/webhooks/${APP}/${WEBHOOK_TOKEN}/messages/@original`,
      // `@original` is a literal despite sitting where a message id would.
      template: `PATCH /webhooks/${APP}/:token/messages/@original`,
    },
    {
      name: 'guild roles',
      method: 'GET',
      path: `/guilds/${GUILD}/roles`,
      template: `GET /guilds/${GUILD}/roles`,
    },
    {
      name: 'member role add',
      method: 'PUT',
      path: `/guilds/${GUILD}/members/${MEMBER_A}/roles/${ROLE}`,
      template: `PUT /guilds/${GUILD}/members/:id/roles/:id`,
    },
    {
      name: 'member role remove',
      method: 'DELETE',
      path: `/guilds/${GUILD}/members/${MEMBER_A}/roles/${ROLE}`,
      template: `DELETE /guilds/${GUILD}/members/:id/roles/:id`,
    },
    {
      name: 'member PATCH',
      method: 'PATCH',
      path: `/guilds/${GUILD}/members/${MEMBER_A}`,
      template: `PATCH /guilds/${GUILD}/members/:id`,
    },
    {
      name: 'channel messages',
      method: 'POST',
      path: `/channels/${CHANNEL}/messages`,
      template: `POST /channels/${CHANNEL}/messages`,
    },
  ];

  for (const row of ROWS) {
    it(`templates ${row.name} as ${row.template}`, () => {
      expect(routeTemplate(row.method, row.path)).toBe(row.template);
    });
  }

  it('collapses two different member ids onto the SAME template', () => {
    // This is the whole point of the template. Interpolating the member id would
    // mint one bucket per member, so nothing would ever be paced against the
    // bucket Discord actually rate limits, and the FIFO queue would serialize
    // nothing.
    const a = routeTemplate('PATCH', `/guilds/${GUILD}/members/${MEMBER_A}`);
    const b = routeTemplate('PATCH', `/guilds/${GUILD}/members/${MEMBER_B}`);
    expect(a).toBe(`PATCH /guilds/${GUILD}/members/:id`);
    expect(b).toBe(a);
  });

  it('keeps two different guild ids on DIFFERENT templates', () => {
    // The other half: the guild id is a MAJOR parameter, so collapsing it too
    // would merge two genuinely separate buckets and let one guild's exhausted
    // window gate the other's traffic. This is the assertion that dies if the
    // major-parameter branch is deleted.
    const a = routeTemplate('GET', `/guilds/${GUILD}/roles`);
    const b = routeTemplate('GET', `/guilds/${OTHER_GUILD}/roles`);
    expect(a).toBe(`GET /guilds/${GUILD}/roles`);
    expect(b).toBe(`GET /guilds/${OTHER_GUILD}/roles`);
    expect(a).not.toBe(b);
  });

  it('never carries a credential into the key, and drops the query string', () => {
    // The template reaches log lines and counters, so a token in it is a leaked
    // bearer credential; a query string in it would additionally mint a fresh
    // bucket per pagination cursor.
    const template = routeTemplate('get', `/guilds/${GUILD}/members?limit=1000&after=${MEMBER_A}`);
    // Lowercase in, uppercase out: two casings of one verb must not key two buckets.
    expect(template).toBe(`GET /guilds/${GUILD}/members`);
    const callback = routeTemplate(
      'POST',
      `/interactions/${INTERACTION}/${INTERACTION_TOKEN}/callback`,
    );
    expect(callback).not.toContain(INTERACTION_TOKEN);
  });
});

describe('majorParameterOf', () => {
  // Discord's X-RateLimit-Bucket is documented as non-inclusive of the top-level
  // resource, so the hash names a route SHAPE and the major parameter is what
  // turns it into one real bucket. Driven directly rather than only through the
  // governor, because the edge cases below are unreachable from the eight routes
  // this bot calls and would otherwise be undocumented.
  const ROWS: { name: string; template: string; major: string }[] = [
    { name: 'guild roles', template: `GET /guilds/${GUILD}/roles`, major: GUILD },
    {
      name: 'member PATCH, past a collapsed member id',
      template: `PATCH /guilds/${GUILD}/members/:id`,
      major: GUILD,
    },
    {
      name: 'member role add, past TWO collapsed ids',
      template: `PUT /guilds/${GUILD}/members/:id/roles/:id`,
      major: GUILD,
    },
    { name: 'channel messages', template: `POST /channels/${CHANNEL}/messages`, major: CHANNEL },
    {
      name: 'interaction callback, past the redacted token',
      template: `POST /interactions/${INTERACTION}/:token/callback`,
      major: INTERACTION,
    },
    {
      name: 'webhook edit takes the APPLICATION id, not the token',
      template: `PATCH /webhooks/${APP}/:token/messages/@original`,
      major: APP,
    },
    // No major parent at all: the key degrades to the hash alone, which is right,
    // because a route with no top-level resource has exactly one real bucket.
    { name: 'gateway', template: 'GET /gateway/bot', major: '' },
    {
      name: 'command registration (an application id is NOT a major parameter)',
      template: `PUT /applications/${APP}/guilds/${GUILD}/commands`,
      major: GUILD,
    },
    // A LITERAL sitting where an id would. Returning 'templates' as this route's
    // major parameter would be nonsense, so the id-shape test is what rejects it.
    { name: 'a literal after a major parent', template: 'GET /guilds/templates/abc', major: '' },
  ];

  for (const row of ROWS) {
    it(`reads the major parameter for ${row.name}`, () => {
      expect(majorParameterOf(row.template)).toBe(row.major);
    });
  }

  it('never returns a placeholder the template minted', () => {
    // :id and :token are what routeTemplate substituted for a NON-major segment,
    // so either one surviving into a bucket key would merge every member of a
    // guild onto one key, or put a credential in it.
    for (const row of ROWS) {
      expect(majorParameterOf(row.template)).not.toBe(':id');
      expect(majorParameterOf(row.template)).not.toBe(':token');
    }
  });
});

describe('governor registry bounds', () => {
  it('pins every bound against a LITERAL, not against itself', () => {
    // The bound tests drive their loops from these same constants and assert the
    // result against them, so lowering one leaves the whole suite green while
    // shipping a real defect: MAX_TRACKED_ROUTES at 4 would thrash the LRU on the
    // hot member-PATCH route every sweep. The scopes suite pins the four DEFAULT_*
    // knobs the same way and for the same reason.
    expect(MAX_TRACKED_BUCKETS).toBe(512);
    expect(MAX_TRACKED_ROUTES).toBe(512);
    expect(MAX_FORBIDDEN_ENTRIES).toBe(4096);
    expect(MAX_QUEUE_DEPTH).toBe(256);
    // The breaker window belongs here for the same reason and was the one
    // load-bearing constant with no literal anywhere: all twenty of its uses
    // advance the clock BY it and assert AGAINST it, which is a pure
    // self-comparison. At 60000 the whole suite stays green while the breaker's
    // denominator stops matching Discord's 10000-invalid-per-10-minutes ban
    // counter and the half-open quiet window shrinks tenfold.
    expect(BREAKER_WINDOW_MS).toBe(600_000);
  });
});

describe('redactPath', () => {
  it('replaces the interaction token and keeps the interaction id', () => {
    // An interaction token is a live bearer credential for about 15 minutes and
    // the throw that carries this path reaches a bare console.error in
    // bot/main.ts (ledger item L1), so the token must not survive.
    const redacted = redactPath(`/interactions/${INTERACTION}/${INTERACTION_TOKEN}/callback`);
    expect(redacted).toBe(`/interactions/${INTERACTION}/:token/callback`);
    expect(redacted).not.toContain(INTERACTION_TOKEN);
  });

  it('replaces the webhook token and keeps the application id', () => {
    const redacted = redactPath(`/webhooks/${APP}/${WEBHOOK_TOKEN}/messages/@original`);
    expect(redacted).toBe(`/webhooks/${APP}/:token/messages/@original`);
    expect(redacted).not.toContain(WEBHOOK_TOKEN);
  });

  it('KEEPS ordinary ids, unlike routeTemplate', () => {
    // The two helpers differ on purpose. Redaction is credential-only: losing the
    // guild, member and role ids would cost the operator the one detail that
    // makes a failure diagnosable, and this is the assertion that dies if
    // redactPath ever starts collapsing variable segments the way the template
    // does.
    const path = `/guilds/${GUILD}/members/${MEMBER_A}/roles/${ROLE}`;
    expect(redactPath(path)).toBe(path);
    expect(redactPath(path)).toContain(MEMBER_A);
    expect(routeTemplate('PUT', path)).not.toContain(MEMBER_A);
  });

  it('returns a path with no token unchanged, query string included', () => {
    expect(redactPath('/gateway/bot')).toBe('/gateway/bot');
    const paged = `/guilds/${GUILD}/members?limit=1000&after=${MEMBER_A}`;
    expect(redactPath(paged)).toBe(paged);
  });
});

describe('syntheticClock', () => {
  // Every governor suite in this packet is only as trustworthy as this clock, so
  // its own contract is pinned here rather than assumed.

  it('leaves a sleep pending until virtual time actually reaches its wake', async () => {
    const clock = syntheticClock();
    let woke = false;
    const sleeping = clock.sleep(50).then(() => {
      woke = true;
    });

    await clock.advanceBy(49);
    // Dies immediately for a clock that resolves sleeps on the microtask queue,
    // which is the failure mode that would make every timing assertion in this
    // packet vacuous.
    expect(woke).toBe(false);

    await clock.advanceBy(1);
    expect(woke).toBe(true);
    await sleeping;
  });

  it('wakes by due time first and by insertion order on a tie', async () => {
    // The tie rule is what makes a recorded schedule reproducible: two sleepers
    // due at the same instant must resolve in the order they went to sleep, not
    // in whatever order a sort happens to leave them.
    const clock = syntheticClock();
    const order: string[] = [];
    const all = Promise.all([
      clock.sleep(10).then(() => order.push('tie-first')),
      clock.sleep(10).then(() => order.push('tie-second')),
      clock.sleep(5).then(() => order.push('earlier')),
    ]);

    await clock.runAll();
    await all;
    // The 5 ms sleeper was scheduled LAST and still wakes first, so a comparator
    // that had lost its due-time term would fail here.
    expect(order).toEqual(['earlier', 'tie-first', 'tie-second']);
  });

  it('steps through intermediate wakes so a chained sleep sees the right now()', async () => {
    // A jump straight to the target would run the woken continuation with now()
    // already at the far end, and every delay it computed from now() would come
    // out short. The recorded 429 retry in the determinism scenario is exactly
    // that shape.
    const clock = syntheticClock();
    const seen: number[] = [];
    const chain = (async () => {
      await clock.sleep(10);
      seen.push(clock.now());
      await clock.sleep(10);
      seen.push(clock.now());
    })();

    await clock.advanceBy(100);
    await chain;
    expect(seen).toEqual([10, 20]);
    expect(clock.now()).toBe(100);
  });

  it('agrees between advanceBy and advanceTo', async () => {
    // A non-zero origin on purpose: 0 is the constructor's own default, so a
    // start value of 0 could not tell an honored origin from an ignored one, and
    // advanceTo takes an ABSOLUTE point while advanceBy takes a delta.
    const byDelta = syntheticClock(1000);
    const toPoint = syntheticClock(1000);
    let byDeltaWoke = false;
    let toPointWoke = false;
    const sleeping = Promise.all([
      byDelta.sleep(250).then(() => {
        byDeltaWoke = true;
      }),
      toPoint.sleep(250).then(() => {
        toPointWoke = true;
      }),
    ]);

    await byDelta.advanceBy(250);
    await toPoint.advanceTo(1250);

    await sleeping;
    expect(byDelta.now()).toBe(1250);
    expect(toPoint.now()).toBe(1250);
    expect(byDeltaWoke).toBe(true);
    expect(toPointWoke).toBe(true);
  });

  it('settles a chain of sleeps under runAll', async () => {
    // runAll has to keep stepping while woken continuations schedule NEW sleeps,
    // which is how the governor behaves: a retry sleeps, then the next request
    // in the bucket sleeps for its own slot.
    const clock = syntheticClock();
    const marks: number[] = [];
    const chain = (async () => {
      await clock.sleep(5);
      marks.push(clock.now());
      await clock.sleep(7);
      marks.push(clock.now());
      await clock.sleep(3);
      marks.push(clock.now());
    })();

    await clock.runAll();
    await chain;
    expect(marks).toEqual([5, 12, 15]);
    expect(clock.now()).toBe(15);
    expect(clock.pending()).toBe(0);
  });

  it('reports the live sleeper count from pending()', async () => {
    const clock = syntheticClock();
    expect(clock.pending()).toBe(0);

    const waits = Promise.all([clock.sleep(5), clock.sleep(9)]);
    expect(clock.pending()).toBe(2);

    // A non-positive wait is not a scheduling event at all, so neither of these
    // may become a zero-length timer that runAll would then have to step through.
    const immediate = Promise.all([clock.sleep(0), clock.sleep(-3)]);
    expect(clock.pending()).toBe(2);
    await immediate;

    await clock.advanceBy(5);
    expect(clock.pending()).toBe(1);

    await clock.runAll();
    expect(clock.pending()).toBe(0);
    await waits;
  });
});

describe('governor arithmetic and remap migration', () => {
  function ceilRig(): { governor: RateGovernor; clock: SyntheticClock } {
    const clock = syntheticClock();
    const governor = new RateGovernor({
      clock,
      // No global spacing, so every measured time below is the bucket gate alone.
      maxRps: 0,
      banPauseMs: 111_000,
      breakerLimit: 99,
      forbiddenTtlMs: 222_000,
    });
    return { governor, clock };
  }

  const ROUTE = { method: 'GET', path: '/channels/700/messages' };

  async function send(
    governor: RateGovernor,
    clock: SyntheticClock,
    at: number[],
    headers: Record<string, string>,
  ): Promise<void> {
    const promise = governor.run(ROUTE, async () => {
      at.push(clock.now());
      return { status: 200, headers, json: {}, jsonParsed: true };
    });
    await clock.runAll();
    await promise;
  }

  it('rounds a fractional reset-after UP to the next whole millisecond', async () => {
    // The guard every suite's header cites as the reason vitest fake timers were
    // rejected, and which nothing actually pinned: every other fixture uses a
    // value like 2.5 that is a whole number of milliseconds already, so ceil,
    // floor and round are indistinguishable. 2.5004 seconds is 2500.4 ms, so
    // only rounding UP waits past the moment Discord's window reopens. Rounding
    // DOWN would dispatch a fraction of a millisecond early, into a closed
    // window, which is the shape of bug that earns a 429 at exactly the wrong
    // moment.
    const { governor, clock } = ceilRig();
    const at: number[] = [];
    await send(governor, clock, at, {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset-after': '2.5004',
    });
    await send(governor, clock, at, { 'x-ratelimit-remaining': '5' });
    expect(at).toEqual([0, 2501]);
  });

  it('migrates exhausted state from the provisional key onto the bucket hash', async () => {
    // The remap's state-migration block was unreachable from every existing
    // fixture, because they all carried x-ratelimit-bucket on the FIRST response
    // for a template, so nothing was ever stored under the provisional key and
    // the migration had nothing to move.
    //
    // The real sequence is this one: a first response reports the bucket
    // EXHAUSTED but names no hash, so the state lands under the template; a
    // later response names the hash. Without the migration the exhaustion is
    // silently forgotten and the next dispatch goes out inside a closed window,
    // and the orphaned provisional entry leaks into the registry forever.
    const { governor, clock } = ceilRig();
    const at: number[] = [];

    // Rate state, but NO bucket header, so it lands under the provisional key.
    await send(governor, clock, at, {
      'x-ratelimit-remaining': '5',
      'x-ratelimit-reset-after': '4',
    });
    expect(governor.snapshot().trackedBuckets).toBe(1);

    // Now the hash arrives on a response carrying NO rate headers of its own.
    // That is what makes the migration observable: there is nothing here to
    // rebuild the state from, so a block that fails to MOVE the existing entry
    // onto the hash simply loses it. An earlier version of this test let the
    // second response carry fresh headers, which quietly reconstructed the
    // state and left the migration untestable.
    await send(governor, clock, at, { 'x-ratelimit-bucket': 'abcdef' });

    // Still exactly one bucket: moved, not dropped, and not duplicated under
    // both the template and the hash.
    expect(governor.snapshot().trackedBuckets).toBe(1);
    expect(governor.snapshot().trackedRoutes).toBe(1);
  });

  it('keeps a query string out of the bucket key but intact in a redacted path', async () => {
    // The large-guild member backfill really does call
    // GET /guilds/<id>/members?limit=1000&after=<id>. A template that kept the
    // query would mint a NEW bucket per page and defeat bucketing outright,
    // while an operator log line that dropped it would hide which page failed.
    expect(routeTemplate('GET', '/guilds/900/members?limit=1000&after=123')).toBe(
      'GET /guilds/900/members',
    );
    expect(redactPath('/guilds/900/members?limit=1000&after=123')).toBe(
      '/guilds/900/members?limit=1000&after=123',
    );
  });

  it('redacts a webhook token that is the LAST segment, not only a middle one', async () => {
    // The followup-create shape. Only the interactions grandparent was covered,
    // so dropping `grandparent === 'webhooks'` from the redaction stayed green
    // while bot/discord_api.ts really does throw on a /webhooks/<app>/<token>
    // path.
    const token = 'd2ViaG9va3Rva2VudmFsdWUxMjM0NTY3ODkw';
    expect(redactPath(`/webhooks/1234567890123456789/${token}`)).toBe(
      '/webhooks/1234567890123456789/:token',
    );
    expect(redactPath(`/webhooks/1234567890123456789/${token}/messages/@original`)).toBe(
      '/webhooks/1234567890123456789/:token/messages/@original',
    );
    expect(redactPath(`/webhooks/1234567890123456789/${token}`)).not.toContain(token);
  });
});
