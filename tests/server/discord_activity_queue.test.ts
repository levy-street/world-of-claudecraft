// FILENAME TRAP: tests/discord_relay.test.ts already exists and covers the UNRELATED sim-side
// command catalog src/sim/discord_relay.ts. Its server-side sibling suite is
// tests/server/discord_relay_queue.test.ts. THIS file covers server/discord_activity.ts, the
// activity-feed hand-off queue (enqueueActivity / drainActivity / activityQueueDepth), which had
// no tests at all before this one.
//
// TIME IS FULLY INJECTED: enqueueActivity takes `now`, and the module has no Date.now, no timer
// and no internal clock. NEVER reach for vi.useFakeTimers here; every boundary below is driven
// by passing a literal `now`.
//
// STATE LEAK: QUEUE and the dedupe map are module-global singletons and the dedupe map has NO
// reset seam, so every test drains the queue in beforeEach and prefixes its dedupe keys with the
// test's own name. Sharing a key across tests would make them order-dependent.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  activityQueueDepth,
  drainActivity,
  enqueueActivity,
  MAX_RECENT_KEYS,
  type QueuedActivity,
  requeueActivity,
} from '../../server/discord_activity';

const MAX_QUEUE = 100; // mirrors the module-private backstop; the cap tests reach it exactly
const DEDUPE_TTL_MS = 30_000; // mirrors the module-private TTL; both sides of it are pinned below

// Mints a NEW object every call. The queue stores items BY REFERENCE, so comparing a drained
// item against the very object that was enqueued is a constant-self-comparison that passes even
// if the queue mangled its contents. Expectation literals must be built fresh from here.
const activity = (n: number): QueuedActivity => ({
  kind: 'levelup',
  accountIds: [n],
  names: [`Hero${n}`],
  realm: 'Testrealm',
  profileUrl: null,
  level: n,
});

describe('server activity queue: enqueue and drain', () => {
  beforeEach(() => {
    drainActivity();
  });

  it('drains in FIFO order, by value, and leaves the queue empty', () => {
    enqueueActivity(activity(1), null, 0);
    enqueueActivity(activity(2), null, 0);
    enqueueActivity(activity(3), null, 0);

    // Fresh literals from the helper, never the objects handed to enqueueActivity.
    expect(drainActivity()).toEqual([activity(1), activity(2), activity(3)]);
    expect(activityQueueDepth()).toBe(0);
    // The drained array is a new array, not an alias of QUEUE, so a second poll sees nothing.
    expect(drainActivity()).toEqual([]);
  });

  it('returns an empty array when nothing was ever enqueued', () => {
    expect(drainActivity()).toEqual([]);
    expect(activityQueueDepth()).toBe(0);
  });
});

describe('server activity queue: depth accessor', () => {
  beforeEach(() => {
    drainActivity();
  });

  it('tracks both enqueue and drain', () => {
    expect(activityQueueDepth()).toBe(0);
    enqueueActivity(activity(1), null, 0);
    expect(activityQueueDepth()).toBe(1);
    enqueueActivity(activity(2), null, 0);
    expect(activityQueueDepth()).toBe(2);
    drainActivity();
    expect(activityQueueDepth()).toBe(0);
  });
});

describe('server activity queue: overflow backstop', () => {
  beforeEach(() => {
    drainActivity();
  });

  it('holds exactly MAX_QUEUE at the boundary and drops nothing (the trim test is strict >)', () => {
    for (let n = 1; n <= MAX_QUEUE; n++) enqueueActivity(activity(n), null, 0);

    expect(activityQueueDepth()).toBe(MAX_QUEUE);
    const drained = drainActivity();
    // Nothing trimmed: the oldest item pushed is still first.
    expect(drained[0]).toEqual(activity(1));
    expect(drained[drained.length - 1]).toEqual(activity(MAX_QUEUE));
  });

  it('drops the OLDEST and keeps the NEWEST once the cap is exceeded', () => {
    // The cap must actually be REACHED for this to mean anything: MAX_QUEUE + 1 pushes, then a
    // toBe on the exact depth. A toBeLessThanOrEqual here would be constant-true and would stay
    // green with the overflow trim deleted entirely.
    for (let n = 1; n <= MAX_QUEUE + 1; n++) enqueueActivity(activity(n), null, 0);

    expect(activityQueueDepth()).toBe(MAX_QUEUE);
    const drained = drainActivity();
    expect(drained.length).toBe(MAX_QUEUE);
    // The level field identifies each item, so WHICH end was trimmed is decidable: item 1 is
    // gone, item 2 is the new head, and the most recent push survived.
    expect(drained[0]).toEqual(activity(2));
    expect(drained[drained.length - 1]).toEqual(activity(MAX_QUEUE + 1));
    expect(drained.some((a) => a.level === 1)).toBe(false);
  });
});

describe('server activity queue: dedupe TTL', () => {
  beforeEach(() => {
    drainActivity();
  });

  it('suppresses a repeat one millisecond inside the TTL', () => {
    // The comparison is `now - last < TTL`, so the LAST suppressed age is TTL - 1. Pinning only
    // a comfortably small age (say 1000) would stay green if the comparison drifted to <=.
    const key = 'ttl-inside';
    enqueueActivity(activity(1), key, 0);
    expect(activityQueueDepth()).toBe(1);

    enqueueActivity(activity(2), key, DEDUPE_TTL_MS - 1);
    expect(activityQueueDepth()).toBe(1);
  });

  it('admits a repeat at exactly the TTL', () => {
    // The other side of the same strict <. Age exactly TTL is NOT less than TTL, so it passes.
    // This is the case a < to <= mutation breaks, which is why both sides are pinned.
    const key = 'ttl-exact';
    enqueueActivity(activity(1), key, 0);
    enqueueActivity(activity(2), key, DEDUPE_TTL_MS);
    expect(activityQueueDepth()).toBe(2);
  });

  it('admits a repeat past the TTL', () => {
    const key = 'ttl-past';
    enqueueActivity(activity(1), key, 0);
    enqueueActivity(activity(2), key, DEDUPE_TTL_MS + 1);
    expect(activityQueueDepth()).toBe(2);
  });

  it('re-stamps the key when a repeat is admitted', () => {
    // Admission calls recentKeys.set(key, now), so the TTL window slides forward. The third
    // enqueue is 59_999 ms after the ORIGINAL stamp (far outside its window) but only 29_999 ms
    // after the second one, so it must be suppressed. That is only true if the stamp moved.
    const key = 'ttl-restamp';
    enqueueActivity(activity(1), key, 0);
    enqueueActivity(activity(2), key, DEDUPE_TTL_MS);
    expect(activityQueueDepth()).toBe(2);

    enqueueActivity(activity(3), key, DEDUPE_TTL_MS * 2 - 1);
    expect(activityQueueDepth()).toBe(2);
  });

  it('never suppresses when no dedupe key is supplied', () => {
    // A null key skips the whole dedupe branch, so identical moments at the identical `now` all
    // land. An empty string is falsy too, so it means "no dedupe" rather than "the key ''".
    enqueueActivity(activity(1), null, 0);
    enqueueActivity(activity(1), null, 0);
    enqueueActivity(activity(1), '', 0);
    enqueueActivity(activity(1), '', 0);
    expect(activityQueueDepth()).toBe(4);
  });
});

describe('server activity queue: dedupe map sweep', () => {
  beforeEach(() => {
    drainActivity();
  });

  // MAX_RECENT_KEYS is a TRIGGER, not a hard cap: the sweep runs when the map grows past it
  // but the expiry pass deletes ONLY entries whose age has reached the TTL, so a mixed
  // population must lose exactly its expired members at the crossing. (The oldest-first
  // overflow backstop BEHIND the expiry pass, for an all-live population at the cap, is
  // pinned separately in tests/discord_activity_professions.test.ts.) This test builds a
  // mixed population so the expiry half is decidable, and its probe order is load-bearing:
  // a suppressed re-enqueue returns before touching the map, while an admitted one re-adds
  // its key to a map sitting AT the cap and the backstop then evicts the oldest live entry,
  // so every suppress-probe runs before the one admit-probe. It leaves 4096 keys in the
  // module-global map, which is why it is the last dedupe block in the file.
  it('prunes only expired keys and leaves fresh ones (and the map) intact', () => {
    const OLD = 1_000_000;
    const FRESH = OLD + DEDUPE_TTL_MS; // ages the OLD stamp to exactly the TTL at sweep time
    const expiredKey = 'sweep-expired';
    const survivorKey = 'sweep-survivor';

    enqueueActivity(activity(1), expiredKey, OLD); // age at FRESH is exactly TTL: eviction is >=
    enqueueActivity(activity(2), survivorKey, OLD + 1); // age at FRESH is TTL - 1: survives
    // MAX_RECENT_KEYS - 1 fresh fillers: with the two stamps above, the map crosses the
    // trigger during this loop whatever earlier blocks left behind (their keys are ancient
    // at FRESH, so the same expiry pass that drops expiredKey clears them), and after that
    // one sweep the population sits at exactly the cap with no second crossing, so the
    // backstop stays out of the arms below.
    const fillers = MAX_RECENT_KEYS - 1;
    for (let i = 0; i < fillers; i++) enqueueActivity(activity(3), `sweep-filler-${i}`, FRESH);
    drainActivity();

    // recentKeys is not exported, so removal and survival are proved BEHAVIOURALLY: a key that
    // is gone gets admitted again, a key that is still there suppresses. The probes rewind
    // `now` to inside the expired key's original window, because that is the only point at
    // which its eviction is observable at all (past its own expiry the TTL check would admit
    // it either way, which would make the assertion constant-true).
    enqueueActivity(activity(5), survivorKey, OLD + DEDUPE_TTL_MS - 1);
    expect(activityQueueDepth()).toBe(0); // still suppressed, so the sweep spared it

    // Both ends of the fresh population still suppress: a sweep that pruned indiscriminately
    // at the crossing would have dropped the earliest fillers.
    enqueueActivity(activity(6), 'sweep-filler-0', FRESH + 1);
    enqueueActivity(activity(7), `sweep-filler-${fillers - 1}`, FRESH + 1);
    expect(activityQueueDepth()).toBe(0);

    // The admit-probe runs LAST (see the header): admitted, so the sweep really deleted it.
    enqueueActivity(activity(4), expiredKey, OLD + DEDUPE_TTL_MS - 1);
    expect(activityQueueDepth()).toBe(1);
  });
});

describe('server activity queue: requeue after a failed hand-off', () => {
  beforeEach(() => {
    drainActivity();
  });

  it('puts drained items back at the FRONT, in their original order', () => {
    // The outbox drain (server/internal.ts) requeues everything it drained when the
    // response it was building throws, so a failed poll costs the bot a retry and not
    // the cards. Front, not back: these are older than whatever arrived meanwhile, and
    // the bot consumes in FIFO order.
    enqueueActivity(activity(1), null, 0);
    enqueueActivity(activity(2), null, 0);
    const drained = drainActivity();
    enqueueActivity(activity(3), null, 0);

    requeueActivity(drained);

    expect(activityQueueDepth()).toBe(3);
    expect(drainActivity()).toEqual([activity(1), activity(2), activity(3)]);
  });

  it('does not touch the dedupe map, so a requeued item keeps its own key claimed', () => {
    // The requeued items are the SAME items that claimed their keys at enqueue, so
    // re-claiming would only re-stamp a window that is already correct. What must NOT
    // happen is a requeue releasing the key and letting the same moment post twice.
    const key = 'requeue-dedupe';
    enqueueActivity(activity(1), key, 0);
    requeueActivity(drainActivity());

    enqueueActivity(activity(2), key, DEDUPE_TTL_MS - 1);

    expect(activityQueueDepth()).toBe(1); // still suppressed
    expect(drainActivity()).toEqual([activity(1)]);
  });

  it('does nothing at all for an empty requeue', () => {
    // Pins the observable no-op, honestly NOT the early-return guard itself:
    // without the guard, unshift() with no arguments and an under-cap trim are
    // both no-ops too, so no assertion can tell the two implementations apart.
    enqueueActivity(activity(1), null, 0);
    requeueActivity([]);
    expect(activityQueueDepth()).toBe(1);
    expect(drainActivity()).toEqual([activity(1)]);
  });

  it('a repeat is still admitted at exactly the TTL after a requeue', () => {
    // The other side of the untouched-dedupe rule: keeping the key claimed must not
    // EXTEND the window either. The claim's stamp is the original enqueue's, so a
    // repeat at exactly TTL from that stamp is admitted, requeue or no requeue.
    const key = 'requeue-dedupe-boundary';
    enqueueActivity(activity(1), key, 0);
    requeueActivity(drainActivity());

    enqueueActivity(activity(2), key, DEDUPE_TTL_MS);

    expect(activityQueueDepth()).toBe(2);
  });

  it('cannot grow the queue past the cap', () => {
    // The requeue adds items without going through the enqueue trim, so it applies the
    // same cap itself. The requeued items are the oldest present, so they are what the
    // drop-the-oldest rule spends.
    for (let n = 1; n <= MAX_QUEUE; n++) enqueueActivity(activity(n), null, 0);
    const drained = drainActivity();
    for (let n = 1; n <= MAX_QUEUE; n++) enqueueActivity(activity(MAX_QUEUE + n), null, 0);

    requeueActivity(drained);

    expect(activityQueueDepth()).toBe(MAX_QUEUE);
    // The survivors are the ones the queue held, not the requeued ones.
    expect(drainActivity()[0]).toEqual(activity(MAX_QUEUE + 1));
  });
});
