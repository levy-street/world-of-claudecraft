// The durable per-parcel custody overlay (server/mail_custody_overlay.ts):
// SQL shapes against a mocked pool, the snapshot/bake set semantics that keep
// a row alive until its parcel is provably inside a committed full-book
// write, the accounting watermark's advance gate, and the boot merge driven
// against a REAL Sim post office, because the replay-through-book-once-dedupe
// is exactly what a fake book would paper over. The transaction-level
// contract (one client, ordered statements, rollback keeps refs) is proven
// behaviorally in tests/server/save_mail_state_custody_bake.test.ts; the
// source pins at the bottom anchor only what a behavioral test cannot see
// (statement POSITIONS inside the writers and the callers).

import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<{ rows: unknown[]; rowCount?: number }>;

const db = vi.hoisted(() => ({ query: vi.fn<TestQuery>() }));

vi.mock('../../server/db', () => ({ pool: { query: db.query } }));

import {
  advanceCustodyWatermarkIn,
  CUSTODY_PARCEL_LETTERS,
  confirmBakedCustodyRefs,
  custodyOverlayStats,
  deleteBakedCustodyRefsIn,
  MERGE_MAX_PAGES,
  MERGE_PAGE_LIMIT,
  mergeCustodyParcelOverlay,
  persistCustodyParcelRow,
  pruneMailCustodyParcelsBatch,
  resetCustodyParcelOverlayForTests,
  snapshotPendingCustodyRefs,
} from '../../server/mail_custody_overlay';
import { REALM } from '../../server/realm';
import { Sim } from '../../src/sim/sim';

const { query } = db;

const GOOD_ITEMS = [{ itemId: 'rusty_hatchet', count: 1 }];

function row(ref: string) {
  return {
    custodyRef: ref,
    recipient: { key: '4242', name: 'Buyer' },
    letter: 'delivery' as const,
    items: GOOD_ITEMS,
  };
}

beforeEach(() => {
  resetCustodyParcelOverlayForTests();
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

describe('persistCustodyParcelRow', () => {
  it('writes one idempotent realm-scoped row per parcel, keyed by custodyRef', async () => {
    await persistCustodyParcelRow(row('settlement:9'));
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO mail_custody_parcels/);
    // Idempotent by ref: a retry after a crash re-inserts harmlessly; the
    // book-once dedupe owns exactly-once on the mail side.
    expect(sql).toMatch(/ON CONFLICT \(custody_ref\) DO NOTHING/);
    expect(params).toEqual([
      'settlement:9',
      REALM,
      '4242',
      'Buyer',
      'delivery',
      JSON.stringify(GOOD_ITEMS),
    ]);
    expect(snapshotPendingCustodyRefs()).toEqual(['settlement:9']);
  });
});

describe('the bake set', () => {
  it('deletes exactly the snapshot on the writer client; refs booked after it stay pending', async () => {
    await persistCustodyParcelRow(row('a'));
    await persistCustodyParcelRow(row('b'));
    const snap = snapshotPendingCustodyRefs();
    await persistCustodyParcelRow(row('c'));
    // The DELETE rides the book write's OWN transaction client, injected;
    // the pool spy must stay untouched.
    query.mockClear();
    const txQuery = vi.fn(async (_text: string, _values: unknown[]) => ({ rows: [] }));
    await deleteBakedCustodyRefsIn(txQuery, snap);
    expect(query).not.toHaveBeenCalled();
    expect(txQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = txQuery.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM mail_custody_parcels WHERE custody_ref = ANY/);
    // Realm-qualified, defensive scoping.
    expect(sql).toMatch(/AND realm = \$2/);
    expect(params).toEqual([['a', 'b'], REALM]);
    // The set forgets refs only on the caller's post-commit confirm: a
    // rollback must leave them pending so the next write re-bakes them.
    expect(snapshotPendingCustodyRefs()).toEqual(['a', 'b', 'c']);
    confirmBakedCustodyRefs(snap);
    // 'c' was booked after the snapshot (necessarily across an await, so
    // after the full-book serialize): its row must survive this bake.
    expect(snapshotPendingCustodyRefs()).toEqual(['c']);
    expect(custodyOverlayStats().pendingBake).toBe(1);
  });

  it('issues no statement for an empty snapshot', async () => {
    const txQuery = vi.fn(async (_text: string, _values: unknown[]) => ({ rows: [] }));
    await deleteBakedCustodyRefsIn(txQuery, []);
    expect(txQuery).not.toHaveBeenCalled();
  });

  it('prunes only aged residue, batched', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    await expect(pruneMailCustodyParcelsBatch(500)).resolves.toBe(3);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM mail_custody_parcels/);
    expect(sql).toMatch(/created_at < now\(\) - \(\$1 \|\| ' days'\)::interval/);
    expect(sql).toMatch(/LIMIT \$2/);
    expect(params).toEqual(['30', 500]);
  });
});

/** Drive one fully-drained empty merge so the watermark gate opens (the
 *  module arms it only after a complete merge). */
async function completeEmptyMerge(): Promise<void> {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  query.mockResolvedValueOnce({ rows: [] });
  const counts = await mergeCustodyParcelOverlay(sim);
  expect(counts.ok).toBe(true);
  query.mockClear();
}

describe('advanceCustodyWatermarkIn', () => {
  it('no-ops until a boot merge has fully drained', async () => {
    const txQuery = vi.fn(async (_text: string, _values: unknown[]) => ({ rows: [] }));
    await advanceCustodyWatermarkIn(txQuery);
    expect(txQuery).not.toHaveBeenCalled();
  });

  it('advances accounted_through to the PREVIOUS book write on the caller client, once armed', async () => {
    await completeEmptyMerge();
    const txQuery = vi.fn(async (_text: string, _values: unknown[]) => ({ rows: [] }));
    await advanceCustodyWatermarkIn(txQuery);
    expect(query).not.toHaveBeenCalled();
    expect(txQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = txQuery.mock.calls[0];
    // The two-column lag is the soundness core: accounted_through takes the
    // PREVIOUS write's transaction start, never this one's, so a row
    // inserted between a writer's serialize and its BEGIN can never be
    // classified stale.
    expect(sql).toMatch(/INSERT INTO mail_custody_watermark/);
    expect(sql).toMatch(/VALUES \(\$1, '-infinity', now\(\)\)/);
    expect(sql).toMatch(/ON CONFLICT \(realm\) DO UPDATE/);
    expect(sql).toMatch(/SET accounted_through = mail_custody_watermark\.last_book_write/);
    expect(sql).toMatch(/last_book_write = now\(\)/);
    expect(params).toEqual([REALM]);
  });

  it('stays frozen for the whole uptime after a failed merge', async () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    query.mockRejectedValueOnce(new Error('db down'));
    const counts = await mergeCustodyParcelOverlay(sim);
    expect(counts.ok).toBe(false);
    const txQuery = vi.fn(async (_text: string, _values: unknown[]) => ({ rows: [] }));
    await advanceCustodyWatermarkIn(txQuery);
    expect(txQuery).not.toHaveBeenCalled();
  });
});

describe('mergeCustodyParcelOverlay', () => {
  function overlayRows(refs: string[], letter = 'delivery', items: unknown = GOOD_ITEMS) {
    return refs.map((ref) => ({
      custody_ref: ref,
      recipient_key: '4242',
      recipient_name: 'Buyer',
      letter,
      items,
    }));
  }

  /** First query of every merge: the in-SQL watermark cutoff DELETE. */
  function mockStaleDelete(rowCount: number) {
    query.mockResolvedValueOnce({ rows: [], rowCount });
  }

  it('replays a crash-lost parcel into a real book, and dedupes it on the next boot', async () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    mockStaleDelete(0);
    query.mockResolvedValueOnce({ rows: overlayRows(['settlement:9']) });
    const first = await mergeCustodyParcelOverlay(sim);
    expect(first).toEqual({ replayed: 1, present: 0, refused: 0, stale: 0, ok: true });
    // The cutoff runs entirely in SQL at full timestamp precision: rows at
    // or before the accounting watermark are deleted, never replayed, and
    // never round-trip through a millisecond Date.
    const cutoff = query.mock.calls[0];
    expect(cutoff[0]).toMatch(/DELETE FROM mail_custody_parcels/);
    expect(cutoff[0]).toMatch(/realm = \$1/);
    expect(cutoff[0]).toMatch(
      /created_at <= \(SELECT accounted_through FROM mail_custody_watermark WHERE realm = \$1\)/,
    );
    expect(cutoff[1]).toEqual([REALM]);
    // The replay SELECT is a primary-key keyset page.
    const select = query.mock.calls[1];
    expect(select[0]).toMatch(/FROM mail_custody_parcels WHERE realm = \$1 AND custody_ref > \$2/);
    expect(select[0]).toMatch(/ORDER BY custody_ref LIMIT 10000/);
    expect(select[1]).toEqual([REALM, '']);
    expect(sim.postOffice.mail).toHaveLength(1);
    expect(sim.postOffice.mail[0].custodyRef).toBe('settlement:9');
    expect(sim.postOffice.mail[0].items.map((s) => s.itemId)).toEqual(['rusty_hatchet']);
    // An accounted ref joins the bake set so the next full-book write
    // cleans its row.
    expect(snapshotPendingCustodyRefs()).toEqual(['settlement:9']);

    // Second boot with the parcel already inside the loaded blob: the
    // book-once dedupe reports it present and books nothing new.
    resetCustodyParcelOverlayForTests();
    mockStaleDelete(0);
    query.mockResolvedValueOnce({ rows: overlayRows(['settlement:9']) });
    const second = await mergeCustodyParcelOverlay(sim);
    expect(second).toEqual({ replayed: 0, present: 1, refused: 0, stale: 0, ok: true });
    expect(sim.postOffice.mail).toHaveLength(1);
    expect(snapshotPendingCustodyRefs()).toEqual(['settlement:9']);
  });

  it('counts the rows the watermark cutoff deleted and still replays fresh ones', async () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    mockStaleDelete(2);
    query.mockResolvedValueOnce({ rows: overlayRows(['fresh:1']) });
    const result = await mergeCustodyParcelOverlay(sim);
    expect(result).toEqual({ replayed: 1, present: 0, refused: 0, stale: 2, ok: true });
    expect(sim.postOffice.mail.map((m) => m.custodyRef)).toEqual(['fresh:1']);
    expect(snapshotPendingCustodyRefs()).toEqual(['fresh:1']);
  });

  it('keeps a malformed or refused row out of the bake set instead of destroying it', async () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockStaleDelete(0);
      query.mockResolvedValueOnce({
        rows: [
          // Both malformed dimensions, one row each: an unknown letter kind,
          // and non-array items.
          ...overlayRows(['bogus:1'], 'not_a_letter'),
          ...overlayRows(['bogus:2'], 'delivery', { itemId: 'rusty_hatchet' }),
          // A parcel whose items no longer validate: refused by the book and
          // absent, so the row must survive for the operator.
          ...overlayRows(['refused:1'], 'delivery', [{ itemId: 'no_such_item_id', count: 1 }]),
          ...overlayRows(['ok:1']),
        ],
      });
      const result = await mergeCustodyParcelOverlay(sim);
      expect(result).toEqual({ replayed: 1, present: 0, refused: 3, stale: 0, ok: true });
      // Only the accounted ref may ever be baked away; the refused rows'
      // absence from the set is what keeps their rows in the table. And no
      // statement beyond the cutoff and the page SELECT ran: nothing
      // deletes a refused row.
      expect(snapshotPendingCustodyRefs()).toEqual(['ok:1']);
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('pages the whole table on the keyset and reports ok only when drained', async () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // One FULL page of cheap (malformed, so no book work) rows, then a
      // short page carrying the real parcel.
      const fullPage = overlayRows(
        Array.from({ length: MERGE_PAGE_LIMIT }, (_, i) => `bulk:${String(i).padStart(6, '0')}`),
        'not_a_letter',
      );
      mockStaleDelete(0);
      query.mockResolvedValueOnce({ rows: fullPage });
      query.mockResolvedValueOnce({ rows: overlayRows(['tail:1']) });
      const result = await mergeCustodyParcelOverlay(sim);
      expect(result).toEqual({
        replayed: 1,
        present: 0,
        refused: MERGE_PAGE_LIMIT,
        stale: 0,
        ok: true,
      });
      // The second page resumes strictly after the first page's last ref.
      expect(query).toHaveBeenCalledTimes(3);
      expect(query.mock.calls[2][1]).toEqual([
        REALM,
        `bulk:${String(MERGE_PAGE_LIMIT - 1).padStart(6, '0')}`,
      ]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('stops at the page cap with ok false, leaving the watermark frozen', async () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fullPage = overlayRows(
        Array.from({ length: MERGE_PAGE_LIMIT }, (_, i) => `bulk:${String(i).padStart(6, '0')}`),
        'not_a_letter',
      );
      mockStaleDelete(0);
      // Every page comes back full: the cap must stop the loop, not the
      // boot path.
      query.mockResolvedValue({ rows: fullPage });
      const result = await mergeCustodyParcelOverlay(sim);
      expect(result.ok).toBe(false);
      expect(query).toHaveBeenCalledTimes(1 + MERGE_MAX_PAGES);
      // An undrained merge must never arm the watermark: the unexamined
      // remainder would otherwise be classified stale at a later boot.
      const txQuery = vi.fn(async (_text: string, _values: unknown[]) => ({ rows: [] }));
      await advanceCustodyWatermarkIn(txQuery);
      expect(txQuery).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('never throws, and a failed merge is distinguishable from an empty one on the readout', async () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    query.mockRejectedValueOnce(new Error('db down'));
    await expect(mergeCustodyParcelOverlay(sim)).resolves.toEqual({
      replayed: 0,
      present: 0,
      refused: 0,
      stale: 0,
      ok: false,
    });
    expect(sim.postOffice.mail).toHaveLength(0);
    // The ops readout carries the failure: all-zero counts with ok false is
    // a FAILED merge, not an empty table.
    expect(custodyOverlayStats().lastMerge).toEqual({
      replayed: 0,
      present: 0,
      refused: 0,
      stale: 0,
      ok: false,
    });
  });

  it('keeps partial progress visible when a later page fails', async () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fullPage = overlayRows(
        Array.from({ length: MERGE_PAGE_LIMIT }, (_, i) => `bulk:${String(i).padStart(6, '0')}`),
        'not_a_letter',
      );
      mockStaleDelete(1);
      query.mockResolvedValueOnce({ rows: fullPage });
      query.mockRejectedValueOnce(new Error('db down mid-merge'));
      const result = await mergeCustodyParcelOverlay(sim);
      expect(result).toEqual({
        replayed: 0,
        present: 0,
        refused: MERGE_PAGE_LIMIT,
        stale: 1,
        ok: false,
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('resetCustodyParcelOverlayForTests clears the readout too', async () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    mockStaleDelete(0);
    query.mockResolvedValueOnce({ rows: [] });
    await mergeCustodyParcelOverlay(sim);
    expect(custodyOverlayStats().lastMerge).not.toBeNull();
    resetCustodyParcelOverlayForTests();
    expect(custodyOverlayStats().lastMerge).toBeNull();
    expect(custodyOverlayStats().pendingBake).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Wiring-order pins. The bake contract is positional (snapshot before the
// serialize-adjacent await, the bake and the watermark advance inside the
// transaction, confirm after the committed arm), and the merge must only run
// after a successful book load: these read the source because the ordering
// IS the contract. Comments are stripped first (the sibling
// main_retention_wiring.test.ts rationale: a commented-out call must never
// satisfy an order pin), every index is guarded against -1, and each slice
// is bounded to its function. The statement-level behavior (one client,
// rollback keeps refs) is proven in save_mail_state_custody_bake.test.ts.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from '../helpers/strip_comments';

function boundedBody(src: string, startNeedle: string, endNeedle: string): string {
  const start = src.indexOf(startNeedle);
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('bake and merge wiring order', () => {
  const dbSrc = stripComments(readFileSync(path.resolve(process.cwd(), 'server/db.ts'), 'utf8'));
  const gameSrc = stripComments(
    readFileSync(path.resolve(process.cwd(), 'server/game.ts'), 'utf8'),
  );

  it('saveMailState snapshots at entry; bake and watermark ride the book transaction', () => {
    const body = boundedBody(dbSrc, 'export async function saveMailState', '\nexport ');
    const snapshotAt = body.indexOf('snapshotPendingCustodyRefs()');
    const firstAwaitAt = body.indexOf('await ');
    const beginAt = body.indexOf("client.query('BEGIN')");
    const writeAt = body.indexOf('upsertWorldStateRowIn(');
    const deleteAt = body.indexOf('deleteBakedCustodyRefsIn(');
    const advanceAt = body.indexOf('advanceCustodyWatermarkIn(');
    const commitAt = body.indexOf("client.query('COMMIT')");
    const confirmAt = body.indexOf('confirmBakedCustodyRefs(');
    for (const at of [
      snapshotAt,
      firstAwaitAt,
      beginAt,
      writeAt,
      deleteAt,
      advanceAt,
      commitAt,
      confirmAt,
    ]) {
      expect(at).toBeGreaterThan(-1);
    }
    // Snapshot before anything awaits; the book upsert, the bake DELETE,
    // and the watermark advance strictly inside the transaction (after
    // BEGIN, before COMMIT); the in-memory confirm only after COMMIT.
    expect(snapshotAt).toBeLessThan(firstAwaitAt);
    expect(beginAt).toBeLessThan(writeAt);
    expect(writeAt).toBeLessThan(deleteAt);
    expect(deleteAt).toBeLessThan(advanceAt);
    expect(advanceAt).toBeLessThan(commitAt);
    expect(confirmAt).toBeGreaterThan(commitAt);
  });

  it('the atomic leave-path save bakes and advances inside the fenced transaction', () => {
    const body = boundedBody(
      dbSrc,
      'export async function saveCharacterAndMarketState',
      '\nexport ',
    );
    const snapshotAt = body.indexOf('snapshotPendingCustodyRefs()');
    const firstAwaitAt = body.indexOf('await ');
    const deleteAt = body.indexOf('deleteBakedCustodyRefsIn(');
    const advanceAt = body.indexOf('advanceCustodyWatermarkIn(');
    // transaction.commit(), not a raw client.query('COMMIT'): the fenced save
    // rides the deadline wrapper that owns the statement/lock timeouts and the
    // abort-driven pg_cancel_backend, so the commit goes through it too.
    const commitAt = body.indexOf('await transaction.commit()');
    const confirmAt = body.indexOf('confirmBakedCustodyRefs(');
    for (const at of [snapshotAt, firstAwaitAt, deleteAt, advanceAt, commitAt, confirmAt]) {
      expect(at).toBeGreaterThan(-1);
    }
    // Snapshot at entry, before the first await; the DELETE and the advance
    // inside the transaction; the confirm on the committed arm only, so
    // neither the fence-refused false arm nor a rollback can forget a
    // pending ref.
    expect(snapshotAt).toBeLessThan(firstAwaitAt);
    expect(deleteAt).toBeLessThan(advanceAt);
    expect(advanceAt).toBeLessThan(commitAt);
    expect(confirmAt).toBeGreaterThan(commitAt);
    expect(body.split('deleteBakedCustodyRefsIn(')).toHaveLength(2);
    expect(body.split('confirmBakedCustodyRefs(')).toHaveLength(2);
  });

  it('serializeMail is a deep snapshot: later book mutations cannot reach written bytes', () => {
    // The bake contract assumes the serialized book is frozen at thunk entry;
    // a lazy or copy-on-write serializeMail would silently break it.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    sim.mailSystemParcel(
      { key: '4242', name: 'Buyer' },
      CUSTODY_PARCEL_LETTERS.delivery,
      GOOD_ITEMS,
      'snap:1',
    );
    const snapshot = sim.serializeMail();
    const before = JSON.stringify(snapshot);
    sim.mailSystemParcel(
      { key: '4242', name: 'Buyer' },
      CUSTODY_PARCEL_LETTERS.delivery,
      GOOD_ITEMS,
      'snap:2',
    );
    sim.postOffice.mail[0].items.push({ itemId: 'rusty_hatchet', count: 99 });
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('game.loadMail merges the overlay only after a successful book load', () => {
    const body = boundedBody(gameSrc, 'async loadMail(): Promise<void>', 'async saveMail(');
    const loadAt = body.indexOf('this.sim.loadMail(await loadMailState())');
    const mergeAt = body.indexOf('mergeCustodyParcelOverlay(this.sim)');
    const catchAt = body.indexOf('catch');
    for (const at of [loadAt, mergeAt, catchAt]) {
      expect(at).toBeGreaterThan(-1);
    }
    // The merge sits after the load INSIDE the same try: a failed load must
    // skip it (merging onto an unloaded book would re-book parcels the
    // stored blob still owns).
    expect(mergeAt).toBeGreaterThan(loadAt);
    expect(mergeAt).toBeLessThan(catchAt);
  });

  it('both callers drain dirty mail partitions inside the queued write', () => {
    // The partitioned mail path replaces whole-book writes: the dirty set is
    // drained inside the same queued write that persists it, so a write failure
    // can rearm exactly the partitions it consumed. It rides
    // enqueueBackgroundMarketWrite (market FIFO first, THEN the major-producer
    // permit) so a dirty-book character save cannot invert against a periodic
    // mail save, and it still carries the profiler sample through.
    expect(gameSrc).toMatch(
      /await writeDirtyMailPartitions<TickProfilerSample>\(\s*this\.sim,\s*\(write, context\) => this\.enqueueBackgroundMarketWrite\(write, context\),\s*false,\s*sample,\s*\)/,
    );
    expect(gameSrc).toContain('mailPartitionsForRearm = this.sim.takeDirtyMailPartitions()');
    expect(gameSrc).toMatch(
      /saveCharacterAndMarketState\(\s*session\.characterId,\s*snap\.level,\s*snap,\s*this\.sim\.serializeMarket\(\),\s*mailPartitionsForRearm,/,
    );
  });
});
