// Opt-in REAL-Postgres proof for the custody parcel overlay: the table DDL
// through the real ensureSchema (pinning the db.ts registration), the
// insert/merge/bake lifecycle against a REAL Sim post office, and the
// crash-then-clean-shutdown story end to end. The mocked-pool suite
// (tests/server/mail_custody_overlay.test.ts) pins shapes and set
// semantics; this one proves the SQL and the durability claim.
//
// Gated on TEST_DATABASE_URL like every other *_integration.test.ts:
// without it the file skips green and CI's DB-free floor is unchanged.

import type { Pool as PgPool } from 'pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CharacterState, type MailSave, type MarketSave, Sim } from '../src/sim/sim';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_mail_custody_verify';

function verifyUrl(admin: string): string {
  const u = new URL(admin);
  u.pathname = `/${VERIFY_DB}`;
  return u.toString();
}

if (ADMIN_URL) process.env.DATABASE_URL = verifyUrl(ADMIN_URL);

const describeDb = ADMIN_URL ? describe : describe.skip;

describeDb('mail custody overlay (REAL Postgres)', () => {
  let admin: PgPool;
  let pool: PgPool;
  let db: typeof import('../server/db');
  let overlay: typeof import('../server/mail_custody_overlay');
  let nextSeq = 0;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL, max: 2 });
    const own = new URL(ADMIN_URL as string).pathname.replace(/^\//, '');
    // Never drop the database the caller pointed us at.
    expect(own).not.toBe(VERIFY_DB);
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [VERIFY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await admin.query(`CREATE DATABASE ${VERIFY_DB}`);

    db = await import('../server/db');
    overlay = await import('../server/mail_custody_overlay');

    // The REAL boot path: proves the mail_custody_parcels registration in
    // ensureSchema, not just the DDL string.
    await db.ensureSchema();

    pool = new Pool({ connectionString: verifyUrl(ADMIN_URL as string), max: 4 });
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await db?.pool?.end().catch(() => {});
    await admin?.end().catch(() => {});
  }, 30_000);

  const REF = 'settlement:pg:1';
  const ROW = {
    custodyRef: REF,
    recipient: { key: '4242', name: 'Buyer' },
    letter: 'delivery' as const,
    items: [{ itemId: 'rusty_hatchet', count: 1 }],
  };
  const MARKET = { listings: [], collections: {} } as unknown as MarketSave;
  const STATE = {
    level: 1,
    questLog: [],
    questsDone: [],
    inventory: [],
  } as unknown as CharacterState;

  async function makeSaveCharacter(): Promise<number> {
    const account = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`mailcustody_${++nextSeq}`],
    );
    const character = await pool.query(
      `INSERT INTO characters (account_id, name, class, realm, level, state)
       VALUES ($1, $2, 'warrior', $3, 1, '{}'::jsonb) RETURNING id`,
      [
        Number(account.rows[0].id),
        `MailCustody${nextSeq}`,
        (await import('../server/realm')).REALM,
      ],
    );
    return Number(character.rows[0].id);
  }

  function allMailPartitions(sim: Sim): { recipientKey: string; letters: MailSave['mail'] }[] {
    const byRecipient = new Map<string, MailSave['mail']>();
    for (const letter of sim.serializeMail().mail) {
      const bucket = byRecipient.get(letter.recipientKey) ?? [];
      bucket.push(letter);
      byRecipient.set(letter.recipientKey, bucket);
    }
    return [...byRecipient].map(([recipientKey, letters]) => ({ recipientKey, letters }));
  }

  async function saveCurrentMailBook(characterId: number, sim: Sim): Promise<void> {
    const partitions = allMailPartitions(sim);
    expect(partitions.length).toBeGreaterThan(0);
    expect(await db.saveCharacterAndMarketState(characterId, 1, STATE, MARKET, partitions)).toBe(
      true,
    );
  }

  it('carries a parcel through crash replay, then bakes it into a clean book write', async () => {
    const characterId = await makeSaveCharacter();
    overlay.resetCustodyParcelOverlayForTests();

    // Book + persist the row (the parcel path; the book itself is the live
    // sim's and is deliberately NOT written here).
    const sim1 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    expect(
      sim1.mailSystemParcel(ROW.recipient, overlay.CUSTODY_PARCEL_LETTERS.delivery, ROW.items, REF),
    ).toBe(true);
    await overlay.persistCustodyParcelRow(ROW);
    // Idempotent re-insert (the retry arm).
    await overlay.persistCustodyParcelRow(ROW);
    const stored = await pool.query(`SELECT custody_ref, letter FROM mail_custody_parcels`);
    expect(stored.rows).toEqual([{ custody_ref: REF, letter: 'delivery' }]);

    // CRASH: the process dies before any full-book write. A new process
    // loads a book WITHOUT the parcel and merges the overlay.
    overlay.resetCustodyParcelOverlayForTests();
    const sim2 = new Sim({ seed: 43, playerClass: 'warrior', noPlayer: true });
    const merged = await overlay.mergeCustodyParcelOverlay(sim2);
    expect(merged).toEqual({ replayed: 1, present: 0, refused: 0, stale: 0, ok: true });
    expect(sim2.hasCustodyParcel(REF)).toBe(true);

    // CLEAN SHUTDOWN: the next committed partition write carries the parcel;
    // the bake inside saveCharacterAndMarketState deletes the row, and the
    // accounting watermark is born (accounted_through starts at -infinity: a first write has no
    // previous write to vouch for).
    await saveCurrentMailBook(characterId, sim2);
    const after = await pool.query(`SELECT count(*)::int AS n FROM mail_custody_parcels`);
    expect(after.rows[0].n).toBe(0);
    const wmBorn = await pool.query(
      `SELECT (accounted_through = '-infinity'::timestamptz) AS neg FROM mail_custody_watermark`,
    );
    expect(wmBorn.rows).toEqual([{ neg: true }]);

    // Next boot: the parcel now arrives from the blob itself, no overlay
    // rows left to replay, and the book-once state is intact.
    const sim3 = new Sim({ seed: 44, playerClass: 'warrior', noPlayer: true });
    sim3.loadMail(await db.loadMailState());
    expect(sim3.hasCustodyParcel(REF)).toBe(true);
    const remerge = await overlay.mergeCustodyParcelOverlay(sim3);
    expect(remerge).toEqual({ replayed: 0, present: 0, refused: 0, stale: 0, ok: true });

    // A SECOND partition write advances accounted_through to the FIRST write's
    // transaction start (the two-column lag): finite now, and strictly
    // behind last_book_write, compared in SQL at full precision.
    await saveCurrentMailBook(characterId, sim3);
    const wm = await pool.query(
      `SELECT (accounted_through = '-infinity'::timestamptz) AS neg,
              (accounted_through < last_book_write) AS ordered
         FROM mail_custody_watermark`,
    );
    expect(wm.rows).toEqual([{ neg: false, ordered: true }]);

    // The rollback guard end to end: a row at or before accounted_through
    // describes a parcel some committed book write already accounted for;
    // the merge deletes it instead of replaying it.
    await pool.query(
      `INSERT INTO mail_custody_parcels (custody_ref, realm, recipient_key, recipient_name, letter, items, created_at)
       VALUES ('stale:pg:1', $1, '4242', 'Buyer', 'delivery', $2::jsonb, now() - interval '1 hour')`,
      [(await import('../server/realm')).REALM, JSON.stringify(ROW.items)],
    );
    const sim4 = new Sim({ seed: 45, playerClass: 'warrior', noPlayer: true });
    sim4.loadMail(await db.loadMailState());
    const staleMerge = await overlay.mergeCustodyParcelOverlay(sim4);
    expect(staleMerge).toEqual({ replayed: 0, present: 0, refused: 0, stale: 1, ok: true });
    expect(sim4.hasCustodyParcel('stale:pg:1')).toBe(false);
    const left = await pool.query(`SELECT count(*)::int AS n FROM mail_custody_parcels`);
    expect(left.rows[0].n).toBe(0);
  });
});
