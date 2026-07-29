// The three X-RateLimit-Scope arms of a Discord 429, the FULL retry_after, and the
// Cloudflare ban arm, driven against the virtual clock in tests/helpers/synthetic_clock.ts.
//
// Every wait is asserted as an exact virtual millisecond count, which is the only way the
// incident regression is provable at all: the client this governor replaced clamped
// retry_after to 10 seconds, so a 60 second Discord penalty brought the bot back four times
// too early, every time. vitest fake timers are deliberately NOT used here (a clock captured
// at construction never moves under them, and a fractional delay is allowed to fire EARLY);
// the synthetic clock's own header records both traps.
//
// Fixture values are chosen to differ from every DEFAULT_* the module exports, so no
// assertion below can pass merely because the governor fell back to its own constant. That
// choice is itself pinned by the first test.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BAN_PAUSE_MS,
  DEFAULT_BREAKER_LIMIT,
  DEFAULT_FORBIDDEN_TTL_MS,
  DEFAULT_MAX_RPS,
  type GovernorLogLevel,
  type GovernorResponse,
  MAX_ATTEMPTS,
  MISSING_RETRY_AFTER_MS,
  RateGovernor,
  type RateGovernorOptions,
  type RateLimitScope,
} from '../bot/rate_governor';
import { type SyntheticClock, syntheticClock } from './helpers/synthetic_clock';

/** Distinct from DEFAULT_BAN_PAUSE_MS, from BREAKER_WINDOW_MS, and from every retry_after
 *  fixture in this file, so a ban-pause assertion cannot pass by coincidence. */
const BAN_PAUSE_MS = 777_000;
/** Distinct from DEFAULT_BREAKER_LIMIT, and small enough to reach in one test. */
const BREAKER_LIMIT = 3;
/** Distinct from DEFAULT_MAX_RPS. 1000 rps leaves the send-rate pacer a 1 ms slot spacing,
 *  which is small enough that the pauses under test dominate every recorded schedule. */
const MAX_RPS = 1000;
/** Distinct from DEFAULT_FORBIDDEN_TTL_MS. Nothing here reaches the permanent-failure cache. */
const FORBIDDEN_TTL_MS = 3_600_000;

interface RecordedLog {
  level: GovernorLogLevel;
  message: string;
  fields: Record<string, string | number>;
}

interface GovernorFixture {
  governor: RateGovernor;
  clock: SyntheticClock;
  /** Every sleep the governor asked for, in order, in virtual milliseconds. */
  slept: number[];
  logs: RecordedLog[];
}

function governorFixture(overrides: Partial<RateGovernorOptions> = {}): GovernorFixture {
  const clock = syntheticClock();
  const slept: number[] = [];
  const logs: RecordedLog[] = [];
  const governor = new RateGovernor({
    clock: {
      now: () => clock.now(),
      sleep: (ms: number) => {
        slept.push(ms);
        return clock.sleep(ms);
      },
    },
    maxRps: MAX_RPS,
    banPauseMs: BAN_PAUSE_MS,
    breakerLimit: BREAKER_LIMIT,
    forbiddenTtlMs: FORBIDDEN_TTL_MS,
    log: (level, message, fields) => logs.push({ level, message, fields }),
    ...overrides,
  });
  return { governor, clock, slept, logs };
}

/** One normalized Discord response. `jsonParsed` defaults true, because a body that did NOT
 *  parse is the ban signal and must always be spelled out at the call site. */
function res(
  opts: {
    status?: number;
    headers?: Record<string, string>;
    json?: unknown;
    jsonParsed?: boolean;
    nonJsonBody?: boolean;
  } = {},
): GovernorResponse {
  return {
    status: opts.status ?? 200,
    headers: opts.headers ?? {},
    json: opts.json,
    jsonParsed: opts.jsonParsed ?? true,
    nonJsonBody: opts.nonJsonBody,
  };
}

/** A send callback that answers from a queue and records the VIRTUAL time of every dispatch,
 *  so "was this retried, and how long after" is one array comparison. */
function queuedSend(
  clock: SyntheticClock,
  responses: GovernorResponse[],
): { send: () => Promise<GovernorResponse>; sentAt: number[] } {
  const sentAt: number[] = [];
  const queue = [...responses];
  const send = async (): Promise<GovernorResponse> => {
    sentAt.push(clock.now());
    const next = queue.shift();
    if (next === undefined) throw new Error('queuedSend ran out of queued responses');
    return next;
  };
  return { send, sentAt };
}

describe('rate governor 429 fixtures', () => {
  it('uses configuration values that differ from every governor default', () => {
    // The rule this encodes: a fixture equal to the implementation's own fallback makes the
    // assertion built on it unable to fail, because a governor that ignored the injected
    // option entirely would produce the identical number.
    expect(BAN_PAUSE_MS).not.toBe(DEFAULT_BAN_PAUSE_MS);
    expect(BREAKER_LIMIT).not.toBe(DEFAULT_BREAKER_LIMIT);
    expect(MAX_RPS).not.toBe(DEFAULT_MAX_RPS);
    expect(FORBIDDEN_TTL_MS).not.toBe(DEFAULT_FORBIDDEN_TTL_MS);
    // Both sides against literals, so a default that moved onto a fixture value is caught
    // here rather than silently neutering the tests below.
    expect(DEFAULT_BAN_PAUSE_MS).toBe(600_000);
    expect(DEFAULT_BREAKER_LIMIT).toBe(300);
    expect(DEFAULT_MAX_RPS).toBe(8);
    expect(DEFAULT_FORBIDDEN_TTL_MS).toBe(86_400_000);
  });
});

describe('rate governor retry_after', () => {
  it('waits the FULL 60 second retry_after, never the 10 second clamp (incident regression)', async () => {
    // THE pin for this packet. The client this governor replaced computed
    // Math.min(10_000, retryAfter * 1000), so Discord's 60 second penalty became a 10 second
    // wait and the bot walked straight back into the limit, which is what escalated the
    // 2026-07-29 incident into a Cloudflare ban. 60000 exactly, and not 10000.
    const { governor, clock, slept } = governorFixture();
    const { send, sentAt } = queuedSend(clock, [
      res({ status: 429, json: { retry_after: 60 } }),
      res({ json: { id: 'r1' } }),
    ]);

    const pending = governor.run({ method: 'GET', path: '/guilds/1/roles' }, send);
    await clock.runAll();

    expect((await pending).status).toBe(200);
    expect(slept).toEqual([60_000]);
    expect(slept).not.toContain(10_000);
    // The retry leaves at 60000 on the virtual clock, not merely "after" the first send: an
    // ordering-only assertion would hold for any clamp at all.
    expect(sentAt).toEqual([0, 60_000]);
  });

  it('prefers the JSON body retry_after over a conflicting retry-after header', async () => {
    // Discord sends both. The body is the authoritative one (it carries sub-second
    // precision), and reading the header first would wait 99 seconds for a 4 second penalty.
    const { governor, clock, slept } = governorFixture();
    const { send, sentAt } = queuedSend(clock, [
      res({ status: 429, headers: { 'retry-after': '99' }, json: { retry_after: 4 } }),
      res({}),
    ]);

    const pending = governor.run({ method: 'GET', path: '/guilds/1/roles' }, send);
    await clock.runAll();
    await pending;

    expect(slept).toEqual([4000]);
    expect(slept).not.toContain(99_000);
    expect(sentAt).toEqual([0, 4000]);
  });

  it('falls back to the retry-after HEADER when the JSON body carries no retry_after', async () => {
    // A 429 from the edge of Discord's own stack answers with the header only. Without this
    // arm the wait computes as 0 and the retry goes out immediately, into a live limit.
    const { governor, clock, slept } = governorFixture();
    const { send, sentAt } = queuedSend(clock, [
      res({
        status: 429,
        headers: { 'retry-after': '7' },
        json: { message: 'You are being rate limited.' },
      }),
      res({}),
    ]);

    const pending = governor.run({ method: 'GET', path: '/guilds/1/roles' }, send);
    await clock.runAll();
    await pending;

    expect(slept).toEqual([7000]);
    expect(sentAt).toEqual([0, 7000]);
  });
});

describe('rate governor 429 that names no usable wait', () => {
  it('waits MISSING_RETRY_AFTER_MS when the 429 carries no retry_after anywhere', async () => {
    // The floor had no assertion at all: setting MISSING_RETRY_AFTER_MS to 0 left
    // every suite green while restoring the zero-delay retry loop it exists to
    // prevent. A malformed 429 with no body value and no header must still cost a
    // full second, not the 1 ms the global pacer alone would charge.
    const { governor, clock, slept } = governorFixture();
    const { send, sentAt } = queuedSend(clock, [
      res({ status: 429, json: { message: 'You are being rate limited.' } }),
      res({}),
    ]);

    const pending = governor.run({ method: 'GET', path: '/guilds/1/roles' }, send);
    await clock.runAll();
    await pending;

    expect(MISSING_RETRY_AFTER_MS).toBe(1000);
    expect(slept).toEqual([MISSING_RETRY_AFTER_MS]);
    expect(sentAt).toEqual([0, 1000]);
  });

  it('applies the same floor to a retry_after that is PRESENT but zero', async () => {
    // `retry_after: 0` is not nullish, so it slipped past the absent-value
    // fallback and produced a 0 ms wait. On an interaction route, which is exempt
    // from the global rate cap, that is MAX_ATTEMPTS back-to-back sends into a
    // live limit with nothing pacing them at all.
    const { governor, clock, slept } = governorFixture();
    const { send, sentAt } = queuedSend(clock, [
      res({ status: 429, json: { retry_after: 0 } }),
      res({}),
    ]);

    const pending = governor.run({ method: 'GET', path: '/guilds/1/roles' }, send);
    await clock.runAll();
    await pending;

    expect(slept).toEqual([MISSING_RETRY_AFTER_MS]);
    expect(sentAt).toEqual([0, 1000]);
  });

  it('lets a usable retry-after HEADER win over a body value of zero', async () => {
    // The precedence half of the floor, and a hole the first pass left open. A
    // body value that names no wait must not merely be floored, it must stop
    // counting as an answer at all: treating a present-but-zero body as the
    // authoritative value suppresses a header that DOES name a wait, so a 429
    // carrying `retry_after: 0` beside `retry-after: 30` waited one second and
    // retried into a live thirty second penalty.
    const { governor, clock, slept } = governorFixture();
    const { send, sentAt } = queuedSend(clock, [
      res({ status: 429, headers: { 'retry-after': '30' }, json: { retry_after: 0 } }),
      res({}),
    ]);

    const pending = governor.run({ method: 'GET', path: '/guilds/1/roles' }, send);
    await clock.runAll();
    await pending;

    expect(slept).toEqual([30_000]);
    expect(slept).not.toContain(MISSING_RETRY_AFTER_MS);
    expect(sentAt).toEqual([0, 30_000]);
  });

  it('floors a retry-after HEADER of zero, the last path into the guard', async () => {
    // Once a non-positive BODY value is nulled before the coalesce, a zero header
    // with no body value is the only remaining way to reach the floor guard, so
    // it is the only arm that can still kill a deletion of it. Without this the
    // guard reads as covered while nothing exercises it.
    const { governor, clock, slept } = governorFixture();
    const { send, sentAt } = queuedSend(clock, [
      res({
        status: 429,
        headers: { 'retry-after': '0' },
        json: { message: 'You are being rate limited.' },
      }),
      res({}),
    ]);

    const pending = governor.run({ method: 'GET', path: '/guilds/1/roles' }, send);
    await clock.runAll();
    await pending;

    expect(slept).toEqual([MISSING_RETRY_AFTER_MS]);
    expect(sentAt).toEqual([0, 1000]);
  });

  it('still floors a zero body value when no header names a wait either', async () => {
    // The complement, so the rule above cannot be implemented as "ignore the body
    // whenever it is zero and then give up": with nothing usable anywhere, the
    // one second floor is still what applies.
    const { governor, clock, slept } = governorFixture();
    const { send } = queuedSend(clock, [res({ status: 429, json: { retry_after: 0 } }), res({})]);

    const pending = governor.run({ method: 'GET', path: '/guilds/1/roles' }, send);
    await clock.runAll();
    await pending;

    // The LITERAL, so this case stands on its own rather than leaning on the
    // constant's own pin in a different `it` eighty lines up.
    expect(slept).toEqual([1000]);
  });

  it('floors a NEGATIVE retry_after the same way', async () => {
    // Discord should never send one, but a negative slipping through as a
    // "wait" would be a zero-delay retry by another name.
    const { governor, clock, slept } = governorFixture();
    const { send } = queuedSend(clock, [res({ status: 429, json: { retry_after: -5 } }), res({})]);

    const pending = governor.run({ method: 'GET', path: '/guilds/1/roles' }, send);
    await clock.runAll();
    await pending;

    expect(slept).toEqual([1000]);
  });

  it('still honors a genuine SUB-second retry_after rather than rounding it up to the floor', async () => {
    // The complement, so the floor cannot be implemented as "always wait at least
    // a second": Discord's sub-second penalties are real and waiting 20x longer
    // than asked would stall a sweep for no reason. 0.05 s is 50 ms exactly.
    const { governor, clock, slept } = governorFixture();
    const { send, sentAt } = queuedSend(clock, [
      res({ status: 429, json: { retry_after: 0.05 } }),
      res({}),
    ]);

    const pending = governor.run({ method: 'GET', path: '/guilds/1/roles' }, send);
    await clock.runAll();
    await pending;

    expect(slept).toEqual([50]);
    expect(slept).not.toContain(MISSING_RETRY_AFTER_MS);
    expect(sentAt).toEqual([0, 50]);
  });

  it('rejects a NON-FINITE retry_after instead of pausing until the heat death', async () => {
    // `JSON.parse('{"retry_after":1e999}')` yields Infinity, whose typeof IS
    // 'number', so it passed a bare typeof guard. That set the wait, the bucket
    // reset, and on a global scope `pausedUntil` to Infinity; a sleep of Infinity
    // is clamped by the platform to about a millisecond, so the pause loop spun
    // at a thousand iterations a second and the bot never sent again. The floor
    // applies, exactly as it does to a missing value.
    const { governor, clock, slept } = governorFixture();
    const body = JSON.parse('{"retry_after":1e999}') as { retry_after: number };
    expect(body.retry_after).toBe(Number.POSITIVE_INFINITY);
    expect(typeof body.retry_after).toBe('number');

    const { send, sentAt } = queuedSend(clock, [
      res({ status: 429, headers: { 'x-ratelimit-scope': 'global' }, json: body }),
      res({}),
    ]);

    const pending = governor.run({ method: 'GET', path: '/guilds/1/roles' }, send);
    await clock.runAll();
    await pending;

    // A finite wait, and the retry actually happens. Literals on both sides: an
    // `every(isFinite)` check is vacuously true for an empty sleep list, so it
    // would pass for a governor that never waited at all.
    expect(slept).toEqual([1000]);
    expect(sentAt).toEqual([0, 1000]);
  });

  it('does NOT let a short retry_after shorten a longer window the headers reported', async () => {
    // absorb429 takes the MAX of the window already known and the one this retry
    // implies. Dropping the max lets a 1 second retry_after overwrite a 60 second
    // bucket window, and the next dispatch in that bucket goes out 59 seconds
    // early, into a limit Discord's own headers said was still shut.
    const { governor, clock } = governorFixture({ maxRps: 0 });
    const { send, sentAt } = queuedSend(clock, [
      res({
        status: 429,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '60' },
        json: { retry_after: 1 },
      }),
      res({}),
    ]);

    const pending = governor.run({ method: 'PATCH', path: '/guilds/1/members/2' }, send);
    await clock.runAll();
    await pending;

    // Literals on both sides: the retry waits its own second, then the bucket
    // gate holds it to the 60 second window.
    expect(sentAt).toEqual([0, 60_000]);
  });
});

describe('rate governor pause re-checks', () => {
  it('honors a pause extended TWICE while one request is already asleep on it', async () => {
    // waitForPause is a loop rather than one sleep, because a request already
    // waiting cannot otherwise see a deadline moved out from under it. Two
    // extensions are what make that decisive: `attempt` calls waitForPause TWICE
    // per pass, so a single-sleep implementation still absorbs ONE extension in
    // its second call and a one-extension test cannot tell the two apart.
    //
    // A pause can only be extended by a request that got past the gate BEFORE it
    // was declared, so two are held open by hand and answered at different points
    // of the wait.
    const { governor, clock } = governorFixture({ maxRps: 0 });

    const hold = (path: string) => {
      let release: ((r: GovernorResponse) => void) | null = null;
      let calls = 0;
      const run = governor.run({ method: 'POST', path }, async (): Promise<GovernorResponse> => {
        if (calls++ === 0) {
          return new Promise<GovernorResponse>((resolve) => {
            release = resolve;
          });
        }
        return res({});
      });
      return {
        run,
        answer: (r: GovernorResponse) => (release as unknown as (x: GovernorResponse) => void)(r),
      };
    };
    const globalLimit = (retryAfter: number): GovernorResponse =>
      res({
        status: 429,
        headers: { 'x-ratelimit-scope': 'global' },
        json: { retry_after: retryAfter },
      });

    const first = hold('/channels/2/messages');
    const second = hold('/channels/4/messages');
    await clock.advanceBy(0);

    // A global 429 declares a 10 second pause.
    const opener = queuedSend(clock, [globalLimit(10), res({})]);
    const paused = governor.run({ method: 'GET', path: '/guilds/1/roles' }, opener.send);
    await clock.advanceBy(0);
    expect(opener.sentAt).toEqual([0]);

    // This is the request under test: it goes to sleep on that 10 second deadline.
    const later = queuedSend(clock, [res({})]);
    const waiting = governor.run({ method: 'POST', path: '/channels/3/messages' }, later.send);

    // Extension one, at 5000: the deadline moves from 10000 out to 105000.
    await clock.advanceBy(5000);
    first.answer(globalLimit(100));

    // Extension two, at 50000, by which point the request under test is asleep on
    // the 105000 deadline: it moves again, to 150000.
    await clock.advanceBy(45_000);
    expect(clock.now()).toBe(50_000);
    second.answer(globalLimit(100));

    await clock.runAll();
    await Promise.all([first.run, second.run, paused, waiting]);

    // 150000, the final deadline. A single sleep would have woken at 105000 with
    // no re-read and sent straight into a pause with 45 more seconds to run.
    expect(later.sentAt).toEqual([150_000]);
  });

  it('re-checks the pause AFTER the bucket gate, not only before it', async () => {
    // The second waitForPause. A request parked in the bucket gate last looked at
    // the pause before it was declared, so without the re-check it wakes and
    // sends into a pause the governor had already announced, which is exactly the
    // traffic a pause exists to stop.
    const { governor, clock } = governorFixture({ maxRps: 0 });
    const GATED = '/guilds/1/members/2';

    const opener = queuedSend(clock, [
      res({ headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '10' } }),
    ]);
    const first = governor.run({ method: 'PATCH', path: GATED }, opener.send);
    await clock.advanceBy(0);
    await first;
    expect(opener.sentAt).toEqual([0]);

    // The next write in that bucket parks until 10000.
    const gated = queuedSend(clock, [res({})]);
    const held = governor.run({ method: 'PATCH', path: GATED }, gated.send);

    // A DIFFERENT bucket is then told to stop process-wide for 60 seconds.
    await clock.advanceBy(5000);
    const global429 = queuedSend(clock, [
      res({ status: 429, headers: { 'x-ratelimit-scope': 'global' }, json: { retry_after: 60 } }),
      res({}),
    ]);
    const other = governor.run({ method: 'GET', path: '/guilds/1/roles' }, global429.send);
    await clock.advanceBy(0);
    expect(global429.sentAt).toEqual([5000]);

    await clock.runAll();
    await Promise.all([held, other]);

    // The bucket reopened at 10000; the pause runs to 65000 and wins.
    expect(gated.sentAt).toEqual([65_000]);
  });
});

describe('rate governor 429 scopes', () => {
  it('waits out a user-scope 429, retries it, and DOES count it toward the breaker', async () => {
    // breakerLimit 1 is what makes this decisive: delete the recordInvalid call on the
    // non-shared path and the breaker stays closed, so the state assertion goes red. The
    // 2.5 second retry_after also pins the round-UP, since a 2500 ms wait that became 2000
    // would expire before Discord's window reopens.
    const { governor, clock, slept } = governorFixture({ breakerLimit: 1 });
    const { send, sentAt } = queuedSend(clock, [
      res({ status: 429, headers: { 'x-ratelimit-scope': 'user' }, json: { retry_after: 2.5 } }),
      res({}),
    ]);

    const pending = governor.run({ method: 'GET', path: '/guilds/1/roles' }, send);
    await clock.runAll();
    await pending;

    expect(slept).toEqual([2500]);
    expect(sentAt).toEqual([0, 2500]);
    const snap = governor.snapshot();
    expect(snap.rateLimitedByScope.user).toBe(1);
    expect(snap.breakerState).toBe('open');
    expect(snap.breakerOpens).toBe(1);
  });

  it('pauses PROCESS-WIDE on a global-scope 429, holding a COMPLETELY different bucket', async () => {
    // The cross-bucket arm is the whole point. A same-bucket assertion would pass for a
    // merely per-bucket wait, and a per-bucket wait is exactly what a global 429 must not be:
    // Discord counts every route against one global window while it is in force.
    const { governor, clock, slept } = governorFixture();
    const roles = queuedSend(clock, [
      res({ status: 429, headers: { 'x-ratelimit-scope': 'global' }, json: { retry_after: 30 } }),
      res({}),
    ]);
    const messages = queuedSend(clock, [res({})]);

    const first = governor.run({ method: 'GET', path: '/guilds/1/roles' }, roles.send);
    // Let the global 429 land before the second request exists, so the pause is already in
    // force when a different bucket asks for a slot.
    await clock.advanceBy(0);
    expect(roles.sentAt).toEqual([0]);
    expect(governor.snapshot().globalPauses).toBe(1);

    const second = governor.run({ method: 'POST', path: '/channels/9/messages' }, messages.send);
    await clock.advanceBy(29_999);
    expect(messages.sentAt).toEqual([]);

    await clock.runAll();
    await Promise.all([first, second]);

    expect(roles.sentAt).toEqual([0, 30_000]);
    // 30001, not 30000: both requests come off the pause at 30000, the retry takes that
    // global send-rate slot and the message takes the next one 1 ms behind it (maxRps 1000).
    expect(messages.sentAt).toEqual([30_001]);
    expect(slept).toEqual([30_000, 30_000, 1]);
    expect(governor.snapshot().rateLimitedByScope.global).toBe(1);
  });

  it('retries a shared-scope 429 but never counts it toward the breaker', async () => {
    // Driven to breakerLimit deliberately: a shared 429 is another app's fault on a shared
    // resource, so counting it would let a noisy neighbour trip our circuit breaker. Delete
    // the `scope !== 'shared'` guard and the third request below opens the breaker.
    const { governor, clock } = governorFixture({ breakerLimit: BREAKER_LIMIT });
    expect(BREAKER_LIMIT).toBe(3);

    for (let i = 0; i < BREAKER_LIMIT; i++) {
      const { send, sentAt } = queuedSend(clock, [
        res({ status: 429, headers: { 'x-ratelimit-scope': 'shared' }, json: { retry_after: 1 } }),
        res({}),
      ]);
      const pending = governor.run({ method: 'GET', path: `/guilds/${i + 1}/roles` }, send);
      await clock.runAll();
      await pending;
      // Waited out in full and retried, which is the half of the contract that separates
      // shared from the ban arm below.
      expect(sentAt.length).toBe(2);
      expect(sentAt[1] - sentAt[0]).toBe(1000);
    }

    const afterShared = governor.snapshot();
    expect(afterShared.rateLimitedByScope.shared).toBe(3);
    expect(afterShared.breakerState).toBe('closed');
    expect(afterShared.breakerOpens).toBe(0);

    // Now prove the counter was working all along: the same number of NON-shared 429s over
    // the same window opens it. Without this arm a governor that never counted anything at
    // all would pass the assertions above.
    for (let i = 0; i < BREAKER_LIMIT; i++) {
      const { send } = queuedSend(clock, [
        res({ status: 429, headers: { 'x-ratelimit-scope': 'user' }, json: { retry_after: 1 } }),
        res({}),
      ]);
      const pending = governor.run({ method: 'POST', path: `/channels/${i + 1}/messages` }, send);
      await clock.runAll();
      await pending;
    }

    const afterUser = governor.snapshot();
    expect(afterUser.rateLimitedByScope.user).toBe(3);
    expect(afterUser.rateLimitedByScope.shared).toBe(3);
    expect(afterUser.breakerState).toBe('open');
    expect(afterUser.breakerOpens).toBe(1);
  });
});

describe('rate governor 429 scope logging (D14)', () => {
  // O5 is answered from these log lines after deploy: whether Discord returns `user` or
  // `shared` on member writes decides how much ban-counter exposure the role sweep carries.
  // An unlabelled or unrecognized scope must still log SOMETHING, or the question is
  // unanswerable from production output.
  const SCOPE_ROWS: {
    name: string;
    header: string | undefined;
    scope: RateLimitScope;
    globalFlag: 0 | 1;
  }[] = [
    { name: 'user', header: 'user', scope: 'user', globalFlag: 0 },
    { name: 'global', header: 'global', scope: 'global', globalFlag: 1 },
    { name: 'shared', header: 'shared', scope: 'shared', globalFlag: 0 },
    { name: 'a missing scope header', header: undefined, scope: 'unknown', globalFlag: 0 },
    { name: 'an unrecognized scope value', header: 'nonsense', scope: 'unknown', globalFlag: 0 },
  ];

  for (const row of SCOPE_ROWS) {
    it(`logs scope ${row.scope} and the route for ${row.name}`, async () => {
      const { governor, clock, logs } = governorFixture();
      const headers: Record<string, string> =
        row.header === undefined ? {} : { 'x-ratelimit-scope': row.header };
      const { send } = queuedSend(clock, [
        res({ status: 429, headers, json: { retry_after: 1 } }),
        res({}),
      ]);

      const pending = governor.run({ method: 'GET', path: '/guilds/1/roles' }, send);
      await clock.runAll();
      await pending;

      const limited = logs.filter((l) => l.message === '[bot] discord rate limited');
      expect(limited.length).toBe(1);
      expect(limited[0].level).toBe('warn');
      expect(limited[0].fields.scope).toBe(row.scope);
      // The route is the TEMPLATE, not the raw path: it reaches log lines, so a per-member
      // id in it would both mint a bucket per member and spray ids through the log.
      expect(limited[0].fields.route).toBe('GET /guilds/1/roles');
      expect(limited[0].fields.retryAfterMs).toBe(1000);
      expect(limited[0].fields.global).toBe(row.globalFlag);
      expect(governor.snapshot().rateLimitedByScope[row.scope]).toBe(1);
    });
  }
});

describe('rate governor Cloudflare ban arm', () => {
  it('treats a 429 whose body is NOT JSON as a ban: error log, and NO retry at all', async () => {
    // The other half of the incident. Cloudflare answers with an HTML error page once it
    // starts refusing, and the old client parsed that to {}, defaulted retry_after to 1, and
    // came back a second later into an active ban. A single dispatch and an empty sleep list
    // are what say it did not fall through to a short retry.
    const { governor, clock, slept, logs } = governorFixture();
    const { send, sentAt } = queuedSend(clock, [
      res({ status: 429, headers: { 'retry-after': '1' }, jsonParsed: false, nonJsonBody: true }),
      res({}),
    ]);

    const pending = governor.run({ method: 'GET', path: '/guilds/1/roles' }, send);
    await clock.runAll();

    expect((await pending).status).toBe(429);
    expect(sentAt).toEqual([0]);
    expect(slept).toEqual([]);

    const errors = logs.filter((l) => l.level === 'error');
    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('[bot] discord returned a non-JSON 429, pausing as banned');
    expect(errors[0].fields.pauseMs).toBe(BAN_PAUSE_MS);
    // Named explicitly: the retry-after header on the ban page says 1 second, and honoring it
    // is the exact mistake this arm exists to prevent.
    expect(errors[0].fields.pauseMs).not.toBe(1000);
    expect(governor.snapshot().banPauses).toBe(1);
    // The warn line belongs to a normal Discord 429; a ban is not one.
    expect(logs.filter((l) => l.message === '[bot] discord rate limited').length).toBe(0);
  });

  it('holds every later request for banPauseMs, not for the ban page retry-after', async () => {
    // The pause LENGTH, pinned by observation rather than by the log field alone: a governor
    // that logged banPauseMs but paused for the 1 second retry-after would pass the test
    // above and fail this one.
    const { governor, clock, slept } = governorFixture();
    const banned = queuedSend(clock, [
      res({ status: 429, headers: { 'retry-after': '1' }, jsonParsed: false, nonJsonBody: true }),
    ]);

    const first = governor.run({ method: 'GET', path: '/guilds/1/roles' }, banned.send);
    await clock.runAll();
    await first;
    expect(slept).toEqual([]);

    const later = queuedSend(clock, [res({})]);
    const second = governor.run({ method: 'POST', path: '/channels/9/messages' }, later.send);
    await clock.advanceBy(BAN_PAUSE_MS - 1);
    expect(later.sentAt).toEqual([]);

    await clock.runAll();
    await second;
    expect(later.sentAt).toEqual([777_000]);
    expect(slept).toEqual([777_000]);
  });

  it('retries a 429 whose body read failed or was empty as a NORMAL 429, never a ban', async () => {
    // The shell signals a ban only for a body that was READ, non-empty, and not
    // JSON. A jsonParsed:false 429 WITHOUT that signal is a transient read
    // failure (the call deadline aborting mid-body, a reset after headers) on a
    // genuine Discord 429, so it must wait out the Retry-After header and retry
    // instead of silencing the whole process for banPauseMs.
    const { governor, clock, slept, logs } = governorFixture();
    const { send, sentAt } = queuedSend(clock, [
      res({ status: 429, headers: { 'retry-after': '2' }, jsonParsed: false }),
      res({}),
    ]);

    const pending = governor.run({ method: 'GET', path: '/guilds/1/roles' }, send);
    await clock.runAll();

    expect((await pending).status).toBe(200);
    // Retried after the header's 2 seconds, not swallowed by a 123000 ms ban.
    expect(sentAt).toEqual([0, 2000]);
    expect(slept).toEqual([2000]);
    expect(governor.snapshot().banPauses).toBe(0);
    expect(logs.filter((l) => l.level === 'error').length).toBe(0);
    expect(logs.filter((l) => l.message === '[bot] discord rate limited').length).toBe(1);
  });
});

describe('rate governor attempt bound', () => {
  it('gives up after MAX_ATTEMPTS on a route that answers 429 forever', async () => {
    // Without the bound one poisoned route holds its promise open for as long as Discord
    // keeps saying no, which is unbounded, and the caller's sweep never finishes. The
    // breaker limit is raised out of the way so this test is about the attempt bound only.
    const { governor, clock, slept } = governorFixture({ breakerLimit: 99 });
    // Four queued 429s for a bound of three, so "never reached the fourth" is observable.
    const forever = Array.from({ length: 4 }, () => res({ status: 429, json: { retry_after: 3 } }));
    const { send, sentAt } = queuedSend(clock, forever);

    const pending = governor.run({ method: 'GET', path: '/guilds/1/roles' }, send);
    await clock.runAll();

    // The last 429 is RETURNED, not thrown: the IO shell owns what a non-ok status means.
    expect((await pending).status).toBe(429);
    expect(MAX_ATTEMPTS).toBe(3);
    // Three dispatches, so the fourth queued response is never reached, and only TWO waits:
    // sleeping after the final attempt would hold the promise open before giving up anyway.
    expect(sentAt).toEqual([0, 3000, 6000]);
    expect(slept).toEqual([3000, 3000]);
    const snap = governor.snapshot();
    expect(snap.rateLimited).toBe(3);
    expect(snap.breakerState).toBe('closed');
  });
});
