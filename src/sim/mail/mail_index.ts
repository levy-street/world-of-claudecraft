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
// untrack/track. Bucket order is per-bucket APPEND order, which matches book
// insertion order only until an untrack/track bracket (rekey, the return
// flight) re-appends a letter at its bucket tail; readers must not depend on
// bucket order at all (every current consumer sorts on a total order, finds
// by unique id, or counts).
//
// `src/sim`-pure and clock-free: sim time is passed into every call, no rng,
// no imports beyond types (enforced by tests/architecture.test.ts).

// The three letter fields the index accounts by. Structural (not the concrete
// MailMessage) so the unit test drives the index with minimal fakes.
export interface IndexedLetter {
  recipientKey: string;
  read: boolean;
  deliverAt: number;
  /** Exchange custody parcels only; absent on ordinary letters. */
  custodyRef?: string;
}

// Shared empty result for recipients with no letters; never mutated.
// Frozen: this is shared module-level state handed to every caller that reads
// a missing bucket, so runtime-readonly (not just types-readonly) keeps a
// stray push from corrupting every future empty read.
const EMPTY_BUCKET: readonly never[] = Object.freeze([]);

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
  // Custody-parcel refs currently in the book, refcounted so the booking
  // dedupe (PostOffice.hasCustodyParcel, called on EVERY Exchange delivery
  // and twice per custody retry) is a lookup instead of a whole-book scan.
  // Refcounted rather than a Set on purpose: the dedupe normally keeps refs
  // unique, but the index must stay correct even if two letters ever carry
  // one ref (an untrack of one must not erase the other's presence).
  private custodyRefs = new Map<string, number>();
  // Recipient keys whose bucket CONTENT (not just delivery/unread
  // bookkeeping) changed since the last takeDirty(): the persistence seam for
  // #3561's incremental autosave. track/untrack/rekey/markRead each mark the
  // key(s) whose serialized row would now differ. rebuild() (a fresh load)
  // deliberately does NOT mark dirty: nothing changed, it is reconstructing
  // already-persisted state, and marking it dirty would force a needless
  // rewrite of the entire book on the very next autosave.
  private dirty = new Set<string>();

  // Fold a freshly booked or loaded letter in: an already-due letter counts as
  // unread now (unless read); one still on the wing waits in `undelivered`
  // until deliverDue lands it.
  track(m: M, now: number): void {
    this.trackQuiet(m, now);
    this.dirty.add(m.recipientKey);
  }

  // track()'s structural half, with no dirty marking: the rebuild() bulk-load
  // path.
  private trackQuiet(m: M, now: number): void {
    this.bucketAdd(m);
    if (m.custodyRef !== undefined) {
      this.custodyRefs.set(m.custodyRef, (this.custodyRefs.get(m.custodyRef) ?? 0) + 1);
    }
    if (now >= m.deliverAt) {
      if (!m.read) this.inc(m.recipientKey);
    } else {
      this.undelivered.add(m);
    }
  }

  // Drop a letter's every contribution (the sweep/delete arm, and the first
  // half of an untrack/track mutation bracket).
  untrack(m: M, now: number): void {
    // Idempotent: the unread decrement rides only on an ACTUAL bucket
    // removal, so a double untrack (unreachable today) under-counts nothing.
    if (!this.bucketRemove(m)) return;
    if (m.custodyRef !== undefined) {
      const left = (this.custodyRefs.get(m.custodyRef) ?? 0) - 1;
      if (left > 0) this.custodyRefs.set(m.custodyRef, left);
      else this.custodyRefs.delete(m.custodyRef);
    }
    if (!m.read && now >= m.deliverAt) this.dec(m.recipientKey);
    this.undelivered.delete(m);
    this.dirty.add(m.recipientKey);
  }

  // Recipient change (rename rekey, purge normalization): moves the letter's
  // bucket entry and its delivered-and-unread contribution, then stamps the
  // new key on the letter. A same-key call refreshes nothing and costs nothing
  // (no dirty mark either: nothing about the persisted row changed here,
  // though a caller that ALSO restamps a field like recipientName on a same-key
  // call must markDirty itself, since that content change is invisible to this
  // structural bookkeeping).
  rekey(m: M, newKey: string, now: number): void {
    if (m.recipientKey === newKey) return;
    const oldKey = m.recipientKey;
    const removed = this.bucketRemove(m);
    if (removed && !m.read && now >= m.deliverAt) {
      this.dec(oldKey);
      this.inc(newKey);
    }
    m.recipientKey = newKey;
    this.bucketAdd(m);
    this.dirty.add(oldKey);
    this.dirty.add(newKey);
  }

  // The read flip (mailTake, mailMarkRead): drops the letter's unread
  // contribution once and marks it read. Callers only reach delivered letters
  // (deliveredFor gates them), so the deliverAt guard is belt-and-braces.
  markRead(m: M, now: number): void {
    if (m.read) return;
    if (now >= m.deliverAt) this.dec(m.recipientKey);
    m.read = true;
    this.dirty.add(m.recipientKey);
  }

  // Mark one recipient's row for the next incremental save without any
  // structural bucket change: the escape hatch for a mutation that patches a
  // letter's OTHER persisted fields in place (a sender-identity restamp on a
  // letter this key did not send/receive the structural side of, or a
  // recipientName restamp on a same-key rekey() no-op). Idempotent.
  markDirty(key: string): void {
    this.dirty.add(key);
  }

  // Drain and clear the dirty set: the autosave boundary. A quiet interval
  // with no mutations returns an empty array, so the caller can skip writing
  // anything at all.
  takeDirty(): string[] {
    if (this.dirty.size === 0) return [];
    const out = [...this.dirty];
    this.dirty.clear();
    return out;
  }

  // Per-tick: land any in-flight letter whose delivery time has arrived,
  // moving it from `undelivered` into the unread count and dirtying only the
  // recipients whose persisted deliverIn must now be 0. Draws no rng and emits
  // nothing (arrival toasts stay in PostOffice.update()), so it never perturbs
  // the deterministic event/rng stream.
  deliverDue(now: number): number {
    if (this.undelivered.size === 0) return 0;
    let landed = 0;
    for (const m of this.undelivered) {
      if (now < m.deliverAt) continue;
      this.undelivered.delete(m);
      if (!m.read) this.inc(m.recipientKey);
      this.dirty.add(m.recipientKey);
      landed++;
    }
    return landed;
  }

  // Rebuild everything from the canonical book (after a deserialize/load, so
  // none of this state is ever persisted). Uses the quiet structural path:
  // this is reconstructing state that is already durable, not creating new
  // work for the next incremental autosave.
  rebuild(book: readonly M[], now: number): void {
    this.buckets.clear();
    this.unread.clear();
    this.undelivered.clear();
    this.custodyRefs.clear();
    this.dirty.clear();
    for (const m of book) this.trackQuiet(m, now);
  }

  // Is any letter in the book a custody parcel for this ref? The Exchange
  // booking dedupe; O(1) where the pre-index read walked the whole book.
  hasCustodyRef(ref: string): boolean {
    return this.custodyRefs.has(ref);
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

  private bucketRemove(m: M): boolean {
    const bucket = this.buckets.get(m.recipientKey);
    if (bucket) {
      const i = bucket.indexOf(m);
      if (i >= 0) {
        if (bucket.length === 1) this.buckets.delete(m.recipientKey);
        else bucket.splice(i, 1);
        return true;
      }
    }
    // Desync fallback: a raw recipientKey write on a tracked letter (the
    // legacy-blob purge shape tests/mail.test.ts seeds) leaves the letter
    // filed under its OLD key while the field says the new one. Find it
    // wherever it actually lives so rekey/untrack still account correctly;
    // this scan runs only on the miss path, unreachable through the normal
    // track/rekey discipline.
    for (const [key, arr] of this.buckets) {
      const i = arr.indexOf(m);
      if (i >= 0) {
        if (arr.length === 1) this.buckets.delete(key);
        else arr.splice(i, 1);
        return true;
      }
    }
    return false;
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
