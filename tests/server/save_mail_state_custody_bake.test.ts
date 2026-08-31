// Behavioral proof of the custody bake transaction in db.saveMailState. The
// wiring-order source pins (tests/server/mail_custody_overlay.test.ts) anchor
// statement POSITIONS, but only observing the statements on ONE client proves
// the contract itself: the blob upsert, the bake DELETE, and the watermark
// advance all ride the same transaction on the same connection (a bake
// through pool.query would sit OUTSIDE the transaction and silently reopen
// the failed-delete-brackets-a-collection dupe), and a mid-transaction
// failure rolls the book write back with the refs still pending. Runs the
// real db.ts against a mocked pg Pool.

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_save_mail_bake';

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Recorded {
  text: string;
  values?: readonly unknown[];
}

const rec = vi.hoisted(() => ({
  client: [] as Recorded[],
  poolDirect: [] as Recorded[],
  failOn: null as ((text: string) => boolean) | null,
}));

vi.mock('pg', () => {
  class FakePool {
    async connect() {
      return {
        query: async (text: string, values?: readonly unknown[]) => {
          rec.client.push({ text, values });
          if (rec.failOn?.(text)) throw new Error('injected client failure');
          return { rows: [], rowCount: 0 };
        },
        release: () => {},
      };
    }
    async query(text: string, values?: readonly unknown[]) {
      rec.poolDirect.push({ text, values });
      return { rows: [], rowCount: 0 };
    }
    on() {
      return this;
    }
    async end() {}
  }
  return { Pool: FakePool, default: { Pool: FakePool } };
});

import * as db from '../../server/db';
import {
  mergeCustodyParcelOverlay,
  persistCustodyParcelRow,
  resetCustodyParcelOverlayForTests,
  snapshotPendingCustodyRefs,
} from '../../server/mail_custody_overlay';
import { REALM } from '../../server/realm';

type MailSaveArg = Parameters<typeof db.saveMailState>[0];
const SAVE = { book: 'frozen' } as unknown as MailSaveArg;

/** Collapse a recorded statement to its kind so the ORDER is assertable. */
function kind(text: string): string {
  const t = text.trim().toUpperCase();
  if (t.startsWith('BEGIN')) return 'BEGIN';
  if (t.startsWith('COMMIT')) return 'COMMIT';
  if (t.startsWith('ROLLBACK')) return 'ROLLBACK';
  if (t.includes('INSERT INTO WORLD_STATE')) return 'BOOK_UPSERT';
  if (t.includes('DELETE FROM MAIL_CUSTODY_PARCELS')) return 'BAKE_DELETE';
  if (t.includes('MAIL_CUSTODY_WATERMARK')) return 'WATERMARK';
  return 'OTHER';
}

const ROW = {
  custodyRef: 'settlement:tx:1',
  recipient: { key: '4242', name: 'Buyer' },
  letter: 'delivery' as const,
  items: [{ itemId: 'rusty_hatchet', count: 1 }],
};

/** A book stub for arming the watermark gate via an empty, fully-drained
 *  merge (the merge reads only through the mocked pool, which returns no
 *  rows, so the book is never consulted). */
const EMPTY_BOOK = {
  mailSystemParcel: () => true,
  hasCustodyParcel: () => false,
};

beforeEach(() => {
  resetCustodyParcelOverlayForTests();
  rec.client.length = 0;
  rec.poolDirect.length = 0;
  rec.failOn = null;
});

describe('saveMailState custody bake transaction', () => {
  it('runs upsert, bake, and watermark in ONE transaction on ONE client, then confirms', async () => {
    await mergeCustodyParcelOverlay(EMPTY_BOOK);
    await persistCustodyParcelRow(ROW);
    rec.client.length = 0;
    rec.poolDirect.length = 0;

    await db.saveMailState(SAVE);
    expect(rec.client.map((s) => kind(s.text))).toEqual([
      'BEGIN',
      'BOOK_UPSERT',
      'BAKE_DELETE',
      'WATERMARK',
      'COMMIT',
    ]);
    // The bake must never ride a separate pooled connection: outside the
    // transaction it could commit while the book write rolls back, leaving
    // a deleted row for an undurable parcel.
    expect(rec.poolDirect).toEqual([]);
    const upsert = rec.client.find((s) => kind(s.text) === 'BOOK_UPSERT');
    expect(upsert?.values).toEqual([`mail:${REALM}`, JSON.stringify(SAVE)]);
    const bake = rec.client.find((s) => kind(s.text) === 'BAKE_DELETE');
    expect(bake?.values).toEqual([['settlement:tx:1'], REALM]);
    // Committed: the ref is confirmed out of the pending set.
    expect(snapshotPendingCustodyRefs()).toEqual([]);
  });

  it('a failed bake rolls the book write back and keeps the refs pending', async () => {
    await mergeCustodyParcelOverlay(EMPTY_BOOK);
    await persistCustodyParcelRow(ROW);
    rec.client.length = 0;
    rec.failOn = (text) => kind(text) === 'BAKE_DELETE';

    await expect(db.saveMailState(SAVE)).rejects.toThrow('injected client failure');
    const kinds = rec.client.map((s) => kind(s.text));
    expect(kinds).toEqual(['BEGIN', 'BOOK_UPSERT', 'BAKE_DELETE', 'ROLLBACK']);
    expect(kinds).not.toContain('COMMIT');
    // Every rollback keeps every row pending: the next write re-bakes it.
    expect(snapshotPendingCustodyRefs()).toEqual(['settlement:tx:1']);
  });

  it('takes the same transactional path with no pending refs, watermark still frozen pre-merge', async () => {
    // No merge ran (a failed-load boot): the watermark must not advance, and
    // an empty bake set issues no DELETE, but the book write still commits.
    await db.saveMailState(SAVE);
    expect(rec.client.map((s) => kind(s.text))).toEqual(['BEGIN', 'BOOK_UPSERT', 'COMMIT']);
    expect(rec.poolDirect).toEqual([]);
  });
});
