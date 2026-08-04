// Covers server/discord_link_changes.ts, the linked-member change feed the bot drains
// through the outbox poll (enqueueLinkChange / drainLinkChanges / requeueLinkChanges /
// linkChangeDepth).
//
// TIME IS FULLY INJECTED: enqueueLinkChange takes `now`, and the module has no Date.now,
// no timer and no internal clock. NEVER reach for vi.useFakeTimers here; every boundary
// below is driven by passing a literal `now`.
//
// STATE LEAK: the queue and the pending-dedupe index are module-global singletons, so
// every block drains in beforeEach. A WHOLE drain (no argument) also clears the dedupe
// index, which is the reset seam AND the behaviour the "never crosses a drain" block
// below pins; the paged drain clears only its own page, which is its own block.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  drainLinkChanges,
  enqueueLinkChange,
  LINK_CHANGE_DEDUPE_TTL_MS,
  LINK_CHANGE_MAX_QUEUE,
  linkChangeDepth,
  type QueuedLinkChange,
  requeueLinkChanges,
} from '../../server/discord_link_changes';

// Mints a NEW object every call. The queue copies what it stores, but an expectation
// built from the very object handed to enqueueLinkChange would still be a
// constant-self-comparison the day that copy is removed. Expectation literals come from
// here, never from the enqueued object.
const change = (accountId: number): QueuedLinkChange => ({ accountId, kinds: ['flex'] });

describe('discord link change feed: enqueue and drain', () => {
  beforeEach(() => {
    drainLinkChanges();
  });

  it('drains in FIFO order, by value, and leaves the queue empty', () => {
    enqueueLinkChange(change(1), 0);
    enqueueLinkChange(change(2), 0);
    enqueueLinkChange(change(3), 0);

    // Fresh literals from the helper, never the objects handed to enqueueLinkChange.
    expect(drainLinkChanges()).toEqual([change(1), change(2), change(3)]);
    expect(linkChangeDepth()).toBe(0);
  });

  it('returns an empty array and depth 0 on an immediate second drain', () => {
    enqueueLinkChange(change(1), 0);
    expect(drainLinkChanges()).toHaveLength(1);

    // The drained array is a new array, not an alias of the queue, so a second poll of
    // the same tick sees nothing.
    expect(drainLinkChanges()).toEqual([]);
    expect(linkChangeDepth()).toBe(0);
  });

  it('carries the Discord id when the enqueue site has it, and omits it when it does not', () => {
    enqueueLinkChange({ accountId: 1, discordId: '1234', kinds: ['link'] }, 0);
    enqueueLinkChange({ accountId: 2, kinds: ['unlink'] }, 0);

    expect(drainLinkChanges()).toEqual([
      { accountId: 1, discordId: '1234', kinds: ['link'] },
      { accountId: 2, kinds: ['unlink'] },
    ]);
  });

  it('stores a copy, so a caller reusing its record cannot rewrite a queued item', () => {
    // Merges mutate the STORED kinds array, so holding the caller's array would let a
    // call site that reuses one record corrupt items already queued.
    const reused: QueuedLinkChange = { accountId: 1, kinds: ['flex'] };
    enqueueLinkChange(reused, 0);
    reused.kinds.push('points');
    reused.accountId = 99;

    expect(drainLinkChanges()).toEqual([{ accountId: 1, kinds: ['flex'] }]);
  });

  it('collapses repeated kinds within one enqueue', () => {
    enqueueLinkChange({ accountId: 1, kinds: ['flex', 'points', 'flex'] }, 0);

    expect(drainLinkChanges()).toEqual([{ accountId: 1, kinds: ['flex', 'points'] }]);
  });
});

describe('discord link change feed: depth accessor', () => {
  beforeEach(() => {
    drainLinkChanges();
  });

  it('tracks enqueue, ignores a deduped enqueue, and resets on drain', () => {
    expect(linkChangeDepth()).toBe(0);
    enqueueLinkChange(change(1), 0);
    expect(linkChangeDepth()).toBe(1);
    enqueueLinkChange(change(2), 0);
    expect(linkChangeDepth()).toBe(2);

    // A merge into account 1's open item must not grow the queue.
    enqueueLinkChange({ accountId: 1, kinds: ['points'] }, 1);
    expect(linkChangeDepth()).toBe(2);

    drainLinkChanges();
    expect(linkChangeDepth()).toBe(0);
  });
});

describe('discord link change feed: overflow backstop', () => {
  beforeEach(() => {
    drainLinkChanges();
  });

  it('holds exactly LINK_CHANGE_MAX_QUEUE at the boundary and drops nothing', () => {
    for (let n = 1; n <= LINK_CHANGE_MAX_QUEUE; n++) enqueueLinkChange(change(n), 0);

    expect(linkChangeDepth()).toBe(LINK_CHANGE_MAX_QUEUE);
    const drained = drainLinkChanges();
    // Nothing trimmed: the oldest item pushed is still first.
    expect(drained[0]).toEqual(change(1));
    expect(drained[drained.length - 1]).toEqual(change(LINK_CHANGE_MAX_QUEUE));
  });

  it('drops the OLDEST when NOTHING in the queue is playtime noise', () => {
    // The fallback arm of the eviction preference. Every item here is a 'flex' change,
    // so no item qualifies as playtime noise and plain oldest-first is what runs.
    //
    // The cap must actually be REACHED for this to mean anything: MAX + 1 distinct
    // accounts (distinct so dedupe never absorbs one), then a toBe on the exact depth. A
    // toBeLessThanOrEqual here would be constant-true and would stay green with the
    // overflow trim deleted entirely.
    for (let n = 1; n <= LINK_CHANGE_MAX_QUEUE + 1; n++) enqueueLinkChange(change(n), 0);

    expect(linkChangeDepth()).toBe(LINK_CHANGE_MAX_QUEUE);
    const drained = drainLinkChanges();
    expect(drained).toHaveLength(LINK_CHANGE_MAX_QUEUE);
    // accountId identifies each item, so WHICH end was trimmed is decidable: account 1
    // is gone, account 2 is the new head, and the most recent enqueue survived.
    expect(drained[0]).toEqual(change(2));
    expect(drained[drained.length - 1]).toEqual(change(LINK_CHANGE_MAX_QUEUE + 1));
    expect(drained.some((c) => c.accountId === 1)).toBe(false);
  });

  it('evicts the oldest playtime-noise item and spares an OLDER link item', () => {
    // THE eviction-preference test. A long bot outage fills this feed with points
    // changes from the playtime sweep, which reaches every player whether or not they
    // linked Discord; a 'link'/'unlink' item is rare and carries the only copy of the
    // Discord id the bot needs to start or stop flairing that member. Plain oldest-first
    // spends the rare item to make room for the common one, which is the defect here.
    //
    // The link item is deliberately the OLDEST thing in the queue, so oldest-first and
    // preference-first disagree about what to drop and the assertion can tell them apart.
    enqueueLinkChange({ accountId: 1, discordId: 'du1', kinds: ['link'] }, 0);
    enqueueLinkChange({ accountId: 2, kinds: ['points'] }, 0);
    enqueueLinkChange({ accountId: 3, kinds: ['points'] }, 0);
    for (let n = 4; n <= LINK_CHANGE_MAX_QUEUE; n++) enqueueLinkChange(change(n), 0);
    expect(linkChangeDepth()).toBe(LINK_CHANGE_MAX_QUEUE);

    // One over the cap: exactly one item has to go.
    enqueueLinkChange(change(LINK_CHANGE_MAX_QUEUE + 1), 0);

    expect(linkChangeDepth()).toBe(LINK_CHANGE_MAX_QUEUE);
    const drained = drainLinkChanges();
    // Survivors pinned BY VALUE at the head, where the disagreement is: the link item
    // is still first, the SECOND noise item is untouched, and account 2 (the oldest
    // noise) is the one that went.
    expect(drained[0]).toEqual({ accountId: 1, discordId: 'du1', kinds: ['link'] });
    expect(drained[1]).toEqual({ accountId: 3, kinds: ['points'] });
    expect(drained.some((c) => c.accountId === 2)).toBe(false);
    expect(drained[drained.length - 1]).toEqual(change(LINK_CHANGE_MAX_QUEUE + 1));
  });

  it('treats a points item that CARRIES a Discord id as worth keeping', () => {
    // The two halves of the noise predicate are both load-bearing. A points item with a
    // carried id is deliverable without any lookup at all, so it is not the noise class,
    // and the trim must fall back to oldest-first rather than spending it.
    enqueueLinkChange({ accountId: 1, kinds: ['flex'] }, 0);
    enqueueLinkChange({ accountId: 2, discordId: 'du2', kinds: ['points'] }, 0);
    for (let n = 3; n <= LINK_CHANGE_MAX_QUEUE; n++) enqueueLinkChange(change(n), 0);

    enqueueLinkChange(change(LINK_CHANGE_MAX_QUEUE + 1), 0);

    const drained = drainLinkChanges();
    // Account 1 was the oldest and went; the id-carrying points item survived.
    expect(drained.some((c) => c.accountId === 1)).toBe(false);
    expect(drained[0]).toEqual({ accountId: 2, discordId: 'du2', kinds: ['points'] });
  });

  it('refuses a NEW noise item at the cap instead of spending an older item on it', () => {
    // The self-eviction corner of the preference, stated deliberately rather than left
    // to be discovered: at a full queue the newest playtime-noise enqueue is itself the
    // oldest-and-cheapest thing to drop, so it never displaces anything. The queue's
    // contents are unchanged and the depth never moves.
    for (let n = 1; n <= LINK_CHANGE_MAX_QUEUE; n++) enqueueLinkChange(change(n), 0);

    enqueueLinkChange({ accountId: LINK_CHANGE_MAX_QUEUE + 1, kinds: ['points'] }, 0);

    expect(linkChangeDepth()).toBe(LINK_CHANGE_MAX_QUEUE);
    const drained = drainLinkChanges();
    expect(drained[0]).toEqual(change(1));
    expect(drained[drained.length - 1]).toEqual(change(LINK_CHANGE_MAX_QUEUE));
    expect(drained.some((c) => c.accountId === LINK_CHANGE_MAX_QUEUE + 1)).toBe(false);
  });

  it('never merges into an item the cap evicted', () => {
    // An evicted item is gone from the queue, so merging into it would silently discard
    // the change, the same defect class as deduping against drained history.
    enqueueLinkChange(change(1), 0);
    for (let n = 2; n <= LINK_CHANGE_MAX_QUEUE + 1; n++) enqueueLinkChange(change(n), 0);
    expect(linkChangeDepth()).toBe(LINK_CHANGE_MAX_QUEUE);

    // Two kinds, so the re-enqueue is not itself playtime noise and cannot be the item
    // the trim picks; what is under test is the evicted item's dedupe entry, not the
    // preference.
    enqueueLinkChange({ accountId: 1, kinds: ['flex', 'points'] }, 1);

    const drained = drainLinkChanges();
    expect(drained.filter((c) => c.accountId === 1)).toEqual([
      { accountId: 1, kinds: ['flex', 'points'] },
    ]);
    // It is a genuinely new item at the tail, not the evicted one resurrected.
    expect(drained[drained.length - 1]).toEqual({ accountId: 1, kinds: ['flex', 'points'] });
  });

  it('never merges into a noise item the PREFERENCE evicted', () => {
    // Same invariant on the other eviction path: the preference must delete the dropped
    // item's pending entry too, or an enqueue for that account inside the TTL would fold
    // into an item nobody will ever drain.
    enqueueLinkChange({ accountId: 1, kinds: ['points'] }, 0);
    for (let n = 2; n <= LINK_CHANGE_MAX_QUEUE; n++) enqueueLinkChange(change(n), 0);
    enqueueLinkChange(change(LINK_CHANGE_MAX_QUEUE + 1), 0); // evicts account 1's noise

    enqueueLinkChange({ accountId: 1, kinds: ['flex'] }, 1);

    const drained = drainLinkChanges();
    expect(drained[drained.length - 1]).toEqual({ accountId: 1, kinds: ['flex'] });
  });
});

describe('discord link change feed: paged drain', () => {
  beforeEach(() => {
    drainLinkChanges();
  });

  it('returns the first page in FIFO order and leaves the remainder queued', () => {
    for (let n = 1; n <= 5; n++) enqueueLinkChange(change(n), 0);

    expect(drainLinkChanges(2)).toEqual([change(1), change(2)]);
    expect(linkChangeDepth()).toBe(3);
  });

  it('returns the remainder on the next drain, nothing lost and nothing repeated', () => {
    for (let n = 1; n <= 5; n++) enqueueLinkChange(change(n), 0);
    drainLinkChanges(2);

    expect(drainLinkChanges(2)).toEqual([change(3), change(4)]);
    expect(drainLinkChanges()).toEqual([change(5)]);
    expect(linkChangeDepth()).toBe(0);
  });

  it('keeps the remainder OPEN, so a later change merges into the item still queued', () => {
    // The reason a page may only clear ITS OWN dedupe entries. Account 3 was not
    // delivered, so its item is still the account's open item and a burst inside the TTL
    // must fold into it rather than mint a second item for the same account.
    for (let n = 1; n <= 3; n++) enqueueLinkChange(change(n), 0);
    drainLinkChanges(2);

    enqueueLinkChange({ accountId: 3, kinds: ['points'] }, 10);

    expect(linkChangeDepth()).toBe(1);
    expect(drainLinkChanges()).toEqual([{ accountId: 3, kinds: ['flex', 'points'] }]);
  });

  it('closes the dedupe entries of the items it DID hand over', () => {
    // The other half of the same rule: a paged item is delivered, so deduping against it
    // afterwards would lose the change (the invariant the whole-drain block pins).
    for (let n = 1; n <= 3; n++) enqueueLinkChange(change(n), 0);
    drainLinkChanges(2);

    enqueueLinkChange({ accountId: 1, kinds: ['points'] }, 10);

    expect(drainLinkChanges()).toEqual([change(3), { accountId: 1, kinds: ['points'] }]);
  });

  it('drains everything when the page is at or above the depth', () => {
    for (let n = 1; n <= 3; n++) enqueueLinkChange(change(n), 0);

    expect(drainLinkChanges(3)).toEqual([change(1), change(2), change(3)]);
    expect(linkChangeDepth()).toBe(0);

    for (let n = 1; n <= 2; n++) enqueueLinkChange(change(n), 0);
    expect(drainLinkChanges(99)).toEqual([change(1), change(2)]);
    expect(linkChangeDepth()).toBe(0);
  });
});

describe('discord link change feed: requeue after a failed hand-off', () => {
  beforeEach(() => {
    drainLinkChanges();
  });

  it('puts the drained items back at the FRONT, in their original order', () => {
    // A poll whose response failed to build must cost the bot a retry, never the items.
    // Front, not back: these are older than anything the queue took while they were in
    // flight, and the bot consumes in FIFO order.
    for (let n = 1; n <= 3; n++) enqueueLinkChange(change(n), 0);
    const page = drainLinkChanges(2);
    enqueueLinkChange(change(4), 0);

    requeueLinkChanges(page);

    expect(linkChangeDepth()).toBe(4);
    expect(drainLinkChanges()).toEqual([change(1), change(2), change(3), change(4)]);
  });

  it('does nothing at all for an empty requeue', () => {
    enqueueLinkChange(change(1), 0);
    requeueLinkChanges([]);
    expect(drainLinkChanges()).toEqual([change(1)]);
  });

  it('reopens a requeued item for merging, at its ORIGINAL dedupe deadline', () => {
    // The item was never delivered, so folding a later change into it is correct: the
    // merged change still reaches the bot on the next poll. The window is the one the
    // item was MINTED with, so a requeue cannot extend a deadline (the header's rule
    // that a merge never re-stamps the window).
    enqueueLinkChange({ accountId: 1, kinds: ['flex'] }, 0);
    requeueLinkChanges(drainLinkChanges());

    enqueueLinkChange({ accountId: 1, kinds: ['points'] }, LINK_CHANGE_DEDUPE_TTL_MS - 1);

    expect(linkChangeDepth()).toBe(1);
    expect(drainLinkChanges()).toEqual([{ accountId: 1, kinds: ['flex', 'points'] }]);
  });

  it('mints a fresh item once the requeued item is past its ORIGINAL window', () => {
    // The other side of the same stamp. A requeue that re-stamped `now` would let this
    // enqueue merge, and one item could then absorb an account's changes indefinitely.
    enqueueLinkChange({ accountId: 1, kinds: ['flex'] }, 0);
    requeueLinkChanges(drainLinkChanges());

    enqueueLinkChange({ accountId: 1, kinds: ['points'] }, LINK_CHANGE_DEDUPE_TTL_MS);

    expect(linkChangeDepth()).toBe(2);
    expect(drainLinkChanges()).toEqual([
      { accountId: 1, kinds: ['flex'] },
      { accountId: 1, kinds: ['points'] },
    ]);
  });

  it('lets a NEWER open item keep ownership of its account', () => {
    // While the drained item was in flight, the account minted a fresh item. That newer
    // item is the one later changes must merge into; the requeued one simply drains
    // ahead of it, which the bot handles as two re-reads of one account.
    enqueueLinkChange({ accountId: 1, kinds: ['link'], discordId: 'du1' }, 0);
    const page = drainLinkChanges();
    enqueueLinkChange({ accountId: 1, kinds: ['flex'] }, 10);

    requeueLinkChanges(page);
    enqueueLinkChange({ accountId: 1, kinds: ['points'] }, 20);

    // Three changes, two items: the merge landed on the NEWER item, and the requeued
    // link item is untouched and still first.
    expect(drainLinkChanges()).toEqual([
      { accountId: 1, kinds: ['link'], discordId: 'du1' },
      { accountId: 1, kinds: ['flex', 'points'] },
    ]);
  });

  it('cannot grow the queue past the cap', () => {
    // The requeue is the one path that adds items without going through the enqueue
    // trim, so it runs the trim itself. The requeued items are the oldest present, so
    // with no playtime noise anywhere they are exactly what the fallback drops.
    for (let n = 1; n <= LINK_CHANGE_MAX_QUEUE; n++) enqueueLinkChange(change(n), 0);
    const page = drainLinkChanges(10);
    for (let n = 1; n <= 10; n++) enqueueLinkChange(change(LINK_CHANGE_MAX_QUEUE + n), 0);
    expect(linkChangeDepth()).toBe(LINK_CHANGE_MAX_QUEUE);

    requeueLinkChanges(page);

    expect(linkChangeDepth()).toBe(LINK_CHANGE_MAX_QUEUE);
    // And WHICH items survived, not depth alone: a requeue that trimmed the
    // WRONG end would also read depth == cap. The ten fresh enqueues landed in
    // the slots the drain freed (depth was cap - 10), so the requeue's own trim
    // is the only drop: exactly the requeued 1..10, the oldest present. The
    // queue is 11..cap plus the ten newest, in FIFO order.
    const survivors = drainLinkChanges();
    expect(survivors.length).toBe(LINK_CHANGE_MAX_QUEUE);
    expect(survivors[0]).toEqual(change(11));
    expect(survivors[survivors.length - 1]).toEqual(change(LINK_CHANGE_MAX_QUEUE + 10));
    const survivorIds = new Set(survivors.map((item) => item.accountId));
    for (let n = 1; n <= 10; n++) expect(survivorIds.has(n)).toBe(false);
  });
});

describe('discord link change feed: dedupe TTL', () => {
  beforeEach(() => {
    drainLinkChanges();
  });

  it('merges kinds and fills the Discord id one millisecond inside the TTL', () => {
    // The comparison is `now - at < TTL`, so the LAST merging age is TTL - 1. Pinning
    // only a comfortably small age would stay green if the comparison drifted to <=.
    enqueueLinkChange({ accountId: 1, kinds: ['flex'] }, 0);
    enqueueLinkChange(
      { accountId: 1, discordId: '1234', kinds: ['points'] },
      LINK_CHANGE_DEDUPE_TTL_MS - 1,
    );

    expect(linkChangeDepth()).toBe(1);
    expect(drainLinkChanges()).toEqual([
      { accountId: 1, discordId: '1234', kinds: ['flex', 'points'] },
    ]);
  });

  it('does not repeat a kind the open item already carries', () => {
    // The union runs on the MERGE path too, not just within one enqueue: level changes
    // arrive as a stream of 'flex' enqueues for the same account.
    enqueueLinkChange({ accountId: 1, kinds: ['flex'] }, 0);
    enqueueLinkChange({ accountId: 1, kinds: ['flex', 'points'] }, 10);
    enqueueLinkChange({ accountId: 1, kinds: ['flex'] }, 20);

    expect(drainLinkChanges()).toEqual([{ accountId: 1, kinds: ['flex', 'points'] }]);
  });

  it('keeps the merged item at its original FIFO position', () => {
    enqueueLinkChange({ accountId: 1, kinds: ['flex'] }, 0);
    enqueueLinkChange({ accountId: 2, kinds: ['flex'] }, 0);
    enqueueLinkChange({ accountId: 1, kinds: ['points'] }, 10);

    // Account 1 stays the head: a merge that re-queued the item would put it last.
    expect(drainLinkChanges()).toEqual([
      { accountId: 1, kinds: ['flex', 'points'] },
      { accountId: 2, kinds: ['flex'] },
    ]);
  });

  it('keeps the first Discord id when a later merge carries a different one', () => {
    enqueueLinkChange({ accountId: 1, discordId: '1111', kinds: ['unlink'] }, 0);
    enqueueLinkChange({ accountId: 1, discordId: '2222', kinds: ['link'] }, 10);

    expect(drainLinkChanges()).toEqual([
      { accountId: 1, discordId: '1111', kinds: ['unlink', 'link'] },
    ]);
  });

  it('mints a second item at exactly the TTL', () => {
    // The other side of the same strict <. Age exactly TTL is NOT less than TTL, so the
    // open item is closed and a fresh one is minted. This is the case a < to <= mutation
    // breaks, which is why both sides are pinned.
    enqueueLinkChange({ accountId: 1, kinds: ['flex'] }, 0);
    enqueueLinkChange({ accountId: 1, kinds: ['points'] }, LINK_CHANGE_DEDUPE_TTL_MS);

    expect(linkChangeDepth()).toBe(2);
    expect(drainLinkChanges()).toEqual([
      { accountId: 1, kinds: ['flex'] },
      { accountId: 1, kinds: ['points'] },
    ]);
  });

  it('mints a second item well past the TTL', () => {
    enqueueLinkChange({ accountId: 1, kinds: ['flex'] }, 0);
    enqueueLinkChange({ accountId: 1, kinds: ['points'] }, LINK_CHANGE_DEDUPE_TTL_MS * 4);

    expect(linkChangeDepth()).toBe(2);
  });

  it('does not extend the window when it merges', () => {
    // The window is measured from when the item was MINTED, so a merge at TTL - 1 leaves
    // the deadline where it was and the enqueue at exactly TTL still mints a new item. A
    // re-stamping merge would suppress that third enqueue and let one item absorb an
    // account's changes indefinitely.
    enqueueLinkChange({ accountId: 1, kinds: ['flex'] }, 0);
    enqueueLinkChange({ accountId: 1, kinds: ['points'] }, LINK_CHANGE_DEDUPE_TTL_MS - 1);
    expect(linkChangeDepth()).toBe(1);

    enqueueLinkChange({ accountId: 1, kinds: ['link'] }, LINK_CHANGE_DEDUPE_TTL_MS);
    expect(linkChangeDepth()).toBe(2);
    expect(drainLinkChanges()).toEqual([
      { accountId: 1, kinds: ['flex', 'points'] },
      { accountId: 1, kinds: ['link'] },
    ]);
  });

  it('dedupes per account, never across accounts', () => {
    enqueueLinkChange({ accountId: 1, kinds: ['flex'] }, 0);
    enqueueLinkChange({ accountId: 2, kinds: ['flex'] }, 1);

    expect(linkChangeDepth()).toBe(2);
  });
});

describe('discord link change feed: dedupe never crosses a drain', () => {
  beforeEach(() => {
    drainLinkChanges();
  });

  // THE MOST IMPORTANT TEST IN THIS FILE. A change deduped against an item the bot has
  // ALREADY been handed is a change the bot never sees, which is the exact staleness bug
  // this feed exists to kill. Dedupe may only ever consult items still in the queue, so
  // an enqueue one millisecond after a drain, far inside the TTL, must produce an item.
  it('mints a fresh item one millisecond after a drain, deep inside the TTL', () => {
    enqueueLinkChange({ accountId: 1, kinds: ['flex'] }, 0);
    expect(drainLinkChanges()).toEqual([{ accountId: 1, kinds: ['flex'] }]);

    enqueueLinkChange({ accountId: 1, kinds: ['points'] }, 1);

    expect(linkChangeDepth()).toBe(1);
    // The second drain carries the second change alone, not a re-run of the first and
    // not an empty poll.
    expect(drainLinkChanges()).toEqual([{ accountId: 1, kinds: ['points'] }]);
  });

  it('mints a fresh item after a drain even for an identical repeat change', () => {
    // The kinds are identical too, so nothing but the drain boundary distinguishes this
    // from a burst that should have collapsed.
    enqueueLinkChange(change(1), 0);
    drainLinkChanges();
    enqueueLinkChange(change(1), 1);

    expect(drainLinkChanges()).toEqual([change(1)]);
  });
});

describe('discord link change feed: the eviction ladder and the contract literals', () => {
  beforeEach(() => {
    drainLinkChanges();
  });

  // The module's contract constants, pinned as LITERALS. Every other assertion in
  // this file compares against the imported constant, so an accidental edit to the
  // constant moves both sides at once and nothing reds; these two lines are what
  // make that edit visible (the Phase 5 QA mutation pass proved the gap: a cap
  // raised by one survived the whole suite). 5000 is the D18 guild-member
  // envelope; 30s matches the activity feed's dedupe window.
  it('pins the cap and the dedupe TTL to their contract values', () => {
    expect(LINK_CHANGE_MAX_QUEUE).toBe(5000);
    expect(LINK_CHANGE_DEDUPE_TTL_MS).toBe(30_000);
  });

  it('spends an id-less flex item before an OLDER link item when no points noise is left', () => {
    // The middle rung. Under the old two-rung rule (points noise, then plain
    // oldest-first) this overflow evicted the link item at index 0, exactly the item
    // whose carried id the bot can never re-learn; the ladder spends the id-less flex
    // noise instead, however much older the link item is.
    enqueueLinkChange({ accountId: 1, discordId: 'du1', kinds: ['link'] }, 0);
    for (let n = 2; n <= LINK_CHANGE_MAX_QUEUE; n++) enqueueLinkChange(change(n), 0);
    expect(linkChangeDepth()).toBe(LINK_CHANGE_MAX_QUEUE);

    enqueueLinkChange(change(LINK_CHANGE_MAX_QUEUE + 1), 0);

    expect(linkChangeDepth()).toBe(LINK_CHANGE_MAX_QUEUE);
    const drained = drainLinkChanges();
    // The link item survived at the head; the OLDEST id-less flex item (account 2)
    // is what went.
    expect(drained[0]).toEqual({ accountId: 1, discordId: 'du1', kinds: ['link'] });
    expect(drained.some((c) => c.accountId === 2)).toBe(false);
    expect(drained[drained.length - 1]).toEqual(change(LINK_CHANGE_MAX_QUEUE + 1));
  });

  it('spends points noise before id-less flex noise, however much older the flex item is', () => {
    // Rung order: tier 1 (points noise) is exhausted before tier 2 (id-less flex) is
    // touched, so the OLDEST item in the queue survives an overflow while a NEWER
    // points item goes.
    enqueueLinkChange({ accountId: 1, kinds: ['flex'] }, 0);
    enqueueLinkChange({ accountId: 2, kinds: ['points'] }, 0);
    for (let n = 3; n <= LINK_CHANGE_MAX_QUEUE; n++) enqueueLinkChange(change(n), 0);

    enqueueLinkChange(change(LINK_CHANGE_MAX_QUEUE + 1), 0);

    const drained = drainLinkChanges();
    expect(drained[0]).toEqual({ accountId: 1, kinds: ['flex'] });
    expect(drained.some((c) => c.accountId === 2)).toBe(false);
  });

  it('spends an id-CARRYING flex item before an older link item (the third rung)', () => {
    // No production site mints an id-carrying non-link item today, so this pins the
    // STRUCTURAL promise rather than a current path: if a future flex site passes the
    // id it happens to know, the ladder must still spend that item before any
    // link/unlink item, not fall through to plain oldest-first.
    enqueueLinkChange({ accountId: 1, discordId: 'du1', kinds: ['link'] }, 0);
    for (let n = 2; n < LINK_CHANGE_MAX_QUEUE; n++) enqueueLinkChange(change(n), 0);
    enqueueLinkChange({ accountId: 990_000, discordId: 'du990000', kinds: ['flex'] }, 0);
    expect(linkChangeDepth()).toBe(LINK_CHANGE_MAX_QUEUE);

    // Overflow with a LINK item, so neither noise rung can absorb the eviction into
    // the incoming item itself and the id-less flex rung is exhausted first choice.
    enqueueLinkChange({ accountId: 990_001, discordId: 'du990001', kinds: ['link'] }, 0);

    const drained = drainLinkChanges();
    // Rung 2 spent the oldest id-less flex item (account 2); both link items AND the
    // id-carrying flex item survive.
    expect(drained[0]).toEqual({ accountId: 1, discordId: 'du1', kinds: ['link'] });
    expect(drained.some((c) => c.accountId === 2)).toBe(false);
    expect(drained.some((c) => c.accountId === 990_000)).toBe(true);
    expect(drained[drained.length - 1]).toEqual({
      accountId: 990_001,
      discordId: 'du990001',
      kinds: ['link'],
    });
  });

  it('spends an id-carrying flex item before a link item once id-less noise is gone', () => {
    // The rung-3 discrimination itself: ONLY a link item and an id-carrying flex item
    // in the queue... impossible at the real cap without filler, so the filler here is
    // id-carrying flex too. The eviction must take the OLDEST non-link item (account
    // 2), never the link item at the head.
    enqueueLinkChange({ accountId: 1, discordId: 'du1', kinds: ['link'] }, 0);
    for (let n = 2; n <= LINK_CHANGE_MAX_QUEUE; n++) {
      enqueueLinkChange({ accountId: n, discordId: `du${n}`, kinds: ['flex'] }, 0);
    }
    expect(linkChangeDepth()).toBe(LINK_CHANGE_MAX_QUEUE);

    enqueueLinkChange(
      { accountId: LINK_CHANGE_MAX_QUEUE + 1, discordId: 'duX', kinds: ['unlink'] },
      0,
    );

    const drained = drainLinkChanges();
    expect(drained[0]).toEqual({ accountId: 1, discordId: 'du1', kinds: ['link'] });
    expect(drained.some((c) => c.accountId === 2)).toBe(false);
    expect(drained[drained.length - 1]).toEqual({
      accountId: LINK_CHANGE_MAX_QUEUE + 1,
      discordId: 'duX',
      kinds: ['unlink'],
    });
  });

  it('a mixed-kind item that includes unlink survives both noise rungs', () => {
    // The rung predicate is about link/unlink membership, not kind count: an item that
    // merged points into an unlink still carries the only copy of the member to stop
    // flairing, so an overflow spends a newer plain-flex item instead.
    enqueueLinkChange({ accountId: 1, discordId: 'du1', kinds: ['unlink', 'points'] }, 0);
    for (let n = 2; n <= LINK_CHANGE_MAX_QUEUE; n++) enqueueLinkChange(change(n), 0);

    enqueueLinkChange(change(LINK_CHANGE_MAX_QUEUE + 1), 0);

    const drained = drainLinkChanges();
    expect(drained[0]).toEqual({ accountId: 1, discordId: 'du1', kinds: ['unlink', 'points'] });
    expect(drained.some((c) => c.accountId === 2)).toBe(false);
  });
});
