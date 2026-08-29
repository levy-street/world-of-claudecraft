import { describe, expect, it } from 'vitest';
import type { BankLedgerBatchWriteResult } from '../../server/bank_ledger_batch_db';
import {
  type PreparedBankLedgerCommandBatch,
  serializeBankLedgerCommandBatch,
} from '../../server/bank_ledger_outbox';
import {
  guildBankSavesForNewClaims,
  prepareGuildBankReceiptReplay,
  writeClaimedGuildBankEffectsOnClient,
} from '../../server/guild_bank_receipt_db';
import type { GuildBankOpDelta } from '../../src/sim/guild_bank';

const OWNER = Object.freeze({ realm: 'moonbrook', characterId: 42, accountId: 7 });

function delta(itemId: string, overrides: Partial<GuildBankOpDelta> = {}): GuildBankOpDelta {
  return {
    op: 'deposit',
    itemId,
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

describe('guild bank receipt replay planning', () => {
  it('aggregates duplicate-guild commands in command order and locks guilds ascending', () => {
    const guildNineFirst = batch('guild.9.first', 9, [delta('linen')]);
    const guildSeven = batch('guild.7', 7, [delta('ore')]);
    const guildNineSecond = batch('guild.9.second', 9, [delta('silk')]);
    const batches = [guildNineFirst, guildSeven, guildNineSecond];
    const plan = prepareGuildBankReceiptReplay(
      [
        { guildId: 9, deltas: [delta('linen'), delta('silk')] },
        { guildId: 7, deltas: [delta('ore')] },
      ],
      batches,
    );

    expect(
      guildBankSavesForNewClaims(
        plan,
        claims([
          [guildNineFirst, true],
          [guildSeven, true],
          [guildNineSecond, true],
        ]),
      ).map((save) => [save.guildId, save.deltas.map((value) => value.itemId)]),
    ).toEqual([
      [7, ['ore']],
      [9, ['linen', 'silk']],
    ]);
  });

  it('filters an existing prefix and replays only the new suffix', () => {
    const existing = batch('guild.existing', 5, [delta('old')]);
    const newFirst = batch('guild.new.1', 5, [delta('new-1')]);
    const newSecond = batch('guild.new.2', 5, [delta('new-2')]);
    const plan = prepareGuildBankReceiptReplay(
      [{ guildId: 5, deltas: [delta('old'), delta('new-1'), delta('new-2')] }],
      [existing, newFirst, newSecond],
    );

    expect(
      guildBankSavesForNewClaims(
        plan,
        claims([
          [existing, false],
          [newFirst, true],
          [newSecond, true],
        ]),
      )[0]?.deltas.map((value) => value.itemId),
    ).toEqual(['new-1', 'new-2']);
  });

  it('rejects a nonempty unreceipted or mismatched dirty book synchronously', () => {
    expect(() =>
      prepareGuildBankReceiptReplay([{ guildId: 5, deltas: [delta('unreceipted')] }], []),
    ).toThrow(/nonempty unreceipted/);
    const receipted = batch('guild.expected', 5, [delta('expected')]);
    expect(() =>
      prepareGuildBankReceiptReplay([{ guildId: 5, deltas: [delta('different')] }], [receipted]),
    ).toThrow(/do not match the receipt prefix/);
  });

  it('keeps 501+ admitted commands exact and replays the original new suffix, never a compacted log', () => {
    const original = Array.from({ length: 501 }, () => delta('ore'));
    const batches = original.map((value, index) => batch(`guild.long.${index}`, 5, [value]));
    const exactPlan = prepareGuildBankReceiptReplay([{ guildId: 5, deltas: original }], batches);
    const writePlan = guildBankSavesForNewClaims(
      exactPlan,
      claims(batches.map((value, index) => [value, index >= 300] as const)),
    );

    expect(writePlan).toHaveLength(1);
    expect(writePlan[0]?.deltas).toHaveLength(201);
    expect(writePlan[0]?.deltas.every((value) => value.count === 1)).toBe(true);

    // The old >500 log compactor would collapse the same commands to one
    // count-501 delta. Receipt replay deliberately rejects that nonexact
    // carrier instead of accepting reordered or count-splice-unsafe state.
    expect(() =>
      prepareGuildBankReceiptReplay(
        [
          {
            guildId: 5,
            deltas: [
              delta('ore', {
                count: 501,
                purchasedSlotsBefore: 0,
                purchasedSlotsAfter: 0,
              }),
            ],
          },
        ],
        batches,
      ),
    ).toThrow(/do not match the receipt prefix/);
  });
});

describe('writeClaimedGuildBankEffectsOnClient', () => {
  it('issues zero guild queries and preserves per-command guild correlation in batch order', async () => {
    const guildNineFirst = batch('guild.existing.9.first', 9, [delta('linen')]);
    const guildSeven = batch('guild.existing.7', 7, [delta('ore')]);
    const guildNineSecond = batch('guild.existing.9.second', 9, [delta('silk')]);
    const batches = [guildNineFirst, guildSeven, guildNineSecond];
    const plan = prepareGuildBankReceiptReplay(
      [
        { guildId: 9, deltas: [delta('linen'), delta('silk')] },
        { guildId: 7, deltas: [delta('ore')] },
      ],
      batches,
    );
    let queries = 0;
    const results: Array<{
      guildId: number;
      written: boolean;
      deficit: null;
      rowUnusable: boolean;
    }> = [];

    await writeClaimedGuildBankEffectsOnClient(
      {
        async query() {
          queries++;
          return { rows: [], rowCount: 0 };
        },
      },
      plan,
      claims(batches.map((value) => [value, false] as const)),
      results,
    );

    expect(queries).toBe(0);
    expect(results).toEqual([
      { guildId: 9, written: true, deficit: null, rowUnusable: false },
      { guildId: 7, written: true, deficit: null, rowUnusable: false },
      { guildId: 9, written: true, deficit: null, rowUnusable: false },
    ]);
  });
});
