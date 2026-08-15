// FILENAME TRAP: tests/discord_relay.test.ts already exists and covers a completely
// UNRELATED module, the sim-side command catalog src/sim/discord_relay.ts (RELAY_COMMANDS,
// parseRelayCommand, ...). THIS file covers the SERVER-side hand-off queue
// server/discord_relay.ts (enqueueRelay / drainRelay / relayQueueDepth), which had no tests
// at all before this one. Do not merge the two suites: they share a base name and nothing else.
//
// QUEUE is a module-global singleton with no reset seam, so every test drains in beforeEach
// and the assertions below never assume a queue state an earlier test left behind.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  drainRelay,
  enqueueRelay,
  type QueuedRelay,
  relayQueueDepth,
  requeueRelay,
} from '../../server/discord_relay';

const MAX_QUEUE = 50; // mirrors the module-private backstop; the cap tests reach it exactly

// Mints a NEW object every call. The queue stores items BY REFERENCE, so comparing a drained
// item against the very object that was enqueued is a constant-self-comparison that passes
// even if the queue mangled its contents. Expectation literals must be built fresh from here.
const relay = (n: number): QueuedRelay => ({
  commandId: 'lfg',
  tag: 'LFG',
  label: 'Looking for Group',
  color: 0x1abc9c,
  accountId: n,
  characterName: `Hero${n}`,
  level: 10,
  className: 'Hunter',
  realm: 'Testrealm',
  zone: 'Eastbrook Vale',
  message: `msg ${n}`,
  profileUrl: null,
});

describe('server relay queue: enqueue and drain', () => {
  beforeEach(() => {
    drainRelay();
  });

  it('drains in FIFO order, by value, and leaves the queue empty', () => {
    enqueueRelay(relay(1));
    enqueueRelay(relay(2));
    enqueueRelay(relay(3));

    // Fresh literals from the helper, never the objects handed to enqueueRelay.
    expect(drainRelay()).toEqual([relay(1), relay(2), relay(3)]);
    expect(relayQueueDepth()).toBe(0);
    // The drained array is a new array, not an alias of QUEUE, so a second poll sees nothing.
    expect(drainRelay()).toEqual([]);
  });

  it('returns an empty array when nothing was ever enqueued', () => {
    expect(drainRelay()).toEqual([]);
    expect(relayQueueDepth()).toBe(0);
  });
});

describe('server relay queue: depth accessor', () => {
  beforeEach(() => {
    drainRelay();
  });

  it('tracks both enqueue and drain', () => {
    expect(relayQueueDepth()).toBe(0);
    enqueueRelay(relay(1));
    expect(relayQueueDepth()).toBe(1);
    enqueueRelay(relay(2));
    expect(relayQueueDepth()).toBe(2);
    drainRelay();
    expect(relayQueueDepth()).toBe(0);
  });
});

describe('server relay queue: overflow backstop', () => {
  beforeEach(() => {
    drainRelay();
  });

  it('holds exactly MAX_QUEUE at the boundary and drops nothing (the trim test is strict >)', () => {
    for (let n = 1; n <= MAX_QUEUE; n++) enqueueRelay(relay(n));

    expect(relayQueueDepth()).toBe(MAX_QUEUE);
    const drained = drainRelay();
    // Nothing trimmed: the oldest item pushed is still first.
    expect(drained[0]).toEqual(relay(1));
    expect(drained[drained.length - 1]).toEqual(relay(MAX_QUEUE));
  });

  it('drops the OLDEST and keeps the NEWEST once the cap is exceeded', () => {
    // The cap must actually be REACHED for this to mean anything: MAX_QUEUE + 1 pushes, then a
    // toBe on the exact depth. A toBeLessThanOrEqual here would be constant-true and would stay
    // green with the overflow trim deleted entirely.
    for (let n = 1; n <= MAX_QUEUE + 1; n++) enqueueRelay(relay(n));

    expect(relayQueueDepth()).toBe(MAX_QUEUE);
    const drained = drainRelay();
    expect(drained.length).toBe(MAX_QUEUE);
    // accountId identifies each item, so WHICH end was trimmed is decidable: item 1 is gone,
    // item 2 is the new head, and the most recent push survived.
    expect(drained[0]).toEqual(relay(2));
    expect(drained[drained.length - 1]).toEqual(relay(MAX_QUEUE + 1));
    expect(drained.some((r) => r.accountId === 1)).toBe(false);
  });
});

describe('server relay queue: requeue after a failed hand-off', () => {
  beforeEach(() => {
    drainRelay();
  });

  it('puts drained items back at the FRONT, in their original order', () => {
    // The outbox drain (server/internal.ts) requeues everything it drained when the
    // response it was building throws, so a failed poll costs the bot a retry and not
    // the posts. Front, not back: these are older than whatever arrived meanwhile, and
    // the bot consumes in FIFO order.
    enqueueRelay(relay(1));
    enqueueRelay(relay(2));
    const drained = drainRelay();
    enqueueRelay(relay(3));

    requeueRelay(drained);

    expect(relayQueueDepth()).toBe(3);
    expect(drainRelay()).toEqual([relay(1), relay(2), relay(3)]);
  });

  it('does nothing at all for an empty requeue', () => {
    enqueueRelay(relay(1));
    requeueRelay([]);
    expect(drainRelay()).toEqual([relay(1)]);
  });

  it('cannot grow the queue past the cap', () => {
    // The requeue adds items without going through the enqueue trim, so it applies the
    // same cap itself. The requeued items are the oldest present, so they are what the
    // drop-the-oldest rule spends.
    for (let n = 1; n <= MAX_QUEUE; n++) enqueueRelay(relay(n));
    const drained = drainRelay();
    for (let n = 1; n <= MAX_QUEUE; n++) enqueueRelay(relay(MAX_QUEUE + n));

    requeueRelay(drained);

    expect(relayQueueDepth()).toBe(MAX_QUEUE);
    // The survivors are the ones the queue held, not the requeued ones.
    expect(drainRelay()[0]).toEqual(relay(MAX_QUEUE + 1));
  });
});
