import { describe, expect, it, vi } from 'vitest';
import { rekeyOfflineCharacterSigner } from '../../server/character_signer_db';
import { mutateOfflineCharacterState } from '../../server/offline_character_mutation_db';
import type { BoundedTransactionRunner } from '../../server/offline_character_save_db';
import { REALM } from '../../server/realm';
import type { CharacterState } from '../../src/sim/sim';

vi.mock('../../server/db', () => ({ runWithStatementTimeout: vi.fn() }));

/** The one revision this fixture's signer rewrite journals: the personal bank,
 *  minted at revision 1 for character 41. Answered so the write is exercised
 *  for real rather than skipped; a fake answering nothing would make the
 *  journal throw about the row it did not get back. */
const JOURNAL_ROW = { ord: 0, realm: REALM, container: 'personal', owner_id: '41', revision: '1' };

function transaction(state: CharacterState | null, updated = 1) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => ({
    rows: sql.startsWith('SELECT level')
      ? [{ level: 17, state }]
      : sql.startsWith('WITH input AS')
        ? [JOURNAL_ROW]
        : [],
    rowCount: sql.startsWith('UPDATE characters') ? updated : 0,
    command: '',
    oid: 0,
    fields: [],
  }));
  const run: BoundedTransactionRunner = async (timeout, work) => {
    expect(timeout).toBe(5000);
    return work(query);
  };
  return { query, run };
}

const ownSignerState = (): CharacterState =>
  ({
    level: 17,
    questLog: [],
    questsDone: [],
    money: 9876,
    inventory: [
      { itemId: 'wyrmfall_pendant', count: 1, instance: { signer: 'Before' } },
      { itemId: 'wyrmfall_pendant', count: 1, instance: { signer: 'Other', name: 'Kept' } },
    ],
    bank: { inventory: [{ itemId: 'iron_ore', count: 3, instance: { signer: 'Before' } }] },
    vendorBuyback: [{ itemId: 'iron_ore', count: 1, instance: { signer: 'Before' } }],
    equipmentInstance: { neck: { signer: 'Before', enchant: 'ench_minor_stamina' } },
    equipmentInstances: { chest: { signer: 'Before' } },
    toolEffectSlots: { mining: { craftedBy: 'Before', charges: 5 } },
  }) as unknown as CharacterState;

describe('fresh offline character signer mutation', () => {
  it('rewrites every signer region on the locked row without restoring any name', async () => {
    const { query, run } = transaction(ownSignerState());
    expect(await rekeyOfflineCharacterSigner(41, 'Before', 'After', run)).toBe(true);
    expect(query.mock.calls.slice(0, 4)).toEqual([
      ['SET LOCAL lock_timeout = 2000'],
      ['SET LOCAL idle_in_transaction_session_timeout = 10000'],
      ['SELECT level, state FROM characters WHERE id = $1 AND realm = $2 FOR UPDATE', [41, REALM]],
      ['DELETE FROM character_leases WHERE character_id = $1 AND expires_at <= now()', [41]],
    ]);
    const update = query.mock.calls[4];
    expect(update[0]).toContain('NOT EXISTS');
    expect(update[1]?.[1]).toBe(17);
    const saved = JSON.parse(update[1]?.[2] as string);
    expect(saved).toEqual({
      ...ownSignerState(),
      inventory: [
        { itemId: 'wyrmfall_pendant', count: 1, instance: { signer: 'After' } },
        { itemId: 'wyrmfall_pendant', count: 1, instance: { signer: 'Other', name: 'Kept' } },
      ],
      bank: { inventory: [{ itemId: 'iron_ore', count: 3, instance: { signer: 'After' } }] },
      vendorBuyback: [{ itemId: 'iron_ore', count: 1, instance: { signer: 'After' } }],
      equipmentInstance: { neck: { signer: 'After', enchant: 'ench_minor_stamina' } },
      equipmentInstances: { chest: { signer: 'After' } },
      toolEffectSlots: { mining: { craftedBy: 'After', charges: 5 } },
    });
    // The sanctioned signer rewrite is a MATERIAL source movement: the banked
    // iron ore keeps its three units and changes descriptor, so the journal
    // carries one count-0 row with an exact decrement and an exact increment,
    // in the SAME transaction, AFTER the write it audits.
    const journal = query.mock.calls[5];
    expect(String(journal[0])).toContain('WITH input AS');
    const records = JSON.parse(String((journal[1] as unknown[])[0])) as {
      container: string;
      owner_id: number;
      opening: unknown;
      movements: { itemId: string; count: number; sourceDeltas: unknown[] }[];
    }[];
    expect(records).toHaveLength(1);
    expect(records[0].container).toBe('personal');
    expect(records[0].owner_id).toBe(41);
    expect(records[0].movements).toEqual([
      {
        itemId: 'iron_ore',
        count: 0,
        sourceDeltas: [
          { source: { signer: 'After' }, count: 3 },
          { source: { signer: 'Before' }, count: -3 },
        ],
      },
    ]);
    // The opening replays from the pre-mutation state, signer and all.
    expect(records[0].opening).toEqual({
      entries: [
        { itemId: 'iron_ore', count: 3, sources: [{ source: { signer: 'Before' }, count: 3 }] },
      ],
    });
    expect(query).toHaveBeenCalledTimes(6);
  });

  it('reads fresh state even if nothing needs changing, and skips every write', async () => {
    const { query, run } = transaction(ownSignerState());
    expect(await rekeyOfflineCharacterSigner(41, 'Absent', 'After', run)).toBe(true);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.some(([sql]) => /^(DELETE|UPDATE)/.test(sql))).toBe(false);
  });

  it('returns false for a missing blob and a live-lease refusal', async () => {
    const missing = transaction(null);
    expect(await rekeyOfflineCharacterSigner(41, 'Before', 'After', missing.run)).toBe(false);
    expect(missing.query).toHaveBeenCalledTimes(3);
    const leased = transaction(ownSignerState(), 0);
    expect(await rekeyOfflineCharacterSigner(41, 'Before', 'After', leased.run)).toBe(false);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses an invalid mutation count before deleting or updating (%s)',
    async (count) => {
      const { query, run } = transaction(ownSignerState());
      await expect(mutateOfflineCharacterState(41, () => count, run)).rejects.toThrow(
        'non-negative safe integer',
      );
      expect(query).toHaveBeenCalledTimes(3);
    },
  );

  it('propagates a callback failure before any write', async () => {
    const { query, run } = transaction(ownSignerState());
    await expect(
      mutateOfflineCharacterState(
        41,
        () => {
          throw new Error('mutation failed');
        },
        run,
      ),
    ).rejects.toThrow('mutation failed');
    expect(query).toHaveBeenCalledTimes(3);
  });
});
