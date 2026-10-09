// A character delete is HARD (DELETE FROM characters, no archive, no restore),
// so every tracked (epic or legendary) copy the character held ends at that
// statement and writes its final `consume` ledger row
// (server/character_delete_item_ledger.ts). Pins: the container walk over the
// RETURNING projection, the one multi-row INSERT and its literal SQL shape,
// the savepoint posture (an audit refusal never blocks the delete, a dead
// connection still propagates), and the order inside the real delete
// transaction (server/character_delete_db.ts): after the DELETE, before COMMIT.
import { describe, expect, it, vi } from 'vitest';
import { deleteOwnedCharacterRow } from '../../server/character_delete_db';
import {
  CHARACTER_DELETE_ITEM_SOURCE,
  characterDeleteLedgerInsert,
  DELETED_CHARACTER_HOLDINGS_RETURNING,
  type DeletedCharacterHoldingsRow,
  recordDeletedCharacterCopies,
  trackedCopiesInDeletedCharacter,
} from '../../server/character_delete_item_ledger';

const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const G3 = '33333333-3333-4333-8333-333333333333';
const G4 = '44444444-4444-4444-8444-444444444444';
const G5 = '55555555-5555-4555-8555-555555555555';
const G6 = '66666666-6666-4666-8666-666666666666';

const EPIC_ARMOR = 'crownforged_dreadhelm';
const EPIC_ROD = 'tidewrought_fishing_rod';
const EPIC_WEAPON = 'duskforged_warblade';
const COMMON_WEAPON = 'worn_sword';

function holdings(): DeletedCharacterHoldingsRow {
  return {
    name: 'Doomed',
    inventory: [
      { itemId: EPIC_ARMOR, count: 1, instance: { guid: G1 } },
      { itemId: COMMON_WEAPON, count: 1 },
      { itemId: EPIC_ROD, count: 1, instance: { guid: 'not-a-uuid' } },
      { itemId: 'linen_scrap', count: 3, instance: { signer: 'Someone' } },
      'garbage',
    ],
    bank: [{ itemId: EPIC_ROD, count: 1, instance: { guid: G2 } }],
    vault_special: [{ itemId: EPIC_ARMOR, count: 1, instance: { guid: G3 } }],
    vendor_buyback: [{ itemId: EPIC_WEAPON, count: 1, instance: { guid: G4 } }],
    equipment: { mainHand: COMMON_WEAPON, head: EPIC_ARMOR, chest: 'missing_def' },
    // The common weapon was promoted in place: its rolled quality wins.
    equipment_instance: { mainHand: { guid: G5, rolled: { quality: 'legendary' } } },
    // Legacy plural key: read only for a slot the current key does not carry.
    equipment_instances: {
      mainHand: { guid: '99999999-9999-4999-8999-999999999999' },
      chest: { guid: G6 },
    },
  };
}

describe('trackedCopiesInDeletedCharacter', () => {
  it('finds every guid-bearing copy in every container, in a stable order', () => {
    expect(trackedCopiesInDeletedCharacter(holdings())).toEqual([
      { guid: G1, itemId: EPIC_ARMOR, quality: 'epic', container: 'bags' },
      { guid: G2, itemId: EPIC_ROD, quality: 'epic', container: 'bank' },
      { guid: G3, itemId: EPIC_ARMOR, quality: 'epic', container: 'vault' },
      { guid: G4, itemId: EPIC_WEAPON, quality: 'epic', container: 'buyback' },
      { guid: G5, itemId: COMMON_WEAPON, quality: 'legendary', container: 'equipped:mainHand' },
      { guid: G6, itemId: 'missing_def', quality: 'unknown', container: 'equipped:chest' },
    ]);
  });

  it('tolerates an absent row, absent containers, and malformed shapes', () => {
    expect(trackedCopiesInDeletedCharacter(undefined)).toEqual([]);
    expect(trackedCopiesInDeletedCharacter({})).toEqual([]);
    expect(
      trackedCopiesInDeletedCharacter({
        inventory: { not: 'an array' },
        bank: null,
        equipment: ['not', 'a', 'map'],
        equipment_instance: 'nope',
      }),
    ).toEqual([]);
  });

  it('projects only the payload-bearing containers of the stored state', () => {
    expect(DELETED_CHARACTER_HOLDINGS_RETURNING).toContain("state->'inventory' AS inventory");
    expect(DELETED_CHARACTER_HOLDINGS_RETURNING).toContain("state->'bank'->'inventory' AS bank");
    expect(DELETED_CHARACTER_HOLDINGS_RETURNING).toContain(
      "state->'vault'->'special' AS vault_special",
    );
    expect(DELETED_CHARACTER_HOLDINGS_RETURNING).toContain(
      "state->'vendorBuyback' AS vendor_buyback",
    );
    expect(DELETED_CHARACTER_HOLDINGS_RETURNING).toContain(
      "state->'equipmentInstance' AS equipment_instance",
    );
    expect(DELETED_CHARACTER_HOLDINGS_RETURNING).not.toMatch(/\bstate\s*,|\bstate\s*$/);
  });
});

describe('characterDeleteLedgerInsert', () => {
  it('is null when the character held no tracked copy', () => {
    expect(characterDeleteLedgerInsert('realm-a', 7, 'Doomed', [])).toBeNull();
  });

  it('builds one consume INSERT with a NULL character id and parallel arrays', () => {
    const copies = trackedCopiesInDeletedCharacter(holdings()).slice(0, 2);
    const insert = characterDeleteLedgerInsert('realm-a', 7, 'Doomed', copies);
    if (!insert) throw new Error('expected an insert');
    expect(insert.text).toMatch(/^INSERT INTO item_ledger/);
    expect(insert.text).toContain("'consume', NULL, $2");
    expect(insert.text).toContain('unnest($5::text[], $6::text[], $7::text[], $8::text[])');
    expect(insert.values).toEqual([
      'realm-a',
      7,
      'Doomed',
      'characterDelete',
      [G1, G2],
      [EPIC_ARMOR, EPIC_ROD],
      ['epic', 'epic'],
      ['bags', 'bank'],
    ]);
    expect(CHARACTER_DELETE_ITEM_SOURCE).toBe('characterDelete');
  });
});

function fakeTransaction(failInsert?: Error) {
  const sql: string[] = [];
  return {
    sql,
    query: vi.fn(async (text: string, _values?: unknown[]) => {
      sql.push(text);
      if (failInsert && /INSERT INTO item_ledger/.test(text)) throw failInsert;
      return { rows: [], rowCount: 0 };
    }),
  };
}

describe('recordDeletedCharacterCopies', () => {
  it('issues no statement at all for a character with no tracked copy', async () => {
    const tx = fakeTransaction();
    expect(await recordDeletedCharacterCopies(tx, 'realm-a', 7, { inventory: [] })).toBe(0);
    expect(await recordDeletedCharacterCopies(tx, 'realm-a', 7, undefined)).toBe(0);
    expect(tx.sql).toEqual([]);
  });

  it('writes the rows inside a savepoint', async () => {
    const tx = fakeTransaction();
    expect(await recordDeletedCharacterCopies(tx, 'realm-a', 7, holdings())).toBe(6);
    expect(tx.sql[0]).toBe('SAVEPOINT character_delete_item_ledger');
    expect(tx.sql[1]).toMatch(/^INSERT INTO item_ledger/);
    expect(tx.sql[2]).toBe('RELEASE SAVEPOINT character_delete_item_ledger');
    expect(tx.sql).toHaveLength(3);
    const values = tx.query.mock.calls[1][1] as unknown[];
    expect(values[2]).toBe('Doomed');
    expect(values[4]).toEqual([G1, G2, G3, G4, G5, G6]);
  });

  it('a database refusal of the audit insert rolls back to the savepoint and does not throw', async () => {
    const refusal = Object.assign(new Error('check violation'), { code: '23514' });
    const tx = fakeTransaction(refusal);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await recordDeletedCharacterCopies(tx, 'realm-a', 7, holdings())).toBe(0);
    } finally {
      log.mockRestore();
    }
    expect(tx.sql.at(-1)).toBe('ROLLBACK TO SAVEPOINT character_delete_item_ledger');
    expect(tx.sql).not.toContain('RELEASE SAVEPOINT character_delete_item_ledger');
  });

  it('a dead connection (no SQLSTATE) propagates: the transaction cannot commit', async () => {
    const tx = fakeTransaction(new Error('Connection terminated'));
    await expect(recordDeletedCharacterCopies(tx, 'realm-a', 7, holdings())).rejects.toThrow(
      'Connection terminated',
    );
    expect(tx.sql).not.toContain('ROLLBACK TO SAVEPOINT character_delete_item_ledger');
  });
});

describe('inside the real delete transaction', () => {
  function deletePool(returning: DeletedCharacterHoldingsRow[]) {
    const sql: string[] = [];
    const client = {
      query: vi.fn(async (text: string) => {
        sql.push(text);
        if (/SELECT id FROM accounts/.test(text)) return { rows: [{ id: 7 }], rowCount: 1 };
        if (/SELECT id FROM characters/.test(text)) return { rows: [{ id: 42 }], rowCount: 1 };
        if (/DELETE FROM characters/.test(text)) {
          return { rows: returning, rowCount: returning.length };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    return { sql, client, pool: { connect: async () => client as never } };
  }

  it('writes the consume rows after the DELETE and before COMMIT', async () => {
    const { sql, pool } = deletePool([holdings()]);
    expect(await deleteOwnedCharacterRow(pool, 7, 42, 'realm-a')).toBe(true);
    const deletion = sql.findIndex((s) => /DELETE FROM characters/.test(s));
    const insert = sql.findIndex((s) => /INSERT INTO item_ledger/.test(s));
    expect(sql[deletion]).toContain(DELETED_CHARACTER_HOLDINGS_RETURNING);
    expect(sql[deletion]).toMatch(/RETURNING name,/);
    expect(insert).toBeGreaterThan(deletion);
    expect(sql[insert - 1]).toBe('SAVEPOINT character_delete_item_ledger');
    expect(sql[insert + 1]).toBe('RELEASE SAVEPOINT character_delete_item_ledger');
    expect(sql.at(-1)).toBe('COMMIT');
  });

  it('a character with no tracked copy adds no statement to the transaction', async () => {
    const { sql, pool } = deletePool([{ name: 'Plain', inventory: [] }]);
    expect(await deleteOwnedCharacterRow(pool, 7, 42, 'realm-a')).toBe(true);
    expect(sql.some((s) => /item_ledger|SAVEPOINT/.test(s))).toBe(false);
    expect(sql.at(-1)).toBe('COMMIT');
  });
});
