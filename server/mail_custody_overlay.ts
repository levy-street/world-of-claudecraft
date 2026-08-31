// Durable per-parcel overlay for $WOC custody mail. Booking a custody parcel
// used to persist by re-serializing and rewriting the ENTIRE per-realm mail
// blob (89 MB in production, roughly 250 ms of main-thread stringify per
// parcel on the shared market serial writer), so each delivered item, return,
// and sold notice cost the world loop an amount proportional to the book, not
// the parcel. Instead, each booked parcel writes ONE small row here, durable
// before the settlement advances. The parcel itself lives in the in-memory
// book as before and reaches the blob on the next full book write (the 30 s
// autosave or the leave-path atomic save), after which its row is deleted
// ("baked").
//
// Crash contract. A durable FULL-BOOK write is also the collection-durability
// event, so rows are deleted only for parcels booked BEFORE that write
// serialized (the pendingBake snapshot below), never by comparing book
// contents: a parcel collected fast still gets its row deleted (the book
// without it is durable truth), while a parcel booked mid-write keeps its
// row. At boot, surviving rows REPLAY through the sim's book-once
// mailSystemParcel: a parcel already inside the loaded blob dedupes on its
// custodyRef, and one the crash window lost is re-booked (the letter re-dates
// to the reboot, which is the existing crash-window semantics). Replay runs
// only after a SUCCESSFUL book load; merging onto an unloaded book would
// re-book parcels the stored blob still owns.
//
// The rollback guard is the accounting watermark (mail_custody_watermark):
// rows at or before `accounted_through` are provably inside a committed book
// write or durably collected out of it, so the boot merge deletes them
// instead of replaying them (replaying could re-book a parcel COLLECTED
// under an old binary running without the bake). The soundness argument
// lives on advanceCustodyWatermarkIn; the watermark only ever advances
// inside a committed book-write transaction, and only after a boot merge
// that examined every surviving row.
//
// Retention: healthy rows are cleaned by the bake and the watermark cutoff;
// the constant-window residue prune below joins the nightly retention sweep
// for the two populations those paths structurally cannot reach (refused
// rows an operator never resolved, and rows for realms no process serves).

import {
  type LetterDef,
  WOC_MARKET_DELIVERY_LETTER,
  WOC_MARKET_RETURN_LETTER,
  WOC_MARKET_SOLD_LETTER,
} from '../src/sim/content/letters';
import type { InvSlot } from '../src/sim/types';
// Deliberate cycle with ./db (which imports this module's SCHEMA const):
// safe ONLY because `pool` is dereferenced inside function bodies, never at
// module scope. Do not add module-scope pool usage here.
import { pool } from './db';
import { REALM } from './realm';

export const MAIL_CUSTODY_PARCELS_SCHEMA = `
CREATE TABLE IF NOT EXISTS mail_custody_parcels (
  custody_ref TEXT PRIMARY KEY,
  realm TEXT NOT NULL,
  recipient_key TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  letter TEXT NOT NULL,
  items JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_custody_parcels_realm_created
  ON mail_custody_parcels (realm, created_at);
CREATE TABLE IF NOT EXISTS mail_custody_watermark (
  realm TEXT PRIMARY KEY,
  accounted_through TIMESTAMPTZ NOT NULL,
  last_book_write TIMESTAMPTZ NOT NULL
);
`;

export type CustodyParcelLetter = 'delivery' | 'return' | 'sold_notice';

/** The letter templates by overlay kind: the same mapping the custody bridge
 *  books with, so a replayed parcel is byte-for-byte the letter the delivery
 *  path would have sent. */
export const CUSTODY_PARCEL_LETTERS: Record<CustodyParcelLetter, LetterDef> = {
  delivery: WOC_MARKET_DELIVERY_LETTER,
  return: WOC_MARKET_RETURN_LETTER,
  sold_notice: WOC_MARKET_SOLD_LETTER,
};

export interface CustodyParcelRow {
  custodyRef: string;
  recipient: { key: string; name: string };
  letter: CustodyParcelLetter;
  items: InvSlot[];
}

/** The slice of Sim the boot merge needs (the real Sim satisfies it). */
export interface CustodyParcelBook {
  mailSystemParcel(
    recipient: { key: string; name: string },
    letter: LetterDef,
    items: InvSlot[],
    custodyRef?: string,
  ): boolean;
  hasCustodyParcel(custodyRef: string): boolean;
}

// Refs booked in THIS process (inserted here or replayed by the boot merge)
// whose parcels sit in the in-memory book but are not yet baked into a
// durable full-book write. One custody bridge per realm process, so
// module-level like the escrow counters in woc_market_custody.ts.
const pendingBake = new Set<string>();

// True once THIS boot's merge examined every surviving overlay row (all
// pages drained, no error). Until then the watermark must not advance: an
// unexamined row's parcel is not in the in-memory book, so no book write
// this process makes can account for it, and advancing past it would let a
// later boot's merge delete it unreplayed.
let bootMergeComplete = false;

/** Persist one booked parcel. Idempotent per custodyRef (a retry after a
 *  crash re-inserts harmlessly; the book-once dedupe owns exactly-once on
 *  the mail side). Resolving is the parcel's durability: callers must not
 *  advance a settlement until this resolves. */
export async function persistCustodyParcelRow(row: CustodyParcelRow): Promise<void> {
  await pool.query(
    `INSERT INTO mail_custody_parcels (custody_ref, realm, recipient_key, recipient_name, letter, items)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (custody_ref) DO NOTHING`,
    [
      row.custodyRef,
      REALM,
      row.recipient.key,
      row.recipient.name,
      row.letter,
      JSON.stringify(row.items),
    ],
  );
  pendingBake.add(row.custodyRef);
}

/** Snapshot the refs pending bake, taken by a full-book writer AT ENTRY,
 *  before anything awaits: no awaited gap separates the caller's
 *  serializeMail() argument from the callee's first statement, so every
 *  snapshotted parcel is inside the book being written or durably collected
 *  out of it, and a parcel booked later (necessarily across an await) is
 *  never snapshotted. */
export function snapshotPendingCustodyRefs(): string[] {
  return [...pendingBake];
}

/** Issue the bake DELETE on the SAME client, INSIDE the transaction that
 *  makes the book durable: "blob durable without the parcel" and "row gone"
 *  must commit together, or two failed post-commit deletes bracketing a
 *  collection would leave a row that replays a collected parcel (the
 *  structural exactly-once the old whole-book write had for free). A throw
 *  here rolls the book write back with it, which is the correct atomicity.
 *  The realm qualifier is defensive scoping (refs are globally unique
 *  today). */
export async function deleteBakedCustodyRefsIn(
  query: (text: string, values: unknown[]) => Promise<unknown>,
  refs: readonly string[],
): Promise<void> {
  if (refs.length === 0) return;
  await query(
    `DELETE FROM mail_custody_parcels WHERE custody_ref = ANY($1::text[]) AND realm = $2`,
    [[...refs], REALM],
  );
}

/** Advance the accounting watermark INSIDE a committed full-book write
 *  transaction. `accounted_through` takes the PREVIOUS book write's
 *  transaction start (`last_book_write`), never this one's: a row with
 *  created_at at or before that instant had its INSERT execute before write
 *  N began, so its parcel was booked strictly earlier still, and because
 *  every book write rides the market serial FIFO, write N+1's
 *  serializeMail() started only after write N committed. Every such parcel
 *  is therefore inside the book THIS transaction writes, or durably
 *  collected out of it. The argument uses one database clock plus the
 *  FIFO's real-time ordering only: no wall-clock read outside a
 *  transaction, no cross-connection ordering assumption, no comparison a
 *  serialize-to-BEGIN gap can invert. Rows booked after this write
 *  serialized land past the watermark and replay at boot, where the
 *  book-once dedupe keeps them single.
 *
 *  No-ops until this boot's merge fully drained (bootMergeComplete): a
 *  frozen watermark only means rows replay through the dedupe instead of
 *  being deleted, which is always safe. */
export async function advanceCustodyWatermarkIn(
  query: (text: string, values: unknown[]) => Promise<unknown>,
): Promise<void> {
  if (!bootMergeComplete) return;
  await query(
    `INSERT INTO mail_custody_watermark (realm, accounted_through, last_book_write)
     VALUES ($1, '-infinity', now())
     ON CONFLICT (realm) DO UPDATE
       SET accounted_through = mail_custody_watermark.last_book_write,
           last_book_write = now()`,
    [REALM],
  );
}

/** Forget the baked refs AFTER their transaction committed (never before: a
 *  rollback must leave them pending so the next write re-bakes them). */
export function confirmBakedCustodyRefs(refs: readonly string[]): void {
  for (const ref of refs) pendingBake.delete(ref);
}

// The last boot merge's counts plus the live bake-set size, for the market
// monitor readout: a growing overlay table, a stuck refused row, or a
// FAILED merge (ok false) must be visible to an operator without a log
// grep.
let lastMergeCounts: CustodyOverlayMergeCounts | null = null;
export function custodyOverlayStats(): {
  pendingBake: number;
  lastMerge: CustodyOverlayMergeCounts | null;
} {
  return { pendingBake: pendingBake.size, lastMerge: lastMergeCounts };
}

/** Residue reaper for the nightly retention sweep. The bake and the boot
 *  merge's watermark cutoff clean every healthy row, so this drains only
 *  the residue those paths structurally cannot reach: refused rows an
 *  operator never resolved, and rows for a realm no process serves any
 *  more. The window is a constant (deliberately no env knob, the
 *  stepup-challenges pattern): far past any plausible investigation, and
 *  rows this old describe parcels whose settlement machinery gave up long
 *  ago. */
export const MAIL_CUSTODY_RESIDUE_RETENTION_DAYS = 30;

export async function pruneMailCustodyParcelsBatch(batchSize: number): Promise<number> {
  const res = await pool.query(
    `DELETE FROM mail_custody_parcels
      WHERE ctid IN (
        SELECT ctid FROM mail_custody_parcels
         WHERE created_at < now() - ($1 || ' days')::interval
         ORDER BY created_at
         LIMIT $2)`,
    [String(MAIL_CUSTODY_RESIDUE_RETENTION_DAYS), Math.max(1, Math.floor(batchSize))],
  );
  return res.rowCount ?? 0;
}

function isCustodyParcelLetter(value: unknown): value is CustodyParcelLetter {
  return value === 'delivery' || value === 'return' || value === 'sold_notice';
}

/** The boot merge's page size. Pages continue until the table drains or
 *  MERGE_MAX_PAGES is hit, so a pathological backlog can never hold the
 *  boot path hostage; an undrained merge leaves the watermark frozen (see
 *  advanceCustodyWatermarkIn), so unexamined rows replay at a later boot
 *  rather than ever being classified stale. */
export const MERGE_PAGE_LIMIT = 10_000;
export const MERGE_MAX_PAGES = 20;

export interface CustodyOverlayMergeCounts {
  replayed: number;
  present: number;
  refused: number;
  stale: number;
  /** True only when every surviving row was examined (all pages drained, no
   *  error). False is the operator's failed-merge signal: all-zero counts
   *  with ok false is a failed merge, not an empty table, and the watermark
   *  stays frozen for the whole uptime. */
  ok: boolean;
}

/** Boot merge: replay the surviving overlay rows for this realm through the
 *  book-once parcel entry. A parcel already in the loaded blob dedupes on
 *  its custodyRef; one the crash window lost re-books. Every accounted ref
 *  joins pendingBake so the next full-book write cleans its row.
 *
 *  THE WATERMARK CUTOFF is the rollback-window guard: a row at or before
 *  `accounted_through` is provably inside a committed book write or durably
 *  collected out of it (the soundness argument is on
 *  advanceCustodyWatermarkIn), so replaying it could re-book a COLLECTED
 *  parcel: the one dupe an old binary running without the bake could
 *  otherwise leave behind. Such rows are deleted, never replayed, and the
 *  comparison happens entirely in SQL so the microsecond timestamps never
 *  round-trip through a millisecond Date. A row that is past the watermark
 *  but refused (its items no longer validate, which a parcel that booked
 *  once should never hit) is kept and reported for the operator, and is
 *  cleaned once the advancing watermark passes it.
 *
 *  Never throws: the book already loaded successfully by the time this
 *  runs, and a merge failure must read as "the watermark stays frozen and
 *  every row replays at a later boot", never as a mail-load failure. */
export async function mergeCustodyParcelOverlay(
  book: CustodyParcelBook,
): Promise<CustodyOverlayMergeCounts> {
  const counts: CustodyOverlayMergeCounts = {
    replayed: 0,
    present: 0,
    refused: 0,
    stale: 0,
    ok: false,
  };
  try {
    // The watermark cutoff, entirely in SQL. `<=` is sound because
    // accounted_through is itself a transaction start: a row created at
    // exactly that instant was still booked strictly before it (booking
    // precedes the INSERT's execution). No watermark row (or '-infinity')
    // deletes nothing.
    const stale = await pool.query(
      `DELETE FROM mail_custody_parcels
        WHERE realm = $1
          AND created_at <= (SELECT accounted_through FROM mail_custody_watermark WHERE realm = $1)`,
      [REALM],
    );
    counts.stale = stale.rowCount ?? 0;
    // Keyset pages over the primary key: the merge drains the whole table
    // (bounded per statement), because any row left unexamined freezes the
    // watermark for the entire uptime.
    let afterRef = '';
    for (let page = 0; ; page++) {
      if (page >= MERGE_MAX_PAGES) {
        console.error(
          `[mail_custody] overlay merge stopped at ${MERGE_MAX_PAGES} pages of ${MERGE_PAGE_LIMIT}; the watermark stays frozen and the remainder replays at a later boot`,
        );
        break;
      }
      const res = await pool.query(
        `SELECT custody_ref, recipient_key, recipient_name, letter, items
         FROM mail_custody_parcels WHERE realm = $1 AND custody_ref > $2
         ORDER BY custody_ref LIMIT ${MERGE_PAGE_LIMIT}`,
        [REALM, afterRef],
      );
      for (const r of res.rows) {
        const ref = String(r.custody_ref);
        const letter: unknown = r.letter;
        if (!isCustodyParcelLetter(letter) || !Array.isArray(r.items)) {
          counts.refused++;
          console.error(`[mail_custody] overlay row malformed for custodyRef ${ref}`);
          continue;
        }
        const recipient = { key: String(r.recipient_key), name: String(r.recipient_name) };
        if (book.mailSystemParcel(recipient, CUSTODY_PARCEL_LETTERS[letter], r.items, ref)) {
          counts.replayed++;
        } else if (book.hasCustodyParcel(ref)) {
          counts.present++;
        } else {
          counts.refused++;
          console.error(`[mail_custody] overlay replay refused for custodyRef ${ref}`);
          continue;
        }
        pendingBake.add(ref);
      }
      if (res.rows.length < MERGE_PAGE_LIMIT) {
        counts.ok = true;
        break;
      }
      afterRef = String(res.rows[res.rows.length - 1].custody_ref);
    }
    if (counts.replayed + counts.present + counts.refused + counts.stale > 0) {
      console.log(
        `mail custody overlay: ${counts.replayed} parcels replayed, ${counts.present} already in the book, ${counts.refused} refused, ${counts.stale} stale rows cleaned`,
      );
    }
  } catch (err) {
    counts.ok = false;
    console.error(
      '[mail_custody] overlay merge failed; the watermark stays frozen and every row replays at a later boot:',
      err,
    );
  }
  if (counts.ok) bootMergeComplete = true;
  lastMergeCounts = counts;
  return counts;
}

/** Test-only: the module-level bake set, merge stats, and watermark gate
 *  survive across cases otherwise. */
export function resetCustodyParcelOverlayForTests(): void {
  pendingBake.clear();
  lastMergeCounts = null;
  bootMergeComplete = false;
}
