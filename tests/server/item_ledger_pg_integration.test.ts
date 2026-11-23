// The delete ledger must commit or roll back with the destroyed character.
// A private schema keeps this proof isolated from developer and CI game data.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DELETED_CHARACTER_HOLDINGS_RETURNING,
  recordDeletedCharacterCopies,
} from '../../server/character_delete_item_ledger';
import { ITEM_LEDGER_SCHEMA, itemLedgerHistory } from '../../server/item_ledger_db';

const url = process.env.TEST_DATABASE_URL ?? '';
const SCHEMA = 'item_ledger_delete_integration';
const GUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe.skipIf(!url)('item ledger delete transaction on PostgreSQL', () => {
  let db: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.end();
    db = new Pool({ connectionString: url, max: 1, options: `-c search_path=${SCHEMA}` });
    await db.query(`
      CREATE TABLE accounts (id INT PRIMARY KEY);
      CREATE TABLE characters (id INT PRIMARY KEY, name TEXT, state JSONB);
      ${ITEM_LEDGER_SCHEMA}
      INSERT INTO accounts VALUES (1);
    `);
  });

  afterAll(async () => {
    if (!db) return;
    await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await db.end();
  });

  it.each(['COMMIT', 'ROLLBACK'])('keeps the consume row atomic with %s', async (finish) => {
    const id = finish === 'COMMIT' ? 1 : 2;
    await db.query('INSERT INTO characters VALUES ($1, $2, $3)', [
      id,
      'Fixture',
      {
        inventory: [{ itemId: 'duskforged_warblade', count: 1, instance: { guid: GUID } }],
      },
    ]);
    const tx = await db.connect();
    try {
      await tx.query('BEGIN');
      const deleted = await tx.query(
        `DELETE FROM characters WHERE id = $1 RETURNING ${DELETED_CHARACTER_HOLDINGS_RETURNING}`,
        [id],
      );
      expect(await recordDeletedCharacterCopies(tx, finish, 1, deleted.rows[0])).toBe(1);
      await tx.query(finish);
    } finally {
      await tx.query('ROLLBACK');
      tx.release();
    }
    const history = await itemLedgerHistory(db, finish, GUID);
    const character = await db.query('SELECT id FROM characters WHERE id = $1', [id]);
    if (finish === 'COMMIT') {
      expect(character.rowCount).toBe(0);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        kind: 'consume',
        characterId: null,
        accountId: 1,
        source: 'characterDelete',
        detail: 'bags',
      });
    } else {
      expect(character.rowCount).toBe(1);
      expect(history).toEqual([]);
    }
  });
});
