// The GUILD source custody chain, end to end across the server seams it is
// actually made of: the dispatch differ that reads the legs off the book, the
// receipt serializer that canonicalizes and freezes them, the replay that puts
// them back, and the save transaction that journals the before/after the receipt
// gate really wrote.
//
// The failures these pin, stated plainly:
//   * a one-unit deposit into a mixed stack must record ONE unit with ONE leg,
//     not the whole merged after-stack (which would MINT on replay);
//   * receipt bytes must not depend on the order legs were observed in;
//   * a replayed sidecar must carry the same legs the command committed;
//   * a save that moved material must journal exactly one source batch, AFTER
//     the guild row it describes, on the caller's own transaction;
//   * a save that moved none, and an all-existing receipt prefix, must pay zero
//     source queries;
//   * a journal refusal must THROW, so the audit and the book abort together.

import { describe, expect, it, vi } from 'vitest';
import { diffGuildBankOp } from '../../server/bank_ledger';
import type { BankLedgerBatchWriteResult } from '../../server/bank_ledger_batch_db';
import {
  bankLedgerCommandBatchFingerprintJson,
  type PreparedBankLedgerCommandBatch,
  serializeBankLedgerCommandBatch,
  serializeBankLedgerGuildEffect,
} from '../../server/bank_ledger_outbox';
import {
  guildBankSavesForNewClaims,
  prepareGuildBankReceiptReplay,
  writeClaimedGuildBankEffectsOnClient,
} from '../../server/guild_bank_receipt_db';
import {
  GUILD_SOURCE_JOURNAL_REFUSED,
  journalGuildBookSources,
} from '../../server/guild_bank_source_journal';
import { REALM } from '../../server/realm';
import type { GuildBankOpDelta } from '../../src/sim/guild_bank';
import { materialItemIds } from '../../src/sim/material_ids';
import type { MaterialSource, MaterialSourceDelta } from '../../src/sim/material_sources';
import type { InvSlot } from '../../src/sim/types';
import type { GuildBankInfo } from '../../src/world_api';

const OWNER = Object.freeze({ realm: 'moonbrook', characterId: 42, accountId: 7 });
const ORE = 'copper_ore';
const GUILD = 5;

const ANA: MaterialSource = { gatherer: { kind: 'character', id: 11, name: 'Ana' } };
const BRU: MaterialSource = { gatherer: { kind: 'character', id: 22, name: 'Bru' } };
const CAI: MaterialSource = { gatherer: { kind: 'character', id: 33, name: 'Cai' } };

const sameSource = (a: MaterialSource, b: MaterialSource): boolean => {
  if ((a.signer ?? null) !== (b.signer ?? null)) return false;
  const ga = a.gatherer;
  const gb = b.gatherer;
  if (ga === undefined || gb === undefined) return ga === gb;
  return ga.kind === gb.kind && ga.id === gb.id && ga.name === gb.name;
};

const legOf = (
  legs: readonly MaterialSourceDelta[] | null | undefined,
  source: MaterialSource,
): number | undefined => (legs ?? []).find((leg) => sameSource(leg.source, source))?.count;

function info(slots: InvSlot[]): GuildBankInfo {
  return {
    treasury: 0,
    slots,
    capacity: 24,
    purchasedSlots: 24,
    nextExpansionPrice: 25_000,
    canEdit: true,
  };
}

function guildDelta(overrides: Partial<GuildBankOpDelta> = {}): GuildBankOpDelta {
  return {
    op: 'deposit',
    itemId: ORE,
    count: 1,
    instance: null,
    craftedRecipeId: null,
    copperDelta: 0,
    purchasedSlotsBefore: 24,
    purchasedSlotsAfter: 24,
    ...overrides,
  };
}

function batch(
  key: string,
  guildId: number,
  deltas: readonly GuildBankOpDelta[],
): PreparedBankLedgerCommandBatch {
  return serializeBankLedgerCommandBatch(
    key,
    deltas.map((value) => ({
      ...OWNER,
      op: value.op,
      itemId: value.itemId,
      count: value.count,
      instance: value.instance,
      copperDelta: value.copperDelta,
      purchasedSlotsAfter: value.purchasedSlotsAfter,
      container: 'guild' as const,
      containerId: guildId,
    })),
    { guildId, deltas },
  );
}

function claims(
  entries: readonly [PreparedBankLedgerCommandBatch, boolean][],
): BankLedgerBatchWriteResult {
  const firstNew = entries.findIndex(([, newlyClaimed]) => newlyClaimed);
  const prefixEnd = firstNew === -1 ? entries.length : firstNew;
  return {
    batches: entries.map(([value, newlyClaimed]) => ({
      batch: value,
      newlyClaimed,
      guildEffect: value.guildEffect,
    })),
    alreadyCommittedPrefix: entries.slice(0, prefixEnd).map(([value]) => value),
  };
}

/** A recording transaction client: the guild row it holds, plus every statement
 *  it was asked to run, in order. */
type QueryResult = { rows?: Record<string, unknown>[]; rowCount?: number | null };

function fakeClient(durable: unknown) {
  const statements: { text: string; values: unknown[] }[] = [];
  return {
    statements,
    async query(text: string, values: unknown[] = []): Promise<QueryResult> {
      statements.push({ text, values });
      if (text.includes('FOR UPDATE')) {
        const json = JSON.stringify(durable);
        return { rows: [{ data_bytes: Buffer.byteLength(json, 'utf8'), data: durable }] };
      }
      if (text.includes('material_source_journal')) {
        const records = JSON.parse(String(values[0])) as { ord: number; owner_id: number }[];
        return {
          rows: records.map((record) => ({
            ord: record.ord,
            realm: REALM,
            container: 'guild',
            owner_id: String(record.owner_id),
            revision: String(record.ord + 1),
          })),
        };
      }
      return { rows: [], rowCount: 1 };
    },
  };
}

const journalStatements = (statements: { text: string }[]): number =>
  statements.filter((s) => s.text.includes('material_source_journal')).length;

describe('the fixture id is really a material', () => {
  it('classifies copper_ore from the real derived registry', () => {
    expect(materialItemIds().has(ORE)).toBe(true);
  });
});

describe('diffGuildBankOp: the legs come from the before/after book', () => {
  it('records ONE unit with ONE leg when a single unit merges into a mixed stack', () => {
    const before = info([
      {
        itemId: ORE,
        count: 8,
        materialSources: [
          { source: ANA, count: 5 },
          { source: BRU, count: 3 },
        ],
      },
    ]);
    const after = info([
      {
        itemId: ORE,
        count: 9,
        materialSources: [
          { source: ANA, count: 5 },
          { source: BRU, count: 3 },
          { source: CAI, count: 1 },
        ],
      },
    ]);

    const deltas = diffGuildBankOp('deposit', before, after);

    expect(deltas).toHaveLength(1);
    // Nine would be the whole merged after-stack; replaying that onto durable
    // truth mints the eight units the book already held.
    expect(deltas[0].count).toBe(1);
    expect(deltas[0].materialSources).toHaveLength(1);
    expect(legOf(deltas[0].materialSources, CAI)).toBe(1);
  });

  it('signs a withdraw negative and names exactly the descriptors that left', () => {
    const before = info([
      {
        itemId: ORE,
        count: 10,
        materialSources: [
          { source: ANA, count: 4 },
          { source: BRU, count: 6 },
        ],
      },
    ]);
    const after = info([{ itemId: ORE, count: 6, materialSources: [{ source: BRU, count: 6 }] }]);

    const deltas = diffGuildBankOp('withdraw', before, after);

    expect(deltas).toHaveLength(1);
    expect(deltas[0].count).toBe(4);
    expect(legOf(deltas[0].materialSources, ANA)).toBe(-4);
    expect(legOf(deltas[0].materialSources, BRU)).toBeUndefined();
  });

  it('records a pure re-attribution as a count-0 delta carrying both sides of the swap', () => {
    const before = info([
      {
        itemId: ORE,
        count: 5,
        materialSources: [
          { source: ANA, count: 3 },
          { source: BRU, count: 2 },
        ],
      },
    ]);
    const after = info([
      {
        itemId: ORE,
        count: 5,
        materialSources: [
          { source: ANA, count: 1 },
          { source: BRU, count: 4 },
        ],
      },
    ]);

    const deltas = diffGuildBankOp('deposit', before, after);

    expect(deltas).toHaveLength(1);
    expect(deltas[0].count).toBe(0);
    expect(legOf(deltas[0].materialSources, ANA)).toBe(-2);
    expect(legOf(deltas[0].materialSources, BRU)).toBe(2);
  });

  it('emits nothing when a book with material stock did not move at all', () => {
    const slots: InvSlot[] = [
      { itemId: ORE, count: 5, materialSources: [{ source: ANA, count: 5 }] },
    ];
    expect(diffGuildBankOp('deposit', info(slots), info(slots.map((s) => ({ ...s }))))).toEqual([]);
  });
});

// A durable receipt row is keyed by the fingerprint of its payload, and it is
// RETRIED after a restart. So the bytes an old binary already wrote have to keep
// hashing to the same thing under the new one: a stop-then-cutover stops the
// processes, not the rows. These two arms are the whole compatibility argument,
// pinned as LITERALS rather than as a self-comparison that would pass whatever
// the serializer does.
describe('receipt fingerprint compatibility', () => {
  const legacyGuildBatch = () =>
    batch('guild.legacy', GUILD, [guildDelta({ op: 'withdraw', itemId: 'iron_sword', count: 1 })]);

  it('leaves a legacy guild receipt byte-identical to what an old binary wrote', () => {
    expect(bankLedgerCommandBatchFingerprintJson(legacyGuildBatch())).toBe(
      '{"batchKey":"guild.legacy","rows":[{"realm":"moonbrook","characterId":42,"accountId":7,' +
        '"op":"withdraw","itemId":"iron_sword","count":1,"instanceJson":null,"copperDelta":0,' +
        '"purchasedSlotsAfter":24,"container":"guild","containerId":5,' +
        '"counterpartyCopperDelta":null,"counterpartyCount":null}],' +
        '"guildEffect":{"guildId":5,"deltas":[{"op":"withdraw","itemId":"iron_sword","count":1,' +
        '"instanceJson":null,"craftedRecipeId":null,"copperDelta":0,"purchasedSlotsBefore":24,' +
        '"purchasedSlotsAfter":24}],"actorAccountId":null}}',
    );
  });

  it('DOES move the hash once a delta really carries exact source legs', () => {
    // The pin above must not be achieved by dropping the new field on the
    // floor: a receipt that records different units has to record differently.
    const withLegs = batch('guild.legacy', GUILD, [
      guildDelta({
        op: 'withdraw',
        itemId: ORE,
        count: 1,
        materialSources: [{ source: CAI, count: -1 }],
      }),
    ]);
    const json = bankLedgerCommandBatchFingerprintJson(withLegs);

    expect(json).not.toBe(bankLedgerCommandBatchFingerprintJson(legacyGuildBatch()));
    expect(json).toContain('"materialSources":[{"source":{"gatherer":');
  });
});

describe('the receipt shape', () => {
  it('canonicalizes legs so observation order cannot change the receipt bytes', () => {
    const observedOneWay = serializeBankLedgerGuildEffect({
      guildId: GUILD,
      deltas: [
        guildDelta({
          count: 3,
          materialSources: [
            { source: BRU, count: 1 },
            { source: ANA, count: 2 },
          ],
        }),
      ],
    });
    const observedTheOther = serializeBankLedgerGuildEffect({
      guildId: GUILD,
      deltas: [
        guildDelta({
          count: 3,
          materialSources: [
            { source: ANA, count: 1 },
            { source: BRU, count: 1 },
            { source: ANA, count: 1 },
          ],
        }),
      ],
    });

    expect(JSON.stringify(observedOneWay)).toBe(JSON.stringify(observedTheOther));
  });

  it('freezes the legs it hands out ALL THE WAY DOWN, gatherer included', () => {
    // A receipt is hashed and later replayed, so it has to be immutable in both
    // roles. Freezing the leg and its `source` but not `source.gatherer` left
    // the gatherer's id and its historic name snapshot editable in place, which
    // is the half of the descriptor an attribution argument is actually about.
    const gatherer = { kind: 'character' as const, id: 11, name: 'Ana' };
    const effect = serializeBankLedgerGuildEffect({
      guildId: GUILD,
      deltas: [guildDelta({ count: 2, materialSources: [{ source: { gatherer }, count: 2 }] })],
    });
    const carried = effect.deltas[0].materialSources;
    const source = carried?.[0].source;

    expect(Object.isFrozen(carried)).toBe(true);
    expect(Object.isFrozen(carried?.[0])).toBe(true);
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source?.gatherer)).toBe(true);
    expect(() => {
      (source?.gatherer as { name: string }).name = 'Mallory';
    }).toThrow();
  });

  it('detaches the descriptor, so mutating the caller-owned gatherer cannot move the hash', () => {
    const gatherer = { kind: 'character' as const, id: 11, name: 'Ana' };
    const build = () =>
      batch('guild.detach', GUILD, [
        guildDelta({ count: 2, materialSources: [{ source: { gatherer }, count: 2 }] }),
      ]);
    const before = bankLedgerCommandBatchFingerprintJson(build());
    const captured = build();

    gatherer.name = 'Mallory';
    gatherer.id = 99;

    expect(captured.guildEffect?.deltas[0].materialSources?.[0].source.gatherer).toEqual({
      kind: 'character',
      id: 11,
      name: 'Ana',
    });
    expect(bankLedgerCommandBatchFingerprintJson(captured)).toBe(before);
  });

  it('OMITS the key entirely for an absent, null or fully cancelling leg list', () => {
    const plain = serializeBankLedgerGuildEffect({ guildId: GUILD, deltas: [guildDelta()] });
    const explicitNull = serializeBankLedgerGuildEffect({
      guildId: GUILD,
      deltas: [guildDelta({ materialSources: null })],
    });
    const cancelling = serializeBankLedgerGuildEffect({
      guildId: GUILD,
      deltas: [
        guildDelta({
          count: 0,
          materialSources: [
            { source: ANA, count: 2 },
            { source: ANA, count: -2 },
          ],
        }),
      ],
    });

    // OMITTED, not null: an own key called materialSources whose value is null
    // would still serialize as `"materialSources":null` and move the hash of
    // every guild receipt already durable.
    for (const effect of [plain, explicitNull, cancelling]) {
      expect(Object.hasOwn(effect.deltas[0], 'materialSources')).toBe(false);
      expect(JSON.stringify(effect)).not.toContain('materialSources');
    }
  });

  it('refuses legs the shared algebra cannot read rather than hashing junk', () => {
    expect(() =>
      serializeBankLedgerGuildEffect({
        guildId: GUILD,
        deltas: [guildDelta({ materialSources: [{ source: ANA, count: 0 }] })],
      }),
    ).toThrow(/materialSources is invalid/);
  });

  it('carries the exact legs back out through the receipt replay', () => {
    const command = batch('guild.sources', GUILD, [
      guildDelta({ count: 1, materialSources: [{ source: CAI, count: 1 }] }),
    ]);
    const plan = prepareGuildBankReceiptReplay(
      [
        {
          guildId: GUILD,
          deltas: [guildDelta({ count: 1, materialSources: [{ source: CAI, count: 1 }] })],
        },
      ],
      [command],
    );

    const replayed = guildBankSavesForNewClaims(plan, claims([[command, true]]));

    expect(replayed).toHaveLength(1);
    expect(legOf(replayed[0].deltas[0].materialSources, CAI)).toBe(1);
  });
});

describe('the save transaction journals what it actually wrote', () => {
  const durable = {
    treasury: 0,
    purchasedSlots: 24,
    inventory: [{ itemId: ORE, count: 4, materialSources: [{ source: ANA, count: 4 }] }],
  };

  function movingSave() {
    const delta = guildDelta({ count: 1, materialSources: [{ source: CAI, count: 1 }] });
    const command = batch('guild.move', GUILD, [delta]);
    const plan = prepareGuildBankReceiptReplay([{ guildId: GUILD, deltas: [delta] }], [command]);
    return { plan, claimed: claims([[command, true]]) };
  }

  it('writes ONE source batch, after the guild row, carrying the exact moved leg', async () => {
    const client = fakeClient(durable);
    const { plan, claimed } = movingSave();

    await writeClaimedGuildBankEffectsOnClient(client, plan, claimed);

    expect(journalStatements(client.statements)).toBe(1);
    const journalIndex = client.statements.findIndex((s) =>
      s.text.includes('material_source_journal'),
    );
    const updateIndex = client.statements.findIndex(
      (s) => s.text.includes('INSERT INTO guild_banks') && s.text.includes('DO UPDATE'),
    );
    // The journal describes a row that is already written, never one that might
    // still be refused.
    expect(updateIndex).toBeGreaterThanOrEqual(0);
    expect(journalIndex).toBeGreaterThan(updateIndex);

    const records = JSON.parse(String(client.statements[journalIndex].values[0]));
    expect(records).toHaveLength(1);
    expect(records[0].container).toBe('guild');
    expect(records[0].owner_id).toBe(GUILD);
    expect(records[0].owner_character_id).toBeNull();
    // The opening is the locked persisted BEFORE state, and the movement is the
    // one unit that arrived, not the five the row now holds.
    expect(records[0].opening.entries[0].count).toBe(4);
    expect(records[0].movements).toHaveLength(1);
    expect(records[0].movements[0].count).toBe(1);
    expect(legOf(records[0].movements[0].sourceDeltas, CAI)).toBe(1);
  });

  it('pays no source query when the save moved no material at all', async () => {
    const client = fakeClient(durable);
    const goldOnly = guildDelta({
      op: 'deposit_gold',
      itemId: null,
      count: null,
      copperDelta: 500,
    });
    const command = serializeBankLedgerCommandBatch(
      'guild.gold',
      [
        {
          ...OWNER,
          op: 'deposit_gold',
          itemId: null,
          count: null,
          instance: null,
          copperDelta: 500,
          purchasedSlotsAfter: 24,
          container: 'guild' as const,
          containerId: GUILD,
        },
      ],
      { guildId: GUILD, deltas: [goldOnly] },
    );
    const plan = prepareGuildBankReceiptReplay([{ guildId: GUILD, deltas: [goldOnly] }], [command]);

    await writeClaimedGuildBankEffectsOnClient(client, plan, claims([[command, true]]));

    expect(journalStatements(client.statements)).toBe(0);
  });

  it('pays zero guild AND zero source queries for an all-existing receipt prefix', async () => {
    const client = fakeClient(durable);
    const delta = guildDelta({ count: 1, materialSources: [{ source: CAI, count: 1 }] });
    const command = batch('guild.retry', GUILD, [delta]);
    const plan = prepareGuildBankReceiptReplay([{ guildId: GUILD, deltas: [delta] }], [command]);

    await writeClaimedGuildBankEffectsOnClient(client, plan, claims([[command, false]]));

    expect(client.statements).toHaveLength(0);
  });

  it('journals two guilds in ascending id order, in one batch', async () => {
    const client = fakeClient(durable);
    const nine = guildDelta({ count: 1, materialSources: [{ source: CAI, count: 1 }] });
    const seven = guildDelta({ count: 1, materialSources: [{ source: BRU, count: 1 }] });
    const batchNine = batch('guild.9', 9, [nine]);
    const batchSeven = batch('guild.7', 7, [seven]);
    const plan = prepareGuildBankReceiptReplay(
      [
        { guildId: 9, deltas: [nine] },
        { guildId: 7, deltas: [seven] },
      ],
      [batchNine, batchSeven],
    );

    await writeClaimedGuildBankEffectsOnClient(
      client,
      plan,
      claims([
        [batchNine, true],
        [batchSeven, true],
      ]),
    );

    expect(journalStatements(client.statements)).toBe(1);
    const journal = client.statements.find((s) => s.text.includes('material_source_journal'));
    const records = JSON.parse(String(journal?.values[0]));
    expect(records.map((record: { owner_id: number }) => record.owner_id)).toEqual([7, 9]);
  });

  it('propagates a journal failure so the whole transaction aborts with the book', async () => {
    const client = fakeClient(durable);
    const failing = {
      async query(text: string, values: unknown[] = []): Promise<QueryResult> {
        if (text.includes('material_source_journal')) throw new Error('journal exploded');
        return client.query(text, values);
      },
    };
    const { plan, claimed } = movingSave();

    await expect(writeClaimedGuildBankEffectsOnClient(failing, plan, claimed)).rejects.toThrow(
      /journal exploded/,
    );
  });
});

describe('journalGuildBookSources', () => {
  it('sends no query at all when nothing changed', async () => {
    const query = vi.fn();
    expect(await journalGuildBookSources({ query }, [])).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('THROWS on a refusal, with a static operator diagnostic and the core error code', async () => {
    const query = vi.fn();

    await expect(
      journalGuildBookSources({ query }, [
        {
          guildId: GUILD,
          before: [],
          // A material stack of zero units is a shape the source model refuses:
          // a container it cannot read must abort the save, never commit an
          // audit that silently omits a stack.
          after: [{ itemId: ORE, count: 0 }],
        },
      ]),
    ).rejects.toThrow(GUILD_SOURCE_JOURNAL_REFUSED);
    expect(query).not.toHaveBeenCalled();
  });
});
