// The character save's source-journal adapter (server/character_material_sources_db.ts):
// the persisted blob to container slot lists, and the one journal call the save
// paths make. The shared ledger core is tested on its own; what is decisive HERE
// is that the adapter hands it the RIGHT slots (both vault stores, exact
// descriptors, nothing invented) and that the refusal/skip decisions the save
// paths depend on are the ones this module makes.
//
// The client is a spy, so "no movement means no query" is asserted as a real
// absence of SQL rather than as an empty result.
import { describe, expect, it, vi } from 'vitest';
import {
  CHARACTER_MATERIAL_SOURCE_REFUSAL,
  captureCharacterPreimage,
  characterMaterialChanges,
  journalCharacterSaveSources,
  readCharacterMaterialContainers,
} from '../../server/character_material_sources_db';
import type { MaterialSourceJournalRecord } from '../../server/material_source_journal_db';
import { REALM } from '../../server/realm';
import { materialItemIds } from '../../src/sim/material_ids';

// A real material id, asserted as a premise below: a renamed content id would
// otherwise turn every movement case into a silently skipped non-material.
const ORE = 'copper_ore';
const MARA = { kind: 'character', id: 7, name: 'Mara' } as const;
const LANDED = { rowCount: 1 };

function fakeClient(rows: Record<string, unknown>[] = []) {
  const query = vi.fn().mockResolvedValue({ rows, rowCount: rows.length });
  return { query };
}

/** The one journal statement's records, decoded from the parameter it carries. */
function recordsSent(query: ReturnType<typeof vi.fn>): MaterialSourceJournalRecord[] {
  expect(query).toHaveBeenCalledTimes(1);
  const params = query.mock.calls[0][1] as unknown[];
  return JSON.parse(String(params[0])) as MaterialSourceJournalRecord[];
}

/** One journal row per changed container, as the write statement returns it.
 *  The realm is THIS process's realm because that is what the adapter stamps;
 *  a row carrying anything else is rejected by the journal leaf's own read. */
const returnedRow = (ord: number, container: string, ownerId: number, revision: string) => ({
  ord,
  realm: REALM,
  container,
  owner_id: String(ownerId),
  revision,
});

describe('the material set premise', () => {
  it('still classifies the id these cases move as a material', () => {
    expect(materialItemIds().has(ORE)).toBe(true);
  });
});

describe('readCharacterMaterialContainers: the persisted blob to slot lists', () => {
  it('reads the bank inventory and BOTH vault stores, in stock-then-special order', () => {
    const read = readCharacterMaterialContainers(
      { inventory: [{ itemId: ORE, count: 3, slot: 2 }], purchasedSlots: 4 },
      { stock: { [ORE]: 5 }, special: [{ itemId: ORE, count: 1, craftedRecipeId: 'r_1' }] },
    );
    if (!read.ok) throw new Error(`expected a read, got ${read.error}`);
    expect(read.value.personal).toEqual([{ itemId: ORE, count: 3, slot: 2 }]);
    expect(read.value.vault).toEqual([
      { itemId: ORE, count: 5 },
      { itemId: ORE, count: 1, craftedRecipeId: 'r_1' },
    ]);
  });

  it('carries an exact composition and payload through untouched', () => {
    const sources = [
      { source: { gatherer: { ...MARA } }, count: 2 },
      { source: { signer: 'Old Hand' }, count: 1 },
    ];
    const read = readCharacterMaterialContainers(
      { inventory: [{ itemId: ORE, count: 3, materialSources: sources, instance: { tag: 'x' } }] },
      null,
    );
    if (!read.ok) throw new Error(`expected a read, got ${read.error}`);
    // Identity: the SAME descriptors, not a re-derived or folded copy.
    expect(read.value.personal[0].materialSources).toEqual(sources);
    expect(read.value.personal[0].instance).toEqual({ tag: 'x' });
  });

  it('skips a stock row holding EXACTLY nothing, and passes every other count on', () => {
    const read = readCharacterMaterialContainers(null, {
      stock: { [ORE]: 0, iron_ore: 2 },
    });
    if (!read.ok) throw new Error(`expected a read, got ${read.error}`);
    expect(read.value.vault).toEqual([{ itemId: 'iron_ore', count: 2 }]);
    // A count that CLAIMS something the ledger cannot represent is not skipped:
    // it reaches the core, which refuses the whole call there.
    const claimed = readCharacterMaterialContainers(null, { stock: { [ORE]: -1 } });
    if (!claimed.ok) throw new Error(`expected a read, got ${claimed.error}`);
    expect(claimed.value.vault).toEqual([{ itemId: ORE, count: -1 }]);
  });

  it('reads absent and null containers as empty, never as a refusal', () => {
    for (const [bank, vault] of [
      [undefined, undefined],
      [null, null],
      [{}, {}],
      [{ inventory: null }, { stock: null, special: null }],
    ] as const) {
      const read = readCharacterMaterialContainers(bank, vault);
      if (!read.ok) throw new Error(`expected a read, got ${read.error}`);
      expect(read.value.personal).toEqual([]);
      expect(read.value.vault).toEqual([]);
    }
  });

  it('refuses each malformed shape with its own code', () => {
    const cases: [unknown, unknown, string][] = [
      ['not-an-object', null, 'invalid-bank'],
      [[], null, 'invalid-bank'],
      [{ inventory: 'nope' }, null, 'invalid-bank-inventory'],
      [{ inventory: [null] }, null, 'invalid-bank-slot'],
      [{ inventory: [7] }, null, 'invalid-bank-slot'],
      [null, 'not-an-object', 'invalid-vault'],
      [null, { stock: [] }, 'invalid-vault-stock'],
      [null, { special: 'nope' }, 'invalid-vault-special'],
      [null, { special: [null] }, 'invalid-vault-slot'],
    ];
    for (const [bank, vault, error] of cases) {
      const read = readCharacterMaterialContainers(bank, vault);
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.error).toBe(error);
    }
  });
});

describe('captureCharacterPreimage: detached before the mutation', () => {
  it('survives an in-place rewrite of the state it was taken from', () => {
    const state = {
      bank: { inventory: [{ itemId: ORE, count: 2 }] },
      vault: { stock: { [ORE]: 4 }, upgrades: 1 },
    };
    const preimage = captureCharacterPreimage(state as never);
    state.bank.inventory[0].count = 99;
    state.vault.stock[ORE] = 0;
    state.bank.inventory.push({ itemId: ORE, count: 1 });
    expect(preimage.bank).toEqual({ inventory: [{ itemId: ORE, count: 2 }] });
    expect(preimage.vault).toEqual({ stock: { [ORE]: 4 }, upgrades: 1 });
  });

  it('reads a missing blob as an absent container pair, not as a throw', () => {
    expect(captureCharacterPreimage(null)).toEqual({ bank: null, vault: null });
  });

  it('does not invent live anchor proof for an offline capture', () => {
    const captured = captureCharacterPreimage({ bank: null, vault: null } as never);
    expect(Object.hasOwn(captured, 'personalAnchorExists')).toBe(false);
    expect(Object.hasOwn(captured, 'vaultAnchorExists')).toBe(false);
  });
});

describe('characterMaterialChanges: the two containers a character owns', () => {
  it('names personal then vault, both owned by the character id', () => {
    const empty = { personal: [], vault: [] };
    const changes = characterMaterialChanges(42, empty, empty, 'test-realm');
    expect(changes.map((change) => change.container)).toEqual(['personal', 'vault']);
    expect(changes.every((change) => change.ownerId === 42)).toBe(true);
    expect(changes.every((change) => change.realm === 'test-realm')).toBe(true);
    expect(changes.every((change) => change.anchorExists === undefined)).toBe(true);
  });

  it('carries only strict true live anchor proofs to their matching containers', () => {
    const empty = { personal: [], vault: [] };
    const changes = characterMaterialChanges(42, empty, empty, 'test-realm', {
      bank: null,
      vault: null,
      personalAnchorExists: true,
      vaultAnchorExists: false,
    });
    expect(changes.map((change) => change.anchorExists)).toEqual([true, undefined]);
  });
});

describe('journalCharacterSaveSources: what one save writes', () => {
  it('journals a ONE-unit deposit as one row with one +1 leg', async () => {
    const client = fakeClient([returnedRow(0, 'personal', 5, '1')]);
    const before = { bank: { inventory: [{ itemId: ORE, count: 4 }] }, vault: null };
    const after = {
      bank: {
        inventory: [
          {
            itemId: ORE,
            count: 5,
            materialSources: [
              { source: {}, count: 4 },
              { source: { gatherer: { ...MARA } }, count: 1 },
            ],
          },
        ],
      },
    };

    const written = await journalCharacterSaveSources(client, 5, before, LANDED, after as never);

    const records = recordsSent(client.query);
    expect(records).toHaveLength(1);
    expect(records[0].container).toBe('personal');
    expect(records[0].movements).toEqual([
      { itemId: ORE, count: 1, sourceDeltas: [{ source: { gatherer: { ...MARA } }, count: 1 }] },
    ]);
    // The opening is the BEFORE state, exactly: four unrecorded units.
    expect(records[0].opening).toEqual({
      entries: [{ itemId: ORE, count: 4, sources: [{ source: {}, count: 4 }] }],
    });
    expect(written?.movementRows).toBe(1);
    expect(written?.anchorsCreated).toBe(1);
  });

  it('omits an established personal opening only with trusted live proof', async () => {
    const client = fakeClient([returnedRow(0, 'personal', 5, '2')]);
    const before = {
      bank: { inventory: [{ itemId: ORE, count: 4 }] },
      vault: null,
      personalAnchorExists: true,
      vaultAnchorExists: false,
    };
    const after = { bank: { inventory: [{ itemId: ORE, count: 5 }] } };

    await journalCharacterSaveSources(client, 5, before, LANDED, after as never);

    const [record] = recordsSent(client.query);
    expect(record.container).toBe('personal');
    expect(record.opening).toBeNull();
  });

  it.each([
    ['explicit false', { personalAnchorExists: false }],
    ['absent proof', {}],
  ])('keeps the full opening for %s', async (_label, proof) => {
    const client = fakeClient([returnedRow(0, 'personal', 5, '1')]);
    const before = {
      bank: { inventory: [{ itemId: ORE, count: 4 }] },
      vault: null,
      ...proof,
    };
    const after = { bank: { inventory: [{ itemId: ORE, count: 5 }] } };

    await journalCharacterSaveSources(client, 5, before, LANDED, after as never);

    expect(recordsSent(client.query)[0].opening).toEqual({
      entries: [{ itemId: ORE, count: 4, sources: [{ source: {}, count: 4 }] }],
    });
  });

  it('keeps the full opening for an offline captured pre-image', async () => {
    const client = fakeClient([returnedRow(0, 'personal', 5, '1')]);
    const before = captureCharacterPreimage({
      bank: { inventory: [{ itemId: ORE, count: 4 }] },
      vault: null,
    } as never);

    await journalCharacterSaveSources(client, 5, before, LANDED, {
      bank: { inventory: [{ itemId: ORE, count: 5 }] },
    } as never);

    expect(recordsSent(client.query)[0].opening).toEqual({
      entries: [{ itemId: ORE, count: 4, sources: [{ source: {}, count: 4 }] }],
    });
  });

  it('journals a zero-count re-attribution as a count-0 row with two legs', async () => {
    const client = fakeClient([returnedRow(0, 'vault', 5, '4')]);
    const before = {
      bank: null,
      vault: {
        special: [
          {
            itemId: ORE,
            count: 2,
            craftedRecipeId: 'r_1',
            materialSources: [{ source: {}, count: 2 }],
          },
        ],
      },
    };
    const after = {
      vault: {
        stock: {},
        special: [
          {
            itemId: ORE,
            count: 2,
            craftedRecipeId: 'r_1',
            materialSources: [
              { source: {}, count: 1 },
              { source: { signer: 'Mara' }, count: 1 },
            ],
          },
        ],
      },
    };

    await journalCharacterSaveSources(client, 5, before, LANDED, after as never);

    const records = recordsSent(client.query);
    expect(records).toHaveLength(1);
    expect(records[0].container).toBe('vault');
    const [row] = records[0].movements;
    expect(row.count).toBe(0);
    expect(row.craftedRecipeId).toBe('r_1');
    expect(row.sourceDeltas).toEqual([
      { source: {}, count: -1 },
      { source: { signer: 'Mara' }, count: 1 },
    ]);
  });

  it('issues NO query at all when neither container moved', async () => {
    const client = fakeClient();
    const same = {
      bank: { inventory: [{ itemId: ORE, count: 4 }] },
      vault: { stock: { [ORE]: 9 }, upgrades: 2 },
    };

    const written = await journalCharacterSaveSources(client, 5, same, LANDED, same as never);

    expect(client.query).not.toHaveBeenCalled();
    expect(written).toEqual({
      writes: [],
      unchangedContainers: 2,
      anchorsCreated: 0,
      movementRows: 0,
    });
  });

  it('journals nothing when the fenced UPDATE touched no row', async () => {
    const client = fakeClient();
    const before = { bank: { inventory: [{ itemId: ORE, count: 4 }] }, vault: null };
    const after = { bank: { inventory: [{ itemId: ORE, count: 40 }] } };

    const written = await journalCharacterSaveSources(
      client,
      5,
      before,
      { rowCount: 0 },
      after as never,
    );

    expect(written).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('REFUSES a landed save that carried no pre-image, never an invented opening', async () => {
    const client = fakeClient();
    await expect(
      journalCharacterSaveSources(client, 5, null, LANDED, {
        bank: { inventory: [{ itemId: ORE, count: 4 }] },
      } as never),
    ).rejects.toThrow(CHARACTER_MATERIAL_SOURCE_REFUSAL);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('REFUSES a malformed source-bearing persisted row, whole, before any SQL', async () => {
    const client = fakeClient();
    // A composition whose legs do not sum to the stack it sits on: the core
    // refuses it, and the refusal must take the save down rather than dropping
    // the stack from the audit.
    const before = {
      bank: {
        inventory: [{ itemId: ORE, count: 4, materialSources: [{ source: {}, count: 3 }] }],
      },
      vault: null,
    };
    const after = { bank: { inventory: [{ itemId: ORE, count: 5 }] } };

    await expect(
      journalCharacterSaveSources(client, 5, before, LANDED, after as never),
    ).rejects.toThrow(CHARACTER_MATERIAL_SOURCE_REFUSAL);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('REFUSES a malformed persisted CONTAINER shape the same way', async () => {
    const client = fakeClient();
    await expect(
      journalCharacterSaveSources(client, 5, { bank: 7, vault: null }, LANDED, {} as never),
    ).rejects.toThrow('before invalid-bank');
    expect(client.query).not.toHaveBeenCalled();
  });

  it('ignores a non-material stack entirely (no movement, no query)', async () => {
    const client = fakeClient();
    const before = {
      bank: { inventory: [{ itemId: 'not_a_material_item', count: 1 }] },
      vault: null,
    };
    const after = { bank: { inventory: [{ itemId: 'not_a_material_item', count: 9 }] } };

    expect(materialItemIds().has('not_a_material_item')).toBe(false);
    expect(await journalCharacterSaveSources(client, 5, before, LANDED, after as never)).toEqual({
      writes: [],
      unchangedContainers: 2,
      anchorsCreated: 0,
      movementRows: 0,
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('carries BOTH containers in one statement when both moved', async () => {
    const client = fakeClient([
      returnedRow(0, 'personal', 5, '2'),
      returnedRow(1, 'vault', 5, '1'),
    ]);
    const before = {
      bank: { inventory: [{ itemId: ORE, count: 4 }] },
      vault: { stock: { [ORE]: 1 } },
    };
    const after = {
      bank: { inventory: [{ itemId: ORE, count: 3 }] },
      vault: { stock: { [ORE]: 2 } },
    };

    const written = await journalCharacterSaveSources(client, 5, before, LANDED, after as never);

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(recordsSent(client.query).map((record) => record.container)).toEqual([
      'personal',
      'vault',
    ]);
    expect(written?.movementRows).toBe(2);
    expect(written?.anchorsCreated).toBe(1);
  });
});
