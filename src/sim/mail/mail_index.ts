// The Ravenpost's derived lookup state: per-recipient letter buckets, the
// delivered-and-unread counts, and the in-flight set, kept in lockstep with the
// canonical book (PostOffice.mail) by routing every membership or key mutation
// through this class. Extracted so the book reads that used to scan the whole
// global array per player per tick (deliveredFor, storedCountFor,
// mailboxHoldsItem: the production broadcast hot spot on a grown book) become
// bucket lookups, the same treatment mailUnreadFor's unread index already got
// (Finding 4). The book array itself stays canonical on PostOffice: iteration
// order, the expiry sweep, and the mailArrived emit order are untouched, and
// everything here is derived, rebuilt from the book on load, never persisted.
//
// Contract: PostOffice calls track(m) after adding a letter to the book,
// untrack(m) before splicing one out, rekey(m, newKey) for a recipient change,
// and markRead(m) for the read flip; a mutation that re-arms delivery or the
// read flag wholesale (the return flight) brackets its field writes with
// untrack/track. Bucket order is book order per bucket; readers must not
// depend on cross-bucket order (every current consumer sorts on a total order,
// finds by unique id, or counts).
//
// `src/sim`-pure and clock-free: sim time is passed into every call, no rng,
// no imports beyond types (enforced by tests/architecture.test.ts).

// The three letter fields the index accounts by. Structural (not the concrete
// MailMessage) so the unit test drives the index with minimal fakes.
export interface IndexedLetter {
  recipientKey: string;
  read: boolean;
  deliverAt: number;
}

// Shared empty result for recipients with no letters; never mutated.
const EMPTY_BUCKET: never[] = [];

export class MailIndex<M extends IndexedLetter> {
  // Every letter in the book, bucketed by its recipientKey (each letter has
  // exactly one key, so buckets never overlap and a dual-key read is a clean
  // union). Bucket arrays hold letters in book (insertion) order.
  private buckets = new Map<string, M[]>();
  // Delivered-and-unread counts per recipientKey (the mailUnreadFor read).
  private unread = new Map<string, number>();
  // The small set of still-in-flight letters, so a delivery transition updates
  // the unread count at the exact tick the old per-call scan would have.
  private undelivered = new Set<M>();

  // Fold a freshly booked or loaded letter in: an already-due letter counts as
  // unread now (unless read); one still on the wing waits in `undelivered`
  // until deliverDue lands it.
  track(m: M, now: number): void {
    this.bucketAdd(m);
    if (now >= m.deliverAt) {
      if (!m.read) this.inc(m.recipientKey);
    } else {
      this.undelivered.add(m);
    }
  }

  // Drop a letter's every contribution (the sweep/delete arm, and the first
  // half of an untrack/track mutation bracket).
  untrack(m: M, now: number): void {
    this.bucketRemove(m);
    if (!m.read && now >= m.deliverAt) this.dec(m.recipientKey);
    this.undelivered.delete(m);
  }

  // Recipient change (rename rekey, purge normalization): moves the letter's
  // bucket entry and its delivered-and-unread contribution, then stamps the
  // new key on the letter. A same-key call refreshes nothing and costs nothing.
  rekey(m: M, newKey: string, now: number): void {
    if (m.recipientKey === newKey) return;
    this.bucketRemove(m);
    if (!m.read && now >= m.deliverAt) {
      this.dec(m.recipientKey);
      this.inc(newKey);
    }
    m.recipientKey = newKey;
    this.bucketAdd(m);
  }

  // The read flip (mailTake, mailMarkRead): drops the letter's unread
  // contribution once and marks it read. Callers only reach delivered letters
  // (deliveredFor gates them), so the deliverAt guard is belt-and-braces.
  markRead(m: M, now: number): void {
    if (m.read) return;
    if (now >= m.deliverAt) this.dec(m.recipientKey);
    m.read = true;
  }

  // Per-tick: land any in-flight letter whose delivery time has arrived,
  // moving it from `undelivered` into the unread count. Returns how many
  // landed so the caller can advance its wire revision only when the visible
  // mailbox contents actually changed. Draws no rng and emits nothing (the
  // arrival toast stays on its own per-second cadence in PostOffice.update()),
  // so it never perturbs the deterministic event/rng stream.
  deliverDue(now: number): number {
    if (this.undelivered.size === 0) return 0;
    let landed = 0;
    for (const m of this.undelivered) {
      if (now < m.deliverAt) continue;
      this.undelivered.delete(m);
      if (!m.read) this.inc(m.recipientKey);
      landed++;
    }
    return landed;
  }

  // Rebuild everything from the canonical book (after a deserialize/load, so
  // none of this state is ever persisted).
  rebuild(book: readonly M[], now: number): void {
    this.buckets.clear();
    this.unread.clear();
    this.undelivered.clear();
    for (const m of book) this.track(m, now);
  }

  // Delivered-and-unread count for one key bucket (callers union the stable
  // key and the display name themselves, exactly as mailUnreadFor documents).
  unreadFor(key: string): number {
    return this.unread.get(key) ?? 0;
  }

  // Every letter addressed to this key, delivered or not, in book order.
  // A live read-only view: callers filter/copy, never mutate.
  bucketFor(key: string): readonly M[] {
    return this.buckets.get(key) ?? EMPTY_BUCKET;
  }

  // Stored-letter count for one key (the mailbox-full gate).
  countFor(key: string): number {
    return this.buckets.get(key)?.length ?? 0;
  }

  private bucketAdd(m: M): void {
    const bucket = this.buckets.get(m.recipientKey);
    if (bucket) bucket.push(m);
    else this.buckets.set(m.recipientKey, [m]);
  }

  private bucketRemove(m: M): void {
    const bucket = this.buckets.get(m.recipientKey);
    if (!bucket) return;
    const i = bucket.indexOf(m);
    if (i < 0) return;
    if (bucket.length === 1) this.buckets.delete(m.recipientKey);
    else bucket.splice(i, 1);
  }

  private inc(key: string): void {
    this.unread.set(key, (this.unread.get(key) ?? 0) + 1);
  }

  private dec(key: string): void {
    const next = (this.unread.get(key) ?? 0) - 1;
    if (next > 0) this.unread.set(key, next);
    else this.unread.delete(key);
  }
}
