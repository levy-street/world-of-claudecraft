// The linked-member set and the paced pass that re-syncs it (bot/linked_sweep.ts).
//
// The module is a BELIEF about who has a linked game account, assembled from
// three signals of different strengths, and most of what is worth asserting here
// is how far each signal is allowed to move it. Two of the arms below are the
// ones that decide whether a bug here is cosmetic or guild-wide:
//  - a flex-batch answer whose `requested` echo does not match what was sent is
//    SUSPECT, and absence in it proves nothing. A consumer that stripped flair
//    for the ids missing from a truncated answer would clear most of the guild
//    in one pass, so the assertion is that the absent ids SURVIVE.
//  - a members-meta push that reports no `unapplied` field at all decides
//    nothing. Reading the missing field as an empty list would mark every id in
//    the batch linked, and on the hourly full resync that batch is the whole
//    roster.
// Everything is pure, so all of it runs with no clock and no network: the time
// dependent entry points take nowMs and are driven at exact instants.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SWEEP_SLICE_SIZE,
  departedFromSeed,
  type FlexBatchLike,
  LinkedSweep,
  resolveSliceSize,
  SWEEP_SLICE_MAX,
  type SweepSlice,
  terminalLinkKind,
  unappliedIdsFrom,
} from '../bot/linked_sweep';
import { FLEX_BATCH_LIMIT } from '../bot/server_client';

/** Ids as STRINGS: a Discord snowflake is past Number.MAX_SAFE_INTEGER. */
function memberId(index: number): string {
  return `1122334455${String(index).padStart(9, '0')}`;
}

const A = memberId(1);
const B = memberId(2);
const C = memberId(3);
const D = memberId(4);
const E = memberId(5);

function ids(count: number, from = 100): string[] {
  return Array.from({ length: count }, (_, i) => memberId(from + i));
}

function item(discordUserId: string, kinds: string[]): { discordUserId: string; kinds: string[] } {
  return { discordUserId, kinds };
}

/** Every id is a guild member. */
const anyMember = (): boolean => true;

/** Only these ids are guild members. */
function rosterOf(...members: string[]): (id: string) => boolean {
  const set = new Set(members);
  return (id: string) => set.has(id);
}

/** A flex-batch answer: `requested` and the ids that came back. */
function answer(requested: number, present: string[]): FlexBatchLike {
  return { requested, members: present.map((id) => ({ discord_user_id: id })) };
}

/** An answer that is authoritative for exactly what was sent. */
function authoritativeAnswer(sent: string[], present: string[]): FlexBatchLike {
  return answer(new Set(sent).size, present);
}

/**
 * A sweep that already believes `linked` are linked, with the dirty queue
 * drained so a fixture starts in the settled steady state.
 *
 * The interval is infinite while draining so the drain cannot itself open a
 * pass: `lastPassStartedAtMs` is left untouched, which is what lets the window
 * assertions start from "a pass is due at any clock origin".
 */
function seeded(linked: string[]): LinkedSweep {
  const sweep = new LinkedSweep();
  sweep.applyMetaPushOutcome(linked, []);
  while (sweep.dirtyIds().length > 0) {
    sweep.nextSlice(0, SWEEP_SLICE_MAX, Number.POSITIVE_INFINITY);
  }
  return sweep;
}

/** Drain a whole pass at one instant, answering nothing. Returns the ids served. */
function drainPass(sweep: LinkedSweep, nowMs: number, sliceSize: number, intervalMs: number) {
  const slices: SweepSlice[] = [];
  for (;;) {
    const slice = sweep.nextSlice(nowMs, sliceSize, intervalMs);
    if (slice === null) break;
    slices.push(slice);
  }
  return { slices, served: slices.flatMap((s) => s.ids) };
}

describe('terminalLinkKind', () => {
  it('reads the LAST linkage kind, so the two orders of one window differ', () => {
    // `kinds` is merged in first-seen order, which makes it a sequence rather
    // than a set: an account that unlinked and relinked inside one drain window
    // is linked, and one that linked and then unlinked is not. Reading it as a
    // set ("does it contain unlink") collapses both onto unlinked, which drops a
    // relinked member from the sweep until the hourly resync notices.
    expect(terminalLinkKind(['unlink', 'link'])).toBe('link');
    expect(terminalLinkKind(['link', 'unlink'])).toBe('unlink');
  });

  it('ignores the kinds that report no linkage transition', () => {
    expect(terminalLinkKind(['flex', 'points'])).toBe(null);
    expect(terminalLinkKind([])).toBe(null);
    // A transition anywhere in the sequence still decides it, whatever rides along.
    expect(terminalLinkKind(['flex', 'link', 'points'])).toBe('link');
    expect(terminalLinkKind(['points', 'unlink', 'flex'])).toBe('unlink');
  });
});

describe('departedFromSeed', () => {
  it('names exactly the cached ids the seed session did not observe', () => {
    const departed = departedFromSeed([A, B, C], new Set([A, C]));
    expect(departed).toEqual([B]);
  });

  it('reports nobody when the seed covered every cached member', () => {
    expect(departedFromSeed([A, B], new Set([A, B, C]))).toEqual([]);
    expect(departedFromSeed([], new Set([A]))).toEqual([]);
  });
});

describe('unappliedIdsFrom', () => {
  it('separates a MISSING field from an empty one', () => {
    // The distinction the whole L14 signal rests on: a server that predates the
    // field answers without it, and an empty array is a real "none were
    // unapplied". Collapsing them would put the entire roster into the linked
    // set on the first hourly resync.
    expect(unappliedIdsFrom({ updated: 3 })).toBe(undefined);
    expect(unappliedIdsFrom({ updated: 3, unapplied: [] })).toEqual([]);
  });

  it('answers undefined for every shape that carries no id list', () => {
    expect(unappliedIdsFrom(null)).toBe(undefined);
    expect(unappliedIdsFrom(undefined)).toBe(undefined);
    expect(unappliedIdsFrom('unapplied')).toBe(undefined);
    expect(unappliedIdsFrom({ unapplied: null })).toBe(undefined);
    expect(unappliedIdsFrom({ unapplied: 4 })).toBe(undefined);
  });

  it('keeps only the string entries of a list', () => {
    expect(unappliedIdsFrom({ unapplied: [A, 7, null, B] })).toEqual([A, B]);
  });
});

describe('resolveSliceSize', () => {
  it('falls back to the default for every unusable size, never to 0', () => {
    // A zero slice would hand back an empty list forever, which reads as a sweep
    // that quietly stopped rather than one that failed.
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      expect(resolveSliceSize(bad)).toBe(DEFAULT_SWEEP_SLICE_SIZE);
    }
  });

  it('floors a fractional size and clamps at one request capacity', () => {
    expect(resolveSliceSize(1.9)).toBe(1);
    expect(resolveSliceSize(37)).toBe(37);
    expect(resolveSliceSize(SWEEP_SLICE_MAX + 1)).toBe(SWEEP_SLICE_MAX);
    expect(resolveSliceSize(1_000_000)).toBe(SWEEP_SLICE_MAX);
  });
});

describe('slice bounds', () => {
  it('pins the slice ceiling against the flex-batch request cap', () => {
    // Two independently declared constants that must not drift: the ceiling is
    // a relationship ("a slice may never exceed what one request carries"), so
    // both are pinned against the literal AND against each other.
    expect(SWEEP_SLICE_MAX).toBe(1000);
    expect(FLEX_BATCH_LIMIT).toBe(1000);
    expect(SWEEP_SLICE_MAX).toBe(FLEX_BATCH_LIMIT);
    expect(DEFAULT_SWEEP_SLICE_SIZE).toBe(100);
    expect(DEFAULT_SWEEP_SLICE_SIZE).toBeLessThan(SWEEP_SLICE_MAX);
  });

  it('reaches the requested size exactly and never exceeds it', () => {
    const sweep = seeded(ids(250));
    const first = sweep.nextSlice(10_000, 100, 5_000);
    expect(first?.ids.length).toBe(100);
    expect(sweep.remainingInPass()).toBe(150);
    const second = sweep.nextSlice(10_000, 100, 5_000);
    expect(second?.ids.length).toBe(100);
    // The tail is what is left, not a padded slice.
    const third = sweep.nextSlice(10_000, 100, 5_000);
    expect(third?.ids.length).toBe(50);
    expect(sweep.remainingInPass()).toBe(0);
  });

  it('clamps an over-cap slice size down to one request capacity', () => {
    const sweep = seeded(ids(1_500));
    const first = sweep.nextSlice(10_000, 5_000, 5_000);
    expect(first?.ids.length).toBe(SWEEP_SLICE_MAX);
    expect(sweep.remainingInPass()).toBe(500);
  });
});

describe('link-change feed', () => {
  it('stops flairing the OLD id on a repoint and invents no new one', () => {
    // The feed's binding contract: a repoint item carries only the id it held at
    // enqueue, because the row for the new one is not the row that moved. The
    // new identity arrives through flex-batch or the members-meta resync, and a
    // consumer that guessed it from the item would flair whoever the guess hit.
    const sweep = seeded([A]);
    const summary = sweep.applyLinkChangeItems([item(A, ['unlink'])], rosterOf(A, B));
    expect(summary.removed).toEqual([A]);
    expect(summary.added).toEqual([]);
    expect(sweep.has(A)).toBe(false);
    expect(sweep.has(B)).toBe(false);
    expect(sweep.size()).toBe(0);
  });

  it('keeps a member who unlinked and relinked inside one window', () => {
    const sweep = seeded([A]);
    const summary = sweep.applyLinkChangeItems([item(A, ['unlink', 'link'])], anyMember);
    expect(sweep.has(A)).toBe(true);
    expect(summary.removed).toEqual([]);
    // The link row is FRESH, so the meta the bot believes it pushed is attached
    // to a row that no longer exists.
    expect(summary.metaStale).toEqual([A]);
    expect(summary.dirtied).toEqual([A]);
  });

  it('drops a member who linked and then unlinked inside one window', () => {
    const sweep = seeded([]);
    const summary = sweep.applyLinkChangeItems([item(A, ['link', 'unlink'])], anyMember);
    expect(sweep.has(A)).toBe(false);
    expect(summary.added).toEqual([]);
    expect(summary.dirtied).toEqual([]);
    // The row is gone, so anything cached for them applies to nothing.
    expect(sweep.hasNoLinkRow(A)).toBe(true);
  });

  it('skips a malformed item and still applies the well-formed ones beside it', () => {
    // Item-level tolerance matching the consumer's stream-level listOf: the
    // apply runs AFTER the outbox drain consumed all four streams, so a throw
    // on one malformed element would reject the whole poll and lose every
    // relay and activity post in the same envelope. One bad item costs itself.
    const sweep = seeded([]);
    const malformed = [
      null,
      42,
      'u9',
      { kinds: ['link'] },
      { kinds: ['link'], discordUserId: 7 },
      { kinds: ['link'], discordUserId: '' },
      { kinds: 'link', discordUserId: A },
    ] as unknown as Parameters<typeof sweep.applyLinkChangeItems>[0];

    const summary = sweep.applyLinkChangeItems([...malformed, item(B, ['link'])], anyMember);

    // The non-array kinds item carries a usable id: it proves nothing terminal,
    // but linkage evidence still applies (the same reading a flex item gets).
    expect(summary.added).toEqual([A, B]);
    expect(summary.removed).toEqual([]);
    expect(sweep.has(B)).toBe(true);
  });

  it('applies successive items in order, so the last one decides', () => {
    const sweep = seeded([]);
    sweep.applyLinkChangeItems([item(A, ['link'])], anyMember);
    expect(sweep.has(A)).toBe(true);
    sweep.applyLinkChangeItems([item(A, ['unlink'])], anyMember);
    expect(sweep.has(A)).toBe(false);
    sweep.applyLinkChangeItems([item(A, ['link'])], anyMember);
    expect(sweep.has(A)).toBe(true);
  });

  it('adds only guild members, and unlinks whatever the roster says', () => {
    // An id that is not in the guild cannot be flaired, and adding it would put
    // a member of the pass beyond every removal path. An unlink is applied
    // anyway: a member who left AND unlinked in one window must not survive on
    // the roster check.
    const sweep = seeded([A]);
    const added = sweep.applyLinkChangeItems([item(B, ['link'])], rosterOf(A));
    expect(added.added).toEqual([]);
    expect(sweep.has(B)).toBe(false);
    const removed = sweep.applyLinkChangeItems([item(A, ['unlink'])], rosterOf());
    expect(removed.removed).toEqual([A]);
    expect(sweep.size()).toBe(0);
  });

  it('treats a flex or points move as proof of linkage, and dirties it', () => {
    const sweep = seeded([]);
    const summary = sweep.applyLinkChangeItems([item(A, ['flex']), item(B, ['points'])], anyMember);
    expect(summary.added).toEqual([A, B]);
    expect(summary.dirtied).toEqual([A, B]);
    // No fresh row is implied by either kind, so nothing is declared stale.
    expect(summary.metaStale).toEqual([]);
  });

  it('declares a fresh link row stale even for a member already believed linked', () => {
    const sweep = seeded([A]);
    const summary = sweep.applyLinkChangeItems([item(A, ['link'])], anyMember);
    expect(summary.added).toEqual([]);
    expect(summary.metaStale).toEqual([A]);
  });

  it('skips an item with no id at all rather than tracking an empty string', () => {
    const sweep = seeded([]);
    const summary = sweep.applyLinkChangeItems([item('', ['link'])], anyMember);
    expect(summary.added).toEqual([]);
    expect(sweep.size()).toBe(0);
  });
});

describe('flex-batch answers', () => {
  it('drops the ids an AUTHORITATIVE answer left out', () => {
    const sweep = seeded([A, B, C]);
    const summary = sweep.applyFlexBatchResult([A, B, C], authoritativeAnswer([A, B, C], [A]));
    expect(summary.authoritative).toBe(true);
    expect([...summary.removed].sort()).toEqual([B, C].sort());
    expect(sweep.linkedIds()).toEqual([A]);
  });

  it('applies POSITIVE evidence only when the requested echo does not match', () => {
    // The mass-clear arm. A truncated or partly dropped request answers with a
    // shorter list and the same 200, so absence in it says nothing at all; the
    // decisive claim is that the two ids missing from the answer SURVIVE.
    const sweep = seeded([A, B, C]);
    const summary = sweep.applyFlexBatchResult([A, B, C], answer(2, [A]));
    expect(summary.authoritative).toBe(false);
    expect(summary.removed).toEqual([]);
    expect(sweep.has(B)).toBe(true);
    expect(sweep.has(C)).toBe(true);
    expect(sweep.size()).toBe(3);
  });

  it('still learns from the members a SUSPECT answer did return', () => {
    const sweep = seeded([]);
    const summary = sweep.applyFlexBatchResult([A, B], answer(1, [A]));
    expect(summary.authoritative).toBe(false);
    expect(summary.added).toEqual([A]);
    expect(sweep.has(A)).toBe(true);
    expect(sweep.has(B)).toBe(false);
  });

  it('counts DISTINCT ids sent, so a repeat does not read as truncation', () => {
    // The server counts what survived its cap, its non-string drop and its
    // de-duplication, so a caller comparing against its raw array length would
    // read a perfectly delivered answer as suspect and never clear anybody.
    const sweep = seeded([A, B]);
    const summary = sweep.applyFlexBatchResult([A, B, A], answer(2, [A]));
    expect(summary.authoritative).toBe(true);
    expect(summary.removed).toEqual([B]);
    expect(sweep.linkedIds()).toEqual([A]);
  });

  it('ignores members the answer carries that were never asked about', () => {
    // Only what was sent can be reasoned about: an answer must not be able to
    // aim the sweep's role and nickname writes at an arbitrary guild member.
    const sweep = seeded([]);
    const summary = sweep.applyFlexBatchResult([A], authoritativeAnswer([A], [A, E]));
    expect(summary.added).toEqual([A]);
    expect(sweep.has(E)).toBe(false);
    expect(sweep.size()).toBe(1);
  });

  it('reports a member whose meta never landed once they are seen linked', () => {
    const sweep = seeded([]);
    // The push applied to no row: they had not linked yet. L14 keeps their
    // record cached (leaving them dirty would re-push most of the guild every
    // pass), so the correction has to ride the moment they are seen linked.
    sweep.applyMetaPushOutcome([A], [A]);
    expect(sweep.hasNoLinkRow(A)).toBe(true);
    const first = sweep.applyFlexBatchResult([A], authoritativeAnswer([A], [A]));
    expect(first.metaStale).toEqual([A]);
    expect(sweep.hasNoLinkRow(A)).toBe(false);
    // Consumed once: a second confirmation is not a second fresh row, and
    // re-reporting it would drop the cached record on every pass forever.
    const second = sweep.applyFlexBatchResult([A], authoritativeAnswer([A], [A]));
    expect(second.metaStale).toEqual([]);
  });

  it('an unlink raced by its own in-flight slice heals through the meta push', () => {
    // The documented staleness (Phase 6 QA): the slice holding A is already in
    // flight when the feed unlinks A, so the stale answer's positive evidence
    // re-adds them. Every leg of the heal is asserted by value, because the
    // heal is the reason the staleness is acceptable at all.
    const sweep = seeded([A, B]);
    // The slice is LOAD-BEARING: its ids are what the stale answer below is
    // built from, so deleting the take leaves nothing to answer with (the
    // fresh-eyes round found the first cut used literals and the race was
    // scene-setting).
    const slice = sweep.nextSlice(0, SWEEP_SLICE_MAX, 1000);
    const sliceIds = [...(slice?.ids ?? [])];
    expect([...sliceIds].sort()).toEqual([A, B].sort());
    // The feed unlinks A while the slice's answer is still in flight.
    const feed = sweep.applyLinkChangeItems([item(A, ['unlink'])], anyMember);
    expect(feed.removed).toEqual([A]);
    expect(sweep.has(A)).toBe(false);
    expect(sweep.hasNoLinkRow(A)).toBe(true);
    // The stale answer lands: A is re-added (the staleness), but flagged
    // metaStale, which is what makes the wiring re-push their meta.
    const stale = sweep.applyFlexBatchResult(sliceIds, authoritativeAnswer(sliceIds, sliceIds));
    expect(stale.added).toEqual([A]);
    expect(stale.metaStale).toEqual([A]);
    expect(sweep.has(A)).toBe(true);
    // The re-pushed meta answers unapplied (the row really is gone), and the
    // outcome unlinks them again: healed with no resync and no feed replay.
    const heal = sweep.applyMetaPushOutcome([A, B], [A]);
    expect(heal.removed).toEqual([A]);
    expect(sweep.has(A)).toBe(false);
    expect(sweep.hasNoLinkRow(A)).toBe(true);
  });
});

describe('members-meta linkage signal', () => {
  it('reads the response in BOTH directions over one batch', () => {
    const sweep = seeded([A, B]);
    const summary = sweep.applyMetaPushOutcome([A, B, C], [B]);
    expect(summary.removed).toEqual([B]);
    expect(summary.added).toEqual([C]);
    expect(summary.dirtied).toEqual([C]);
    expect(sweep.has(B)).toBe(false);
    expect(sweep.hasNoLinkRow(B)).toBe(true);
    expect(sweep.has(C)).toBe(true);
    expect(sweep.hasNoLinkRow(C)).toBe(false);
  });

  it('infers NOTHING when the response carries no unapplied field', () => {
    // The whole-guild hazard: on the hourly full resync the batch IS the whole
    // roster, so reading a missing field as "none were unapplied" would put
    // every member of the guild into the sweep at once.
    const sweep = seeded([A]);
    const summary = sweep.applyMetaPushOutcome([A, B, C], undefined);
    expect(summary).toEqual({ added: [], removed: [], dirtied: [] });
    expect(sweep.linkedIds()).toEqual([A]);
    expect(sweep.dirtyIds()).toEqual([]);
  });

  it('ignores unapplied ids the batch did not carry', () => {
    const sweep = seeded([A, B]);
    const summary = sweep.applyMetaPushOutcome([A], [B]);
    expect(summary.removed).toEqual([]);
    expect(sweep.has(B)).toBe(true);
  });

  it('counts a repeated batch id once', () => {
    const sweep = seeded([]);
    const summary = sweep.applyMetaPushOutcome([A, A], []);
    expect(summary.added).toEqual([A]);
    expect(summary.dirtied).toEqual([A]);
  });
});

describe('pass scheduling', () => {
  it('opens the first pass at any clock origin, then holds the window exactly', () => {
    const sweep = seeded([A, B]);
    const first = sweep.nextSlice(10_000, 10, 5_000);
    expect(first?.opensPass).toBe(true);
    expect(first?.source).toBe('pass');
    expect(first?.ids).toEqual([A, B]);
    expect(sweep.lastPassStartedAtMs()).toBe(10_000);
    // One millisecond short of the window is still no work, and the millisecond
    // it opens is a pass: a >= boundary written as > would slip a whole tick.
    expect(sweep.nextSlice(14_999, 10, 5_000)).toBe(null);
    const second = sweep.nextSlice(15_000, 10, 5_000);
    expect(second?.ids).toEqual([A, B]);
    expect(sweep.lastPassStartedAtMs()).toBe(15_000);
  });

  it('forces a pass mid-window on request, and consumes the request', () => {
    // GUILD_CREATE's kick calls requestPass first, because a kick alone only
    // wakes the task EARLY: it would find the window open and do nothing, on
    // the one event that means the bot's view of the guild may be stale.
    const sweep = seeded([A]);
    sweep.nextSlice(10_000, 10, 5_000);
    expect(sweep.nextSlice(11_000, 10, 5_000)).toBe(null);
    sweep.requestPass();
    expect(sweep.isPassRequested()).toBe(true);
    const forced = sweep.nextSlice(11_000, 10, 5_000);
    expect(forced?.ids).toEqual([A]);
    expect(sweep.isPassRequested()).toBe(false);
    expect(sweep.lastPassStartedAtMs()).toBe(11_000);
    // And exactly one: the request does not stand for a second pass.
    expect(sweep.nextSlice(11_001, 10, 5_000)).toBe(null);
  });

  it('stamps the window for a pass over nobody and consumes the request', () => {
    // Otherwise an empty set re-enters the pass branch on every single tick,
    // and a standing request would never be spent.
    const sweep = new LinkedSweep();
    sweep.requestPass();
    expect(sweep.nextSlice(10_000, 10, 5_000)).toBe(null);
    expect(sweep.lastPassStartedAtMs()).toBe(10_000);
    expect(sweep.isPassRequested()).toBe(false);
    // A member who links after that empty pass is served through the dirty
    // queue rather than waiting the window out.
    sweep.applyLinkChangeItems([item(A, ['link'])], anyMember);
    const slice = sweep.nextSlice(10_001, 10, 5_000);
    expect(slice?.ids).toEqual([A]);
    expect(slice?.source).toBe('dirty');
  });

  it('falls back to event-driven passes when the interval is unusable', () => {
    // The safe direction for a phase about LOAD: a lost config value degrades
    // to passes driven by GUILD_CREATE, never to a full pass on every tick,
    // which against a 3 second slice cadence is a continuous rescan.
    for (const bad of [0, -5, Number.NaN, undefined]) {
      const sweep = seeded([A]);
      expect(sweep.nextSlice(10_000, 10, bad)).toBe(null);
      sweep.requestPass();
      expect(sweep.nextSlice(10_000, 10, bad)?.ids).toEqual([A]);
    }
  });

  it('treats a clock that went backwards as due rather than postponing', () => {
    const sweep = seeded([A]);
    sweep.nextSlice(100_000, 10, 5_000);
    expect(sweep.nextSlice(101_000, 10, 5_000)).toBe(null);
    const afterJump = sweep.nextSlice(90_000, 10, 5_000);
    expect(afterJump?.ids).toEqual([A]);
    expect(sweep.lastPassStartedAtMs()).toBe(90_000);
  });

  it('serves dirty members before the rest of the pass in flight', () => {
    const sweep = seeded([A, B, C, D]);
    const first = sweep.nextSlice(10_000, 2, 5_000);
    expect(first?.ids).toEqual([A, B]);
    expect(sweep.remainingInPass()).toBe(2);
    // Something tells us D moved while the pass is only half done.
    sweep.applyLinkChangeItems([item(D, ['flex'])], anyMember);
    const urgent = sweep.nextSlice(10_001, 2, 5_000);
    expect(urgent?.source).toBe('dirty');
    expect(urgent?.ids).toEqual([D]);
    expect(urgent?.opensPass).toBe(false);
    // The pass then resumes where it was, rather than restarting.
    const resumed = sweep.nextSlice(10_002, 2, 5_000);
    expect(resumed?.source).toBe('pass');
    expect(resumed?.ids).toEqual([C, D]);
  });

  it('takes a dirty queue larger than one slice a slice at a time', () => {
    // The periodic pass is deliberately UNCONFIGURED here (a virgin sweep's
    // first pass is otherwise always due, and the alternation bound would
    // interleave it after the first dirty slice): this arm isolates the dirty
    // queue's own pacing; the interleaving with contending pass work has its
    // own describe below.
    const sweep = seeded([]);
    sweep.applyLinkChangeItems(
      ids(5).map((id) => item(id, ['link'])),
      anyMember,
    );
    const first = sweep.nextSlice(10_000, 2, undefined);
    expect(first?.ids).toEqual(ids(5).slice(0, 2));
    expect(sweep.dirtyIds()).toEqual(ids(5).slice(2));
    const second = sweep.nextSlice(10_000, 2, undefined);
    expect(second?.ids).toEqual(ids(5).slice(2, 4));
  });
});

describe('discovery versus steady state (D6)', () => {
  it('walks the whole roster on discovery, then only the linked set after it', () => {
    // The claim the phase turns on. The old sweep read every ONLINE member every
    // interval; this one reads the roster exactly once per complete seed and
    // every pass after that reads only the members who are actually linked.
    const roster = ids(1_000);
    const linked = new Set(roster.filter((_, i) => i % 20 === 0));
    expect(linked.size).toBe(50);

    const sweep = new LinkedSweep();
    expect(sweep.armDiscovery(roster)).toBe(true);
    const discovered: string[] = [];
    for (;;) {
      const slice = sweep.nextSlice(10_000, 100, 5_000);
      if (slice === null) break;
      expect(slice.source).toBe('discovery');
      expect(slice.ids.length).toBeLessThanOrEqual(100);
      discovered.push(...slice.ids);
      sweep.applyFlexBatchResult(
        slice.ids,
        authoritativeAnswer(
          slice.ids,
          slice.ids.filter((id) => linked.has(id)),
        ),
      );
    }
    // Discovery asked about every roster member exactly once...
    expect(discovered.length).toBe(1_000);
    expect(new Set(discovered).size).toBe(1_000);
    expect(sweep.size()).toBe(50);

    // ...and the steady-state pass that follows asks about the 50 and nobody
    // else. Compared by VALUE, so a pass that quietly walked the roster again
    // (or the online set, or any superset) fails here.
    const { served } = drainPass(sweep, 20_000, 100, 5_000);
    expect(served.length).toBe(50);
    expect([...served].sort()).toEqual([...linked].sort());
    for (const id of roster) {
      if (!linked.has(id)) expect(served).not.toContain(id);
    }
  });

  it('arms one discovery at a time, so a reconnect storm cannot restart it', () => {
    // Discord re-sends GUILD_CREATE on every re-IDENTIFY, so the complete-seed
    // path is reached repeatedly during exactly the storm this packet exists
    // for. Re-arming would restart the full-roster walk from the beginning each
    // time, which is a continuous rescan.
    const sweep = new LinkedSweep();
    expect(sweep.armDiscovery([A, B, C])).toBe(true);
    expect(sweep.armDiscovery([A, B, C])).toBe(false);
    expect(sweep.isDiscoveryPending()).toBe(true);
    const first = sweep.nextSlice(10_000, 2, 5_000);
    expect(first?.ids).toEqual([A, B]);
    // Still outstanding while the walk is in flight.
    expect(sweep.armDiscovery([A, B, C])).toBe(false);
    expect(sweep.nextSlice(10_000, 2, 5_000)?.ids).toEqual([C]);
    // Spent. The next complete seed may arm a fresh one.
    expect(sweep.armDiscovery([A, B, C])).toBe(true);
  });

  it('runs a pending discovery ahead of the periodic pass', () => {
    // A discovery is a strict superset of a periodic pass (the roster contains
    // every linked member), so running the periodic one first would ask about
    // the same members twice in a row.
    const sweep = seeded([A]);
    sweep.armDiscovery([A, B, C]);
    const slice = sweep.nextSlice(10_000, 10, 5_000);
    expect(slice?.source).toBe('discovery');
    expect(slice?.ids).toEqual([A, B, C]);
    expect(sweep.lastPassStartedAtMs()).toBe(10_000);
  });
});

describe('roster pruning (L16)', () => {
  it('drops departed members from the set, the dirty queue and the pass', () => {
    const sweep = seeded([A, B, C, D]);
    const first = sweep.nextSlice(10_000, 2, 5_000);
    expect(first?.ids).toEqual([A, B]);
    expect(sweep.remainingInPass()).toBe(2);
    sweep.applyLinkChangeItems([item(E, ['link'])], anyMember);
    expect(sweep.dirtyIds()).toEqual([E]);

    // C and D left while the gateway was down; E is still here.
    const dropped = sweep.pruneToRoster(new Set([A, B, E]));
    expect([...dropped].sort()).toEqual([C, D].sort());
    expect(sweep.has(C)).toBe(false);
    expect(sweep.has(D)).toBe(false);
    expect(sweep.remainingInPass()).toBe(0);
    expect(sweep.dirtyIds()).toEqual([E]);
    expect([...sweep.linkedIds()].sort()).toEqual([A, B, E].sort());
  });

  it('drops a departed member who was waiting in the dirty queue', () => {
    const sweep = seeded([A]);
    sweep.applyLinkChangeItems([item(A, ['flex'])], anyMember);
    expect(sweep.dirtyIds()).toEqual([A]);
    expect(sweep.pruneToRoster(new Set([B]))).toEqual([A]);
    expect(sweep.dirtyIds()).toEqual([]);
    expect(sweep.nextSlice(10_000, 10, 5_000)).toBe(null);
  });

  it('bounds the no-link-row bookkeeping by the roster too', () => {
    // It is a set of ids, so without this it would grow for the life of the
    // process: every unlinked member of every hourly resync lands in it.
    const sweep = seeded([]);
    sweep.applyMetaPushOutcome([A, B], [A, B]);
    expect(sweep.hasNoLinkRow(A)).toBe(true);
    expect(sweep.hasNoLinkRow(B)).toBe(true);
    sweep.pruneToRoster(new Set([B]));
    expect(sweep.hasNoLinkRow(A)).toBe(false);
    expect(sweep.hasNoLinkRow(B)).toBe(true);
  });

  it('changes nothing when the whole set is still in the guild', () => {
    const sweep = seeded([A, B]);
    expect(sweep.pruneToRoster(new Set([A, B, C]))).toEqual([]);
    expect([...sweep.linkedIds()].sort()).toEqual([A, B].sort());
  });
});

describe('restoring an unanswered slice', () => {
  it('re-serves a pass slice ahead of the rest of the pass', () => {
    // server_client answers null for a failed call rather than throwing, so a
    // failed request means nothing was observed. Skipping the slice instead
    // would leave those members unsynced until the next whole pass with nothing
    // recording that it happened.
    const sweep = seeded([A, B, C, D]);
    const slice = sweep.nextSlice(10_000, 2, 5_000);
    expect(slice?.ids).toEqual([A, B]);
    expect(sweep.remainingInPass()).toBe(2);
    sweep.restoreSlice(slice as SweepSlice);
    expect(sweep.remainingInPass()).toBe(4);
    const again = sweep.nextSlice(10_000, 2, 5_000);
    expect(again?.ids).toEqual([A, B]);
    expect(again?.source).toBe('pass');
    expect(again?.opensPass).toBe(false);
  });

  it('keeps a restored discovery slice on the discovery source', () => {
    const sweep = new LinkedSweep();
    sweep.armDiscovery([A, B, C]);
    const slice = sweep.nextSlice(10_000, 2, 5_000) as SweepSlice;
    expect(slice.source).toBe('discovery');
    sweep.restoreSlice(slice);
    const again = sweep.nextSlice(10_000, 2, 5_000);
    expect(again?.source).toBe('discovery');
    expect(again?.ids).toEqual([A, B]);
  });

  it('puts a dirty slice back, minus anyone unlinked while it was in flight', () => {
    const sweep = seeded([A, B]);
    sweep.applyLinkChangeItems([item(A, ['flex']), item(B, ['flex'])], anyMember);
    const slice = sweep.nextSlice(0, 10, Number.POSITIVE_INFINITY) as SweepSlice;
    expect(slice.source).toBe('dirty');
    expect(slice.ids).toEqual([A, B]);
    // The feed decides B while the request is in flight. Re-dirtying them would
    // put a member the feed just removed back into the sweep.
    sweep.applyLinkChangeItems([item(B, ['unlink'])], anyMember);
    sweep.restoreSlice(slice);
    expect(sweep.dirtyIds()).toEqual([A]);
    expect(sweep.has(B)).toBe(false);
  });
});

describe('set invariants', () => {
  it('never leaves a dirty id that is not in the linked set', () => {
    // The dirty queue drives writes, so an id in it that nothing believes is
    // linked would be flaired with no evidence at all. Every removal path has
    // to drop both, so all three are exercised here.
    const sweep = seeded([A, B, C]);
    sweep.applyLinkChangeItems(
      [item(A, ['flex']), item(B, ['flex']), item(C, ['flex'])],
      anyMember,
    );
    expect(sweep.dirtyIds()).toEqual([A, B, C]);
    sweep.applyLinkChangeItems([item(A, ['unlink'])], anyMember);
    sweep.applyMetaPushOutcome([B], [B]);
    sweep.applyFlexBatchResult([C], authoritativeAnswer([C], []));
    expect(sweep.dirtyIds()).toEqual([]);
    expect(sweep.linkedIds()).toEqual([]);
  });

  it('reports no pass in flight once the last slice has been handed out', () => {
    const sweep = seeded([A, B]);
    expect(sweep.isPassInProgress()).toBe(false);
    expect(sweep.passSource()).toBe(null);
    const first = sweep.nextSlice(10_000, 1, 5_000);
    expect(first?.ids).toEqual([A]);
    expect(sweep.isPassInProgress()).toBe(true);
    expect(sweep.passSource()).toBe('pass');
    sweep.nextSlice(10_000, 1, 5_000);
    expect(sweep.isPassInProgress()).toBe(false);
    expect(sweep.passSource()).toBe(null);
  });
});

describe('forgetting a departed member (GUILD_MEMBER_REMOVE)', () => {
  // Phase 6 QA: departure does not delete the link row, so flex-batch keeps
  // answering for a departed member and the pass would keep spending a slice
  // slot plus doomed 404 writes on them until the next complete seed. forget()
  // is the single-member prune the GUILD_MEMBER_REMOVE handler calls.

  it('drops the member from the linked and dirty sets and reports whether they were linked', () => {
    const sweep = seeded([A, B]);
    sweep.applyLinkChangeItems([item(A, ['flex'])], anyMember);
    expect(sweep.dirtyIds()).toEqual([A]);

    expect(sweep.forget(A)).toBe(true);
    expect(sweep.has(A)).toBe(false);
    expect(sweep.dirtyIds()).toEqual([]);
    expect(sweep.size()).toBe(1);
    // Idempotent, and honest about it: a repeat (or a never-linked id) is false.
    expect(sweep.forget(A)).toBe(false);
    expect(sweep.forget(C)).toBe(false);
  });

  it('removes them from a pass in flight but leaves a discovery walk alone', () => {
    const sweep = seeded([A, B, C]);
    sweep.requestPass();
    const first = sweep.nextSlice(0, 1, Number.POSITIVE_INFINITY);
    expect(first?.source).toBe('pass');
    expect(sweep.remainingInPass()).toBe(2);

    sweep.forget(B);
    expect(sweep.remainingInPass()).toBe(1);
    expect(sweep.nextSlice(0, 10, Number.POSITIVE_INFINITY)?.ids).toEqual([C]);

    // A discovery cursor is a ROSTER snapshot that holds unlinked ids by design
    // and answers for them harmlessly, so it is deliberately not spliced.
    const discovering = seeded([A]);
    discovering.armDiscovery([A, B, C]);
    const dFirst = discovering.nextSlice(0, 1, undefined);
    expect(dFirst?.source).toBe('discovery');
    expect(discovering.remainingInPass()).toBe(2);
    discovering.forget(A);
    expect(discovering.has(A)).toBe(false);
    expect(discovering.remainingInPass()).toBe(2);
  });

  it('ends the no-link-row bookkeeping, unlike an unlink', () => {
    // An unlink keeps the memory (the member is still in the guild, so a fresh
    // link must re-push their meta); a departure has no member left to re-push.
    const sweep = new LinkedSweep();
    sweep.applyMetaPushOutcome([A], [A]);
    expect(sweep.hasNoLinkRow(A)).toBe(true);
    sweep.forget(A);
    expect(sweep.hasNoLinkRow(A)).toBe(false);
  });
});

describe('flex-batch roster gate (the in-flight departure race)', () => {
  // A slice's answer can arrive AFTER a departure or a seed prune removed the
  // member: positive evidence from that stale answer must not re-add an id no
  // removal path could then reach until the next complete seed. The gate
  // mirrors applyLinkChangeItems' roster check.

  it('cannot re-add a member the roster no longer has', () => {
    const sweep = seeded([A]);
    sweep.forget(A);

    const summary = sweep.applyFlexBatchResult([A], authoritativeAnswer([A], [A]), rosterOf(B));
    expect(summary.added).toEqual([]);
    expect(summary.metaStale).toEqual([]);
    expect(sweep.has(A)).toBe(false);
    expect(sweep.size()).toBe(0);
  });

  it('still reads a gated id as ANSWERED, so absence removes only the truly absent', () => {
    // B is still linked, off the roster only as far as the GATE can see (the
    // caller's roster predicate and the linked set are updated by different
    // paths, and this module cannot assume they agree). The answer carries B,
    // so B must count as present: not re-added, and NOT removed as absent.
    // A, sent and genuinely absent from an authoritative answer, is removed.
    // Stamping `present` above the gate is what keeps the two verdicts
    // independent: stamping below it would read every gated id as absent and
    // unlink them on the spot.
    const sweep = seeded([A, B]);

    const summary = sweep.applyFlexBatchResult(
      [A, B],
      authoritativeAnswer([A, B], [B]),
      rosterOf(A),
    );
    expect(summary.added).toEqual([]);
    expect(summary.removed).toEqual([A]);
    expect(sweep.has(A)).toBe(false);
    // B survives: the gate blocks ADDITIONS only, and B answered.
    expect(sweep.has(B)).toBe(true);
  });

  it('applies exactly as before when no gate is supplied', () => {
    const sweep = new LinkedSweep();
    const summary = sweep.applyFlexBatchResult([A], authoritativeAnswer([A], [A]));
    expect(summary.added).toEqual([A]);
    expect(sweep.has(A)).toBe(true);
  });
});

describe('dirty and pass alternation (bounded preemption)', () => {
  it('alternates dirty and cursor slices, so a busy feed cannot starve the pass', () => {
    // The sustained-feed shape: one dirty id arrives before EVERY ask. Unbounded
    // dirty-first would never serve the cursor again, and the pass is the safety
    // net for exactly the members nothing reported moving.
    const linked = ids(6);
    const sweep = seeded(linked);
    sweep.requestPass();
    const sources: string[] = [sweep.nextSlice(0, 1, Number.POSITIVE_INFINITY)?.source ?? 'none'];
    for (const feeder of linked) {
      sweep.applyLinkChangeItems([item(feeder, ['flex'])], anyMember);
      sources.push(sweep.nextSlice(0, 1, Number.POSITIVE_INFINITY)?.source ?? 'none');
    }
    expect(sources).toEqual(['pass', 'dirty', 'pass', 'dirty', 'pass', 'dirty', 'pass']);
    // The pass ADVANCED under pressure (5 remaining after the opening slice,
    // 2 now), and once the feed quiets the rest drains to completion.
    expect(sweep.remainingInPass()).toBe(2);
    drainPass(sweep, 0, 1, Number.POSITIVE_INFINITY);
    expect(sweep.remainingInPass()).toBe(0);
    expect(sweep.dirtyIds()).toEqual([]);
  });

  it('still serves dirty back to back when no pass is contending', () => {
    const sweep = seeded([A, B]);
    sweep.applyLinkChangeItems([item(A, ['flex'])], anyMember);
    expect(sweep.nextSlice(0, 1, Number.POSITIVE_INFINITY)?.source).toBe('dirty');
    sweep.applyLinkChangeItems([item(B, ['flex'])], anyMember);
    expect(sweep.nextSlice(0, 1, Number.POSITIVE_INFINITY)?.source).toBe('dirty');
  });
});

describe('alternation covers PENDING pass work (the fresh-eyes starvation catch)', () => {
  // The first bound only counted a cursor already in flight, and the fresh-eyes
  // probe starved a requested pass and an armed discovery twelve slices out of
  // twelve: dirty won every ask, so beginPass was never reached. The bound now
  // counts pass-shaped work that has not opened yet.

  it('a requested pass opens under sustained dirt', () => {
    const linked = ids(4);
    const sweep = seeded(linked);
    sweep.requestPass();
    const sources: string[] = [];
    for (const feeder of linked) {
      sweep.applyLinkChangeItems([item(feeder, ['flex'])], anyMember);
      sources.push(sweep.nextSlice(0, 1, Number.POSITIVE_INFINITY)?.source ?? 'none');
    }
    expect(sources).toEqual(['pass', 'dirty', 'pass', 'dirty']);
    expect(sweep.isPassRequested()).toBe(false);
  });

  it('an armed discovery walk opens under sustained dirt', () => {
    const sweep = seeded([A]);
    sweep.armDiscovery([A, B, C]);
    const sources: string[] = [];
    for (let i = 0; i < 4; i++) {
      sweep.applyLinkChangeItems([item(A, ['flex'])], anyMember);
      sources.push(sweep.nextSlice(0, 1, undefined)?.source ?? 'none');
    }
    expect(sources).toEqual(['discovery', 'dirty', 'discovery', 'dirty']);
    expect(sweep.isDiscoveryPending()).toBe(false);
  });

  it('serves dirty when an armed discovery turns out empty, never answering null over work', () => {
    // The caution the fix round was warned about: beginPass over an empty
    // snapshot yields null, and the gate must fall back to the dirty queue
    // rather than reporting no work while work exists. (An empty PASS cannot
    // coincide with dirty work, since dirty is a subset of linked; an empty
    // roster snapshot can.)
    const sweep = seeded([A]);
    sweep.armDiscovery([]);
    sweep.applyLinkChangeItems([item(A, ['flex'])], anyMember);
    const slice = sweep.nextSlice(0, 1, Number.POSITIVE_INFINITY);
    expect(slice?.source).toBe('dirty');
    expect(slice?.ids).toEqual([A]);
    expect(sweep.isDiscoveryPending()).toBe(false);
  });
});

describe('restoring a slice after a mid-flight forget', () => {
  it('drops a forgotten member from a restored PASS slice, restores a discovery snapshot whole', () => {
    const sweep = seeded([A, B, C]);
    sweep.requestPass();
    const slice = sweep.nextSlice(0, 2, Number.POSITIVE_INFINITY);
    expect(slice?.source).toBe('pass');
    expect(slice?.ids).toEqual([A, B]);
    sweep.forget(A);
    sweep.restoreSlice(slice as SweepSlice);
    // A does not come back: the pass cursor holds exactly the linked set.
    expect(sweep.nextSlice(0, 10, Number.POSITIVE_INFINITY)?.ids).toEqual([B, C]);

    // A discovery snapshot holds unlinked ids by design and answers for them
    // harmlessly, so the restore keeps it whole.
    const discovering = seeded([D]);
    discovering.armDiscovery([D, E]);
    const dSlice = discovering.nextSlice(0, 2, undefined);
    expect(dSlice?.source).toBe('discovery');
    expect(dSlice?.ids).toEqual([D, E]);
    discovering.forget(D);
    discovering.restoreSlice(dSlice as SweepSlice);
    expect(discovering.nextSlice(0, 10, undefined)?.ids).toEqual([D, E]);
  });
});
