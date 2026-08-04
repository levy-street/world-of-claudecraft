// Header-driven pacing and bucket identity in the rate governor: the half of the
// contract that is about WHEN a request goes out and which limit state answers for
// it. Every case below drives the governor with the virtual clock from
// tests/helpers/synthetic_clock.ts and asserts the ABSOLUTE virtual time at which
// each send actually ran, because "it waited" is only meaningful against a number:
// a test that asserted call counts alone would pass for a governor that dispatched
// everything immediately.
//
// Vitest fake timers are deliberately not used here (see the synthetic clock's own
// header): a captured clock does not move under them, and a fractional retry delay
// is allowed to fire early, so both of the things these tests exist to pin would be
// unobservable.
import { describe, expect, it } from 'vitest';
import {
  GovernorBlockedError,
  type GovernorResponse,
  MAX_QUEUE_DEPTH,
  MAX_TRACKED_QUEUES,
  RateGovernor,
  redactPath,
  routeTemplate,
} from '../bot/rate_governor';
import { type SyntheticClock, syntheticClock } from './helpers/synthetic_clock';

/** A live interaction token: long, opaque, and a bearer credential for 15 minutes. */
const INTERACTION_TOKEN = 'aW50ZXJhY3Rpb250b2tlbnZhbHVlMTIzNDU2Nzg5';

/**
 * A governor on a fully virtual clock. `maxRps` is explicit at every call site
 * because each expected dispatch time below is spelled in terms of the spacing it
 * implies, `Math.ceil(1000 / maxRps)` ms. The other three knobs are set to values
 * that are deliberately NOT the exported DEFAULT_* constants, so nothing here can
 * pass by accidentally agreeing with a fallback the governor supplies itself.
 */
function makeGovernor(maxRps: number): { governor: RateGovernor; clock: SyntheticClock } {
  const clock = syntheticClock();
  const governor = new RateGovernor({
    clock,
    maxRps,
    banPauseMs: 123_000,
    breakerLimit: 77,
    forbiddenTtlMs: 456_000,
  });
  return { governor, clock };
}

/** A plain 200 carrying whatever rate headers the case is about. Keys are lowercase. */
function reply(headers: Record<string, string> = {}): GovernorResponse {
  return { status: 200, headers, json: {}, jsonParsed: true };
}

/** A well-formed Discord 429 whose retry_after is spelled in SECONDS. */
function res429(headers: Record<string, string>, retryAfterSeconds: number): GovernorResponse {
  return { status: 429, headers, json: { retry_after: retryAfterSeconds }, jsonParsed: true };
}

/** An interaction-callback path for a distinct id, built by CONCATENATION. */
function interactionPath(index: number): string {
  // Never `1000000000000000000 + index`: that is past Number.MAX_SAFE_INTEGER, so
  // a loop collapses onto a handful of values and the population these tests exist
  // to grow never actually grows.
  return `/interactions/17${String(index).padStart(17, '0')}/${INTERACTION_TOKEN}/callback`;
}

describe('RateGovernor header-driven bucket gating', () => {
  it('gates the NEXT dispatch in a bucket until the reported reset has elapsed', async () => {
    // Proactive gating (D2): a bucket whose last response reported Remaining 0
    // stops BEFORE Discord has to answer 429 at all. 2.5 s of reset-after is
    // 2500 ms exactly, so the second send lands at 2500 on the virtual clock, not
    // at the 1 ms the global cap alone would have cost it.
    const { governor, clock } = makeGovernor(1000);
    const sentAt: number[] = [];
    const path = '/guilds/99887766554433221/members/11223344556677889';
    const headers = [
      {
        'x-ratelimit-bucket': 'bucket-alpha',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset-after': '2.5',
      },
      {
        'x-ratelimit-bucket': 'bucket-alpha',
        'x-ratelimit-remaining': '4',
        'x-ratelimit-reset-after': '2.5',
      },
    ];
    const send = async (): Promise<GovernorResponse> => {
      sentAt.push(clock.now());
      return reply(headers[sentAt.length - 1]);
    };

    const calls = [
      governor.run({ method: 'PATCH', path }, send),
      governor.run({ method: 'PATCH', path }, send),
    ];
    await clock.runAll();
    await Promise.all(calls);

    // Both sides are literals, not a relation: asserting only that the second is
    // later than the first would hold for any wait at all, including a 1 ms one.
    expect(sentAt).toEqual([0, 2500]);
  });

  it('does NOT delay the next dispatch while the bucket still reports headroom', async () => {
    // The complement of the gate above, and the reason it is safe to ship. A 90 s
    // reset window with 3 requests still in it must cost nothing: if the
    // `remaining > 0` arm of the gate were dropped, the second send would land at
    // 90000 rather than at the global cap's own 1 ms.
    const { governor, clock } = makeGovernor(1000);
    const sentAt: number[] = [];
    const path = '/guilds/99887766554433221/members/11223344556677889';
    const send = async (): Promise<GovernorResponse> => {
      sentAt.push(clock.now());
      return reply({
        'x-ratelimit-bucket': 'bucket-beta',
        'x-ratelimit-remaining': '3',
        'x-ratelimit-reset-after': '90',
      });
    };

    const calls = [
      governor.run({ method: 'PATCH', path }, send),
      governor.run({ method: 'PATCH', path }, send),
    ];
    await clock.runAll();
    await Promise.all(calls);

    expect(sentAt).toEqual([0, 1]);
  });

  it('does not gate on Remaining 0 when no reset-after says when the window reopens', async () => {
    // Without the null-reset guard the delay computes to NaN, which is neither
    // positive nor non-positive: the governor would spin on a zero-length sleep
    // forever and this request would never be sent. The gate needs a deadline to
    // wait for, and absent one the only safe move is to dispatch.
    const { governor, clock } = makeGovernor(1000);
    const sentAt: number[] = [];
    const path = '/channels/22334455667788990/messages';
    const send = async (): Promise<GovernorResponse> => {
      sentAt.push(clock.now());
      return reply({ 'x-ratelimit-remaining': '0' });
    };

    const calls = [
      governor.run({ method: 'POST', path }, send),
      governor.run({ method: 'POST', path }, send),
    ];
    await clock.runAll();
    await Promise.all(calls);

    expect(sentAt).toEqual([0, 1]);
  });
});

describe('RateGovernor per-bucket serialization', () => {
  it('serializes two calls in one bucket: the second send starts after the first ENDS', async () => {
    // Discord's per-bucket limit is only knowable from the previous response's
    // headers, so overlapping two sends in one bucket spends the window blind.
    // Start and end are both recorded because a call-count assertion, or even a
    // start-time one, cannot tell a FIFO queue from two sends racing.
    // The replies carry no rate headers on purpose: nothing here may be explained
    // by proactive gating, only by the queue.
    const { governor, clock } = makeGovernor(1000);
    const order: string[] = [];
    const send = (label: string) => async (): Promise<GovernorResponse> => {
      order.push(`${label}:start@${clock.now()}`);
      await clock.sleep(500);
      order.push(`${label}:end@${clock.now()}`);
      return reply();
    };

    // Two different members of one guild: the route template collapses the member
    // id, so both are one provisional bucket key and therefore one queue.
    const calls = [
      governor.run(
        { method: 'PATCH', path: '/guilds/99887766554433221/members/11223344556677889' },
        send('a'),
      ),
      governor.run(
        { method: 'PATCH', path: '/guilds/99887766554433221/members/44556677889900112' },
        send('b'),
      ),
    ];
    await clock.runAll();
    await Promise.all(calls);

    expect(order).toEqual(['a:start@0', 'a:end@500', 'b:start@500', 'b:end@1000']);
  });

  it('does NOT serialize two calls in different buckets', async () => {
    // The other arm, and the one that keeps the serialization above from being a
    // global lock: a slow member PATCH in one guild must not hold up another
    // guild's. Interleaved start/end is the proof, and both starts are pinned to
    // literals (1 ms apart, which is the global cap at maxRps 1000, not the queue).
    const { governor, clock } = makeGovernor(1000);
    const order: string[] = [];
    const send = (label: string) => async (): Promise<GovernorResponse> => {
      order.push(`${label}:start@${clock.now()}`);
      await clock.sleep(500);
      order.push(`${label}:end@${clock.now()}`);
      return reply();
    };

    const calls = [
      governor.run(
        { method: 'PATCH', path: '/guilds/99887766554433221/members/11223344556677889' },
        send('a'),
      ),
      governor.run(
        { method: 'PATCH', path: '/guilds/55667788990011223/members/11223344556677889' },
        send('b'),
      ),
    ];
    await clock.runAll();
    await Promise.all(calls);

    expect(order).toEqual(['a:start@0', 'b:start@1', 'a:end@500', 'b:end@501']);
  });
});

describe('RateGovernor global send-rate cap', () => {
  it('spaces queued requests across DIFFERENT buckets by the configured cap', async () => {
    // Per-bucket gating cannot bound the process: four buckets with headroom would
    // all fire at once and the global 50/s ceiling is what Discord bans on. maxRps
    // 4 is 250 ms of spacing (and is deliberately not DEFAULT_MAX_RPS, which the
    // governor would otherwise be free to be using instead of the value passed in).
    const { governor, clock } = makeGovernor(4);
    const sentAt: number[] = [];
    const send = async (): Promise<GovernorResponse> => {
      sentAt.push(clock.now());
      return reply();
    };

    const calls = [
      governor.run({ method: 'POST', path: '/channels/11111111111111111/messages' }, send),
      governor.run({ method: 'POST', path: '/channels/22222222222222222/messages' }, send),
      governor.run({ method: 'POST', path: '/channels/33333333333333333/messages' }, send),
      governor.run({ method: 'POST', path: '/channels/44444444444444444/messages' }, send),
    ];
    await clock.runAll();
    await Promise.all(calls);

    expect(sentAt).toEqual([0, 250, 500, 750]);
  });

  it('exempts interaction callbacks from the cap while everything else still pays it', async () => {
    // Interaction callbacks are exempt from Discord's GLOBAL limit by documented
    // contract and carry a hard 3 second deadline, so pacing them behind a
    // saturated role sweep is how a slash command times out. Both arms run against
    // ONE governor: the interaction sends must neither wait for a slot nor CONSUME
    // one, which is why the three message posts still land on 0, 500, 1000.
    const { governor, clock } = makeGovernor(2);
    const dispatched: { label: string; at: number }[] = [];
    const send = (label: string) => async (): Promise<GovernorResponse> => {
      dispatched.push({ label, at: clock.now() });
      return reply();
    };

    const calls = [
      governor.run(
        { method: 'POST', path: `/interactions/11111111111111111/${INTERACTION_TOKEN}/callback` },
        send('i1'),
      ),
      governor.run({ method: 'POST', path: '/channels/22222222222222222/messages' }, send('m1')),
      governor.run(
        { method: 'POST', path: `/interactions/33333333333333333/${INTERACTION_TOKEN}/callback` },
        send('i2'),
      ),
      governor.run({ method: 'POST', path: '/channels/44444444444444444/messages' }, send('m2')),
      governor.run(
        { method: 'POST', path: `/interactions/55555555555555555/${INTERACTION_TOKEN}/callback` },
        send('i3'),
      ),
      governor.run({ method: 'POST', path: '/channels/66666666666666666/messages' }, send('m3')),
    ];
    await clock.runAll();
    await Promise.all(calls);

    const at = (prefix: string) =>
      dispatched.filter((d) => d.label.startsWith(prefix)).map((d) => d.at);
    expect(at('i')).toEqual([0, 0, 0]);
    expect(at('m')).toEqual([0, 500, 1000]);
  });
});

describe('RateGovernor interaction-callback exemption boundary', () => {
  it('exempts ONLY the /callback suffix, not every POST under /interactions/', async () => {
    // The suffix half of the test had no arm at all: every interaction fixture in
    // every suite ends in /callback, so deleting `endsWith('/callback')` left the
    // whole suite green while handing a blanket global-rate exemption to any
    // future POST under /interactions/. The exemption is grounded in the callback
    // endpoint's hard 3 second deadline, which nothing else under that prefix has.
    const { governor, clock } = makeGovernor(2);
    const dispatched: { label: string; at: number }[] = [];
    const send = (label: string) => async (): Promise<GovernorResponse> => {
      dispatched.push({ label, at: clock.now() });
      return reply();
    };

    const calls = [
      // Exempt: neither waits for a slot nor consumes one.
      governor.run(
        { method: 'POST', path: `/interactions/11111111111111111/${INTERACTION_TOKEN}/callback` },
        send('callback'),
      ),
      // NOT exempt: same prefix, no /callback suffix. It takes the first slot.
      governor.run(
        { method: 'POST', path: `/interactions/22222222222222222/${INTERACTION_TOKEN}` },
        send('not-callback'),
      ),
      // So this one pays the full 500 ms spacing behind it. Drop the suffix test
      // and the middle request is exempt too, leaving this at 0.
      governor.run(
        { method: 'POST', path: '/channels/33333333333333333/messages' },
        send('message'),
      ),
    ];
    await clock.runAll();
    await Promise.all(calls);

    const at = (label: string) => dispatched.find((d) => d.label === label)?.at;
    expect(at('callback')).toBe(0);
    expect(at('not-callback')).toBe(0);
    expect(at('message')).toBe(500);
  });
});

describe('RateGovernor interaction callbacks still pay every OTHER ceiling', () => {
  // The exemption's own comment promises this in as many words: "Everything else
  // still applies: their own bucket gating, and every pause, because a pause
  // means Discord has told us to stop entirely." Only the rate-cap half was
  // exercised, so deleting the pause and bucket gates FOR THIS TEMPLATE stayed
  // green, on the one path with no other ceiling left.
  it('honors a process-wide pause even though it skips the rate cap', async () => {
    const { governor, clock } = makeGovernor(1000);
    const sent: { label: string; at: number }[] = [];
    const send = (label: string, response: GovernorResponse) => async () => {
      sent.push({ label, at: clock.now() });
      return response;
    };

    // An unrelated route takes a global 429 and pauses everything for 30 s.
    const pauser = [res429({ 'x-ratelimit-scope': 'global' }, 30), reply()];
    const paused = governor.run({ method: 'GET', path: '/guilds/1/roles' }, async () => {
      sent.push({ label: 'pauser', at: clock.now() });
      return pauser.shift() as GovernorResponse;
    });
    await clock.advanceBy(0);
    expect(sent.map((s) => s.at)).toEqual([0]);

    const callback = governor.run(
      { method: 'POST', path: `/interactions/11111111111111111/${INTERACTION_TOKEN}/callback` },
      send('callback', reply()),
    );
    await clock.runAll();
    await Promise.all([paused, callback]);

    // 30000, not 0. Exempt from the rate cap is not exempt from a pause.
    expect(sent.find((s) => s.label === 'callback')?.at).toBe(30_000);
  });

  it('honors its OWN bucket gate even though it skips the rate cap', async () => {
    // Interaction ids are major parameters, so each callback is its own bucket
    // and normally cannot gate another. Driving the SAME interaction id twice is
    // what makes the gate observable at all on this route.
    const { governor, clock } = makeGovernor(1000);
    const path = `/interactions/22222222222222222/${INTERACTION_TOKEN}/callback`;
    const sentAt: number[] = [];
    const headers = [
      { 'x-ratelimit-bucket': 'cb', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '5' },
      { 'x-ratelimit-bucket': 'cb', 'x-ratelimit-remaining': '3', 'x-ratelimit-reset-after': '5' },
    ];
    const send = async (): Promise<GovernorResponse> => {
      sentAt.push(clock.now());
      return reply(headers[sentAt.length - 1]);
    };

    const calls = [
      governor.run({ method: 'POST', path }, send),
      governor.run({ method: 'POST', path }, send),
    ];
    await clock.runAll();
    await Promise.all(calls);

    // 5000, not the 0 the rate-cap exemption alone would allow.
    expect(sentAt).toEqual([0, 5000]);
  });
});

describe('RateGovernor bucket identity across major parameters', () => {
  it('does NOT merge two major parameters that report the SAME bucket hash', async () => {
    // REGRESSION, and the worst defect the Phase 2 QA round found. Discord
    // documents X-RateLimit-Bucket as non-inclusive of the top-level (major)
    // resource, so the hash names a route SHAPE: two channels posted to on the
    // same route answer with the SAME hash while holding genuinely separate
    // limits. Keying rate state on the bare hash merged them into one LimitState,
    // and the bot posts to up to four distinct channel ids through one
    // createMessage route, so this was live traffic and not a corner case.
    //
    // The failure is the one D2 exists to prevent: channel B reporting headroom
    // overwrote channel A's exhausted window, and A's next post dispatched at
    // Remaining 0. It also over-throttled in the other direction, letting one
    // channel's spent window gate every other channel.
    const { governor, clock } = makeGovernor(1000);
    const sent: { label: string; at: number }[] = [];
    const HASH = 'one-route-shape';
    const send = (label: string, headers: Record<string, string>) => async () => {
      sent.push({ label, at: clock.now() });
      return reply(headers);
    };

    // Channel A reports its bucket exhausted for 10 seconds.
    const a1 = governor.run(
      { method: 'POST', path: '/channels/11111111111111111/messages' },
      send('A1', {
        'x-ratelimit-bucket': HASH,
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset-after': '10',
      }),
    );
    await clock.runAll();
    await a1;

    // Channel B is a DIFFERENT bucket instance and says it has headroom.
    const b1 = governor.run(
      { method: 'POST', path: '/channels/22222222222222222/messages' },
      send('B1', {
        'x-ratelimit-bucket': HASH,
        'x-ratelimit-remaining': '5',
        'x-ratelimit-reset-after': '10',
      }),
    );
    await clock.runAll();
    await b1;

    // Two real buckets, counted as two.
    expect(governor.snapshot().trackedBuckets).toBe(2);

    // Channel A's own window is still shut, so its next post waits it out. Under
    // the merged key this went out at 2 ms instead, dispatching at Remaining 0.
    const a2 = governor.run(
      { method: 'POST', path: '/channels/11111111111111111/messages' },
      send('A2', { 'x-ratelimit-bucket': HASH, 'x-ratelimit-remaining': '4' }),
    );
    await clock.runAll();
    await a2;

    expect(sent.map((s) => s.label)).toEqual(['A1', 'B1', 'A2']);
    expect(sent.map((s) => s.at)).toEqual([0, 1, 10_000]);
  });

  it('re-checks the bucket gate AFTER the rate slot, not only before it', async () => {
    // The gate symmetry. A request checks the bucket, then sleeps out its global
    // rate slot, and another template sharing that bucket can exhaust it during
    // exactly that sleep. The pause has always been re-read afterwards for this
    // reason; the bucket had the identical argument and no re-read, so it sent
    // into a window it had already been told was shut.
    const { governor, clock } = makeGovernor(1);
    const HASH = 'shared-by-two-templates';
    const ROLES = '/guilds/1/roles';
    const MEMBER = '/guilds/1/members/2';
    const headers = (remaining: string) => ({
      'x-ratelimit-bucket': HASH,
      'x-ratelimit-remaining': remaining,
      'x-ratelimit-reset-after': '100',
    });
    const record: { label: string; at: number }[] = [];
    const send = (label: string, remaining: string) => async () => {
      record.push({ label, at: clock.now() });
      return reply(headers(remaining));
    };

    // Both templates learn the same bucket (same guild, so the same major
    // parameter), with headroom to spare.
    const seedA = governor.run({ method: 'GET', path: ROLES }, send('seed-roles', '5'));
    await clock.runAll();
    await seedA;
    const seedB = governor.run({ method: 'PATCH', path: MEMBER }, send('seed-member', '5'));
    await clock.runAll();
    await seedB;
    expect(governor.snapshot().trackedBuckets).toBe(1);

    // Now two requests in flight at once, in DIFFERENT queues so they do not
    // serialize. At 1 rps their slots are a second apart, and the first one
    // reports the bucket spent while the second is still asleep on its slot.
    const exhaust = governor.run({ method: 'GET', path: ROLES }, send('exhaust', '0'));
    const victim = governor.run({ method: 'PATCH', path: MEMBER }, send('victim', '5'));
    await clock.runAll();
    await Promise.all([exhaust, victim]);

    const at = (label: string) => record.find((r) => r.label === label)?.at;
    // The exhausting call takes the earlier slot and shuts the bucket for 100 s
    // from there. The victim's slot came up one second later, and it must wait
    // the window out rather than spend it: without the re-check it went at 3000.
    expect(at('exhaust')).toBe(2000);
    expect(at('victim')).toBe(102_000);
  });

  it('honors a pause declared while a request sleeps in the bucket gate', async () => {
    // The other half of the gate loop, and a regression this QA round introduced
    // before catching it: adding a bucket re-check AFTER the pause re-check made
    // the BUCKET the last gate, so a pause raised during a long bucket wait was
    // never re-read and the request sent into it. Whichever gate is checked last,
    // the one before it goes stale; only looping until nothing is in force works.
    const { governor, clock } = makeGovernor(1);
    const HASH = 'shared-by-two-templates';
    const ROLES = '/guilds/1/roles';
    const MEMBER = '/guilds/1/members/2';
    const record: { label: string; at: number }[] = [];
    const send = (label: string, response: GovernorResponse) => async () => {
      record.push({ label, at: clock.now() });
      return response;
    };
    const rate = (remaining: string): GovernorResponse =>
      reply({
        'x-ratelimit-bucket': HASH,
        'x-ratelimit-remaining': remaining,
        'x-ratelimit-reset-after': '100',
      });

    const seedA = governor.run({ method: 'GET', path: ROLES }, send('seed-roles', rate('5')));
    await clock.runAll();
    await seedA;
    const seedB = governor.run({ method: 'PATCH', path: MEMBER }, send('seed-member', rate('5')));
    await clock.runAll();
    await seedB;

    // The roles route shuts the shared bucket while the member write is asleep on
    // its rate slot, so the member write parks in the bucket gate until 102000.
    const exhaust = governor.run({ method: 'GET', path: ROLES }, send('exhaust', rate('0')));
    const victim = governor.run({ method: 'PATCH', path: MEMBER }, send('victim', rate('5')));
    // A THIRD queue, in a different guild so it shares nothing, takes a global
    // 429 while the member write is parked. Its pause outlasts the bucket window.
    // Answers 429 ONCE and then succeeds. A send that returned the same 429 on
    // every attempt would extend the pause again on each retry, so the number
    // this test pins would be an artifact of MAX_ATTEMPTS rather than of the gate.
    const pauserQueue = [res429({ 'x-ratelimit-scope': 'global' }, 200), reply()];
    const pauser = governor.run({ method: 'GET', path: '/guilds/7/roles' }, async () => {
      record.push({ label: 'pauser', at: clock.now() });
      return pauserQueue.shift() as GovernorResponse;
    });

    await clock.runAll();
    await Promise.all([exhaust, victim, pauser]);

    const at = (label: string) => record.find((r) => r.label === label)?.at;
    expect(at('exhaust')).toBe(2000);
    // The pause landed at 4000 and runs to 204000, well past the bucket's 102000.
    // Without the loop the victim woke at 102000 and sent straight into it.
    expect(at('pauser')).toBe(4000);
    // 205000 rather than 204000, and the extra second is the second half of the
    // same fix: the loop RE-RESERVES a rate slot on the pass that actually
    // dispatches. The slot this request took at 3000 had been sat on for two
    // hundred virtual seconds by then and was pacing nothing, so it takes a fresh
    // one behind the retry that also came off the pause at 204000.
    expect(at('victim')).toBe(205_000);
  });

  it('does NOT wipe shared bucket state when one template rotates onto a new hash', async () => {
    // Discord can re-bucket a route. The migration path exists for the FIRST
    // sighting, when state built up under the provisional key has to be carried
    // onto the real one, and it used to run on every change: a rotation deleted
    // the old key outright, and since sharing one key is the entire point of the
    // remap, that destroyed the gating state of every OTHER template still
    // resolved to it, over a rotation that had nothing to do with them.
    const { governor, clock } = makeGovernor(1000);
    const ROLES = '/guilds/1/roles';
    const MEMBER = '/guilds/1/members/2';
    const send = (hash: string) => async () =>
      reply({
        'x-ratelimit-bucket': hash,
        'x-ratelimit-remaining': '5',
        'x-ratelimit-reset-after': '100',
      });

    const first = governor.run({ method: 'GET', path: ROLES }, send('hash-one'));
    await clock.runAll();
    await first;
    const second = governor.run({ method: 'PATCH', path: MEMBER }, send('hash-one'));
    await clock.runAll();
    await second;
    // One shared bucket, two templates resolved onto it.
    expect(governor.snapshot().trackedBuckets).toBe(1);
    expect(governor.snapshot().trackedRoutes).toBe(2);

    // The roles route rotates onto a different hash. The member route has NOT
    // moved, so the entry it still resolves to must survive.
    const rotated = governor.run({ method: 'GET', path: ROLES }, send('hash-two'));
    await clock.runAll();
    await rotated;

    // TWO buckets: the rotated one and the one the member route still answers
    // under. Deleting the old key leaves this at 1.
    expect(governor.snapshot().trackedBuckets).toBe(2);
    expect(governor.snapshot().trackedRoutes).toBe(2);
  });

  it('KEEPS merging two templates that share a hash AND a major parameter', async () => {
    // The complement, so the split above cannot be implemented as "never merge".
    // Two routes in ONE guild that report one hash really are one bucket, and
    // separating them would double count a limit they jointly spend.
    const { governor, clock } = makeGovernor(1000);
    const HASH = 'one-real-bucket';
    const send = async (): Promise<GovernorResponse> =>
      reply({
        'x-ratelimit-bucket': HASH,
        'x-ratelimit-remaining': '5',
        'x-ratelimit-reset-after': '10',
      });

    const first = governor.run(
      { method: 'PATCH', path: '/guilds/99887766554433221/members/11223344556677889' },
      send,
    );
    await clock.runAll();
    await first;
    const second = governor.run(
      {
        method: 'PUT',
        path: '/guilds/99887766554433221/members/11223344556677889/roles/33445566778899001',
      },
      send,
    );
    await clock.runAll();
    await second;

    expect(governor.snapshot().trackedBuckets).toBe(1);
  });
});

describe('RateGovernor bucket remap onto the X-RateLimit-Bucket hash', () => {
  it('shares ONE limit state between two provisional routes that return the same hash', async () => {
    // Discord's real buckets do not line up with method-plus-route: several routes
    // share one. Keying rate state on the provisional template alone would give
    // each of them its own copy of a limit they are jointly spending, so the pair
    // would double count the bucket and blow through it. Sharing is proved by
    // EXHAUSTING the bucket through the role PUT and watching the member PATCH,
    // whose own last response said it had 5 requests left, get gated anyway.
    const { governor, clock } = makeGovernor(1000);
    const sent: { label: string; at: number }[] = [];
    const patchPath = '/guilds/99887766554433221/members/11223344556677889';
    const rolePath = '/guilds/99887766554433221/members/11223344556677889/roles/33445566778899001';
    const SHARED = 'shared-hash-9';
    const send = (label: string, headers: Record<string, string>) => async () => {
      sent.push({ label, at: clock.now() });
      return reply(headers);
    };

    const first = governor.run(
      { method: 'PATCH', path: patchPath },
      send('patch-1', {
        'x-ratelimit-bucket': SHARED,
        'x-ratelimit-remaining': '5',
        'x-ratelimit-reset-after': '10',
      }),
    );
    await clock.runAll();
    await first;

    // A DIFFERENT provisional route (different method AND different template) that
    // answers with the SAME hash, and reports the bucket spent to zero.
    const second = governor.run(
      { method: 'PUT', path: rolePath },
      send('roles-1', {
        'x-ratelimit-bucket': SHARED,
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset-after': '4',
      }),
    );
    await clock.runAll();
    await second;

    // One bucket tracked, not two: the count is what says the remap RETIRED the
    // provisional keys rather than leaving a second stale copy beside the hash.
    expect(governor.snapshot().trackedBuckets).toBe(1);

    const third = governor.run(
      { method: 'PATCH', path: patchPath },
      send('patch-2', {
        'x-ratelimit-bucket': SHARED,
        'x-ratelimit-remaining': '4',
        'x-ratelimit-reset-after': '10',
      }),
    );
    await clock.runAll();
    await third;

    expect(sent.map((s) => s.label)).toEqual(['patch-1', 'roles-1', 'patch-2']);
    // The PUT went out at 1 and reported a 4 s window, so the shared bucket
    // reopens at 4001. Without the remap the PATCH would read its OWN state
    // (5 remaining) and go out at 2 instead.
    expect(sent.map((s) => s.at)).toEqual([0, 1, 4001]);
  });
});

describe('routeTemplate and redactPath', () => {
  it('replaces a per-user id but KEEPS the guild and channel major ids', () => {
    // A template that interpolated the member id would mint one bucket per member
    // and defeat bucketing entirely; one that replaced the guild id would merge
    // buckets Discord genuinely keeps apart. Both halves are asserted, because
    // either mistake alone still produces a plausible-looking string.
    expect(routeTemplate('PATCH', '/guilds/99887766554433221/members/11223344556677889')).toBe(
      'PATCH /guilds/99887766554433221/members/:id',
    );
    // Two members of ONE guild therefore collapse onto one key.
    expect(routeTemplate('PATCH', '/guilds/99887766554433221/members/44556677889900112')).toBe(
      'PATCH /guilds/99887766554433221/members/:id',
    );
    // Two guilds do not.
    expect(routeTemplate('PATCH', '/guilds/55667788990011223/members/11223344556677889')).toBe(
      'PATCH /guilds/55667788990011223/members/:id',
    );
    expect(routeTemplate('POST', '/channels/22334455667788990/messages')).toBe(
      'POST /channels/22334455667788990/messages',
    );
  });

  it('turns an interaction or webhook token into :token so no credential reaches a key', () => {
    // The bucket key reaches counters, log fields, and the blocked-request error
    // message, so a token surviving into it publishes a live bearer credential.
    const interaction = routeTemplate(
      'POST',
      `/interactions/1234567890123456789/${INTERACTION_TOKEN}/callback`,
    );
    expect(interaction).toBe('POST /interactions/1234567890123456789/:token/callback');
    expect(interaction).not.toContain(INTERACTION_TOKEN);

    const webhook = routeTemplate(
      'PATCH',
      `/webhooks/1234567890123456789/${INTERACTION_TOKEN}/messages/@original`,
    );
    expect(webhook).toBe('PATCH /webhooks/1234567890123456789/:token/messages/@original');
    expect(webhook).not.toContain(INTERACTION_TOKEN);
  });

  it('redacts ONLY the credential segment, leaving the ids a log line needs', () => {
    // Redaction is token-only by design: losing the ids would cost the operator
    // the one detail that makes a failure diagnosable, so the member id stays.
    const path = `/interactions/1234567890123456789/${INTERACTION_TOKEN}/callback`;
    expect(redactPath(path)).toBe('/interactions/1234567890123456789/:token/callback');
    expect(redactPath(path)).not.toContain(INTERACTION_TOKEN);
    expect(redactPath('/guilds/99887766554433221/members/11223344556677889')).toBe(
      '/guilds/99887766554433221/members/11223344556677889',
    );
  });
});

describe('RateGovernor queue depth cap', () => {
  it('refuses a request at MAX_QUEUE_DEPTH instead of growing the backlog', async () => {
    // A poll loop that keeps enqueuing while a bucket is paused is how a bounded
    // memory footprint turns into an unbounded one, and every queued request is
    // stale by the time it drains anyway. The route is an interaction callback so
    // the refusal message doubles as the proof that the token never reaches an
    // operator-facing string.
    const { governor, clock } = makeGovernor(1000);
    let sends = 0;
    const path = `/interactions/1234567890123456789/${INTERACTION_TOKEN}/callback`;
    const send = async (): Promise<GovernorResponse> => {
      sends++;
      return reply();
    };

    const queued: Promise<GovernorResponse>[] = [];
    for (let i = 0; i < MAX_QUEUE_DEPTH; i++) {
      queued.push(governor.run({ method: 'POST', path }, send));
    }
    // No await inside the loop, so nothing has drained: the enqueue path runs to
    // `waiting++` synchronously and the queue is genuinely at its cap here.
    const refused = governor.run({ method: 'POST', path }, send);
    // Read BEFORE awaiting: awaiting yields the microtask queue, the jobs start
    // draining, and the depth this asserts would have moved.
    expect(governor.snapshot().queueDepth).toBe(MAX_QUEUE_DEPTH);

    const blocked = await refused.catch((e: unknown) => e);
    expect(blocked).toBeInstanceOf(GovernorBlockedError);
    expect((blocked as GovernorBlockedError).reason).toBe('queue-full');
    // An Error argument is message EQUALITY; a bare string would be a substring
    // match, which would leave the redacted route in the message unpinned.
    expect(blocked).toEqual(
      new GovernorBlockedError(
        'queue-full',
        '[bot] governor refused POST /interactions/1234567890123456789/:token/callback: bucket queue is full',
      ),
    );
    expect((blocked as Error).message).not.toContain(INTERACTION_TOKEN);
    // The refusal is the one block class with its own counter (the other two
    // are pinned in the counters suite); an operator reading the presence push
    // must be able to see a saturated queue shedding load.
    expect(governor.snapshot().queueFullBlocks).toBe(1);

    await clock.runAll();
    await Promise.all(queued);
    // The refused request was never handed to send, and the ones that were queued
    // all drained: the cap sheds load, it does not deadlock the queue.
    expect(sends).toBe(MAX_QUEUE_DEPTH);
    expect(governor.snapshot().queueDepth).toBe(0);
  });
});

describe('RateGovernor pacing and memory across a pause (L11, L12)', () => {
  /** A 429 whose body is not JSON at all: the Cloudflare-ban shape. */
  function banned(): GovernorResponse {
    return { status: 429, headers: {}, json: null, jsonParsed: false, nonJsonBody: true };
  }

  it('re-reserves a rate slot after a pause, so pre-pause holders do not fire together (L11)', async () => {
    // L11 as ledgered: requests that reserved a global slot BEFORE a pause was
    // declared must not all fire at the same instant when it lifts. maxRps 1
    // makes the spacing exactly 1000 ms, so "spaced" is a number here rather
    // than an ordering: without the re-reservation all three land on 123000.
    const { governor, clock } = makeGovernor(1);
    const sentAt: number[] = [];

    // The poisoner takes slot 0 and answers with a non-JSON 429, which pauses
    // the whole process for banPauseMs (123000 in this rig). The three others
    // reserve slots 1000, 2000 and 3000 synchronously, BEFORE that response
    // lands, which is the precondition the ledger entry describes.
    const poisoned = governor
      .run({ method: 'POST', path: '/channels/500600700800900100/messages' }, async () => banned())
      .catch(() => undefined);
    const held = ['a', 'b', 'c'].map((label) =>
      governor.run(
        { method: 'PATCH', path: `/guilds/900800700600500400/members/${label}` },
        async () => {
          sentAt.push(clock.now());
          return reply();
        },
      ),
    );

    await clock.runAll();
    await poisoned;
    await Promise.all(held);

    // Exact virtual times, not an ordering: 123000 is when the ban pause lifts,
    // and each later send is one full spacing behind the one before it.
    expect(sentAt).toEqual([123000, 124000, 125000]);
    // Spelled out separately so a change to the spacing cannot quietly keep the
    // list above self-consistent: 1000 ms is `Math.ceil(1000 / maxRps)` at maxRps 1.
    expect(sentAt[1] - sentAt[0]).toBe(1000);
    expect(sentAt[2] - sentAt[1]).toBe(1000);
    expect(new Set(sentAt).size).toBe(3);
  });

  it('bounds the live queue map at MAX_TRACKED_QUEUES while a pause holds requests (L12)', async () => {
    // L12: a request parked in waitForPause has not reached the job's finally
    // that drops a drained queue, and interaction callbacks mint a unique
    // template per interaction id, so during a long ban pause this map grew
    // without bound. maxRps 0 is the documented escape hatch that disables
    // global spacing, so nothing here depends on the rate cap.
    expect(MAX_TRACKED_QUEUES).toBe(512);
    const { governor, clock } = makeGovernor(0);

    void governor
      .run({ method: 'POST', path: '/channels/500600700800900100/messages' }, async () => banned())
      .catch(() => undefined);
    await clock.advanceTo(clock.now()); // flush microtasks WITHOUT lifting the pause
    expect(governor.snapshot().queueDepth).toBe(0); // the poisoner is done

    // Well past the cap, so the bound is REACHED rather than merely respected.
    const overflow = MAX_TRACKED_QUEUES + 40;
    const parked = Array.from({ length: overflow }, (_, i) =>
      governor.run({ method: 'POST', path: interactionPath(i) }, async () => reply()),
    );

    // Read before advancing: every one of these is parked in waitForPause, so
    // this is the exact state the ledger entry describes.
    const snapshot = governor.snapshot();
    expect(snapshot.activeQueues).toBe(MAX_TRACKED_QUEUES);
    expect(snapshot.queueDepth).toBe(overflow);

    await clock.runAll();
    await Promise.all(parked);
    // Every request still completed: the cap sheds MAP entries, never requests.
    // And the drain path still empties the map, so the cap is not masking a
    // leak by holding the size at exactly its bound forever.
    expect(governor.snapshot().activeQueues).toBe(0);
    expect(governor.snapshot().queueDepth).toBe(0);
  });

  it('evicts the COLDEST chain and keeps a touched one, so serialization survives (L12)', async () => {
    // The bound alone would be satisfied by evicting the hot route a sweep
    // hammers, which would silently drop the governor's core guarantee for it.
    // Two requests on ONE chain are strictly FIFO, so "did the chain survive"
    // is observable: a retained chain makes the second request wait for the
    // first, an evicted one mints a fresh chain that starts immediately.
    const { governor, clock } = makeGovernor(0);
    const started: string[] = [];
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = (label: string) => async (): Promise<GovernorResponse> => {
      started.push(label);
      await held;
      return reply();
    };

    const hot = '/guilds/111222333444555666/members/777888999000111222';
    const cold0 = interactionPath(0);
    const all: Promise<unknown>[] = [];
    // 1. the hot chain goes in FIRST, so it is the oldest entry.
    all.push(governor.run({ method: 'PATCH', path: hot }, send('hot-1')));
    // 2. fill to exactly the cap with cold single-use templates.
    for (let i = 0; i < MAX_TRACKED_QUEUES - 1; i++) {
      all.push(governor.run({ method: 'POST', path: interactionPath(i) }, send(`cold-${i}`)));
    }
    expect(governor.snapshot().activeQueues).toBe(MAX_TRACKED_QUEUES);
    // 3. touch the hot chain, which under LRU moves it to the newest end.
    all.push(governor.run({ method: 'PATCH', path: hot }, send('hot-2')));
    // 4. one more cold template pushes past the cap and evicts the coldest,
    //    which after the touch is cold0, NOT the hot chain.
    all.push(governor.run({ method: 'POST', path: interactionPath(9000) }, send('cold-overflow')));
    all.push(governor.run({ method: 'POST', path: cold0 }, send('cold0-again')));

    await clock.advanceTo(clock.now());

    // hot-2 is behind hot-1 on a chain that survived, so it has not been sent.
    expect(started).toContain('hot-1');
    expect(started).not.toContain('hot-2');
    // cold0's chain WAS evicted, so its second request got a fresh chain and did
    // not queue behind the first: it started even though cold-0 is still in flight.
    expect(started).toContain('cold-0');
    expect(started).toContain('cold0-again');

    release();
    await clock.runAll();
    await Promise.all(all);
    expect(started).toContain('hot-2');
    expect(governor.snapshot().activeQueues).toBe(0);
  });
});

describe('RateGovernor re-reservation after a BUCKET wait (L11, second arm)', () => {
  it('re-reserves the rate slot after a bucket window too, not only after a pause', async () => {
    // The source comment justifies per-pass re-reservation with "a slot taken and
    // then sat on for the length of a bucket WINDOW". The pause arm above covers
    // only the other half, so a mutant that re-reserved after a pause and not
    // after a bucket gate would survive it. maxRps 1 makes the spacing 1000 ms.
    const { governor, clock } = makeGovernor(1);
    const sentAt: number[] = [];
    // All four share one route TEMPLATE, so they also share one bucket, which is
    // what makes the exhausted window gate every one of them.
    const path = '/guilds/11223344556677889/members/99887766554433221';
    let replies = 0;
    const send = async (): Promise<GovernorResponse> => {
      sentAt.push(clock.now());
      replies += 1;
      // The FIRST response shuts the bucket for 30 s; the rest report headroom.
      return reply(
        replies === 1
          ? {
              'x-ratelimit-bucket': 'bucket-window',
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset-after': '30',
            }
          : {
              'x-ratelimit-bucket': 'bucket-window',
              'x-ratelimit-remaining': '9',
              'x-ratelimit-reset-after': '30',
            },
      );
    };
    const all = [0, 1, 2, 3].map(() => governor.run({ method: 'PATCH', path }, send));

    await clock.runAll();
    await Promise.all(all);

    // One send at 0 (which shuts the bucket), then the window reopens at 30000 and
    // the rest come off it SPACED by the rate cap rather than all at 30000. They
    // serialize on one FIFO too, so this also proves the queue did not collapse.
    expect(sentAt).toEqual([0, 30_000, 31_000, 32_000]);
    expect(sentAt[2] - sentAt[1]).toBe(1000);
    expect(sentAt[3] - sentAt[2]).toBe(1000);
  });
});

describe('RateGovernor drained-queue identity guard (load bearing under L12)', () => {
  it('does not delete a RE-MINTED chain when the evicted one drains', async () => {
    // The `this.queues.get(template) === queue` check in the job's finally became
    // load bearing the moment queues could be EVICTED. cold0's chain is evicted by
    // the fillers, a later request mints a FRESH chain under the same template, and
    // when the ORIGINAL request finally settles its `waiting === 0` is true for the
    // OLD object. Without the identity check it deletes the LIVE chain from the map.
    //
    // Two gates, not one, and that is the whole design of this case: the first
    // request has to settle while the second is STILL in flight, because the
    // deletion is only observable through a request that arrives after the settle.
    // A single shared gate releases everything at once and the mutant survives.
    const { governor, clock } = makeGovernor(0);
    const started: string[] = [];
    let releaseFirst = (): void => {};
    let releaseRest = (): void => {};
    const first = new Promise<void>((r) => {
      releaseFirst = r;
    });
    const rest = new Promise<void>((r) => {
      releaseRest = r;
    });
    const send = (label: string, gate: Promise<void>) => async (): Promise<GovernorResponse> => {
      started.push(label);
      await gate;
      return reply();
    };

    const cold0 = interactionPath(0);
    const all: Promise<unknown>[] = [];
    all.push(governor.run({ method: 'POST', path: cold0 }, send('cold0-first', first)));
    for (let i = 1; i < MAX_TRACKED_QUEUES + 5; i++) {
      all.push(
        governor.run({ method: 'POST', path: interactionPath(i) }, send(`filler-${i}`, rest)),
      );
    }
    // cold0 went in first and was never touched again, so it is the evicted one.
    all.push(governor.run({ method: 'POST', path: cold0 }, send('cold0-second', rest)));
    await clock.advanceTo(clock.now());
    expect(started).toContain('cold0-second'); // a fresh chain, not queued behind

    // Let ONLY the original settle. Its finally now runs while cold0-second is
    // still in flight, which is the moment the identity guard exists for.
    releaseFirst();
    await clock.advanceTo(clock.now());

    // A later request on the same template must still serialize behind
    // cold0-second, which it only can if the map still holds cold0-second's chain.
    all.push(governor.run({ method: 'POST', path: cold0 }, send('cold0-third', rest)));
    await clock.advanceTo(clock.now());
    expect(started).not.toContain('cold0-third');

    releaseRest();
    await clock.runAll();
    await Promise.all(all);
    expect(started).toContain('cold0-third');
    expect(governor.snapshot().activeQueues).toBe(0);
  });
});
