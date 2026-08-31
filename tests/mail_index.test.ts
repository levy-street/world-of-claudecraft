// MailIndex (src/sim/mail/mail_index.ts): the Ravenpost's derived lookup state
// (per-recipient buckets, delivered-and-unread counts, the in-flight set).
// Drives the index with minimal fake letters against a naive full-scan
// reference model (an independent oracle, the market_browse_cache shape): after
// every scripted mutation, bucketFor/countFor/unreadFor must agree with a scan
// of the canonical book, so the bucketed reads can never drift from the
// full-array scans they replaced.

import { describe, expect, it } from 'vitest';
import { type IndexedLetter, MailIndex } from '../src/sim/mail/mail_index';

interface FakeLetter extends IndexedLetter {
  id: number;
}

function letter(
  id: number,
  recipientKey: string,
  opts: { read?: boolean; deliverAt?: number; custodyRef?: string } = {},
): FakeLetter {
  return {
    id,
    recipientKey,
    read: opts.read ?? false,
    deliverAt: opts.deliverAt ?? 0,
    ...(opts.custodyRef === undefined ? {} : { custodyRef: opts.custodyRef }),
  };
}

// The naive reference: what the pre-index full scans computed from the book.
function refBucket(book: FakeLetter[], key: string): FakeLetter[] {
  return book.filter((m) => m.recipientKey === key);
}

function refUnread(book: FakeLetter[], key: string, now: number): number {
  return book.filter((m) => m.recipientKey === key && !m.read && now >= m.deliverAt).length;
}

// Assert the index agrees with the reference model for every key present.
function expectMatchesBook(index: MailIndex<FakeLetter>, book: FakeLetter[], now: number): void {
  const keys = new Set(book.map((m) => m.recipientKey));
  for (const key of keys) {
    expect(index.bucketFor(key), `bucket ${key}`).toEqual(refBucket(book, key));
    expect(index.countFor(key), `count ${key}`).toBe(refBucket(book, key).length);
    expect(index.unreadFor(key), `unread ${key}`).toBe(refUnread(book, key, now));
  }
}

describe('MailIndex buckets and unread counts', () => {
  it('tracks delivered and in-flight letters under their recipient keys', () => {
    const index = new MailIndex<FakeLetter>();
    const book: FakeLetter[] = [];
    const now = 100;
    for (const m of [
      letter(1, 'alice'),
      letter(2, 'alice', { read: true }),
      letter(3, 'bob'),
      letter(4, 'alice', { deliverAt: 150 }), // still on the wing
    ]) {
      book.push(m);
      index.track(m, now);
    }
    expectMatchesBook(index, book, now);
    expect(index.unreadFor('alice')).toBe(1); // in-flight letter not counted yet
    expect(index.countFor('alice')).toBe(3); // but it is stored in the bucket
    expect(index.bucketFor('missing')).toEqual([]);
    expect(index.unreadFor('missing')).toBe(0);
  });

  it('lands due letters through deliverDue and reports how many landed', () => {
    const index = new MailIndex<FakeLetter>();
    const book = [letter(1, 'alice', { deliverAt: 50 }), letter(2, 'bob', { deliverAt: 200 })];
    for (const m of book) index.track(m, 0);
    expect(index.unreadFor('alice')).toBe(0);
    expect(index.deliverDue(40)).toBe(0);
    expect(index.deliverDue(60)).toBe(1); // alice's letter lands, bob's still flies
    expectMatchesBook(index, book, 60);
    expect(index.deliverDue(60)).toBe(0); // idempotent: nothing new to land
    expect(index.deliverDue(250)).toBe(1); // bob's lands
    expectMatchesBook(index, book, 250);
  });

  it('untrack removes every contribution: bucket, unread count, in-flight set', () => {
    const index = new MailIndex<FakeLetter>();
    const now = 100;
    const delivered = letter(1, 'alice');
    const inFlight = letter(2, 'alice', { deliverAt: 150 });
    const read = letter(3, 'alice', { read: true });
    const book = [delivered, inFlight, read];
    for (const m of book) index.track(m, now);

    index.untrack(inFlight, now);
    book.splice(book.indexOf(inFlight), 1);
    expectMatchesBook(index, book, now);
    // The untracked in-flight letter never lands.
    expect(index.deliverDue(200)).toBe(0);

    index.untrack(delivered, now);
    book.splice(book.indexOf(delivered), 1);
    expectMatchesBook(index, book, now);
    expect(index.unreadFor('alice')).toBe(0);

    index.untrack(read, now);
    expect(index.countFor('alice')).toBe(0);
    expect(index.bucketFor('alice')).toEqual([]);
  });

  it('rekey moves the bucket entry and the unread contribution to the new key', () => {
    const index = new MailIndex<FakeLetter>();
    const now = 100;
    const unreadLetter = letter(1, 'Ghost');
    const readLetter = letter(2, 'Ghost', { read: true });
    const flying = letter(3, 'Ghost', { deliverAt: 150 });
    const book = [unreadLetter, readLetter, flying];
    for (const m of book) index.track(m, now);

    index.rekey(unreadLetter, '7', now);
    index.rekey(readLetter, '7', now);
    index.rekey(flying, '7', now);
    expect(unreadLetter.recipientKey).toBe('7');
    expectMatchesBook(index, book, now);
    expect(index.unreadFor('Ghost')).toBe(0);
    expect(index.unreadFor('7')).toBe(1); // the read and in-flight letters do not count
    expect(index.countFor('7')).toBe(3);

    // The rekeyed in-flight letter still lands, under the new key.
    expect(index.deliverDue(200)).toBe(1);
    expect(index.unreadFor('7')).toBe(2);
  });

  it('rekey to the same key is a no-op', () => {
    const index = new MailIndex<FakeLetter>();
    const m = letter(1, 'alice');
    index.track(m, 100);
    const bucketBefore = index.bucketFor('alice');
    index.rekey(m, 'alice', 100);
    expect(index.bucketFor('alice')).toBe(bucketBefore);
    expect(index.unreadFor('alice')).toBe(1);
  });

  it('markRead drops the unread contribution exactly once', () => {
    const index = new MailIndex<FakeLetter>();
    const now = 100;
    const m = letter(1, 'alice');
    const other = letter(2, 'alice');
    const book = [m, other];
    for (const x of book) index.track(x, now);
    expect(index.unreadFor('alice')).toBe(2);

    index.markRead(m, now);
    expect(m.read).toBe(true);
    expect(index.unreadFor('alice')).toBe(1);
    index.markRead(m, now); // repeat is a no-op
    expect(index.unreadFor('alice')).toBe(1);
    expectMatchesBook(index, book, now);
  });

  it('an untrack/track bracket re-accounts a wholesale mutation (the return flight)', () => {
    const index = new MailIndex<FakeLetter>();
    const now = 100;
    const m = letter(1, 'bob', { read: true });
    const book = [m];
    index.track(m, now);
    expect(index.unreadFor('bob')).toBe(0);

    // The return flight: back to the sender, unread again, delivery re-armed.
    index.untrack(m, now);
    m.recipientKey = 'alice';
    m.read = false;
    m.deliverAt = now + 45;
    index.track(m, now);

    expectMatchesBook(index, book, now);
    expect(index.countFor('bob')).toBe(0);
    expect(index.countFor('alice')).toBe(1);
    expect(index.unreadFor('alice')).toBe(0); // on the wing again
    expect(index.deliverDue(now + 50)).toBe(1);
    expect(index.unreadFor('alice')).toBe(1);
  });

  it('rebuild reconstructs everything from the canonical book', () => {
    const index = new MailIndex<FakeLetter>();
    const now = 100;
    // Seed with junk state that a rebuild must wipe.
    index.track(letter(99, 'stale'), now);
    const book = [
      letter(1, 'alice'),
      letter(2, 'alice', { read: true }),
      letter(3, 'bob', { deliverAt: 150 }),
    ];
    index.rebuild(book, now);
    expectMatchesBook(index, book, now);
    expect(index.countFor('stale')).toBe(0);
    expect(index.unreadFor('stale')).toBe(0);
    // The rebuilt in-flight set still lands bob's letter.
    expect(index.deliverDue(200)).toBe(1);
    expect(index.unreadFor('bob')).toBe(1);
  });

  it('bucket order is per-bucket append order: a re-track lands at the tail', () => {
    const index = new MailIndex<FakeLetter>();
    const a = letter(1, 'alice');
    const b = letter(2, 'alice');
    const c = letter(3, 'alice');
    for (const m of [a, b, c]) index.track(m, 0);
    expect(index.bucketFor('alice').map((m) => m.id)).toEqual([1, 2, 3]);
    index.untrack(b, 0);
    expect(index.bucketFor('alice').map((m) => m.id)).toEqual([1, 3]);
    index.track(b, 0);
    expect(index.bucketFor('alice').map((m) => m.id)).toEqual([1, 3, 2]);
  });
});

describe('MailIndex custody-ref presence', () => {
  // The Exchange booking dedupe (PostOffice.hasCustodyParcel) rides this
  // index instead of scanning the whole book, so presence must track the
  // book through every membership mutation the contract names.
  it('tracks a parcel ref through track, untrack, and the mutation bracket', () => {
    const index = new MailIndex<FakeLetter>();
    const parcel = letter(1, 'alice', { custodyRef: 'wm_ref_1' });
    expect(index.hasCustodyRef('wm_ref_1')).toBe(false);
    index.track(parcel, 0);
    expect(index.hasCustodyRef('wm_ref_1')).toBe(true);
    // The untrack/track bracket (the return flight) must keep the ref present.
    index.untrack(parcel, 0);
    index.track(parcel, 0);
    expect(index.hasCustodyRef('wm_ref_1')).toBe(true);
    index.untrack(parcel, 0);
    expect(index.hasCustodyRef('wm_ref_1')).toBe(false);
  });

  it('refcounts a shared ref so removing one letter never erases the other', () => {
    const index = new MailIndex<FakeLetter>();
    const a = letter(1, 'alice', { custodyRef: 'wm_ref_2' });
    const b = letter(2, 'bob', { custodyRef: 'wm_ref_2' });
    index.track(a, 0);
    index.track(b, 0);
    index.untrack(a, 0);
    expect(index.hasCustodyRef('wm_ref_2')).toBe(true);
    // A double untrack of the removed letter must under-count nothing.
    index.untrack(a, 0);
    expect(index.hasCustodyRef('wm_ref_2')).toBe(true);
    index.untrack(b, 0);
    expect(index.hasCustodyRef('wm_ref_2')).toBe(false);
  });

  it('rebuild reconstructs presence from the canonical book alone', () => {
    const index = new MailIndex<FakeLetter>();
    index.track(letter(1, 'alice', { custodyRef: 'wm_stale' }), 0);
    const book = [letter(2, 'bob', { custodyRef: 'wm_live' }), letter(3, 'bob')];
    index.rebuild(book, 0);
    expect(index.hasCustodyRef('wm_live')).toBe(true);
    expect(index.hasCustodyRef('wm_stale')).toBe(false);
  });
});

// #3561's incremental-autosave seam: which recipient keys takeDirty() reports
// after each kind of mutation. A missed mark here means a real production bug
// (a mailbox mutation that autosave never persists), so every mutating method
// gets its own decisive assertion of the EXACT dirty set, not just "non-empty".
describe('MailIndex dirty tracking (#3561 incremental autosave)', () => {
  it('track marks the recipient dirty; a quiet takeDirty drains and clears it', () => {
    const index = new MailIndex<FakeLetter>();
    expect(index.takeDirty()).toEqual([]); // nothing dirty yet
    index.track(letter(1, 'alice'), 0);
    expect(index.takeDirty().sort()).toEqual(['alice']);
    expect(index.takeDirty()).toEqual([]); // drained: a second call reports nothing new
  });

  it('untrack marks the recipient dirty only on an actual removal', () => {
    const index = new MailIndex<FakeLetter>();
    const m = letter(1, 'alice');
    index.track(m, 0);
    index.takeDirty(); // drain the track()

    index.untrack(m, 0);
    expect(index.takeDirty()).toEqual(['alice']);

    // A second untrack of the same (already-removed) letter is the documented
    // idempotent no-op (bucketRemove returns false): must NOT mark dirty
    // again, or every quiet interval would fabricate spurious writes.
    index.untrack(m, 0);
    expect(index.takeDirty()).toEqual([]);
  });

  it('rekey marks BOTH the old and new key dirty; a same-key call marks neither', () => {
    const index = new MailIndex<FakeLetter>();
    const m = letter(1, 'Ghost');
    index.track(m, 0);
    index.takeDirty();

    index.rekey(m, '7', 0);
    expect(index.takeDirty().sort()).toEqual(['7', 'Ghost']);

    index.rekey(m, '7', 0); // same key: the documented no-op
    expect(index.takeDirty()).toEqual([]);
  });

  it('markRead marks the recipient dirty only on the actual flip, not a repeat', () => {
    const index = new MailIndex<FakeLetter>();
    const m = letter(1, 'alice');
    index.track(m, 0);
    index.takeDirty();

    index.markRead(m, 0);
    expect(index.takeDirty()).toEqual(['alice']);

    index.markRead(m, 0); // already read: guarded no-op
    expect(index.takeDirty()).toEqual([]);
  });

  it('markDirty is the explicit escape hatch for a content-only mutation (idempotent, order-independent)', () => {
    const index = new MailIndex<FakeLetter>();
    index.markDirty('alice');
    index.markDirty('alice'); // duplicate: the Set absorbs it
    index.markDirty('bob');
    expect(index.takeDirty().sort()).toEqual(['alice', 'bob']);
  });

  it('a live-mutation bracket (untrack -> field write -> track) dirties BOTH ends, matching returnToSender', () => {
    const index = new MailIndex<FakeLetter>();
    const now = 100;
    const m = letter(1, 'bob', { read: true });
    index.track(m, now);
    index.takeDirty();

    index.untrack(m, now);
    m.recipientKey = 'alice';
    m.read = false;
    index.track(m, now);

    expect(index.takeDirty().sort()).toEqual(['alice', 'bob']);
  });

  it('rebuild (a fresh load) marks NOTHING dirty: reconstructing durable state is not new work', () => {
    const index = new MailIndex<FakeLetter>();
    // Seed some pre-rebuild dirty state that must not leak through.
    index.track(letter(99, 'stale'), 0);
    expect(index.takeDirty()).not.toEqual([]);

    const now = 100;
    const book = [letter(1, 'alice'), letter(2, 'bob', { deliverAt: 150 })];
    index.rebuild(book, now);
    expect(index.takeDirty()).toEqual([]); // a quiet post-load autosave writes nothing

    // The rebuilt index is still fully functional: a later real mutation
    // dirties exactly its own key, nothing pre-existing from the load.
    index.markRead(book[0], now);
    expect(index.takeDirty()).toEqual(['alice']);
  });
});
