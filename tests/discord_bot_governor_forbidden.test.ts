// The governor's permanent-failure cache (D4, extended to 400 by Phase 7's L13): the
// memory that stops a member whose write answered 400, 401 or 403 from being retried on
// every five-minute sweep, scoped to that
// one subject, expiring on its own, and droppable early when the bot's role position
// moves and a past 403 stops meaning anything.
//
// Time comes from the virtual clock in tests/helpers, never vitest fake timers: the
// governor captures its clock at construction (a captured clock does not move under
// fake timers, so the whole suite could pass for an implementation that read the wall
// clock), and a fractional delay is allowed to fire EARLY under real timers, which
// would make every boundary assertion below a coin flip.
import { describe, expect, it } from 'vitest';
import { DiscordApi } from '../bot/discord_api';
import {
  DEFAULT_FORBIDDEN_TTL_MS,
  GovernorBlockedError,
  type GovernorResponse,
  MAX_FORBIDDEN_ENTRIES,
  RateGovernor,
} from '../bot/rate_governor';
import { type SyntheticClock, syntheticClock } from './helpers/synthetic_clock';

/**
 * A deliberately distinctive TTL. Nothing in the governor falls back to it (the
 * option is required), and it is nowhere near DEFAULT_FORBIDDEN_TTL_MS, so an
 * assertion that turns on it cannot be satisfied by the default instead.
 */
const TTL_MS = 7_777;

/** One member write. Both subjects below share this template on purpose. */
const MEMBER_ONE = '/guilds/1/members/2';
const MEMBER_TWO = '/guilds/1/members/3';
const MEMBER_TEMPLATE = 'PATCH /guilds/1/members/:id';

interface Rig {
  governor: RateGovernor;
  clock: SyntheticClock;
  /** Labels of every send the governor actually dispatched, in order. */
  sent: string[];
  /** A send callback that records `label` and answers `status`. */
  reply: (label: string, status: number) => () => Promise<GovernorResponse>;
}

function rig(forbiddenTtlMs = TTL_MS): Rig {
  const clock = syntheticClock();
  const sent: string[] = [];
  const governor = new RateGovernor({
    clock,
    // maxRps 0 is the governor's own "no global spacing" arm
    // (`maxRps > 0 ? Math.ceil(1000 / maxRps) : 0`). Any positive value spaces
    // the second request in a test at least 1 ms out, so every await below would
    // hang until the clock was advanced past a pacer that has nothing to do with
    // the permanent-failure cache. Pacing is covered by its own suite.
    maxRps: 0,
    banPauseMs: 60_000,
    // Far above the handful of 401/403s any test here produces, so the
    // invalid-request breaker never becomes the reason a request is refused and
    // the block assertions below stay about the forbidden cache alone.
    breakerLimit: 50,
    forbiddenTtlMs,
  });
  return {
    governor,
    clock,
    sent,
    reply: (label, status) => async () => {
      sent.push(label);
      return { status, headers: {}, json: {}, jsonParsed: true };
    },
  };
}

/** The error a refused request throws, or a failure when it was not refused. */
async function blockedBy(run: Promise<unknown>): Promise<GovernorBlockedError> {
  const caught = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(caught).toBeInstanceOf(GovernorBlockedError);
  return caught as GovernorBlockedError;
}

describe('rate governor permanent-failure cache (D4)', () => {
  it('refuses the next request for a subject that answered 403, never sending it', async () => {
    const { governor, sent, reply } = rig();

    const first = await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('first', 403),
    );
    // A 403 is a RESPONSE, not a throw: the IO shell owns what a status means.
    expect(first.status).toBe(403);
    expect(sent).toEqual(['first']);

    const blocked = await blockedBy(
      governor.run(
        { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
        reply('second', 200),
      ),
    );
    expect(blocked.reason).toBe('forbidden-cached');
    // Exact message equality. `rejects.toThrow(string)` is a SUBSTRING match in
    // vitest, so a bare string would also pass for a message that carried the
    // wrong route (or a raw path with a credential in it).
    expect(blocked.message).toBe(
      `[bot] governor skipped ${MEMBER_TEMPLATE}: subject previously answered 400, 401 or 403`,
    );
    // The point of the whole cache: the second send was never called. Without
    // this the test would pass for a governor that dispatched and then threw.
    expect(sent).toEqual(['first']);

    const counters = governor.snapshot();
    expect(counters.forbiddenEntries).toBe(1);
    expect(counters.forbiddenBlocks).toBe(1);
    // Requests counts sends, so it stays at the one that actually went out.
    expect(counters.requests).toBe(1);
  });

  it('refuses the next request for a subject that answered 401 too', async () => {
    // 401 and 403 are separate arms of the same condition; a fix that narrowed it
    // to 403 would leave a token-scope failure retried on every sweep forever.
    const { governor, sent, reply } = rig();

    const first = await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('first', 401),
    );
    expect(first.status).toBe(401);

    const blocked = await blockedBy(
      governor.run(
        { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
        reply('second', 200),
      ),
    );
    expect(blocked.reason).toBe('forbidden-cached');
    expect(sent).toEqual(['first']);
    expect(governor.snapshot().forbiddenEntries).toBe(1);
  });

  it('caches per subject: a DIFFERENT member on the same route is still sent', async () => {
    // Both paths collapse to one bucket template, so a cache keyed by route (or
    // one global flag) would look identical to a correct one on the test above
    // and would silently stop syncing every member after the first failure.
    const { governor, sent, reply } = rig();

    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('u2', 403),
    );

    const other = await governor.run(
      { method: 'PATCH', path: MEMBER_TWO, subjectKey: 'g1:u3' },
      reply('u3', 204),
    );
    expect(other.status).toBe(204);
    expect(sent).toEqual(['u2', 'u3']);
    // Only the failing subject is remembered, and nothing was refused.
    expect(governor.snapshot().forbiddenEntries).toBe(1);
    expect(governor.snapshot().forbiddenBlocks).toBe(0);
    expect(governor.isForbidden('g1:u2')).toBe(true);
    expect(governor.isForbidden('g1:u3')).toBe(false);
  });

  it('never populates the cache from a request that carries no subjectKey', async () => {
    // A relay post or a roles read is not about one member, so a 403 on it says
    // nothing cacheable. Pinned by the entry COUNT, not by the next dispatch:
    // dropping the `subjectKey !== undefined` guard in the response path would
    // store an entry under an undefined key that nothing could ever clear.
    const { governor, sent, reply } = rig();

    await governor.run({ method: 'GET', path: '/guilds/1/roles' }, reply('first', 403));
    expect(governor.snapshot().forbiddenEntries).toBe(0);

    const second = await governor.run(
      { method: 'GET', path: '/guilds/1/roles' },
      reply('second', 200),
    );
    expect(second.status).toBe(200);
    expect(sent).toEqual(['first', 'second']);
  });

  it('never blocks same-route traffic that carries no subjectKey', async () => {
    // The other direction of the same rule: a cached member must not take out
    // every other call that happens to share their bucket template.
    const { governor, sent, reply } = rig();

    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('u2', 403),
    );

    const anonymous = await governor.run(
      { method: 'PATCH', path: MEMBER_ONE },
      reply('nokey', 204),
    );
    expect(anonymous.status).toBe(204);
    expect(sent).toEqual(['u2', 'nokey']);
    expect(governor.snapshot().forbiddenBlocks).toBe(0);
  });

  it('retries the subject once forbiddenTtlMs has elapsed on the virtual clock', async () => {
    // The cache is a cache, not a tombstone: a permission that gets fixed must
    // heal without a bot restart.
    const { governor, clock, sent, reply } = rig();
    // The fixture TTL must not be the module default, or advancing by it would
    // prove nothing about the CONFIGURED value being the one honored.
    expect(TTL_MS).not.toBe(DEFAULT_FORBIDDEN_TTL_MS);

    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('u2', 403),
    );
    expect(governor.isForbidden('g1:u2')).toBe(true);

    await clock.advanceBy(TTL_MS);

    const retried = await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('retry', 204),
    );
    expect(retried.status).toBe(204);
    // The send IS called again: the whole claim of this test.
    expect(sent).toEqual(['u2', 'retry']);
    expect(governor.snapshot().forbiddenEntries).toBe(0);
    expect(governor.snapshot().forbiddenBlocks).toBe(0);
  });

  it('still blocks one millisecond BEFORE the TTL and dispatches exactly at it', async () => {
    // Both sides of the boundary, which is what makes the comparison itself
    // pinned: an off-by-a-window bug (an hour, a day) satisfies either side
    // alone. The rule is `expiresAt <= now`, so the TTL instant is expired.
    const { governor, clock, sent, reply } = rig();

    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('u2', 403),
    );

    await clock.advanceBy(TTL_MS - 1);
    expect(clock.now()).toBe(TTL_MS - 1);
    const blocked = await blockedBy(
      governor.run({ method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' }, reply('early', 204)),
    );
    expect(blocked.reason).toBe('forbidden-cached');
    expect(sent).toEqual(['u2']);
    expect(governor.isForbidden('g1:u2')).toBe(true);

    await clock.advanceBy(1);
    expect(clock.now()).toBe(TTL_MS);
    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('at', 204),
    );
    expect(sent).toEqual(['u2', 'at']);
  });

  it('re-arms from the CURRENT time when the retry answers 403 again', async () => {
    // The expiry is `now + ttl` at the moment of the failure. An implementation
    // that anchored on the FIRST failure would let a subject that keeps failing
    // fall out of the cache permanently after one TTL and be swept forever after.
    const { governor, clock, sent, reply } = rig();

    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('u2', 403),
    );
    await clock.advanceBy(TTL_MS);
    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('retry', 403),
    );
    expect(sent).toEqual(['u2', 'retry']);

    // One millisecond short of a SECOND full TTL measured from the retry.
    await clock.advanceBy(TTL_MS - 1);
    expect(clock.now()).toBe(2 * TTL_MS - 1);
    const blocked = await blockedBy(
      governor.run({ method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' }, reply('late', 204)),
    );
    expect(blocked.reason).toBe('forbidden-cached');
    expect(sent).toEqual(['u2', 'retry']);
  });

  it('invalidateForbidden(subjectKey) clears that one subject and leaves the rest cached', async () => {
    // The role-position-change hook. Scoped on purpose: clearing the world on
    // one member's fix would re-sweep every genuinely forbidden member with it.
    const { governor, clock, sent, reply } = rig();

    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('u2', 403),
    );
    await governor.run(
      { method: 'PATCH', path: MEMBER_TWO, subjectKey: 'g1:u3' },
      reply('u3', 403),
    );
    expect(governor.snapshot().forbiddenEntries).toBe(2);

    governor.invalidateForbidden('g1:u2');

    expect(governor.snapshot().forbiddenEntries).toBe(1);
    expect(governor.isForbidden('g1:u2')).toBe(false);
    expect(governor.isForbidden('g1:u3')).toBe(true);

    // Cleared EARLY: well inside the TTL, which is what says the clear did it
    // and not the expiry. Nothing has advanced the clock at all here.
    expect(clock.now()).toBe(0);
    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('u2-again', 204),
    );
    const stillBlocked = await blockedBy(
      governor.run(
        { method: 'PATCH', path: MEMBER_TWO, subjectKey: 'g1:u3' },
        reply('u3-again', 204),
      ),
    );
    expect(stillBlocked.reason).toBe('forbidden-cached');
    expect(sent).toEqual(['u2', 'u3', 'u2-again']);
  });

  it('invalidateForbidden() with no argument clears every subject', async () => {
    const { governor, clock, sent, reply } = rig();

    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('u2', 403),
    );
    await governor.run(
      { method: 'PATCH', path: MEMBER_TWO, subjectKey: 'g1:u3' },
      reply('u3', 401),
    );
    expect(governor.snapshot().forbiddenEntries).toBe(2);

    governor.invalidateForbidden();

    expect(governor.snapshot().forbiddenEntries).toBe(0);
    expect(governor.isForbidden('g1:u2')).toBe(false);
    expect(governor.isForbidden('g1:u3')).toBe(false);
    // Both subjects dispatch again, still at t=0 rather than after the TTL.
    expect(clock.now()).toBe(0);
    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('u2-again', 204),
    );
    await governor.run(
      { method: 'PATCH', path: MEMBER_TWO, subjectKey: 'g1:u3' },
      reply('u3-again', 204),
    );
    expect(sent).toEqual(['u2', 'u3', 'u2-again', 'u3-again']);
    expect(governor.snapshot().forbiddenBlocks).toBe(0);
  });

  it('isForbidden reports the cached state and self-expires a stale entry', async () => {
    // isForbidden is the read the callers use to skip work before building a
    // request at all, so it has to expire on its own rather than report a stale
    // true until some other call happens to prune. (Which of the two deletes
    // physically removes the entry is not observable: snapshot() prunes as well.
    // What is pinned here is that a read past the TTL reports false and the
    // entry stops being counted.)
    const { governor, clock, reply } = rig();

    expect(governor.isForbidden('g1:u2')).toBe(false);
    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('u2', 403),
    );
    expect(governor.isForbidden('g1:u2')).toBe(true);
    // An unrelated key is never a hit.
    expect(governor.isForbidden('g1:u9')).toBe(false);

    await clock.advanceBy(TTL_MS - 1);
    expect(governor.isForbidden('g1:u2')).toBe(true);

    await clock.advanceBy(1);
    expect(governor.isForbidden('g1:u2')).toBe(false);
    expect(governor.snapshot().forbiddenEntries).toBe(0);
  });
});

describe('permanent-failure cache: what must NOT enter it', () => {
  it('caches ONLY 400, 401 and 403, never another failing status', async () => {
    // The arm the suite was missing entirely. Every other test drives 401, 403,
    // 200 or 204, so widening the guard at the response path from
    // `status === 401 || status === 403` to `status >= 400` stayed green, and a
    // transient 500 or a 404 for a member who simply left would have poisoned
    // the cache for a full TTL and silently skipped that member on every sweep.
    //
    // 400 left this list in Phase 7 and got its own describe below: it is a
    // permanent rejection of the PAYLOAD, which the ones here are not. 404 is
    // the sharpest remaining case, because it is exactly the shape a widened
    // guard would swallow: a member who simply left, whose next write must go
    // out normally the moment they rejoin.
    for (const status of [404, 429, 500, 502]) {
      const r = rig();
      const subjectKey = `g1:${status}`;
      // The clock is driven, because a 429 waits out a retry: with no
      // retry_after in the body the governor uses MISSING_RETRY_AFTER_MS rather
      // than retrying instantly, so a bare await here would hang on a virtual
      // sleep nothing advances.
      const firstRun = r.governor.run(
        { method: 'PATCH', path: MEMBER_ONE, subjectKey },
        r.reply('first', status),
      );
      await r.clock.runAll();
      expect((await firstRun).status).toBe(status);

      expect(r.governor.isForbidden(subjectKey)).toBe(false);
      expect(r.governor.snapshot().forbiddenEntries).toBe(0);

      // And the next attempt for that subject really is dispatched. Asserted by
      // the LAST send rather than by the whole array: a 429 is retried up to
      // MAX_ATTEMPTS times, so 'first' legitimately appears more than once and
      // an exact-array pin would fail for a reason that has nothing to do with
      // the cache.
      const secondRun = r.governor.run(
        { method: 'PATCH', path: MEMBER_ONE, subjectKey },
        r.reply('second', 200),
      );
      await r.clock.runAll();
      await secondRun;
      expect(r.sent.at(-1)).toBe('second');
      expect(r.sent.filter((label) => label === 'second').length).toBe(1);
    }
  });

  it('does not spend invalid-request budget on a request it never sent', async () => {
    // A cached block is the ABSENCE of a Discord request, so it cannot be an
    // invalid one. Adding recordInvalid() to the refusal path survived the whole
    // suite because the rig's breakerLimit is far above what these tests reach;
    // this drives a limit of 2 so the mutant would trip the breaker instead.
    const clock = syntheticClock();
    const sent: string[] = [];
    const governor = new RateGovernor({
      clock,
      maxRps: 0,
      banPauseMs: 60_000,
      breakerLimit: 2,
      forbiddenTtlMs: TTL_MS,
    });
    const send = (label: string, status: number) => async () => {
      sent.push(label);
      return { status, headers: {}, json: {}, jsonParsed: true } as GovernorResponse;
    };

    // One real 403 puts the subject in the cache and counts once (1 of 2).
    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      send('real', 403),
    );
    expect(governor.snapshot().breakerState).toBe('closed');

    // Five refusals for that same subject. If any of them counted, the window
    // would reach 2 and the breaker would open.
    for (let i = 0; i < 5; i++) {
      const blocked = await blockedBy(
        governor.run({ method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' }, send('nope', 200)),
      );
      expect(blocked.reason).toBe('forbidden-cached');
    }

    const snap = governor.snapshot();
    expect(snap.breakerState).toBe('closed');
    expect(snap.breakerOpens).toBe(0);
    expect(snap.forbiddenBlocks).toBe(5);
    // A different, uncached subject still flows: the breaker really is shut.
    await governor.run(
      { method: 'PATCH', path: MEMBER_TWO, subjectKey: 'g1:u3' },
      send('other', 200),
    );
    expect(sent).toEqual(['real', 'other']);
  });

  it('bounds the cache, evicting the OLDEST subject rather than growing forever', async () => {
    // REGRESSION in the test, not the code. This case used to store 42 subjects
    // against a real cap of 4096 and assert `42 <= 4096`, which is true of any
    // implementation at all: deleting the eviction block outright left it green,
    // so the bound it is named for was pinned by nothing. Its comment claimed the
    // size was "injected", but MAX_FORBIDDEN_ENTRIES is a module constant with no
    // seam, so the only honest way to observe the bound is to reach it.
    // Its own governor rather than `rig()`: filling the cache takes more than
    // MAX_FORBIDDEN_ENTRIES 403s, and every one of them is a counted invalid
    // response, so the rig's breaker limit of 50 would open the breaker and
    // refuse the rest long before the cache ever filled.
    const clock = syntheticClock();
    const sent: string[] = [];
    const governor = new RateGovernor({
      clock,
      maxRps: 0,
      banPauseMs: 60_000,
      breakerLimit: Number.POSITIVE_INFINITY,
      forbiddenTtlMs: TTL_MS,
    });

    const overflow = 5;
    for (let i = 0; i < MAX_FORBIDDEN_ENTRIES + overflow; i++) {
      // Ids are built by string interpolation over a small counter, never by
      // adding to a snowflake-sized literal: past Number.MAX_SAFE_INTEGER the
      // additions collapse onto a handful of values and the map never grows.
      await governor.run(
        { method: 'PATCH', path: `/guilds/1/members/${i}`, subjectKey: `g1:u${i}` },
        async () => {
          sent.push(`m${i}`);
          return { status: 403, headers: {}, json: {}, jsonParsed: true } as GovernorResponse;
        },
      );
    }
    // Every subject really was driven through the insert path.
    expect(sent.length).toBe(MAX_FORBIDDEN_ENTRIES + overflow);

    // EXACTLY the cap. `toBeLessThanOrEqual` would also hold for a cache that
    // evicted everything, or that stopped inserting once full.
    expect(governor.snapshot().forbiddenEntries).toBe(MAX_FORBIDDEN_ENTRIES);
    // The victims are the oldest subjects, and the newest are still remembered:
    // an eviction that dropped the most recent entry would suppress nothing and
    // re-sweep the member who just failed, on every sweep, forever.
    for (let i = 0; i < overflow; i++) expect(governor.isForbidden(`g1:u${i}`)).toBe(false);
    expect(governor.isForbidden(`g1:u${overflow}`)).toBe(true);
    expect(governor.isForbidden(`g1:u${MAX_FORBIDDEN_ENTRIES + overflow - 1}`)).toBe(true);
  });
});

describe('permanently rejected writes: 400 (L13)', () => {
  it('caches a 400 for its subject and refuses the next write without sending it', async () => {
    // The ledgered L13 defect. A nickname PATCH that Discord answers 400 is a
    // computed nick it will never accept, and bot/member_writes.ts deliberately
    // does not move its diff cache on a failed write, so the identical doomed
    // request was rebuilt and re-sent on every sweep for the life of the process.
    const { governor, sent, reply } = rig();

    const first = await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('first', 400),
    );
    // A 400 is a RESPONSE, not a throw: the IO shell owns what a status means.
    expect(first.status).toBe(400);

    const blocked = await blockedBy(
      governor.run(
        { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
        reply('second', 200),
      ),
    );
    expect(blocked.reason).toBe('forbidden-cached');
    expect(blocked.message).toBe(
      `[bot] governor skipped ${MEMBER_TEMPLATE}: subject previously answered 400, 401 or 403`,
    );
    // The point of the whole cache: the second send was never called.
    expect(sent).toEqual(['first']);
    expect(governor.snapshot().forbiddenEntries).toBe(1);
    expect(governor.snapshot().forbiddenBlocks).toBe(1);
  });

  it('retries the subject once the TTL has elapsed, so a fixed nick is not lost', async () => {
    // The belief is BOUNDED, which is what makes caching a 400 safe at all: the
    // payload Discord rejected was computed from the member's own state, and that
    // state changes (a rename, a level-up). Deferring the next legitimate write by
    // at most one TTL is the cost; losing it forever would not be acceptable.
    const { governor, clock, sent, reply } = rig();

    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('u2', 400),
    );
    expect(governor.isForbidden('g1:u2')).toBe(true);

    await clock.advanceBy(TTL_MS - 1);
    expect(governor.isForbidden('g1:u2')).toBe(true);
    await clock.advanceBy(1);

    const retried = await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('retry', 204),
    );
    expect(retried.status).toBe(204);
    expect(sent).toEqual(['u2', 'retry']);
    expect(governor.snapshot().forbiddenEntries).toBe(0);
  });

  it('caches nothing for a 400 that carries NO subjectKey', async () => {
    // A relay post or a slash-command reply is not about one member, so a 400 on
    // it says nothing cacheable, and there would be no key to clear it under.
    // Pinned by the entry COUNT, so dropping the subjectKey guard is caught even
    // though the block it would cause is unreachable.
    const { governor, sent, reply } = rig();

    await governor.run({ method: 'POST', path: '/channels/9/messages' }, reply('first', 400));
    expect(governor.snapshot().forbiddenEntries).toBe(0);

    const second = await governor.run(
      { method: 'POST', path: '/channels/9/messages' },
      reply('second', 200),
    );
    expect(second.status).toBe(200);
    expect(sent).toEqual(['first', 'second']);
  });

  it('caches per subject: a DIFFERENT member on the same route still dispatches', async () => {
    // Both paths collapse to one bucket template, so a cache keyed by route would
    // look identical here and would stop every member's write after one bad nick.
    const { governor, sent, reply } = rig();

    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('u2', 400),
    );
    const other = await governor.run(
      { method: 'PATCH', path: MEMBER_TWO, subjectKey: 'g1:u3' },
      reply('u3', 204),
    );

    expect(other.status).toBe(204);
    expect(sent).toEqual(['u2', 'u3']);
    expect(governor.isForbidden('g1:u2')).toBe(true);
    expect(governor.isForbidden('g1:u3')).toBe(false);
  });

  it('spends NO invalid-request budget on a 400, unlike a 401 or a 403', async () => {
    // The asymmetry is deliberate and load bearing. The breaker counts against
    // Discord's own invalid-request ban threshold, and Discord counts 401, 403
    // and 429 toward it, never 400. Adding 400 to the recordInvalid arm would let
    // one bad nick shape swept across a few hundred members open the breaker and
    // stop every non-essential Discord call the bot makes, which is far worse
    // than the doomed writes it saves. Driven at a limit of 2 so the mutant trips.
    const clock = syntheticClock();
    const sent: string[] = [];
    const governor = new RateGovernor({
      clock,
      maxRps: 0,
      banPauseMs: 60_000,
      breakerLimit: 2,
      forbiddenTtlMs: TTL_MS,
    });
    const send = (label: string, status: number) => async () => {
      sent.push(label);
      return { status, headers: {}, json: {}, jsonParsed: true } as GovernorResponse;
    };

    // Five 400s, each for a DIFFERENT subject so the forbidden cache never
    // refuses one of them and every single response reaches the classifier.
    for (let i = 0; i < 5; i++) {
      const answered = await governor.run(
        { method: 'PATCH', path: `/guilds/1/members/${i}`, subjectKey: `g1:u${i}` },
        send(`bad-${i}`, 400),
      );
      expect(answered.status).toBe(400);
    }

    const snap = governor.snapshot();
    expect(snap.breakerState).toBe('closed');
    expect(snap.breakerOpens).toBe(0);
    // Every one of them WAS remembered, so this is about the breaker alone and
    // not about the classifier having skipped the responses entirely.
    expect(snap.forbiddenEntries).toBe(5);
    expect(sent.length).toBe(5);

    // The contrast: two 401s at the same limit DO open it, so the assertion above
    // is about the status and not about a breaker that never trips in this rig.
    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:auth1' },
      send('auth1', 401),
    );
    await governor.run(
      { method: 'PATCH', path: MEMBER_TWO, subjectKey: 'g1:auth2' },
      send('auth2', 401),
    );
    expect(governor.snapshot().breakerState).toBe('open');
  });

  it('remembers a rejected NICKNAME under its own scope, leaving role writes alone', async () => {
    // The real L13 shape, end to end through the shell, because the subject KEY
    // is what decides how far the suppression reaches and only DiscordApi passes
    // it. A nick Discord will not accept must stop being retried; the same
    // member's tier-role sync must keep working, exactly as the B1 split below
    // guarantees for a 403.
    const calls: string[] = [];
    const impl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method} ${url.replace('https://discord.com/api/v10', '')}`);
      const nickPatch = init?.method === 'PATCH';
      return {
        ok: !nickPatch,
        status: nickPatch ? 400 : 204,
        headers: { forEach: () => {} },
        json: async () => ({}),
        text: async () => 'Invalid Form Body',
      } as unknown as Response;
    };
    const api = new DiscordApi(
      'tok',
      impl,
      new RateGovernor({
        clock: syntheticClock(),
        maxRps: 0,
        banPauseMs: 60_000,
        breakerLimit: 50,
        forbiddenTtlMs: TTL_MS,
      }),
    );

    await expect(api.setNickname('g1', 'u1', 'Aran (12)')).rejects.toThrow('-> 400');
    // The retry the sweep would make next pass is refused before it is sent.
    await expect(api.setNickname('g1', 'u1', 'Aran (12)')).rejects.toThrow(
      'subject previously answered 400, 401 or 403',
    );
    // And the member's role writes are untouched.
    await api.addMemberRole('g1', 'u1', 'r1');

    expect(calls).toEqual(['PATCH /guilds/g1/members/u1', 'PUT /guilds/g1/members/u1/roles/r1']);
  });
});

describe('permanent-failure cache versus essential traffic', () => {
  it('refuses an ESSENTIAL request for a cached subject too', async () => {
    // `essential` buys survival of the invalid-request BREAKER and nothing else.
    // The permanent-failure cache is a different control: it says this exact
    // subject answered 401 or 403, which no amount of urgency changes, and
    // sending anyway would spend invalid-request budget on a call already known
    // to fail. Nothing pinned that the two controls stay separate, so widening
    // the cache check to skip essential traffic stayed green.
    const { governor, sent, reply } = rig();

    await governor.run(
      { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2' },
      reply('first', 403),
    );

    const blocked = await blockedBy(
      governor.run(
        { method: 'PATCH', path: MEMBER_ONE, subjectKey: 'g1:u2', essential: true },
        reply('essential', 200),
      ),
    );
    expect(blocked.reason).toBe('forbidden-cached');
    expect(sent).toEqual(['first']);
    expect(governor.snapshot().forbiddenBlocks).toBe(1);

    // The contrast arm: essential traffic for an UNCACHED subject still flows, so
    // the assertion above is about the cache rather than about essential requests
    // being refused in general.
    const other = await governor.run(
      { method: 'PATCH', path: MEMBER_TWO, subjectKey: 'g1:u3', essential: true },
      reply('other', 204),
    );
    expect(other.status).toBe(204);
    expect(sent).toEqual(['first', 'other']);
  });
});

describe('permanent-failure cache scoping across endpoints (B1 regression)', () => {
  it('keeps a nickname 403 from suppressing that member ROLE writes', async () => {
    // REGRESSION, and the worst defect this phase introduced. Both writes used
    // one key per member, so a nickname PATCH that 403s poisoned the cache for
    // the member outright and every later ROLE write for them was refused
    // without being sent, for the whole 24 hour TTL.
    //
    // This is not a corner case. Discord 403s a nickname PATCH PERMANENTLY for
    // the guild owner and for anyone above the bot in the role hierarchy, and
    // bot/main.ts sweeps nicknames for every linked member. With
    // MANAGE_NICKNAMES missing altogether, every member 403s and ALL tier-role
    // sync in the guild stops for a day. Before the governor, a nickname failure
    // could not touch role sync at all, so this was a change in the user-visible
    // effect of the calls, which this phase's scope forbids.
    //
    // Driven through DiscordApi rather than the governor directly, because the
    // defect lived in the KEYS the shell passes, not in the cache itself.
    const calls: string[] = [];
    const impl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method} ${url.replace('https://discord.com/api/v10', '')}`);
      const nickPatch = init?.method === 'PATCH';
      return {
        ok: !nickPatch,
        status: nickPatch ? 403 : 204,
        headers: { forEach: () => {} },
        json: async () => ({}),
        text: async () => 'Missing Permissions',
      } as unknown as Response;
    };
    const governor = new RateGovernor({
      clock: syntheticClock(),
      maxRps: 0,
      banPauseMs: 60_000,
      breakerLimit: 50,
      forbiddenTtlMs: TTL_MS,
    });
    const api = new DiscordApi('tok', impl, governor);

    // The nickname write 403s, exactly as it does for a guild owner.
    await expect(api.setNickname('g1', 'u1', 'Aran (12)')).rejects.toThrow('-> 403');

    // The SAME member's role writes must still go out.
    await api.addMemberRole('g1', 'u1', 'r1');
    await api.removeMemberRole('g1', 'u1', 'r2');

    expect(calls).toEqual([
      'PATCH /guilds/g1/members/u1',
      'PUT /guilds/g1/members/u1/roles/r1',
      'DELETE /guilds/g1/members/u1/roles/r2',
    ]);

    // The nickname failure IS still remembered, under its own scope, so the
    // suppression that D4 asks for is intact where it belongs.
    await expect(api.setNickname('g1', 'u1', 'Aran (13)')).rejects.toThrow(
      'subject previously answered 400, 401 or 403',
    );
    expect(calls.length).toBe(3);
  });

  it('keeps a role-write 403 from suppressing that member NICKNAME write', async () => {
    // The mirror direction, so the split cannot be half-applied.
    const calls: string[] = [];
    const impl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method} ${url.replace('https://discord.com/api/v10', '')}`);
      const roleWrite = init?.method === 'PUT';
      return {
        ok: !roleWrite,
        status: roleWrite ? 403 : 204,
        headers: { forEach: () => {} },
        json: async () => ({}),
        text: async () => 'Missing Permissions',
      } as unknown as Response;
    };
    const governor = new RateGovernor({
      clock: syntheticClock(),
      maxRps: 0,
      banPauseMs: 60_000,
      breakerLimit: 50,
      forbiddenTtlMs: TTL_MS,
    });
    const api = new DiscordApi('tok', impl, governor);

    await expect(api.addMemberRole('g1', 'u1', 'r1')).rejects.toThrow('-> 403');
    await api.setNickname('g1', 'u1', 'Aran (12)');

    expect(calls).toEqual(['PUT /guilds/g1/members/u1/roles/r1', 'PATCH /guilds/g1/members/u1']);
  });
});
