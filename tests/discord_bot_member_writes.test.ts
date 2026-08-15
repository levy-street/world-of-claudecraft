// The diff-before-write paths the bot uses for every member-facing write (D5).
//
// These are the arms the incident turned on. Before Phase 3 the nickname PATCH
// was unconditional, so every linked online member was written every sweep
// forever, and each write made Discord emit a GUILD_MEMBER_UPDATE that the bot
// answered with a members-meta POST back into the game. So the load-bearing case
// below is the boring one: with nothing changed, these functions must perform
// ZERO writes of either kind.
//
// The failure arms assert the CACHE rather than a call count, because that is
// what decides whether the next sweep retries. A cache updated after a failed
// write is indistinguishable from a successful one by call count alone, and it
// would silently strand that member until some unrelated field happened to move.
import { describe, expect, it } from 'vitest';
import {
  MEMBERS_META_BATCH,
  type MemberMetaRecord,
  reconcileMemberRolesFromUpdate,
} from '../bot/logic';
import {
  decideMemberUpdate,
  displayNameOf,
  dueForFullResync,
  FULL_RESYNC_INTERVAL_MS,
  forgetMember,
  fullResyncIfDue,
  type NicknameCaches,
  nickOf,
  pushChangedMemberMeta,
  pushOneMemberMeta,
  refreshThenPushMeta,
  writeMemberNickname,
} from '../bot/member_writes';

/** The two shapes a push result may take that mean "the server did not take it". */
const pushRejectedShapes = [null, undefined];

/** Ids as STRINGS: `1000000000000000000 + i` is past Number.MAX_SAFE_INTEGER, so a
 * loop built that way collapses onto a few values and a population never grows. */
function memberId(index: number): string {
  return `1122334455${String(index).padStart(9, '0')}`;
}

function record(id: string, over: Partial<MemberMetaRecord> = {}): MemberMetaRecord {
  return {
    discord_user_id: id,
    name: 'Aldric',
    joinedAtMs: 1_700_000_000_000,
    role: null,
    ...over,
  };
}

function caches(
  seed: { nick?: string | null; name?: string; written?: string } = {},
): NicknameCaches {
  const c: NicknameCaches = {
    memberNicks: new Map<string, string | null>(),
    memberNames: new Map<string, string>(),
    lastWrittenNick: new Map<string, string>(),
  };
  if (seed.nick !== undefined) c.memberNicks.set(USER, seed.nick);
  if (seed.name !== undefined) c.memberNames.set(USER, seed.name);
  if (seed.written !== undefined) c.lastWrittenNick.set(USER, seed.written);
  return c;
}

const USER = memberId(1);

describe('nickname diff before PATCH', () => {
  it('writes NOTHING when the computed nick already matches the observed one', async () => {
    // The steady state, and the whole point of the phase: an unchanged member
    // costs no Discord PATCH, which means no echo event and no game-server POST.
    const c = caches({ nick: 'Aldric 20', name: 'Aldric 20', written: 'Aldric 20' });
    const calls: string[] = [];
    const result = await writeMemberNickname(USER, 'Aldric 20', c, {
      setNickname: async (_id, nick) => {
        calls.push(nick);
        return {};
      },
    });
    expect(result).toBe('skipped');
    expect(calls).toEqual([]);
  });

  it('writes when the nick differs, and moves all three caches together', async () => {
    const c = caches({ nick: 'Aldric 20', name: 'Aldric 20', written: 'Aldric 20' });
    const calls: { id: string; nick: string }[] = [];
    const result = await writeMemberNickname(USER, 'Aldric 21', c, {
      setNickname: async (id, nick) => {
        calls.push({ id, nick });
        return {};
      },
    });
    expect(result).toBe('written');
    expect(calls).toEqual([{ id: USER, nick: 'Aldric 21' }]);
    // All three, each asserted on its own: the raw nick is what the NEXT sweep
    // diffs against, the display name is what a members-meta record carries, and
    // lastWrittenNick is the only thing that can recognize the echo.
    expect(c.memberNicks.get(USER)).toBe('Aldric 21');
    expect(c.memberNames.get(USER)).toBe('Aldric 21');
    expect(c.lastWrittenNick.get(USER)).toBe('Aldric 21');
  });

  it('writes for a member whose nick has never been observed, and for one with none', async () => {
    // undefined means we cannot PROVE the write is redundant; null means they have
    // no nickname at all, which any computed nick differs from.
    for (const seed of [{}, { nick: null }] as const) {
      const c = caches(seed);
      let sent = 0;
      const result = await writeMemberNickname(USER, 'Aldric 20', c, {
        setNickname: async () => {
          sent += 1;
          return {};
        },
      });
      expect(result).toBe('written');
      expect(sent).toBe(1);
    }
  });

  it('leaves EVERY cache untouched when the PATCH fails, so the next sweep retries', async () => {
    // The arm a call-count assertion cannot make. If any of these moved, the next
    // sweep would believe the write had landed and never try again.
    const c = caches({ nick: 'Aldric 20', name: 'Aldric 20', written: 'Aldric 20' });
    const errors: unknown[] = [];
    let attempts = 0;
    const io = {
      setNickname: async (): Promise<unknown> => {
        attempts += 1;
        throw new Error('403 missing permissions');
      },
      onError: (e: unknown) => errors.push(e),
    };

    expect(await writeMemberNickname(USER, 'Aldric 21', c, io)).toBe('failed');
    expect(c.memberNicks.get(USER)).toBe('Aldric 20');
    expect(c.memberNames.get(USER)).toBe('Aldric 20');
    expect(c.lastWrittenNick.get(USER)).toBe('Aldric 20');
    expect(errors).toHaveLength(1);

    // The retry itself, which is what the untouched cache buys: a second sweep
    // still sees a difference and sends the PATCH again.
    expect(await writeMemberNickname(USER, 'Aldric 21', c, io)).toBe('failed');
    expect(attempts).toBe(2);
  });

  it('compares verbatim, with no trimming or normalization', async () => {
    // Trimming would make a name with a trailing space re-PATCH forever, which is
    // exactly the unconditional-write load this guard replaces.
    const c = caches({ nick: 'Aldric 20' });
    let sent = 0;
    await writeMemberNickname(USER, 'Aldric 20 ', c, {
      setNickname: async () => {
        sent += 1;
        return {};
      },
    });
    expect(sent).toBe(1);
  });
});

describe('members-meta diff before push', () => {
  it('pushes NOTHING when no member changed', async () => {
    const last = new Map<string, MemberMetaRecord>();
    const records = [record(memberId(1)), record(memberId(2))];
    // Clones, not the same object references: seeding with the identical objects
    // would let an identity compare (next !== last) pass this file.
    for (const r of records) last.set(r.discord_user_id, { ...r });
    const pushes: MemberMetaRecord[][] = [];
    const pushed = await pushChangedMemberMeta(records, last, {
      pushMembersMeta: async (batch) => {
        pushes.push(batch);
        return { updated: batch.length };
      },
    });
    expect(pushes).toEqual([]);
    expect(pushed).toEqual([]);
  });

  it('pushes only the members that changed, in input order', async () => {
    const last = new Map<string, MemberMetaRecord>();
    const records = [record(memberId(1)), record(memberId(2)), record(memberId(3))];
    // Clones, not the same object references: seeding with the identical objects
    // would let an identity compare (next !== last) pass this file.
    for (const r of records) last.set(r.discord_user_id, { ...r });
    const changed = [records[0], { ...records[1], role: 'admin' }, records[2]];
    const pushes: MemberMetaRecord[][] = [];
    const pushed = await pushChangedMemberMeta(changed, last, {
      pushMembersMeta: async (batch) => {
        pushes.push(batch);
        return { updated: batch.length };
      },
    });
    expect(pushes).toEqual([[{ ...records[1], role: 'admin' }]]);
    // WHICH record came back, not merely how many: a length check cannot tell the
    // accepted records apart from the batch's first element repeated.
    expect(pushed).toEqual([{ ...records[1], role: 'admin' }]);
    // And the cache now carries the NEW record, so a repeat sweep is silent.
    expect(last.get(memberId(2))?.role).toBe('admin');
    const again = await pushChangedMemberMeta(changed, last, {
      pushMembersMeta: async () => ({ updated: 1 }),
    });
    expect(again).toEqual([]);
  });

  it('never marks a batch clean when the server refuses it', async () => {
    // `call` answers null rather than throwing, so the return value is the only
    // success signal. Marking on a null would strand the whole batch.
    //
    // Only the marking, deliberately: these two records are ONE batch, so nothing
    // here can say whether a later batch would have been attempted. The stop rule
    // is pinned by the three-batch case below, which is the only place it is
    // falsifiable.
    const last = new Map<string, MemberMetaRecord>();
    const records = [record(memberId(1)), record(memberId(2))];
    const pushed = await pushChangedMemberMeta(records, last, {
      pushMembersMeta: async () => null,
    });
    expect(pushed).toEqual([]);
    expect(last.size).toBe(0);
    // Which means the very next sweep tries the same members again.
    const attempts: number[] = [];
    await pushChangedMemberMeta(records, last, {
      pushMembersMeta: async (batch) => {
        attempts.push(batch.length);
        return { updated: batch.length };
      },
    });
    expect(attempts).toEqual([2]);
  });

  it('keeps the byte-batching, and marks each batch as it succeeds', async () => {
    // Reaching the real batch size rather than asserting a bound it never meets.
    const total = MEMBERS_META_BATCH + 5;
    const records = Array.from({ length: total }, (_, i) => record(memberId(i)));
    const last = new Map<string, MemberMetaRecord>();
    const sizes: number[] = [];
    const pushed = await pushChangedMemberMeta(records, last, {
      pushMembersMeta: async (batch) => {
        sizes.push(batch.length);
        return { updated: batch.length };
      },
    });
    expect(sizes).toEqual([MEMBERS_META_BATCH, 5]);
    expect(pushed).toHaveLength(total);
    expect(last.size).toBe(total);
  });

  it('stops after a mid-run refusal, keeping the batches already accepted', async () => {
    // THREE batches with the refusal on the SECOND, which is what makes the word
    // "stops" mean anything: an earlier version of this case refused the LAST of
    // two batches, so there was no third batch to skip and the stop rule was
    // constant-true. Found by mutation, round four: replacing the `return` with a
    // `continue` (press on past a refusal) survived that version untouched.
    //
    // This is recorded deviation 3 of the phase, the roster push abandoning the
    // rest of the sweep rather than attempting it, and it is the assertion that
    // states it.
    const total = MEMBERS_META_BATCH * 2 + 5;
    const records = Array.from({ length: total }, (_, i) => record(memberId(i)));
    const last = new Map<string, MemberMetaRecord>();
    const sizes: number[] = [];
    const pushed = await pushChangedMemberMeta(records, last, {
      pushMembersMeta: async (batch) => {
        sizes.push(batch.length);
        return sizes.length === 1 ? { updated: batch.length } : null;
      },
    });
    // Two attempts, never three: the third batch is not tried at all, because
    // spending more requests on a server that already refused one is the thing
    // the stop rule exists to prevent.
    expect(sizes).toEqual([MEMBERS_META_BATCH, MEMBERS_META_BATCH]);
    expect(pushed).toHaveLength(MEMBERS_META_BATCH);
    // Exactly the accepted batch is remembered; the refused one and the untried
    // one are both left dirty, so the next sweep retries all of them.
    expect(last.size).toBe(MEMBERS_META_BATCH);
    expect(last.has(memberId(MEMBERS_META_BATCH))).toBe(false);
    expect(last.has(memberId(MEMBERS_META_BATCH * 2))).toBe(false);
  });

  it('pushes one member only when their record moved', async () => {
    const last = new Map<string, MemberMetaRecord>();
    const first = record(USER);
    let sent = 0;
    const io = {
      pushMembersMeta: async (): Promise<unknown> => {
        sent += 1;
        return { updated: 1 };
      },
    };
    expect(await pushOneMemberMeta(first, last, io)).toBe(true);
    expect(sent).toBe(1);
    expect(await pushOneMemberMeta(record(USER), last, io)).toBe(false);
    expect(sent).toBe(1);
    expect(await pushOneMemberMeta(record(USER, { role: 'mod' }), last, io)).toBe(true);
    expect(sent).toBe(2);
  });

  it('does not remember a single push the server refused', async () => {
    const last = new Map<string, MemberMetaRecord>();
    expect(await pushOneMemberMeta(record(USER), last, { pushMembersMeta: async () => null })).toBe(
      false,
    );
    expect(last.size).toBe(0);
  });
});

describe('self-echo suppression on GUILD_MEMBER_UPDATE', () => {
  const parse = { roles: reconcileMemberRolesFromUpdate, displayName: displayNameOf };
  const user = { id: USER, username: 'aldric', global_name: 'Aldric' };

  it('does not push when the update is only the nick this bot just wrote', async () => {
    // The echo loop closed: our PATCH comes back as an event carrying exactly what
    // we wrote, and answering it with a members-meta POST is the bot generating
    // load against itself.
    const decision = decideMemberUpdate(
      { nick: 'Aldric 21', roles: ['r1', 'r2'], user },
      user,
      { roles: ['r1', 'r2'], lastWrittenNick: 'Aldric 21' },
      parse,
    );
    expect(decision.push).toBe(false);
    // The caches still move: the decision suppresses the PUSH, never the bookkeeping.
    expect(decision.nick).toBe('Aldric 21');
    expect(decision.displayName).toBe('Aldric 21');
    expect(decision.roles).toEqual(['r1', 'r2']);
    // And the echo record is spent, so only the ONE echo a PATCH produces can be
    // suppressed by it.
    expect(decision.forgetWrittenNick).toBe(true);
  });

  it('does not drop a third-party rename BACK to a value the bot once wrote', () => {
    // Without consuming the echo record, this is the sequence that loses a real
    // change: the bot writes N; a moderator renames to M, which pushes; the
    // moderator reverts to N, which looks exactly like our echo and is dropped.
    // The caller applies forgetWrittenNick on the first echo, so by the time the
    // revert arrives there is no lastWrittenNick left to match against.
    const afterEcho = decideMemberUpdate(
      { nick: 'Aldric 21', roles: ['r1'], user },
      user,
      { roles: ['r1'], lastWrittenNick: 'Aldric 21' },
      parse,
    );
    expect(afterEcho.push).toBe(false);
    expect(afterEcho.forgetWrittenNick).toBe(true);

    // The caller having dropped the entry, the moderator's revert to the same
    // string is judged on its own merits and pushes.
    const revert = decideMemberUpdate(
      { nick: 'Aldric 21', roles: ['r1'], user },
      user,
      { roles: ['r1'], lastWrittenNick: undefined },
      parse,
    );
    expect(revert.push).toBe(true);
    expect(revert.forgetWrittenNick).toBe(false);
  });

  it('resolves the display name from the USER when the payload carries no nick', () => {
    // The only other displayName assertion sits on a payload whose nick is set,
    // and displayNameOf short-circuits on the nick before it ever reads its second
    // argument. So passing the WRONG second argument (the payload instead of the
    // user) survived every case in this file. These two reach past the nick.
    const noNick = { nick: null, roles: ['r1'], user };
    expect(
      decideMemberUpdate(noNick, user, { roles: ['r1'], lastWrittenNick: undefined }, parse)
        .displayName,
    ).toBe('Aldric');
    const bare = { id: USER, username: 'aldric' };
    expect(
      decideMemberUpdate(
        { nick: null, roles: ['r1'], user: bare },
        bare,
        { roles: ['r1'], lastWrittenNick: undefined },
        parse,
      ).displayName,
    ).toBe('aldric');
  });

  it('reports a role-only update, with no nick key at all, as having no nick', () => {
    // Discord documents `nick` as OPTIONAL on GUILD_MEMBER_UPDATE, so a role-only
    // update carries no nick key. nickOf is pinned for that shape directly, but
    // nothing drove it THROUGH the decision, which is where the caller reads it
    // and overwrites the raw-nick cache.
    //
    // The contract this states is the current one, deliberately: an absent key
    // reads as "no nickname", so the next sweep sees a null cached nick and does
    // PATCH again. That costs one write per role-only update on a member the bot
    // renames, which is the accepted price of not inventing a third state; the
    // alternative is tracked as a Phase 7 item rather than changed here.
    const decision = decideMemberUpdate(
      { roles: ['r1', 'r2'], user },
      user,
      { roles: ['r1'], lastWrittenNick: 'Aldric 21' },
      parse,
    );
    expect(decision.nick).toBeNull();
    expect(decision.roles).toEqual(['r1', 'r2']);
    // And it is NOT read as our echo, because the nick does not match what we wrote.
    expect(decision.push).toBe(true);
  });

  it('ignores role ORDER, which Discord does not promise', () => {
    const decision = decideMemberUpdate(
      { nick: 'Aldric 21', roles: ['r2', 'r1'], user },
      user,
      { roles: ['r1', 'r2'], lastWrittenNick: 'Aldric 21' },
      parse,
    );
    expect(decision.push).toBe(false);
  });

  it('still pushes a genuine third-party update', () => {
    // Each arm on its own, because any one of them alone passing would let a real
    // change be swallowed as an echo.
    const cached = { roles: ['r1', 'r2'], lastWrittenNick: 'Aldric 21' };
    // A role granted, same nick.
    expect(
      decideMemberUpdate(
        { nick: 'Aldric 21', roles: ['r1', 'r2', 'r3'], user },
        user,
        cached,
        parse,
      ).push,
    ).toBe(true);
    // A role removed, same nick.
    expect(
      decideMemberUpdate({ nick: 'Aldric 21', roles: ['r1'], user }, user, cached, parse).push,
    ).toBe(true);
    // A moderator renamed them to something we did not write.
    expect(
      decideMemberUpdate({ nick: 'Banned User', roles: ['r1', 'r2'], user }, user, cached, parse)
        .push,
    ).toBe(true);
    // Their nickname was cleared entirely.
    expect(
      decideMemberUpdate({ nick: null, roles: ['r1', 'r2'], user }, user, cached, parse).push,
    ).toBe(true);
    // We never wrote a nick for them at all, so nothing can be our echo.
    expect(
      decideMemberUpdate(
        { nick: 'Aldric 21', roles: ['r1', 'r2'], user },
        user,
        { roles: ['r1', 'r2'], lastWrittenNick: undefined },
        parse,
      ).push,
    ).toBe(true);
  });

  it('reports a payload that carried no roles array as null, leaving the cache alone', () => {
    const decision = decideMemberUpdate(
      { nick: 'Aldric 21', user },
      user,
      { roles: ['r1'], lastWrittenNick: 'Aldric 21' },
      parse,
    );
    expect(decision.roles).toBeNull();
    // With no roles in the payload the cached set is what the echo check compares,
    // so this is still recognized as our own write.
    expect(decision.push).toBe(false);
  });
});

describe('member name resolution', () => {
  it('prefers the guild nick, then the global name, then the username', () => {
    expect(displayNameOf({ nick: 'Nick' }, { global_name: 'Global', username: 'user' })).toBe(
      'Nick',
    );
    expect(displayNameOf({}, { global_name: 'Global', username: 'user' })).toBe('Global');
    expect(displayNameOf({}, { username: 'user' })).toBe('user');
    expect(displayNameOf({}, {})).toBe('Member');
  });

  it('reads the raw nick as null when absent or not a string', () => {
    // The distinction memberNames cannot make, and the reason the nick is cached
    // separately: "no nickname" is not the same as "a nickname equal to the
    // global name", and only the raw field can tell them apart.
    expect(nickOf({ nick: 'Nick' })).toBe('Nick');
    expect(nickOf({})).toBeNull();
    expect(nickOf({ nick: null })).toBeNull();
    expect(nickOf({ nick: 42 })).toBeNull();
  });
});

describe('a push the server did not take is never marked clean', () => {
  // `call()` returns null for a transport or envelope failure, but it also
  // returns `env.data` verbatim on a success envelope, so a body carrying no data
  // arrives as undefined. A `!== null` check would mark that batch clean.
  //
  // What used to stand here was `expect(pushRejectedShapes).toEqual([null,
  // undefined])`, a test-local const asserted against its own literal: it never
  // touched the module and passed for every possible implementation. The it.each
  // rows below are the real pin, so the tautology is gone and the array now DRIVES
  // them rather than being asserted about.
  it.each(pushRejectedShapes.map((v) => [String(v), v] as const))(
    'does not remember a batch when the push answered %s',
    async (_label, answer) => {
      const last = new Map<string, MemberMetaRecord>();
      const records = [record(memberId(1)), record(memberId(2))];
      const pushed = await pushChangedMemberMeta(records, last, {
        pushMembersMeta: async () => answer,
      });
      expect(pushed).toEqual([]);
      expect(last.size).toBe(0);
    },
  );

  it.each(pushRejectedShapes.map((v) => [String(v), v] as const))(
    'does not remember a single push that answered %s',
    async (_label, answer) => {
      const last = new Map<string, MemberMetaRecord>();
      expect(
        await pushOneMemberMeta(record(USER), last, { pushMembersMeta: async () => answer }),
      ).toBe(false);
      expect(last.size).toBe(0);
    },
  );

  it.each([
    ['zero', 0],
    ['false', false],
    ['an empty string', ''],
  ])('DOES remember a batch when the push answered %s', async (_label, answer) => {
    // The other arm, and the one nothing covered: every success stub in this file
    // answers a truthy object and every failure stub answers null or undefined, so
    // rewriting the nullish check as a plain `!result` truthiness check survived
    // the whole suite. These three shapes are the ones the two differ on.
    const last = new Map<string, MemberMetaRecord>();
    const records = [record(memberId(1)), record(memberId(2))];
    const pushed = await pushChangedMemberMeta(records, last, {
      pushMembersMeta: async () => answer,
    });
    expect(pushed).toHaveLength(2);
    expect(last.size).toBe(2);
  });

  it('lets a REJECTING push propagate rather than swallowing it', async () => {
    // Distinct from a refusal: the game client answers null, it does not throw, so
    // a throw here means something unexpected and the scheduler's error arm should
    // see it rather than this silently reporting an empty push.
    const last = new Map<string, MemberMetaRecord>();
    await expect(
      pushChangedMemberMeta([record(USER)], last, {
        pushMembersMeta: async () => {
          throw new Error('socket hang up');
        },
      }),
    ).rejects.toThrow(new Error('socket hang up'));
    expect(last.size).toBe(0);
  });

  it('honors a custom batch size', async () => {
    // The default is pinned against a literal elsewhere; this proves the parameter
    // is actually used rather than shadowed by the default.
    expect(MEMBERS_META_BATCH).toBe(200);
    const records = Array.from({ length: 7 }, (_, i) => record(memberId(i)));
    const sizes: number[] = [];
    await pushChangedMemberMeta(
      records,
      new Map<string, MemberMetaRecord>(),
      {
        pushMembersMeta: async (batch) => {
          sizes.push(batch.length);
          return { updated: batch.length };
        },
      },
      3,
    );
    expect(sizes).toEqual([3, 3, 1]);
  });
});

describe('the diff cache cannot believe itself forever', () => {
  const HOUR = 60 * 60_000;

  it('pins the resync interval against a literal', () => {
    // Against a LITERAL, never against itself: an hour is the ceiling on how long
    // a bot-versus-server divergence can last, so it is a reviewed number.
    expect(FULL_RESYNC_INTERVAL_MS).toBe(3_600_000);
  });

  it('holds the cache for the whole interval and drops it exactly at the end', () => {
    expect(dueForFullResync(0, 0)).toBe(false);
    expect(dueForFullResync(0, HOUR - 1)).toBe(false);
    // At the boundary, not one millisecond past it.
    expect(dueForFullResync(0, HOUR)).toBe(true);
    expect(dueForFullResync(0, HOUR + 1)).toBe(true);
    // And it measures ELAPSED time, not absolute time, so a long-lived process
    // keeps re-syncing rather than doing it once and never again.
    expect(dueForFullResync(50 * HOUR, 50 * HOUR + HOUR - 1)).toBe(false);
    expect(dueForFullResync(50 * HOUR, 50 * HOUR + HOUR)).toBe(true);
  });

  it('re-syncs rather than postponing when the clock is unusable', () => {
    // Every one of these would otherwise read as "loads of time left". Not
    // knowing how much time passed is a reason to re-push, never a reason to
    // keep trusting a cache.
    expect(dueForFullResync(Number.NaN, 1000)).toBe(true);
    expect(dueForFullResync(1000, Number.NaN)).toBe(true);
    expect(dueForFullResync(Number.POSITIVE_INFINITY, 1000)).toBe(true);
    // A clock stepped BACKWARDS by an NTP correction.
    expect(dueForFullResync(10 * HOUR, 9 * HOUR)).toBe(true);
  });

  it('honors a custom interval, and falls back to the default for an unusable one', () => {
    // The happy path FIRST: every other case here relies on the default, so
    // ignoring the third argument entirely would survive them all.
    expect(dueForFullResync(0, 4999, 5000)).toBe(false);
    expect(dueForFullResync(0, 5000, 5000)).toBe(true);

    // A zero or negative interval would make EVERY sweep a full re-push, which is
    // precisely the load this phase removed.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(dueForFullResync(0, HOUR - 1, bad)).toBe(false);
      expect(dueForFullResync(0, HOUR, bad)).toBe(true);
    }
  });

  it('clears the cache and RESTAMPS only when the interval is up', async () => {
    // The transition, not just the decision. Forgetting the restamp makes every
    // later sweep a full re-push, which is exactly the load D5 removed, and it is
    // invisible from the predicate alone.
    const last = new Map<string, MemberMetaRecord>();
    last.set(USER, record(USER));

    // Not yet due: nothing cleared, and the timestamp is carried through unmoved.
    expect(fullResyncIfDue(1000, 1000 + HOUR - 1, last)).toBe(1000);
    expect(last.size).toBe(1);

    // Due: the cache is emptied AND the clock is restamped to now, so the next
    // sweep starts a fresh interval instead of re-syncing forever.
    expect(fullResyncIfDue(1000, 1000 + HOUR, last)).toBe(1000 + HOUR);
    expect(last.size).toBe(0);

    // Proving the restamp: one interval on from the value just returned is still
    // not due, which is only true if the returned value moved.
    last.set(USER, record(USER));
    expect(fullResyncIfDue(1000 + HOUR, 1000 + HOUR + 1, last)).toBe(1000 + HOUR);
    expect(last.size).toBe(1);
    // And the custom interval reaches this layer too.
    expect(fullResyncIfDue(0, 5000, last, 5000)).toBe(5000);
    expect(last.size).toBe(0);
  });
});

describe('the refresh-then-push pair', () => {
  it('pushes IN ORDER after a successful refresh', async () => {
    const order: string[] = [];
    const errors: unknown[] = [];
    await refreshThenPushMeta({
      refresh: async () => {
        order.push('refresh');
      },
      push: async () => {
        order.push('push');
      },
      onRefreshError: (e) => errors.push(e),
    });
    // Ordered, because the push reads the index the refresh rebuilds.
    expect(order).toEqual(['refresh', 'push']);
    expect(errors).toEqual([]);
  });

  it('still pushes when the refresh THROWS, and reports the failure', async () => {
    // The arm that matters, and the one no source pin can make: a catch that
    // rethrows is textually identical to one that swallows. Before this phase the
    // GUILD_CREATE and backfill paths pushed with no refresh in front of them at
    // all, so a failed guild-roles GET must not take the push with it.
    const order: string[] = [];
    const errors: unknown[] = [];
    const boom = new Error('breaker open');
    await refreshThenPushMeta({
      refresh: async () => {
        order.push('refresh');
        throw boom;
      },
      push: async () => {
        order.push('push');
      },
      onRefreshError: (e) => errors.push(e),
    });
    expect(order).toEqual(['refresh', 'push']);
    expect(errors).toEqual([boom]);
  });

  it('lets a failing PUSH propagate, so the task error arm sees it', async () => {
    // Only the refresh is swallowed. A push that throws is unexpected (the client
    // answers null rather than throwing) and must reach the task's error sink.
    await expect(
      refreshThenPushMeta({
        refresh: async () => {},
        push: async () => {
          throw new Error('socket hang up');
        },
        onRefreshError: () => {
          throw new Error('must not be called');
        },
      }),
    ).rejects.toThrow(new Error('socket hang up'));
  });

  it('makes the sweep after a resync push a member the server silently dropped', async () => {
    // The end-to-end reason the interval exists. The server writes stored meta
    // with an UPDATE against the link row and counts the push accepted even when
    // it matched no row, so a member who has not linked yet is marked clean on
    // the first sweep and never re-pushed. Their flair appears only when the diff
    // cache is dropped.
    const applied = new Map<string, MemberMetaRecord>();
    const linked = new Set<string>();
    const io = {
      pushMembersMeta: async (records: MemberMetaRecord[]) => {
        // The real endpoint's shape: it reports every record as updated whether
        // or not the row existed.
        for (const r of records)
          if (linked.has(r.discord_user_id)) applied.set(r.discord_user_id, r);
        return { updated: records.length };
      },
    };
    const last = new Map<string, MemberMetaRecord>();
    const staff = record(USER, { role: 'mods' });

    // Sweep one: the member is in the guild but has not linked, so the server
    // stores nothing, yet the bot is told the push landed.
    await pushChangedMemberMeta([staff], last, io);
    expect(applied.has(USER)).toBe(false);
    expect(last.has(USER)).toBe(true);

    // They link. Nothing about their DISCORD record changed, so every diffed
    // sweep from here on sends nothing and their staff tag never appears.
    linked.add(USER);
    await pushChangedMemberMeta([staff], last, io);
    expect(applied.has(USER)).toBe(false);

    // The forced resync is what breaks the deadlock.
    expect(dueForFullResync(0, FULL_RESYNC_INTERVAL_MS)).toBe(true);
    last.clear();
    await pushChangedMemberMeta([staff], last, io);
    expect(applied.get(USER)).toEqual(staff);
  });
});

describe('forgetting a departed member', () => {
  it('drops every diff cache, so a rejoin re-pushes instead of being suppressed', async () => {
    // The rejoin trap. Leave the last-pushed record behind and a member who leaves
    // and comes back is diffed against their PRE-DEPARTURE state, so the push that
    // would restore their flair is suppressed and the game shows them cleared
    // indefinitely. This is the round trip, not just the deletes.
    const c = caches({ nick: 'Aldric 20', name: 'Aldric 20', written: 'Aldric 20' });
    const last = new Map<string, MemberMetaRecord>();
    const io = { pushMembersMeta: async (): Promise<unknown> => ({ updated: 1 }) };
    await pushOneMemberMeta(record(USER), last, io);
    expect(last.has(USER)).toBe(true);

    forgetMember(c, last, USER);
    expect(c.memberNicks.has(USER)).toBe(false);
    expect(c.lastWrittenNick.has(USER)).toBe(false);
    expect(last.has(USER)).toBe(false);

    // The rejoin: the SAME record must push again, which it only can because the
    // cache entry went with them.
    expect(await pushOneMemberMeta(record(USER), last, io)).toBe(true);
    // And their nickname is written again rather than skipped as unchanged.
    let sent = 0;
    expect(
      await writeMemberNickname(USER, 'Aldric 20', c, {
        setNickname: async () => {
          sent += 1;
          return {};
        },
      }),
    ).toBe('written');
    expect(sent).toBe(1);
  });

  it('leaves other members alone', () => {
    const c = caches({ nick: 'Aldric 20' });
    const other = memberId(2);
    c.memberNicks.set(other, 'Bryn 12');
    const last = new Map<string, MemberMetaRecord>([[other, record(other)]]);
    forgetMember(c, last, USER);
    expect(c.memberNicks.get(other)).toBe('Bryn 12');
    expect(last.has(other)).toBe(true);
  });
});

describe('nickname write, remaining arms', () => {
  it('does not require an onError sink', async () => {
    const c = caches({ nick: 'Aldric 20' });
    await expect(
      writeMemberNickname(USER, 'Aldric 21', c, {
        setNickname: async () => {
          throw new Error('403');
        },
      }),
    ).resolves.toBe('failed');
    expect(c.memberNicks.get(USER)).toBe('Aldric 20');
  });
});

describe('member update decision, remaining arms', () => {
  it('pushes when the payload carries no roles AND the nick is not ours', () => {
    // The null-roles path exists only as an echo case; this is its other arm.
    const user = { id: USER, username: 'aldric' };
    const decision = decideMemberUpdate(
      { nick: 'Renamed By A Mod', user },
      user,
      { roles: ['r1'], lastWrittenNick: 'Aldric 21' },
      { roles: reconcileMemberRolesFromUpdate, displayName: displayNameOf },
    );
    expect(decision.roles).toBeNull();
    expect(decision.push).toBe(true);
  });
});
