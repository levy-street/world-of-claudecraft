import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  PROCEDURAL_ITEM_UID_BLOCK_SIZE,
  proceduralItemUidNamespaceForRealm,
  RESERVE_PROCEDURAL_ITEM_UID_BLOCK_SQL,
  reserveProceduralItemUidBlock,
} from '../../server/procedural_item_uid_db';

function fakePool(rows: unknown[]) {
  const query = vi.fn(() => Promise.resolve({ rows }));
  return { query, pool: { query } as unknown as Pool };
}

describe('reserveProceduralItemUidBlock', () => {
  it('uses one parameterized atomic UPSERT and preserves BIGINT strings', async () => {
    const db = fakePool([{ start_serial: '9007199254740993', end_exclusive: '9007199254741003' }]);

    const lease = await reserveProceduralItemUidBlock(db.pool, 'Area 52', 10);

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query).toHaveBeenCalledWith(RESERVE_PROCEDURAL_ITEM_UID_BLOCK_SQL, ['Area 52', '10']);
    expect(lease).toEqual({
      realmNamespace: proceduralItemUidNamespaceForRealm('Area 52'),
      startSerial: '9007199254740993',
      endExclusive: '9007199254741003',
    });
  });

  it('defaults to a 2^32 boot lease', async () => {
    const endExclusive = (1n + BigInt(PROCEDURAL_ITEM_UID_BLOCK_SIZE)).toString();
    const db = fakePool([{ start_serial: '1', end_exclusive: endExclusive }]);

    await reserveProceduralItemUidBlock(db.pool, 'Claudemoon');

    expect(db.query).toHaveBeenCalledWith(RESERVE_PROCEDURAL_ITEM_UID_BLOCK_SQL, [
      'Claudemoon',
      '4294967296',
    ]);
  });

  it('pins the single-statement concurrency shape', () => {
    expect(RESERVE_PROCEDURAL_ITEM_UID_BLOCK_SQL).toContain('ON CONFLICT (realm) DO UPDATE');
    expect(RESERVE_PROCEDURAL_ITEM_UID_BLOCK_SQL).toContain(
      'procedural_item_uid_sequences.next_serial + $2::bigint',
    );
    expect(RESERVE_PROCEDURAL_ITEM_UID_BLOCK_SQL).toContain('RETURNING');
    expect(RESERVE_PROCEDURAL_ITEM_UID_BLOCK_SQL).not.toMatch(/\bBEGIN\b|\bSELECT\b/);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid block size %s before querying',
    async (blockSize) => {
      const db = fakePool([]);
      await expect(reserveProceduralItemUidBlock(db.pool, 'Claudemoon', blockSize)).rejects.toThrow(
        /block size/,
      );
      expect(db.query).not.toHaveBeenCalled();
    },
  );

  it.each([
    { rows: [] as unknown[] },
    { rows: [{ start_serial: 'bad', end_exclusive: '11' }] },
    { rows: [{ start_serial: '1', end_exclusive: '12' }] },
  ])('fails closed on missing or invalid RETURNING data', async ({ rows }) => {
    const db = fakePool(rows);
    await expect(reserveProceduralItemUidBlock(db.pool, 'Claudemoon', 10)).rejects.toThrow();
  });
});

describe('proceduralItemUidNamespaceForRealm', () => {
  it('is exact, bounded, lowercase, and case-sensitive across valid realm names', () => {
    const names = [
      `Mal${String.fromCharCode(39)}Ganis`,
      'Area 52',
      'area 52',
      'A',
      'AA',
      'Z'.repeat(24),
    ];
    const namespaces = names.map(proceduralItemUidNamespaceForRealm);
    expect(new Set(namespaces).size).toBe(names.length);
    for (const namespace of namespaces) {
      expect(namespace).toMatch(/^[a-z0-9]{2,32}$/);
    }
  });

  it.each(['', 'x'.repeat(25), 'bad:realm'])('rejects invalid realm %s', (realm) => {
    expect(() => proceduralItemUidNamespaceForRealm(realm)).toThrow();
  });
});
